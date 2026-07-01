// Cycle 6 / Task 2 — Column state round-trip unit tests.
//
// `core/columnState.ts` exports three pure functions consumed by cgrid's
// `getColumnState` / `applyColumnState` / `resetColumnState` API:
//   - `snapshotState(tree, layout, sortModel)` — read-side
//   - `applyStateToTree(tree, params, locks)` — pure mutation plan + new order
//   - `cloneStateForReset(state)` — deep clone for the init snapshot
//
// `applyStateToTree` returns the set of per-leaf changes (one entry per
// changed slot) PLUS the new flat-leaf order when `applyOrder: true`. The
// cgrid layer mutates the resolved col-def slots from the change records,
// runs one re-layout, and fans the records out as the matching column
// events. `lockVisible` rejects `hide` mutations; `lockPinned` rejects
// `pinned` mutations — both silent drops, not throws.

import { describe, it, expect } from 'vitest';
import {
  snapshotState, applyStateToTree, cloneStateForReset,
  type SnapshotLocks,
} from '../src/core/columnState';
import { resolveColumnTree } from '../src/core/columnTree';
import type { ColumnLayout } from '../src/core/layout';
import type { SortModel } from '../src/types';

function makeTree() {
  return resolveColumnTree([
    { field: 'a', width: 100 },
    { field: 'b', width: 150, pinned: 'left' },
    { field: 'c', width: 200, flex: 1 },
    { field: 'd', width: 120 },
  ]);
}

function defaultLayout(): ColumnLayout[] {
  return [
    { colId: 'b', left: 0, width: 150, pinned: 'left' },
    { colId: 'a', left: 150, width: 100 },
    { colId: 'c', left: 250, width: 200 },
    { colId: 'd', left: 450, width: 120 },
  ];
}

const noLocks: SnapshotLocks = {
  lockVisibleOf: () => false,
  lockPinnedOf: () => false,
};

describe('snapshotState', () => {
  it('returns one entry per leaf in tree-declaration order', () => {
    const tree = makeTree();
    const state = snapshotState(tree, defaultLayout(), []);
    expect(state.map((s) => s.colId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('echoes resolved width from layout', () => {
    const tree = makeTree();
    const state = snapshotState(tree, defaultLayout(), []);
    expect(state.find((s) => s.colId === 'a')?.width).toBe(100);
    expect(state.find((s) => s.colId === 'c')?.width).toBe(200);
  });

  it('echoes resolved pinned from layout (left/null)', () => {
    const tree = makeTree();
    const state = snapshotState(tree, defaultLayout(), []);
    expect(state.find((s) => s.colId === 'b')?.pinned).toBe('left');
    expect(state.find((s) => s.colId === 'a')?.pinned).toBe(null);
  });

  it('hide defaults to false when col-def hide unset', () => {
    const tree = makeTree();
    const state = snapshotState(tree, defaultLayout(), []);
    for (const e of state) expect(e.hide).toBe(false);
  });

  it('hide reflects col-def hide=true even when missing from layout', () => {
    const tree = resolveColumnTree([
      { field: 'a', width: 100 },
      { field: 'b', width: 150, hide: true },
    ]);
    // Hidden leaves are filtered out of layout but must round-trip.
    const layout: ColumnLayout[] = [{ colId: 'a', left: 0, width: 100 }];
    const state = snapshotState(tree, layout, []);
    expect(state.length).toBe(2);
    expect(state.find((s) => s.colId === 'b')?.hide).toBe(true);
  });

  it('reflects active sort model into sort + sortIndex', () => {
    const tree = makeTree();
    const sortModel: SortModel = [
      { colId: 'c', direction: 'desc' },
      { colId: 'a', direction: 'asc' },
    ];
    const state = snapshotState(tree, defaultLayout(), sortModel);
    expect(state.find((s) => s.colId === 'c')).toMatchObject({ sort: 'desc', sortIndex: 0 });
    expect(state.find((s) => s.colId === 'a')).toMatchObject({ sort: 'asc', sortIndex: 1 });
    expect(state.find((s) => s.colId === 'b')?.sort).toBe(null);
    expect(state.find((s) => s.colId === 'd')?.sortIndex).toBe(null);
  });
});

describe('applyStateToTree — width / hide / pinned / sort', () => {
  it('hide flip lands in the change record', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', hide: true }] },
      noLocks,
    );
    const change = result.changes.find((c) => c.colId === 'a');
    expect(change?.kind).toBe('hide');
    expect(change?.newValue).toBe(true);
    expect(change?.oldValue).toBe(false);
  });

  it('omitted leaves are untouched (no change record)', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', hide: true }] },
      noLocks,
    );
    expect(result.changes.find((c) => c.colId === 'b')).toBeUndefined();
    expect(result.changes.find((c) => c.colId === 'c')).toBeUndefined();
  });

  it('width mutation produces a width change record + mutates resolved col-def', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', width: 250 }] },
      noLocks,
    );
    const change = result.changes.find((c) => c.colId === 'a' && c.kind === 'width');
    expect(change).toBeDefined();
    expect(change?.newValue).toBe(250);
    expect(tree.leafById.get('a')?.width).toBe(250);
  });

  it('pinned mutation lands "right" + mutates resolved col-def', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', pinned: 'right' }] },
      noLocks,
    );
    const change = result.changes.find((c) => c.colId === 'a' && c.kind === 'pinned');
    expect(change?.newValue).toBe('right');
    expect(tree.leafById.get('a')?.pinned).toBe('right');
  });

  it('pinned: null unpins a pinned column', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'b', pinned: null }] },
      noLocks,
    );
    const change = result.changes.find((c) => c.colId === 'b' && c.kind === 'pinned');
    expect(change?.newValue).toBe(null);
    expect(tree.leafById.get('b')?.pinned).toBeUndefined();
  });
});

describe('applyStateToTree — defaultState fallback', () => {
  it('defaultState applies to every leaf not in state', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', hide: false }], defaultState: { hide: true } },
      noLocks,
    );
    expect(tree.leafById.get('a')?.hide).toBe(false);
    expect(tree.leafById.get('b')?.hide).toBe(true);
    expect(tree.leafById.get('c')?.hide).toBe(true);
    expect(tree.leafById.get('d')?.hide).toBe(true);
    // 'a' had hide:false already (default) so no change record;
    // b/c/d flipped — 3 change records.
    expect(result.changes.filter((c) => c.kind === 'hide').length).toBe(3);
  });
});

describe('applyStateToTree — applyOrder', () => {
  it('applyOrder: true returns a new leaf order honoring the input list', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      {
        state: [
          { colId: 'd' }, { colId: 'a' }, { colId: 'b' }, { colId: 'c' },
        ],
        applyOrder: true,
      },
      noLocks,
    );
    expect(result.newOrder).toEqual(['d', 'a', 'b', 'c']);
  });

  it('applyOrder: false leaves newOrder null', () => {
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', width: 200 }] },
      noLocks,
    );
    expect(result.newOrder).toBe(null);
  });
});

describe('applyStateToTree — lockVisible / lockPinned', () => {
  it('lockVisible: true silently drops a hide mutation', () => {
    const tree = makeTree();
    const locks: SnapshotLocks = {
      lockVisibleOf: (id) => id === 'a',
      lockPinnedOf: () => false,
    };
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', hide: true }] },
      locks,
    );
    expect(tree.leafById.get('a')?.hide).toBe(false);
    expect(result.changes.find((c) => c.kind === 'hide')).toBeUndefined();
  });

  it('lockPinned: true silently drops a pinned mutation', () => {
    const tree = makeTree();
    const locks: SnapshotLocks = {
      lockVisibleOf: () => false,
      lockPinnedOf: (id) => id === 'b',
    };
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'b', pinned: null }] },
      locks,
    );
    expect(tree.leafById.get('b')?.pinned).toBe('left');
    expect(result.changes.find((c) => c.kind === 'pinned')).toBeUndefined();
  });

  it('lockVisible does not affect width / sort / pinned mutations on the same leaf', () => {
    const tree = makeTree();
    const locks: SnapshotLocks = {
      lockVisibleOf: (id) => id === 'a',
      lockPinnedOf: () => false,
    };
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', hide: true, width: 300 }] },
      locks,
    );
    expect(tree.leafById.get('a')?.hide).toBe(false); // rejected
    expect(tree.leafById.get('a')?.width).toBe(300); // landed
    expect(result.changes.find((c) => c.colId === 'a' && c.kind === 'width')).toBeDefined();
  });
});

describe('applyStateToTree — opaque round-trip slots', () => {
  it('rowGroup / pivot / aggFunc round-trip without firing a change record (reserved slots)', () => {
    // Reserved slots: cycles 13/14/17 will wire model logic. Until then they
    // round-trip opaquely — `getColumnState` reports the stored value, and
    // `applyColumnState` stashes whatever was passed. No event fan-out yet.
    const tree = makeTree();
    const result = applyStateToTree(
      tree,
      { state: [{ colId: 'a', rowGroup: true, aggFunc: 'sum', pivot: true }] },
      noLocks,
    );
    // None of these slots have a fire-event kind in this cycle.
    expect(result.changes.filter((c) => c.colId === 'a' && (
      c.kind === 'width' || c.kind === 'hide' || c.kind === 'pinned'
      || c.kind === 'sort' || c.kind === 'flex'
    )).length).toBe(0);
  });
});

describe('cloneStateForReset', () => {
  it('returns a deep clone — mutating result does not affect input', () => {
    const original = [
      { colId: 'a', width: 100, hide: false, pinned: null as 'left' | 'right' | null },
      { colId: 'b', width: 150, hide: true, pinned: 'left' as const },
    ];
    const cloned = cloneStateForReset(original);
    cloned[0]!.width = 999;
    cloned[1]!.hide = false;
    expect(original[0]!.width).toBe(100);
    expect(original[1]!.hide).toBe(true);
  });
});
