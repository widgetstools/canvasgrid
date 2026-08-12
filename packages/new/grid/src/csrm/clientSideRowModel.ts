import type { ColDef, FilterModel, SortModel } from '../types/options';
import { runCsrmPipeline } from './pipeline';

/**
 * In-process CSRM — Filter → QuickFilter → Sort
 * (Group/Pivot/Agg in Phase 5).
 */
export class ClientSideRowModel<T extends Record<string, unknown>> {
  private raw: T[] = [];
  private view: T[] = [];
  private sortModel: SortModel = [];
  private filterModel: FilterModel = {};
  private quickFilterText = '';
  private rowGroupCols: string[] = [];

  constructor(
    private readonly getRowId: (row: T) => string,
    private readonly columns: () => ColDef<T>[],
  ) {}

  setRowData(rows: T[]): void {
    this.raw = rows.slice();
    this.recompute();
  }

  getRawRows(): T[] {
    return this.raw.slice();
  }

  applyTransaction(tx: { add?: T[]; update?: T[]; remove?: Array<string | T> }): void {
    if (tx.remove?.length) {
      const ids = new Set(
        tx.remove.map((r) => (typeof r === 'string' ? r : this.getRowId(r))),
      );
      this.raw = this.raw.filter((r) => !ids.has(this.getRowId(r)));
    }
    if (tx.update?.length) {
      const byId = new Map(tx.update.map((r) => [this.getRowId(r), r]));
      this.raw = this.raw.map((r) => byId.get(this.getRowId(r)) ?? r);
    }
    if (tx.add?.length) this.raw.push(...tx.add);
    this.recompute();
  }

  setSortModel(model: SortModel): void {
    this.sortModel = model.slice();
    this.recompute();
  }

  getSortModel(): SortModel {
    return this.sortModel.slice();
  }

  setFilterModel(model: FilterModel): void {
    this.filterModel = { ...model };
    this.recompute();
  }

  getFilterModel(): FilterModel {
    return { ...this.filterModel };
  }

  setQuickFilterText(text: string): void {
    this.quickFilterText = text;
    this.recompute();
  }

  setRowGroupColumns(cols: string[]): void {
    this.rowGroupCols = cols.slice();
    this.recompute();
  }

  getRowGroupColumns(): string[] {
    return this.rowGroupCols.slice();
  }

  getRowCount(): number {
    return this.view.length;
  }

  getRow(i: number): T | undefined {
    return this.view[i];
  }

  getRows(): T[] {
    return this.view.slice();
  }

  private recompute(): void {
    this.view = runCsrmPipeline({
      rows: this.raw,
      filterModel: this.filterModel,
      quickFilterText: this.quickFilterText,
      sortModel: this.sortModel,
      columns: this.columns(),
    });
  }
}
