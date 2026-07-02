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

function makeFakeGrid(rows: Array<{ rowId: string; row: Record<string, unknown> }> = []) {
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const calls = {
    engines: [] as unknown[],
    flashCells: [] as Array<Record<string, unknown>>,
    refresh: 0,
  };
  return {
    registerRuleEngine(engine: unknown) { calls.engines.push(engine); },
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

  it('adapter threads grid.getThemeKind() into the eval ctx', () => {
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
