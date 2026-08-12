/**
 * Grid Layouts — Phase A / Unit A2: module-tier filtering + grid-option
 * override capture/apply.
 *
 * A layout snapshots only the LAYOUT tier: grid-tier module slices
 * (`editSettings`, `templates`) are excluded and stay on the grid
 * baseline across switches (spec §6); runtime-touched grid options are
 * pulled OUT of the view state into `overrides.gridOptions` (spec §7) and
 * re-layered on apply. The reset-to-baseline half of §7 is the host's job
 * (see `LayoutManagerHost.applyState` doc) — proven at the VelocityGrid seam in
 * A3; here the mock host records what the manager hands it.
 *
 * Reference: spec §§4, 6, 7, 10; worklog A2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LayoutManager,
  toLayoutTierState,
  extractGridOptionOverride,
  type LayoutManagerHost,
} from '../src/core/layoutManager';
import { DEFAULT_LAYOUT_ID, DEFAULT_GRID_LEVEL_MODULES, type LayoutState } from '../src/types/layout';
import { STATE_SCHEMA_VERSION, type GridState } from '../src/core/stateSnapshot';

const V = STATE_SCHEMA_VERSION;
const env = (marker: number) => ({ version: 1, data: { marker } });

/** A full, all-tier grid snapshot — the shape `captureState` returns. */
function fullState(over: Partial<GridState> = {}): GridState {
  return { version: V, scroll: { top: 1, left: 0 }, ...over };
}

/** Mock host with a settable full "current" snapshot (all tiers + options). */
function makeHost() {
  let current: GridState = fullState();
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
    setCurrent: (s: GridState) => { current = s; },
    lastApplied: () => applied[applied.length - 1],
  };
}

describe('toLayoutTierState (pure)', () => {
  const gridIds = new Set(DEFAULT_GRID_LEVEL_MODULES);

  it('drops grid-tier module slices, keeps layout-tier ones', () => {
    const out = toLayoutTierState(
      fullState({
        modules: {
          editSettings: env(1),
          templates: env(2),
          alerts: env(5),
          'data-provider': env(6),
          columnGroups: env(3),
          calc: env(4),
        },
      }),
      gridIds,
    );
    expect(out.modules).toEqual({ columnGroups: env(3), calc: env(4) });
  });

  it('omits `modules` entirely when every slice is grid-tier', () => {
    const out = toLayoutTierState(
      fullState({
        modules: {
          editSettings: env(1),
          templates: env(2),
          alerts: env(5),
          'data-provider': env(6),
        },
      }),
      gridIds,
    );
    expect('modules' in out).toBe(false);
  });

  it('strips gridOptions (they ride in overrides) but keeps themeParams + view state', () => {
    const out = toLayoutTierState(
      fullState({
        gridOptions: { rowHeight: 40 },
        themeParams: { '--x': '#fff' },
        columnState: [{ colId: 'a' }] as never,
      }),
      gridIds,
    );
    expect('gridOptions' in out).toBe(false);
    expect(out.themeParams).toEqual({ '--x': '#fff' });
    expect(out.columnState).toEqual([{ colId: 'a' }]);
    expect(out.scroll).toEqual({ top: 1, left: 0 });
  });

  it('does not mutate its input', () => {
    const input = fullState({ modules: { editSettings: env(1), calc: env(4) }, gridOptions: { rowHeight: 40 } });
    const snapshot = structuredClone(input);
    toLayoutTierState(input, gridIds);
    expect(input).toEqual(snapshot);
  });
});

describe('extractGridOptionOverride (pure)', () => {
  it('returns a clone of the runtime option deltas', () => {
    expect(extractGridOptionOverride(fullState({ gridOptions: { rowHeight: 40 } }))).toEqual({ rowHeight: 40 });
  });
  it('returns undefined when there are no option deltas', () => {
    expect(extractGridOptionOverride(fullState())).toBeUndefined();
    expect(extractGridOptionOverride(fullState({ gridOptions: {} }))).toBeUndefined();
  });
});

describe('LayoutManager — tier-aware capture', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('saveLayout stores only layout-tier state and lifts options into overrides', () => {
    const mgr = new LayoutManager(h.host, { baseline: fullState() });
    h.setCurrent(fullState({
      modules: { editSettings: env(1), columnGroups: env(3) },
      gridOptions: { rowHeight: 40 },
      scroll: { top: 5, left: 0 },
    }));
    const saved = mgr.saveLayout('Blotter');
    expect(saved.state.modules).toEqual({ columnGroups: env(3) });   // editSettings excluded
    expect('gridOptions' in saved.state).toBe(false);                 // lifted out of view state
    expect(saved.overrides).toEqual({ gridOptions: { rowHeight: 40 } });
    expect(saved.state.scroll).toEqual({ top: 5, left: 0 });
  });

  it('updateLayout re-captures overrides, clearing a stale option delta', () => {
    const mgr = new LayoutManager(h.host, { baseline: fullState() });
    h.setCurrent(fullState({ gridOptions: { rowHeight: 40 } }));
    const saved = mgr.saveLayout('X', { activate: false });
    expect(saved.overrides).toEqual({ gridOptions: { rowHeight: 40 } });
    // Option reverted to baseline in the live view → recapture clears the override.
    h.setCurrent(fullState({}));
    const updated = mgr.updateLayout(saved.id);
    expect(updated.overrides).toBeUndefined();
  });

  it('honors a custom layoutGridLevelModules set (templates becomes layout-tier)', () => {
    const mgr = new LayoutManager(h.host, {
      baseline: fullState(),
      layoutGridLevelModules: ['editSettings'], // templates no longer grid-tier
    });
    h.setCurrent(fullState({ modules: { editSettings: env(1), templates: env(2), calc: env(4) } }));
    const saved = mgr.saveLayout('X');
    expect(saved.state.modules).toEqual({ templates: env(2), calc: env(4) });
  });

  it('seeds a synthesized Default from the layout-tier of the baseline', () => {
    const mgr = new LayoutManager(h.host, {
      baseline: fullState({ modules: { editSettings: env(1), columnGroups: env(3) }, gridOptions: { rowHeight: 22 } }),
    });
    const def = mgr.getLayouts().find((l) => l.id === DEFAULT_LAYOUT_ID)!;
    expect(def.state.modules).toEqual({ columnGroups: env(3) }); // grid-tier editSettings excluded
    expect('gridOptions' in def.state).toBe(false);
    expect(def.overrides).toBeUndefined();
  });
});

describe('LayoutManager — tier-aware apply + option override round-trip', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('re-injects the option override into the applied snapshot; omits it when there is none', () => {
    const mgr = new LayoutManager(h.host, { baseline: fullState() });
    h.setCurrent(fullState({ gridOptions: { rowHeight: 40 }, scroll: { top: 9, left: 0 } }));
    const withOpts = mgr.saveLayout('WithOpts', { activate: false });
    h.setCurrent(fullState({ scroll: { top: 3, left: 0 } }));
    const plain = mgr.saveLayout('Plain', { activate: false });

    mgr.loadLayout(withOpts.id);
    expect(h.lastApplied().gridOptions).toEqual({ rowHeight: 40 });
    expect(h.lastApplied().scroll).toEqual({ top: 9, left: 0 });

    mgr.loadLayout(plain.id);
    // No override → nothing layered; the host resets options to baseline.
    expect('gridOptions' in h.lastApplied()).toBe(false);
  });

  it('round-trips the option override across Default ↔ layout switches', () => {
    const mgr = new LayoutManager(h.host, { baseline: fullState() });
    h.setCurrent(fullState({ gridOptions: { rowHeight: 40 } }));
    const a = mgr.saveLayout('A'); // active
    // Switch to Default (no override) then back to A.
    mgr.loadLayout(DEFAULT_LAYOUT_ID);
    expect('gridOptions' in h.lastApplied()).toBe(false);
    mgr.loadLayout(a.id);
    expect(h.lastApplied().gridOptions).toEqual({ rowHeight: 40 });
  });

  it('never leaks grid-tier module slices into an applied snapshot', () => {
    const mgr = new LayoutManager(h.host, { baseline: fullState() });
    h.setCurrent(fullState({ modules: { editSettings: env(1), columnGroups: env(3) } }));
    const saved = mgr.saveLayout('X', { activate: false });
    mgr.loadLayout(saved.id);
    expect(h.lastApplied().modules).toEqual({ columnGroups: env(3) });
  });

  it('resetLayout restores the layout-tier baseline and clears overrides', () => {
    const mgr = new LayoutManager(h.host, {
      baseline: fullState({ modules: { editSettings: env(1), columnGroups: env(3) }, scroll: { top: 2, left: 0 } }),
    });
    h.setCurrent(fullState({ gridOptions: { rowHeight: 99 }, scroll: { top: 50, left: 0 } }));
    mgr.updateLayout(); // Default now dirty with an option override
    expect(mgr.getActiveLayout().overrides).toEqual({ gridOptions: { rowHeight: 99 } });
    const reset = mgr.resetLayout();
    expect(reset.overrides).toBeUndefined();
    expect(reset.state.modules).toEqual({ columnGroups: env(3) });
    expect(reset.state.scroll).toEqual({ top: 2, left: 0 });
    expect('gridOptions' in h.lastApplied()).toBe(false);
    expect(h.lastApplied().scroll).toEqual({ top: 2, left: 0 });
  });
});
