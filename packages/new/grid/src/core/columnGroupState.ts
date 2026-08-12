import type { ColumnTree, ColumnTreeNode, ResolvedColGroupDef } from './columnTree';

/**
 * Open/closed state for column groups, plus a leaf-visibility resolver that
 * honors per-leaf `columnGroupShow` against the immediate parent group's
 * state. Lives in core/ (not interaction/) because both the cgrid bootstrap
 * and Cycle-4 Task 22 state snapshot consume it.
 *
 * Lifecycle: cgrid constructs one `ColumnGroupState` per `ColumnTree`,
 * subscribes to `onChange` to recompute `columnOrder`, and re-seeds via
 * `setTree` when `updateGridOptions({ columnDefs })` lands (Task 4).
 */
export interface ColumnGroupStateEntry {
  groupId: string;
  open: boolean;
}

export class ColumnGroupState {
  private open = new Map<string, boolean>();
  private listeners = new Set<(changed: ColumnGroupStateEntry[]) => void>();
  private tree: ColumnTree;

  constructor(tree: ColumnTree) {
    this.tree = tree;
    this.seed();
  }

  private seed(): void {
    this.open.clear();
    for (const g of this.tree.groupById.values()) {
      this.open.set(g.groupId, g.openByDefault);
    }
  }

  /** Returns true if `groupId` is currently open. Unknown groups → true so
   *  callers using a stale ID don't accidentally hide every `'open'` leaf. */
  isOpen(groupId: string): boolean {
    return this.open.get(groupId) ?? true;
  }

  setOpen(groupId: string, open: boolean): void {
    if (!this.tree.groupById.has(groupId)) return;
    if (this.open.get(groupId) === open) return;
    this.open.set(groupId, open);
    this.emit([{ groupId, open }]);
  }

  toggle(groupId: string): void {
    this.setOpen(groupId, !this.isOpen(groupId));
  }

  apply(entries: ColumnGroupStateEntry[]): ColumnGroupStateEntry[] {
    const changed: ColumnGroupStateEntry[] = [];
    for (const e of entries) {
      if (!this.tree.groupById.has(e.groupId)) continue;
      if (this.open.get(e.groupId) !== e.open) {
        this.open.set(e.groupId, e.open);
        changed.push(e);
      }
    }
    if (changed.length) this.emit(changed);
    return changed;
  }

  getState(): ColumnGroupStateEntry[] {
    const out: ColumnGroupStateEntry[] = [];
    for (const g of this.tree.groupById.values()) {
      out.push({ groupId: g.groupId, open: this.open.get(g.groupId) ?? g.openByDefault });
    }
    return out;
  }

  reset(): void {
    const changed: ColumnGroupStateEntry[] = [];
    for (const g of this.tree.groupById.values()) {
      const cur = this.open.get(g.groupId);
      if (cur !== g.openByDefault) {
        this.open.set(g.groupId, g.openByDefault);
        changed.push({ groupId: g.groupId, open: g.openByDefault });
      }
    }
    if (changed.length) this.emit(changed);
  }

  /** Replace the tree (e.g. after `updateGridOptions({ columnDefs })`).
   *  Preserves the open/closed state of any group whose ID still exists; new
   *  groups seed from their `openByDefault`. Does not emit — callers should
   *  trigger a `displayedColumnsChanged` themselves after rebuilding. */
  setTree(tree: ColumnTree): void {
    const prev = new Map(this.open);
    this.tree = tree;
    this.open.clear();
    for (const g of tree.groupById.values()) {
      this.open.set(g.groupId, prev.get(g.groupId) ?? g.openByDefault);
    }
  }

  onChange(fn: (changed: ColumnGroupStateEntry[]) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(changed: ColumnGroupStateEntry[]): void {
    for (const fn of this.listeners) fn(changed);
  }
}

/**
 * Visible leaf colIds given the tree + current group state — AG-Grid
 * semantics, evaluated PER LEVEL against the IMMEDIATE parent only:
 *
 * - A child (leaf OR sub-group) with `columnGroupShow: 'open'` is shown
 *   only while its immediate parent group is open; `'closed'` only while
 *   the parent is closed; `null`/undefined children are always shown
 *   regardless of the parent's state.
 * - A hidden sub-group hides its ENTIRE subtree — that is the only way an
 *   ancestor's state reaches deeper levels. An untagged sub-group is
 *   never hidden by its parent's toggle, so each group's expand/collapse
 *   stays independent of its ancestors (the pre-Cycle-28 cascading rule
 *   — "an `'open'` leaf needs EVERY ancestor open" — coupled nested
 *   groups to their parents and is gone).
 *
 * Pivot collapse (Cycle 18 / Task 4) still cascades, but via the group
 * tags: `synthesizePivotColumns` stamps every nested pivot sub-group
 * `columnGroupShow: 'open'`, so collapsing a branch hides the child
 * groups (and with them, their subtrees) while the branch's own
 * `'closed'` totals leaf appears. Nested totals can't double up: the
 * inner group is hidden outright when the outer one closes.
 *
 * Leaves without a parent group (top-level ungrouped) always appear.
 * Order matches `tree.leaves` (= declaration order).
 */
export function resolveVisibleLeaves(
  tree: ColumnTree,
  state: ColumnGroupState,
): string[] {
  const out: string[] = [];
  const childVisible = (
    show: 'open' | 'closed' | null | undefined,
    parentOpen: boolean,
  ): boolean =>
    show == null || (show === 'open' ? parentOpen : !parentOpen);

  function walk(node: ColumnTreeNode, parent: ResolvedColGroupDef | null): void {
    const show = node.kind === 'leaf' ? node.colDef.columnGroupShow : node.columnGroupShow;
    if (parent && !childVisible(show, state.isOpen(parent.groupId))) return;
    if (node.kind === 'leaf') {
      out.push(node.colDef.colId);
      return;
    }
    for (const child of node.children) walk(child, node);
  }
  for (const root of tree.roots) walk(root, null);
  return out;
}
