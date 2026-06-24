import type { TransactionResult, FilterModel, FilterModelEntry, SortModel } from '../types';
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

  constructor(private rowIdField: string) {}

  setAll(rows: TRow[]): void {
    this.byId.clear();
    this.order.length = 0;
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
  }

  apply(tx: { add?: TRow[]; update?: TRow[]; remove?: string[] }): TransactionResult {
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
          result.remove.push({ rowId: id });
        }
      }
    }
    return result;
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

export class TransactionQueue<TRow = any> {
  private pending: { add?: TRow[]; update?: TRow[]; remove?: string[] }[] = [];
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
  setFlushFn(fn: (txs: { add?: TRow[]; update?: TRow[]; remove?: string[] }[]) => TransactionResult[]): void {
    this.flushFn = () => {
      const queued = this.pending;
      this.pending = [];
      this.timer = null;
      if (queued.length === 0) return;
      const results = fn(queued);
      this.opts.onFlush(results);
    };
  }

  push(tx: { add?: TRow[]; update?: TRow[]; remove?: string[] }): void {
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
      for (const [colId, entry] of entries) {
        const col = this.colIndex.get(colId);
        if (!col || !col.field) continue;
        const value = (row as Record<string, unknown>)[col.field];
        if (!matches(entry, value)) { pass = false; break; }
      }
      if (pass) out.push(this.store.getRowId(row));
    }
    return out;
  }
}

function matches(entry: FilterModelEntry, raw: unknown): boolean {
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

    for (let i = 0; i < count; i++) {
      const id = visibleIds[rowStart + i]!;
      rowIds[i] = this.store.getNumericId(id);
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
