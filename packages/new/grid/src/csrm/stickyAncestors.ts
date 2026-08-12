/**
 * Sticky group ancestor band for the viewport top boundary.
 */
import type { GroupNode } from './groupPass';
import type { VisibleRowEntry } from './visibleOrder';

export type StickyAncestor = {
  depth: number;
  key: string;
  colId: string;
  value: string;
  childCount: number;
  isExpanded: boolean;
};

export function buildGroupMetaLookup(
  roots: readonly GroupNode[],
  expandedKeys: ReadonlySet<string> | null,
): Map<string, { value: string; childCount: number; isExpanded: boolean; colId: string }> {
  const map = new Map<string, { value: string; childCount: number; isExpanded: boolean; colId: string }>();
  const allExpanded = expandedKeys === null;
  const walk = (nodes: readonly GroupNode[]): void => {
    for (const n of nodes) {
      map.set(n.key, {
        value: String(n.value ?? ''),
        childCount: n.childCount,
        isExpanded: allExpanded || expandedKeys!.has(n.key),
        colId: n.colId,
      });
      if (n.childGroups.length) walk(n.childGroups);
    }
  };
  walk(roots);
  return map;
}

export function computeStickyAncestors(
  visibleOrder: readonly VisibleRowEntry[],
  rowStart: number,
  metaLookup: ReadonlyMap<string, { value: string; childCount: number; isExpanded: boolean; colId: string }>,
): StickyAncestor[] {
  if (rowStart === 0) return [];
  const lastAtDepth = new Map<number, string>();
  const limit = Math.min(rowStart, visibleOrder.length);
  for (let i = 0; i < limit; i++) {
    const entry = visibleOrder[i]!;
    if (entry.kind === 'group') {
      for (const depth of [...lastAtDepth.keys()]) {
        if (depth > entry.depth) lastAtDepth.delete(depth);
      }
      lastAtDepth.set(entry.depth, entry.key);
    }
  }
  if (lastAtDepth.size === 0) return [];
  const result: StickyAncestor[] = [];
  for (const [depth, key] of [...lastAtDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const meta = metaLookup.get(key);
    if (!meta || !meta.isExpanded) break;
    result.push({
      depth,
      key,
      colId: meta.colId,
      value: meta.value,
      childCount: meta.childCount,
      isExpanded: meta.isExpanded,
    });
  }
  return result;
}
