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

export type SubgridType = 'header' | 'data' | 'totals' | 'pinned' | 'footer' | 'floatingFilter';

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
  /** Cycle 7 / Task 1 — true only for `FloatingFilterSubgrid`. Mirrors the
   *  `isHeader` / `isData` shorthand so the viewport + painter can skip the
   *  row uniformly without an instanceof check. Optional on the interface
   *  so existing subgrids don't have to declare it. */
  readonly isFloatingFilter?: boolean;
  /** Cycle 14 / Task 2 — true only for `PinnedRowsSubgrid`. Distinguishes
   *  static caller-owned pinned rows from totals (which look similar in
   *  the stack but carry computed values + different chrome). Optional
   *  so existing subgrids don't have to declare it. */
  readonly isPinned?: boolean;
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

  /** Returns the resolved group def at this subgrid's depth for `colId`, or null.
   *  Used by the painter to access pre-compiled headerClass fields. Cycle 6 / Task 7 (fix-pass). */
  getGroupDef(colId: string): ResolvedColGroupDef | null {
    return this.groupForLeaf(colId);
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
    /**
     * Per-row height in CSS px. Receives the local data-row index so the
     * implementation can substitute per-row overrides (Cycle 5 / Task 6 —
     * `CGridOptions.getRowHeight`) on top of the grid-level fallback.
     * Rows outside the current chunk should return the fallback.
     */
    private getRowHeightFn: (local: number) => number,
    private cellAt: DataCellLookup,
  ) {}

  getRowCount(): number { return this.getRowCountFn(); }
  getRowHeight(local: number): number { return this.getRowHeightFn(local); }
  getCell(local: number, colId: string): SubgridCell | null {
    return this.cellAt(local, colId);
  }
}

/** Lookup the totals value for a single column. Returns `null` when the
 *  current chunk doesn't carry a totals entry for `colId` (column has no
 *  `aggFunc`, or no chunk has arrived yet). The single-row subgrid below
 *  wraps this in a `SubgridCell` and threads the column's `valueFormatter`
 *  through `formatValue`.
 *
 *  Cycle 14 / Task 1 — original signature.
 *
 *  Cycle 15 / Task 12 — the optional second arg carries the parent
 *  group's composite key for PER-GROUP totals lookups. Implementations
 *  that don't care about per-group case ignore the arg (defaults to
 *  empty-string sentinel = grand-total scope, matching the legacy
 *  signature). Implementations that DO care (the per-group footer
 *  surface main wires through `chunk.groupTotals[parentGroupKey]`)
 *  read the arg to pick the right per-column record. The signature
 *  extension is additive: every existing caller's `(colId)` form
 *  still resolves to a grand-total lookup. */
export type TotalsCellLookup = (
  colId: string,
  parentGroupKey?: string,
) => { value: unknown; valueFormatted: string } | null;

/**
 * Grand-totals row. Pinned at the top OR bottom of the grid body —
 * `cgrid.ts` picks the slot based on `options.totalsRowPosition`. The
 * row reads `chunk.totals[colId]` from the already-computed worker
 * aggregation; the totals row triggers ZERO additional worker
 * round-trips on scroll. Cycle 14 / Task 1.
 *
 * Rendered as ONE row by default (`getRowCount` returns 1). Per-row
 * height defaults to the grid's body row height; pass an explicit
 * `getHeight` to override (e.g. for a slightly taller totals row).
 * Cycle 5's variable-row-height index does not cover this subgrid —
 * the row is non-scrolling and its height is constant per render
 * frame, so the index isn't needed.
 *
 * `getCell` returns `null` when the lookup function reports no totals
 * entry for `colId` — the painter then skips text for that cell while
 * still painting the row chrome (bg + top border).
 *
 * Cycle 15 / Task 12 — the constructor takes an optional
 * `parentGroupKey` which threads through to the `TotalsCellLookup` as
 * its second argument. Used in two places:
 *   1. Grand totals (default `parentGroupKey === ''`) — the legacy
 *      shape; the lookup ignores the second arg and reads
 *      `chunk.totals[colId]`.
 *   2. Per-group footers — the lookup reads
 *      `chunk.groupTotals[parentGroupKey][colId]`. Per-group footer
 *      rows are emitted INLINE in `DataSubgrid` (as `rowKinds[i] === 3`),
 *      not as a separate `TotalsSubgrid` instance — the inline
 *      placement is needed so footers ride the same scroll surface as
 *      data rows. The `parentGroupKey` field exists on `TotalsSubgrid`
 *      so apps that want a SEPARATE per-group totals subgrid (pinned
 *      under a specific group) can construct one explicitly.
 */
export class TotalsSubgrid implements Subgrid {
  readonly type = 'totals' as const;
  readonly isHeader = false;
  readonly isData = false;
  readonly isTotals = true;
  readonly isFooter = false;
  /** Cycle 15 / Task 12 — composite group key threaded into the
   *  `TotalsCellLookup` as its second arg so the lookup can pick the
   *  right per-group totals record. Empty string = grand-total scope
   *  (the Cycle 14 default). Apps that want a per-group totals
   *  subgrid pin a `TotalsSubgrid` constructed with the right
   *  parentGroupKey. */
  readonly parentGroupKey: string;

  constructor(
    private getHeight: () => number,
    private lookup: TotalsCellLookup,
    parentGroupKey: string = '',
  ) {
    this.parentGroupKey = parentGroupKey;
  }

  getRowCount(): number { return 1; }
  getRowHeight(_local: number): number { return this.getHeight(); }
  getCell(_local: number, colId: string): SubgridCell | null {
    const entry = this.lookup(colId, this.parentGroupKey);
    if (entry === null) return null;
    return { value: entry.value, valueFormatted: entry.valueFormatted };
  }
}

/** Lookup the value for a single (row × column) inside a pinned subgrid.
 *  The caller owns the row data so the lookup signature takes the row
 *  object directly (not an index). Returns the same `{value, valueFormatted}`
 *  shape as data cells so the painter path is uniform. Cycle 14 / Task 2. */
export type PinnedCellLookup<TRow = unknown> = (
  row: TRow,
  colId: string,
) => SubgridCell;

/**
 * Static caller-owned pinned rows. Each entry in the data array becomes
 * one non-scrolling row at the top or bottom of the body — the position
 * is determined by where `cgrid.ts` stacks this subgrid relative to the
 * `DataSubgrid` (mirrors the totals positioning convention).
 *
 * Unlike `TotalsSubgrid`, the row data is owned by the main thread:
 * there's no worker round-trip per scroll, and the values can be any
 * `TRow` shape. The painter reads each cell via the column's normal
 * `valueFormatter` channel — same rendering as a data row — so a
 * formatted dollar value in a data cell renders identically when the
 * same row appears as a pinned reference.
 *
 * Multiple PinnedRowsSubgrid instances can coexist (pinned-top + pinned-
 * bottom, or pinned + totals); the design plan
 * (`docs/superpowers/plans/notes/cycle-14-aggregation-design.md`)
 * distinguishes them visually via tint hue (cream vs slate) so the
 * trader can tell static reference rows from computed summaries at a
 * glance. Cycle 14 / Task 2.
 */
export class PinnedRowsSubgrid<TRow = unknown> implements Subgrid {
  readonly type = 'pinned' as const;
  readonly isHeader = false;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;
  readonly isPinned = true;

  constructor(
    private getRows: () => readonly TRow[],
    private getHeight: () => number,
    private lookup: PinnedCellLookup<TRow>,
  ) {}

  getRowCount(): number { return this.getRows().length; }
  getRowHeight(_local: number): number { return this.getHeight(); }
  getCell(local: number, colId: string): SubgridCell | null {
    const rows = this.getRows();
    const row = rows[local];
    if (row === undefined) return null;
    return this.lookup(row, colId);
  }
}
