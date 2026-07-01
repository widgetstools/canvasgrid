// Cycle 15.5 / Task 11 — Three UIs one list invariant tests.
//
// Asserts that all three grouping UIs (row group panel, columns tool panel,
// context menu) share ONE canonical `rowGroupColumns` list via GroupingState.
// These tests treat GroupingState as the shared bus and verify that mutations
// from any surface immediately reflect in the state that all three surfaces
// would observe.

import { describe, it, expect, vi } from 'vitest';
import { GroupingState } from '../src/core/groupingState';

// ─── Shared bus via GroupingState events ──────────────────────────────────────
// The three UIs each subscribe to 'groupingStateChanged' and re-render from
// the payload. We simulate that here with two subscribers (representing two
// different UI surfaces) to verify the invariant.

describe('Three UIs one list: GroupingState as shared bus', () => {
  it('case 1: mutate via surface A → surface B reflects immediately', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });

    // Surface A: current state
    let surfaceBView: string[] = [...gs.getRowGroupColumns()];
    gs.on('groupingStateChanged', (e) => {
      surfaceBView = [...e.rowGroupColumns];
    });

    // Surface A adds a column
    gs.addRowGroupColumn('region');

    // Surface B's subscription fires synchronously
    expect(surfaceBView).toEqual(['desk', 'region']);
  });

  it('case 2: mutate via surface B → surface A reflects', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });

    let surfaceAView: string[] = [...gs.getRowGroupColumns()];
    gs.on('groupingStateChanged', (e) => {
      surfaceAView = [...e.rowGroupColumns];
    });

    // Surface B removes a column
    gs.removeRowGroupColumn('desk');

    expect(surfaceAView).toEqual(['region']);
  });

  it('case 3: mutate via primitive API → all subscribers reflect', () => {
    const gs = new GroupingState({ rowGroupColumns: [] });

    const views: string[][] = [[], []];
    gs.on('groupingStateChanged', (e) => { views[0] = [...e.rowGroupColumns]; });
    gs.on('groupingStateChanged', (e) => { views[1] = [...e.rowGroupColumns]; });

    // Primitive API mutation
    gs.setRowGroupColumns(['desk', 'region', 'sector']);

    expect(views[0]).toEqual(['desk', 'region', 'sector']);
    expect(views[1]).toEqual(['desk', 'region', 'sector']);
  });

  it('case 4: setRowGroupColumns replaces entire list atomically', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });

    let received: string[] = [];
    gs.on('groupingStateChanged', (e) => { received = [...e.rowGroupColumns]; });

    gs.setRowGroupColumns(['sector', 'country']);

    // Atomic: observers see only the new list, not intermediate state
    expect(received).toEqual(['sector', 'country']);
    expect(gs.getRowGroupColumns()).toEqual(['sector', 'country']);
  });

  it('case 5: groupingStateChanged fires exactly once per mutation', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    const cb = vi.fn();
    gs.on('groupingStateChanged', cb);

    gs.addRowGroupColumn('region');
    gs.setRowGroupColumnSort('desk', 'asc');
    gs.removeRowGroupColumn('region');

    // 3 mutations → 3 events
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('case 6: reorder via move → context menu would see reordered list', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region', 'sector'] });

    let menuView: string[] = [...gs.getRowGroupColumns()];
    gs.on('groupingStateChanged', (e) => { menuView = [...e.rowGroupColumns]; });

    // Panel reorders: move 'sector' (index 2) before 'desk' (index 0)
    gs.moveRowGroupColumn(2, 0);

    // Context menu observes updated order
    expect(menuView[0]).toBe('sector');
    expect(menuView[1]).toBe('desk');
    expect(menuView[2]).toBe('region');
  });

  it('case 7: sort mutation fires source "sort" to all subscribers', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    const sources: string[] = [];
    gs.on('groupingStateChanged', (e) => { sources.push(e.source); });
    gs.on('groupingStateChanged', (e) => { sources.push(e.source + '2'); });

    gs.setRowGroupColumnSort('desk', 'desc');

    expect(sources).toContain('sort');
    expect(sources).toContain('sort2');
  });

  it('case 8: all three views agree after a restore', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs.setRowGroupColumnSort('desk', 'asc');

    // Simulate three surfaces subscribing
    const viewA: { cols: string[]; sort: any[] } = { cols: [], sort: [] };
    const viewB: { cols: string[]; sort: any[] } = { cols: [], sort: [] };
    const viewC: { cols: string[]; sort: any[] } = { cols: [], sort: [] };
    gs.on('groupingStateChanged', (e) => {
      viewA.cols = [...e.rowGroupColumns];
      viewA.sort = [...e.perLevelSort];
    });
    gs.on('groupingStateChanged', (e) => {
      viewB.cols = [...e.rowGroupColumns];
      viewB.sort = [...e.perLevelSort];
    });
    gs.on('groupingStateChanged', (e) => {
      viewC.cols = [...e.rowGroupColumns];
      viewC.sort = [...e.perLevelSort];
    });

    // Grid State restore
    gs.restore({ rowGroupColumns: ['sector'], perLevelSort: [{ direction: 'desc' }] });

    // All three surfaces see the same state
    expect(viewA.cols).toEqual(['sector']);
    expect(viewB.cols).toEqual(['sector']);
    expect(viewC.cols).toEqual(['sector']);
    expect(viewA.sort[0]?.direction).toBe('desc');
    expect(viewB.sort[0]?.direction).toBe('desc');
    expect(viewC.sort[0]?.direction).toBe('desc');
  });
});
