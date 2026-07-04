import type { Subgrid, SubgridCell } from './subgrid';

/** Toolbar subgrid — single-row container for toolbar buttons and controls.
 *  Sits at the top of the grid, above column headers. Height is configurable.
 *  Cycle 21i / Customization. */
export class ToolbarSubgrid implements Subgrid {
  readonly type = 'floatingFilter' as const; // Uses floatingFilter type as toolbar is a chrome row
  readonly isHeader = false;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;
  readonly isToolbar = true; // Custom flag for toolbar

  constructor(
    private getHeight: () => number,
    private isVisible: () => boolean,
  ) {}

  getRowCount(): number {
    return this.isVisible() ? 1 : 0;
  }

  getRowHeight(_localRowIndex: number): number {
    return this.isVisible() ? this.getHeight() : 0;
  }

  getCell(_localRowIndex: number, _colId: string): SubgridCell | null {
    // Toolbar content is rendered via overlay, not via cells
    return null;
  }
}
