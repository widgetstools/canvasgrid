/**
 * Cycle 10 / Task 6 — `suppressContextMenu` / `suppressClipboardApi` /
 * `suppressClipboardPaste` gates.
 *
 * Three top-level options to take cgrid's right-click + clipboard
 * surfaces offline so apps that ship their own can take over:
 *
 *  - `suppressContextMenu`  — `RightClick` swallows `contextmenu` (still
 *    `preventDefault`s so the native menu doesn't fire, but does NOT
 *    mount the cgrid popup).
 *  - `suppressClipboardApi` — `copySelectedRangesToClipboard` /
 *    `pasteFromClipboard` / `cutSelectedRanges` reject with
 *    `Error('clipboard-suppressed')` and a one-time `console.warn`;
 *    `KeyboardShortcuts` forwards Ctrl+C / Ctrl+V / Ctrl+X through the
 *    chain (no `preventDefault`) so host-page listeners can take over.
 *  - `suppressClipboardPaste` — `pasteFromClipboard` resolves silently
 *    (no clipboard read); Ctrl+V short-circuits; the default `Paste`
 *    context-menu item renders `disabled: true`.
 *
 * Every gate is read at event / call time so a runtime `setGridOption`
 * flip lights up on the next interaction without re-wiring.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { RightClick } from '../src/interaction/features/rightClick';
import { KeyboardShortcuts } from '../src/interaction/features/keyboardShortcuts';
import { Feature, type VelocityGridEventCtx, type VelocityGridLike } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';
import { buildDefaultMenuItems, type DefaultMenuGrid } from '../src/interaction/contextMenu/defaults';
import type { GetContextMenuItemsParams, MenuItem } from '../src/interaction/contextMenu/types';

// ---------------------------------------------------------------------------
// Test harness: jsdom Worker + Canvas2D mocks (mirrors cellRangesApi.test.ts).
// ---------------------------------------------------------------------------
beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

interface Row { id: string; a: number; b: number }
function build(
  options: Partial<Parameters<typeof VelocityGrid>[1]> = {},
): { grid: VelocityGrid<Row>; container: HTMLDivElement } {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const rows: Row[] = [
    { id: '1', a: 1, b: 2 },
    { id: '2', a: 3, b: 4 },
    { id: '3', a: 5, b: 6 },
  ];
  const grid = new VelocityGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    getRowId: (r) => r.id,
    rowData: rows,
    ...options,
  } as any);
  // Synthesise the worker `ready` message so init() resolves.
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return { grid, container };
}

// ---------------------------------------------------------------------------
// Feature-level mock grid — covers the slice of VelocityGridLike that
// RightClick / KeyboardShortcuts touch in Task 6.
// ---------------------------------------------------------------------------
interface FeatureMockOptions {
  /** `isContextMenuSuppressed()` return. */
  suppressContextMenu?: boolean;
  /** `isClipboardApiSuppressed()` return. */
  suppressClipboardApi?: boolean;
  /** `isClipboardPasteSuppressed()` return. */
  suppressClipboardPaste?: boolean;
  /** Result of `selection.getRanges()`. */
  ranges?: Array<{ rowStart: number; rowEnd: number; colIds: string[] }>;
  /** Focused row index (Ctrl+V uses this to decide if it should fire). */
  focusedRowIndex?: number | null;
  /** Focused colId. */
  focusedColId?: string | null;
  /** Editor open — short-circuits the shortcut chain. */
  editing?: boolean;
}

interface FeatureMock {
  grid: VelocityGridLike;
  resolveSpy: ReturnType<typeof vi.fn>;
  openContextMenuSpy: ReturnType<typeof vi.fn>;
  closeContextMenuSpy: ReturnType<typeof vi.fn>;
  copySpy: ReturnType<typeof vi.fn>;
  pasteSpy: ReturnType<typeof vi.fn>;
  cutSpy: ReturnType<typeof vi.fn>;
}

function makeFeatureMock(opts: FeatureMockOptions = {}): FeatureMock {
  const ranges = opts.ranges ?? [];
  const resolveSpy = vi.fn().mockReturnValue([{ name: 'X' }] as MenuItem[]);
  const openContextMenuSpy = vi.fn();
  const closeContextMenuSpy = vi.fn();
  const copySpy = vi.fn().mockResolvedValue(undefined);
  const pasteSpy = vi.fn().mockResolvedValue(undefined);
  const cutSpy = vi.fn().mockResolvedValue(undefined);
  const grid = {
    selection: {
      getRanges: () => ranges,
      state: {
        focusedRowIndex: opts.focusedRowIndex ?? 0,
        focusedColId: opts.focusedColId ?? 'a',
      },
    },
    isEditing: () => opts.editing === true,
    isContextMenuSuppressed: () => opts.suppressContextMenu === true,
    isClipboardApiSuppressed: () => opts.suppressClipboardApi === true,
    isClipboardPasteSuppressed: () => opts.suppressClipboardPaste === true,
    resolveContextMenuItems: resolveSpy,
    openContextMenu: openContextMenuSpy,
    closeContextMenu: closeContextMenuSpy,
    copySelectedRangesToClipboard: copySpy,
    pasteFromClipboard: pasteSpy,
    cutSelectedRanges: cutSpy,
  } as unknown as VelocityGridLike;
  return { grid, resolveSpy, openContextMenuSpy, closeContextMenuSpy, copySpy, pasteSpy, cutSpy };
}

function ctxFor(grid: VelocityGridLike, raw: MouseEvent | KeyboardEvent, hit: Hit = { kind: 'cell', rowIndex: 0, colId: 'a' }): VelocityGridEventCtx {
  return { grid, hit, point: { x: 0, y: 0 }, raw };
}

class TailSpy extends Feature {
  override handleContextMenu = vi.fn();
  override handleKeyDown = vi.fn();
}

// ---------------------------------------------------------------------------
// 1. RightClick — suppressContextMenu
// ---------------------------------------------------------------------------
describe('RightClick + suppressContextMenu (Cycle 10 / Task 6)', () => {
  it('suppressContextMenu: true — preventDefault fires but no menu opens', () => {
    const f = new RightClick();
    const tail = new TailSpy();
    f.next = tail;
    const m = makeFeatureMock({ suppressContextMenu: true });
    const raw = new MouseEvent('contextmenu', { clientX: 10, clientY: 20, button: 2 });
    const preventDefaultSpy = vi.spyOn(raw, 'preventDefault');

    f.handleContextMenu(ctxFor(m.grid, raw));

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(m.resolveSpy).not.toHaveBeenCalled();
    expect(m.openContextMenuSpy).not.toHaveBeenCalled();
    // The feature consumed the event — downstream features should NOT see
    // the contextmenu (we don't want a stray editor / floating-filter
    // handler to re-act on it).
    expect(tail.handleContextMenu).not.toHaveBeenCalled();
  });

  it('suppressContextMenu: false (default) — normal flow opens the menu', () => {
    const f = new RightClick();
    const m = makeFeatureMock({ suppressContextMenu: false });
    const raw = new MouseEvent('contextmenu', { clientX: 50, clientY: 70, button: 2 });
    const preventDefaultSpy = vi.spyOn(raw, 'preventDefault');

    f.handleContextMenu(ctxFor(m.grid, raw));

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(m.resolveSpy).toHaveBeenCalledTimes(1);
    expect(m.openContextMenuSpy).toHaveBeenCalledTimes(1);
    expect(m.openContextMenuSpy).toHaveBeenCalledWith(
      [{ name: 'X' }],
      50,
      70,
      { kind: 'cell', rowIndex: 0, colId: 'a' },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. KeyboardShortcuts — suppressClipboardApi (copy / paste / cut all gated)
// ---------------------------------------------------------------------------
describe('KeyboardShortcuts + suppressClipboardApi (Cycle 10 / Task 6)', () => {
  it('Ctrl+C: suppressClipboardApi: true — forwards via super; no copy; no preventDefault', () => {
    const f = new KeyboardShortcuts();
    const tail = new TailSpy();
    f.next = tail;
    const m = makeFeatureMock({
      suppressClipboardApi: true,
      ranges: [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    });
    const raw = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(raw, 'preventDefault');

    f.handleKeyDown(ctxFor(m.grid, raw));

    expect(m.copySpy).not.toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(tail.handleKeyDown).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+V: suppressClipboardApi: true — forwards via super; no paste; no preventDefault', () => {
    const f = new KeyboardShortcuts();
    const tail = new TailSpy();
    f.next = tail;
    const m = makeFeatureMock({ suppressClipboardApi: true });
    const raw = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(raw, 'preventDefault');

    f.handleKeyDown(ctxFor(m.grid, raw));

    expect(m.pasteSpy).not.toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(tail.handleKeyDown).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+X: suppressClipboardApi: true — forwards via super; no cut; no preventDefault', () => {
    const f = new KeyboardShortcuts();
    const tail = new TailSpy();
    f.next = tail;
    const m = makeFeatureMock({
      suppressClipboardApi: true,
      ranges: [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    });
    const raw = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(raw, 'preventDefault');

    f.handleKeyDown(ctxFor(m.grid, raw));

    expect(m.cutSpy).not.toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(tail.handleKeyDown).toHaveBeenCalledTimes(1);
  });

  it('suppressClipboardApi: false — Ctrl+C fires copy normally', () => {
    const f = new KeyboardShortcuts();
    const m = makeFeatureMock({
      suppressClipboardApi: false,
      ranges: [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    });
    const raw = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(raw, 'preventDefault');

    f.handleKeyDown(ctxFor(m.grid, raw));

    expect(m.copySpy).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. KeyboardShortcuts — suppressClipboardPaste gates Ctrl+V but NOT C/X
// ---------------------------------------------------------------------------
describe('KeyboardShortcuts + suppressClipboardPaste (Cycle 10 / Task 6)', () => {
  it('Ctrl+V: suppressClipboardPaste: true — forwards via super; no paste; no preventDefault', () => {
    const f = new KeyboardShortcuts();
    const tail = new TailSpy();
    f.next = tail;
    const m = makeFeatureMock({ suppressClipboardPaste: true });
    const raw = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(raw, 'preventDefault');

    f.handleKeyDown(ctxFor(m.grid, raw));

    expect(m.pasteSpy).not.toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(tail.handleKeyDown).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C: suppressClipboardPaste: true — copy still fires (only paste is gated)', () => {
    const f = new KeyboardShortcuts();
    const m = makeFeatureMock({
      suppressClipboardPaste: true,
      ranges: [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    });
    const raw = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });

    f.handleKeyDown(ctxFor(m.grid, raw));

    expect(m.copySpy).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+X: suppressClipboardPaste: true — cut still fires (only paste is gated)', () => {
    const f = new KeyboardShortcuts();
    const m = makeFeatureMock({
      suppressClipboardPaste: true,
      ranges: [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    });
    const raw = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true });

    f.handleKeyDown(ctxFor(m.grid, raw));

    expect(m.cutSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. VelocityGrid API — copy / paste / cut short-circuits + warn-once.
// ---------------------------------------------------------------------------
describe('VelocityGrid clipboard API + suppress flags (Cycle 10 / Task 6)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('copySelectedRangesToClipboard rejects with clipboard-suppressed when suppressClipboardApi: true', async () => {
    const { grid } = build({ suppressClipboardApi: true } as any);
    await expect(grid.copySelectedRangesToClipboard()).rejects.toThrow(/clipboard-suppressed/);
    grid.destroy();
  });

  it('pasteFromClipboard rejects with clipboard-suppressed when suppressClipboardApi: true', async () => {
    const { grid } = build({ suppressClipboardApi: true } as any);
    await expect(grid.pasteFromClipboard()).rejects.toThrow(/clipboard-suppressed/);
    grid.destroy();
  });

  it('cutSelectedRanges rejects with clipboard-suppressed when suppressClipboardApi: true', async () => {
    const { grid } = build({ suppressClipboardApi: true } as any);
    await expect(grid.cutSelectedRanges()).rejects.toThrow(/clipboard-suppressed/);
    grid.destroy();
  });

  it('warns exactly once per method when suppressClipboardApi rejects repeatedly', async () => {
    const { grid } = build({ suppressClipboardApi: true } as any);
    await grid.copySelectedRangesToClipboard().catch(() => {});
    await grid.copySelectedRangesToClipboard().catch(() => {});
    await grid.copySelectedRangesToClipboard().catch(() => {});
    // One warn for the copy method, regardless of repeat calls.
    const copyWarns = warnSpy.mock.calls.filter(
      (c) => String(c[0]).includes('copySelectedRangesToClipboard'),
    );
    expect(copyWarns.length).toBe(1);
    grid.destroy();
  });

  it('pasteFromClipboard resolves silently when suppressClipboardPaste: true (no clipboard read)', async () => {
    const readSpy = vi.fn().mockResolvedValue('hello');
    const originalNav = (globalThis as any).navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { readText: readSpy } },
      });
      const { grid } = build({ suppressClipboardPaste: true } as any);
      // Seed focus so the function would otherwise proceed.
      (grid as any).selection.setFocus(0, 'a');
      await expect(grid.pasteFromClipboard()).resolves.toBeUndefined();
      expect(readSpy).not.toHaveBeenCalled();
      grid.destroy();
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNav });
    }
  });

  it('copy + cut are unaffected by suppressClipboardPaste (only paste is gated)', async () => {
    const { grid } = build({ suppressClipboardPaste: true } as any);
    // No ranges seeded — we want to confirm the suppress flag is NOT the
    // reason for rejection. Without ranges, copy throws `no-ranges`; if
    // the flag had wrongly gated copy, we'd see `clipboard-suppressed`.
    await expect(grid.copySelectedRangesToClipboard()).rejects.toThrow(/no-ranges/);
    await expect(grid.cutSelectedRanges()).rejects.toThrow(/no-ranges/);
    grid.destroy();
  });

  it('runtime setGridOption("suppressClipboardApi", false) restores normal behavior', async () => {
    const { grid } = build({ suppressClipboardApi: true } as any);
    await expect(grid.copySelectedRangesToClipboard()).rejects.toThrow(/clipboard-suppressed/);
    grid.setGridOption('suppressClipboardApi', false);
    // After flipping off, the call no longer rejects with `clipboard-suppressed`
    // — it reaches the `no-ranges` check (because we never seeded a range).
    await expect(grid.copySelectedRangesToClipboard()).rejects.toThrow(/no-ranges/);
    grid.destroy();
  });

  it('runtime setGridOption("suppressClipboardPaste", true) gates paste mid-session', async () => {
    // The gate is read at CALL time (not construction). We assert that a
    // mid-session `setGridOption` flip takes effect on the very next call
    // — same pattern apps would use to gate paste in response to e.g. a
    // form-mode toggle.
    const readSpy = vi.fn().mockResolvedValue('hello');
    const originalNav = (globalThis as any).navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { readText: readSpy } },
      });
      const { grid } = build();
      (grid as any).selection.setFocus(0, 'a');
      // Flip the gate, then call paste. The early `return` lands before
      // any clipboard read — `readSpy` is never invoked.
      grid.setGridOption('suppressClipboardPaste', true);
      await grid.pasteFromClipboard();
      expect(readSpy).not.toHaveBeenCalled();
      grid.destroy();
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNav });
    }
  });

  it('runtime setGridOption("suppressContextMenu", true) is accepted (runtime-mutable)', () => {
    const { grid } = build();
    expect(() => grid.setGridOption('suppressContextMenu', true)).not.toThrow();
    expect(grid.getGridOption('suppressContextMenu')).toBe(true);
    grid.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Default Paste item — disabled when suppressClipboardPaste is on.
// ---------------------------------------------------------------------------
describe('buildDefaultMenuItems Paste disabled state (Cycle 10 / Task 6)', () => {
  function makeGridStub(suppressed: boolean): DefaultMenuGrid {
    return {
      autoSizeAllColumns: vi.fn() as unknown as DefaultMenuGrid['autoSizeAllColumns'],
      resetColumnState: vi.fn() as unknown as DefaultMenuGrid['resetColumnState'],
      setColumnsPinned: vi.fn() as unknown as DefaultMenuGrid['setColumnsPinned'],
      copySelectedRangesToClipboard: vi.fn().mockResolvedValue(undefined),
      pasteFromClipboard: vi.fn().mockResolvedValue(undefined),
      cutSelectedRanges: vi.fn().mockResolvedValue(undefined),
      isClipboardPasteSuppressed: () => suppressed,
    };
  }
  function paramsFor(): GetContextMenuItemsParams {
    return { rowIndex: 0, colId: 'a', ranges: [], defaultItems: [] };
  }

  it('Paste item is NOT disabled when isClipboardPasteSuppressed() returns false', () => {
    const grid = makeGridStub(false);
    const items = buildDefaultMenuItems(grid, paramsFor());
    const paste = items.find((i) => i.name === 'Paste')!;
    // `disabled` can be `false` or `undefined`; either way the menu host treats
    // it as enabled.
    expect(paste.disabled === true).toBe(false);
  });

  it('Paste item IS disabled when isClipboardPasteSuppressed() returns true', () => {
    const grid = makeGridStub(true);
    const items = buildDefaultMenuItems(grid, paramsFor());
    const paste = items.find((i) => i.name === 'Paste')!;
    expect(paste.disabled).toBe(true);
  });

  it('omitting isClipboardPasteSuppressed (legacy host) treats Paste as enabled', () => {
    // Drop the optional method entirely — defaults.ts must not crash and
    // must default to "enabled".
    const grid = makeGridStub(false);
    delete (grid as Partial<DefaultMenuGrid>).isClipboardPasteSuppressed;
    const items = buildDefaultMenuItems(grid, paramsFor());
    const paste = items.find((i) => i.name === 'Paste')!;
    expect(paste.disabled === true).toBe(false);
  });
});
