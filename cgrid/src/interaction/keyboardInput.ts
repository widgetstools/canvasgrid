import type { InputDeps } from './pointerInput';

export class KeyboardInput {
  private keyDown = (e: KeyboardEvent) => {
    const sel = this.deps.selectionModel;
    const rows = this.deps.visibleRowIndices();
    const cols = this.deps.visibleColIds();
    if (rows.length === 0 || cols.length === 0) return;
    const { focusedRowIndex: fr, focusedColId: fc } = sel.state;

    if (e.key === 'ArrowDown') {
      const idx = fr == null ? rows[0]! : Math.min(rows[rows.length - 1]!, fr + 1);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const idx = fr == null ? rows[0]! : Math.max(rows[0]!, fr - 1);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      const ci = fc == null ? 0 : Math.min(cols.length - 1, cols.indexOf(fc) + 1);
      sel.setFocus(fr ?? rows[0]!, cols[ci]!);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      const ci = fc == null ? 0 : Math.max(0, cols.indexOf(fc) - 1);
      sel.setFocus(fr ?? rows[0]!, cols[ci]!);
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
