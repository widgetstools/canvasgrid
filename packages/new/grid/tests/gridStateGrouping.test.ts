// Cycle 15.5 / Task 10 — Grid State save/restore for grouping tests.
//
// Covers:
//  - serialize() produces a plain-object snapshot
//  - restore() applies a snapshot and emits groupingStateChanged once
//  - rowGroupColumns reordering is preserved through serialize/restore
//  - perLevelSort preserved through round-trip
//  - restore emits 'restore' source in event
//  - serialize is independent (mutating returned value doesn't affect state)
//  - restore with empty snapshot clears the state
//  - restore with sort entries recreates them correctly

import { describe, it, expect, vi } from 'vitest';
import { GroupingState } from '../src/core/groupingState';
import type { GroupingStateSnapshot } from '../src/core/groupingState';

// ─── serialize() ──────────────────────────────────────────────────────────────

describe('GroupingState.serialize()', () => {
  it('empty state → empty snapshot', () => {
    const gs = new GroupingState();
    const snap = gs.serialize();
    expect(snap.rowGroupColumns).toEqual([]);
    expect(snap.perLevelSort).toEqual([]);
  });

  it('preserves rowGroupColumns order', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region', 'sector'] });
    const snap = gs.serialize();
    expect(snap.rowGroupColumns).toEqual(['desk', 'region', 'sector']);
  });

  it('perLevelSort null entries are serialized as null', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    const snap = gs.serialize();
    expect(snap.perLevelSort).toEqual([null, null]);
  });

  it('perLevelSort with set entries is preserved', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs.setRowGroupColumnSort('desk', 'desc');
    gs.setRowGroupColumnSort('region', 'asc');
    const snap = gs.serialize();
    expect(snap.perLevelSort[0]).toEqual({ direction: 'desc' });
    expect(snap.perLevelSort[1]).toEqual({ direction: 'asc' });
  });

  it('returned snapshot is structurally independent (deep copy)', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    const snap = gs.serialize();
    // Mutate the returned snapshot
    snap.rowGroupColumns.push('region');
    // State should not be affected
    expect(gs.getRowGroupColumns()).toEqual(['desk']);
  });

  it('snapshot is JSON-round-trip safe', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs.setRowGroupColumnSort('desk', 'asc');
    const snap = gs.serialize();
    const restored = JSON.parse(JSON.stringify(snap)) as GroupingStateSnapshot;
    expect(restored.rowGroupColumns).toEqual(['desk', 'region']);
    expect(restored.perLevelSort[0]).toEqual({ direction: 'asc' });
    expect(restored.perLevelSort[1]).toBeNull();
  });
});

// ─── restore() ────────────────────────────────────────────────────────────────

describe('GroupingState.restore()', () => {
  it('restores rowGroupColumns from snapshot', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    gs.restore({ rowGroupColumns: ['region', 'sector'], perLevelSort: [null, null] });
    expect(gs.getRowGroupColumns()).toEqual(['region', 'sector']);
  });

  it('restores perLevelSort from snapshot', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    gs.restore({
      rowGroupColumns: ['desk', 'region'],
      perLevelSort: [{ direction: 'desc' }, null],
    });
    const sort = gs.getPerLevelSort();
    expect(sort[0]?.direction).toBe('desc');
    expect(sort[1]).toBeNull();
  });

  it('restore emits exactly one groupingStateChanged event', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    const events: string[] = [];
    gs.on('groupingStateChanged', (e) => events.push(e.source));
    gs.restore({ rowGroupColumns: ['region'], perLevelSort: [null] });
    expect(events).toEqual(['restore']);
  });

  it("restore event has source 'restore'", () => {
    const gs = new GroupingState();
    let source = '';
    gs.on('groupingStateChanged', (e) => { source = e.source; });
    gs.restore({ rowGroupColumns: ['desk'], perLevelSort: [null] });
    expect(source).toBe('restore');
  });

  it('restore with empty snapshot clears all columns', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs.restore({ rowGroupColumns: [], perLevelSort: [] });
    expect(gs.getRowGroupColumns()).toEqual([]);
    expect(gs.getPerLevelSort()).toEqual([]);
  });

  it('full round-trip preserves state exactly', () => {
    const gs1 = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs1.setRowGroupColumnSort('desk', 'desc');
    gs1.setRowGroupColumnSort('region', 'asc');
    const snap = gs1.serialize();

    const gs2 = new GroupingState();
    gs2.restore(snap);

    expect(gs2.getRowGroupColumns()).toEqual(gs1.getRowGroupColumns());
    const sort1 = gs1.getPerLevelSort();
    const sort2 = gs2.getPerLevelSort();
    expect(sort2[0]?.direction).toBe(sort1[0]?.direction);
    expect(sort2[1]?.direction).toBe(sort1[1]?.direction);
  });

  it('restore does not share references with snapshot', () => {
    const snap: GroupingStateSnapshot = {
      rowGroupColumns: ['desk'],
      perLevelSort: [{ direction: 'asc' }],
    };
    const gs = new GroupingState();
    gs.restore(snap);
    // Mutate the original snapshot
    snap.rowGroupColumns.push('region');
    // gs should not be affected
    expect(gs.getRowGroupColumns()).toEqual(['desk']);
  });

  it('consecutive restores each fire one event', () => {
    const gs = new GroupingState();
    const events: string[] = [];
    gs.on('groupingStateChanged', (e) => events.push(e.source));
    gs.restore({ rowGroupColumns: ['desk'], perLevelSort: [null] });
    gs.restore({ rowGroupColumns: ['region'], perLevelSort: [null] });
    expect(events).toEqual(['restore', 'restore']);
  });
});

// ─── Snapshot type checks ─────────────────────────────────────────────────────

describe('GroupingStateSnapshot type', () => {
  it('accepts asc and desc direction values', () => {
    const snap: GroupingStateSnapshot = {
      rowGroupColumns: ['desk', 'region'],
      perLevelSort: [{ direction: 'asc' }, { direction: 'desc' }],
    };
    expect(snap.perLevelSort[0]?.direction).toBe('asc');
    expect(snap.perLevelSort[1]?.direction).toBe('desc');
  });

  it('null perLevelSort entries are valid', () => {
    const snap: GroupingStateSnapshot = {
      rowGroupColumns: ['desk'],
      perLevelSort: [null],
    };
    expect(snap.perLevelSort[0]).toBeNull();
  });
});
