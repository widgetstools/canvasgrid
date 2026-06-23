export interface A11yState {
  visibleRowCount: number;
  columnCount: number;
  focusedRowIndex: number | null;
  focusedColId: string | null;
  focusedRowData: { colId: string; valueFormatted: string }[];
}

const HIDDEN_STYLE =
  'position:absolute; left:0; top:0; clip:rect(0 0 0 0); width:1px; height:1px; overflow:hidden;';

export class A11yOverlay {
  private grid: HTMLDivElement;
  private row: HTMLDivElement;

  constructor(private container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'cg-a11y-root';
    root.style.cssText = HIDDEN_STYLE;
    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    grid.appendChild(row);
    root.appendChild(grid);
    container.appendChild(root);
    this.grid = grid;
    this.row = row;
  }

  update(state: A11yState): void {
    this.grid.setAttribute('aria-rowcount', String(state.visibleRowCount));
    this.grid.setAttribute('aria-colcount', String(state.columnCount));
    if (state.focusedRowIndex !== null) {
      this.row.setAttribute('aria-rowindex', String(state.focusedRowIndex + 1));
    }
    // Clear + rebuild focused row's cells
    while (this.row.firstChild) this.row.removeChild(this.row.firstChild);
    state.focusedRowData.forEach((cell, i) => {
      const c = document.createElement('div');
      c.setAttribute('role', 'gridcell');
      c.setAttribute('aria-colindex', String(i + 1));
      c.setAttribute('aria-label', `${cell.colId}: ${cell.valueFormatted}`);
      c.tabIndex = -1;
      this.row.appendChild(c);
    });
  }

  destroy(): void {
    const root = this.grid.parentElement;
    if (root && root.parentElement) root.parentElement.removeChild(root);
  }
}
