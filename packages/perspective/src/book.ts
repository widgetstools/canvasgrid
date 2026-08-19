/**
 * Shared Perspective book for one DataProvider.
 *
 * - Owns the Perspective **Table** + STOMP/seed feed (one feeder per table)
 * - Hosts N **Views** (one per connected grid / StompPerspectiveProvider)
 * - Grids never access the table — only `getSsrmRows(viewId)` / skeleton APIs
 *
 * STOMP/seed → Table.update → Views → sparse SSRM getRows (windowed only).
 * Grouping / agg / filter / sort are per-View — never full hydrate.
 */
import type { FilterModel, SkeletonGroup, SortModel } from '@wellsfargo-starui/velocity-grid';
import { Client, type IMessage } from '@stomp/stompjs';
import {
  getPerspectiveWorkerMode,
  openOrCreatePositionsTable,
  POSITION_SCHEMA,
  SHARED_TABLE_NAME,
  tableNameForSchema,
  type PerspectiveTableSchema,
  type PositionRow,
  type Table,
  type View,
} from './bootstrap';
import { emptyGrandTotalRow } from './positionColumns';
import {
  buildCompositeGroupKey,
  materializeGroupedWindow as buildGroupedSsrmWindow,
  parseCompositeGroupKey,
} from './ssrmGroupTree';
import {
  distinctValuesFromRowPaths,
  type GroupedDistinctRow,
} from './distinctValues';
import { boundUpdateBuffer, updateBufferCap } from './updateBuffer';
import { resolveTableIndexField, rowIdentity } from './rowIdentity';

const SNAPSHOT_END_TOKEN = 'Success';

/** Perspective filter triple: [column, op, term]. */
export type {
  PspFilter,
  PspFilterTerm,
} from './cgridFilterToPsp';
import {
  cgridFilterToPsp,
  mapAggFuncToPerspective,
  QUICK_FILTER_HAYSTACK_ALIAS,
  type OrContainsMatcher,
  type PspFilter,
} from './cgridFilterToPsp';
export {
  cgridFilterToPsp,
  mapAggFuncToPerspective,
  QUICK_FILTER_HAYSTACK_ALIAS,
  OR_CONTAINS_ALIAS_PREFIX,
  buildOrContainsExpression,
  orContainsAlias,
} from './cgridFilterToPsp';

/** Default columns when a book is constructed without a DataProvider schema. */
const DEFAULT_DATA_COLUMNS = Object.keys(POSITION_SCHEMA);

function aggregatesFromSchema(schema: PerspectiveTableSchema): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, type] of Object.entries(schema)) {
    if (col === 'positionId') out[col] = 'count';
    else if (type === 'float' || type === 'integer') out[col] = 'sum';
    // Perspective group Views need an aggregate for every selected column.
    // Dimensions use `dominant` so fat DataProvider schemas still mount.
    else out[col] = 'dominant';
  }
  return out;
}

function measureColumnsFromSchema(schema: PerspectiveTableSchema): string[] {
  return Object.entries(schema)
    .filter(([col, type]) => col !== 'positionId' && (type === 'float' || type === 'integer'))
    .map(([col]) => col);
}

export interface SsrmRowsRequest {
  startRow: number;
  endRow: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  rowGroupCols: string[];
  expandedGroupKeys: string[];
  /** Optional column projection (+ expression outputs). */
  columnKeys?: string[];
}

export interface SsrmRowsResult {
  rows: PositionRow[];
  rowCount: number;
  groupKeys: string[];
}

/** Fired from a blotter's Perspective View `on_update` (conflated). */
export interface ViewTick {
  viewId: string;
  totals: PositionRow;
  /** Soft-refresh SSRM blocks after grouped View recomputes. */
  refreshSsrm: boolean;
  /** Leaf row patches for flat mode live ticks. */
  updates: PositionRow[];
}

export type BookPhase =
  | 'idle'
  | 'bootstrapping'
  | 'connecting'
  | 'snapshot'
  | 'live'
  | 'error'
  | 'disconnected';

export interface ViewSpec {
  id: string;
  label: string;
  filter?: PspFilter[];
}

export interface BookTelemetry {
  phase: BookPhase;
  bookSize: number;
  snapshotRowsLoaded: number;
  liveBatches: number;
  liveRowsIn: number;
  liveUpdatesPerSec: number;
  getRowsTotal: number;
  rowsServedTotal: number;
  viewCount: number;
  views: Array<{
    id: string;
    label: string;
    getRowsCalls: number;
    rowsServed: number;
    inflight: number;
    projectedRows: number;
  }>;
  wsUrl: string;
  engine: 'perspective';
  /** Phase 5 — 'shared' when the engine lives in the per-origin
   *  SharedWorker (cross-tab table), 'dedicated' on the fallback path. */
  workerMode: 'shared' | 'dedicated';
  /** Phase 5 — 'leader' feeds the table (seed ticks / STOMP); 'follower'
   *  tabs share the book read-only and take over if the leader closes. */
  feedRole: 'leader' | 'follower' | 'none';
}

export type BookFeed = 'stomp' | 'seed';

export interface PerspectiveBookOptions {
  feed?: BookFeed;
  wsUrl?: string;
  clientId?: string;
  snapshotRows?: number;
  rate?: number;
  batchSize?: number;
  updatesPerTick?: number;
  sparse?: boolean;
  /** STOMP listener topic the snapshot + live frames arrive on.
   *  Default `/snapshot/positions/{clientId}`. */
  snapshotTopic?: string;
  /** STOMP destination published to request the snapshot. Used VERBATIM
   *  when set; default `{snapshotTopic}/{rate}/{batchSize}`. */
  triggerTopic?: string;
  /** Exact frame body marking end-of-snapshot (a `{token}: ...` prefixed
   *  variant is also accepted). Default `'Success'`. */
  snapshotEndToken?: string;
  /** Unique-key field(s) in the STOMP payload rows. Single field or
   *  composite (`string[]`). Drives LWW coalescing, getRowId, and the
   *  Perspective table index column (see {@link resolveTableIndexField}).
   *  Default `'positionId'` for the curated positions schema. */
  keyColumn?: string | string[];
  /**
   * Perspective table schema — owned by the DataProvider catalog
   * (`columnDefinitions`). Defaults to {@link POSITION_SCHEMA}.
   */
  schema?: PerspectiveTableSchema;
  /**
   * Provider/connection identity (C-M6) — folded into the physical table
   * name + feed-lock name so two providers with an identical `schema` but
   * different brokers never share a table. See `tableNameForSchema` in
   * `bootstrap.ts`. Undefined preserves the fixed `positions-shared` name
   * for the no-catalog seed/demo case.
   */
  identity?: string;
  onTelemetry?: (t: BookTelemetry) => void;
  onPhase?: (phase: BookPhase) => void;
  onViewTick?: (tick: ViewTick) => void;
}

const SEED_DESKS = [
  'Securitized Products',
  'Rates Flow',
  'Credit Trading',
  'Equity Derivatives',
  'FX Spot',
] as const;
const SEED_REGIONS = ['AMER', 'EMEA', 'APAC'] as const;
const SEED_INSTRUMENTS = ['Bond', 'Swap', 'Future', 'Option', 'Equity'] as const;
const SEED_TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'JPM', 'GS', 'BAC'] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeedRow(i: number, rnd: () => number): PositionRow {
  const notional = Math.round(50_000 + rnd() * 5_000_000);
  const pnl = Math.round((rnd() - 0.45) * 250_000 * 100) / 100;
  return {
    positionId: `P${String(i).padStart(6, '0')}`,
    ticker: SEED_TICKERS[i % SEED_TICKERS.length]!,
    desk: SEED_DESKS[i % SEED_DESKS.length]!,
    region: SEED_REGIONS[i % SEED_REGIONS.length]!,
    instrumentType: SEED_INSTRUMENTS[i % SEED_INSTRUMENTS.length]!,
    notionalAmount: notional,
    marketValue: Math.round(notional * (0.9 + rnd() * 0.25)),
    pnl,
    dailyPnl: Math.round(pnl * 0.05 * 100) / 100,
  };
}

interface BoundView {
  spec: ViewSpec;
  view: View | null;
  totalsView: View | null;
  /** ONE persistent flat view sorted by [groupBy cols, user sort] — every
   *  deepest group's leaves are a CONTIGUOUS range in it, so leaf windows
   *  are offset reads instead of per-fetch view create/read/delete churn
   *  (the viewer-datagrid model). Null when ungrouped. */
  leafView: View | null;
  /** Deepest-group leaf ranges in leafView order (display order). Built
   *  alongside the skeleton dump; null until then / after invalidation. */
  leafRanges: Array<{ path: string[]; offset: number; count: number }> | null;
  /** JSON.stringify(path) → range index into `leafRanges`. */
  leafRangeByPath: Map<string, number> | null;
  /** Set when a contiguity spot-check failed (group ordering diverged
   *  between the grouped view and leafView, e.g. aggregate-sorted groups)
   *  — offset reads are skipped until the next remount. */
  leafOffsetsUnreliable: boolean;
  dataUpdateCb: number | null;
  notifyTimer: number | null;
  groupBy: string[];
  /** Raw Perspective grouped rows — invalidated on View `on_update`. */
  groupedRawCache: Record<string, unknown>[] | null;
  groupKeys: string[];
  lastQuerySig: string;
  getRowsCalls: number;
  rowsServed: number;
  inflight: number;
  projectedRows: number;
  /** Perspective ExprTK expressions — alias → source. Evaluated in WASM. */
  expressions: Record<string, string>;
  /**
   * Columns mounted on the flat data view / leafView (paint projection).
   * Grouped skeleton views always use the full schema + expression aliases.
   */
  readColumns: string[];
  /** Last filter/sort applied by syncQuery — used when remounting for expressions. */
  lastExtraFilter: PspFilter[];
  lastSort: Array<[string, 'asc' | 'desc']>;
  /** Title-bar / options quick-filter text (sparse SSRM — applied in Perspective). */
  quickFilterText: string;
  /** Ephemeral quick-filter haystack ExprTK (not user calculated columns). */
  quickFilterExpressions: Record<string, string>;
  /**
   * OR-contains matchers from the last filter conversion (alias → needles).
   * Live ticks evaluate these on raw feed rows (no ExprTK columns).
   */
  lastOrContains: Record<string, OrContainsMatcher>;
  /**
   * User value-column aggFunc overrides (colId → Perspective aggregate).
   * Merged over schema defaults on every grouped / totals remount.
   */
  valueAggOverrides: Record<string, string>;
}

/** Transpose Perspective columnar output into row objects. Keeps
 *  `__ROW_PATH__` (skeleton reads need it), drops `__ID__`. */
function columnsToRows(cols: Record<string, unknown[]>): Record<string, unknown>[] {
  const names = Object.keys(cols).filter((n) => n !== '__ID__');
  const first = names[0];
  const n = first !== undefined ? (cols[first]?.length ?? 0) : 0;
  const out: Record<string, unknown>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const name of names) row[name] = cols[name]![i];
    out[i] = row;
  }
  return out;
}

/** Windowed read via `to_columns_string` (columnar JSON string + ONE parse
 *  across the WASM boundary — viewer-datagrid's transport trick) with a
 *  `to_json` fallback for older clients. */
async function readRows(
  view: View,
  window?: { start_row?: number; end_row?: number },
): Promise<Record<string, unknown>[]> {
  const v = view as unknown as {
    to_columns_string?: (w?: object) => Promise<string>;
    to_json: (w?: object) => Promise<unknown[]>;
  };
  if (typeof v.to_columns_string === 'function') {
    const raw = await v.to_columns_string(window ?? {});
    return columnsToRows(JSON.parse(raw) as Record<string, unknown[]>);
  }
  return (await v.to_json(window)) as Record<string, unknown>[];
}

function rowHasField(row: PositionRow, col: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, col);
}

/**
 * Match a feed/tick row against Perspective filters.
 *
 * Live STOMP patches are partial — missing fields must NOT fail the gate
 * (that dropped every tick under an active filter and starved `rowsChanged`
 * / conditional-style flash). Only evaluate predicates for columns present
 * on the row; virtual ExprTK / OR-contains aliases are handled separately.
 */
function rowMatchesPspFilters(
  filters: PspFilter[],
  row: PositionRow,
  orContains: Record<string, OrContainsMatcher> = {},
): boolean {
  for (const [col, op, term] of filters) {
    // Haystack is virtual — evaluated via quickFilterText on the raw row.
    if (col === QUICK_FILTER_HAYSTACK_ALIAS) continue;
    const matcher = orContains[col];
    if (matcher) {
      // Partial tick without the source dimension — don't drop the patch.
      if (!rowHasField(row, matcher.colId)) continue;
      const s = String(row[matcher.colId as keyof PositionRow] ?? '').toLowerCase();
      const hit = matcher.needles.some((n) => n && s.includes(n.toLowerCase()));
      // Filter is `[alias, '==', true]` — fail when no needle matches.
      if (op === '==' && (term === true || term === 'true' || term === 1)) {
        if (!hit) return false;
        continue;
      }
      if (op === '==' && (term === false || term === 'false' || term === 0)) {
        if (hit) return false;
        continue;
      }
      continue;
    }
    // ExprTK alias / omitted patch field — Perspective View already filtered;
    // gating on undefined would drop every live tick.
    if (!rowHasField(row, col)) continue;
    const raw = row[col as keyof PositionRow];
    const s = String(raw ?? '').toLowerCase();
    if (op === 'contains') {
      const needle = String(term ?? '').toLowerCase();
      if (needle && !s.includes(needle)) return false;
      continue;
    }
    if (op === 'begins with') {
      const needle = String(term ?? '').toLowerCase();
      if (needle && !s.startsWith(needle)) return false;
      continue;
    }
    if (op === '==') {
      if (String(raw ?? '') !== String(term ?? '')) return false;
      continue;
    }
    if (op === '!=') {
      if (String(raw ?? '') === String(term ?? '')) return false;
      continue;
    }
    if (op === 'in') {
      const list = Array.isArray(term) ? term.map((v) => String(v)) : [String(term ?? '')];
      if (!list.includes(String(raw ?? ''))) return false;
      continue;
    }
    if (op === 'not in') {
      const list = Array.isArray(term) ? term.map((v) => String(v)) : [String(term ?? '')];
      if (list.includes(String(raw ?? ''))) return false;
      continue;
    }
    if (op === '>') {
      if (!(Number(raw) > Number(term))) return false;
      continue;
    }
    if (op === '>=') {
      if (!(Number(raw) >= Number(term))) return false;
      continue;
    }
    if (op === '<') {
      if (!(Number(raw) < Number(term))) return false;
      continue;
    }
    if (op === '<=') {
      if (!(Number(raw) <= Number(term))) return false;
      continue;
    }
    if (op === 'is null') {
      if (raw != null && raw !== '') return false;
      continue;
    }
    if (op === 'is not null') {
      if (raw == null || raw === '') return false;
      continue;
    }
  }
  return true;
}

function rowMatchesQuickFilter(
  text: string,
  row: PositionRow,
  columns: readonly string[],
): boolean {
  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  // Partial ticks often omit search dimensions — don't drop those patches.
  const present = columns.filter((c) => rowHasField(row, c));
  if (present.length === 0) return true;
  const haystack = present.map((c) => String(row[c as keyof PositionRow] ?? '')).join(' ').toLowerCase();
  // If the tick only carries a couple of fields, haystack is too thin to
  // decide QF membership — allow through (View filter already applied).
  if (present.length < Math.min(3, columns.length)) return true;
  return terms.every((t) => haystack.includes(t));
}

function rowMatchesViewFilter(
  spec: ViewSpec,
  row: PositionRow,
  opts?: {
    lastExtraFilter?: PspFilter[];
    quickFilterText?: string;
    dataColumns?: readonly string[];
    lastOrContains?: Record<string, OrContainsMatcher>;
  },
): boolean {
  const orContains = opts?.lastOrContains ?? {};
  if (!rowMatchesPspFilters(spec.filter ?? [], row, orContains)) return false;
  if (!rowMatchesPspFilters(opts?.lastExtraFilter ?? [], row, orContains)) return false;
  if (!rowMatchesQuickFilter(
    opts?.quickFilterText ?? '',
    row,
    opts?.dataColumns ?? [],
  )) return false;
  return true;
}

function extractRows(parsed: unknown): Partial<PositionRow>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Partial<PositionRow>[];
  }
  if (parsed && typeof parsed === 'object') return [parsed as Partial<PositionRow>];
  return [];
}

function cgridSortToPsp(sortModel: SortModel): Array<[string, 'asc' | 'desc']> {
  return sortModel.map((s) => [s.colId, s.direction] as [string, 'asc' | 'desc']);
}

function normalizeRowGroupCols(
  rowGroupCols: string[],
  dataColumns: readonly string[],
  expressionAliases: readonly string[] = [],
): string[] {
  const allowed = new Set(dataColumns);
  for (const alias of expressionAliases) allowed.add(alias);
  return rowGroupCols.filter((c) => allowed.has(c));
}

function rowGroupColsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

function stringListEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

function recordStringEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/** Ensure quick-filter / ExprTK aliases used in filters appear in View columns. */
function projectViewColumns(
  columns: readonly string[],
  expressions: Record<string, string>,
): string[] {
  const out = [...columns];
  for (const alias of Object.keys(expressions)) {
    if (!out.includes(alias)) out.push(alias);
  }
  return out;
}

/**
 * Columns for a Perspective data View: schema ∪ expression aliases,
 * optionally intersected with a fetch `columnKeys` window (always keeps
 * `positionId` and active group-by columns).
 */
export function resolvePerspectiveViewColumns(opts: {
  /** Schema / DataProvider columns (defaults to curated positions schema). */
  dataColumns?: readonly string[];
  expressions?: Record<string, string>;
  groupBy?: readonly string[];
  columnKeys?: readonly string[];
}): string[] {
  const exprAliases = Object.keys(opts.expressions ?? {});
  const all: string[] = [...(opts.dataColumns ?? DEFAULT_DATA_COLUMNS)];
  for (const alias of exprAliases) {
    if (!all.includes(alias)) all.push(alias);
  }
  const columnKeys = opts.columnKeys;
  if (!columnKeys || columnKeys.length === 0) return all;

  const allowed = new Set(all);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined): void => {
    if (!id || !allowed.has(id) || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  add('positionId');
  for (const g of opts.groupBy ?? []) add(g);
  for (const k of columnKeys) add(k);
  // Expression aliases always project — H-scroll windows / lean keys must
  // not drop ExprTK outputs needed by paint, rules, and alerts.
  for (const alias of exprAliases) add(alias);
  return out.length > 0 ? out : all;
}

/** Result of `Table.validate_expressions` (Perspective 4.x). */
export interface ExpressionValidationResult {
  expression_schema: Record<string, string>;
  errors: Record<string, string>;
}

export class PerspectiveBook {
  private readonly opts: Required<
    Pick<
      PerspectiveBookOptions,
      | 'feed'
      | 'wsUrl'
      | 'clientId'
      | 'snapshotRows'
      | 'rate'
      | 'batchSize'
      | 'updatesPerTick'
      | 'sparse'
      | 'snapshotEndToken'
      | 'keyColumn'
      | 'schema'
    >
  > &
    Pick<
      PerspectiveBookOptions,
      'onTelemetry' | 'onPhase' | 'onViewTick' | 'snapshotTopic' | 'triggerTopic' | 'identity'
    >;

  /** DataProvider-owned schema columns (Perspective table + view projection). */
  private readonly dataColumns: string[];
  private readonly valueAggregates: Record<string, string>;
  private readonly measureColumns: string[];

  private pendingLiveBatch: PositionRow[] = [];

  private phase: BookPhase = 'idle';
  private table: Table | null = null;
  private stomp: Client | null = null;
  private seedLiveTimer: number | null = null;
  private seedConnecting = false;
  private snapshotComplete = false;
  private updateBuffer: PositionRow[] = [];
  /** Single-flight drain — concurrent STOMP handlers only mark dirty. */
  private flushInFlight = false;
  private flushQueued = false;
  private pauseFanout = false;
  /** Explicit Diagnostics Stop — blocks reconnect / Web-Lock takeover until restartFeed. */
  private feedStopped = false;

  /** Phase 5 — set when `ensureTable` bound the cross-tab shared table. */
  private sharedTable = false;
  /** Phase 5 — this tab's role in the shared feed. */
  private feedRole: 'leader' | 'follower' | 'none' = 'none';
  /** Resolving this releases the Web Lock held while leading the feed. */
  private releaseFeedLock: (() => void) | null = null;
  private leadershipQueued = false;
  private destroyed = false;

  private snapshotRowsLoaded = 0;
  private liveBatches = 0;
  private liveRowsIn = 0;
  private liveWindow: Array<{ t: number; n: number }> = [];
  private getRowsTotal = 0;
  private rowsServedTotal = 0;

  private views = new Map<string, BoundView>();
  /** Serialize getSsrmRows per view — concurrent remounts hang Perspective WASM. */
  private getRowsChains = new Map<string, Promise<void>>();
  /** Serialize Perspective table mutations (shared across all Views). */
  private tableChain: Promise<void> = Promise.resolve();
  /** Last getSsrmRows debug snapshot per view (demo / tests). */
  lastGetRowsDebug = new Map<string, {
    requestedGroupBy: string[];
    boundGroupBy: string[];
    branch: 'flat' | 'grouped' | 'empty';
    rowCount: number;
    served: number;
  }>();
  private telemetryTimer: number | null = null;
  private flushTimer: number | null = null;

  constructor(options: PerspectiveBookOptions = {}) {
    const schema: Record<string, string> = { ...(options.schema ?? POSITION_SCHEMA) };
    const keyColumn = options.keyColumn ?? 'positionId';
    const indexField = resolveTableIndexField(keyColumn);
    if (!schema[indexField]) schema[indexField] = 'string';
    this.opts = {
      feed: options.feed ?? 'seed',
      wsUrl: options.wsUrl ?? 'ws://localhost:8081',
      clientId: options.clientId ?? `psp-${Math.floor(Math.random() * 1e6).toString(16)}`,
      snapshotRows: options.snapshotRows ?? 10_000,
      rate: options.rate ?? 40,
      batchSize: options.batchSize ?? 50,
      updatesPerTick: options.updatesPerTick ?? 5,
      sparse: options.sparse ?? true,
      snapshotTopic: options.snapshotTopic,
      triggerTopic: options.triggerTopic,
      snapshotEndToken: options.snapshotEndToken ?? SNAPSHOT_END_TOKEN,
      keyColumn,
      schema,
      identity: options.identity,
      onTelemetry: options.onTelemetry,
      onPhase: options.onPhase,
      onViewTick: options.onViewTick,
    };
    this.dataColumns = Object.keys(schema);
    this.valueAggregates = aggregatesFromSchema(schema);
    this.measureColumns = measureColumnsFromSchema(schema);
    // C-m10 — only start the 4Hz recompute when constructed with a handler
    // (preserves direct-construction callers, e.g. cgrid-ssrm-demo, which
    // pass `onTelemetry` once and expect it to just run). `provider.ts`'s
    // shared-book path always passes a fan-out `onTelemetry` regardless of
    // real demand, so it immediately follows up with `setTelemetryActive`
    // reflecting the true `entry.telemetryHandlers` count — synchronously,
    // before this timer's first tick, so no wasted work ever runs.
    if (options.onTelemetry) {
      this.telemetryTimer = window.setInterval(() => this.emitTelemetry(), 250);
    }
  }

  /** Runs (or stops) the 4Hz telemetry recompute — active only while at
   *  least one consumer wants it (C-m10). Idempotent. */
  setTelemetryActive(active: boolean): void {
    if (active) {
      if (this.telemetryTimer === null && !this.destroyed) {
        this.telemetryTimer = window.setInterval(() => this.emitTelemetry(), 250);
      }
    } else if (this.telemetryTimer !== null) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
  }

  getPhase(): BookPhase {
    return this.phase;
  }

  isFanoutPaused(): boolean {
    return this.pauseFanout;
  }

  setPauseFanout(paused: boolean): void {
    this.pauseFanout = paused;
    if (!paused) void this.flushUpdates();
    this.emitTelemetry();
  }

  /** Diagnostics / authoring Stop — disconnect STOMP/seed and refuse takeover. */
  stopFeed(): void {
    this.feedStopped = true;
    this.pauseFanout = true;
    this.disconnect();
    this.emitTelemetry();
  }

  /** Diagnostics Restart — clear the stop latch and reconnect the feed. */
  restartFeed(): void {
    this.feedStopped = false;
    this.pauseFanout = false;
    this.connect();
    this.emitTelemetry();
  }

  isFeedStopped(): boolean {
    return this.feedStopped;
  }

  setKnobs(partial: Partial<{ snapshotRows: number; rate: number; batchSize: number; updatesPerTick: number; wsUrl: string }>): void {
    if (partial.snapshotRows !== undefined) this.opts.snapshotRows = partial.snapshotRows;
    if (partial.rate !== undefined) this.opts.rate = partial.rate;
    if (partial.batchSize !== undefined) this.opts.batchSize = partial.batchSize;
    if (partial.updatesPerTick !== undefined) this.opts.updatesPerTick = partial.updatesPerTick;
    if (partial.wsUrl !== undefined) this.opts.wsUrl = partial.wsUrl;
    this.emitTelemetry();
  }

  async ensureTable(): Promise<Table> {
    if (this.table) return this.table;
    this.setPhase('bootstrapping');
    // Phase 5 — under the SharedWorker engine every tab binds ONE fixed
    // table name (attach if another tab already created it). Dedicated
    // fallback keeps the per-client name so parallel dedicated pages
    // can't collide.
    const { table, attached } = await openOrCreatePositionsTable(
      SHARED_TABLE_NAME,
      this.opts.schema,
      this.opts.identity,
      this.tableIndexField(),
    );
    if (getPerspectiveWorkerMode() === 'shared') {
      this.table = table;
      this.sharedTable = true;
      void attached;
    } else {
      // openOrCreate on the dedicated engine just created 'positions-shared'
      // locally — fine to use directly (nothing else shares this engine).
      this.table = table;
      this.sharedTable = false;
    }
    this.setPhase('idle');
    return this.table;
  }

  /** Perspective `table({ index })` column derived from keyColumn. */
  private tableIndexField(): string {
    return resolveTableIndexField(this.opts.keyColumn);
  }

  // ─── Phase 5: feed leadership (Web Locks; one feeder per table) ─────

  /** One leader per physical Perspective table (schema + identity scoped
   *  name — C-M6: distinct providers never share a leader lock). */
  private feedLockName(): string {
    return `cgrid-ssrm:feed:${tableNameForSchema(this.opts.schema, this.opts.identity)}`;
  }

  private hasWebLocks(): boolean {
    return typeof navigator !== 'undefined' && 'locks' in navigator;
  }

  /** Race for immediate leadership (`ifAvailable`); winner HOLDS the lock
   *  until `releaseLeadership`. Resolves won/lost without blocking. */
  private tryLeadFeed(): Promise<boolean> {
    if (!this.sharedTable || !this.hasWebLocks()) {
      this.feedRole = 'leader';
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolveWon) => {
      void navigator.locks.request(
        this.feedLockName(),
        { ifAvailable: true },
        async (lock) => {
          if (lock === null || this.destroyed) {
            resolveWon(false);
            return;
          }
          this.feedRole = 'leader';
          resolveWon(true);
          await new Promise<void>((release) => { this.releaseFeedLock = release; });
        },
      );
    });
  }

  /** Queue for takeover: when the current leader's tab closes, the lock
   *  releases and this tab starts feeding the (already-populated) book. */
  private queueFeedTakeover(): void {
    if (!this.sharedTable || !this.hasWebLocks() || this.leadershipQueued) return;
    if (this.feedStopped) return;
    this.leadershipQueued = true;
    this.feedRole = 'follower';
    this.emitTelemetry();
    void navigator.locks.request(this.feedLockName(), async () => {
      if (this.destroyed || this.feedStopped) return;
      this.feedRole = 'leader';
      this.emitTelemetry();
      // Book is live already (we adopted the snapshot) — just start feeding.
      if (this.opts.feed === 'seed') this.startSeedLive();
      else this.activateStomp();
      await new Promise<void>((release) => { this.releaseFeedLock = release; });
    });
  }

  private releaseLeadership(): void {
    this.leadershipQueued = false;
    if (this.releaseFeedLock) {
      this.releaseFeedLock();
      this.releaseFeedLock = null;
    }
    if (this.feedRole === 'leader') this.feedRole = 'none';
  }

  private async sharedTableSize(): Promise<number> {
    try {
      return Number(await this.withTableLock(() => this.table!.size()));
    } catch {
      return 0;
    }
  }

  /** Follower boot: the leader owns the snapshot — poll until rows exist
   *  (or give up and seed ourselves; keyed updates make that benign). */
  private async waitForSharedSnapshot(timeoutMs = 30_000): Promise<number> {
    const start = Date.now();
    for (;;) {
      const size = await this.sharedTableSize();
      if (size > 0 || Date.now() - start > timeoutMs || this.destroyed) return size;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Adopt an already-populated shared book: no snapshot work, straight
   *  to live; the leader's `table.update` ticks reach our views via the
   *  shared engine's realtime poll. */
  private async adoptSharedLive(size: number): Promise<void> {
    this.snapshotComplete = true;
    this.snapshotRowsLoaded = size;
    this.setPhase('live');
    for (const id of this.views.keys()) void this.refreshProjected(id);
    this.emitTelemetry();
  }

  async registerView(spec: ViewSpec): Promise<View> {
    await this.ensureTable();
    await this.unregisterView(spec.id);
    const bound = await this.mountViews(spec, [], []);
    this.views.set(spec.id, bound);
    void this.refreshProjected(spec.id);
    this.emitTelemetry();
    return bound.view!;
  }

  getView(viewId: string): View | null {
    return this.views.get(viewId)?.view ?? null;
  }

  getGroupKeys(viewId: string): string[] {
    return this.views.get(viewId)?.groupKeys ?? [];
  }

  /**
   * Apply row-group columns to this blotter's View and remount immediately.
   * The kernel's `rowGroupCols` is authoritative — clearing groups must
   * drop Perspective `group_by` right away so flat getRows cannot read a
   * stale aggregated view (8 desk totals with an empty group panel).
   */
  async setViewGroupBy(viewId: string, rowGroupCols: string[]): Promise<void> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound) return;
      const next = normalizeRowGroupCols(
        rowGroupCols,
        this.dataColumns,
        Object.keys(bound.expressions),
      );
      if (rowGroupColsEqual(next, bound.groupBy)) return;
      bound.groupBy = next;
      bound.groupedRawCache = null;
      bound.groupKeys = [];
      bound.leafRanges = null;
      bound.leafRangeByPath = null;
      bound.leafOffsetsUnreliable = false;
      // Force syncQuery/remount even when sort/filter are unchanged.
      bound.lastQuerySig = '';
      await this.withTableLock(() =>
        this.remountDataView(bound, bound.lastExtraFilter, bound.lastSort),
      );
    });
  }

  /** Current ExprTK expression map for a blotter view. */
  getViewExpressions(viewId: string): Record<string, string> {
    return { ...(this.views.get(viewId)?.expressions ?? {}) };
  }

  /**
   * Replace Perspective `ViewConfig.expressions` for a view, remount under
   * the table lock, and force-union aliases into `readColumns` so leaf /
   * flat Views always project calculated outputs (rules + format need them).
   */
  async setViewExpressions(
    viewId: string,
    expressions: Record<string, string>,
  ): Promise<void> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound) return;
      bound.expressions = { ...expressions };
      // Start from the full schema paint window, then ensure every alias
      // is present — intersecting with the prior H-scroll window dropped
      // new calculated columns from the View `columns` list.
      const base = this.resolveViewColumns(bound, undefined);
      const seen = new Set(base);
      for (const alias of Object.keys(expressions)) {
        if (!seen.has(alias)) {
          seen.add(alias);
          base.push(alias);
        }
      }
      bound.readColumns = base;
      bound.groupedRawCache = null;
      bound.lastQuerySig = '';
      await this.withTableLock(() =>
        this.remountDataView(bound, bound.lastExtraFilter, bound.lastSort),
      );
    });
  }

  /**
   * Validate ExprTK expressions against the shared table schema without
   * remounting views. Returns Perspective's `expression_schema` + `errors`.
   */
  async validateExpressions(
    expressions: Record<string, string>,
  ): Promise<ExpressionValidationResult> {
    await this.ensureTable();
    const table = this.table as Table & {
      validate_expressions: (e: Record<string, string>) => Promise<ExpressionValidationResult>;
    };
    return this.withTableLock(() => table.validate_expressions(expressions));
  }

  private resolveViewColumns(
    bound: BoundView,
    columnKeys?: readonly string[],
  ): string[] {
    return resolvePerspectiveViewColumns({
      dataColumns: this.dataColumns,
      expressions: bound.expressions,
      groupBy: bound.groupBy,
      columnKeys,
    });
  }

  /** Lean column set for the grouped skeleton View (not the leaf paint View). */
  private skeletonViewColumns(bound: BoundView): string[] {
    const cols: string[] = ['positionId'];
    const seen = new Set(cols);
    const add = (id: string | undefined): void => {
      if (!id || seen.has(id) || !this.dataColumns.includes(id)) return;
      seen.add(id);
      cols.push(id);
    };
    for (const g of bound.groupBy) add(g);
    for (const m of this.measureColumns) add(m);
    for (const alias of Object.keys(bound.expressions)) {
      if (!seen.has(alias)) {
        seen.add(alias);
        cols.push(alias);
      }
    }
    return cols;
  }

  /** Serialize per-view Perspective work — concurrent remounts hang WASM. */
  private async withViewChain<T>(viewId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.getRowsChains.get(viewId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.getRowsChains.set(viewId, prev.then(() => gate, () => gate));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Sparse SSRM v1 row window — flat or grouped (Perspective owns compute). */
  async getSsrmRows(viewId: string, req: SsrmRowsRequest): Promise<SsrmRowsResult> {
    return this.withViewChain(viewId, () => this.getSsrmRowsInner(viewId, req));
  }

  // ─── SSRM v2 skeleton contract (kernel owns the tree shape) ────────────

  /** Every group row (all depths) for the current query — the kernel builds
   *  the flatten index; expansion state never reaches Perspective. */
  async getGroupSkeleton(
    viewId: string,
    req: { sortModel: SortModel; filterModel: FilterModel; rowGroupCols: string[] },
  ): Promise<SkeletonGroup[]> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view) return [];
      // Kernel rowGroupCols is authoritative (including empty = ungroup).
      await this.syncQuery(
        bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols, true,
      );
      if (bound.groupBy.length === 0) return [];
      // Live ticks must see fresh aggregates — never serve a stale dump.
      bound.groupedRawCache = null;
      const raw = await this.getGroupedRaw(bound);
      const groups: SkeletonGroup[] = [];
      for (const row of raw) {
        const path = row.__ROW_PATH__;
        if (!Array.isArray(path) || path.length > bound.groupBy.length) {
          continue;
        }
        const aggregates: Record<string, unknown> = {};
        for (const col of this.measureColumns) {
          if (row[col] !== undefined) aggregates[col] = row[col];
        }
        // Also surface any other numeric fields Perspective returned so
        // Infer Fields measure columns tick even when schema typing is loose.
        for (const [k, v] of Object.entries(row)) {
          if (k === 'positionId' || k === '__ROW_PATH__' || k in aggregates) continue;
          if (typeof v === 'number' && Number.isFinite(v)) aggregates[k] = v;
        }
        // `path: []` is Perspective's root aggregate row — the kernel reads
        // it as the grand total (pinned totals row / grand-total footer).
        groups.push({
          path: path.map((v) => String(v ?? '')),
          // Perspective `count` aggregate on positionId = leaves in subtree.
          leafCount: path.length === 0 ? 0 : Math.max(0, Number(row.positionId ?? 0) | 0),
          aggregates,
        });
      }
      return groups;
    });
  }

  /** Leaf window under one deepest-level group, addressed by raw path. */
  async getLeafRows(
    viewId: string,
    req: {
      groupPath: string[];
      startRow: number;
      endRow: number;
      sortModel: SortModel;
      filterModel: FilterModel;
      rowGroupCols: string[];
      columnKeys?: string[];
    },
  ): Promise<PositionRow[]> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view) return [];
      const { extraFilter, sort } = await this.syncQuery(
        bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols, true,
      );
      await this.ensureReadColumns(bound, req.columnKeys, extraFilter, sort);
      return this.fetchLeafWindowByPath(
        bound, req.groupPath, req.startRow, req.endRow, extraFilter, sort,
      );
    });
  }

  /** Flat (ungrouped) window for the v2 `getRows` fallback. Carries the
   *  totalsView's root aggregates so the kernel's pinned grand total works
   *  without a skeleton. */
  async getFlatRows(
    viewId: string,
    req: {
      startRow: number;
      endRow: number;
      sortModel: SortModel;
      filterModel: FilterModel;
      columnKeys?: string[];
    },
  ): Promise<{ rows: PositionRow[]; rowCount: number; grandTotals?: Record<string, unknown> }> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view) return { rows: [], rowCount: 0 };
      const { extraFilter, sort } = await this.syncQuery(
        bound, viewId, req.sortModel, req.filterModel, [], true,
      );
      await this.ensureReadColumns(bound, req.columnKeys, extraFilter, sort);
      // count + read under one lock — see fetchLeafWindowByPath.
      return this.withTableLock(async () => {
        const rowCount = Math.max(0, Number(await bound.view!.num_rows()));
        let grandTotals: Record<string, unknown> | undefined;
        if (bound.totalsView) {
          try {
            const json = (await bound.totalsView.to_json({ start_row: 0, end_row: 1 })) as Record<string, unknown>[];
            const row = json[0];
            if (row) {
              const { __ROW_PATH__: _p, ...rest } = row as Record<string, unknown> & { __ROW_PATH__?: unknown };
              grandTotals = rest;
            }
          } catch { /* omit totals */ }
        }
        const start = Math.max(0, req.startRow | 0);
        const end = Math.max(start, Math.min(req.endRow | 0, rowCount));
        if (end <= start || rowCount === 0) return { rows: [], rowCount, grandTotals };
        const rows = (await readRows(bound.view!, { start_row: start, end_row: end })) as PositionRow[];
        return { rows, rowCount, grandTotals };
      });
    });
  }

  /** SSRM v2 — every descendant leaf row-id under one group (any depth).
   *  Powers the group-checkbox selection cascade on the sparse path. */
  async getGroupLeafIds(
    viewId: string,
    req: {
      groupPath: string[];
      sortModel: SortModel;
      filterModel: FilterModel;
      rowGroupCols: string[];
    },
  ): Promise<string[]> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view || !this.table) return [];
      const { extraFilter } = await this.syncQuery(
        bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols, true,
      );
      if (req.groupPath.length === 0 || req.groupPath.length > bound.groupBy.length) return [];
      // Fast path — descendant leaves of ANY-depth group are a contiguous
      // run of deepest-group ranges (display order), so ids are one offset
      // window on the persistent leafView.
      if (bound.leafView !== null && !bound.leafOffsetsUnreliable) {
        if (bound.leafRangeByPath === null) await this.getGroupedRaw(bound);
        const ranges = bound.leafRanges;
        if (ranges !== null) {
          const prefix = req.groupPath;
          let startOff = -1;
          let endOff = -1;
          for (const r of ranges) {
            const matches = prefix.every((v, i) => r.path[i] === v);
            if (matches) {
              if (startOff < 0) startOff = r.offset;
              endOff = r.offset + r.count;
            } else if (startOff >= 0) {
              break; // contiguous run ended
            }
          }
          if (startOff >= 0 && endOff > startOff) {
            const rows = await this.withTableLock(
              () => readRows(bound.leafView!, { start_row: startOff, end_row: endOff }),
            );
            // Same contiguity spot-check as fetchLeafWindowByPath — the
            // first row of the window must belong to the requested group
            // path, else offsets are stale and the selection cascade would
            // collect the WRONG ids. On mismatch fall through to the
            // filtered-view path below.
            const first = rows[0] as Record<string, unknown> | undefined;
            const contiguous = first === undefined || prefix.every(
              (v, i) => String(first[bound.groupBy[i]!] ?? '') === v,
            );
            if (contiguous) {
              return rows
                .map((r) => String((r as { positionId?: unknown }).positionId ?? ''))
                .filter((s) => s !== '');
            }
            if (!this.warnedLeafOffsetMismatch) {
              this.warnedLeafOffsetMismatch = true;
              console.warn(
                '[PerspectiveBook] leaf offset window mismatched its group — grouped-view ordering '
                + 'diverges from the leaf sort; falling back to filtered leaf reads until remount.',
              );
            }
            bound.leafOffsetsUnreliable = true;
          } else {
            return [];
          }
        }
      }
      const groupFilter: PspFilter[] = req.groupPath.map(
        (v, i) => [bound.groupBy[i]!, '==', v],
      );
      const filter = [...(bound.spec.filter ?? []), ...extraFilter, ...groupFilter];
      return this.withTableLock(async () => {
        const idView = await this.table!.view({ columns: ['positionId'], filter } as never);
        try {
          const json = (await idView.to_json()) as Array<{ positionId?: unknown }>;
          return json
            .map((r) => String(r.positionId ?? ''))
            .filter((s) => s !== '');
        } finally {
          try { await idView.delete(); } catch { /* swallow */ }
        }
      });
    });
  }

  private async withTableLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tableChain;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.tableChain = prev.then(() => gate, () => gate);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Sync the bound Perspective view to the requested query (sort / filter /
   * groupBy), remounting when the signature changes. `trustEmptyGroupBy`
   * (v2 flat path) skips the v1 race guard that resurrects a stale
   * `bound.groupBy` when the request carries no group columns.
   */
  private async syncQuery(
    bound: BoundView,
    viewId: string,
    sortModel: SortModel,
    filterModel: FilterModel,
    rowGroupCols: string[],
    trustEmptyGroupBy = false,
  ): Promise<{ extraFilter: PspFilter[]; sort: Array<[string, 'asc' | 'desc']> }> {
    const converted = cgridFilterToPsp(filterModel, {
      quickFilterText: bound.quickFilterText,
      quickFilterColumns: this.dataColumns,
    });
    const extraFilter = converted.filters;
    bound.quickFilterExpressions = converted.expressions;
    bound.lastOrContains = converted.orContains;
    const sort = cgridSortToPsp(sortModel);
    let requestedGroupBy = normalizeRowGroupCols(
      rowGroupCols,
      this.dataColumns,
      Object.keys(bound.expressions),
    );
    // Race: columnRowGroupChanged may set bound.groupBy before SSRM ships cols.
    if (!trustEmptyGroupBy && requestedGroupBy.length === 0 && bound.groupBy.length > 0) {
      requestedGroupBy = bound.groupBy;
    }
    if (!rowGroupColsEqual(requestedGroupBy, bound.groupBy)) {
      bound.groupBy = requestedGroupBy;
      bound.groupedRawCache = null;
      bound.groupKeys = [];
    }
    const querySig = JSON.stringify({
      sort: sortModel,
      filter: filterModel,
      quickFilterText: bound.quickFilterText,
      groupBy: bound.groupBy,
      valueAggOverrides: bound.valueAggOverrides,
    });
    if (querySig !== bound.lastQuerySig) {
      bound.lastQuerySig = querySig;
      bound.lastExtraFilter = extraFilter;
      bound.lastSort = sort;
      await this.withTableLock(() => this.remountDataView(bound, extraFilter, sort));
      void this.refreshProjected(viewId);
    } else {
      bound.lastExtraFilter = extraFilter;
      bound.lastSort = sort;
    }
    return { extraFilter, sort };
  }

  /**
   * Count leaf rows matching a cgrid FilterModel against the full table.
   * Used by saved-filter pill badges on sparse SSRM (hydrate mirrors are
   * viewport-sized and under-count badly).
   */
  async countMatchingFilterModel(filterModel: FilterModel): Promise<number> {
    if (!this.table) return 0;
    const converted = cgridFilterToPsp(filterModel ?? {});
    const { filters, expressions } = converted;
    return this.withTableLock(async () => {
      const view = await this.table!.view({
        columns: projectViewColumns(['positionId'], expressions),
        ...(filters.length > 0 ? { filter: filters } : {}),
        ...(Object.keys(expressions).length > 0 ? { expressions } : {}),
      } as never);
      try {
        return Math.max(0, Number(await view.num_rows()) | 0);
      } finally {
        try { await view.delete(); } catch { /* swallow */ }
      }
    });
  }

  /**
   * Distinct string values for `colId` from the shared table (group_by).
   * Used by sparse SSRM set-filter popups — the worker store only holds
   * hydrated windows and cannot enumerate the full book.
   *
   * **Never** reads `row[colId]` on the grouped View — that field is an
   * aggregate (leaf `count`) and must not populate set filters. Values
   * come only from `__ROW_PATH__` via {@link distinctValuesFromRowPaths}.
   */
  async getDistinctColumnValues(colId: string, limit?: number): Promise<string[]> {
    if (!this.table) return [];
    if (!this.dataColumns.includes(colId) && colId !== 'positionId') return [];
    return this.withTableLock(async () => {
      // group_by yields path keys. Project a throwaway measure so the View
      // is valid — set-filter values still come ONLY from `__ROW_PATH__`
      // (never from aggregate fields like count on `colId`).
      const measureCol = this.dataColumns.includes('positionId')
        ? 'positionId'
        : (this.dataColumns.find((c) => c !== colId) ?? colId);
      const view = await this.table!.view({
        group_by: [colId],
        columns: [measureCol],
        aggregates: { [measureCol]: 'count' },
      } as never);
      try {
        const cap = limit != null && limit > 0 ? Math.min(limit, 10_000) : 5_000;
        const rows = (await view.to_json({
          start_row: 0,
          end_row: cap + 1,
        })) as GroupedDistinctRow[];
        return distinctValuesFromRowPaths(rows, cap);
      } finally {
        try { await view.delete(); } catch { /* swallow */ }
      }
    });
  }

  /**
   * Apply grid value-column aggFuncs onto this blotter's Perspective View.
   * Schema defaults remain for every other column; listed cols override.
   * Remounts immediately when the override map changes.
   */
  async setViewValueAggregates(
    viewId: string,
    valueColumns: ReadonlyArray<{ colId: string; aggFunc: string }>,
  ): Promise<boolean> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound) return false;
      const next: Record<string, string> = {};
      for (const { colId, aggFunc } of valueColumns) {
        if (!colId) continue;
        next[colId] = mapAggFuncToPerspective(aggFunc);
      }
      if (recordStringEqual(next, bound.valueAggOverrides)) return false;
      bound.valueAggOverrides = next;
      bound.lastQuerySig = '';
      await this.withTableLock(() =>
        this.remountDataView(bound, bound.lastExtraFilter, bound.lastSort),
      );
      return true;
    });
  }

  /** Schema defaults merged with per-view value-column overrides. */
  private resolveAggregates(bound: BoundView): Record<string, string> {
    return { ...this.valueAggregates, ...bound.valueAggOverrides };
  }

  /**
   * Title-bar quick filter — stored on the View and applied on the next
   * remount / getRows (sparse SSRM cannot use the worker QuickFilterPass).
   */
  setViewQuickFilterText(viewId: string, text: string): void {
    const bound = this.views.get(viewId);
    if (!bound) return;
    const next = text ?? '';
    if (bound.quickFilterText === next) return;
    bound.quickFilterText = next;
    bound.lastQuerySig = '';
  }

  /** Remount flat/leaf views when the paint column window changes. */
  private async ensureReadColumns(
    bound: BoundView,
    columnKeys: readonly string[] | undefined,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<void> {
    const next = this.resolveViewColumns(bound, columnKeys);
    if (stringListEqual(next, bound.readColumns)) return;
    bound.readColumns = next;
    await this.withTableLock(() => this.remountDataView(bound, extraFilter, sort));
  }

  private async getSsrmRowsInner(viewId: string, req: SsrmRowsRequest): Promise<SsrmRowsResult> {
    const bound = this.views.get(viewId);
    if (!bound?.view) {
      return { rows: [], rowCount: 0, groupKeys: [] };
    }

    const requestedGroupBy = normalizeRowGroupCols(
      req.rowGroupCols,
      this.dataColumns,
      Object.keys(bound.expressions),
    );
    const { extraFilter, sort } = await this.syncQuery(
      bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols,
      /* trustEmptyGroupBy */ true,
    );
    await this.ensureReadColumns(bound, req.columnKeys, extraFilter, sort);

    if (bound.groupBy.length === 0) {
      const rowCount = Math.max(0, Number(
        await this.withTableLock(() => bound.view!.num_rows()),
      ));
      const start = Math.max(0, req.startRow | 0);
      const end = Math.max(start, Math.min(req.endRow | 0, rowCount));
      if (end <= start || rowCount === 0) {
        this.lastGetRowsDebug.set(viewId, {
          requestedGroupBy: [...requestedGroupBy],
          boundGroupBy: [...bound.groupBy],
          branch: 'empty',
          rowCount,
          served: 0,
        });
        return { rows: [], rowCount, groupKeys: [] };
      }
      const json = (await this.withTableLock(
        () => readRows(bound.view!, { start_row: start, end_row: end }),
      )) as PositionRow[];
      this.lastGetRowsDebug.set(viewId, {
        requestedGroupBy: [...requestedGroupBy],
        boundGroupBy: [...bound.groupBy],
        branch: 'flat',
        rowCount,
        served: json.length,
      });
      return { rows: json, rowCount, groupKeys: [] };
    }

    const start = Math.max(0, req.startRow | 0);
    const end = Math.max(start, req.endRow | 0);
    const { rows, rowCount } = await this.materializeGroupedWindow(
      bound,
      req.expandedGroupKeys,
      extraFilter,
      sort,
      start,
      end,
    );
    this.lastGetRowsDebug.set(viewId, {
      requestedGroupBy: [...requestedGroupBy],
      boundGroupBy: [...bound.groupBy],
      branch: 'grouped',
      rowCount,
      served: rows.length,
    });
    return {
      rows,
      rowCount,
      groupKeys: bound.groupKeys,
    };
  }

  async fetchGrandTotal(viewId: string): Promise<PositionRow> {
    // Serialize behind the view chain so a concurrent syncQuery remount
    // can't hand us a deleted totalsView mid-read.
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.totalsView) return emptyGrandTotalRow();
      try {
        const json = await this.withTableLock(
          () => bound.totalsView!.to_json({ start_row: 0, end_row: 1 }) as Promise<Record<string, unknown>[]>,
        );
        const row = json[0];
        if (!row) return emptyGrandTotalRow();
        const { __ROW_PATH__: _path, ...totals } = row as Record<string, unknown> & {
          __ROW_PATH__?: unknown;
        };
        return { ...emptyGrandTotalRow(), ...totals } as PositionRow;
      } catch {
        return emptyGrandTotalRow();
      }
    });
  }

  private async materializeGroupedWindow(
    bound: BoundView,
    expandedGroupKeys: readonly string[],
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
    startRow: number,
    endRow: number,
  ): Promise<{ rows: PositionRow[]; rowCount: number }> {
    const raw = await this.getGroupedRaw(bound);
    return buildGroupedSsrmWindow(
      raw,
      {
        rowGroupCols: bound.groupBy,
        expandedGroupKeys,
        includeGrandTotal: false,
        includeGroupFooter: false,
      },
      startRow,
      endRow,
      (groupKey, leafStart, leafEnd) =>
        this.fetchLeafWindow(bound, groupKey, leafStart, leafEnd, extraFilter, sort),
    );
  }

  /** v1 shim — composite key → raw path, then the path-based fetch. */
  private async fetchLeafWindow(
    bound: BoundView,
    groupKey: string,
    leafStart: number,
    leafEnd: number,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<PositionRow[]> {
    const segments = parseCompositeGroupKey(groupKey);
    return this.fetchLeafWindowByPath(
      bound, segments.map((s) => s.value), leafStart, leafEnd, extraFilter, sort,
    );
  }

  private warnedLeafOffsetMismatch = false;

  /** Windowed leaf rows for one fully-expanded deepest group.
   *
   *  Fast path (engine-local unification, 2026-07-23): an OFFSET window on
   *  the persistent sorted `leafView` — zero view churn, one read. A
   *  spot-check verifies the first row actually belongs to the group; on
   *  mismatch (group ordering diverged between the grouped view and the
   *  leaf sort, e.g. aggregate-ordered groups) offsets are disabled until
   *  the next remount and the filtered per-fetch path serves instead. */
  private async fetchLeafWindowByPath(
    bound: BoundView,
    groupPath: readonly string[],
    leafStart: number,
    leafEnd: number,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<PositionRow[]> {
    if (!this.table || leafEnd <= leafStart) return [];
    if (groupPath.length !== bound.groupBy.length) return [];

    if (bound.leafView !== null && !bound.leafOffsetsUnreliable) {
      if (bound.leafRangeByPath === null) await this.getGroupedRaw(bound);
      const idx = bound.leafRangeByPath?.get(JSON.stringify([...groupPath]));
      if (idx !== undefined) {
        const range = bound.leafRanges![idx]!;
        const start = range.offset + Math.max(0, leafStart);
        const end = range.offset + Math.min(range.count, leafEnd);
        if (end <= start) return [];
        const rows = (await this.withTableLock(
          () => readRows(bound.leafView!, { start_row: start, end_row: end }),
        )) as PositionRow[];
        const first = rows[0] as Record<string, unknown> | undefined;
        const contiguous = first === undefined || bound.groupBy.every(
          (colId, i) => String(first[colId] ?? '') === groupPath[i],
        );
        if (contiguous) return rows;
        if (!this.warnedLeafOffsetMismatch) {
          this.warnedLeafOffsetMismatch = true;
          console.warn(
            '[PerspectiveBook] leaf offset window mismatched its group — grouped-view ordering '
            + 'diverges from the leaf sort; falling back to filtered leaf reads until remount.',
          );
        }
        bound.leafOffsetsUnreliable = true;
      }
    }
    return this.fetchLeafWindowByFilter(bound, groupPath, leafStart, leafEnd, extraFilter, sort);
  }

  /** Fallback — filtered per-fetch view (create → read → delete). */
  private async fetchLeafWindowByFilter(
    bound: BoundView,
    groupPath: readonly string[],
    leafStart: number,
    leafEnd: number,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<PositionRow[]> {
    const groupFilter: PspFilter[] = bound.groupBy.map(
      (colId, i) => [colId, '==', groupPath[i] ?? ''],
    );
    const filter = [...(bound.spec.filter ?? []), ...extraFilter, ...groupFilter];
    const exprs = { ...bound.expressions, ...bound.quickFilterExpressions };
    const columns = projectViewColumns([...bound.readColumns], exprs);
    const config: Record<string, unknown> = {
      columns,
      filter,
    };
    if (Object.keys(exprs).length > 0) {
      config.expressions = exprs;
    }
    if (sort.length > 0) config.sort = sort;

    // ONE lock hold for create → count → read → delete. The old per-step
    // locking left windows where a concurrent table op (live `update`,
    // another view's remount) interleaved — the exact "concurrent ops hang
    // Perspective WASM" trap the chains exist to prevent.
    return this.withTableLock(async () => {
      const leafView = await this.table!.view(config as never);
      try {
        const count = Number(await leafView.num_rows());
        if (count <= 0) return [];
        const start = Math.max(0, Math.min(leafStart, count));
        const end = Math.max(start, Math.min(leafEnd, count));
        if (end <= start) return [];
        return (await leafView.to_json({ start_row: start, end_row: end })) as PositionRow[];
      } finally {
        try { await leafView.delete(); } catch { /* swallow */ }
      }
    });
  }

  private async getGroupedRaw(bound: BoundView): Promise<Record<string, unknown>[]> {
    if (bound.groupedRawCache) return bound.groupedRawCache;
    const raw = await this.withTableLock(() => readRows(bound.view!));
    bound.groupedRawCache = raw;
    bound.groupKeys = [];
    // Rebuild leaf ranges alongside the skeleton dump: deepest-level rows
    // in dump order → cumulative leafCount offsets into the sorted
    // leafView (contiguity holds as long as the grouped view's group
    // ordering matches the leafView's group-column sort — spot-checked at
    // read time).
    const ranges: Array<{ path: string[]; offset: number; count: number }> = [];
    const byPath = new Map<string, number>();
    let offset = 0;
    for (const row of raw) {
      const path = row.__ROW_PATH__;
      if (!Array.isArray(path) || path.length === 0) continue;
      const strPath = path.map((v) => String(v ?? ''));
      bound.groupKeys.push(buildCompositeGroupKey(bound.groupBy, strPath));
      if (path.length === bound.groupBy.length) {
        const count = Math.max(0, Number(row.positionId ?? 0) | 0);
        byPath.set(JSON.stringify(strPath), ranges.length);
        ranges.push({ path: strPath, offset, count });
        offset += count;
      }
    }
    bound.leafRanges = ranges;
    bound.leafRangeByPath = byPath;
    return raw;
  }

  private async remountDataView(
    bound: BoundView,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<void> {
    if (bound.dataUpdateCb !== null && bound.view) {
      try { await bound.view.remove_update(bound.dataUpdateCb); } catch { /* swallow */ }
    }
    if (bound.totalsView) {
      try { await bound.totalsView.delete(); } catch { /* swallow */ }
    }
    if (bound.leafView) {
      try { await bound.leafView.delete(); } catch { /* swallow */ }
      bound.leafView = null;
    }
    bound.leafRanges = null;
    bound.leafRangeByPath = null;
    bound.leafOffsetsUnreliable = false;
    if (bound.view) {
      try { await bound.view.delete(); } catch { /* swallow */ }
    }

    const filter = [...(bound.spec.filter ?? []), ...extraFilter];
    // Leaf / flat Views project to `readColumns` (full DataProvider paint
    // window). Grouped skeleton Views stay lean: index + group-by +
    // measures (+ expressions) so fat catalog schemas don't stall expand.
    const paintColumns = bound.readColumns.length > 0
      ? bound.readColumns
      : this.resolveViewColumns(bound, undefined);
    const skeletonColumns = bound.groupBy.length > 0
      ? this.skeletonViewColumns(bound)
      : paintColumns;
    const mergedExpressions: Record<string, string> = {
      ...bound.expressions,
      ...bound.quickFilterExpressions,
    };
    // Perspective requires expression columns used in `filter` to appear
    // in the View's `columns` list — project the quick-filter haystack.
    const projectedPaint = projectViewColumns(paintColumns, mergedExpressions);
    const projectedSkeleton = projectViewColumns(skeletonColumns, mergedExpressions);
    const config: Record<string, unknown> = {
      columns: bound.groupBy.length > 0 ? projectedSkeleton : projectedPaint,
      filter,
    };
    if (Object.keys(mergedExpressions).length > 0) {
      config.expressions = mergedExpressions;
    }
    if (sort.length > 0) config.sort = sort;
    if (bound.groupBy.length > 0) {
      config.group_by = bound.groupBy;
      config.aggregates = this.resolveAggregates(bound);
    }

    bound.view = await this.table!.view(config as never);
    // Perspective IGNORES `aggregates` on an ungrouped view — the old
    // group_by-less config made `fetchGrandTotal` read raw row 0 (zeros on
    // an empty/loading table). Any group_by makes to_json emit the root
    // aggregate row (`__ROW_PATH__: []`) first — the real grand total.
    const totalsCols = this.measureColumns.length > 0
      ? this.measureColumns
      : this.dataColumns.filter((c) => c !== 'positionId').slice(0, 4);
    const totalsGroupCol = this.dataColumns.includes('desk')
      ? 'desk'
      : (this.dataColumns.find((c) => c !== 'positionId') ?? 'positionId');
    const aggregates = this.resolveAggregates(bound);
    bound.totalsView = await this.table!.view({
      columns: projectViewColumns(
        totalsCols.length > 0 ? totalsCols : ['positionId'],
        mergedExpressions,
      ),
      filter,
      ...(Object.keys(mergedExpressions).length > 0
        ? { expressions: mergedExpressions }
        : {}),
      group_by: [totalsGroupCol],
      aggregates,
    } as never);
    // ONE persistent flat leaf view, sorted by the group columns first
    // (direction matching any user sort on those columns) so each deepest
    // group's leaves form a contiguous range — leaf windows become offset
    // reads on this view instead of per-fetch view create/read/delete.
    if (bound.groupBy.length > 0) {
      const dirFor = (colId: string): 'asc' | 'desc' =>
        sort.find(([c]) => c === colId)?.[1] ?? 'asc';
      const leafSort: Array<[string, 'asc' | 'desc']> = [
        ...bound.groupBy.map((colId): [string, 'asc' | 'desc'] => [colId, dirFor(colId)]),
        ...sort.filter(([c]) => !bound.groupBy.includes(c)),
      ];
      const leafConfig: Record<string, unknown> = {
        columns: projectedPaint,
        filter,
        sort: leafSort,
      };
      if (Object.keys(mergedExpressions).length > 0) {
        leafConfig.expressions = mergedExpressions;
      }
      bound.leafView = await this.table!.view(leafConfig as never);
    }
    bound.groupedRawCache = null;
    bound.dataUpdateCb = Number(
      await bound.view.on_update(() => {
        bound.groupedRawCache = null;
        bound.groupKeys = [];
        // Adds/removes can shift leaf counts — recompute with the next
        // skeleton dump.
        bound.leafRanges = null;
        bound.leafRangeByPath = null;
        this.scheduleViewTick(bound.spec.id);
      }),
    );
    // Push fresh totals after every remount — the pinned grand-total row
    // otherwise only updates on live ticks, so a query change (or the
    // wire-time fetch racing the first remount) left it stale at zeros.
    // Drop any pending live batch first: the post-remount tick must not
    // replay pre-remount rows as fresh updates.
    this.pendingLiveBatch = [];
    this.scheduleViewTick(bound.spec.id);
  }

  private async mountViews(
    spec: ViewSpec,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<BoundView> {
    const bound: BoundView = {
      spec,
      view: null,
      totalsView: null,
      leafView: null,
      leafRanges: null,
      leafRangeByPath: null,
      leafOffsetsUnreliable: false,
      dataUpdateCb: null,
      notifyTimer: null,
      groupBy: [],
      groupedRawCache: null,
      groupKeys: [],
      lastQuerySig: '',
      getRowsCalls: 0,
      rowsServed: 0,
      inflight: 0,
      projectedRows: 0,
      expressions: {},
      readColumns: [...this.dataColumns],
      lastExtraFilter: [],
      lastSort: [],
      quickFilterText: '',
      quickFilterExpressions: {},
      lastOrContains: {},
      valueAggOverrides: {},
    };
    await this.withTableLock(() => this.remountDataView(bound, extraFilter, sort));
    return bound;
  }

  noteGetRowsStart(viewId: string): void {
    const v = this.views.get(viewId);
    if (!v) return;
    v.inflight++;
    v.getRowsCalls++;
    this.getRowsTotal++;
    this.emitTelemetry();
  }

  noteGetRowsEnd(viewId: string, served: number, ok: boolean): void {
    const v = this.views.get(viewId);
    if (!v) return;
    v.inflight = Math.max(0, v.inflight - 1);
    if (ok) {
      v.rowsServed += served;
      this.rowsServedTotal += served;
    }
    this.emitTelemetry();
  }

  async unregisterView(viewId: string): Promise<void> {
    const v = this.views.get(viewId);
    if (!v) return;
    if (v.notifyTimer !== null) {
      clearTimeout(v.notifyTimer);
      v.notifyTimer = null;
    }
    // Drop from the map FIRST so queued chain ops re-reading the view bail
    // cleanly, then tear the handles down under the table lock — deleting a
    // view while the engine is mid-op is a wasm-bindgen "null pointer /
    // borrowed" panic.
    this.views.delete(viewId);
    // C-m9 — the per-view serialization chain otherwise never frees; a
    // grid that Applies/detaches providers repeatedly leaks one Promise
    // chain entry per prior viewId for the life of the book.
    this.getRowsChains.delete(viewId);
    await this.withTableLock(async () => {
      if (v.view && v.dataUpdateCb !== null) {
        try { await v.view.remove_update(v.dataUpdateCb); } catch { /* swallow */ }
      }
      if (v.view) {
        try { await v.view.delete(); } catch { /* swallow */ }
      }
      if (v.totalsView) {
        try { await v.totalsView.delete(); } catch { /* swallow */ }
      }
      if (v.leafView) {
        try { await v.leafView.delete(); } catch { /* swallow */ }
      }
    });
    this.emitTelemetry();
  }

  connect(): void {
    if (this.feedStopped) return;
    if (this.stomp || this.seedConnecting || this.seedLiveTimer !== null) return;
    void this.connectRouted();
  }

  /** Phase 5 routing: dedicated engines feed unconditionally (old
   *  behavior); on the shared engine, exactly one tab (the Web-Lock
   *  holder) feeds while the rest attach to the live book and queue for
   *  takeover. */
  private async connectRouted(): Promise<void> {
    if (this.feedStopped || this.destroyed) return;
    await this.ensureTable();
    if (this.feedStopped || this.destroyed) return;
    if (!this.sharedTable) {
      this.feedRole = 'leader';
      if (this.opts.feed === 'seed') await this.connectSeed();
      else this.activateStomp();
      return;
    }
    const size = await this.sharedTableSize();
    if (this.feedStopped || this.destroyed) return;
    if (size > 0) {
      await this.adoptSharedLive(size);
      this.queueFeedTakeover();
      return;
    }
    if (await this.tryLeadFeed()) {
      if (this.feedStopped || this.destroyed) {
        this.releaseLeadership();
        return;
      }
      if (this.opts.feed === 'seed') await this.connectSeed();
      else this.activateStomp();
      return;
    }
    const settled = await this.waitForSharedSnapshot();
    if (this.feedStopped || this.destroyed) return;
    if (settled > 0) {
      await this.adoptSharedLive(settled);
      this.queueFeedTakeover();
      return;
    }
    // Leader never materialized (crashed mid-boot?) — seed ourselves;
    // positionId-keyed updates make a duplicate snapshot benign.
    if (this.feedStopped || this.destroyed) return;
    if (this.opts.feed === 'seed') await this.connectSeed();
    else this.activateStomp();
  }

  private activateStomp(): void {
    if (this.feedStopped || this.destroyed) return;
    void this.ensureTable().then(() => {
      if (this.feedStopped || this.destroyed || this.stomp) return;
      this.setPhase('connecting');
      this.snapshotComplete = false;
      this.snapshotRowsLoaded = 0;
      this.liveBatches = 0;
      this.liveRowsIn = 0;
      this.liveWindow = [];
      this.updateBuffer = [];
      this.flushQueued = false;

      const client = new Client({
        brokerURL: this.opts.wsUrl,
        reconnectDelay: 2000,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 0,
        onConnect: () => {
          if (this.feedStopped || this.destroyed) {
            try { void client.deactivate(); } catch { /* swallow */ }
            return;
          }
          this.onConnected();
        },
        onStompError: () => this.setPhase('error'),
        onWebSocketError: () => this.setPhase('error'),
        onWebSocketClose: () => this.setPhase('disconnected'),
      });
      this.stomp = client;
      client.activate();
      this.emitTelemetry();
    });
  }

  disconnect(): void {
    this.stopSeedLive();
    this.seedConnecting = false;
    // Phase 5 — stop leading so another tab can take the feed over.
    this.releaseLeadership();
    const c = this.stomp;
    this.stomp = null;
    if (c) {
      try { void c.deactivate(); } catch { /* swallow */ }
    }
    this.setPhase('disconnected');
  }

  private async connectSeed(): Promise<void> {
    if (this.feedStopped || this.destroyed) return;
    this.seedConnecting = true;
    try {
      await this.ensureTable();
      if (this.feedStopped || this.destroyed) return;
      this.setPhase('connecting');
      this.snapshotComplete = false;
      this.snapshotRowsLoaded = 0;
      this.liveBatches = 0;
      this.liveRowsIn = 0;
      this.liveWindow = [];
      this.updateBuffer = [];
      this.flushQueued = false;
      this.setPhase('snapshot');

      const n = Math.max(100, this.opts.snapshotRows | 0);
      const rnd = mulberry32(0xc6_1d);
      const chunk = Math.max(200, this.opts.batchSize * 10);
      for (let i = 0; i < n; i += chunk) {
        if (!this.seedConnecting || this.feedStopped) return;
        const end = Math.min(n, i + chunk);
        const rows: PositionRow[] = [];
        for (let j = i; j < end; j++) rows.push(makeSeedRow(j, rnd));
        // Table writes take the same lock as view create/read/delete —
        // unserialized writes interleaving with the SSRM leaf-view churn
        // wedge Perspective WASM (poisoned op chain → frozen grid).
        await this.withTableLock(() => this.table!.update(rows));
        this.snapshotRowsLoaded = end;
        this.emitTelemetry();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }

      if (this.feedStopped) return;
      this.snapshotComplete = true;
      try {
        this.snapshotRowsLoaded = Number(await this.withTableLock(() => this.table!.size()));
      } catch { /* swallow */ }
      this.setPhase('live');
      for (const id of this.views.keys()) void this.refreshProjected(id);
      this.startSeedLive();
    } catch (err) {
      console.error('[PerspectiveBook] seed', err);
      this.setPhase('error');
    } finally {
      this.seedConnecting = false;
    }
  }

  private startSeedLive(): void {
    this.stopSeedLive();
    if (this.feedStopped || this.destroyed) return;
    const intervalMs = Math.max(16, Math.round(1000 / Math.max(1, this.opts.rate)));
    const rnd = mulberry32(0x11fe);
    this.seedLiveTimer = window.setInterval(() => {
      if (this.feedStopped || this.pauseFanout || !this.table || !this.snapshotComplete) return;
      const n = Math.max(1, this.opts.updatesPerTick | 0);
      const book = Math.max(1, this.snapshotRowsLoaded);
      const rows: PositionRow[] = [];
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rnd() * book);
        const row = makeSeedRow(idx, rnd);
        row.pnl = Math.round((rnd() - 0.5) * 80_000 * 100) / 100;
        row.dailyPnl = Math.round(row.pnl * 0.08 * 100) / 100;
        row.marketValue = Math.round((row.notionalAmount ?? 0) * (0.92 + rnd() * 0.2));
        rows.push(row);
      }
      this.liveRowsIn += rows.length;
      this.liveWindow.push({ t: Date.now(), n: rows.length });
      this.enqueueUpdates(rows);
      void this.flushUpdates();
    }, intervalMs);
  }

  private stopSeedLive(): void {
    if (this.seedLiveTimer !== null) {
      clearInterval(this.seedLiveTimer);
      this.seedLiveTimer = null;
    }
  }

  getTelemetry(): BookTelemetry {
    return this.buildTelemetry();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.telemetryTimer !== null) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.disconnect();
    for (const id of [...this.views.keys()]) void this.unregisterView(id);
    if (this.table) {
      // Phase 5 — the shared table belongs to every connected tab;
      // deleting it here would blank the others. It dies with the
      // SharedWorker when the last tab disconnects.
      if (!this.sharedTable) {
        try { void this.table.delete(); } catch { /* swallow */ }
      }
      this.table = null;
    }
  }

  private setPhase(phase: BookPhase): void {
    this.phase = phase;
    this.opts.onPhase?.(phase);
    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    this.opts.onTelemetry?.(this.buildTelemetry());
  }

  private buildTelemetry(): BookTelemetry {
    const now = Date.now();
    this.liveWindow = this.liveWindow.filter((x) => now - x.t < 1000);
    const liveUpdatesPerSec = this.liveWindow.reduce((s, x) => s + x.n, 0);
    return {
      phase: this.phase,
      bookSize: this.snapshotRowsLoaded || 0,
      snapshotRowsLoaded: this.snapshotRowsLoaded,
      liveBatches: this.liveBatches,
      liveRowsIn: this.liveRowsIn,
      liveUpdatesPerSec,
      getRowsTotal: this.getRowsTotal,
      rowsServedTotal: this.rowsServedTotal,
      viewCount: this.views.size,
      views: [...this.views.values()].map((v) => ({
        id: v.spec.id,
        label: v.spec.label,
        getRowsCalls: v.getRowsCalls,
        rowsServed: v.rowsServed,
        inflight: v.inflight,
        projectedRows: v.projectedRows,
      })),
      wsUrl: this.opts.feed === 'seed' ? 'seed://local' : this.opts.wsUrl,
      engine: 'perspective',
      workerMode: getPerspectiveWorkerMode(),
      feedRole: this.feedRole,
    };
  }

  private async refreshProjected(viewId: string): Promise<void> {
    const v = this.views.get(viewId);
    if (!v?.view) return;
    try {
      v.projectedRows = Number(await this.withTableLock(() => v.view!.num_rows()));
      this.emitTelemetry();
    } catch { /* swallow */ }
  }

  private onConnected(): void {
    if (!this.stomp) return;
    this.setPhase('snapshot');
    const topic = this.opts.snapshotTopic
      ?? `/snapshot/positions/${this.opts.clientId}`;
    const trigger = this.opts.triggerTopic
      ?? `${topic}/${this.opts.rate}/${this.opts.batchSize}`;
    this.stomp.subscribe(topic, (msg: IMessage) => void this.onMessage(msg));
    const headers: Record<string, string> = {
      'snapshot-rows': String(this.opts.snapshotRows),
      'updates-per-tick': String(this.opts.updatesPerTick),
    };
    if (this.opts.sparse) headers['live-mode'] = 'sparse';
    this.stomp.publish({ destination: trigger, body: trigger, headers });
  }

  private async onMessage(msg: IMessage): Promise<void> {
    const body = msg.body?.trim() ?? '';
    if (!body) return;

    // Exact match — a data row containing the token in a text field must
    // not end the snapshot early (data frames are JSON bodies). The
    // `{token}: ...` prefixed variant some servers send is also accepted.
    const endToken = this.opts.snapshotEndToken;
    if (body === endToken || body.startsWith(`${endToken}:`)) {
      if (this.snapshotComplete) return;
      await this.flushUpdates(true);
      this.snapshotComplete = true;
      if (this.table) {
        try { this.snapshotRowsLoaded = Number(await this.table.size()); } catch { /* swallow */ }
      }
      this.setPhase('live');
      for (const id of this.views.keys()) void this.refreshProjected(id);
      return;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }
    const deltas = extractRows(parsed);
    if (deltas.length === 0) return;
    const messageType = msg.headers['message-type'];

    // Identity from configured keyColumn (single or composite). Also write
    // the composed id onto the Perspective table index column so indexed
    // upserts LWW correctly (table is created with `index: <indexField>`).
    const keyColumn = this.opts.keyColumn;
    const indexField = this.tableIndexField();
    const rows: PositionRow[] = [];
    for (const delta of deltas) {
      const record = delta as Record<string, unknown>;
      const id = rowIdentity(record, keyColumn);
      if (id == null) continue;
      const row = { ...record } as Record<string, unknown>;
      row[indexField] = id;
      rows.push(row as PositionRow);
    }
    if (rows.length === 0) return;

    if (!this.snapshotComplete || messageType === 'snapshot') {
      this.enqueueUpdates(rows);
      if (this.updateBuffer.length >= this.opts.batchSize) {
        // Snapshot: await drain so chunks hit WASM before the next frame.
        await this.flushUpdates();
      } else {
        this.scheduleFlush();
      }
      return;
    }

    this.liveRowsIn += rows.length;
    this.liveWindow.push({ t: Date.now(), n: rows.length });
    this.enqueueUpdates(rows);
    // Live: never await from the STOMP callback — overlapping awaits let
    // updateBuffer grow without bound while flush is stuck on WASM.
    if (this.updateBuffer.length >= this.opts.batchSize) {
      void this.flushUpdates();
    } else {
      this.scheduleFlush();
    }
  }

  /** Append + hard-cap the pending table.write queue (LWW per keyColumn). */
  private enqueueUpdates(rows: PositionRow[]): void {
    if (rows.length === 0) return;
    this.updateBuffer.push(...rows);
    const cap = updateBufferCap({
      snapshotComplete: this.snapshotComplete,
      batchSize: this.opts.batchSize,
      snapshotRows: this.opts.snapshotRows,
    });
    if (this.updateBuffer.length <= cap) return;
    this.updateBuffer = boundUpdateBuffer(
      this.updateBuffer as Array<Record<string, unknown>>,
      cap,
      this.opts.keyColumn,
    ) as PositionRow[];
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushUpdates();
    }, 32);
  }

  private async flushUpdates(force = false): Promise<void> {
    if (this.pauseFanout && !force) return;
    if (this.flushInFlight) {
      this.flushQueued = true;
      return;
    }
    this.flushInFlight = true;
    try {
      for (;;) {
        this.flushQueued = false;
        if (this.pauseFanout && !force) break;
        if (!this.table || this.updateBuffer.length === 0) break;
        const batch = this.updateBuffer.splice(0);
        try {
          // Serialized with view ops — see the seed-snapshot sibling comment.
          await this.withTableLock(() => this.table!.update(batch));
          if (!this.snapshotComplete) {
            this.snapshotRowsLoaded = Number(await this.withTableLock(() => this.table!.size()));
          } else {
            this.liveBatches++;
            // Accumulate (last write per id wins) — overwriting dropped any
            // batch that landed while the 100ms view-tick debounce was armed.
            if (this.pendingLiveBatch.length === 0) {
              this.pendingLiveBatch = batch;
            } else {
              const byId = new Map<string, PositionRow>();
              const keyColumn = this.opts.keyColumn;
              for (const row of this.pendingLiveBatch) {
                const id = rowIdentity(row as Record<string, unknown>, keyColumn);
                if (id != null) byId.set(id, row);
              }
              for (const row of batch) {
                const id = rowIdentity(row as Record<string, unknown>, keyColumn);
                if (id != null) byId.set(id, row);
              }
              this.pendingLiveBatch = [...byId.values()];
            }
            for (const id of this.views.keys()) void this.refreshProjected(id);
          }
          this.emitTelemetry();
        } catch (err) {
          console.error('[PerspectiveBook] table.update', err);
          this.setPhase('error');
          break;
        }
        if (!this.flushQueued && this.updateBuffer.length === 0) break;
      }
    } finally {
      this.flushInFlight = false;
      if (this.flushQueued && this.updateBuffer.length > 0 && !(this.pauseFanout && !force)) {
        this.flushQueued = false;
        void this.flushUpdates(force);
      }
    }
  }

  private scheduleViewTick(viewId: string): void {
    const v = this.views.get(viewId);
    if (!v || this.pauseFanout) return;
    if (v.notifyTimer !== null) return;
    v.notifyTimer = window.setTimeout(() => {
      v.notifyTimer = null;
      void this.emitViewTick(viewId);
    }, 100);
  }

  private async emitViewTick(viewId: string): Promise<void> {
    if (this.pauseFanout || !this.opts.onViewTick) return;
    const v = this.views.get(viewId);
    if (!v) return;
    const filterOpts = {
      lastExtraFilter: v.lastExtraFilter,
      quickFilterText: v.quickFilterText,
      dataColumns: this.dataColumns,
      lastOrContains: v.lastOrContains,
    };
    const updates = this.pendingLiveBatch.filter(
      (row) => rowMatchesViewFilter(v.spec, row, filterOpts),
    );
    // Consumed — clear once the LAST armed tick has fired (earlier ticks in
    // the same round still need it; a later tick must not replay it as
    // fresh updates).
    if (![...this.views.values()].some((x) => x.notifyTimer !== null)) {
      this.pendingLiveBatch = [];
    }
    const hasExpressions = Object.keys(v.expressions).length > 0;
    // Grouped: soft-refresh skeleton aggregates + still emit leaf patches
    // so conditional styles / alerts / cell flash see `rowsChanged`.
    // Skip totals await — table-lock contention under a hot feed starved
    // expand when we blocked on fetchGrandTotal.
    if (v.groupBy.length > 0) {
      this.opts.onViewTick({
        viewId,
        totals: emptyGrandTotalRow(),
        refreshSsrm: true,
        updates,
      });
      return;
    }
    const totals = await this.fetchGrandTotal(viewId);
    // Phase 5 — on follower tabs the feeder's row batch lives in ANOTHER
    // tab; this view only learned of the remote update via `on_update`.
    // Route flat views to a band-scoped soft refresh so remote ticks
    // paint (leaders keep the cheaper patch path).
    // With ExprTK aliases, raw feed patches lack computed outputs — soft
    // refresh so calculated columns / rules watching them re-hydrate.
    // Do NOT soft-refresh merely because a grid filter is active: partial
    // tick gating + applyServerSideTransaction already keeps the mirror
    // honest, and soft-refresh-only ticks skip strip invalidation so
    // conditional styles freeze on the raster cache.
    const remoteFlatTick = updates.length === 0 && this.feedRole === 'follower';
    this.opts.onViewTick({
      viewId,
      totals,
      refreshSsrm: remoteFlatTick || hasExpressions,
      updates,
    });
  }
}
