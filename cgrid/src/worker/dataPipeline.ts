import type {
  TransactionResult, FilterModel, FilterModelEntry, FilterModelEntryLegacy,
  CFilterModelEntry, CTextFilterModel, CNumberFilterModel, CDateFilterModel,
  CMultiConditionFilterModel, CSetFilterModel,
} from '../types';

/**
 * Cycle 7 / Task 1 — the worker's `FilterPass` matcher speaks both the
 * Cycle 4 / 5 legacy entry shape AND the ag-grid-compatible v2
 * discriminated union (`{ filterType: 'text' | 'number' | 'date' |
 * 'multi', ... }`). The floating-filter overlay emits v2 directly via
 * the inline operator parser; cgrid.ts forwards v2 entries to the
 * worker unchanged.
 */
type WorkerFilterModelEntry = FilterModelEntryLegacy;
import type { WorkerColumn, ViewportRequest, ViewportChunk } from './protocol';
import { encodeText } from './chunkFormat';

/** Source-of-truth row storage in the worker. Keyed by rowIdField on each row. */
export class RowStore<TRow = any> {
  private byId = new Map<string, TRow>();
  private order: string[] = [];
  // Numeric ID assignment — monotonic per session.
  private nextNumeric = 1;
  private stringToNumeric = new Map<string, number>();
  private numericToString = new Map<number, string>();
  /**
   * Per-row heights resolved main-side via `CGridOptions.getRowHeight` and
   * shipped over the protocol. Canonical here; main thread reads them off
   * each `ViewportChunk.heights`. Rows without an entry fall back to the
   * grid-level `rowHeight`. Cycle 5 / Task 6.
   */
  private heightsByRowId = new Map<string, number>();
  /**
   * Per-(row, column) measured heights from the autoHeight pass. Kept
   * separately from `heightsByRowId` so removing autoHeight from one column
   * does not drop the contribution of other autoHeight columns to the same
   * row — when the user toggles `autoHeight: false`, we strip just that
   * column's inner map entry and re-aggregate. Cycle 5 / Task 8.
   */
  private autoHeightContributions = new Map<string, Map<string, number>>();
  /** Grid-level rowHeight fallback set at init time. The autoHeight pass
   *  floors every contribution at this value so a short autoHeight row never
   *  paints below the grid baseline. Cycle 5 / Task 8. */
  private gridRowHeight = 0;

  constructor(private rowIdField: string) {}

  setAll(rows: TRow[], heightsByRowId?: Map<string, number>): void {
    this.byId.clear();
    this.order.length = 0;
    // A full-replace wipes prior heights so a fresh dataset can't inherit
    // height entries for rowIds that no longer exist.
    this.heightsByRowId.clear();
    this.autoHeightContributions.clear();
    for (const row of rows) {
      const id = this.getRowId(row);
      this.byId.set(id, row);
      this.order.push(id);
      if (!this.stringToNumeric.has(id)) {
        const n = this.nextNumeric++;
        this.stringToNumeric.set(id, n);
        this.numericToString.set(n, id);
      }
    }
    if (heightsByRowId) {
      for (const [id, h] of heightsByRowId) this.heightsByRowId.set(id, h);
    }
  }

  apply(tx: {
    add?: TRow[];
    update?: TRow[];
    remove?: string[];
    heightsByRowId?: Map<string, number>;
  }): TransactionResult {
    const result: TransactionResult = { add: [], update: [], remove: [] };
    if (tx.add) {
      for (const row of tx.add) {
        const id = this.getRowId(row);
        if (!this.byId.has(id)) {
          this.byId.set(id, row);
          this.order.push(id);
          if (!this.stringToNumeric.has(id)) {
            const n = this.nextNumeric++;
            this.stringToNumeric.set(id, n);
            this.numericToString.set(n, id);
          }
          result.add.push({ rowId: id });
        }
      }
    }
    if (tx.update) {
      for (const row of tx.update) {
        const id = this.getRowId(row);
        if (this.byId.has(id)) {
          this.byId.set(id, row);
          result.update.push({ rowId: id });
        }
      }
    }
    if (tx.remove) {
      for (const id of tx.remove) {
        if (this.byId.delete(id)) {
          const i = this.order.indexOf(id);
          if (i !== -1) this.order.splice(i, 1);
          // Drop the per-row height too so a re-added row doesn't inherit
          // the previous row's height ghost.
          this.heightsByRowId.delete(id);
          this.autoHeightContributions.delete(id);
          result.remove.push({ rowId: id });
        }
      }
    }
    if (tx.heightsByRowId) {
      for (const [id, h] of tx.heightsByRowId) this.heightsByRowId.set(id, h);
    }
    return result;
  }

  /** Per-row height for `rowId` in CSS px, or `undefined` when no per-row
   *  entry exists (caller falls back to the grid-level `rowHeight`). */
  getHeight(rowId: string): number | undefined {
    return this.heightsByRowId.get(rowId);
  }

  /**
   * Record an autoHeight measurement for one (row, column) and reaggregate
   * the row's resolved height as `max(getRowHeight contribution, gridFallback,
   * max(autoHeight contributions across columns))`. Returns the new resolved
   * height. Cycle 5 / Task 8.
   *
   * `gridRowHeight` is the floor — short text in a single autoHeight column
   * must not shrink rows below the grid's baseline `rowHeight`.
   */
  setAutoHeightContribution(rowId: string, colId: string, height: number, gridRowHeight: number): number {
    let contribs = this.autoHeightContributions.get(rowId);
    if (!contribs) {
      contribs = new Map();
      this.autoHeightContributions.set(rowId, contribs);
    }
    // Floor every contribution at the grid fallback so a single-line autoHeight
    // measurement cannot shrink the row below the user's baseline rowHeight.
    contribs.set(colId, Math.max(height, gridRowHeight));
    return this.resolveHeight(rowId, gridRowHeight);
  }

  /** Drop one column's autoHeight contribution for `rowId`. Used when the
   *  user toggles `autoHeight: false` on a column at runtime. */
  clearAutoHeightContribution(rowId: string, colId: string, gridRowHeight: number): number {
    const contribs = this.autoHeightContributions.get(rowId);
    if (contribs) {
      contribs.delete(colId);
      if (contribs.size === 0) this.autoHeightContributions.delete(rowId);
    }
    return this.resolveHeight(rowId, gridRowHeight);
  }

  /** Aggregate the resolved height for `rowId`: the max of any explicit
   *  getRowHeight contribution, the autoHeight contributions, and the grid
   *  fallback. Pure read — does not write back. */
  resolveHeight(rowId: string, gridRowHeight: number): number {
    let h = this.heightsByRowId.get(rowId) ?? gridRowHeight;
    const contribs = this.autoHeightContributions.get(rowId);
    if (contribs) {
      for (const v of contribs.values()) if (v > h) h = v;
    }
    return h;
  }

  /** Wire pass that owns the chunk pipeline calls this so the slicer can
   *  produce per-row heights without re-passing the grid rowHeight on every
   *  chunk request. Cycle 5 / Task 8. */
  setGridRowHeight(h: number): void {
    this.gridRowHeight = h;
  }

  getGridRowHeight(): number {
    return this.gridRowHeight;
  }

  /** Shipped height for the protocol's `ViewportChunk.heights[i]`:
   *  - Returns the explicit getRowHeight value when no autoHeight contrib.
   *  - Returns `max(explicit ?? 0, max(contribs))` when contribs exist.
   *  - Returns 0 (sentinel for "use grid fallback") only when neither
   *    explicit nor any autoHeight contribution exists for this row.
   *  The store's job is just aggregation; the floor-against-gridRowHeight
   *  guarantee lives in `setAutoHeightContribution`, which never stores a
   *  value below the grid fallback. */
  effectiveShippedHeight(rowId: string): number {
    const explicit = this.heightsByRowId.get(rowId);
    const contribs = this.autoHeightContributions.get(rowId);
    if (!contribs || contribs.size === 0) return explicit ?? 0;
    let max = explicit ?? 0;
    for (const v of contribs.values()) if (v > max) max = v;
    return max;
  }

  size(): number { return this.byId.size; }

  *rows(): IterableIterator<TRow> {
    for (const id of this.order) {
      const r = this.byId.get(id);
      if (r !== undefined) yield r;
    }
  }

  getById(rowId: string): TRow | undefined {
    return this.byId.get(rowId);
  }

  getRowId(row: TRow): string {
    const v = (row as Record<string, unknown>)[this.rowIdField];
    if (v == null) throw new Error(`[cgrid] row missing rowIdField '${this.rowIdField}'`);
    return String(v);
  }

  getNumericId(rowId: string): number {
    let n = this.stringToNumeric.get(rowId);
    if (n === undefined) {
      n = this.nextNumeric++;
      this.stringToNumeric.set(rowId, n);
      this.numericToString.set(n, rowId);
    }
    return n;
  }

  getStringId(numericId: number): string | undefined {
    return this.numericToString.get(numericId);
  }
}

interface QueueOpts {
  waitMs: number;
  onFlush: (results: TransactionResult[]) => void;
}

/** Shape of a queued or applied transaction. heightsByRowId rides along so
 *  height-bearing updates flow through the async batching path too. */
export interface QueuedTx<TRow = any> {
  add?: TRow[];
  update?: TRow[];
  remove?: string[];
  heightsByRowId?: Map<string, number>;
}

export class TransactionQueue<TRow = any> {
  private pending: QueuedTx<TRow>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushFn: () => void;

  constructor(private opts: QueueOpts) {
    // Default flush: drains the queue and calls onFlush with empty results per tx.
    // Task 12's worker.ts replaces this via setFlushFn once RowStore is available.
    this.flushFn = () => {
      const queued = this.pending;
      this.pending = [];
      this.timer = null;
      if (queued.length === 0) return;
      // Default: pretend each tx produced an empty result (real worker overrides).
      this.opts.onFlush(queued.map(() => ({ add: [], update: [], remove: [] })));
    };
  }

  /** Caller (worker.ts) installs the actual flush function once RowStore exists. */
  setFlushFn(fn: (txs: QueuedTx<TRow>[]) => TransactionResult[]): void {
    this.flushFn = () => {
      const queued = this.pending;
      this.pending = [];
      this.timer = null;
      if (queued.length === 0) return;
      const results = fn(queued);
      this.opts.onFlush(results);
    };
  }

  push(tx: QueuedTx<TRow>): void {
    this.pending.push(tx);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flushFn(), this.opts.waitMs);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushFn();
  }
}

/**
 * Cycle 7 / Task 7 — predicate shared between the worker's
 * `QuickFilterPass` and the main-thread cell highlighter. Returns true
 * when `value`'s lowercased string form contains AT LEAST ONE of the
 * pre-lowercased `lowerTerms`. The cell highlighter applies OR
 * semantics across terms (any matching cell contributed to the row
 * passing the AND-across-terms row predicate), so this is the right
 * primitive for both surfaces. Empty `lowerTerms` returns false — the
 * caller is expected to early-out when no terms are active.
 *
 * Exported so the renderer can call it per visible cell at paint time
 * without re-implementing the lowercase-and-includes loop.
 */
export function cellMatchesAnyQuickFilterTerm(
  value: unknown,
  lowerTerms: readonly string[],
): boolean {
  if (lowerTerms.length === 0) return false;
  const lower = value == null ? '' : String(value).toLowerCase();
  if (lower === '') return false;
  for (let i = 0; i < lowerTerms.length; i++) {
    if (lower.includes(lowerTerms[i]!)) return true;
  }
  return false;
}

/**
 * Cycle 7 / Task 7 — cross-column quick filter. Runs BEFORE `FilterPass`
 * in the worker pipeline. Each row produces an aggregate string of every
 * eligible column's stringified value joined with `'\n'`; a row passes
 * when every search term is `includes`-matched against the aggregate
 * (lower-cased on both sides — the default matcher is case-insensitive).
 *
 * Terms are split main-side via `quickFilterParser` and shipped as a
 * `string[]`. A `null` (or empty) terms array short-circuits to `null`
 * from `apply()` — the caller treats that as "every row passes" and skips
 * any intersection.
 *
 * `cacheQuickFilter: true` memoizes the per-row aggregate so a hot
 * type-as-you-search loop avoids the `String(value)` coercion per
 * keystroke. The cache is invalidated whenever the column set changes
 * (column add / hide / show / order can change the aggregate composition)
 * and whenever the worker's transaction hook calls `invalidateRows`.
 *
 * The eligible column set is the worker columns whose `field` is set,
 * optionally narrowed by `setColIds` — main passes the visible-only or
 * include-hidden list per `includeHiddenColumnsInQuickFilter`.
 */
export class QuickFilterPass<TRow = any> {
  private terms: string[] | null = null;
  private lowerTerms: string[] = [];
  private cacheEnabled = false;
  /** All worker columns with a resolvable `field`. */
  private allColumns: WorkerColumn[] = [];
  /** Active aggregate column set — `allColumns` filtered by `colIds`. */
  private aggColumns: WorkerColumn[] = [];
  /** Whitelist of colIds to include in the aggregate; `null` means "all". */
  private colIdWhitelist: Set<string> | null = null;
  private aggregateCache = new Map<string, string>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  /** Replace the search terms. `null` or empty array disables the pass. */
  setTerms(terms: string[] | null): void {
    if (terms === null || terms.length === 0) {
      this.terms = null;
      this.lowerTerms = [];
      return;
    }
    this.terms = terms;
    // Pre-lower so the per-row `includes` check pays nothing per term.
    this.lowerTerms = terms.map((t) => t.toLowerCase());
  }

  /** Swap the worker columns. Invalidates the aggregate cache because the
   *  per-row aggregate text composition changes with the column set. */
  setColumns(columns: WorkerColumn[]): void {
    this.allColumns = columns.filter((c) => c.field !== undefined);
    this.recomputeAggColumns();
    this.aggregateCache.clear();
  }

  /** Narrow the aggregate to the listed colIds. Pass `null` to use every
   *  worker column with a field. Invalidates the aggregate cache. */
  setColIds(colIds: string[] | null): void {
    this.colIdWhitelist = colIds === null ? null : new Set(colIds);
    this.recomputeAggColumns();
    this.aggregateCache.clear();
  }

  /** Toggle the per-row aggregate cache. Flipping the flag clears the
   *  cache so a `false → true` transition rebuilds from scratch and
   *  a `true → false` doesn't leave a stale Map sitting in memory. */
  setCacheEnabled(enabled: boolean): void {
    if (this.cacheEnabled !== enabled) {
      this.aggregateCache.clear();
    }
    this.cacheEnabled = enabled;
  }

  /** Drop cached aggregate text for the given rowIds. Called from the
   *  worker's transaction hook so a row whose data just changed doesn't
   *  return a stale aggregate on the next apply. */
  invalidateRows(rowIds: Iterable<string>): void {
    if (!this.cacheEnabled || this.aggregateCache.size === 0) return;
    for (const id of rowIds) this.aggregateCache.delete(id);
  }

  /** Returns the surviving rowIds, or `null` when the pass is disabled
   *  (`terms === null`). Callers intersect with `FilterPass.apply` —
   *  `null` short-circuits to "no quick-filter constraint". */
  apply(): string[] | null {
    if (this.terms === null) return null;
    const out: string[] = [];
    const lowerTerms = this.lowerTerms;
    const aggCols = this.aggColumns;
    for (const row of this.store.rows()) {
      const id = this.store.getRowId(row);
      const agg = this.getAggregateText(id, row, aggCols);
      if (this.matchesAll(agg, lowerTerms)) out.push(id);
    }
    return out;
  }

  private recomputeAggColumns(): void {
    if (this.colIdWhitelist === null) {
      this.aggColumns = this.allColumns;
      return;
    }
    const whitelist = this.colIdWhitelist;
    this.aggColumns = this.allColumns.filter((c) => whitelist.has(c.colId));
  }

  private getAggregateText(rowId: string, row: TRow, aggCols: WorkerColumn[]): string {
    if (this.cacheEnabled) {
      const cached = this.aggregateCache.get(rowId);
      if (cached !== undefined) return cached;
    }
    let agg = '';
    for (let i = 0; i < aggCols.length; i++) {
      const col = aggCols[i]!;
      const v = (row as Record<string, unknown>)[col.field!];
      // Empty / null values still emit a separator so the aggregate shape
      // is positional — useful when a future matcher inspects per-column
      // slots (Cycle 24 module loader work).
      if (i > 0) agg += '\n';
      agg += v == null ? '' : String(v);
    }
    // Lowercase once at aggregation time so the per-term `includes` check
    // doesn't re-lower on every comparison.
    const lower = agg.toLowerCase();
    if (this.cacheEnabled) this.aggregateCache.set(rowId, lower);
    return lower;
  }

  private matchesAll(agg: string, lowerTerms: string[]): boolean {
    for (let i = 0; i < lowerTerms.length; i++) {
      if (!agg.includes(lowerTerms[i]!)) return false;
    }
    return true;
  }
}

/**
 * Cycle 7 / Task 9 — DistinctValuesPass.
 *
 * Computes the unique set of column values across `store.rows()` for the
 * set-filter popup. One-pass hash per `getValues(colId)` call; the result
 * is cached per colId so a popup that re-opens (or scrolls the
 * virtualised list) doesn't re-walk the store. Cache entries expire when
 * `invalidateRows` runs (called from the worker's transaction hook —
 * same shape `QuickFilterPass.invalidateRows` uses) and when `setColumns`
 * replaces the column metadata.
 *
 * Stringifies each value via `String(value)` so a numeric column's
 * distinct set is reachable from the popup's checkbox list (which speaks
 * `string[]`). Null / undefined values are dropped from the result —
 * "(blank)" handling is a follow-up cycle once the catalog ships
 * `excelMode` parity.
 */
export class DistinctValuesPass<TRow = any> {
  private cache = new Map<string, string[]>();
  private colIndex = new Map<string, WorkerColumn>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  setColumns(columns: WorkerColumn[]): void {
    this.colIndex.clear();
    for (const col of columns) this.colIndex.set(col.colId, col);
    // Column metadata changed — every cached distinct set is potentially
    // stale (a field swap or a removed colId both flip the answer).
    this.cache.clear();
  }

  /** Returns the distinct stringified values for `colId` in insertion
   *  order — the iteration order of the underlying `Set<string>`, which
   *  matches the first-seen row order. Returns an empty array for
   *  unknown / field-less columns. */
  getValues(colId: string): string[] {
    const cached = this.cache.get(colId);
    if (cached !== undefined) return cached;
    const col = this.colIndex.get(colId);
    if (!col || !col.field) {
      this.cache.set(colId, []);
      return [];
    }
    const field = col.field;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of this.store.rows()) {
      const v = (row as Record<string, unknown>)[field];
      if (v == null) continue;
      const s = String(v);
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    this.cache.set(colId, out);
    return out;
  }

  /** Drop every cached distinct set so the next `getValues` call
   *  re-derives. `rowIds` is ignored — we cache per-column, not per-row,
   *  and a single mutation can change any column's distinct set. The
   *  argument shape mirrors `QuickFilterPass.invalidateRows` so the
   *  worker's transaction hook can call both with the same payload. */
  invalidateRows(_rowIds: Iterable<string>): void {
    this.cache.clear();
  }
}

export class FilterPass<TRow = any> {
  private model: FilterModel = {};
  private colIndex = new Map<string, WorkerColumn>();
  /** Per-entry materialized data — built once at setModel time, read on
   *  every row in `apply()`. Today only holds compiled Set-filter lookups,
   *  but it's the natural seam for future per-entry pre-compiles (e.g.
   *  case-folded text needles, parsed numeric thresholds). Keyed by the
   *  entry object so swapping the model wipes everything via clear(). */
  private compiledSetValues = new Map<CSetFilterModel, Set<string>>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  setModel(model: FilterModel): void {
    this.model = model;
    this.compiledSetValues.clear();
    // Walk the model once and pre-materialize every set-filter entry.
    // Previous code built `new Set(entry.values)` per row × per entry —
    // for a 100K-row dataset with a 1K-value set filter that's 100M Set
    // allocations per pipeline pass. The pre-build runs once at setModel
    // (and again for any nested multi-condition entries).
    for (const colId in model) {
      const entry = model[colId];
      if (entry) this.precompileEntry(entry);
    }
  }

  private precompileEntry(entry: unknown): void {
    if (!entry || typeof entry !== 'object') return;
    const e = entry as { filterType?: string; values?: unknown[]; conditions?: unknown[] };
    if (e.filterType === 'set' && Array.isArray(e.values)) {
      this.compiledSetValues.set(entry as CSetFilterModel, new Set(e.values as string[]));
    } else if (e.filterType === 'multi' && Array.isArray(e.conditions)) {
      for (const c of e.conditions) this.precompileEntry(c);
    }
  }

  /** Swap column metadata in place. Preserves the current filter model so
   *  `updateGridOptions({ columnDefs })` doesn't silently wipe user filters. */
  setColumns(columns: WorkerColumn[]): void {
    this.colIndex.clear();
    for (const col of columns) this.colIndex.set(col.colId, col);
  }

  apply(): string[] {
    const entries = Object.entries(this.model);
    if (entries.length === 0) {
      return Array.from(this.store.rows()).map((r) => this.store.getRowId(r));
    }
    const compiledSets = this.compiledSetValues;
    const out: string[] = [];
    for (const row of this.store.rows()) {
      let pass = true;
      for (const [colId, rawEntry] of entries) {
        const col = this.colIndex.get(colId);
        if (!col || !col.field) continue;
        const value = (row as Record<string, unknown>)[col.field];
        // v2 entries (`filterType` discriminator) go through matchesV2;
        // legacy entries through `matches`. Worker accepts both for the
        // duration of Cycle 7 — Task 2 will remove the legacy branch
        // once all callers migrate. Cycle 7 / Task 5 — column metadata
        // (textFormatter) threads into matchesV2 so the text matcher
        // can normalise both sides pre-compare.
        const ok = 'filterType' in rawEntry
          ? matchesV2(rawEntry as CFilterModelEntry, value, col, compiledSets)
          : matches(rawEntry as WorkerFilterModelEntry, value);
        if (!ok) { pass = false; break; }
      }
      if (pass) out.push(this.store.getRowId(row));
    }
    return out;
  }
}

function matches(entry: WorkerFilterModelEntry, raw: unknown): boolean {
  if (entry.type === 'text') {
    const s = String(raw ?? '').toLowerCase();
    const q = entry.value.toLowerCase();
    if (entry.op === 'contains')   return s.includes(q);
    if (entry.op === 'equals')     return s === q;
    if (entry.op === 'startsWith') return s.startsWith(q);
    return false;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) return false;
  if (entry.op === 'eq') return n === entry.value;
  if (entry.op === 'gt') return n >  entry.value;
  if (entry.op === 'lt') return n <  entry.value;
  if (entry.op === 'between') return n >= entry.value && n <= (entry.value2 ?? entry.value);
  return false;
}

/** v2 matcher — handles `CTextFilterModel` / `CNumberFilterModel` /
 *  `CDateFilterModel` / `CMultiConditionFilterModel` (recursive). Used
 *  by `FilterPass.apply` whenever an entry carries the `filterType`
 *  discriminator. Cycle 7 / Task 1 (parser enhancement). Cycle 7 /
 *  Task 5 threads the WorkerColumn through so the text matcher can read
 *  the column-level `textFormatter`. */
function matchesV2(
  entry: CFilterModelEntry,
  raw: unknown,
  col?: WorkerColumn,
  compiledSets?: Map<CSetFilterModel, Set<string>>,
): boolean {
  if (entry.filterType === 'multi') {
    return matchesMulti(entry, raw, col, compiledSets);
  }
  if (entry.filterType === 'text') {
    return matchesText(entry, raw, col);
  }
  if (entry.filterType === 'number') {
    return matchesNumber(entry, raw);
  }
  if (entry.filterType === 'date') {
    return matchesDate(entry, raw);
  }
  if (entry.filterType === 'set') {
    return matchesSet(entry, raw, compiledSets);
  }
  return false;
}

/** Cycle 7 / Task 9 — set-filter matcher. An entry with an empty
 *  `values` array is treated as "everything filtered out" (matches
 *  ag-grid's deselect-all behaviour); a `null` raw value matches only
 *  when `null` is explicitly part of the values set (currently it isn't
 *  because DistinctValuesPass drops nulls — a future cycle wires the
 *  "(blank)" sentinel). Uses the FilterPass-side pre-compiled Set when
 *  available; falls back to a per-call build when invoked outside the
 *  pass (e.g. from tests). */
function matchesSet(
  entry: CSetFilterModel,
  raw: unknown,
  compiledSets?: Map<CSetFilterModel, Set<string>>,
): boolean {
  if (raw == null) return false;
  const allow = compiledSets?.get(entry) ?? new Set(entry.values);
  return allow.has(String(raw));
}

function matchesMulti(
  entry: CMultiConditionFilterModel,
  raw: unknown,
  col?: WorkerColumn,
  compiledSets?: Map<CSetFilterModel, Set<string>>,
): boolean {
  // Empty conditions array is treated as "no constraint" — `null`-shaped
  // entries don't reach the worker (cgrid drops them in
  // setColumnFilterModel), so this is purely defensive.
  if (entry.conditions.length === 0) return true;
  if (entry.operator === 'AND') {
    for (const c of entry.conditions) {
      if (!matchesV2(c, raw, col, compiledSets)) return false;
    }
    return true;
  }
  // OR — short-circuit on the first pass.
  for (const c of entry.conditions) {
    if (matchesV2(c, raw, col, compiledSets)) return true;
  }
  return false;
}

function matchesText(entry: CTextFilterModel, raw: unknown, col?: WorkerColumn): boolean {
  let haystack = String(raw ?? '');
  let needle = entry.filter == null ? '' : entry.filter;
  // Cycle 7 / Task 5 — column-level textFormatter runs on BOTH sides
  // before case normalisation. 'lowercase' / 'uppercase' subsume any
  // entry-level caseSensitive flag because the post-formatter strings
  // are already in a single case; 'trim' is orthogonal to case.
  const formatter = col?.textFormatter;
  if (formatter) {
    haystack = applyTextFormatter(haystack, formatter);
    needle = applyTextFormatter(needle, formatter);
  }
  // Entry-level caseSensitive: false (default) lowercases both sides.
  if (entry.caseSensitive !== true) {
    haystack = haystack.toLowerCase();
    needle = needle.toLowerCase();
  }
  switch (entry.type) {
    case 'contains':    return haystack.includes(needle);
    case 'notContains': return !haystack.includes(needle);
    case 'equals':      return haystack === needle;
    case 'notEqual':    return haystack !== needle;
    case 'startsWith':  return haystack.startsWith(needle);
    case 'endsWith':    return haystack.endsWith(needle);
    case 'blank':       return haystack === '';
    case 'notBlank':    return haystack !== '';
  }
  return false;
}

function applyTextFormatter(s: string, formatter: 'lowercase' | 'uppercase' | 'trim'): string {
  if (formatter === 'lowercase') return s.toLowerCase();
  if (formatter === 'uppercase') return s.toUpperCase();
  return s.trim();
}

function matchesNumber(entry: CNumberFilterModel, raw: unknown): boolean {
  if (entry.type === 'blank')    return raw == null || raw === '';
  if (entry.type === 'notBlank') return raw != null && raw !== '';
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return false;
  const a = entry.filter;
  if (a == null) return false;
  switch (entry.type) {
    case 'equals':              return n === a;
    case 'notEqual':            return n !== a;
    case 'lessThan':            return n <  a;
    case 'lessThanOrEqual':     return n <= a;
    case 'greaterThan':         return n >  a;
    case 'greaterThanOrEqual':  return n >= a;
    case 'inRange':             return entry.filterTo != null
      && n >= a && n <= entry.filterTo;
  }
  return false;
}

/** Date matcher — compares ISO strings via `Date.parse`. Returns false
 *  when either side fails to parse so an invalid date entry never
 *  silently includes rows. */
function matchesDate(entry: CDateFilterModel, raw: unknown): boolean {
  if (entry.type === 'blank')    return raw == null || raw === '';
  if (entry.type === 'notBlank') return raw != null && raw !== '';
  const r = parseDateMs(raw);
  if (r === null) return false;
  const a = entry.filter == null ? null : parseDateMs(entry.filter);
  if (a === null) return false;
  switch (entry.type) {
    case 'equals':              return r === a;
    case 'notEqual':            return r !== a;
    case 'lessThan':            return r <  a;
    case 'lessThanOrEqual':     return r <= a;
    case 'greaterThan':         return r >  a;
    case 'greaterThanOrEqual':  return r >= a;
    case 'inRange': {
      const b = entry.filterTo == null ? null : parseDateMs(entry.filterTo);
      return b !== null && r >= a && r <= b;
    }
  }
  return false;
}

function parseDateMs(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw);
  if (s === '') return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// Cycle 15 / Task 11 — SortPass moved to `worker/passes/sortPass.ts`
// so the new group-aware `applyGrouped` path can live alongside the
// existing flat `apply` without inflating `dataPipeline.ts`. Re-exported
// here for backwards compatibility with the existing import surface
// (`import { SortPass } from '.../dataPipeline'`).
export { SortPass } from './passes/sortPass';

/**
 * Cycle 4 / Task 11 (cell-flash patch) — shallow diff between two row
 * snapshots. Returns the set of top-level field names whose value
 * changed (strict-equality). Used by the worker's `applyTransaction.update`
 * hook to populate `pendingFlashes` so the next viewport slice can
 * pack the corresponding `flashMask` bits.
 *
 * Strict-equality on top-level fields only: nested object identity
 * change (e.g. a re-allocated nested `meta` object with identical
 * contents) is treated as a change. This matches the row-replace
 * semantics most apps use (immutable row updates). Apps that mutate
 * row objects in place need to do the equivalent of `applyTransaction.
 * update` to fire — flash is driven by the update path, not by
 * arbitrary mutation.
 */
export function diffRowFields(oldRow: unknown, newRow: unknown): Set<string> {
  const changed = new Set<string>();
  if (oldRow === newRow) return changed;
  if (oldRow == null || newRow == null) return changed;
  const o = oldRow as Record<string, unknown>;
  const n = newRow as Record<string, unknown>;
  // Walk newRow keys + flag any that diverge.
  for (const k in n) {
    if (Object.prototype.hasOwnProperty.call(n, k) && o[k] !== n[k]) {
      changed.add(k);
    }
  }
  // Keys removed in newRow also count.
  for (const k in o) {
    if (Object.prototype.hasOwnProperty.call(o, k) && !Object.prototype.hasOwnProperty.call(n, k)) {
      changed.add(k);
    }
  }
  return changed;
}

export class ViewportSlicer<TRow = any> {
  private colIndex = new Map<string, WorkerColumn>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  setColumns(columns: WorkerColumn[]): void {
    this.colIndex.clear();
    for (const col of columns) this.colIndex.set(col.colId, col);
  }

  slice(
    visibleIds: string[],
    req: ViewportRequest,
    /** Cycle 4 / Task 11 — when supplied AND `req.includeFlashMask !== false`,
     *  the slicer packs a `flashMask: Uint8Array` (one bit per cell,
     *  row-major) covering every cell whose rowId is in the visible
     *  window and whose colId resolves to a field in the rowId's
     *  pending-flash set. The caller drains `pendingFlashes` after
     *  slicing so each flash fires exactly once. */
    pendingFlashes?: Map<string, Set<string>>,
  ): ViewportChunk {
    const rowStart = Math.max(0, req.rowStart);
    const rowEnd = Math.min(visibleIds.length, req.rowEnd);
    const count = Math.max(0, rowEnd - rowStart);

    const rowIds = new Uint32Array(count);
    const rowKinds = new Uint8Array(count);   // all leaf for Foundation
    const groupDepth = new Uint8Array(count);
    // Per-row heights ride alongside rowIds in the same visible order.
    // 0 sentinel means "no per-row entry — main thread uses the global
    // rowHeight fallback". Cycle 5 / Task 6. Autoheight contributions
    // ride alongside the explicit getRowHeight value via the store's
    // `effectiveShippedHeight` aggregation. Cycle 5 / Task 8.
    const heights = new Float32Array(count);
    // Cycle 15 / Task 3 — group-row parallel arrays. The ungrouped
    // slicer is the data-only path: groupValue is `''` per slot,
    // groupChildCount is 0, isExpanded is 1 (slot is always visible —
    // no group hierarchy to collapse on this code path).
    const groupValue: string[] = new Array<string>(count).fill('');
    const groupChildCount = new Uint32Array(count);
    const isExpanded = new Uint8Array(count);
    isExpanded.fill(1);

    for (let i = 0; i < count; i++) {
      const id = visibleIds[rowStart + i]!;
      rowIds[i] = this.store.getNumericId(id);
      heights[i] = this.store.effectiveShippedHeight(id);
    }

    const numericCols: Record<string, Float64Array> = {};
    const textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }> = {};

    for (const colId of req.columns) {
      const col = this.colIndex.get(colId);
      if (!col || !col.field) continue;
      if (col.type === 'number') {
        const arr = new Float64Array(count);
        for (let i = 0; i < count; i++) {
          const row = this.store.getById(visibleIds[rowStart + i]!);
          arr[i] = Number((row as Record<string, unknown> | undefined)?.[col.field!]);
        }
        numericCols[colId] = arr;
      } else {
        const values: string[] = new Array(count);
        for (let i = 0; i < count; i++) {
          const row = this.store.getById(visibleIds[rowStart + i]!);
          const v = (row as Record<string, unknown> | undefined)?.[col.field!];
          values[i] = v == null ? '' : String(v);
        }
        textCols[colId] = encodeText(values);
      }
    }

    // Cycle 4 / Task 11 — pack flashMask when the caller supplied a
    // pendingFlashes map and the request didn't opt out. One bit per
    // (row × col), row-major; bit `r * colCount + c`. We populate by
    // walking ROW-major (cache-friendly) and ANDing the column field
    // against the per-row pending set. The mask is omitted when
    // there's nothing to flash so the transferable list stays minimal.
    let flashMask: Uint8Array | undefined;
    if (
      pendingFlashes !== undefined && pendingFlashes.size > 0
      && req.includeFlashMask !== false
      && count > 0 && req.columns.length > 0
    ) {
      const colCount = req.columns.length;
      const totalBits = count * colCount;
      const mask = new Uint8Array((totalBits + 7) >>> 3);
      let anySet = false;
      // Pre-resolve column fields once (avoid re-lookup per row).
      const colFields: Array<string | undefined> = new Array(colCount);
      for (let c = 0; c < colCount; c++) {
        const col = this.colIndex.get(req.columns[c]!);
        colFields[c] = col?.field;
      }
      for (let r = 0; r < count; r++) {
        const rowId = visibleIds[rowStart + r]!;
        const fields = pendingFlashes.get(rowId);
        if (!fields || fields.size === 0) continue;
        for (let c = 0; c < colCount; c++) {
          const field = colFields[c];
          if (!field || !fields.has(field)) continue;
          const bitIdx = r * colCount + c;
          mask[bitIdx >>> 3]! |= 1 << (bitIdx & 7);
          anySet = true;
        }
      }
      if (anySet) flashMask = mask;
    }

    return {
      rowStart,
      rowCount: count,
      rowIds,
      rowKinds,
      groupDepth,
      heights,
      numericCols,
      textCols,
      flashMask,
      groupValue,
      groupChildCount,
      isExpanded,
    };
  }
}

// Cycle 14 / Task 3 — AggPass moved to `worker/passes/aggPass.ts` so
// the column-totals aggregation can resolve through the runtime
// `AggFuncRegistry` (built-in + custom funcs) instead of a hardcoded
// switch. Re-exported here so the existing test imports
// (`import { AggPass } from '.../dataPipeline'`) keep working without
// a churn-only rename.
export { AggPass } from './passes/aggPass';

// Cycle 15 / Task 1 — GroupPass lives alongside the other passes in
// `worker/passes/`. Re-exported here for the same reason: existing
// `import { ... } from '.../dataPipeline'` ergonomics. `GroupPass` slots
// between `FilterPass` (post-quick / post-external / post-alwaysPass)
// and `SortPass`; see the file header for the build algorithm.
export { GroupPass } from './passes/groupPass';
export type { GroupNode, GroupPassOutput, FlatOrderEntry } from './passes/groupPass';

export { PivotPass, encodePivotValueKey, getPivotValue, PIVOT_PATH_SEP } from './passes/pivotPass';
export type { PivotModel, PivotKeyNode, PivotPassOutput } from './passes/pivotPass';

// Cycle 15 / Task 2 — group-aware viewport helpers. Re-exported so the
// worker's `getViewport` handler can stay rooted in `dataPipeline`'s
// import surface; the actual collapse-skip walk + grouped slicer live
// in `viewportSlicer.ts`.
export {
  computeGroupVisibleOrder,
  computeGroupVisibleRowCount,
  findVisibleIndexForGroup,
  sliceGroupedViewport,
} from './viewportSlicer';
export type { VisibleRowEntry } from './viewportSlicer';
