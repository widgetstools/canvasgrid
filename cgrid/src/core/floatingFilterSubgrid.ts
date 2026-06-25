import type { Subgrid, SubgridCell, SubgridType } from './subgrid';

/**
 * A second header row, slotted between the leaf `HeaderSubgrid` and the
 * `DataSubgrid`. Carries no value paint — the actual interactive cells
 * are DOM `<input>` elements mounted by `FloatingFilterOverlay`. Canvas
 * paint for this row is just the row background + bottom border;
 * `getCell` returns `null` so the painter skips text.
 *
 * Cycle 7 / Task 1.
 */
export class FloatingFilterSubgrid implements Subgrid {
  readonly type: SubgridType = 'floatingFilter';
  readonly isHeader = false;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;
  readonly isFloatingFilter = true;

  constructor(
    private getHeight: () => number,
    private getEnabled: () => boolean,
  ) {}

  getRowCount(): number { return this.getEnabled() ? 1 : 0; }
  getRowHeight(_local: number): number { return this.getHeight(); }
  getCell(_local: number, _colId: string): SubgridCell | null { return null; }
}
