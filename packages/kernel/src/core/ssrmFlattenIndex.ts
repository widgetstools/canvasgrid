/**
 * Sparse SSRM v2 — client-owned group skeleton + flatten index.
 *
 * The skeleton is every group row (all depths) for the current
 * sort/filter/groupBy; the flatten index projects (skeleton × expandedKeys)
 * into the flat scroll space the paint path consumes. Expansion toggles are
 * a local rebuild — no datasource round trip, no shifted-index staleness.
 *
 * 2026-07-21 (first-wave parity): the index also emits per-group total
 * (footer) slots and an in-scroll grand-total slot, mirroring CSRM's
 * GroupPass footer semantics (`groupTotalRow` / `grandTotalRow`).
 *
 * See docs/ssrm-group-skeleton-design.md.
 */

import { buildCompositeGroupKey } from './ssrmRowMeta';
import type { SkeletonGroup } from '../types/ssrm';

/** One skeleton group, normalized to display order with derived fields. */
export interface SkeletonNode {
  path: string[];
  /** Composite key (kernel-internal vocabulary — matches expandedKeys). */
  key: string;
  depth: number;
  leafCount: number;
  aggregates: Record<string, unknown>;
}

/** Grand-total aggregates carried on the skeleton's `path: []` row, when
 *  the datasource supplies one. */
export function extractRootAggregates(
  groups: readonly SkeletonGroup[],
): Record<string, unknown> | null {
  for (const g of groups) {
    if (g.path.length === 0) return g.aggregates ?? {};
  }
  return null;
}

/**
 * Normalize datasource skeleton groups into display order: depth-first,
 * parents before children, sibling input order preserved. Orphans (a group
 * whose parent is absent) are dropped with a warning — the index cannot
 * place them. A `path: []` entry (grand-total carrier) is ignored here —
 * read it via `extractRootAggregates`.
 *
 * `preferredOrder` (AG `groupMaintainOrder` support): when supplied,
 * sibling lists sort by the group's previous display position first
 * (unknown keys keep input order at the end) so refetched skeletons don't
 * re-order surviving groups.
 */
export function toDisplayOrder(
  groups: readonly SkeletonGroup[],
  rowGroupCols: readonly string[],
  preferredOrder?: ReadonlyMap<string, number>,
): SkeletonNode[] {
  const maxDepth = rowGroupCols.length - 1;
  const nodes = new Map<string, SkeletonNode>();
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];

  for (const g of groups) {
    if (g.path.length === 0 || g.path.length > rowGroupCols.length) continue;
    const path = g.path.map((v) => String(v ?? ''));
    const key = buildCompositeGroupKey(rowGroupCols, path);
    if (nodes.has(key)) continue; // first occurrence wins
    nodes.set(key, {
      path,
      key,
      depth: path.length - 1,
      leafCount: Math.max(0, Math.floor(g.leafCount) || 0),
      aggregates: g.aggregates ?? {},
    });
    if (path.length === 1) {
      roots.push(key);
    } else {
      const parentKey = buildCompositeGroupKey(rowGroupCols, path.slice(0, -1));
      const siblings = childrenOf.get(parentKey);
      if (siblings) siblings.push(key);
      else childrenOf.set(parentKey, [key]);
    }
  }

  const orderSiblings = (keys: string[]): string[] => {
    if (!preferredOrder || preferredOrder.size === 0) return keys;
    return keys
      .map((key, seq) => ({ key, seq, prev: preferredOrder.get(key) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => (a.prev - b.prev) || (a.seq - b.seq))
      .map((e) => e.key);
  };

  const out: SkeletonNode[] = [];
  const walk = (key: string): void => {
    const node = nodes.get(key);
    if (!node) return;
    out.push(node);
    if (node.depth < maxDepth) {
      for (const child of orderSiblings(childrenOf.get(key) ?? [])) walk(child);
    }
  };
  for (const key of orderSiblings(roots)) walk(key);

  if (out.length !== nodes.size) {
    console.warn(
      `[cgrid] SSRM skeleton: dropped ${nodes.size - out.length} orphan group(s) with no parent in the skeleton`,
    );
  }
  return out;
}

/** `rowAt` result — a group row, a leaf slot, a per-group total (footer)
 *  row, or the in-scroll grand-total row. */
export type FlattenEntry =
  | { kind: 'group'; node: SkeletonNode }
  | { kind: 'leaf'; node: SkeletonNode; leafOffset: number }
  | { kind: 'footer'; node: SkeletonNode }
  | { kind: 'grandTotal' };

interface Segment {
  /** Flattened index of the segment's first row. */
  start: number;
  kind: 'group' | 'leaves' | 'footer' | 'grandTotal';
  /** null only for grandTotal. */
  node: SkeletonNode | null;
  /** Row count — 1 for group/footer/grandTotal, leafCount for leaves. */
  rows: number;
}

export interface FlattenIndexOptions {
  /** Per-group total row placement (AG `groupTotalRow`): emitted only for
   *  EXPANDED groups — 'top' right after the group row, 'bottom' after the
   *  group's whole visible subtree. */
  groupTotalRow?: 'top' | 'bottom' | null;
  /** In-scroll grand-total row (AG `grandTotalRow` 'top' | 'bottom').
   *  Pinned variants are a subgrid concern, not the index's. */
  grandTotalRow?: 'top' | 'bottom' | null;
}

/**
 * Immutable projection of (display-ordered skeleton × expandedKeys) into
 * flat indices. Rebuild on any expansion or skeleton change — O(groups).
 */
export class FlattenIndex {
  private readonly segments: Segment[] = [];
  readonly rowCount: number;

  constructor(
    displayOrdered: readonly SkeletonNode[],
    expandedKeys: ReadonlySet<string>,
    maxDepth: number,
    opts: FlattenIndexOptions = {},
  ) {
    const groupTotalRow = opts.groupTotalRow ?? null;
    const grandTotalRow = opts.grandTotalRow ?? null;
    let next = 0;
    const push = (kind: Segment['kind'], node: SkeletonNode | null, rows: number): void => {
      if (rows <= 0) return;
      this.segments.push({ start: next, kind, node, rows });
      next += rows;
    };

    if (grandTotalRow === 'top') push('grandTotal', null, 1);

    // openAt[d] === true → the last seen group at depth d is visible AND
    // expanded (its children are visible). bottomStack holds expanded
    // groups awaiting their 'bottom' footer once their subtree closes.
    const openAt: boolean[] = [];
    const bottomStack: SkeletonNode[] = [];
    const closeTo = (depth: number): void => {
      while (bottomStack.length > 0 && bottomStack[bottomStack.length - 1]!.depth >= depth) {
        push('footer', bottomStack.pop()!, 1);
      }
    };

    for (const node of displayOrdered) {
      const visible = node.depth === 0 || openAt[node.depth - 1] === true;
      const expanded = expandedKeys.has(node.key);
      openAt[node.depth] = visible && expanded;
      openAt.length = node.depth + 1;
      if (!visible) continue;

      // A new node at depth D closes any pending bottom-footer groups at
      // depth >= D (their subtrees just ended).
      closeTo(node.depth);

      push('group', node, 1);
      const emitFooter = expanded && groupTotalRow !== null;
      if (emitFooter && groupTotalRow === 'top') push('footer', node, 1);
      const isLeafLevel = node.depth === maxDepth;
      if (isLeafLevel && expanded) {
        push('leaves', node, node.leafCount);
        if (emitFooter && groupTotalRow === 'bottom') push('footer', node, 1);
      } else if (!isLeafLevel && emitFooter && groupTotalRow === 'bottom') {
        bottomStack.push(node);
      }
    }
    closeTo(0);

    if (grandTotalRow === 'bottom') push('grandTotal', null, 1);
    this.rowCount = next;
  }

  /** Map a flattened index to its entry. */
  rowAt(index: number): FlattenEntry | null {
    const seg = this.segmentFor(index);
    if (!seg) return null;
    return this.entryAt(seg, index);
  }

  /** Flattened index of a group row by composite key; -1 when not visible. */
  indexOfGroupKey(key: string): number {
    for (const seg of this.segments) {
      if (seg.kind === 'group' && seg.node!.key === key) return seg.start;
    }
    return -1;
  }

  /** Entries covering [start, end) in flattened order. */
  entriesInRange(start: number, end: number): FlattenEntry[] {
    const out: FlattenEntry[] = [];
    const lo = Math.max(0, start);
    const hi = Math.min(this.rowCount, end);
    if (hi <= lo) return out;
    let si = this.segmentIndexFor(lo);
    if (si < 0) return out;
    for (; si < this.segments.length; si++) {
      const seg = this.segments[si]!;
      if (seg.start >= hi) break;
      const from = Math.max(lo, seg.start);
      const to = Math.min(hi, seg.start + seg.rows);
      for (let i = from; i < to; i++) out.push(this.entryAt(seg, i));
    }
    return out;
  }

  /**
   * The group rows an on-screen row at `index` is nested under — one per
   * ancestor depth, shallowest first. Used to hydrate the sticky-band
   * ancestors even when everything else above the viewport is unhydrated.
   */
  ancestorsOf(index: number): Array<{ index: number; node: SkeletonNode }> {
    const si = this.segmentIndexFor(index);
    if (si < 0) return [];
    const own = this.segments[si]!;
    if (own.kind === 'grandTotal') return [];
    const ownNode = own.node!;
    const out: Array<{ index: number; node: SkeletonNode }> = [];
    // A group row's chain starts at its parent; any other slot's chain
    // includes its own group.
    let wantDepth = ownNode.depth - (own.kind === 'group' && index === own.start ? 1 : 0);
    for (let i = si; i >= 0 && wantDepth >= 0; i--) {
      const seg = this.segments[i]!;
      if (seg.kind !== 'group') continue;
      if (seg.node!.depth === wantDepth && seg.start <= index) {
        out.unshift({ index: seg.start, node: seg.node! });
        wantDepth--;
      }
    }
    return out;
  }

  private entryAt(seg: Segment, index: number): FlattenEntry {
    switch (seg.kind) {
      case 'group': return { kind: 'group', node: seg.node! };
      case 'footer': return { kind: 'footer', node: seg.node! };
      case 'grandTotal': return { kind: 'grandTotal' };
      case 'leaves': return { kind: 'leaf', node: seg.node!, leafOffset: index - seg.start };
    }
  }

  private segmentIndexFor(index: number): number {
    if (index < 0 || index >= this.rowCount || this.segments.length === 0) return -1;
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid]!.start <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private segmentFor(index: number): Segment | null {
    const i = this.segmentIndexFor(index);
    return i < 0 ? null : this.segments[i]!;
  }
}
