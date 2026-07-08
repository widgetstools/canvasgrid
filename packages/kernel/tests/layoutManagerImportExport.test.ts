/**
 * Grid Layouts — Phase A / Unit A4: import / export.
 *
 * Pure LayoutManager tests for the JSON bundle round-trip: exportLayout /
 * exportLayouts / importLayout / importLayouts (collision → new id unless
 * overwrite; replace vs merge), bundle versioning + migration, and
 * per-layout `state` forward-migration. No live grid (that seam is A3).
 *
 * Reference: spec §5 (bundle), §8 (API), §12 (collisions + migration);
 * worklog A4.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LayoutManager,
  migrateLayoutsBundle,
  type LayoutManagerHost,
} from '../src/core/layoutManager';
import {
  DEFAULT_LAYOUT_ID,
  LAYOUTS_BUNDLE_VERSION,
  type GridLayout,
  type GridLayoutsBundle,
} from '../src/types/layout';
import { STATE_SCHEMA_VERSION, type GridState } from '../src/core/stateSnapshot';

const V = STATE_SCHEMA_VERSION;
function fullState(over: Partial<GridState> = {}): GridState {
  return { version: V, scroll: { top: 1, left: 0 }, ...over };
}

function makeHost() {
  let current: GridState = fullState();
  const applied: GridState[] = [];
  let idCounter = 0;
  let clock = 1000;
  const host: LayoutManagerHost = {
    captureState: () => structuredClone(current),
    applyState: (s) => { applied.push(structuredClone(s)); },
    newId: () => `NEW${++idCounter}`,
    now: () => ++clock,
  };
  return { host, applied, setCurrent: (s: GridState) => { current = s; } };
}

function mgrWith(host: LayoutManagerHost, layouts?: GridLayout[]) {
  return new LayoutManager(host, { baseline: fullState({ scroll: { top: 0, left: 0 } }), layouts });
}

describe('migrateLayoutsBundle', () => {
  it('stamps the current version on a same-version bundle', () => {
    const b: GridLayoutsBundle = { version: LAYOUTS_BUNDLE_VERSION, activeLayoutId: 'default', layouts: [], grid: {} };
    expect(migrateLayoutsBundle(b).version).toBe(LAYOUTS_BUNDLE_VERSION);
  });
  it('throws on a bundle newer than this build', () => {
    const b: GridLayoutsBundle = { version: LAYOUTS_BUNDLE_VERSION + 5, activeLayoutId: 'default', layouts: [], grid: {} };
    expect(() => migrateLayoutsBundle(b)).toThrow(/newer than this build/);
  });
});

describe('LayoutManager — export', () => {
  it('exportLayouts returns version + active id + all layouts + grid config', () => {
    const h = makeHost();
    const mgr = mgrWith(h.host);
    mgr.setGridConfig({ gridOptions: { rowHeight: 30 } });
    h.setCurrent(fullState({ scroll: { top: 9, left: 0 } }));
    const saved = mgr.saveLayout('Blotter');

    const bundle = mgr.exportLayouts();
    expect(bundle.version).toBe(LAYOUTS_BUNDLE_VERSION);
    expect(bundle.activeLayoutId).toBe(saved.id);
    expect(bundle.layouts.map((l) => l.id)).toEqual([DEFAULT_LAYOUT_ID, saved.id]);
    expect(bundle.grid.gridOptions).toEqual({ rowHeight: 30 });
    // Defensive copy: mutating the export doesn't touch the registry.
    bundle.layouts[0].name = 'HACKED';
    expect(mgr.getLayouts()[0].name).toBe('Default');
  });

  it('exportLayout returns one layout; no template refs → empty templates; unknown id throws', () => {
    const h = makeHost();
    const mgr = mgrWith(h.host);
    const saved = mgr.saveLayout('X', { activate: false });
    const out = mgr.exportLayout(saved.id);
    expect(out.id).toBe(saved.id);
    expect(out.templates).toEqual([]); // no columnOverrides module → no refs
    expect(() => mgr.exportLayout('ghost')).toThrow(/unknown layout/);
  });

  it('exportLayout bundles ONLY the referenced template defs from the library (B4)', () => {
    const h = makeHost();
    const mgr = mgrWith(h.host);
    const money = { id: 'money', name: 'Money', overrides: { format: '#,##0' }, createdAt: 1, updatedAt: 1 };
    const compact = { id: 'compact', name: 'Compact', overrides: { width: 90 }, createdAt: 1, updatedAt: 1 };
    mgr.setGridConfig({ templates: [money, compact] });
    // a layout whose columnOverrides reference only `money`
    h.setCurrent(fullState({
      modules: { columnOverrides: { version: 1, data: [
        { colId: 'px', templateIds: ['money'] },
        { colId: 'qty', templateIds: ['money', 'ghost'] }, // dangling ref skipped
      ] } },
    }));
    const saved = mgr.saveLayout('Blotter', { activate: false });
    const out = mgr.exportLayout(saved.id);
    expect(out.templates!.map((t) => t.id)).toEqual(['money']); // compact NOT referenced; ghost skipped
    expect(out.templates![0].overrides).toEqual({ format: '#,##0' });
  });
});

describe('LayoutManager — importLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('adds a fresh layout as-is when there is no id collision', () => {
    const mgr = mgrWith(h.host);
    const imported = mgr.importLayout({ id: 'ext1', name: 'External', state: fullState() });
    expect(imported.id).toBe('ext1');
    expect(mgr.getLayouts().map((l) => l.id)).toContain('ext1');
  });

  it('re-materializes bundled template defs into the library (add-if-absent) and strips them (B4)', () => {
    const mgr = mgrWith(h.host);
    const localMoney = { id: 'money', name: 'LOCAL Money', overrides: { format: 'local' }, createdAt: 1, updatedAt: 1 };
    mgr.setGridConfig({ templates: [localMoney] });

    const imported = mgr.importLayout({
      id: 'ext1', name: 'External', state: fullState(),
      templates: [
        { id: 'money', name: 'IMPORTED Money', overrides: { format: 'imported' }, createdAt: 9, updatedAt: 9 }, // collides → NOT clobbered
        { id: 'compact', name: 'Compact', overrides: { width: 90 }, createdAt: 9, updatedAt: 9 },               // new → added
      ],
    });
    const lib = mgr.getGridConfig().templates!;
    expect(lib.map((t) => t.id).sort()).toEqual(['compact', 'money']);
    expect(lib.find((t) => t.id === 'money')!.name).toBe('LOCAL Money'); // local def authoritative
    expect(imported.templates).toBeUndefined(); // stripped — runtime layout carries no defs
    expect(mgr.getLayouts().find((l) => l.id === 'ext1')!.templates).toBeUndefined();
  });

  it('mints a new id on collision, but replaces in place with { overwrite }', () => {
    const mgr = mgrWith(h.host);
    const a = mgr.saveLayout('A', { activate: false });

    const collide = mgr.importLayout({ id: a.id, name: 'Imported', state: fullState({ scroll: { top: 7, left: 0 } }) });
    expect(collide.id).not.toBe(a.id);                 // new id
    expect(mgr.getLayouts()).toHaveLength(3);           // default + A + import

    const over = mgr.importLayout(
      { id: a.id, name: 'Overwritten', state: fullState({ scroll: { top: 8, left: 0 } }) },
      { overwrite: true },
    );
    expect(over.id).toBe(a.id);                         // same id, replaced in place
    expect(mgr.getLayouts()).toHaveLength(3);           // no new entry
    expect(mgr.getLayouts().find((l) => l.id === a.id)!.name).toBe('Overwritten');
  });

  it('uniquifies a colliding display name to preserve the invariant', () => {
    const mgr = mgrWith(h.host);
    mgr.saveLayout('Trades', { activate: false });
    const imported = mgr.importLayout({ id: 'ext', name: 'Trades', state: fullState() });
    expect(imported.name).toBe('Trades (2)');
  });

  it('forward-migrates the imported layout state', () => {
    const mgr = mgrWith(h.host);
    const imported = mgr.importLayout({ id: 'ext', name: 'Old', state: { version: 1 } as GridState });
    expect(imported.state.version).toBe(STATE_SCHEMA_VERSION);
  });
});

describe('LayoutManager — importLayouts (merge / replace)', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  function bundle(over: Partial<GridLayoutsBundle> = {}): GridLayoutsBundle {
    return {
      version: LAYOUTS_BUNDLE_VERSION,
      activeLayoutId: 'b1',
      layouts: [
        { id: 'b1', name: 'Alpha', state: fullState({ scroll: { top: 1, left: 0 } }) },
        { id: 'b2', name: 'Beta', state: fullState({ scroll: { top: 2, left: 0 } }) },
      ],
      grid: { gridOptions: { rowHeight: 44 } },
      ...over,
    };
  }

  it('merge folds the bundle in, keeps existing layouts, and merges grid config', () => {
    const mgr = mgrWith(h.host);
    const local = mgr.saveLayout('Local', { activate: false });
    mgr.importLayouts(bundle(), { mode: 'merge' });
    const ids = mgr.getLayouts().map((l) => l.id);
    expect(ids).toContain(DEFAULT_LAYOUT_ID);
    expect(ids).toContain(local.id);
    expect(ids).toContain('b1');
    expect(ids).toContain('b2');
    expect(mgr.getGridConfig().gridOptions).toEqual({ rowHeight: 44 });
    // Merge does not switch the active layout.
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
  });

  it('merge of a bundle CONTAINING a Default entry skips it — local Default unchanged, no fork', () => {
    const mgr = mgrWith(h.host);
    const before = mgr.getLayouts();
    const beforeDefault = before.find((l) => l.id === DEFAULT_LAYOUT_ID)!;
    mgr.importLayouts(
      bundle({ layouts: [{ id: DEFAULT_LAYOUT_ID, name: 'Imported Default', state: fullState({ scroll: { top: 5, left: 0 } }) }] }),
      { mode: 'merge' },
    );
    const after = mgr.getLayouts();
    expect(after).toHaveLength(before.length); // no extra "Default (2)" minted
    const afterDefault = after.find((l) => l.id === DEFAULT_LAYOUT_ID)!;
    expect(afterDefault).toEqual(beforeDefault); // untouched (deep-equal)
    expect(after.some((l) => l.name.startsWith('Default ('))).toBe(false);
  });

  it('merge with { overwrite: true } replaces the local Default in place — id unchanged, no extra layout', () => {
    const mgr = mgrWith(h.host);
    const before = mgr.getLayouts();
    mgr.importLayouts(
      bundle({ layouts: [{ id: DEFAULT_LAYOUT_ID, name: 'Imported Default', state: fullState({ scroll: { top: 5, left: 0 } }) }] }),
      { mode: 'merge', overwrite: true },
    );
    const after = mgr.getLayouts();
    expect(after).toHaveLength(before.length); // replaced in place, not appended
    const def = after.find((l) => l.id === DEFAULT_LAYOUT_ID)!;
    expect(def.id).toBe(DEFAULT_LAYOUT_ID);
    expect(def.name).toBe('Imported Default');
    expect(def.state.scroll).toEqual({ top: 5, left: 0 });
  });

  it('replace swaps the whole set + active id + grid config, keeping a Default', () => {
    const mgr = mgrWith(h.host);
    mgr.saveLayout('Local', { activate: false }); // discarded by replace
    mgr.importLayouts(bundle(), { mode: 'replace' });
    const ids = mgr.getLayouts().map((l) => l.id);
    expect(ids).toEqual([DEFAULT_LAYOUT_ID, 'b1', 'b2']); // synthesized Default + bundle
    expect(mgr.getActiveLayoutId()).toBe('b1');
    expect(mgr.getGridConfig().gridOptions).toEqual({ rowHeight: 44 });
  });

  it('replace keeps a Default supplied by the bundle instead of synthesizing one', () => {
    const mgr = mgrWith(h.host);
    mgr.importLayouts(
      bundle({
        activeLayoutId: DEFAULT_LAYOUT_ID,
        layouts: [{ id: DEFAULT_LAYOUT_ID, name: 'Home', state: fullState() }],
      }),
      { mode: 'replace' },
    );
    const def = mgr.getLayouts().find((l) => l.id === DEFAULT_LAYOUT_ID)!;
    expect(def.name).toBe('Home');
    expect(mgr.getLayouts()).toHaveLength(1);
  });

  it('replace falls back to Default when the bundle active id is unknown', () => {
    const mgr = mgrWith(h.host);
    mgr.importLayouts(bundle({ activeLayoutId: 'ghost' }), { mode: 'replace' });
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
  });

  it('propagates a newer-bundle error (never silently restores an unknown shape)', () => {
    const mgr = mgrWith(h.host);
    expect(() => mgr.importLayouts(bundle({ version: LAYOUTS_BUNDLE_VERSION + 2 }))).toThrow(/newer than this build/);
  });
});

describe('LayoutManager — full JSON round-trip', () => {
  it('export → JSON → import(replace) reproduces layouts + active + grid config', () => {
    const h = makeHost();
    const mgr = mgrWith(h.host);
    mgr.setGridConfig({ gridOptions: { headerHeight: 36 } });
    h.setCurrent(fullState({ scroll: { top: 5, left: 0 }, sortModel: [{ colId: 'x', sort: 'asc' }] }));
    const a = mgr.saveLayout('A'); // active

    const json = JSON.parse(JSON.stringify(mgr.exportLayouts())) as GridLayoutsBundle;

    const fresh = new LayoutManager(makeHost().host, { baseline: fullState() });
    fresh.importLayouts(json, { mode: 'replace' });

    expect(fresh.getLayouts().map((l) => l.id)).toEqual([DEFAULT_LAYOUT_ID, a.id]);
    expect(fresh.getActiveLayoutId()).toBe(a.id);
    expect(fresh.getActiveLayout().state.sortModel).toEqual([{ colId: 'x', sort: 'asc' }]);
    expect(fresh.getGridConfig().gridOptions).toEqual({ headerHeight: 36 });
  });
});
