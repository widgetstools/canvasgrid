import type { ResolvedColDef } from './propertyChain';
import type { ColumnTree, ColumnTreeNode, ResolvedColGroupDef } from './columnTree';

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

/**
 * One header row per column-group tree depth. The top-most group depth is at
 * subgrid depth 0; the leaf header (HeaderSubgrid) sits beneath every group
 * row. A group cell spans the union of leaf-column widths underneath it; the
 * painter (byRows.ts) collapses adjacent leaves that share a group at this
 * depth into a single rect. Leaves whose ancestry doesn't reach this depth
 * (`getGroupIdAt` returns null) produce no overlay cell — the row background
 * remains visible.
 */
export class HeaderGroupSubgrid implements Subgrid {
  readonly type: SubgridType = 'header';
  readonly isHeader = true;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;

  // Cached leaf→groupPath lookup, invalidated when the tree reference changes
  // (e.g. updateGridOptions replaces columnDefs).
  private cachedTree: ColumnTree | null = null;
  private leafGroupPath: Map<string, string[]> = new Map();

  constructor(
    private getTree: () => ColumnTree,
    private getHeaderHeight: () => number,
    private depth: number,
    // The renderer derives spans from the visible-column order each frame, so
    // the subgrid itself doesn't consult `_leafOrder`. Kept on the constructor
    // signature so future renderers (e.g. tool-panel mirrors of the group
    // tree) have a leaf-order hint without re-deriving from the viewport.
    private _leafOrder: () => string[],
  ) {}

  getRowCount(): number { return 1; }
  getRowHeight(_local: number): number { return this.getHeaderHeight(); }

  getCell(_local: number, colId: string): SubgridCell | null {
    const grp = this.groupForLeaf(colId);
    if (!grp) return null;
    return { value: grp.headerName, valueFormatted: grp.headerName };
  }

  /** Returns the groupId at this subgrid's depth that owns `colId`, or null. */
  getGroupIdAt(colId: string): string | null {
    return this.groupForLeaf(colId)?.groupId ?? null;
  }

  private groupForLeaf(colId: string): ResolvedColGroupDef | null {
    const path = this.getLeafGroupPath(colId);
    if (this.depth >= path.length) return null;
    const groupId = path[this.depth]!;
    return this.getTree().groupById.get(groupId) ?? null;
  }

  private getLeafGroupPath(colId: string): string[] {
    const t = this.getTree();
    if (t !== this.cachedTree) {
      this.cachedTree = t;
      this.leafGroupPath.clear();
      const walk = (node: ColumnTreeNode): void => {
        if (node.kind === 'leaf') {
          this.leafGroupPath.set(node.colDef.colId, node.groupPath);
        } else {
          for (const child of node.children) walk(child);
        }
      };
      for (const r of t.roots) walk(r);
    }
    return this.leafGroupPath.get(colId) ?? [];
  }
}

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
