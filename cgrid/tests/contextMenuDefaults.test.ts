/**
 * Cycle 10 / Task 2 — default context-menu items registry.
 *
 * `buildDefaultMenuItems(grid, params)` returns the 8 built-in items
 * (Copy, Copy with Headers, Paste, Cut, Export, Autosize Columns,
 * Pin Column ►, Reset Columns) with two separators between the logical
 * groups (clipboard / export / column-ops). Apps that don't supply
 * `CGridOptions.getContextMenuItems` see this list directly; apps that
 * DO supply one read the same list via `params.defaultItems` and
 * mix-and-match.
 *
 * Copy / Paste / Cut are stubbed for Task 2 — they call
 * `console.debug('[clipboard]')`. Tasks 3-5 replace those with the
 * real worker-backed clipboard methods.
 *
 * The grid surface this registry needs is intentionally narrow — just
 * the column-ops and (eventually) clipboard methods. The `DefaultMenuGrid`
 * interface in `defaults.ts` documents that surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildDefaultMenuItems, type DefaultMenuGrid } from '../src/interaction/contextMenu/defaults';
import type { GetContextMenuItemsParams, MenuItem } from '../src/interaction/contextMenu/types';

function makeGridStub(): {
  grid: DefaultMenuGrid;
  autoSize: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  pinned: ReturnType<typeof vi.fn>;
} {
  const autoSize = vi.fn();
  const reset = vi.fn();
  const pinned = vi.fn();
  const grid: DefaultMenuGrid = {
    autoSizeAllColumns: autoSize as unknown as DefaultMenuGrid['autoSizeAllColumns'],
    resetColumnState: reset as unknown as DefaultMenuGrid['resetColumnState'],
    setColumnsPinned: pinned as unknown as DefaultMenuGrid['setColumnsPinned'],
  };
  return { grid, autoSize, reset, pinned };
}

function makeParams(overrides: Partial<GetContextMenuItemsParams> = {}): GetContextMenuItemsParams {
  return {
    rowIndex: null,
    colId: null,
    ranges: [],
    defaultItems: [],
    ...overrides,
  };
}

function labelOf(item: MenuItem): string { return item.name; }

describe('buildDefaultMenuItems', () => {
  beforeEach(() => {
    // Silence the clipboard / export console.debug stubs in the test output
    // — they're noise once we've already asserted they ran.
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 8 items + 2 separators in the documented order', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const labels = items.map(labelOf);
    expect(labels).toEqual([
      'Copy',
      'Copy with Headers',
      'Paste',
      'Cut',
      '---',
      'Export',
      '---',
      'Autosize Columns',
      'Pin Column',
      'Reset Columns',
    ]);
    const realItems = items.filter((i) => i.name !== '---');
    const seps = items.filter((i) => i.name === '---');
    expect(realItems.length).toBe(8);
    expect(seps.length).toBe(2);
  });

  it('Copy / Copy with Headers / Paste / Cut actions exist and do not throw (stubs)', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const byName = new Map(items.map((i) => [i.name, i]));
    for (const name of ['Copy', 'Copy with Headers', 'Paste', 'Cut']) {
      const it = byName.get(name)!;
      expect(typeof it.action).toBe('function');
      expect(() => it.action!(makeParams({ colId: 'a' }))).not.toThrow();
    }
    // Tasks 3-5 replace the stubs; until then, they emit a debug breadcrumb
    // so a curious developer can see them fire.
    expect(console.debug).toHaveBeenCalled();
  });

  it('Export action exists and does not throw (stub)', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const exportItem = items.find((i) => i.name === 'Export')!;
    expect(typeof exportItem.action).toBe('function');
    expect(() => exportItem.action!(makeParams({ colId: 'a' }))).not.toThrow();
  });

  it('Autosize Columns action calls grid.autoSizeAllColumns()', () => {
    const { grid, autoSize } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const autosize = items.find((i) => i.name === 'Autosize Columns')!;
    autosize.action!(makeParams({ colId: 'a' }));
    expect(autoSize).toHaveBeenCalledTimes(1);
  });

  it('Reset Columns action calls grid.resetColumnState()', () => {
    const { grid, reset } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const resetItem = items.find((i) => i.name === 'Reset Columns')!;
    resetItem.action!(makeParams({ colId: 'a' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('Pin Column opens a submenu with Left / Right / Clear', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const pin = items.find((i) => i.name === 'Pin Column')!;
    expect(pin.subMenu).toBeDefined();
    const subLabels = pin.subMenu!.map(labelOf);
    expect(subLabels).toEqual(['Left', 'Right', 'Clear']);
  });

  it('Pin Column → Left calls setColumnsPinned([colId], "left")', () => {
    const { grid, pinned } = makeGridStub();
    const params = makeParams({ colId: 'price' });
    const items = buildDefaultMenuItems(grid, params);
    const pin = items.find((i) => i.name === 'Pin Column')!;
    const left = pin.subMenu!.find((i) => i.name === 'Left')!;
    left.action!(params);
    expect(pinned).toHaveBeenCalledWith(['price'], 'left');
  });

  it('Pin Column → Right calls setColumnsPinned([colId], "right")', () => {
    const { grid, pinned } = makeGridStub();
    const params = makeParams({ colId: 'price' });
    const items = buildDefaultMenuItems(grid, params);
    const pin = items.find((i) => i.name === 'Pin Column')!;
    const right = pin.subMenu!.find((i) => i.name === 'Right')!;
    right.action!(params);
    expect(pinned).toHaveBeenCalledWith(['price'], 'right');
  });

  it('Pin Column → Clear calls setColumnsPinned([colId], null)', () => {
    const { grid, pinned } = makeGridStub();
    const params = makeParams({ colId: 'price' });
    const items = buildDefaultMenuItems(grid, params);
    const pin = items.find((i) => i.name === 'Pin Column')!;
    const clear = pin.subMenu!.find((i) => i.name === 'Clear')!;
    clear.action!(params);
    expect(pinned).toHaveBeenCalledWith(['price'], null);
  });

  it('Pin Column is disabled when params.colId is null (right-click outside a column)', () => {
    const { grid, pinned } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: null }));
    const pin = items.find((i) => i.name === 'Pin Column')!;
    expect(pin.disabled).toBe(true);
    // Even if invoked manually, it's a no-op (no pin call) so accidental
    // hosting that doesn't honour `disabled` doesn't pin a phantom column.
    pin.subMenu!.find((i) => i.name === 'Left')!.action!(makeParams({ colId: null }));
    expect(pinned).not.toHaveBeenCalled();
  });

  it('icon slots are populated for the four clipboard items', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    for (const name of ['Copy', 'Copy with Headers', 'Paste', 'Cut']) {
      const it = items.find((i) => i.name === name)!;
      expect(typeof it.icon).toBe('string');
      expect(it.icon!.length).toBeGreaterThan(0);
    }
  });
});
