/**
 * Group / agg / pivot coordinator — sparse SSRM fail-closed for pivot.
 * Full GroupPass/PivotPass algorithms port in follow-on; API surface is stable.
 */

export class GroupPivotCoordinator {
  private rowGroupCols: string[] = [];
  private pivotCols: string[] = [];
  private valueCols: Array<{ colId: string; aggFunc: string }> = [];
  private pivotMode = false;
  private expanded = new Set<string>();

  constructor(
    private readonly opts: {
      isSparseSsrm: () => boolean;
      onChanged: () => void;
    },
  ) {}

  getRowGroupColumns(): string[] {
    return this.rowGroupCols.slice();
  }

  setRowGroupColumns(cols: string[]): void {
    this.rowGroupCols = cols.slice();
    this.opts.onChanged();
  }

  getPivotColumns(): string[] {
    return this.pivotCols.slice();
  }

  setPivotColumns(cols: string[]): void {
    this.pivotCols = cols.slice();
    this.opts.onChanged();
  }

  getValueColumns(): Array<{ colId: string; aggFunc: string }> {
    return this.valueCols.slice();
  }

  setValueColumns(cols: Array<{ colId: string; aggFunc: string }>): void {
    this.valueCols = cols.slice();
    this.opts.onChanged();
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
    this.opts.onChanged();
    return true;
  }

  isExpanded(key: string): boolean {
    return this.expanded.has(key);
  }

  setExpanded(key: string, open: boolean): void {
    if (open) this.expanded.add(key);
    else this.expanded.delete(key);
    this.opts.onChanged();
  }

  expandAll(): void {
    /* populated when skeleton keys known */
    this.opts.onChanged();
  }

  collapseAll(): void {
    this.expanded.clear();
    this.opts.onChanged();
  }
}
