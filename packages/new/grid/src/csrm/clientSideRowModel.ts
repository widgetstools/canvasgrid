import type { ColDef, FilterModel, SortModel } from '../types/options';
import {
  applyAggPass,
  applyGroupAggPass,
  type AggCol,
} from './aggPass';
import {
  applyGroupPass,
  collectDescendantRowIds,
  findGroupNode,
  type FlatOrderEntry,
  type GroupPassOutput,
} from './groupPass';
import { applyFilterPass, applyQuickFilterPass, applySortPass } from './pipeline';
import {
  buildGroupMetaLookup,
  computeStickyAncestors,
  type StickyAncestor,
} from './stickyAncestors';
import { computeGroupVisibleOrder } from './visibleOrder';

export type ViewRow<T> = T & {
  __isGroup?: boolean;
  __isFooter?: boolean;
  __isGrandTotal?: boolean;
  __groupKey?: string;
  __groupDepth?: number;
  __leafCount?: number;
};

/**
 * In-process CSRM — Filter → QuickFilter → Sort → Group → Agg → VisibleOrder.
 */
export class ClientSideRowModel<T extends Record<string, unknown>> {
  private raw: T[] = [];
  private view: ViewRow<T>[] = [];
  private sortModel: SortModel = [];
  private filterModel: FilterModel = {};
  private quickFilterText = '';
  private rowGroupCols: string[] = [];
  private expandedKeys: Set<string> | null = null; // null = all expanded
  private includeFooter = false;
  private includeTotalFooter = false;
  private groupOutput: GroupPassOutput = { roots: [], flatOrder: [], bypassed: true };
  private inputIds: string[] = [];
  private groupTotals: Record<string, Record<string, unknown>> = {};
  private grandTotals: Record<string, unknown> = {};
  private visibleOrder: FlatOrderEntry[] = [];
  private filteredSorted: T[] = [];

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
    this.expandedKeys = null; // default all expanded
    this.recompute();
  }

  getRowGroupColumns(): string[] {
    return this.rowGroupCols.slice();
  }

  setIncludeFooter(includeFooter: boolean, includeTotalFooter = false): void {
    this.includeFooter = includeFooter;
    this.includeTotalFooter = includeTotalFooter;
    this.recompute();
  }

  /** null = all expanded. */
  setExpandedKeys(keys: ReadonlySet<string> | null): void {
    this.expandedKeys = keys === null ? null : new Set(keys);
    this.materializeView();
  }

  getExpandedKeys(): Set<string> | null {
    return this.expandedKeys === null ? null : new Set(this.expandedKeys);
  }

  setExpanded(key: string, open: boolean): void {
    if (this.expandedKeys === null) {
      // Materialize all keys then toggle.
      this.expandedKeys = new Set(this.allGroupKeys());
    }
    if (open) this.expandedKeys.add(key);
    else this.expandedKeys.delete(key);
    this.materializeView();
  }

  expandAll(): void {
    this.expandedKeys = null;
    this.materializeView();
  }

  collapseAll(): void {
    this.expandedKeys = new Set();
    this.materializeView();
  }

  getGroupOutput(): GroupPassOutput {
    return this.groupOutput;
  }

  getGroupTotals(): Record<string, Record<string, unknown>> {
    return this.groupTotals;
  }

  getGrandTotals(): Record<string, unknown> {
    return this.grandTotals;
  }

  getDescendantRowIds(groupKey: string): string[] {
    const node = findGroupNode(this.groupOutput.roots, groupKey);
    if (!node) return [];
    return collectDescendantRowIds(node, this.inputIds);
  }

  getStickyAncestors(rowStart: number): StickyAncestor[] {
    const meta = buildGroupMetaLookup(this.groupOutput.roots, this.expandedKeys);
    return computeStickyAncestors(this.visibleOrder, rowStart, meta);
  }

  getRowCount(): number {
    return this.view.length;
  }

  getRow(i: number): ViewRow<T> | undefined {
    return this.view[i];
  }

  getRows(): ViewRow<T>[] {
    return this.view.slice();
  }

  private allGroupKeys(): string[] {
    const keys: string[] = [];
    const walk = (nodes: typeof this.groupOutput.roots): void => {
      for (const n of nodes) {
        keys.push(n.key);
        if (n.childGroups.length) walk(n.childGroups);
      }
    };
    walk(this.groupOutput.roots);
    return keys;
  }

  private aggCols(): AggCol[] {
    return this.columns()
      .filter((c) => c.aggFunc && (c.field || c.colId))
      .map((c) => ({
        colId: c.colId ?? c.field!,
        field: c.field ?? c.colId,
        aggFunc: c.aggFunc!,
      }));
  }

  private recompute(): void {
    let rows = this.raw;
    rows = applyFilterPass(rows, this.filterModel);
    rows = applyQuickFilterPass(rows, this.quickFilterText, this.columns());
    rows = applySortPass(rows, this.sortModel);
    this.filteredSorted = rows;

    const grouped = applyGroupPass(rows, this.getRowId, {
      rowGroupCols: this.rowGroupCols,
      includeFooter: this.includeFooter,
      includeTotalFooter: this.includeTotalFooter,
    });
    this.groupOutput = {
      roots: grouped.roots,
      flatOrder: grouped.flatOrder,
      bypassed: grouped.bypassed,
    };
    this.inputIds = grouped.inputIds;

    const aggs = this.aggCols();
    this.grandTotals = applyAggPass(rows, aggs);
    this.groupTotals = applyGroupAggPass(
      rows,
      this.inputIds,
      this.groupOutput,
      aggs,
      this.getRowId,
    );

    this.materializeView();
  }

  private materializeView(): void {
    if (this.groupOutput.bypassed) {
      this.visibleOrder = [];
      this.view = this.filteredSorted.map((r) => ({ ...r })) as ViewRow<T>[];
      return;
    }

    this.visibleOrder = computeGroupVisibleOrder(
      this.groupOutput.flatOrder,
      this.expandedKeys,
    );

    const out: ViewRow<T>[] = [];
    for (const entry of this.visibleOrder) {
      if (entry.kind === 'row') {
        const row = this.filteredSorted[entry.rowIndex];
        if (row) out.push({ ...row });
        continue;
      }
      if (entry.kind === 'group') {
        const node = findGroupNode(this.groupOutput.roots, entry.key);
        const totals = this.groupTotals[entry.key] ?? {};
        out.push({
          ...totals,
          id: `__grp__${entry.key}`,
          __isGroup: true,
          __groupKey: entry.key,
          __groupDepth: entry.depth,
          __leafCount: node?.childCount ?? 0,
        } as ViewRow<T>);
        continue;
      }
      // footer
      if (entry.key === '') {
        out.push({
          ...this.grandTotals,
          id: '__grand_total__',
          __isGrandTotal: true,
          __isFooter: true,
        } as ViewRow<T>);
      } else {
        out.push({
          ...(this.groupTotals[entry.key] ?? {}),
          id: `__footer__${entry.key}`,
          __isFooter: true,
          __groupKey: entry.key,
        } as ViewRow<T>);
      }
    }
    this.view = out;
  }
}
