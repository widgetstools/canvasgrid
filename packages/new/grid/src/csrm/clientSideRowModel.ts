import type { ColDef, FilterModel, SortModel } from '../types/options';

/**
 * In-process CSRM — Filter → Sort (Group/Pivot/Agg land in groupPivot.ts).
 * Worker offload is a later port of the known pass algorithms; behavior contracts match.
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
    let rows = this.raw.slice();
    rows = this.applyFilters(rows);
    rows = this.applyQuickFilter(rows);
    rows = this.applySort(rows);
    this.view = rows;
  }

  private applyFilters(rows: T[]): T[] {
    const entries = Object.entries(this.filterModel);
    if (entries.length === 0) return rows;
    return rows.filter((row) => {
      for (const [colId, f] of entries) {
        const raw = row[colId];
        if (f.filterType === 'text') {
          const s = String(raw ?? '').toLowerCase();
          const needle = String(f.filter ?? '').toLowerCase();
          if (f.type === 'contains' && needle && !s.includes(needle)) return false;
          if (f.type === 'equals' && s !== needle) return false;
          if (f.type === 'notContains' && needle && s.includes(needle)) return false;
          if (f.type === 'startsWith' && needle && !s.startsWith(needle)) return false;
          if (f.type === 'endsWith' && needle && !s.endsWith(needle)) return false;
        } else if (f.filterType === 'number') {
          const n = Number(raw);
          const v = Number(f.filter);
          if (f.type === 'equals' && n !== v) return false;
          if (f.type === 'greaterThan' && !(n > v)) return false;
          if (f.type === 'lessThan' && !(n < v)) return false;
        } else if (f.filterType === 'set') {
          if (!f.values.map(String).includes(String(raw ?? ''))) return false;
        }
      }
      return true;
    });
  }

  private applyQuickFilter(rows: T[]): T[] {
    const terms = this.quickFilterText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return rows;
    const fields = this.columns().map((c) => c.field ?? c.colId).filter(Boolean) as string[];
    return rows.filter((row) => {
      const hay = fields.map((f) => String(row[f] ?? '')).join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  private applySort(rows: T[]): T[] {
    if (this.sortModel.length === 0) return rows;
    const model = this.sortModel;
    return rows.slice().sort((a, b) => {
      for (const s of model) {
        const av = a[s.colId];
        const bv = b[s.colId];
        let cmp = 0;
        if (av == null && bv == null) cmp = 0;
        else if (av == null) cmp = -1;
        else if (bv == null) cmp = 1;
        else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }
}
