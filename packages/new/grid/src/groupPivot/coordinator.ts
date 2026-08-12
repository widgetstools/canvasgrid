/**
 * Group / agg / pivot coordinator — sparse SSRM fail-closed for pivot.
 * Expansion is local (SSRM FlattenIndex rebuild); structure changes purge.
 */

export class GroupPivotCoordinator {
  private rowGroupCols: string[] = [];
  private pivotCols: string[] = [];
  private valueCols: Array<{ colId: string; aggFunc: string }> = [];
  private pivotMode = false;
  private expanded = new Set<string>();
  private knownKeys: string[] = [];

  constructor(
    private readonly opts: {
      isSparseSsrm: () => boolean;
      /** Row-group / pivot / value col changes — purge SSRM. */
      onStructureChanged: () => void;
      /** Expand/collapse — local FlattenIndex reflow. */
      onExpansionChanged: () => void;
    },
  ) {}

  getRowGroupColumns(): string[] {
    return this.rowGroupCols.slice();
  }

  setRowGroupColumns(cols: string[]): void {
    this.rowGroupCols = cols.slice();
    this.expanded.clear();
    this.knownKeys = [];
    this.opts.onStructureChanged();
  }

  getPivotColumns(): string[] {
    return this.pivotCols.slice();
  }

  setPivotColumns(cols: string[]): void {
    this.pivotCols = cols.slice();
    this.opts.onStructureChanged();
  }

  getValueColumns(): Array<{ colId: string; aggFunc: string }> {
    return this.valueCols.slice();
  }

  setValueColumns(cols: Array<{ colId: string; aggFunc: string }> ): void {
    this.valueCols = cols.slice();
    this.opts.onStructureChanged();
  }

  isPivotMode(): boolean {
    return this.pivotMode;
  }

  setPivotMode(on: boolean): boolean {
    if (on && this.opts.isSparseSsrm()) {
      console.warn(
        '[vg-new-grid] Pivot mode is not supported on sparse SSRM. '
        + 'Use clientSide, or set serverSideEnableClientSidePipeline: true (full hydrate).',
      );
      return false;
    }
    this.pivotMode = on;
    this.opts.onStructureChanged();
    return true;
  }

  isExpanded(key: string): boolean {
    return this.expanded.has(key);
  }

  setExpanded(key: string, open: boolean): void {
    if (open) this.expanded.add(key);
    else this.expanded.delete(key);
    this.opts.onExpansionChanged();
  }

  getExpandedGroupKeys(): string[] {
    return [...this.expanded];
  }

  setKnownGroupKeys(keys: readonly string[]): void {
    this.knownKeys = keys.slice();
  }

  expandAll(): void {
    for (const k of this.knownKeys) this.expanded.add(k);
    this.opts.onExpansionChanged();
  }

  collapseAll(): void {
    this.expanded.clear();
    this.opts.onExpansionChanged();
  }
}
