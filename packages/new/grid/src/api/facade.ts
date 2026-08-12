import type { FilterModel, SortModel } from '../types/options';

/** Public API surface — Markets / AG-familiar. */
export type VelocityGridApi<T = unknown> = {
  setRowData(rows: T[]): void;
  applyTransaction(tx: { add?: T[]; update?: T[]; remove?: Array<string | T> }): void;
  /** Async path — conflates / defers while scrolling when options enable it. */
  applyTransactionAsync(tx: { add?: T[]; update?: T[]; remove?: Array<string | T> }): void;
  flushAsyncTransactions(): void;
  applyServerSideTransaction(tx: { update?: T[] }): void;
  refreshServerSide(params?: { purge?: boolean }): void;
  setSortModel(model: SortModel): void;
  getSortModel(): SortModel;
  setFilterModel(model: FilterModel): void;
  getFilterModel(): FilterModel;
  setQuickFilterText(text: string): void;
  getQuickFilterText(): string;
  setRowGroupColumns(cols: string[]): void;
  getRowGroupColumns(): string[];
  setExpanded(key: string, open: boolean): void;
  expandAll(): void;
  collapseAll(): void;
  setGroupSelected(groupKey: string, on: boolean): void;
  getGroupSelectionState(groupKey: string): 'all' | 'none' | 'partial';
  getStickyAncestors(rowStart: number): Array<{
    depth: number;
    key: string;
    colId: string;
    value: string;
    childCount: number;
    isExpanded: boolean;
  }>;
  setPivotMode(on: boolean): void;
  isPivotMode(): boolean;
  /** Explicit pipeline path only — fail-closed when sparse/grouped. */
  ensureFullyHydrated(): Promise<boolean>;
  refillServerSideColumnKeys(): void;
  getSelectedRows(): T[];
  deselectAll(): void;
  sizeColumnsToFit(): void;
  getRowCount(): number;
  destroy(): void;
};
