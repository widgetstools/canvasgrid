/**
 * Client-owned group skeleton flatten index (ported from legacy ssrmFlattenIndex).
 * Expansion toggles are a local rebuild — no datasource round trip.
 */
import { buildCompositeGroupKey } from './groupKeys';

export type SkeletonGroup = {
  path: string[];
  leafCount: number;
  aggregates?: Record<string, unknown>;
};

export type SkeletonNode = {
  path: string[];
  key: string;
  depth: number;
  leafCount: number;
  aggregates: Record<string, unknown>;
};

export function extractRootAggregates(
  groups: readonly SkeletonGroup[],
): Record<string, unknown> | null {
  for (const g of groups) {
    if (g.path.length === 0) return g.aggregates ?? {};
  }
  return null;
}

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
    if (nodes.has(key)) continue;
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
      `[vg-new-grid] SSRM skeleton: dropped ${nodes.size - out.length} orphan group(s)`,
    );
  }
  return out;
}

export type FlattenEntry =
  | { kind: 'group'; node: SkeletonNode }
  | { kind: 'leaf'; node: SkeletonNode; leafOffset: number }
  | { kind: 'footer'; node: SkeletonNode }
  | { kind: 'grandTotal' };

type Segment = {
  start: number;
  kind: 'group' | 'leaves' | 'footer' | 'grandTotal';
  node: SkeletonNode | null;
  rows: number;
};

export type FlattenIndexOptions = {
  groupTotalRow?: 'top' | 'bottom' | null;
  grandTotalRow?: 'top' | 'bottom' | null;
};

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

  rowAt(index: number): FlattenEntry | null {
    const seg = this.segmentFor(index);
    if (!seg) return null;
    return this.entryAt(seg, index);
  }

  indexOfGroupKey(key: string): number {
    for (const seg of this.segments) {
      if (seg.kind === 'group' && seg.node!.key === key) return seg.start;
    }
    return -1;
  }

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
