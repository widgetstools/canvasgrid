import type {
  TransactionResult, FilterModel, FilterModelEntry, FilterModelEntryLegacy,
  CFilterModelEntry, CTextFilterModel, CNumberFilterModel, CDateFilterModel,
  CMultiConditionFilterModel,
  SortModel,
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

export class FilterPass<TRow = any> {
  private model: FilterModel = {};
  private colIndex = new Map<string, WorkerColumn>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  setModel(model: FilterModel): void {
    this.model = model;
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
          ? matchesV2(rawEntry as CFilterModelEntry, value, col)
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
function matchesV2(entry: CFilterModelEntry, raw: unknown, col?: WorkerColumn): boolean {
  if (entry.filterType === 'multi') {
    return matchesMulti(entry, raw, col);
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
  return false;
}

function matchesMulti(
  entry: CMultiConditionFilterModel,
  raw: unknown,
  col?: WorkerColumn,
): boolean {
  // Empty conditions array is treated as "no constraint" — `null`-shaped
  // entries don't reach the worker (cgrid drops them in
  // setColumnFilterModel), so this is purely defensive.
  if (entry.conditions.length === 0) return true;
  if (entry.operator === 'AND') {
    for (const c of entry.conditions) {
      if (!matchesV2(c, raw, col)) return false;
    }
    return true;
  }
  // OR — short-circuit on the first pass.
  for (const c of entry.conditions) {
    if (matchesV2(c, raw, col)) return true;
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

export class SortPass<TRow = any> {
  private model: SortModel = [];
  private colIndex = new Map<string, WorkerColumn>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  setModel(model: SortModel): void { this.model = model; }

  setColumns(columns: WorkerColumn[]): void {
    this.colIndex.clear();
    for (const col of columns) this.colIndex.set(col.colId, col);
  }

  apply(inputIds: string[]): string[] {
    if (this.model.length === 0) return inputIds;
    const sorted = inputIds.slice();
    sorted.sort((aId, bId) => {
      const aRow = this.store.getById(aId);
      const bRow = this.store.getById(bId);
      if (!aRow || !bRow) return 0;
      for (const entry of this.model) {
        const col = this.colIndex.get(entry.colId);
        if (!col || !col.field) continue;
        const av = (aRow as Record<string, unknown>)[col.field];
        const bv = (bRow as Record<string, unknown>)[col.field];
        const cmp = compare(av, bv, col.type);
        if (cmp !== 0) return entry.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
    return sorted;
  }
}

function compare(a: unknown, b: unknown, type: 'text' | 'number'): number {
  if (type === 'number') {
    const an = Number(a), bn = Number(b);
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return  1;
    if (Number.isNaN(bn)) return -1;
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  const as = String(a ?? '');
  const bs = String(b ?? '');
  return as < bs ? -1 : as > bs ? 1 : 0;
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

  slice(visibleIds: string[], req: ViewportRequest): ViewportChunk {
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

    return {
      rowStart,
      rowCount: count,
      rowIds,
      rowKinds,
      groupDepth,
      heights,
      numericCols,
      textCols,
    };
  }
}

export class AggPass<TRow = any> {
  private aggCols: Array<{ colId: string; field: string; func: NonNullable<WorkerColumn['aggFunc']> }> = [];

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  setColumns(columns: WorkerColumn[]): void {
    this.aggCols = [];
    for (const col of columns) {
      if (col.aggFunc && col.field) {
        this.aggCols.push({ colId: col.colId, field: col.field, func: col.aggFunc });
      }
    }
  }

  apply(inputIds: string[]): { totals: Record<string, number | null> } {
    const totals: Record<string, number | null> = {};
    for (const { colId, field, func } of this.aggCols) {
      let sum = 0, count = 0, min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY;
      for (const id of inputIds) {
        const row = this.store.getById(id);
        if (!row) continue;
        if (func === 'count') { count++; continue; }
        const v = Number((row as Record<string, unknown>)[field]);
        if (Number.isNaN(v)) continue;
        sum += v;
        count++;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (func === 'sum')   totals[colId] = sum;
      else if (func === 'count') totals[colId] = count;
      else if (count === 0) totals[colId] = null;
      else if (func === 'avg') totals[colId] = sum / count;
      else if (func === 'min') totals[colId] = min;
      else if (func === 'max') totals[colId] = max;
    }
    return { totals };
  }
}
