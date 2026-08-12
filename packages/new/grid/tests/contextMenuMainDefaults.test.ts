/**
 * Cycle 10 (post-cycle patch) — default MAIN-menu (header) items registry.
 *
 * Mirrors `contextMenuDefaults.test.ts` for the cell registry, but exercises
 * `buildDefaultMainMenuItems` and its narrower grid surface. The header
 * menu intentionally does NOT carry clipboard items — right-clicking a
 * header has no cell-range context, so Cut / Copy / Paste are absent.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildDefaultMainMenuItems,
  type DefaultMainMenuGrid,
} from '../src/interaction/contextMenu/mainMenuDefaults';
import type { GetMainMenuItemsParams, MenuItem } from '../src/interaction/contextMenu/types';

function makeGridStub(): {
  grid: DefaultMainMenuGrid;
  autoOne: ReturnType<typeof vi.fn>;
  autoAll: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  pinned: ReturnType<typeof vi.fn>;
} {
  const autoOne = vi.fn().mockResolvedValue(undefined);
  const autoAll = vi.fn().mockResolvedValue(undefined);
  const reset = vi.fn();
  const pinned = vi.fn();
  const grid: DefaultMainMenuGrid = {
    autoSizeColumns: autoOne as unknown as DefaultMainMenuGrid['autoSizeColumns'],
    autoSizeAllColumns: autoAll as unknown as DefaultMainMenuGrid['autoSizeAllColumns'],
    resetColumnState: reset as unknown as DefaultMainMenuGrid['resetColumnState'],
    setColumnsPinned: pinned as unknown as DefaultMainMenuGrid['setColumnsPinned'],
  };
  return { grid, autoOne, autoAll, reset, pinned };
}

function makeParams(colId = 'price'): GetMainMenuItemsParams {
  return { colId, defaultItems: [] };
}

function labelOf(item: MenuItem): string { return item.name; }

describe('buildDefaultMainMenuItems (header / column menu)', () => {
  it('returns Pin Column ► / Autosize This Column / Autosize All Columns / — / Reset Columns in order', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams());
    expect(items.map(labelOf)).toEqual([
      'Pin Column',
      'Autosize This Column',
      'Autosize All Columns',
      '---',
      'Reset Columns',
    ]);
  });

  it('does NOT include clipboard items (Cut / Copy / Paste) — those belong to the cell menu', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams());
    const labels = items.map(labelOf);
    expect(labels).not.toContain('Cut');
    expect(labels).not.toContain('Copy');
    expect(labels).not.toContain('Copy with Headers');
    expect(labels).not.toContain('Paste');
    expect(labels).not.toContain('Export');
  });

  it('Pin Column opens a submenu with Pin Left / Pin Right / No Pin', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams());
    const pin = items.find((i) => i.name === 'Pin Column')!;
    expect(pin.subMenu).toBeDefined();
    expect(pin.subMenu!.map(labelOf)).toEqual(['Pin Left', 'Pin Right', 'No Pin']);
  });

  it('Pin Column → Pin Left calls setColumnsPinned([colId], "left") with the header colId', () => {
    const { grid, pinned } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('spread'));
    const pin = items.find((i) => i.name === 'Pin Column')!;
    pin.subMenu!.find((i) => i.name === 'Pin Left')!.action!(makeParams('spread'));
    expect(pinned).toHaveBeenCalledWith(['spread'], 'left');
  });

  it('Pin Column → No Pin calls setColumnsPinned([colId], null)', () => {
    const { grid, pinned } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('spread'));
    const pin = items.find((i) => i.name === 'Pin Column')!;
    pin.subMenu!.find((i) => i.name === 'No Pin')!.action!(makeParams('spread'));
    expect(pinned).toHaveBeenCalledWith(['spread'], null);
  });

  it('Autosize This Column calls autoSizeColumns([colId]) — NOT the All variant', () => {
    const { grid, autoOne, autoAll } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const one = items.find((i) => i.name === 'Autosize This Column')!;
    one.action!(makeParams('ticker'));
    expect(autoOne).toHaveBeenCalledWith(['ticker']);
    expect(autoAll).not.toHaveBeenCalled();
  });

  it('Autosize All Columns calls autoSizeAllColumns() — no per-column key', () => {
    const { grid, autoOne, autoAll } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams('ticker'));
    const all = items.find((i) => i.name === 'Autosize All Columns')!;
    all.action!(makeParams('ticker'));
    expect(autoAll).toHaveBeenCalledTimes(1);
    expect(autoOne).not.toHaveBeenCalled();
  });

  it('Reset Columns calls grid.resetColumnState()', () => {
    const { grid, reset } = makeGridStub();
    const items = buildDefaultMainMenuItems(grid, makeParams());
    items.find((i) => i.name === 'Reset Columns')!.action!(makeParams());
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
