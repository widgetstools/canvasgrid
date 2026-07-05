/**
 * Grid Layouts — Phase A / Unit A3: CGrid API wiring, integration.
 *
 * Mounts a real CGrid (fake worker + canvas, per the repo integration
 * harness) and drives the layout API end-to-end: save → mutate view →
 * load → view restored; grid-tier module slices left untouched while
 * layout-tier ones restore; grid-option override round-trips across
 * switches; the `layoutChanged` event fires; construction seeds + Default
 * invariants; getGridConfig/setGridConfig baseline.
 *
 * Reference: worklog A3; spec §§7–10.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { DEFAULT_LAYOUT_ID, type GridLayout } from '../src/types/layout';
import type { StateModule } from '../src/core/moduleState';

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

type Row = { id: string; name: string; qty: number };

async function mountGrid(extra: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'name' }, { field: 'qty' }],
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
    ...extra,
  });
  // Drive the fake worker 'ready' handshake so async construction completes.
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return { grid, container };
}

/** A mutable-backed state module for asserting tier restore behavior. */
function makeCell(id: string, initial: string): StateModule & { value: string } {
  const cell = {
    id,
    version: 1,
    value: initial,
    get() { return this.value; },
    set(data: unknown) { this.value = data as string; },
  };
  return cell;
}

describe('A3 — layout API on a live grid', () => {
  it('exposes a Default layout and saves a new one, firing layoutChanged', async () => {
    const { grid } = await mountGrid();
    const events: any[] = [];
    grid.on('layoutChanged', (e) => events.push(e));

    expect(grid.getLayouts().map((l) => l.id)).toEqual([DEFAULT_LAYOUT_ID]);
    expect(grid.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);

    const saved = grid.saveLayout('Blotter');
    expect(saved.name).toBe('Blotter');
    expect(grid.getActiveLayoutId()).toBe(saved.id);
    expect(grid.getLayouts()).toHaveLength(2);
    expect(events).toEqual([{ type: 'layoutChanged', activeLayoutId: saved.id, source: 'save' }]);

    grid.destroy();
  });

  it('round-trips view state (sort model) and leaves grid-tier modules untouched', async () => {
    const { grid } = await mountGrid();
    const registry = (grid as any).moduleStateRegistry;
    const editing = makeCell('editSettings', 'E1'); // grid-tier (default)
    const notes = makeCell('notes', 'N1');           // layout-tier
    registry.register(editing);
    registry.register(notes);

    // Mutate the view + both modules, then snapshot into layout 'A'.
    grid.setSortModel([{ colId: 'name', sort: 'asc' }]);
    editing.value = 'E-A'; notes.value = 'N-A';
    const a = grid.saveLayout('A');

    // Move the live view away from 'A'.
    grid.setSortModel([]);
    editing.value = 'E-LATER'; notes.value = 'N-LATER';

    grid.loadLayout(a.id);
    // Layout-tier: restored to what 'A' captured.
    expect(grid.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
    expect(notes.value).toBe('N-A');
    // Grid-tier: NOT in the layout snapshot → left exactly as it was.
    expect(editing.value).toBe('E-LATER');

    grid.destroy();
  });

  it('round-trips a grid-option override across Default <-> layout switches', async () => {
    const { grid } = await mountGrid();
    const baseRowHeight = grid.getGridOption('rowHeight'); // undefined at construction

    grid.setGridOption('rowHeight', 40);
    const tall = grid.saveLayout('Tall'); // active; overrides.gridOptions = { rowHeight: 40 }
    expect(tall.overrides).toEqual({ gridOptions: { rowHeight: 40 } });

    // Switch to Default → option resets to the construction baseline.
    grid.loadLayout(DEFAULT_LAYOUT_ID);
    expect(grid.getGridOption('rowHeight')).toBe(baseRowHeight);
    expect(grid.getState().gridOptions).toBeUndefined();

    // Switch back to Tall → override re-applied.
    grid.loadLayout(tall.id);
    expect(grid.getGridOption('rowHeight')).toBe(40);
    expect(grid.getState().gridOptions).toEqual({ rowHeight: 40 });

    grid.destroy();
  });

  it('honors construction seeds (layouts + activeLayoutId)', async () => {
    const seed: GridLayout = { id: 'seed1', name: 'Seeded', state: { version: 4 } };
    const { grid } = await mountGrid({ layouts: [seed], activeLayoutId: 'seed1' });
    const ids = grid.getLayouts().map((l) => l.id);
    expect(ids).toContain(DEFAULT_LAYOUT_ID);
    expect(ids).toContain('seed1');
    expect(grid.getActiveLayoutId()).toBe('seed1');
    grid.destroy();
  });

  it('deletes the active layout with a fallback to Default, and refuses to delete Default', async () => {
    const { grid } = await mountGrid();
    const events: any[] = [];
    grid.on('layoutChanged', (e) => events.push(e));
    const a = grid.saveLayout('A'); // active
    grid.deleteLayout(a.id);
    expect(grid.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
    expect(events.at(-1)).toEqual({ type: 'layoutChanged', activeLayoutId: DEFAULT_LAYOUT_ID, source: 'delete' });
    expect(() => grid.deleteLayout(DEFAULT_LAYOUT_ID)).toThrow();
    grid.destroy();
  });

  it('setGridConfig sets the option baseline that layout resets return to', async () => {
    const { grid } = await mountGrid();
    grid.setGridConfig({ gridOptions: { rowHeight: 30 } });
    expect(grid.getGridOption('rowHeight')).toBe(30);
    expect(grid.getGridConfig().gridOptions).toEqual({ rowHeight: 30 });

    // A layout override on top, then reset → returns to the NEW baseline (30).
    grid.setGridOption('rowHeight', 48);
    grid.updateLayout(); // Default captures the override
    grid.resetLayout();  // active reset → baseline
    expect(grid.getGridOption('rowHeight')).toBe(30);

    grid.destroy();
  });
});

describe('A4 — import / export on a live grid', () => {
  it('exports a bundle and re-imports it into a fresh grid (view + option override restored)', async () => {
    // Grid 1: build a layout with a sort model + a grid-option override.
    const { grid: g1 } = await mountGrid();
    g1.setSortModel([{ colId: 'name', sort: 'asc' }]);
    g1.setGridOption('rowHeight', 40);
    const saved = g1.saveLayout('Blotter'); // active, overrides rowHeight
    const bundle = JSON.parse(JSON.stringify(g1.exportLayouts()));
    expect(bundle.activeLayoutId).toBe(saved.id);
    g1.destroy();

    // Grid 2: fresh, import the bundle (replace) → state re-materializes live.
    const { grid: g2 } = await mountGrid();
    const events: any[] = [];
    g2.on('layoutChanged', (e) => events.push(e));
    g2.importLayouts(bundle, { mode: 'replace' });

    expect(g2.getLayouts().map((l) => l.name)).toContain('Blotter');
    expect(g2.getActiveLayoutId()).toBe(saved.id);
    expect(g2.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
    expect(g2.getGridOption('rowHeight')).toBe(40); // override applied live
    expect(events.at(-1)).toEqual({ type: 'layoutChanged', activeLayoutId: saved.id, source: 'import' });
    g2.destroy();
  });

  it('importLayout with { activate } applies the layout view to the live grid', async () => {
    const { grid } = await mountGrid();
    const layout: GridLayout = {
      id: 'ext',
      name: 'Sorted',
      state: { version: 4, sortModel: [{ colId: 'qty', sort: 'desc' }] } as any,
    };
    grid.importLayout(layout, { activate: true });
    expect(grid.getActiveLayoutId()).toBe('ext');
    expect(grid.getState().sortModel).toEqual([{ colId: 'qty', sort: 'desc' }]);
    grid.destroy();
  });
});

/** Shared in-memory persistence adapter for round-trip tests. */
function memAdapter() {
  let store: any = null;
  return {
    load: () => store,
    save(_id: string, state: any) { store = JSON.parse(JSON.stringify(state)); },
    clear() { store = null; },
    raw: () => store,
  };
}

/** Force the rAF-debounced stateUpdated + the controller's debounced write. */
function forcePersist(grid: any) {
  grid.stateUpdatedBus.flush();
  grid.statePersistence.flush();
}

describe('A5 — persistence round-trip', () => {
  it('folds the layouts bundle into the saved blob and restores it into a fresh grid', async () => {
    const adapter = memAdapter();
    const { grid: g1 } = await mountGrid({ gridId: 'p1', persistState: { adapter, debounceMs: 0 } });
    await new Promise((r) => setTimeout(r, 25)); // let restore() (dynamic import) arm autosave

    g1.setGridOption('rowHeight', 40);
    const saved = g1.saveLayout('Blotter'); // active; overrides rowHeight
    forcePersist(g1);
    expect(adapter.raw().layouts).toBeTruthy();          // bundle folded in
    expect(adapter.raw().layouts.layouts.map((l: any) => l.name)).toContain('Blotter');
    g1.destroy();

    // Fresh grid, same gridId + adapter → layouts survive the reload.
    const { grid: g2 } = await mountGrid({ gridId: 'p1', persistState: { adapter, debounceMs: 0 } });
    await new Promise((r) => setTimeout(r, 25));
    expect(g2.getLayouts().map((l) => l.name)).toContain('Blotter');
    expect(g2.getActiveLayoutId()).toBe(saved.id);
    expect(g2.getGridOption('rowHeight')).toBe(40);      // active override re-applied
    g2.destroy();
  });

  it('persisted layouts take precedence over options.layouts', async () => {
    const adapter = memAdapter();
    const { grid: g1 } = await mountGrid({ gridId: 'p2', persistState: { adapter, debounceMs: 0 } });
    await new Promise((r) => setTimeout(r, 25));
    const saved = g1.saveLayout('Persisted');
    forcePersist(g1);
    g1.destroy();

    const optionSeed: GridLayout = { id: 'opt1', name: 'FromOptions', state: { version: 4 } };
    const { grid: g2 } = await mountGrid({
      gridId: 'p2',
      persistState: { adapter, debounceMs: 0 },
      layouts: [optionSeed],
      activeLayoutId: 'opt1',
    });
    await new Promise((r) => setTimeout(r, 25));
    const names = g2.getLayouts().map((l) => l.name);
    expect(names).toContain('Persisted');     // persisted bundle wins
    expect(names).not.toContain('FromOptions'); // options discarded
    expect(g2.getActiveLayoutId()).toBe(saved.id);
    g2.destroy();
  });

  it('a plain view-state blob without a layouts field still restores (older/no-layout grids)', async () => {
    const adapter = memAdapter();
    // Simulate a pre-A5 blob: view state only, no `layouts` field.
    adapter.save('p3', { version: 4, sortModel: [{ colId: 'name', sort: 'asc' }] });
    const { grid } = await mountGrid({ gridId: 'p3', persistState: { adapter, debounceMs: 0 } });
    await new Promise((r) => setTimeout(r, 25));
    expect(grid.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
    expect(grid.getLayouts().map((l) => l.id)).toEqual([DEFAULT_LAYOUT_ID]); // synth Default
    grid.destroy();
  });
});

// Regressions for the Phase-A closeout review's fix wave. These exercise view
// fields that do NOT ride `columnState` (filter), where a partial restore
// would leak the outgoing layout's state, plus the option-baseline / merge /
// version-guard fixes.
describe('A6 fix wave — regressions', () => {
  const FILTER = { name: { filterType: 'text', type: 'contains', filter: 'AAA' } };

  it('clears view state the target layout omits when switching (filter round-trip)', async () => {
    const { grid } = await mountGrid();
    grid.setFilterModel(FILTER as any);
    const filtered = grid.saveLayout('Filtered'); // active
    expect(grid.getState().filterModel).toBeDefined();

    // Switch to Default (no filter) → the filter is CLEARED, not left behind.
    grid.loadLayout(DEFAULT_LAYOUT_ID);
    expect(grid.getState().filterModel).toBeUndefined();

    // Switch back → the filter is restored.
    grid.loadLayout(filtered.id);
    expect((grid.getState().filterModel as any).name.filter).toBe('AAA');
    grid.destroy();
  });

  it('resets a runtime option to the initialState baseline, not the kernel default', async () => {
    const { grid } = await mountGrid({ initialState: { version: 4, gridOptions: { rowHeight: 60 } } });
    expect(grid.getGridOption('rowHeight')).toBe(60);
    grid.setGridOption('rowHeight', 40);
    grid.saveLayout('Tall'); // active; overrides rowHeight
    grid.loadLayout(DEFAULT_LAYOUT_ID);
    // Back to the app baseline (60), NOT the kernel default (undefined).
    expect(grid.getGridOption('rowHeight')).toBe(60);
    grid.destroy();
  });

  it('merge-importing does not disturb the current on-screen view', async () => {
    const { grid } = await mountGrid();
    grid.setSortModel([{ colId: 'name', sort: 'asc' }]); // unsaved current view
    const bundle: any = {
      version: 1,
      activeLayoutId: 'default',
      layouts: [{ id: 'x', name: 'X', state: { version: 4, sortModel: [{ colId: 'qty', sort: 'desc' }] } }],
      grid: {},
    };
    grid.importLayouts(bundle, { mode: 'merge' });
    expect(grid.getLayouts().map((l) => l.name)).toContain('X');
    // The current unsaved view survives a merge.
    expect(grid.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
    grid.destroy();
  });

  it('refuses to load a layout whose state is newer than the build, leaving the active layout unchanged', async () => {
    const { grid } = await mountGrid();
    const imported = grid.importLayout({ id: 'future', name: 'Future', state: { version: 999 } as any });
    expect(() => grid.loadLayout(imported.id)).toThrow();
    expect(grid.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID); // no half-switch
    grid.destroy();
  });
});
