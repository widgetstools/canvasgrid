import type { CColDef, CColGroupDef, HeaderClass, ColCellOverrides, HeaderStyleFunc } from '../types';
import { resolveColDef, type ResolvedColDef } from './propertyChain';

/**
 * Column tree — the resolved representation of a heterogeneous
 * `(CColDef | CColGroupDef)[]` columnDefs input.
 *
 * `roots` keeps the heterogeneous structure for header rendering (Task 2's
 * HeaderGroupSubgrid walks this). `leaves` is the flat, render-ordered list
 * of resolved leaves — drop-in replacement for the pre-grouping
 * `columnOrder`. Group lookups go via `groupById`; leaf lookups via
 * `leafById`. `maxDepth` is the maximum group nesting (0 = no groups).
 */
export interface ResolvedColGroupDef {
  readonly kind: 'group';
  groupId: string;
  headerName: string;
  openByDefault: boolean;
  marryChildren: boolean;
  /** Raw HeaderClass value (kept for round-trip / introspection). */
  headerClass?: HeaderClass;
  /**
   * Pre-compiled static header class names. Parallel to `ResolvedColDef.headerClassStatic`.
   * Resolved once at tree-build time; paint path reads this at zero allocation cost.
   * Cycle 6 / Task 7 (fix-pass).
   */
  headerClassStatic?: string[];
  /**
   * Function-form headerClass for group headers. Parallel to `ResolvedColDef.headerClassFn`.
   * Cycle 6 / Task 7 (fix-pass).
   */
  headerClassFn?: (params: { colId: string }) => string | string[] | undefined;
  /**
   * Cycle 27 / Task 1 — pre-resolved static `headerStyle` patch for group
   * header cells. The painter (`byRows.ts`) passes this to
   * `applyCellProps` as `groupHeaderStyle`.
   */
  headerStyle?: ColCellOverrides;
  /**
   * Cycle 27 / Task 1 — function-form `headerStyle` for group headers.
   * The painter passes this to `applyCellProps` as `groupHeaderStyleFn`.
   */
  headerStyleFn?: HeaderStyleFunc;
  /** Depth from root. Root nodes are depth 0. */
  depth: number;
  /** Tree children — groups or leaves, in declaration order. */
  children: ColumnTreeNode[];
  /** Flat list of every leaf colId underneath this group, in render order. */
  leafColIds: string[];
}

export interface ResolvedColLeaf {
  readonly kind: 'leaf';
  colDef: ResolvedColDef;
  /** Depth from root. Top-level (ungrouped) leaves are depth 0. */
  depth: number;
  /** Group IDs of ancestors, root→parent. Empty for ungrouped leaves. */
  groupPath: string[];
}

export type ColumnTreeNode = ResolvedColGroupDef | ResolvedColLeaf;

export interface ColumnTree {
  roots: ColumnTreeNode[];
  leaves: ResolvedColDef[];
  leafById: Map<string, ResolvedColDef>;
  groupById: Map<string, ResolvedColGroupDef>;
  /** Maximum group nesting. 0 = no groups; 1 = single-level groups; etc. */
  maxDepth: number;
}

/** Discriminator: a def is a group iff it has a `children` array. */
export function isColGroupDef<TRow>(
  def: CColDef<TRow> | CColGroupDef<TRow>,
): def is CColGroupDef<TRow> {
  return Array.isArray((def as CColGroupDef<TRow>).children);
}

/**
 * Resolve a heterogeneous columnDefs array into a tree + flat leaf list.
 * Leaves run through `resolveColDef` (so defaultColDef inheritance works
 * exactly as it did pre-grouping). Groups gain auto-generated IDs when the
 * caller omits `groupId`. Throws on empty children arrays, duplicate
 * groupIds, and duplicate colIds.
 */
export function resolveColumnTree<TRow>(
  defs: (CColDef<TRow> | CColGroupDef<TRow>)[],
  defaultColDef?: Partial<CColDef<TRow>>,
  columnTypes?: Record<string, Partial<CColDef<TRow>>>,
): ColumnTree {
  const leaves: ResolvedColDef[] = [];
  const leafById = new Map<string, ResolvedColDef>();
  const groupById = new Map<string, ResolvedColGroupDef>();
  let autoGroupSeq = 0;
  let maxDepth = 0;

  function walk(
    node: CColDef<TRow> | CColGroupDef<TRow>,
    depth: number,
    groupPath: string[],
  ): ColumnTreeNode {
    if (isColGroupDef(node)) {
      if (node.children.length === 0) {
        throw new Error('[cgrid] ColGroupDef has empty children array');
      }
      const groupId = node.groupId ?? `cg-grp-${++autoGroupSeq}`;
      if (groupById.has(groupId)) {
        throw new Error(`[cgrid] duplicate groupId '${groupId}'`);
      }
      // Pre-resolve group headerClass into static array or fn — mirrors leaf
      // resolveColDef logic; inlined here to avoid import cycles with propertyChain.ts.
      const hc = node.headerClass;
      const headerClassStatic: string[] | undefined =
        typeof hc === 'string' ? [hc]
        : Array.isArray(hc) ? (hc as string[]).slice()
        : undefined;
      const headerClassFn: ResolvedColGroupDef['headerClassFn'] | undefined =
        typeof hc === 'function'
          ? (hc as ResolvedColGroupDef['headerClassFn'])
          : undefined;
      // Cycle 27 / Task 1 — pre-resolve group `headerStyle` into static-object
      // and function-form slots, paralleling the leaf colDef path.
      const hs = node.headerStyle;
      const headerStyle: ColCellOverrides | undefined =
        typeof hs === 'object' && hs !== null ? hs : undefined;
      const headerStyleFn: HeaderStyleFunc | undefined =
        typeof hs === 'function' ? hs : undefined;

      const groupNode: ResolvedColGroupDef = {
        kind: 'group',
        groupId,
        headerName: node.headerName ?? '',
        openByDefault: node.openByDefault ?? false,
        marryChildren: node.marryChildren ?? false,
        headerClass: node.headerClass,
        headerClassStatic,
        headerClassFn,
        headerStyle,
        headerStyleFn,
        depth,
        children: [],
        leafColIds: [],
      };
      groupById.set(groupId, groupNode);
      const childPath = [...groupPath, groupId];
      for (const child of node.children) {
        const resolved = walk(child, depth + 1, childPath);
        groupNode.children.push(resolved);
        if (resolved.kind === 'leaf') {
          groupNode.leafColIds.push(resolved.colDef.colId);
        } else {
          groupNode.leafColIds.push(...resolved.leafColIds);
        }
      }
      maxDepth = Math.max(maxDepth, depth + 1);
      return groupNode;
    }

    const resolved = resolveColDef<TRow>(node, defaultColDef, columnTypes);
    if (leafById.has(resolved.colId)) {
      throw new Error(`[cgrid] duplicate colId '${resolved.colId}'`);
    }
    leafById.set(resolved.colId, resolved);
    leaves.push(resolved);
    return { kind: 'leaf', colDef: resolved, depth, groupPath };
  }

  const roots: ColumnTreeNode[] = defs.map((d) => walk(d, 0, []));
  return { roots, leaves, leafById, groupById, maxDepth };
}
