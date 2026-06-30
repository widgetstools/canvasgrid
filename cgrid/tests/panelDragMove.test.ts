import { describe, it, expect, vi } from 'vitest';
import {
  commitPanelMove, canAcceptInRole, resolveDragTargetRole,
  type PanelMoveApi,
} from '../src/core/panelDragMove';

/**
 * Cross-section pill drag routing. When a user drags a pill from one of
 * the five panel containers (top-strip Row Group panel, top-strip Pivot
 * panel, columns-panel Row Groups zone, Column Labels zone, Values zone)
 * and drops it on a DIFFERENT one, the column should MOVE to the new
 * role — remove from source + add to target — atomically. Today each
 * panel's drag-out just removes (or silent no-ops) — this is the bug.
 *
 * `commitPanelMove(api, fromRole, toRole, colId)` is the pure helper
 * each panel calls on pointerup. Returns true on success, false when
 * the target rejects (target role doesn't accept this column).
 */

function makeApi(opts: Partial<{
  enableRowGroup: Set<string>;
  enablePivot: Set<string>;
  enableValue: Set<string>;
  rowGroupColumns: string[];
  pivotColumns: string[];
  valueColumns: Array<{ colId: string }>;
  defaultAggFunc: (colId: string) => string | undefined;
}> = {}): PanelMoveApi & {
  state: {
    rowGroups: string[];
    pivots: string[];
    values: Array<{ colId: string; aggFunc?: string }>;
  };
} {
  const state = {
    rowGroups: [...(opts.rowGroupColumns ?? [])],
    pivots: [...(opts.pivotColumns ?? [])],
    values: [...(opts.valueColumns ?? [])].map((v) => ({ colId: v.colId })),
  };
  const enableRowGroup = opts.enableRowGroup ?? new Set();
  const enablePivot = opts.enablePivot ?? new Set();
  const enableValue = opts.enableValue ?? new Set();
  return {
    state,
    isColumnRowGroupEnabled: (c) => enableRowGroup.has(c),
    isColumnPivotEnabled: (c) => enablePivot.has(c),
    isColumnValueEnabled: (c) => enableValue.has(c),
    getRowGroupColumns: () => [...state.rowGroups],
    getPivotColumns: () => [...state.pivots],
    getValueColumns: () => state.values.map((v) => ({ colId: v.colId })),
    addRowGroupColumn: (c) => { if (!state.rowGroups.includes(c)) state.rowGroups.push(c); },
    removeRowGroupColumn: (c) => { state.rowGroups = state.rowGroups.filter((x) => x !== c); },
    addPivotColumn: (c) => { if (!state.pivots.includes(c)) state.pivots.push(c); },
    removePivotColumn: (c) => { state.pivots = state.pivots.filter((x) => x !== c); },
    addValueColumn: (c, agg) => {
      if (!state.values.some((v) => v.colId === c)) state.values.push({ colId: c, aggFunc: agg });
    },
    removeValueColumn: (c) => { state.values = state.values.filter((v) => v.colId !== c); },
    getColumnDefaultAggFunc: opts.defaultAggFunc,
  };
}

describe('canAcceptInRole', () => {
  it('reads the matching enable flag per target role', () => {
    const api = makeApi({
      enableRowGroup: new Set(['a']),
      enablePivot: new Set(['b']),
      enableValue: new Set(['c']),
    });
    expect(canAcceptInRole(api, 'rowGroup', 'a')).toBe(true);
    expect(canAcceptInRole(api, 'rowGroup', 'b')).toBe(false);
    expect(canAcceptInRole(api, 'pivot', 'b')).toBe(true);
    expect(canAcceptInRole(api, 'value', 'c')).toBe(true);
    expect(canAcceptInRole(api, 'value', 'a')).toBe(false);
  });
});

describe('commitPanelMove — happy paths', () => {
  it('rowGroup → pivot removes from rowGroups and adds to pivots', () => {
    const api = makeApi({
      rowGroupColumns: ['desk'],
      enablePivot: new Set(['desk']),
    });
    expect(commitPanelMove(api, 'rowGroup', 'pivot', 'desk')).toBe(true);
    expect(api.state.rowGroups).toEqual([]);
    expect(api.state.pivots).toEqual(['desk']);
  });

  it('pivot → rowGroup removes from pivots and adds to rowGroups', () => {
    const api = makeApi({
      pivotColumns: ['region'],
      enableRowGroup: new Set(['region']),
    });
    expect(commitPanelMove(api, 'pivot', 'rowGroup', 'region')).toBe(true);
    expect(api.state.pivots).toEqual([]);
    expect(api.state.rowGroups).toEqual(['region']);
  });

  it('rowGroup → value uses the default aggFunc (sum) when none is supplied', () => {
    const api = makeApi({
      rowGroupColumns: ['x'],
      enableValue: new Set(['x']),
    });
    expect(commitPanelMove(api, 'rowGroup', 'value', 'x')).toBe(true);
    expect(api.state.rowGroups).toEqual([]);
    expect(api.state.values).toEqual([{ colId: 'x', aggFunc: 'sum' }]);
  });

  it('rowGroup → value honors getColumnDefaultAggFunc when supplied', () => {
    const api = makeApi({
      rowGroupColumns: ['x'],
      enableValue: new Set(['x']),
      defaultAggFunc: (c) => c === 'x' ? 'avg' : undefined,
    });
    commitPanelMove(api, 'rowGroup', 'value', 'x');
    expect(api.state.values).toEqual([{ colId: 'x', aggFunc: 'avg' }]);
  });

  it('value → pivot removes from values and adds to pivots', () => {
    const api = makeApi({
      valueColumns: [{ colId: 'pnl' }],
      enablePivot: new Set(['pnl']),
    });
    expect(commitPanelMove(api, 'value', 'pivot', 'pnl')).toBe(true);
    expect(api.state.values).toEqual([]);
    expect(api.state.pivots).toEqual(['pnl']);
  });
});

describe('commitPanelMove — rejection cases', () => {
  it('returns false and does NOT remove from source when target rejects (no enable flag)', () => {
    const api = makeApi({
      rowGroupColumns: ['desk'],
      // desk lacks enablePivot
    });
    expect(commitPanelMove(api, 'rowGroup', 'pivot', 'desk')).toBe(false);
    expect(api.state.rowGroups).toEqual(['desk']);
    expect(api.state.pivots).toEqual([]);
  });

  it('same role is a no-op', () => {
    const api = makeApi({
      rowGroupColumns: ['desk'],
      enableRowGroup: new Set(['desk']),
    });
    expect(commitPanelMove(api, 'rowGroup', 'rowGroup', 'desk')).toBe(false);
    expect(api.state.rowGroups).toEqual(['desk']);
  });
});

describe('resolveDragTargetRole', () => {
  it('reads data-cg-pill-role from the closest ancestor of elementFromPoint', () => {
    const container = document.createElement('div');
    container.setAttribute('data-cg-pill-role', 'pivot');
    const inner = document.createElement('span');
    container.appendChild(inner);
    document.body.appendChild(container);
    const fakeDoc = {
      elementFromPoint: vi.fn().mockReturnValue(inner),
    } as any;
    expect(resolveDragTargetRole(10, 10, fakeDoc)).toBe('pivot');
    document.body.removeChild(container);
  });

  it('returns null when elementFromPoint hits nothing or no marker is found', () => {
    const fakeDoc = { elementFromPoint: vi.fn().mockReturnValue(null) } as any;
    expect(resolveDragTargetRole(0, 0, fakeDoc)).toBeNull();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const fakeDoc2 = { elementFromPoint: vi.fn().mockReturnValue(div) } as any;
    expect(resolveDragTargetRole(0, 0, fakeDoc2)).toBeNull();
    document.body.removeChild(div);
  });

  it('returns null for an unknown role value (defensive)', () => {
    const container = document.createElement('div');
    container.setAttribute('data-cg-pill-role', 'garbage');
    document.body.appendChild(container);
    const fakeDoc = { elementFromPoint: vi.fn().mockReturnValue(container) } as any;
    expect(resolveDragTargetRole(0, 0, fakeDoc)).toBeNull();
    document.body.removeChild(container);
  });
});
