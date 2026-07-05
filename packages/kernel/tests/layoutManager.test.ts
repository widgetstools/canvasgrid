/**
 * Grid Layouts — Phase A / Unit A1: LayoutManager unit tests.
 *
 * The manager owns the layouts registry, the active id, the construction
 * baseline (for `resetLayout`), and the Default-layout invariants. It is
 * PURE: all grid coupling is injected through a small host
 * (`captureState`/`applyState`/`newId`/`now`), so these tests exercise it
 * in isolation with mock accessors — no real grid, no persistence (A5),
 * no tier filtering or option-override capture (A2), no events (A3).
 *
 * Reference: docs/superpowers/specs/2026-07-05-grid-layouts-design.md
 * §§8–9, §12; worklog docs/superpowers/plans/2026-07-05-grid-layouts-worklog.md (A1).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LayoutManager, type LayoutManagerHost } from '../src/core/layoutManager';
import { DEFAULT_LAYOUT_ID, type LayoutState } from '../src/types/layout';
import { STATE_SCHEMA_VERSION } from '../src/core/stateSnapshot';

/** A distinguishable LayoutState — the `scroll.top` marker lets a test
 *  tell one captured/applied snapshot from another. */
function mkState(marker: number): LayoutState {
  return { version: STATE_SCHEMA_VERSION, scroll: { top: marker, left: 0 } };
}

/** Mock host: a settable "current view" that `captureState` snapshots,
 *  a record of every state handed to `applyState`, and deterministic
 *  id/clock generators. */
function makeHost() {
  let current: LayoutState = mkState(0);
  const applied: LayoutState[] = [];
  let idCounter = 0;
  let clock = 1000;
  const host: LayoutManagerHost = {
    captureState: () => structuredClone(current),
    applyState: (s) => { applied.push(structuredClone(s)); },
    newId: () => `L${++idCounter}`,
    now: () => ++clock,
  };
  return {
    host,
    applied,
    /** Move the mock live view to a new marker so the next capture differs. */
    setCurrent: (marker: number) => { current = mkState(marker); },
    lastApplied: () => applied[applied.length - 1],
  };
}

describe('LayoutManager — construction & Default invariants', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('synthesizes a Default layout from the baseline on a fresh grid', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(7) });
    const layouts = mgr.getLayouts();
    expect(layouts).toHaveLength(1);
    expect(layouts[0].id).toBe(DEFAULT_LAYOUT_ID);
    expect(layouts[0].name).toBe('Default');
    expect(layouts[0].state).toEqual(mkState(7));
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
  });

  it('adopts provided layouts and keeps a synthesized Default when absent', () => {
    const mgr = new LayoutManager(h.host, {
      baseline: mkState(0),
      layouts: [{ id: 'L1', name: 'Trades', state: mkState(1) }],
    });
    const ids = mgr.getLayouts().map((l) => l.id);
    expect(ids).toContain(DEFAULT_LAYOUT_ID);
    expect(ids).toContain('L1');
    // Provided activeLayoutId absent → Default is active.
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
  });

  it('honors a provided activeLayoutId, falling back to Default when it is unknown', () => {
    const withActive = new LayoutManager(h.host, {
      baseline: mkState(0),
      layouts: [{ id: 'L1', name: 'Trades', state: mkState(1) }],
      activeLayoutId: 'L1',
    });
    expect(withActive.getActiveLayoutId()).toBe('L1');

    const badActive = new LayoutManager(h.host, {
      baseline: mkState(0),
      layouts: [{ id: 'L1', name: 'Trades', state: mkState(1) }],
      activeLayoutId: 'nope',
    });
    expect(badActive.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
  });

  it('keeps a Default supplied explicitly instead of overwriting it', () => {
    const mgr = new LayoutManager(h.host, {
      baseline: mkState(0),
      layouts: [{ id: DEFAULT_LAYOUT_ID, name: 'Home', state: mkState(9) }],
    });
    const def = mgr.getLayouts().find((l) => l.id === DEFAULT_LAYOUT_ID)!;
    expect(def.name).toBe('Home');
    expect(def.state).toEqual(mkState(9));
    expect(mgr.getLayouts()).toHaveLength(1);
  });
});

describe('LayoutManager — getLayouts / getActiveLayout value semantics', () => {
  it('returns defensive clones — mutating the result never corrupts the registry', () => {
    const h = makeHost();
    const mgr = new LayoutManager(h.host, { baseline: mkState(3) });
    const first = mgr.getLayouts();
    first[0].name = 'HACKED';
    first[0].state.scroll!.top = 999;
    const second = mgr.getLayouts();
    expect(second[0].name).toBe('Default');
    expect(second[0].state.scroll!.top).toBe(3);
  });

  it('getActiveLayout returns the active layout as a clone', () => {
    const h = makeHost();
    const mgr = new LayoutManager(h.host, { baseline: mkState(3) });
    const active = mgr.getActiveLayout();
    expect(active.id).toBe(DEFAULT_LAYOUT_ID);
    active.name = 'HACKED';
    expect(mgr.getActiveLayout().name).toBe('Default');
  });
});

describe('LayoutManager — saveLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('captures the current view into a new, activated layout with a minted id + timestamp', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    h.setCurrent(42);
    const saved = mgr.saveLayout('Blotter');
    expect(saved.id).toBe('L1');
    expect(saved.name).toBe('Blotter');
    expect(saved.state).toEqual(mkState(42));
    expect(saved.updatedAt).toBeGreaterThan(0);
    expect(mgr.getActiveLayoutId()).toBe('L1');
    expect(mgr.getLayouts()).toHaveLength(2);
  });

  it('does not activate when { activate: false }', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    const saved = mgr.saveLayout('Blotter', { activate: false });
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
    expect(mgr.getLayouts().map((l) => l.id)).toContain(saved.id);
  });

  it('trims the name and rejects empty / whitespace-only names', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    expect(mgr.saveLayout('  Spaced  ').name).toBe('Spaced');
    expect(() => mgr.saveLayout('')).toThrow();
    expect(() => mgr.saveLayout('   ')).toThrow();
  });

  it('rejects a duplicate name (case-insensitive, trimmed)', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    mgr.saveLayout('Trades');
    expect(() => mgr.saveLayout('Trades')).toThrow();
    expect(() => mgr.saveLayout('  trades ')).toThrow();
    // Collides with the reserved Default name too.
    expect(() => mgr.saveLayout('default')).toThrow();
  });

  it('decouples the stored snapshot from the live view (deep clone on capture)', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    h.setCurrent(5);
    const saved = mgr.saveLayout('X');
    // Mutating a later capture / the returned object must not touch the stored one.
    saved.state.scroll!.top = 111;
    expect(mgr.getLayouts().find((l) => l.id === saved.id)!.state.scroll!.top).toBe(5);
  });
});

describe('LayoutManager — updateLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('recaptures the current view into the active layout by default', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(1) });
    h.setCurrent(88);
    const updated = mgr.updateLayout();
    expect(updated.id).toBe(DEFAULT_LAYOUT_ID);
    expect(updated.state).toEqual(mkState(88));
    expect(mgr.getActiveLayout().state).toEqual(mkState(88));
  });

  it('updates a specific layout by id', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(1) });
    const saved = mgr.saveLayout('X', { activate: false });
    h.setCurrent(77);
    mgr.updateLayout(saved.id);
    expect(mgr.getLayouts().find((l) => l.id === saved.id)!.state).toEqual(mkState(77));
    // Active (Default) untouched.
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
  });

  it('throws on an unknown id', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    expect(() => mgr.updateLayout('ghost')).toThrow();
  });
});

describe('LayoutManager — loadLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('activates a layout and applies its state to the host', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    h.setCurrent(30);
    const saved = mgr.saveLayout('X', { activate: false });
    h.setCurrent(0);
    const loaded = mgr.loadLayout(saved.id);
    expect(mgr.getActiveLayoutId()).toBe(saved.id);
    expect(loaded.state).toEqual(mkState(30));
    expect(h.lastApplied()).toEqual(mkState(30));
  });

  it('throws on an unknown id and leaves the active layout unchanged', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    expect(() => mgr.loadLayout('ghost')).toThrow();
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
    expect(h.applied).toHaveLength(0);
  });
});

describe('LayoutManager — deleteLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('refuses to delete the Default layout', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    expect(() => mgr.deleteLayout(DEFAULT_LAYOUT_ID)).toThrow();
    expect(mgr.getLayouts().some((l) => l.id === DEFAULT_LAYOUT_ID)).toBe(true);
  });

  it('throws on an unknown id', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    expect(() => mgr.deleteLayout('ghost')).toThrow();
  });

  it('removes a non-active layout without touching the active one', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    const saved = mgr.saveLayout('X', { activate: false });
    mgr.deleteLayout(saved.id);
    expect(mgr.getLayouts().some((l) => l.id === saved.id)).toBe(false);
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
    expect(h.applied).toHaveLength(0);
  });

  it('falls back to Default (and applies its state) when the active layout is deleted', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(11) });
    h.setCurrent(50);
    const saved = mgr.saveLayout('X'); // activates X
    expect(mgr.getActiveLayoutId()).toBe(saved.id);
    mgr.deleteLayout(saved.id);
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
    expect(mgr.getLayouts().some((l) => l.id === saved.id)).toBe(false);
    // Default's baseline view was re-applied on fallback.
    expect(h.lastApplied()).toEqual(mkState(11));
  });
});

describe('LayoutManager — renameLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('renames a layout, trimming and enforcing uniqueness', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    const a = mgr.saveLayout('Alpha', { activate: false });
    mgr.saveLayout('Beta', { activate: false });
    const renamed = mgr.renameLayout(a.id, '  Gamma ');
    expect(renamed.name).toBe('Gamma');
    expect(() => mgr.renameLayout(a.id, 'Beta')).toThrow();
    expect(() => mgr.renameLayout(a.id, '')).toThrow();
  });

  it('allows renaming to the same name (no self-collision)', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    const a = mgr.saveLayout('Alpha', { activate: false });
    expect(() => mgr.renameLayout(a.id, 'Alpha')).not.toThrow();
  });

  it('allows editing the Default display name (id stays fixed)', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    const renamed = mgr.renameLayout(DEFAULT_LAYOUT_ID, 'Home');
    expect(renamed.id).toBe(DEFAULT_LAYOUT_ID);
    expect(renamed.name).toBe('Home');
  });

  it('throws on an unknown id', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    expect(() => mgr.renameLayout('ghost', 'X')).toThrow();
  });
});

describe('LayoutManager — duplicateLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('clones a source layout under a fresh id + unique name, without activating by default', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    h.setCurrent(21);
    const src = mgr.saveLayout('Src', { activate: false });
    const dup = mgr.duplicateLayout(src.id, 'Copy');
    expect(dup.id).not.toBe(src.id);
    expect(dup.name).toBe('Copy');
    expect(dup.state).toEqual(mkState(21));
    // Default is still active; duplicating a non-active layout doesn't switch view.
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
    expect(h.applied).toHaveLength(0);
  });

  it('activates and applies when { activate: true }', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    h.setCurrent(21);
    const src = mgr.saveLayout('Src', { activate: false });
    const dup = mgr.duplicateLayout(src.id, 'Copy', { activate: true });
    expect(mgr.getActiveLayoutId()).toBe(dup.id);
    expect(h.lastApplied()).toEqual(mkState(21));
  });

  it('produces an independent copy (mutating the source later does not touch the dup)', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    h.setCurrent(21);
    const src = mgr.saveLayout('Src', { activate: false });
    const dup = mgr.duplicateLayout(src.id, 'Copy');
    h.setCurrent(99);
    mgr.updateLayout(src.id);
    expect(mgr.getLayouts().find((l) => l.id === dup.id)!.state).toEqual(mkState(21));
  });

  it('throws on an unknown source id or a duplicate name', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    const src = mgr.saveLayout('Src', { activate: false });
    expect(() => mgr.duplicateLayout('ghost', 'Copy')).toThrow();
    expect(() => mgr.duplicateLayout(src.id, 'Src')).toThrow();
  });
});

describe('LayoutManager — resetLayout', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('resets the active layout to the construction baseline and re-applies it', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(11) });
    h.setCurrent(60);
    mgr.updateLayout(); // Default now holds marker 60
    expect(mgr.getActiveLayout().state).toEqual(mkState(60));
    const reset = mgr.resetLayout();
    expect(reset.state).toEqual(mkState(11));
    expect(mgr.getActiveLayout().state).toEqual(mkState(11));
    expect(h.lastApplied()).toEqual(mkState(11));
  });

  it('resets a specific, non-active layout to baseline without applying it', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(11) });
    h.setCurrent(60);
    const saved = mgr.saveLayout('X', { activate: false }); // holds marker 60
    mgr.resetLayout(saved.id);
    expect(mgr.getLayouts().find((l) => l.id === saved.id)!.state).toEqual(mkState(11));
    expect(mgr.getActiveLayoutId()).toBe(DEFAULT_LAYOUT_ID);
    expect(h.applied).toHaveLength(0);
  });

  it('throws on an unknown id', () => {
    const mgr = new LayoutManager(h.host, { baseline: mkState(0) });
    expect(() => mgr.resetLayout('ghost')).toThrow();
  });
});
