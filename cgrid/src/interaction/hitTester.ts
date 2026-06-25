import type { ViewportState, ViewportColumn, ViewportRow } from '../core/viewport';

export type Hit =
  | { kind: 'header'; colId: string }
  | { kind: 'headerGroup'; groupId: string; colId: string }
  /** `edge` records which side of the column the cursor hit:
   *  - `'right'` (default) — left-pinned + center columns expose their right
   *    edge as the resizer, matching the long-standing UX.
   *  - `'left'`  — right-pinned columns also expose their LEFT edge as a
   *    resizer so the user can grow/shrink them from the side that's
   *    actually reachable (their right edge is at the canvas boundary).
   *    `ColumnResizing` inverts the drag delta sign for left-edge drags so
   *    "drag right shrinks, drag left grows" matches the visual intent. */
  | { kind: 'headerResizer'; colId: string; edge: 'left' | 'right' }
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
      // Right-pinned columns expose BOTH edges as resizers; the left edge
      // is the natural reach (the right edge of the rightmost pinned col
      // sits at the canvas boundary). Left-pinned + center columns only
      // expose their right edge, preserving the original UX.
      if (col.pinned === 'right' && x < col.left + hot) {
        return { kind: 'headerResizer', colId: col.colId, edge: 'left' };
      }
      if (x >= col.right - hot) return { kind: 'headerResizer', colId: col.colId, edge: 'right' };
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

  /** Zone-aware column lookup. Center columns can extend past `bodyRight`
   *  (they're painter-clipped, not viewport-clipped), so a naive binary
   *  search over the whole `visibleColumns` list returns the wrong column
   *  when the cursor is in the pinned-right zone — the overlapping center
   *  column wins. Partition by zone so the cursor only ever picks a column
   *  whose home zone matches:
   *    - x < bodyLeft  → left-pinned only
   *    - x >= bodyRight → right-pinned only
   *    - otherwise      → center columns only */
  private findCol(vs: ViewportState, x: number): ViewportColumn | null {
    const cols = vs.visibleColumns;
    let zone: 'left' | 'right' | 'center';
    if (x < vs.bodyLeft) zone = 'left';
    else if (x >= vs.bodyRight) zone = 'right';
    else zone = 'center';
    for (const c of cols) {
      const home = c.pinned ?? 'center';
      if (home !== zone) continue;
      if (x >= c.left && x < c.right) return c;
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
