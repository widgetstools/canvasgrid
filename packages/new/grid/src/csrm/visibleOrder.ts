/**
 * Collapse-aware visible order over GroupPass flatOrder (legacy skip-depth).
 */
import type { FlatOrderEntry } from './groupPass';

export type VisibleRowEntry = FlatOrderEntry;

export function computeGroupVisibleOrder(
  flatOrder: readonly FlatOrderEntry[],
  expandedKeys: ReadonlySet<string> | null,
  hideOpenParents = false,
  suppressLeafRows = false,
): VisibleRowEntry[] {
  // null expandedKeys = all expanded (legacy sentinel)
  const allExpanded = expandedKeys === null;
  const out: VisibleRowEntry[] = [];
  let skipDepth = -1;
  for (let i = 0; i < flatOrder.length; i++) {
    const entry = flatOrder[i]!;
    if (skipDepth >= 0 && entry.depth > skipDepth) continue;
    skipDepth = -1;
    const isExpandedGroup = entry.kind === 'group'
      && (allExpanded || expandedKeys!.has(entry.key));
    const isLeafRow = entry.kind === 'row';
    if ((!hideOpenParents || !isExpandedGroup) && !(suppressLeafRows && isLeafRow)) {
      out.push(entry);
    }
    if (entry.kind === 'group' && !isExpandedGroup) {
      skipDepth = entry.depth;
    }
  }
  return out;
}

export function computeGroupVisibleRowCount(
  flatOrder: readonly FlatOrderEntry[],
  expandedKeys: ReadonlySet<string> | null,
  hideOpenParents = false,
  suppressLeafRows = false,
): number {
  return computeGroupVisibleOrder(flatOrder, expandedKeys, hideOpenParents, suppressLeafRows).length;
}
