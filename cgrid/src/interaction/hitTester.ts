import type { ViewportState, ViewportColumn, ViewportRow } from '../core/viewport';

export type Hit =
  | { kind: 'header'; colId: string }
  | { kind: 'headerGroup'; groupId: string; colId: string }
  | { kind: 'headerResizer'; colId: string }
  | { kind: 'cell'; rowIndex: number; colId: string }
  | { kind: 'pinnedSplitter'; side: 'left' | 'right' }
  | { kind: 'empty' };

export class HitTester {
  constructor(
    private readonly getViewport: () => ViewportState,
    private readonly getHeaderHeight: () => number,
    private readonly getResizerHotZone: () => number,
  ) {}

  locate(x: number, y: number): Hit {
    const vs = this.getViewport();
    const hot = this.getResizerHotZone();

    // Header region spans `bodyTop` — sum of every header subgrid's height,
    // which includes group-header rows above the leaf header.
    if (y < vs.bodyTop) {
      const col = this.findCol(vs, x);
      if (!col) return { kind: 'empty' };
      const row = this.findRow(vs, y);
      // Group-header rows expose `getGroupIdAt`; the leaf HeaderSubgrid does not.
      if (row && 'getGroupIdAt' in row.subgrid) {
        const groupId = (row.subgrid as { getGroupIdAt(c: string): string | null }).getGroupIdAt(col.colId);
        if (groupId) return { kind: 'headerGroup', groupId, colId: col.colId };
      }
      if (x >= col.right - hot) return { kind: 'headerResizer', colId: col.colId };
      return { kind: 'header', colId: col.colId };
    }

    if (y >= vs.bodyTop && y <= vs.bodyBottom) {
      const col = this.findCol(vs, x);
      const row = this.findRow(vs, y);
      // Hits only count when they land in a DataSubgrid row — header / totals
      // rows are handled separately. `localRowIndex` is the data-row index.
      if (col && row && row.subgrid.isData) {
        return { kind: 'cell', rowIndex: row.localRowIndex, colId: col.colId };
      }
    }

    return { kind: 'empty' };
  }

  /** Binary search over visibleColumns (sorted by left ascending). */
  private findCol(vs: ViewportState, x: number): ViewportColumn | null {
    const cols = vs.visibleColumns;
    let lo = 0;
    let hi = cols.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = cols[mid]!;
      if (x < c.left) {
        hi = mid - 1;
      } else if (x >= c.right) {
        lo = mid + 1;
      } else {
        return c;
      }
    }
    return null;
  }

  /** Binary search over visibleRows (sorted by top ascending). */
  private findRow(vs: ViewportState, y: number): ViewportRow | null {
    const rows = vs.visibleRows;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = rows[mid]!;
      if (y < r.top) {
        hi = mid - 1;
      } else if (y >= r.bottom) {
        lo = mid + 1;
      } else {
        return r;
      }
    }
    return null;
  }
}
