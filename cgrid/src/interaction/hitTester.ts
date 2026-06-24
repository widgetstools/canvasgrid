import type { ViewportState, ViewportColumn, ViewportRow } from '../core/viewport';
import { computeScrollbars } from '../core/scrollbarGeometry';

export type Hit =
  | { kind: 'header'; colId: string }
  | { kind: 'headerResizer'; colId: string }
  | { kind: 'cell'; rowIndex: number; colId: string }
  | { kind: 'pinnedSplitter'; side: 'left' | 'right' }
  | { kind: 'scrollbarThumb'; axis: 'x' | 'y' }
  | { kind: 'scrollbarTrack'; axis: 'x' | 'y'; before: boolean }
  | { kind: 'empty' };

export class HitTester {
  constructor(
    private readonly getViewport: () => ViewportState,
    private readonly getHeaderHeight: () => number,
    private readonly getResizerHotZone: () => number,
    private readonly getScrollbarThickness: () => number,
  ) {}

  locate(x: number, y: number): Hit {
    const vs = this.getViewport();
    const headerH = this.getHeaderHeight();
    const hot = this.getResizerHotZone();

    // Scrollbar hit-test first — they overlay the body region.
    const sb = computeScrollbars(vs, this.getScrollbarThickness());
    if (sb.vertical.visible) {
      const t = sb.vertical.thumb;
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) {
        return { kind: 'scrollbarThumb', axis: 'y' };
      }
      const tr = sb.vertical.track;
      if (x >= tr.x && x < tr.x + tr.w && y >= tr.y && y < tr.y + tr.h) {
        return { kind: 'scrollbarTrack', axis: 'y', before: y < t.y };
      }
    }
    if (sb.horizontal.visible) {
      const t = sb.horizontal.thumb;
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) {
        return { kind: 'scrollbarThumb', axis: 'x' };
      }
      const tr = sb.horizontal.track;
      if (x >= tr.x && x < tr.x + tr.w && y >= tr.y && y < tr.y + tr.h) {
        return { kind: 'scrollbarTrack', axis: 'x', before: x < t.x };
      }
    }

    if (y < headerH) {
      // Header zone.
      const col = this.findCol(vs, x);
      if (!col) return { kind: 'empty' };
      if (x >= col.right - hot) return { kind: 'headerResizer', colId: col.colId };
      return { kind: 'header', colId: col.colId };
    }

    if (y >= vs.bodyTop && y <= vs.bodyBottom) {
      const col = this.findCol(vs, x);
      const row = this.findRow(vs, y);
      if (col && row) return { kind: 'cell', rowIndex: row.rowIndex, colId: col.colId };
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
