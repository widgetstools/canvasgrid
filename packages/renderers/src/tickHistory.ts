// @cgrid/renderers — main-side per-cell rolling tick history. §2.4b.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md §2.4b.
//
// Bounded ring buffers per (rowId, colId) for opted-in columns (`window` size
// per column, default 60); fed by rowsChanged; supplies arrays to the sparkline
// family and SpreadBarCell's rolling-σ band. O(1) push, evicts on row removal.
// Memory: window × liveRows × 8 bytes per opted-in column (Float64Array entries).

import type { CGridApi } from '@cgrid/kernel';

/** Per-column ring-buffer options (§2.4b). */
export interface TickHistoryColumnOptions {
  window?: number;
}

/** Default ring-buffer window size when a column opts in via `{}`. */
export const DEFAULT_TICK_HISTORY_WINDOW = 60;

interface RingBuffer {
  window: number;
  data: Float64Array;
  writeIndex: number;
  count: number;
}

type RowsChangedEvent<TRow> = {
  type: 'rowsChanged';
  added: Array<{ rowId: string; row: TRow }>;
  updated: Array<{ rowId: string; row: TRow; oldRow: TRow }>;
  removed: Array<{ rowId: string; row: TRow }>;
  source: 'transaction' | 'transactionAsync' | 'edit';
};

function makeRingBuffer(window: number): RingBuffer {
  return { window, data: new Float64Array(window), writeIndex: 0, count: 0 };
}

function ringPush(buf: RingBuffer, value: number): void {
  buf.data[buf.writeIndex] = value;
  buf.writeIndex = (buf.writeIndex + 1) % buf.window;
  if (buf.count < buf.window) buf.count += 1;
}

function ringMaterialize(buf: RingBuffer): number[] {
  const { count, window, data, writeIndex } = buf;
  if (count === 0) return [];
  const out = new Array<number>(count);
  if (count < window) {
    for (let i = 0; i < count; i++) out[i] = data[i] as number;
    return out;
  }
  let j = 0;
  for (let i = writeIndex; i < window; i++) out[j++] = data[i] as number;
  for (let i = 0; i < writeIndex; i++) out[j++] = data[i] as number;
  return out;
}

/**
 * Bounded per-(rowId, colId) rolling value history for opted-in columns.
 * `CGridApi` is a peerDependency type-only import — erased at runtime.
 */
export class TickHistory<TRow = unknown> {
  private readonly _columns: Readonly<Record<string, TickHistoryColumnOptions>>;
  private readonly _windows: Map<string, number>;
  private readonly _buffers: Map<string, Map<string, RingBuffer>>;
  private readonly _valueGetter: (row: TRow, colId: string) => unknown;
  private readonly _handler: (e: RowsChangedEvent<TRow>) => void;
  private readonly _grid: CGridApi<TRow>;

  constructor(
    grid: CGridApi<TRow>,
    columns: Record<string, TickHistoryColumnOptions>,
    opts?: { valueGetter?: (row: TRow, colId: string) => unknown },
  ) {
    this._grid = grid;
    this._columns = columns;
    this._windows = new Map(
      Object.entries(columns).map(([colId, opts]) => [
        colId,
        opts.window ?? DEFAULT_TICK_HISTORY_WINDOW,
      ]),
    );
    this._buffers = new Map();
    this._valueGetter = opts?.valueGetter ?? ((row, colId) => (row as Record<string, unknown>)[colId]);

    this._handler = (e: RowsChangedEvent<TRow>) => {
      for (const { rowId, row } of e.added) {
        for (const colId of this._windows.keys()) {
          this._pushFromRow(rowId, colId, row);
        }
      }
      for (const { rowId, row } of e.updated) {
        for (const colId of this._windows.keys()) {
          this._pushFromRow(rowId, colId, row);
        }
      }
      for (const { rowId } of e.removed) {
        this._buffers.delete(rowId);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    grid.addEventListener('rowsChanged', this._handler as any);

    grid.forEachRow((rowId, row) => {
      for (const colId of this._windows.keys()) {
        this._pushFromRow(rowId, colId, row);
      }
    });
  }

  /** O(1) ring-buffer push for one (rowId, colId) cell. */
  push(rowId: string, colId: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const window = this._windows.get(colId);
    if (window === undefined) return;
    ringPush(this._bufferFor(rowId, colId, window), value);
  }

  /**
   * Materialises oldest→newest history for one cell. O(window) allocation per
   * call — acceptable when invoked ≤ once per repaint per cell.
   */
  get(rowId: string, colId: string): readonly number[] {
    const colBufs = this._buffers.get(rowId);
    if (colBufs === undefined) return [];
    const buf = colBufs.get(colId);
    if (buf === undefined) return [];
    return ringMaterialize(buf);
  }

  /** Removes the rowsChanged subscription and clears all buffers. */
  destroy(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._grid.removeEventListener('rowsChanged', this._handler as any);
    this._buffers.clear();
  }

  private _pushFromRow(rowId: string, colId: string, row: TRow): void {
    const window = this._windows.get(colId);
    if (window === undefined) return;
    const raw = this._valueGetter(row, colId);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
    ringPush(this._bufferFor(rowId, colId, window), raw);
  }

  private _bufferFor(rowId: string, colId: string, window: number): RingBuffer {
    let colBufs = this._buffers.get(rowId);
    if (colBufs === undefined) {
      colBufs = new Map();
      this._buffers.set(rowId, colBufs);
    }
    let buf = colBufs.get(colId);
    if (buf === undefined) {
      buf = makeRingBuffer(window);
      colBufs.set(colId, buf);
    }
    return buf;
  }
}
