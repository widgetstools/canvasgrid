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
  copy: ReturnType<typeof vi.fn>;
  paste: ReturnType<typeof vi.fn>;
  cut: ReturnType<typeof vi.fn>;
  csvExport: ReturnType<typeof vi.fn>;
  excelExport: ReturnType<typeof vi.fn>;
} {
  const autoSize = vi.fn();
  const reset = vi.fn();
  const pinned = vi.fn();
  const copy = vi.fn().mockResolvedValue(undefined);
  const paste = vi.fn().mockResolvedValue(undefined);
  const cut = vi.fn().mockResolvedValue(undefined);
  const csvExport = vi.fn().mockResolvedValue(undefined);
  const excelExport = vi.fn().mockResolvedValue(undefined);
  const grid: DefaultMenuGrid = {
    autoSizeAllColumns: autoSize as unknown as DefaultMenuGrid['autoSizeAllColumns'],
    resetColumnState: reset as unknown as DefaultMenuGrid['resetColumnState'],
    setColumnsPinned: pinned as unknown as DefaultMenuGrid['setColumnsPinned'],
    copySelectedRangesToClipboard: copy as unknown as DefaultMenuGrid['copySelectedRangesToClipboard'],
    pasteFromClipboard: paste as unknown as DefaultMenuGrid['pasteFromClipboard'],
    cutSelectedRanges: cut as unknown as DefaultMenuGrid['cutSelectedRanges'],
    exportDataAsCsv: csvExport as unknown as DefaultMenuGrid['exportDataAsCsv'],
    exportDataAsExcel: excelExport as unknown as DefaultMenuGrid['exportDataAsExcel'],
  };
  return { grid, autoSize, reset, pinned, copy, paste, cut, csvExport, excelExport };
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

  it('returns 8 items + 2 separators in the documented order (matches docs/catalog/screenshots/19-context-menu-default.png — Cut/Copy/Copy-with-Headers/Paste/--/Export/--/Autosize/Pin Column ►/Reset)', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const labels = items.map(labelOf);
    expect(labels).toEqual([
      'Cut',
      'Copy',
      'Copy with Headers',
      'Paste',
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

  it('Cut / Copy / Paste carry their Ctrl+X / Ctrl+C / Ctrl+V shortcut hints', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const byName = new Map(items.map((i) => [i.name, i]));
    expect(byName.get('Cut')!.shortcut).toBe('Ctrl+X');
    expect(byName.get('Copy')!.shortcut).toBe('Ctrl+C');
    expect(byName.get('Paste')!.shortcut).toBe('Ctrl+V');
  });

  it('Copy / Copy with Headers / Paste / Cut actions exist and do not throw', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const byName = new Map(items.map((i) => [i.name, i]));
    for (const name of ['Copy', 'Copy with Headers', 'Paste', 'Cut']) {
      const it = byName.get(name)!;
      expect(typeof it.action).toBe('function');
      expect(() => it.action!(makeParams({ colId: 'a' }))).not.toThrow();
    }
  });

  it('Copy action routes to grid.copySelectedRangesToClipboard() (Cycle 10 / Task 3)', () => {
    const { grid, copy } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const copyItem = items.find((i) => i.name === 'Copy')!;
    copyItem.action!(makeParams({ colId: 'a' }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(); // no headers
  });

  it('Copy with Headers routes with { includeHeaders: true } (Cycle 21i)', () => {
    const { grid, copy } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const item = items.find((i) => i.name === 'Copy with Headers')!;
    item.action!(makeParams({ colId: 'a' }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith({ includeHeaders: true });
  });

  it('Paste action routes to grid.pasteFromClipboard() (Cycle 10 / Task 4)', () => {
    const { grid, paste } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const pasteItem = items.find((i) => i.name === 'Paste')!;
    pasteItem.action!(makeParams({ colId: 'a' }));
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it('Cut action routes to grid.cutSelectedRanges() (Cycle 10 / Task 5)', () => {
    const { grid, cut } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const cutItem = items.find((i) => i.name === 'Cut')!;
    cutItem.action!(makeParams({ colId: 'a' }));
    expect(cut).toHaveBeenCalledTimes(1);
  });

  it('Export item carries a CSV + Excel submenu (Cycle 20)', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const exportItem = items.find((i) => i.name === 'Export')!;
    expect(exportItem.subMenu).toBeDefined();
    const subNames = exportItem.subMenu!.map((s) => s.name);
    expect(subNames).toEqual(['CSV Export', 'Excel Export']);
  });

  it('CSV Export submenu item routes to grid.exportDataAsCsv()', () => {
    const { grid, csvExport } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const csvItem = items.find((i) => i.name === 'Export')!.subMenu!
      .find((s) => s.name === 'CSV Export')!;
    csvItem.action!(makeParams({ colId: 'a' }));
    expect(csvExport).toHaveBeenCalledTimes(1);
  });

  it('Excel Export submenu item routes to grid.exportDataAsExcel()', () => {
    const { grid, excelExport } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const xlsxItem = items.find((i) => i.name === 'Export')!.subMenu!
      .find((s) => s.name === 'Excel Export')!;
    xlsxItem.action!(makeParams({ colId: 'a' }));
    expect(excelExport).toHaveBeenCalledTimes(1);
  });

  it('Export submenu items render disabled when the host did not supply the methods', () => {
    // Host built before Cycle 20 doesn't expose exportDataAs*.
    const gridNoExport: DefaultMenuGrid = {
      autoSizeAllColumns: vi.fn() as unknown as DefaultMenuGrid['autoSizeAllColumns'],
      resetColumnState: vi.fn() as unknown as DefaultMenuGrid['resetColumnState'],
      setColumnsPinned: vi.fn() as unknown as DefaultMenuGrid['setColumnsPinned'],
      copySelectedRangesToClipboard: vi.fn() as unknown as DefaultMenuGrid['copySelectedRangesToClipboard'],
      pasteFromClipboard: vi.fn() as unknown as DefaultMenuGrid['pasteFromClipboard'],
      cutSelectedRanges: vi.fn() as unknown as DefaultMenuGrid['cutSelectedRanges'],
    };
    const items = buildDefaultMenuItems(gridNoExport, makeParams({ colId: 'a' }));
    const exportItem = items.find((i) => i.name === 'Export')!;
    expect(exportItem.disabled).toBe(true);
    const sub = exportItem.subMenu!;
    expect(sub.find((s) => s.name === 'CSV Export')!.disabled).toBe(true);
    expect(sub.find((s) => s.name === 'Excel Export')!.disabled).toBe(true);
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

  it('Pin Column opens a submenu with Pin Left / Pin Right / No Pin', () => {
    const { grid } = makeGridStub();
    const items = buildDefaultMenuItems(grid, makeParams({ colId: 'a' }));
    const pin = items.find((i) => i.name === 'Pin Column')!;
    expect(pin.subMenu).toBeDefined();
    const subLabels = pin.subMenu!.map(labelOf);
    expect(subLabels).toEqual(['Pin Left', 'Pin Right', 'No Pin']);
  });

  it('Pin Column → Pin Left calls setColumnsPinned([colId], "left")', () => {
    const { grid, pinned } = makeGridStub();
    const params = makeParams({ colId: 'price' });
    const items = buildDefaultMenuItems(grid, params);
    const pin = items.find((i) => i.name === 'Pin Column')!;
    const left = pin.subMenu!.find((i) => i.name === 'Pin Left')!;
    left.action!(params);
    expect(pinned).toHaveBeenCalledWith(['price'], 'left');
  });

  it('Pin Column → Pin Right calls setColumnsPinned([colId], "right")', () => {
    const { grid, pinned } = makeGridStub();
    const params = makeParams({ colId: 'price' });
    const items = buildDefaultMenuItems(grid, params);
    const pin = items.find((i) => i.name === 'Pin Column')!;
    const right = pin.subMenu!.find((i) => i.name === 'Pin Right')!;
    right.action!(params);
    expect(pinned).toHaveBeenCalledWith(['price'], 'right');
  });

  it('Pin Column → No Pin calls setColumnsPinned([colId], null)', () => {
    const { grid, pinned } = makeGridStub();
    const params = makeParams({ colId: 'price' });
    const items = buildDefaultMenuItems(grid, params);
    const pin = items.find((i) => i.name === 'Pin Column')!;
    const clear = pin.subMenu!.find((i) => i.name === 'No Pin')!;
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
    pin.subMenu!.find((i) => i.name === 'Pin Left')!.action!(makeParams({ colId: null }));
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
