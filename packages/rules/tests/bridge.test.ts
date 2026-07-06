// Cycle 21e / Task 15 — wireIntoKernel bridge.
//
// Fake-grid fixture mirrors packages/format/tests/bridge.test.ts: a
// plain object recording registrations + calls, plus an event-emitter
// map so tests can fire rowsChanged / cellValueChanged by hand. The
// scheduler is injected manually so endTick timing is deterministic.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { wireIntoKernel, diffRows, watchedColIdUnion } from '../src/bridge';
import { RuleEngine } from '../src/ruleEngine';
import type {
  AlertEvent, AlertRule, ConditionalStyleRule, StyleRule,
} from '../src/types';

// ─── Fixtures ──────────────────────────────────────────────────────────

const FLASH_RULE: ConditionalStyleRule = {
  kind: 'style', id: 'up-tick', name: 'Price up-tick', enabled: true, priority: 10,
  condition: '[price.old] != null && [price] > [price.old]',
  scope: { kind: 'cell', columnIds: ['price'] },
  style: { base: { color: '#16a34a' } },
  flash: { enabled: true, target: 'cell', mode: 'pulse', color: '#16a34a', durationMs: 600 },
};

const NEG_RULE: ConditionalStyleRule = {
  kind: 'style', id: 'neg-pnl', name: 'Negative P&L', enabled: true, priority: 20,
  condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
  style: { base: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
};

const PRICE_ALERT: AlertRule = {
  id: 'a-price', name: 'Price move', enabled: true, priority: 1, severity: 'warning',
  trigger: { kind: 'relativeChange', colId: 'price', mode: 'ANY_CHANGE', threshold: 0, direction: 'both' },
  message: '{rule}: {rowId} {column} {prev} -> {value}',
  channels: ['toast'],
};

const ROW_ALERT: AlertRule = {
  id: 'a-row', name: 'Row watch', enabled: true, priority: 2, severity: 'info',
  // Unrestricted dataChange — evaluates the whole post-change row.
  trigger: { kind: 'dataChange', expression: '[qty] > 100' },
  message: '{rule}: {rowId}',
  channels: ['badge'],
};

// ─── Fake grid + manual scheduler ──────────────────────────────────────

/** Structural mirror of kernel's `StateModule` (core/moduleState.ts) — the
 *  same shape the calc bridge (Phase B) registers. Tier is keyed off the id
 *  in the kernel (`rules` is not in DEFAULT_GRID_LEVEL_MODULES → layout-tier). */
interface StateModuleShape {
  id: string;
  version: number;
  get(): unknown;
  set(data: unknown, version: number): void;
}

function makeFakeGrid(rows: Array<{ rowId: string; row: Record<string, unknown> }> = []) {
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const calls = {
    engines: [] as unknown[],
    flashCells: [] as Array<Record<string, unknown>>,
    refresh: 0,
    modules: [] as StateModuleShape[],
  };
  return {
    registerRuleEngine(engine: unknown) { calls.engines.push(engine); },
    registerStateModule(m: unknown) { calls.modules.push(m as StateModuleShape); return () => {}; },
    on(type: string, fn: (e: unknown) => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
      return () => {};
    },
    flashCells(p: Record<string, unknown>) { calls.flashCells.push(p); },
    refresh() { calls.refresh += 1; },
    forEachRow(fn: (rowId: string, row: Record<string, unknown>) => void) {
      for (const r of rows) fn(r.rowId, r.row);
    },
    getThemeKind: (): 'light' | 'dark' => 'dark',
    emit(type: string, e: unknown) { for (const fn of handlers.get(type) ?? []) fn(e); },
    _calls: calls,
  };
}

function manualScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void): void => { queue.push(fn); },
    flush: (): void => { while (queue.length > 0) queue.shift()!(); },
    get pending(): number { return queue.length; },
  };
}

function wire(
  grid: ReturnType<typeof makeFakeGrid>,
  extra?: { rules?: StyleRule[]; alertRules?: AlertRule[] },
) {
  const sched = manualScheduler();
  const wired = wireIntoKernel(grid, {
    rules: extra?.rules ?? [FLASH_RULE, NEG_RULE],
    alertRules: extra?.alertRules ?? [PRICE_ALERT],
    now: () => 0,
    scheduleAfterRepaint: sched.schedule,
  });
  return { ...wired, sched };
}

const updatedEvent = (
  rowId: string,
  oldRow: Record<string, unknown>,
  row: Record<string, unknown>,
  source: 'transaction' | 'transactionAsync' | 'edit' = 'transaction',
) => ({ added: [], updated: [{ rowId, row, oldRow }], removed: [], source });

afterEach(() => { vi.useRealTimers(); });

// ─── Tests ─────────────────────────────────────────────────────────────

describe('wireIntoKernel', () => {
  it('registers exactly one rule-engine adapter and returns both engines', () => {
    const grid = makeFakeGrid();
    const { rules, alerts } = wire(grid);
    expect(grid._calls.engines).toHaveLength(1);
    expect(rules).toBeInstanceOf(RuleEngine);
    expect(alerts.getSettings().enabled).toBe(true);
  });

  it('seeds rules, alertRules, and alertsSettings from opts', () => {
    const grid = makeFakeGrid();
    const sched = manualScheduler();
    const { rules, alerts } = wireIntoKernel(grid, {
      rules: [NEG_RULE],
      alertRules: [PRICE_ALERT],
      alertsSettings: { defaultDebounceMs: 250, evaluationMode: 'realtime' },
      now: () => 0,
      scheduleAfterRepaint: sched.schedule,
    });
    expect(rules.getRules().map((r) => r.id)).toEqual(['neg-pnl']);
    expect(alerts.getRules().map((r) => r.id)).toEqual(['a-price']);
    expect(alerts.getSettings().defaultDebounceMs).toBe(250);
  });

  it('adapter falls back to grid.getThemeKind() when ctx omits theme', () => {
    const grid = makeFakeGrid();
    wire(grid);
    const adapter = grid._calls.engines[0] as {
      evaluateCell(ctx: unknown): { style: { color?: string } | null };
    };
    // No theme in the kernel-side ctx — the adapter must fill 'dark'
    // from the fake grid, resolving NEG_RULE's dark slice.
    const res = adapter.evaluateCell({ row: { pnl: -5 }, rowId: 'r1', colId: 'pnl' });
    expect(res.style?.color).toBe('#ef9a9a');
  });

  it('adapter uses kernel-supplied ctx.theme without calling getThemeKind (final-review fix)', () => {
    const grid = makeFakeGrid();
    let themeKindCalls = 0;
    const original = grid.getThemeKind;
    grid.getThemeKind = () => { themeKindCalls += 1; return original(); };
    wire(grid);
    const adapter = grid._calls.engines[0] as {
      evaluateCell(ctx: unknown): { style: { color?: string } | null };
      resolveRuleRef(ruleId: string, ctx: unknown): string | null;
    };
    const wireTimeCalls = themeKindCalls;
    // Kernel resolves the theme once per frame and passes it in ctx —
    // the adapter must NOT hit the grid per cell.
    const res = adapter.evaluateCell({ row: { pnl: -5 }, rowId: 'r1', colId: 'pnl', theme: 'light' });
    expect(res.style?.color).toBe('#c62828'); // base slice — light has no override
    const ref = adapter.resolveRuleRef('neg-pnl', { row: { pnl: -5 }, rowId: 'r1', colId: 'pnl', theme: 'dark' });
    expect(ref).toBe('#ef9a9a');
    expect(themeKindCalls).toBe(wireTimeCalls);
  });

  it('seeds match counts from grid.forEachRow at wire time', () => {
    const grid = makeFakeGrid([
      { rowId: 'a', row: { pnl: -1, price: 10 } },
      { rowId: 'b', row: { pnl: 2, price: 20 } },
      { rowId: 'c', row: { pnl: -3, price: 30 } },
    ]);
    const { rules } = wire(grid);
    expect(rules.matchCount('neg-pnl')).toBe(2);
  });

  it('rowsChanged: flash directive reaches grid.flashCells with color/mode/flashDuration', () => {
    const grid = makeFakeGrid([{ rowId: 'a', row: { pnl: 1, price: 10 } }]);
    wire(grid);
    grid.emit('rowsChanged', updatedEvent('a', { pnl: 1, price: 10 }, { pnl: 1, price: 11 }));
    expect(grid._calls.flashCells).toHaveLength(1);
    expect(grid._calls.flashCells[0]).toEqual({
      rowIds: ['a'], colIds: ['price'], color: '#16a34a', mode: 'pulse', flashDuration: 600,
    });
  });

  it('rowsChanged: counts move incrementally and the alert emits end-to-end', () => {
    const grid = makeFakeGrid([{ rowId: 'a', row: { pnl: 1, price: 10 } }]);
    const { rules, alerts } = wire(grid);
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    expect(rules.matchCount('neg-pnl')).toBe(0);
    grid.emit('rowsChanged', updatedEvent('a', { pnl: 1, price: 10 }, { pnl: -4, price: 11 }));
    expect(rules.matchCount('neg-pnl')).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ruleId).toBe('a-price');
    expect(seen[0]!.message).toBe('Price move: a price 10 -> 11');
  });

  it('unrestricted dataChange alerts fire without any watched ChangeRecords', () => {
    const grid = makeFakeGrid();
    const { alerts } = wire(grid, { rules: [], alertRules: [ROW_ALERT] });
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    // qty is NOT in the watched union (no style rules; dataChange is
    // unrestricted) — the update row must still be evaluated.
    grid.emit('rowsChanged', updatedEvent('a', { qty: 50 }, { qty: 500 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.colId).toBeNull();
  });

  it('cellValueChanged builds a one-record change set (edit path)', () => {
    const grid = makeFakeGrid();
    const { alerts } = wire(grid);
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    grid.emit('cellValueChanged', {
      rowId: 'a', colId: 'price', oldValue: 10, newValue: 12,
      data: { pnl: 1, price: 12 }, source: 'edit',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prev).toBe(10);
    expect(seen[0]!.value).toBe(12);
  });

  it("rowsChanged with source 'edit' is skipped (cellValueChanged owns edits)", () => {
    const grid = makeFakeGrid();
    const { alerts } = wire(grid);
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    grid.emit('rowsChanged', updatedEvent('a', { price: 10 }, { price: 12 }, 'edit'));
    expect(seen).toHaveLength(0);
    expect(grid._calls.flashCells).toHaveLength(0);
  });

  it('endTick is scheduled once per burst and clears the diff map', () => {
    const grid = makeFakeGrid();
    const { rules, sched } = wire(grid);
    grid.emit('rowsChanged', updatedEvent('a', { price: 10 }, { price: 11 }));
    grid.emit('rowsChanged', updatedEvent('b', { price: 20 }, { price: 21 }));
    expect(sched.pending).toBe(1); // coalesced
    // Diff-aware rule matches while the tick is open…
    const during = rules.evaluateCell({ row: { price: 11 }, rowId: 'a', colId: 'price', theme: 'dark' });
    expect(during.matched).toContain('up-tick');
    // …and goes quiescent after the post-repaint endTick.
    sched.flush();
    const after = rules.evaluateCell({ row: { price: 11 }, rowId: 'a', colId: 'price', theme: 'dark' });
    expect(after.matched).not.toContain('up-tick');
  });

  it('is idempotent — re-calling returns the SAME engines object', () => {
    const grid = makeFakeGrid();
    const first = wire(grid);
    const again = wireIntoKernel(grid);
    expect(again.rules).toBe(first.rules);
    expect(again.alerts).toBe(first.alerts);
    expect(grid._calls.engines).toHaveLength(1);
  });

  it('activeDurationMs expiry repaints via grid.refresh()', () => {
    vi.useFakeTimers();
    const grid = makeFakeGrid();
    const sched = manualScheduler();
    wireIntoKernel(grid, {
      rules: [{ ...FLASH_RULE, activeDurationMs: 500 }],
      now: () => Date.now(), // fake-timer-driven clock
      scheduleAfterRepaint: sched.schedule,
    });
    grid.emit('rowsChanged', updatedEvent('a', { price: 10 }, { price: 11 }));
    sched.flush();
    expect(grid._calls.refresh).toBe(0);
    vi.advanceTimersByTime(600);
    expect(grid._calls.refresh).toBeGreaterThanOrEqual(1);
  });
});

describe('diffRows', () => {
  it('diffs only watched colIds with Object.is semantics', () => {
    const cells = diffRows('r1',
      { price: 10, qty: 5, note: 'x' },
      { price: 11, qty: 5, note: 'y' },
      new Set(['price', 'qty']));
    expect(cells).toEqual([{ rowId: 'r1', colId: 'price', oldValue: 10, newValue: 11 }]);
  });

  it('treats NaN → NaN as unchanged (Object.is)', () => {
    expect(diffRows('r1', { v: NaN }, { v: NaN }, new Set(['v']))).toEqual([]);
  });
});

describe('watchedColIdUnion', () => {
  it('unions style watched sets, relativeChange colId, and restricted dataChange columnIds', () => {
    const engine = new RuleEngine();
    engine.setRules([NEG_RULE]); // watches pnl
    const union = watchedColIdUnion(engine, [
      PRICE_ALERT, // relativeChange price
      { ...ROW_ALERT, trigger: { kind: 'dataChange', expression: '[fee] > 0', columnIds: ['fee'] } },
      { ...ROW_ALERT, id: 'a-unrestricted' }, // unrestricted — contributes nothing
      { ...PRICE_ALERT, id: 'a-off', enabled: false,
        trigger: { kind: 'relativeChange', colId: 'hidden', mode: 'ANY_CHANGE', threshold: 0, direction: 'both' } },
    ]);
    expect([...union].sort()).toEqual(['fee', 'pnl', 'price']);
  });
});

// ─── Grid Layouts — Phase C / C1 ─────────────────────────────────────────
// The rules bridge registers a layout-tier `rules` state module so the
// conditional-styling rule set rides getState/setState + persistState +
// layouts, exactly as the calc bridge (Phase B / B1) does for `calc` /
// `templates`. RECONCILIATION: Grid Layouts spec §3.2's `ConditionalRule`
// is realized by 21e's existing `StyleRule` — no second store, no second
// parser (conditions still compile via `compileCondition` on the shared
// @cgrid/expression AST). Tier is keyed off the module id in the kernel:
// `rules` is NOT in DEFAULT_GRID_LEVEL_MODULES → per-layout.
describe('wireIntoKernel — Grid Layouts `rules` state module (Phase C / C1)', () => {
  function moduleOf(grid: ReturnType<typeof makeFakeGrid>, id: string): StateModuleShape {
    const mod = grid._calls.modules.find((m) => m.id === id);
    if (!mod) throw new Error(`module '${id}' not registered`);
    return mod;
  }

  it('registers a layout-tier `rules` module that snapshots getRules()', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, { rules: [NEG_RULE], now: () => 0 });
    const mod = moduleOf(grid, 'rules');
    expect(mod.version).toBe(1);
    expect(mod.get()).toEqual([expect.objectContaining({ id: 'neg-pnl', condition: '[pnl] < 0' })]);
  });

  it('get() is undefined when no rules are set (compact snapshot)', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, { rules: [], now: () => 0 });
    expect(moduleOf(grid, 'rules').get()).toBeUndefined();
  });

  it('snapshots the FULL supplied set incl. disabled rules (serializable)', () => {
    const grid = makeFakeGrid();
    const disabled: ConditionalStyleRule = { ...NEG_RULE, id: 'off', enabled: false };
    wireIntoKernel(grid, { rules: [NEG_RULE, disabled], now: () => 0 });
    const snap = moduleOf(grid, 'rules').get() as StyleRule[];
    expect(snap.map((r) => r.id)).toEqual(['neg-pnl', 'off']);
  });

  it('set() REPLACES the rule set into a fresh engine; the restored rule evaluates truthy + reports its watched colId', () => {
    const src = makeFakeGrid();
    wireIntoKernel(src, { rules: [NEG_RULE], now: () => 0 });
    const snapshot = moduleOf(src, 'rules').get();

    const dest = makeFakeGrid();
    const { rules } = wireIntoKernel(dest, {
      rules: [{ ...NEG_RULE, id: 'stale', condition: '[qty] > 0', scope: { kind: 'cell', columnIds: ['qty'] } }],
      now: () => 0,
    });
    moduleOf(dest, 'rules').set(snapshot, 1);

    // REPLACE — the stale rule is gone, only the restored one remains.
    expect(rules.getRules().map((r) => r.id)).toEqual(['neg-pnl']);
    // eval truthiness (C1 contract): condition matches a negative pnl cell.
    expect(rules.evaluateCell({ row: { pnl: -5 }, rowId: 'r1', colId: 'pnl', theme: 'dark' }).matched)
      .toEqual(['neg-pnl']);
    expect(rules.evaluateCell({ row: { pnl: 5 }, rowId: 'r2', colId: 'pnl', theme: 'dark' }).matched)
      .toEqual([]);
    // watched-column tracking (C1 contract): the restored condition reads pnl.
    expect([...rules.watchedColIds()]).toEqual(['pnl']);
  });

  it('set(undefined) clears the rule set (layout-switch clearAbsent path)', () => {
    const grid = makeFakeGrid();
    const { rules } = wireIntoKernel(grid, { rules: [NEG_RULE], now: () => 0 });
    moduleOf(grid, 'rules').set(undefined, 1);
    expect(rules.getRules()).toEqual([]);
    expect([...rules.watchedColIds()]).toEqual([]);
  });

  it('restore skips an invalid rule with a console.warn, keeps valid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = makeFakeGrid();
    const { rules } = wireIntoKernel(grid, { rules: [], now: () => 0 });
    const bad: unknown = { ...NEG_RULE, id: 'bad', condition: '[pnl] <' }; // parse error
    moduleOf(grid, 'rules').set([bad, NEG_RULE], 1);
    // valid rule still applies; bad one skipped + reported
    expect(rules.getRules().map((r) => r.id)).toEqual(['bad', 'neg-pnl']); // full set snapshotted…
    expect(rules.evaluateCell({ row: { pnl: -1 }, rowId: 'r', colId: 'pnl', theme: 'dark' }).matched)
      .toEqual(['neg-pnl']); // …but only the valid one is indexed/evaluated
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[cgrid/rules] restore skipped rule 'bad'"));
  });

  it('set() re-seeds match counts over the current dataset (mirrors the wire-time seed)', () => {
    const rows = [
      { rowId: 'a', row: { pnl: -3 } },
      { rowId: 'b', row: { pnl: 4 } },
      { rowId: 'c', row: { pnl: -1 } },
    ];
    const grid = makeFakeGrid(rows);
    const { rules } = wireIntoKernel(grid, { rules: [], now: () => 0 });
    moduleOf(grid, 'rules').set([NEG_RULE], 1);
    // two rows have pnl < 0 → matchCount reflects the restored rule over the dataset
    expect(rules.matchCount('neg-pnl')).toBe(2);
  });
});

// ─── Grid Layouts — Phase C / C3 ─────────────────────────────────────────
// The rule-engine adapter (registered via grid.registerRuleEngine) also
// exposes getRules/setRules so the kernel's CGridApi rule methods can drive
// the engine's rule set imperatively (mirrors the calc provider's template
// ops in B3). setRules re-seeds match counts (setRules zeroes them).
describe('wireIntoKernel — rule-engine adapter CRUD surface (Phase C / C3)', () => {
  function adapterOf(grid: ReturnType<typeof makeFakeGrid>) {
    return grid._calls.engines[0] as {
      getRules?(): StyleRule[];
      setRules?(rules: StyleRule[]): void;
    };
  }

  it('adapter.getRules() reflects the engine rule set', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, { rules: [NEG_RULE], now: () => 0 });
    expect(adapterOf(grid).getRules!().map((r) => r.id)).toEqual(['neg-pnl']);
  });

  it('adapter.setRules() REPLACES the engine rule set and re-seeds match counts', () => {
    const rows = [
      { rowId: 'a', row: { pnl: -3 } },
      { rowId: 'b', row: { pnl: 4 } },
      { rowId: 'c', row: { pnl: -1 } },
    ];
    const grid = makeFakeGrid(rows);
    const { rules } = wireIntoKernel(grid, { rules: [], now: () => 0 });
    adapterOf(grid).setRules!([NEG_RULE]);
    expect(rules.getRules().map((r) => r.id)).toEqual(['neg-pnl']);
    // two pnl<0 rows → counts re-seeded over the dataset (not left at 0)
    expect(rules.matchCount('neg-pnl')).toBe(2);
  });
});
