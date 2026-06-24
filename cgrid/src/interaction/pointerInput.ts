import type { HitTester, Hit } from './hitTester';
import type { SelectionModel } from './selectionModel';

export interface InputDeps {
  canvas: HTMLCanvasElement;
  hitTester: HitTester;
  selectionModel: SelectionModel;
  visibleColIds: () => string[];
  visibleRowIndices: () => number[];
  /** All column IDs in render order (pinned-left + body + pinned-right). Used by keyboard nav so arrows can step past the visible window. */
  allColIds: () => string[];
  /** Total row count after filter/sort. Used by keyboard nav. */
  totalRowCount: () => number;
  onCellClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => void;
  onCellDoubleClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => void;
  onHeaderClicked?: (colId: string, mouse: MouseEvent) => void;
  onColumnResize?: (colId: string, deltaPx: number) => void;
  onScroll?: (dx: number, dy: number) => void;
  /** Called during scrollbar-thumb drag. The grid recomputes its absolute scroll position. */
  onScrollTo?: (axis: 'x' | 'y', startScroll: number, deltaPx: number) => void;
  /** Called when the user clicks the scrollbar track outside the thumb. Sign indicates direction. */
  onPageScroll?: (axis: 'x' | 'y', direction: -1 | 1) => void;
  /** Read the current scroll position. Used to anchor a thumb-drag's startScroll. */
  getScrollPosition?: () => { x: number; y: number };
}

export class PointerInput {
  private downAt: { x: number; y: number; hit: Hit } | null = null;
  private resizing: { colId: string; startX: number } | null = null;
  private dragScroll: { axis: 'x' | 'y'; startMouse: number; startScroll: number } | null = null;

  private mouseDown = (e: MouseEvent) => {
    const { x, y } = this.toLocal(e);
    const hit = this.deps.hitTester.locate(x, y);
    this.downAt = { x, y, hit };
    if (hit.kind === 'headerResizer' && this.deps.onColumnResize) {
      this.resizing = { colId: hit.colId, startX: x };
      window.addEventListener('mousemove', this.mouseMove);
      window.addEventListener('mouseup', this.mouseUp, { once: true });
      return;
    }
    if (hit.kind === 'scrollbarThumb' && this.deps.onScrollTo) {
      const start = this.deps.getScrollPosition?.() ?? { x: 0, y: 0 };
      this.dragScroll = {
        axis: hit.axis,
        startMouse: hit.axis === 'y' ? y : x,
        startScroll: hit.axis === 'y' ? start.y : start.x,
      };
      window.addEventListener('mousemove', this.mouseMove);
      window.addEventListener('mouseup', this.mouseUp, { once: true });
      return;
    }
    if (hit.kind === 'scrollbarTrack' && this.deps.onPageScroll) {
      this.deps.onPageScroll(hit.axis, hit.before ? -1 : 1);
    }
  };

  private mouseMove = (e: MouseEvent) => {
    if (this.resizing) {
      const { x } = this.toLocal(e);
      const dx = x - this.resizing.startX;
      if (dx) {
        this.deps.onColumnResize?.(this.resizing.colId, dx);
        this.resizing.startX = x;
      }
      return;
    }
    if (this.dragScroll && this.deps.onScrollTo) {
      const { x, y } = this.toLocal(e);
      const m = this.dragScroll.axis === 'y' ? y : x;
      const dm = m - this.dragScroll.startMouse;
      this.deps.onScrollTo(this.dragScroll.axis, this.dragScroll.startScroll, dm);
      return;
    }
  };

  private mouseUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', this.mouseMove);
    if (!this.downAt) return;
    const { x, y } = this.toLocal(e);
    const hit = this.deps.hitTester.locate(x, y);
    if (this.resizing) { this.resizing = null; this.downAt = null; return; }
    if (this.dragScroll) { this.dragScroll = null; this.downAt = null; return; }
    if (hit.kind === 'cell' && this.downAt.hit.kind === 'cell' &&
        hit.rowIndex === this.downAt.hit.rowIndex && hit.colId === this.downAt.hit.colId) {
      this.deps.selectionModel.setFocus(hit.rowIndex, hit.colId);
      if (e.shiftKey) {
        const prevFocus = this.deps.selectionModel.state.focusedRowIndex;
        if (prevFocus != null) this.deps.selectionModel.range(prevFocus, hit.rowIndex);
      } else if (e.ctrlKey || e.metaKey) {
        this.deps.selectionModel.toggleMulti(hit.rowIndex);
      } else {
        this.deps.selectionModel.selectSingle(hit.rowIndex);
      }
      this.deps.onCellClicked(hit.rowIndex, hit.colId, e);
    } else if (hit.kind === 'header' && this.downAt.hit.kind === 'header' &&
               hit.colId === this.downAt.hit.colId) {
      this.deps.onHeaderClicked?.(hit.colId, e);
    }
    this.downAt = null;
  };

  /** Bare mousemove on the canvas (NOT the resize drag) — updates the hover cursor. */
  private hoverMove = (e: MouseEvent) => {
    if (this.resizing || this.dragScroll) return;
    const { x, y } = this.toLocal(e);
    const hit = this.deps.hitTester.locate(x, y);
    let cursor = 'default';
    if (hit.kind === 'headerResizer') cursor = 'col-resize';
    else if (hit.kind === 'header') cursor = 'pointer';
    else if (hit.kind === 'scrollbarThumb' || hit.kind === 'scrollbarTrack') cursor = 'default';
    if (this.deps.canvas.style.cursor !== cursor) this.deps.canvas.style.cursor = cursor;
  };

  private dblClick = (e: MouseEvent) => {
    const { x, y } = this.toLocal(e);
    const hit = this.deps.hitTester.locate(x, y);
    if (hit.kind === 'cell') this.deps.onCellDoubleClicked(hit.rowIndex, hit.colId, e);
  };

  private wheel = (e: WheelEvent) => {
    if (!this.deps.onScroll) return;
    e.preventDefault();
    this.deps.onScroll(e.deltaX, e.deltaY);
  };

  constructor(private deps: InputDeps) {
    deps.canvas.addEventListener('mousedown', this.mouseDown);
    deps.canvas.addEventListener('mouseup', this.mouseUp);
    deps.canvas.addEventListener('dblclick', this.dblClick);
    deps.canvas.addEventListener('mousemove', this.hoverMove);
    deps.canvas.addEventListener('wheel', this.wheel, { passive: false });
  }

  destroy(): void {
    this.deps.canvas.removeEventListener('mousedown', this.mouseDown);
    this.deps.canvas.removeEventListener('mouseup', this.mouseUp);
    this.deps.canvas.removeEventListener('dblclick', this.dblClick);
    this.deps.canvas.removeEventListener('mousemove', this.hoverMove);
    this.deps.canvas.removeEventListener('wheel', this.wheel);
    // Remove the window-level mousemove listener that is attached during a column resize drag.
    // The mouseup once-listener self-removes, but mousemove is permanent until destroy.
    window.removeEventListener('mousemove', this.mouseMove);
    this.resizing = null;
    this.downAt = null;
  }

  private toLocal(e: MouseEvent): { x: number; y: number } {
    const rect = this.deps.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}
