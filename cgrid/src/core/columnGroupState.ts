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
 * Visible leaf colIds given the tree + current group state. Each leaf is kept
 * iff its `columnGroupShow` is compatible with the open/closed state of its
 * ancestor groups, where:
 *
 * - `columnGroupShow: undefined` — always visible regardless of state.
 * - `columnGroupShow: 'open'` — visible iff EVERY ancestor group is open.
 *   Closing ANY ancestor (immediate parent or higher) hides the leaf —
 *   this is the cascading-collapse semantic pivot column groups depend on
 *   (Cycle 18 / Task 4): collapsing a top-level pivot group hides every
 *   leaf underneath, not only the leaves whose immediate parent is the
 *   collapsed group.
 * - `columnGroupShow: 'closed'` — visible iff the IMMEDIATE parent is
 *   closed AND no STRICT ancestor (above the immediate parent) is closed.
 *   The second clause stops nested "group total" leaves from doubling up
 *   when an outer pivot group is also collapsed (the outer total takes
 *   over).
 *
 * Leaves without a parent group (top-level ungrouped) always appear.
 * Order matches `tree.leaves` (= declaration order).
 */
export function resolveVisibleLeaves(
  tree: ColumnTree,
  state: ColumnGroupState,
): string[] {
  const ancestorsByLeaf = buildAncestorIndex(tree);
  const out: string[] = [];
  for (const leaf of tree.leaves) {
    const show = leaf.columnGroupShow ?? null;
    const ancestors = ancestorsByLeaf.get(leaf.colId) ?? [];
    if (ancestors.length === 0 || show == null) {
      out.push(leaf.colId);
      continue;
    }
    const immediateParent = ancestors[ancestors.length - 1]!;
    const immediateOpen = state.isOpen(immediateParent.groupId);
    // 'open' leaves: hide if ANY ancestor (including immediate parent) is closed.
    if (show === 'open') {
      let anyClosed = false;
      for (const a of ancestors) {
        if (!state.isOpen(a.groupId)) { anyClosed = true; break; }
      }
      if (anyClosed) continue;
      out.push(leaf.colId);
      continue;
    }
    // 'closed' leaves: require immediate parent closed AND no STRICT ancestor closed.
    if (show === 'closed') {
      if (immediateOpen) continue;
      let strictAncestorClosed = false;
      for (let i = 0; i < ancestors.length - 1; i++) {
        if (!state.isOpen(ancestors[i]!.groupId)) { strictAncestorClosed = true; break; }
      }
      if (strictAncestorClosed) continue;
      out.push(leaf.colId);
      continue;
    }
  }
  return out;
}

/** Build a `colId → root→immediate-parent ancestor chain` map by walking the tree once. */
function buildAncestorIndex(tree: ColumnTree): Map<string, ResolvedColGroupDef[]> {
  const out = new Map<string, ResolvedColGroupDef[]>();
  function walk(node: ColumnTreeNode, ancestors: ResolvedColGroupDef[]): void {
    if (node.kind === 'leaf') {
      if (ancestors.length > 0) out.set(node.colDef.colId, ancestors);
      return;
    }
    const childAncestors = [...ancestors, node];
    for (const child of node.children) walk(child, childAncestors);
  }
  for (const root of tree.roots) walk(root, []);
  return out;
}
