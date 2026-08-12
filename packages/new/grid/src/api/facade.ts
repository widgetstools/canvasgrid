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
  /** Format ribbon patches (undoable until layout save). */
  applyFormatPatch(patch: {
    colIds: string[];
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    align?: 'left' | 'center' | 'right';
    format?: string;
    foreground?: string;
    background?: string;
  }): void;
  undoFormat(): boolean;
  redoFormat(): boolean;
  clearFormat(): void;
  setStyleRules(rules: Array<{
    id: string;
    expression: string;
    style: { backgroundColor?: string; color?: string; fontWeight?: string };
    colIds?: string[];
    enabled?: boolean;
    priority?: number;
  }>): void;
  setCalcColumns(cols: Array<{ alias: string; expression: string; headerName?: string }>): void;
  setAlertRules(rules: Array<{
    id: string;
    expression: string;
    channels: Array<'toast' | 'badge' | 'openfin'>;
    messageTemplate?: string;
    column?: string;
  }>): void;
  applyEditOp(
    colId: string,
    rowIds: string[],
    op:
      | { type: 'multiply'; factor: number }
      | { type: 'divide'; factor: number }
      | { type: 'add'; delta: number }
      | { type: 'subtract'; delta: number }
      | { type: 'set'; value: unknown }
      | { type: 'nudge'; steps: number; stepSize: number },
  ): void;
  undoEdit(): boolean;
  redoEdit(): boolean;
  getUnreadAlertCount(): number;
  getEngines(): unknown;
  destroy(): void;
};
