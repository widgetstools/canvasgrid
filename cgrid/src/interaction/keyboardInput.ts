import type { InputDeps } from './pointerInput';

/**
 * Maps arrow keys, Tab, Space, F2/Enter, and Escape to selection/focus moves.
 *
 * Uses TOTAL bounds (rowCount + allColIds), not visible bounds, so the user
 * can navigate past the current viewport — the grid's auto-scroll-to-focus
 * (CGrid.selection.onChange) brings the new focus into view.
 *
 * Tab moves to the next column; Shift+Tab moves to the previous column. Both
 * wrap to the next/previous row when reaching the end of the column list.
 */
export class KeyboardInput {
  private keyDown = (e: KeyboardEvent) => {
    const sel = this.deps.selectionModel;
    const cols = this.deps.allColIds();
    const rowCount = this.deps.totalRowCount();
    if (rowCount === 0 || cols.length === 0) return;
    const { focusedRowIndex: fr, focusedColId: fc } = sel.state;
    const ci = fc == null ? 0 : Math.max(0, cols.indexOf(fc));

    if (e.key === 'ArrowDown') {
      const idx = fr == null ? 0 : Math.min(rowCount - 1, fr + 1);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const idx = fr == null ? 0 : Math.max(0, fr - 1);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      const nextCi = Math.min(cols.length - 1, ci + 1);
      sel.setFocus(fr ?? 0, cols[nextCi]!);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      const nextCi = Math.max(0, ci - 1);
      sel.setFocus(fr ?? 0, cols[nextCi]!);
      e.preventDefault();
    } else if (e.key === 'PageDown') {
      const visibleRows = this.deps.visibleRowIndices();
      const page = Math.max(1, visibleRows.length);
      const idx = Math.min(rowCount - 1, (fr ?? 0) + page);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'PageUp') {
      const visibleRows = this.deps.visibleRowIndices();
      const page = Math.max(1, visibleRows.length);
      const idx = Math.max(0, (fr ?? 0) - page);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'Home') {
      sel.setFocus(fr ?? 0, cols[0]!);
      e.preventDefault();
    } else if (e.key === 'End') {
      sel.setFocus(fr ?? 0, cols[cols.length - 1]!);
      e.preventDefault();
    } else if (e.key === 'Tab') {
      // Tab → next cell across (wrapping rows). Shift+Tab → previous.
      let nextRow = fr ?? 0;
      let nextCi: number;
      if (e.shiftKey) {
        nextCi = ci - 1;
        if (nextCi < 0) { nextRow = Math.max(0, nextRow - 1); nextCi = cols.length - 1; }
      } else {
        nextCi = ci + 1;
        if (nextCi >= cols.length) { nextRow = Math.min(rowCount - 1, nextRow + 1); nextCi = 0; }
      }
      sel.setFocus(nextRow, cols[nextCi]!);
      e.preventDefault();
    } else if (e.key === ' ' && fr != null) {
      sel.toggleMulti(fr);
      e.preventDefault();
    } else if ((e.key === 'F2' || e.key === 'Enter') && fr != null && fc != null) {
      this.deps.onCellDoubleClicked(fr, fc, e as unknown as MouseEvent);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      sel.clear();
    }
  };

  constructor(private deps: InputDeps) {
    deps.canvas.tabIndex = 0;
    deps.canvas.addEventListener('keydown', this.keyDown);
  }

  destroy(): void {
    this.deps.canvas.removeEventListener('keydown', this.keyDown);
  }
}
