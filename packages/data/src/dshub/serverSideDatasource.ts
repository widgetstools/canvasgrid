/**
 * `IServerSideDatasourceV2` over the Rust hub's SSRM plane.
 *
 * The two models line up better than either was designed for. v2 moved group
 * expansion CLIENT-side: it asks for every group at every depth once
 * (`getGroupSkeleton`), then pages leaves under one group at a time
 * (`getLeafRows`), and expansion state never crosses the wire. The hub's
 * `watchGroups` computes exactly that tree — "aggregates for every group node
 * at every level, keyed by group path" — and then keeps it live by pushing
 * only the paths whose aggregate moved.
 *
 * The hub's own AG-Grid adapter does none of this: AG's server-side model is
 * index-based with server-held expansion, so it bridges `readWindow` +
 * `expandRow` and fabricates a root row to make the indices line up. v2 needs
 * no bridge.
 *
 * What this owns is the GENERATION. A skeleton is only valid for one
 * (sort, filter, groupBy) triple; when any of those change the engine's diff
 * restarts from empty, and anything remembered from before would linger as a
 * group the new query does not have.
 */
import { HubGroupSkeleton, type HubGroupDelta, type SkeletonGroupShape } from './groupSkeleton';

/** The slice of `SsrmWasmPlane` this adapter drives. Structural, so the
 *  adapter is testable against a fake and canvasgrid does not depend on the
 *  plane's nominal types. */
/** One engine-computed column, in the contract's wire form. */
export interface DshubComputedColumn {
  /** Result name — addressable by the same view's sort/filter/group. */
  as: string;
  version: number;
  expr: unknown;
}

export interface DshubPlaneLike {
  getRows(sessionId: string, providerId: string, req: {
    startRow?: number; endRow?: number;
    computedColumns?: readonly DshubComputedColumn[];
    rowGroupCols?: readonly { id: string }[];
    valueCols?: readonly { id: string; aggFunc?: string }[];
    groupKeys?: readonly unknown[];
    sortModel?: readonly { colId: string; sort: 'asc' | 'desc' }[];
    filterModel?: Record<string, unknown> | null;
  }): Promise<{ rowData: readonly Record<string, unknown>[]; rowCount: number }>;
  watchGroups(sessionId: string, providerId: string, req: {
    groupBy: readonly string[];
    aggregates?: Record<string, string>;
  }): Promise<void>;
  pollAllTicks(): Map<string, Array<{ kind?: string } & HubGroupDelta>>;
}

export interface DshubDatasourceOptions {
  plane: DshubPlaneLike;
  sessionId: string;
  providerId: string;
  /** colId -> aggregate name for the group rows. Absent columns are not
   *  aggregated; the engine still reports each group's leaf count. */
  aggregates?: Record<string, string>;
  /**
   * Engine-computed columns riding every view this datasource opens.
   *
   * The engine evaluates them per row and they are addressable by the same
   * request's sort/filter/group. An `agg` node inside one may reference
   * ANOTHER computed column, which is what makes a weighted average
   * expressible — `SUM(spread x dv01) / SUM(dv01)` is two of these, and a
   * closed set of aggregate functions cannot express it at all.
   */
  computedColumns?: readonly DshubComputedColumn[];
}

/** What a skeleton is valid for. Any change restarts the engine's diff. */
function generationOf(req: {
  sortModel?: unknown; filterModel?: unknown; rowGroupCols?: readonly string[];
}): string {
  return JSON.stringify([req.rowGroupCols ?? [], req.sortModel ?? [], req.filterModel ?? {}]);
}

export class DshubServerSideDatasource {
  readonly #plane: DshubPlaneLike;
  readonly #sessionId: string;
  readonly #providerId: string;
  readonly #aggregates: Record<string, string>;
  readonly #computed: readonly DshubComputedColumn[];
  #skeleton = new HubGroupSkeleton();
  #generation: string | null = null;

  constructor(opts: DshubDatasourceOptions) {
    this.#plane = opts.plane;
    this.#sessionId = opts.sessionId;
    this.#providerId = opts.providerId;
    this.#aggregates = opts.aggregates ?? {};
    this.#computed = opts.computedColumns ?? [];
  }

  /** Ungrouped windowing — v1 flat semantics, which v2 keeps as the fallback. */
  getRows(params: {
    request: { startRow: number; endRow: number; sortModel?: unknown; filterModel?: unknown };
    success(r: { rowData: unknown[]; rowCount?: number }): void;
    fail(): void;
  }): void {
    const { request } = params;
    void this.#plane.getRows(this.#sessionId, this.#providerId, {
      startRow: request.startRow,
      endRow: request.endRow,
      computedColumns: this.#computed,
      sortModel: request.sortModel as never,
      filterModel: request.filterModel as never,
    }).then(
      (page) => params.success({ rowData: [...page.rowData], rowCount: page.rowCount }),
      () => params.fail(),
    );
  }

  /**
   * Every group at every depth, for the current sort/filter/groupBy.
   *
   * Registers one watch per generation and folds what the engine pushes. The
   * first poll after a watch carries the whole tree — the engine emits a full
   * snapshot when the watch registers, and the plane delivers it (it used to
   * drop it, which made this return nothing over an already-populated table).
   * Later polls carry only what moved, which is why the fold accumulates.
   */
  getGroupSkeleton(params: {
    request: { sortModel?: unknown; filterModel?: unknown; rowGroupCols: string[] };
    success(r: { groups: SkeletonGroupShape[]; unfilteredRowCount?: number }): void;
    fail(): void;
  }): void {
    const { request } = params;
    const generation = generationOf(request);
    const isNew = generation !== this.#generation;
    if (isNew) {
      this.#skeleton = new HubGroupSkeleton();
      this.#generation = generation;
    }
    const ready = isNew
      ? this.#plane.watchGroups(this.#sessionId, this.#providerId, {
          groupBy: request.rowGroupCols,
          aggregates: this.#aggregates,
        })
      : Promise.resolve();

    void ready.then(
      () => {
        this.#drain();
        params.success({
          groups: this.#skeleton.skeleton(),
          unfilteredRowCount: this.#skeleton.topLevelLeafCount(),
        });
      },
      () => params.fail(),
    );
  }

  /** One deepest-level group's leaves. `groupPath` is raw values, which is
   *  what the plane's `groupKeys` takes. */
  getLeafRows(params: {
    request: {
      groupPath: string[]; startRow: number; endRow: number;
      sortModel?: unknown; filterModel?: unknown; rowGroupCols: string[];
    };
    success(r: { rowData: unknown[] }): void;
    fail(): void;
  }): void {
    const { request } = params;
    void this.#plane.getRows(this.#sessionId, this.#providerId, {
      startRow: request.startRow,
      endRow: request.endRow,
      rowGroupCols: request.rowGroupCols.map((id) => ({ id })),
      groupKeys: request.groupPath,
      computedColumns: this.#computed,
      sortModel: request.sortModel as never,
      filterModel: request.filterModel as never,
    }).then(
      (page) => params.success({ rowData: [...page.rowData] }),
      () => params.fail(),
    );
  }

  /**
   * Fold everything the engine has pushed since the last call.
   *
   * Public because a live feed keeps moving between skeleton requests: a host
   * driving ticks calls this and repaints, instead of waiting for the grid to
   * ask again. Returns whether anything changed.
   */
  drainTicks(): boolean {
    return this.#drain();
  }

  /** The tree as it currently stands, without asking the engine again. */
  currentSkeleton(): SkeletonGroupShape[] {
    return this.#skeleton.skeleton();
  }

  #drain(): boolean {
    const ticks = this.#plane.pollAllTicks().get(this.#providerId) ?? [];
    let moved = false;
    for (const t of ticks) {
      if (t.kind === 'groupDelta' && this.#skeleton.apply(t)) moved = true;
    }
    return moved;
  }
}
