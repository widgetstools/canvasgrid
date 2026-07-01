/**
 * Cycle 15.5 / Task 2 — header context menu Group / Un-Group items.
 *
 * The default main-menu list shipped in Cycle 10 (post-cycle patch)
 * covers Pin Column ► / Autosize / Reset Columns. Cycle 15.5 / Task 2
 * appends four grouping items at the end of the list, each gated on
 * a visibility predicate:
 *   - "Group by `<col>`"     — when enableRowGroup AND not currently grouped
 *   - "Un-Group by `<col>`"  — when currently a group level
 *   - "Expand All Groups"    — when grouping is active
 *   - "Collapse All Groups"  — when grouping is active
 *
 * Each item mutates `rowGroupColumns` (or the expansion state) through
 * the SAME primitive API the row group panel + tool panel zone use —
 * the three-views-one-list invariant from the worklog.
 *
 * 10 cases per worklog Task 2.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildDefaultMainMenuItems,
  type DefaultMainMenuGrid,
} from '../src/interaction/contextMenu/mainMenuDefaults';
import type { GetMainMenuItemsParams, MenuItem } from '../src/interaction/contextMenu/types';

function makeGridStub(opts?: {
  rowGroupColumns?: string[];
  groupable?: Set<string>;
  headerNames?: Record<string, string>;
}): {
  grid: DefaultMainMenuGrid;
  addGroup: ReturnType<typeof vi.fn>;
  removeGroup: ReturnType<typeof vi.fn>;
  expand: ReturnType<typeof vi.fn>;
  collapse: ReturnType<typeof vi.fn>;
} {
  const rowGroupColumns = [...(opts?.rowGroupColumns ?? [])];
  const groupable = opts?.groupable ?? new Set(['ticker', 'sector']);
  const headerNames = opts?.headerNames ?? { ticker: 'Ticker', sector: 'Sector' };

  const addGroup = vi.fn();
  const removeGroup = vi.fn();
  const expand = vi.fn();
  const collapse = vi.fn();

  const grid: DefaultMainMenuGrid = {
    autoSizeColumns: vi.fn().mockResolvedValue(undefined),
    autoSizeAllColumns: vi.fn().mockResolvedValue(undefined),
    resetColumnState: vi.fn(),
    setColumnsPinned: vi.fn(),
    isColumnRowGroupEnabled: (colId: string) => groupable.has(colId),
    getRowGroupColumns: () => [...rowGroupColumns],
    addRowGroupColumn: addGroup,
    removeRowGroupColumn: removeGroup,
    expandAll: expand,
    collapseAll: collapse,
    getColumnHeaderName: (colId: string) => headerNames[colId],
  };
  return { grid, addGroup, removeGroup, expand, collapse };
}

function makeParams(colId = 'ticker'): GetMainMenuItemsParams {
  return { colId, defaultItems: [] };
}

function labelOf(item: MenuItem): string { return item.name; }

describe('buildDefaultMainMenuItems — group items (Cycle 15.5 / Task 2)', () => {
  it('shows "Group by <headerName>" when the column is groupable AND not currently grouped', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const labels = items.map(labelOf);
    expect(labels).toContain('Group by Ticker');
    expect(labels).not.toContain('Un-Group by Ticker');
  });

  it('hides "Group by" when the column is NOT groupable', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('price'));
    const labels = items.map(labelOf);
    expect(labels.some((l) => l.startsWith('Group by'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Un-Group by'))).toBe(false);
  });

  it('shows "Un-Group by <headerName>" (and hides "Group by") when the column is currently grouped', () => {
    const { grid } = makeGridStub({ rowGroupColumns: ['ticker'] });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const labels = items.map(labelOf);
    expect(labels).toContain('Un-Group by Ticker');
    expect(labels).not.toContain('Group by Ticker');
  });

  it('"Group by" calls addRowGroupColumn(colId)', () => {
    const { grid, addGroup } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('sector'));
    const item = items.find((i) => i.name === 'Group by Sector')!;
    item.action!(makeParams('sector'));
    expect(addGroup).toHaveBeenCalledWith('sector');
  });

  it('"Un-Group by" calls removeRowGroupColumn(colId)', () => {
    const { grid, removeGroup } = makeGridStub({ rowGroupColumns: ['ticker'] });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const item = items.find((i) => i.name === 'Un-Group by Ticker')!;
    item.action!(makeParams('ticker'));
    expect(removeGroup).toHaveBeenCalledWith('ticker');
  });

  it('shows "Expand All Groups" and "Collapse All Groups" when grouping is active', () => {
    const { grid } = makeGridStub({ rowGroupColumns: ['ticker'] });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const labels = items.map(labelOf);
    expect(labels).toContain('Expand All Groups');
    expect(labels).toContain('Collapse All Groups');
  });

  it('hides Expand/Collapse All Groups when no grouping is active', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const labels = items.map(labelOf);
    expect(labels).not.toContain('Expand All Groups');
    expect(labels).not.toContain('Collapse All Groups');
  });

  it('"Expand All Groups" calls grid.expandAll() and "Collapse All Groups" calls grid.collapseAll()', () => {
    const { grid, expand, collapse } = makeGridStub({ rowGroupColumns: ['ticker'] });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    items.find((i) => i.name === 'Expand All Groups')!.action!(makeParams('ticker'));
    items.find((i) => i.name === 'Collapse All Groups')!.action!(makeParams('ticker'));
    expect(expand).toHaveBeenCalledTimes(1);
    expect(collapse).toHaveBeenCalledTimes(1);
  });

  it('group items are preceded by a separator (only when at least one group item is visible)', () => {
    // Visible: groupable + grouping active.
    const withGroups = makeGridStub({ rowGroupColumns: ['ticker'] });
    const itemsWith = buildDefaultMainMenuItems(withGroups.grid, makeParams('ticker'));
    // The list is: [..., Reset Columns, ---, ---, Un-Group..., Expand..., Collapse...]
    // Two separators: one between Autosize and Reset, one before the group items.
    const seps = itemsWith.filter((i) => i.name === '---');
    expect(seps.length).toBe(2);
    // Hidden: nothing groupable, nothing grouped.
    const withoutGroups = makeGridStub({ groupable: new Set(), rowGroupColumns: [] });
    const itemsWithout = buildDefaultMainMenuItems(withoutGroups.grid, makeParams('price'));
    const sepsWithout = itemsWithout.filter((i) => i.name === '---');
    expect(sepsWithout.length).toBe(1);
  });

  it('falls back to the colId when getColumnHeaderName returns undefined', () => {
    const { grid } = makeGridStub({ headerNames: {} });
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const labels = items.map(labelOf);
    expect(labels).toContain('Group by ticker');
  });

  it('omits the group items entirely when the grid stub does not expose the predicates (back-compat / Cycle 10 default surface)', () => {
    // Mirrors the old Cycle 10 grid stub — no isColumnRowGroupEnabled,
    // no getRowGroupColumns. The registry must keep the original 5-item
    // list (Pin Column / Autosize × 2 / Reset Columns).
    const grid: DefaultMainMenuGrid = {
      autoSizeColumns: vi.fn().mockResolvedValue(undefined),
      autoSizeAllColumns: vi.fn().mockResolvedValue(undefined),
      resetColumnState: vi.fn(),
      setColumnsPinned: vi.fn(),
    };
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const labels = items.map(labelOf);
    expect(labels).toEqual([
      'Pin Column',
      'Autosize This Column',
      'Autosize All Columns',
      '---',
      'Reset Columns',
    ]);
  });
});
