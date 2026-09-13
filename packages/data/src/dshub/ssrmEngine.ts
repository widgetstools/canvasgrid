/**
 * The Rust hub as VelocityGrid's SSRM engine.
 *
 * Owns the three things a grid needs and the plane deliberately does not: a
 * hub instance, the tick pump that turns engine pushes into grid refreshes,
 * and the `IServerSideDatasourceV2` the grid is handed.
 *
 * The plane stays transport-agnostic — it is fed by whoever has rows, which
 * here is canvasgrid's own DataProvider layer rather than the hub's bundled
 * STOMP adapter. That keeps one transport, one catalog and one config plane
 * for both row models.
 */
import { DshubServerSideDatasource, type DshubPlaneLike } from './serverSideDatasource';

/** The plane constructor, injected so this module does not import the wasm. */
export type DshubPlaneFactory = (hubFactory: () => unknown) => DshubPlaneLike & {
  boot(providerId: string, cfg: unknown): Promise<void>;
  attachSession(sessionId: string): Promise<void>;
  detachSession(sessionId: string): Promise<string[]>;
  ingest(providerId: string, rows: readonly unknown[], replace: boolean): Promise<void>;
};

/** What the grid must expose for the pump to drive it. */
export interface RefreshableGrid {
  refreshServerSide(params?: { purge?: boolean }): void;
  setServerSideDatasource(ds: unknown | null): void;
}

export interface DshubSsrmEngineOptions {
  plane: ReturnType<DshubPlaneFactory>;
  providerId: string;
  /** Column metadata + keyColumn, in the plane's structural config shape. */
  config: unknown;
  /** colId -> aggregate for group rows. */
  aggregates?: Record<string, string>;
  /** Engine-computed columns riding every view — see the datasource. */
  computedColumns?: readonly import('./serverSideDatasource').DshubComputedColumn[];
  /**
   * Tick cadence. The engine conflates writes into whatever window this
   * defines, so it is a delivery knob, not a polling hack: a longer interval
   * means fewer, larger pushes rather than missed ones.
   */
  tickMs?: number;
}

export class DshubSsrmEngine {
  readonly #plane: ReturnType<DshubPlaneFactory>;
  readonly #providerId: string;
  readonly #sessionId: string;
  readonly #config: unknown;
  readonly #aggregates: Record<string, string>;
  readonly #computed: readonly import('./serverSideDatasource').DshubComputedColumn[];
  readonly #tickMs: number;
  #datasource: DshubServerSideDatasource | null = null;
  #grid: RefreshableGrid | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #booted = false;

  constructor(opts: DshubSsrmEngineOptions) {
    this.#plane = opts.plane;
    this.#providerId = opts.providerId;
    this.#sessionId = `${opts.providerId}:grid`;
    this.#config = opts.config;
    this.#aggregates = opts.aggregates ?? {};
    this.#computed = opts.computedColumns ?? [];
    this.#tickMs = opts.tickMs ?? 100;
  }

  /** Boot the engine and open this grid's session. Idempotent. */
  async start(): Promise<void> {
    if (this.#booted) return;
    await this.#plane.boot(this.#providerId, this.#config);
    await this.#plane.attachSession(this.#sessionId);
    this.#datasource = new DshubServerSideDatasource({
      plane: this.#plane,
      sessionId: this.#sessionId,
      providerId: this.#providerId,
      aggregates: this.#aggregates,
      computedColumns: this.#computed,
    });
    // A server-side grid folds GROUP deltas and re-reads the windows it shows;
    // `#drain` keeps `groupDelta` and drops `rowDelta` on the floor. Left on,
    // the engine builds one JSON object per changed row every tick for a
    // consumer that reads none of it — measured at 64% of the tick (0.95ms of
    // 1.49ms, 500k rows, 400 moved). Optional so an older vendored plane
    // without the switch still works, just as slowly as before.
    this.#plane.setRowDeltaEnabled?.(this.#providerId, false);
    this.#booted = true;
  }

  /**
   * Hand the datasource to a grid and start the pump.
   *
   * Returns the detach function, so a caller that swaps engines cannot leave
   * a pump running against a grid that no longer asks this engine anything.
   */
  attach(grid: RefreshableGrid): () => void {
    if (!this.#datasource) throw new Error('[dshub] attach before start()');
    this.#grid = grid;
    grid.setServerSideDatasource(this.#datasource);
    this.#timer = setInterval(() => this.#pump(), this.#tickMs);
    return () => this.detach();
  }

  detach(): void {
    if (this.#timer !== null) { clearInterval(this.#timer); this.#timer = null; }
    try { this.#grid?.setServerSideDatasource(null); } catch { /* grid tearing down */ }
    this.#grid = null;
  }

  /**
   * Feed rows in. `replace: true` is restart semantics — an atomic
   * truncate+ingest, so a snapshot that SHRANK does not leave stale keys
   * rendering as current.
   */
  async ingest(rows: readonly unknown[], replace = false): Promise<void> {
    if (!this.#booted) await this.start();
    await this.#plane.ingest(this.#providerId, rows, replace);
  }

  get datasource(): DshubServerSideDatasource | null {
    return this.#datasource;
  }

  async destroy(): Promise<void> {
    this.detach();
    if (this.#booted) {
      try { await this.#plane.detachSession(this.#sessionId); } catch { /* already gone */ }
    }
    this.#booted = false;
    this.#datasource = null;
  }

  /**
   * One tick: fold group deltas into the skeleton, and tell the grid only
   * when something actually moved.
   *
   * A purge-less refresh on every tick would repaint a still grid ten times a
   * second; the engine already answers "nothing changed" by pushing nothing,
   * so that answer is passed straight through.
   */
  #pump(): void {
    const ds = this.#datasource;
    const grid = this.#grid;
    if (!ds || !grid) return;
    let moved = false;
    try { moved = ds.drainTicks(); } catch { return; }
    if (moved) {
      try { grid.refreshServerSide({ purge: false }); } catch { /* grid tearing down */ }
    }
  }
}
