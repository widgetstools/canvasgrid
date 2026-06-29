/**
 * Cycle 18 / Task 7 — header context menu pivot items.
 *
 * The right-click on a column header is the keyboard/non-drag route to the
 * three pivot roles. The items mirror Task 5 (tool panel plz/valz zones) and
 * Task 6 (top-of-grid pivot panel) — see the SYNC INVARIANT in the cycle
 * memory. ALL items mutate through the SAME PivotState verbs the drag/
 * checkbox surfaces call. No parallel state-mutation path.
 *
 * Items (gated on the per-column enableX flags + current mode):
 *   - "Add to Labels" / "Remove from Labels"   when enablePivot
 *   - "Value: Aggregate <col>" ►              when enableValue
 *       submenu — registered agg names, checked = current agg
 *       click semantics:
 *         not a value col       → addValueColumn(colId, picked)
 *         value col + same agg  → removeValueColumn(colId) (toggle-off)
 *         value col + diff agg  → setValueColumnAggFunc(colId, picked)
 *   - "Scroll to column"                       when pivotMode === false AND visible
 *
 * The existing Cycle 15.5 "Group by ..." item also keeps working under
 * pivotMode === true (the Cycle 15 auto-group column behavior is unchanged).
 *
 * AG-parity: Prompt 7 in /Users/develop/Downloads/pivot-behaviors-prompts.md.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildDefaultMainMenuItems,
  type DefaultMainMenuGrid,
} from '../src/interaction/contextMenu/mainMenuDefaults';
import type { GetMainMenuItemsParams, MenuItem } from '../src/interaction/contextMenu/types';

interface StubOpts {
  pivotMode?: boolean;
  pivotable?: Set<string>;        // colIds with enablePivot
  valueable?: Set<string>;        // colIds with enableValue
  visible?: Set<string>;          // colIds with hide !== true
  pivotColumns?: string[];
  valueColumns?: Array<{ colId: string; aggFunc: string }>;
  rowGroupColumns?: string[];     // for the existing 15.5 items
  aggFuncs?: string[];            // registered agg names
  headerNames?: Record<string, string>;
}

interface Spies {
  grid: DefaultMainMenuGrid;
  addPivot: ReturnType<typeof vi.fn>;
  removePivot: ReturnType<typeof vi.fn>;
  addValue: ReturnType<typeof vi.fn>;
  removeValue: ReturnType<typeof vi.fn>;
  setValueAgg: ReturnType<typeof vi.fn>;
  ensureColVisible: ReturnType<typeof vi.fn>;
  addGroup: ReturnType<typeof vi.fn>;
  removeGroup: ReturnType<typeof vi.fn>;
}

function makeGridStub(opts: StubOpts = {}): Spies {
  const pivotable = opts.pivotable ?? new Set<string>();
  const valueable = opts.valueable ?? new Set<string>();
  const visible = opts.visible ?? new Set<string>();
  const pivotCols = [...(opts.pivotColumns ?? [])];
  const valueCols = (opts.valueColumns ?? []).map((v) => ({ ...v }));
  const rowGroupCols = [...(opts.rowGroupColumns ?? [])];
  const aggFuncs = opts.aggFuncs ?? ['sum', 'avg', 'min', 'max', 'count'];
  const headerNames = opts.headerNames ?? {};

  const addPivot = vi.fn();
  const removePivot = vi.fn();
  const addValue = vi.fn();
  const removeValue = vi.fn();
  const setValueAgg = vi.fn();
  const ensureColVisible = vi.fn();
  const addGroup = vi.fn();
  const removeGroup = vi.fn();

  const grid: DefaultMainMenuGrid = {
    autoSizeColumns: vi.fn().mockResolvedValue(undefined),
    autoSizeAllColumns: vi.fn().mockResolvedValue(undefined),
    resetColumnState: vi.fn(),
    setColumnsPinned: vi.fn(),
    getColumnHeaderName: (colId) => headerNames[colId],
    // Cycle 15.5
    isColumnRowGroupEnabled: () => false,
    getRowGroupColumns: () => [...rowGroupCols],
    addRowGroupColumn: addGroup,
    removeRowGroupColumn: removeGroup,
    // Cycle 18 / Task 7 — pivot surface
    isPivotMode: () => opts.pivotMode === true,
    isColumnPivotEnabled: (colId) => pivotable.has(colId),
    isColumnValueEnabled: (colId) => valueable.has(colId),
    isColumnVisible: (colId) => visible.has(colId),
    getPivotColumns: () => [...pivotCols],
    getValueColumns: () => valueCols.map((v) => ({ ...v })),
    addPivotColumn: addPivot,
    removePivotColumn: removePivot,
    addValueColumn: addValue,
    removeValueColumn: removeValue,
    setValueColumnAggFunc: setValueAgg,
    ensureColumnVisible: ensureColVisible,
    getRegisteredAggFuncNames: () => [...aggFuncs],
  };
  return {
    grid, addPivot, removePivot, addValue, removeValue,
    setValueAgg, ensureColVisible, addGroup, removeGroup,
  };
}

function makeParams(colId = 'sector'): GetMainMenuItemsParams {
  return { colId, defaultItems: [] };
}

function labelOf(item: MenuItem): string { return item.name; }

// ─── "Add to Labels" / "Remove from Labels" ───────────────────────────────

describe('mainMenuDefaults — Add to Labels / Remove from Labels (Task 7)', () => {
  it('shows "Add to Labels" when the column has enablePivot AND is NOT currently a pivot column', () => {
    const { grid } = makeGridStub({
      pivotable: new Set(['sector']),
      headerNames: { sector: 'Sector' },
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    const labels = items.map(labelOf);
    expect(labels).toContain('Add to Labels');
    expect(labels).not.toContain('Remove from Labels');
  });

  it('shows "Remove from Labels" when the column IS currently a pivot column', () => {
    const { grid } = makeGridStub({
      pivotable: new Set(['sector']),
      pivotColumns: ['sector'],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    const labels = items.map(labelOf);
    expect(labels).toContain('Remove from Labels');
    expect(labels).not.toContain('Add to Labels');
  });

  it('hides BOTH Add/Remove items when the column lacks enablePivot', () => {
    const { grid } = makeGridStub({
      pivotable: new Set(),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('price'));
    const labels = items.map(labelOf);
    expect(labels).not.toContain('Add to Labels');
    expect(labels).not.toContain('Remove from Labels');
  });

  it('"Add to Labels" calls grid.addPivotColumn(colId)', () => {
    const { grid, addPivot } = makeGridStub({
      pivotable: new Set(['sector']),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    items.find((i) => i.name === 'Add to Labels')!.action!(makeParams('sector'));
    expect(addPivot).toHaveBeenCalledWith('sector');
  });

  it('"Remove from Labels" calls grid.removePivotColumn(colId)', () => {
    const { grid, removePivot } = makeGridStub({
      pivotable: new Set(['sector']),
      pivotColumns: ['sector'],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    items.find((i) => i.name === 'Remove from Labels')!.action!(makeParams('sector'));
    expect(removePivot).toHaveBeenCalledWith('sector');
  });

  it('omits Add/Remove from Labels entirely when the grid stub does not expose the pivot predicate (back-compat)', () => {
    // Cycle 10 surface — no isColumnPivotEnabled. Items must not appear.
    const grid: DefaultMainMenuGrid = {
      autoSizeColumns: vi.fn().mockResolvedValue(undefined),
      autoSizeAllColumns: vi.fn().mockResolvedValue(undefined),
      resetColumnState: vi.fn(),
      setColumnsPinned: vi.fn(),
    };
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    expect(items.map(labelOf)).toEqual([
      'Pin Column',
      'Autosize This Column',
      'Autosize All Columns',
      '---',
      'Reset Columns',
    ]);
  });
});

// ─── "Value: Aggregate <col>" submenu ─────────────────────────────────────

describe('mainMenuDefaults — Value: Aggregate <col> (Task 7)', () => {
  it('shows "Value: Aggregate <headerName>" with a submenu when the column has enableValue', () => {
    const { grid } = makeGridStub({
      valueable: new Set(['notional']),
      headerNames: { notional: 'Notional' },
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    const valueItem = items.find((i) => i.name === 'Value: Aggregate Notional');
    expect(valueItem).toBeDefined();
    expect(valueItem!.subMenu).toBeDefined();
    expect(valueItem!.subMenu!.length).toBeGreaterThan(0);
  });

  it('falls back to the colId when getColumnHeaderName is undefined', () => {
    const { grid } = makeGridStub({
      valueable: new Set(['notional']),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    expect(items.find((i) => i.name === 'Value: Aggregate notional')).toBeDefined();
  });

  it('hides the Value item when the column lacks enableValue', () => {
    const { grid } = makeGridStub({
      valueable: new Set(),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    expect(items.find((i) => i.name.startsWith('Value: Aggregate'))).toBeUndefined();
  });

  it('submenu lists the registered agg funcs from getRegisteredAggFuncNames in order', () => {
    const { grid } = makeGridStub({
      valueable: new Set(['notional']),
      headerNames: { notional: 'Notional' },
      aggFuncs: ['sum', 'avg', 'min', 'max', 'count', 'p99'],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    const valueItem = items.find((i) => i.name === 'Value: Aggregate Notional')!;
    expect(valueItem.subMenu!.map((i) => i.name)).toEqual([
      'sum', 'avg', 'min', 'max', 'count', 'p99',
    ]);
  });

  it('marks the currently-active aggFunc with a check icon when the column IS a value column', () => {
    const { grid } = makeGridStub({
      valueable: new Set(['notional']),
      valueColumns: [{ colId: 'notional', aggFunc: 'avg' }],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    const submenu = items.find((i) => i.name.startsWith('Value: Aggregate'))!.subMenu!;
    expect(submenu.find((i) => i.name === 'avg')!.icon).toBe('✓');
    expect(submenu.find((i) => i.name === 'sum')!.icon).toBeUndefined();
  });

  it('leaves all submenu items unchecked when the column is NOT currently a value column', () => {
    const { grid } = makeGridStub({
      valueable: new Set(['notional']),
      valueColumns: [],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    const submenu = items.find((i) => i.name.startsWith('Value: Aggregate'))!.subMenu!;
    for (const sub of submenu) expect(sub.icon).toBeUndefined();
  });

  it('clicking a submenu item when the col is NOT a value column calls addValueColumn(colId, picked)', () => {
    const { grid, addValue, removeValue, setValueAgg } = makeGridStub({
      valueable: new Set(['notional']),
      valueColumns: [],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    const submenu = items.find((i) => i.name.startsWith('Value: Aggregate'))!.subMenu!;
    submenu.find((i) => i.name === 'avg')!.action!(makeParams('notional'));
    expect(addValue).toHaveBeenCalledWith('notional', 'avg');
    expect(removeValue).not.toHaveBeenCalled();
    expect(setValueAgg).not.toHaveBeenCalled();
  });

  it('clicking the CURRENT agg toggles the column off via removeValueColumn(colId)', () => {
    const { grid, addValue, removeValue, setValueAgg } = makeGridStub({
      valueable: new Set(['notional']),
      valueColumns: [{ colId: 'notional', aggFunc: 'avg' }],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    const submenu = items.find((i) => i.name.startsWith('Value: Aggregate'))!.subMenu!;
    submenu.find((i) => i.name === 'avg')!.action!(makeParams('notional'));
    expect(removeValue).toHaveBeenCalledWith('notional');
    expect(addValue).not.toHaveBeenCalled();
    expect(setValueAgg).not.toHaveBeenCalled();
  });

  it('clicking a DIFFERENT agg on a value column calls setValueColumnAggFunc(colId, picked)', () => {
    const { grid, addValue, removeValue, setValueAgg } = makeGridStub({
      valueable: new Set(['notional']),
      valueColumns: [{ colId: 'notional', aggFunc: 'sum' }],
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    const submenu = items.find((i) => i.name.startsWith('Value: Aggregate'))!.subMenu!;
    submenu.find((i) => i.name === 'max')!.action!(makeParams('notional'));
    expect(setValueAgg).toHaveBeenCalledWith('notional', 'max');
    expect(addValue).not.toHaveBeenCalled();
    expect(removeValue).not.toHaveBeenCalled();
  });

  it('omits the Value item entirely when the grid stub does not expose isColumnValueEnabled (back-compat)', () => {
    const grid: DefaultMainMenuGrid = {
      autoSizeColumns: vi.fn().mockResolvedValue(undefined),
      autoSizeAllColumns: vi.fn().mockResolvedValue(undefined),
      resetColumnState: vi.fn(),
      setColumnsPinned: vi.fn(),
    };
    const items = buildDefaultMainMenuItems(grid, makeParams('notional'));
    expect(items.find((i) => i.name.startsWith('Value: Aggregate'))).toBeUndefined();
  });
});

// ─── "Scroll to column" ────────────────────────────────────────────────────

describe('mainMenuDefaults — Scroll to column (Task 7)', () => {
  it('shows "Scroll to column" when pivotMode === false AND the column is visible', () => {
    const { grid } = makeGridStub({
      pivotMode: false,
      visible: new Set(['ticker']),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    expect(items.map(labelOf)).toContain('Scroll to column');
  });

  it('hides "Scroll to column" when pivotMode === true (secondary cols have no 1:1 primary mapping)', () => {
    const { grid } = makeGridStub({
      pivotMode: true,
      visible: new Set(['ticker']),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    expect(items.map(labelOf)).not.toContain('Scroll to column');
  });

  it('hides "Scroll to column" when the column is hidden', () => {
    const { grid } = makeGridStub({
      pivotMode: false,
      visible: new Set(),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    expect(items.map(labelOf)).not.toContain('Scroll to column');
  });

  it('"Scroll to column" calls grid.ensureColumnVisible(colId)', () => {
    const { grid, ensureColVisible } = makeGridStub({
      pivotMode: false,
      visible: new Set(['ticker']),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    items.find((i) => i.name === 'Scroll to column')!.action!(makeParams('ticker'));
    expect(ensureColVisible).toHaveBeenCalledWith('ticker');
  });

  it('omits "Scroll to column" entirely when the grid stub does not expose ensureColumnVisible (back-compat)', () => {
    const grid: DefaultMainMenuGrid = {
      autoSizeColumns: vi.fn().mockResolvedValue(undefined),
      autoSizeAllColumns: vi.fn().mockResolvedValue(undefined),
      resetColumnState: vi.fn(),
      setColumnsPinned: vi.fn(),
    };
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    expect(items.map(labelOf)).not.toContain('Scroll to column');
  });
});

// ─── Section ordering + separators ────────────────────────────────────────

describe('mainMenuDefaults — Task 7 item ordering + separator hygiene', () => {
  it('pivot items appear AFTER Reset Columns, separated by a single divider', () => {
    const { grid } = makeGridStub({
      pivotable: new Set(['sector']),
      valueable: new Set(['sector']),
      headerNames: { sector: 'Sector' },
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    const labels = items.map(labelOf);
    const resetIdx = labels.indexOf('Reset Columns');
    const addLabelsIdx = labels.indexOf('Add to Labels');
    const valueIdx = labels.indexOf('Value: Aggregate Sector');
    expect(resetIdx).toBeGreaterThanOrEqual(0);
    expect(addLabelsIdx).toBeGreaterThan(resetIdx);
    expect(valueIdx).toBeGreaterThan(addLabelsIdx);
    // Exactly one separator between Reset Columns and the role items
    // (the existing one). No double-separator hiccup.
    expect(labels[resetIdx + 1]).toBe('---');
    expect(labels[resetIdx + 2]).not.toBe('---');
  });

  it('"Scroll to column" appears LAST with its own separator', () => {
    const { grid } = makeGridStub({
      pivotMode: false,
      pivotable: new Set(['sector']),
      visible: new Set(['sector']),
      headerNames: { sector: 'Sector' },
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    const labels = items.map(labelOf);
    const lastIdx = labels.length - 1;
    expect(labels[lastIdx]).toBe('Scroll to column');
    expect(labels[lastIdx - 1]).toBe('---');
  });

  it('does NOT introduce a stray separator when no role items + no scroll item show', () => {
    // No enablePivot, no enableValue, no enableRowGroup, no visible — just
    // the base 5-item list, no new separators from Task 7.
    const { grid } = makeGridStub({});
    const items = buildDefaultMainMenuItems(grid, makeParams('orphan'));
    expect(items.map(labelOf)).toEqual([
      'Pin Column',
      'Autosize This Column',
      'Autosize All Columns',
      '---',
      'Reset Columns',
    ]);
  });

  it('does NOT introduce a stray separator when ONLY "Scroll to column" qualifies', () => {
    const { grid } = makeGridStub({
      pivotMode: false,
      visible: new Set(['ticker']),
    });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const labels = items.map(labelOf);
    // [..., Reset Columns, ---, Scroll to column]
    expect(labels[labels.length - 3]).toBe('Reset Columns');
    expect(labels[labels.length - 2]).toBe('---');
    expect(labels[labels.length - 1]).toBe('Scroll to column');
    // Only TWO separators in total — the one between Autosize and Reset,
    // and the one before Scroll to column.
    expect(labels.filter((l) => l === '---').length).toBe(2);
  });
});
