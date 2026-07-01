import { describe, it, expect } from 'vitest';
import { resolveColumnTree } from '../src/core/columnTree';
import { ColumnGroupState, resolveVisibleLeaves } from '../src/core/columnGroupState';
import type { CColDef, CColGroupDef } from '../src/types';

function makeTree() {
  return resolveColumnTree<{ id: string }>([
    { field: 'always' },
    {
      groupId: 'g1', openByDefault: false,
      children: [
        { field: 'closed-only', columnGroupShow: 'closed' },
        { field: 'open-only', columnGroupShow: 'open' },
        { field: 'g1-always' },
      ],
    },
  ] as (CColDef<{ id: string }> | CColGroupDef<{ id: string }>)[]);
}

describe('ColumnGroupState', () => {
  it('initial state honors openByDefault', () => {
    const s = new ColumnGroupState(makeTree());
    expect(s.isOpen('g1')).toBe(false);
  });

  it('toggle flips state and fires onChange', () => {
    const s = new ColumnGroupState(makeTree());
    const changes: unknown[] = [];
    s.onChange((c) => changes.push(c));
    s.toggle('g1');
    expect(s.isOpen('g1')).toBe(true);
    expect(changes[0]).toEqual([{ groupId: 'g1', open: true }]);
  });

  it('setOpen does nothing when value unchanged', () => {
    const s = new ColumnGroupState(makeTree());
    const changes: unknown[] = [];
    s.onChange((c) => changes.push(c));
    s.setOpen('g1', false); // already false (openByDefault)
    expect(changes.length).toBe(0);
  });

  it('setOpen ignores unknown groupId', () => {
    const s = new ColumnGroupState(makeTree());
    s.setOpen('missing', true);
    expect(s.isOpen('missing')).toBe(true); // unknown groups → true (default)
  });

  it('apply returns only the entries that changed', () => {
    const s = new ColumnGroupState(makeTree());
    const changed = s.apply([
      { groupId: 'g1', open: true },
      { groupId: 'missing', open: true },
    ]);
    expect(changed).toEqual([{ groupId: 'g1', open: true }]);
  });

  it('getState returns one entry per defined group in declaration order', () => {
    const s = new ColumnGroupState(makeTree());
    expect(s.getState()).toEqual([{ groupId: 'g1', open: false }]);
    s.setOpen('g1', true);
    expect(s.getState()).toEqual([{ groupId: 'g1', open: true }]);
  });

  it('reset returns to definition defaults and emits only changed', () => {
    const s = new ColumnGroupState(makeTree());
    const changes: unknown[] = [];
    s.setOpen('g1', true);
    s.onChange((c) => changes.push(c));
    s.reset();
    expect(s.isOpen('g1')).toBe(false);
    expect(changes[0]).toEqual([{ groupId: 'g1', open: false }]);
  });

  it('setTree preserves matching IDs and seeds new ones from defaults', () => {
    const tree1 = makeTree();
    const s = new ColumnGroupState(tree1);
    s.setOpen('g1', true);

    const tree2 = resolveColumnTree([
      { field: 'always' },
      { groupId: 'g1', openByDefault: false, children: [{ field: 'x' }] },
      { groupId: 'g2', openByDefault: true, children: [{ field: 'y' }] },
    ]);
    s.setTree(tree2);
    expect(s.isOpen('g1')).toBe(true); // preserved
    expect(s.isOpen('g2')).toBe(true); // from openByDefault
  });

  it('unsubscribe stops further notifications', () => {
    const s = new ColumnGroupState(makeTree());
    const changes: unknown[] = [];
    const off = s.onChange((c) => changes.push(c));
    off();
    s.toggle('g1');
    expect(changes.length).toBe(0);
  });
});

describe('resolveVisibleLeaves', () => {
  it('closed group hides "open" children, shows "closed" + always', () => {
    const tree = makeTree();
    const state = new ColumnGroupState(tree);
    const ids = resolveVisibleLeaves(tree, state);
    expect(ids).toEqual(['always', 'closed-only', 'g1-always']);
  });

  it('open group hides "closed" children, shows "open" + always', () => {
    const tree = makeTree();
    const state = new ColumnGroupState(tree);
    state.setOpen('g1', true);
    const ids = resolveVisibleLeaves(tree, state);
    expect(ids).toEqual(['always', 'open-only', 'g1-always']);
  });

  it('leaves with no parent group ignore columnGroupShow', () => {
    const tree = resolveColumnTree([
      { field: 'a', columnGroupShow: 'open' }, // no parent — should still show
    ]);
    const state = new ColumnGroupState(tree);
    expect(resolveVisibleLeaves(tree, state)).toEqual(['a']);
  });

  it('nested groups: a deep leaf is hidden when its IMMEDIATE parent state mismatches', () => {
    const tree = resolveColumnTree([
      {
        groupId: 'outer', openByDefault: true,
        children: [
          {
            groupId: 'inner', openByDefault: false,
            children: [
              { field: 'visible-when-inner-closed', columnGroupShow: 'closed' },
              { field: 'visible-when-inner-open', columnGroupShow: 'open' },
            ],
          },
        ],
      },
    ]);
    const state = new ColumnGroupState(tree);
    // inner is closed → only the 'closed' child shows.
    expect(resolveVisibleLeaves(tree, state)).toEqual(['visible-when-inner-closed']);
    state.setOpen('inner', true);
    expect(resolveVisibleLeaves(tree, state)).toEqual(['visible-when-inner-open']);
  });

  // Cycle 18 / Task 4 — pivot column-group collapse cascades through the
  // ancestor chain. A leaf with `columnGroupShow: 'open'` deep under
  // multiple groups hides whenever ANY ancestor group is closed, not only
  // its immediate parent. Mirrors AG-Grid's pivot collapse: collapsing a
  // top-level pivot group hides every leaf under it regardless of the
  // deeper-group states. Cite:
  // docs/superpowers/plans/notes/cycle-18-pivoting-design.md (Task 4).
  it('cascading collapse: closing an ANCESTOR hides "open" leaves under any descendant', () => {
    const tree = resolveColumnTree([
      {
        groupId: 'outer', openByDefault: true,
        children: [
          {
            groupId: 'inner', openByDefault: true,
            children: [
              { field: 'open-only', columnGroupShow: 'open' },
              { field: 'closed-only', columnGroupShow: 'closed' },
            ],
          },
        ],
      },
    ]);
    const state = new ColumnGroupState(tree);
    // Both open initially → 'open-only' is visible (no ancestor closed) and
    // 'closed-only' is hidden (immediate parent is open).
    expect(resolveVisibleLeaves(tree, state)).toEqual(['open-only']);

    // Close OUTER (strict ancestor of 'open-only'). Inner is still open,
    // but 'open-only' must hide because its grandparent is closed —
    // cascading behaviour. 'closed-only' also stays hidden because its
    // immediate parent (inner) is still open.
    state.setOpen('outer', false);
    expect(resolveVisibleLeaves(tree, state)).toEqual([]);
  });

  it('cascading collapse: a "closed" leaf hides when a STRICT ancestor is also closed', () => {
    // Mirrors pivot totals: a level-1 EQ_total leaf should hide when the
    // level-0 TECH group is closed (the TECH_total at level 0 takes over).
    const tree = resolveColumnTree([
      {
        groupId: 'tech', openByDefault: false,
        children: [
          { field: 'tech-total', columnGroupShow: 'closed' },
          {
            groupId: 'eq', openByDefault: false,
            children: [{ field: 'eq-total', columnGroupShow: 'closed' }],
          },
        ],
      },
    ]);
    const state = new ColumnGroupState(tree);
    // TECH closed + EQ closed → only the TOP-level 'tech-total' shows;
    // the deeper 'eq-total' is suppressed because TECH (strict ancestor)
    // is also closed.
    expect(resolveVisibleLeaves(tree, state)).toEqual(['tech-total']);

    // Expand TECH (EQ still closed) → tech-total hides (immediate parent
    // open), eq-total now shows (immediate parent EQ closed, no strict
    // ancestor closed).
    state.setOpen('tech', true);
    expect(resolveVisibleLeaves(tree, state)).toEqual(['eq-total']);
  });
});
