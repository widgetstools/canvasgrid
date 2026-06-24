import type { ResolvedColDef } from './propertyChain';

/**
 * Subgrid model — ported from hypergrid's behaviors/subgrids.
 *
 * The grid splits vertically into N subgrids stacked top→bottom. Each subgrid
 * owns its own row data and answers `getRowCount` / `getRowHeight` / `getCell`.
 * `computeViewport` walks the subgrid list to build `visibleRows`, tagging each
 * row with its owning subgrid + local index.
 *
 * Today the stack is `[HeaderSubgrid, DataSubgrid]`. Adding a totals row is a
 * `new TotalsSubgrid()` push — no painter or viewport change required.
 */

export type SubgridType = 'header' | 'data' | 'totals' | 'footer';

export interface SubgridCell {
  value: unknown;
  valueFormatted: string;
}

export interface Subgrid {
  readonly type: SubgridType;
  readonly isHeader: boolean;
  readonly isData: boolean;
  readonly isTotals: boolean;
  readonly isFooter: boolean;
  /** Rows this subgrid contributes to the visible stack. */
  getRowCount(): number;
  /** Per-row height. Most subgrids return a constant. */
  getRowHeight(localRowIndex: number): number;
  /**
   * Cell lookup for a given local row + column. For HeaderSubgrid this returns
   * the column's headerName; for DataSubgrid it delegates to the worker chunk.
   */
  getCell(localRowIndex: number, colId: string): SubgridCell | null;
}

export class HeaderSubgrid implements Subgrid {
  readonly type = 'header' as const;
  readonly isHeader = true;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;

  constructor(
    private columnDefs: Map<string, ResolvedColDef>,
    private getHeaderHeight: () => number,
  ) {}

  getRowCount(): number { return 1; }
  getRowHeight(_local: number): number { return this.getHeaderHeight(); }
  getCell(_local: number, colId: string): SubgridCell | null {
    const def = this.columnDefs.get(colId);
    if (!def) return null;
    return { value: def.headerName, valueFormatted: def.headerName };
  }
}

export type DataCellLookup = (
  rowIndex: number,
  colId: string,
) => SubgridCell | null;

export class DataSubgrid implements Subgrid {
  readonly type = 'data' as const;
  readonly isHeader = false;
  readonly isData = true;
  readonly isTotals = false;
  readonly isFooter = false;

  constructor(
    private getRowCountFn: () => number,
    private getRowHeightFn: () => number,
    private cellAt: DataCellLookup,
  ) {}

  getRowCount(): number { return this.getRowCountFn(); }
  getRowHeight(_local: number): number { return this.getRowHeightFn(); }
  getCell(local: number, colId: string): SubgridCell | null {
    return this.cellAt(local, colId);
  }
}
