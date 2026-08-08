import { describe, expect, it } from 'vitest';
import { AlertsEngine } from '../../src/alerts/alertsEngine';
import type {
  AlertEvent, AlertRule, AlertsSettings, AlertTrigger, RowChangeSet,
} from '../../src/types';

// ── harness ─────────────────────────────────────────────────────────────

interface Clock { now: () => number; advance: (ms: number) => void; }
function fakeClock(start = 0): Clock {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function makeEngine(settings?: Partial<AlertsSettings>) {
  const clock = fakeClock();
  const engine = new AlertsEngine({ settings, now: clock.now });
  const events: AlertEvent[] = [];
  engine.onAlert((e) => events.push(e));
  return { engine, events, clock };
}

// Partial<AlertsSettings>['enabledChannels'] is a full Record; the engine
// merges per key at runtime, so tests may pass a partial record via cast.
const channels = (p: Partial<Record<'toast' | 'badge' | 'openfin', boolean>>) =>
  p as AlertsSettings['enabledChannels'];

function rule(over: Partial<AlertRule>): AlertRule {
  return {
    id: 'r1', name: 'Rule One', enabled: true, priority: 10, severity: 'info',
    trigger: { kind: 'rowChange', mode: 'ROW_ADDED' },
    message: '{rule} {rowId}', channels: ['toast'],
    ...over,
  };
}

const rel = (over?: Partial<Extract<AlertTrigger, { kind: 'relativeChange' }>>): AlertTrigger => ({
  kind: 'relativeChange', colId: 'price', mode: 'ANY_CHANGE',
  threshold: 0, direction: 'both', ...over,
});

const EMPTY: RowChangeSet = { added: [], updated: [], removed: [] };

function updated(
  rowId: string,
  row: Record<string, unknown>,
  cells: Array<[colId: string, oldValue: unknown, newValue: unknown]>,
): RowChangeSet {
  return {
    ...EMPTY,
    updated: [{
      rowId, row,
      cells: cells.map(([colId, oldValue, newValue]) => ({ rowId, colId, oldValue, newValue })),
    }],
  };
}

const added = (...rows: Array<[rowId: string, row?: Record<string, unknown>]>): RowChangeSet =>
  ({ ...EMPTY, added: rows.map(([rowId, row]) => ({ rowId, row: row ?? {} })) });
const removed = (...rows: Array<[rowId: string, row?: Record<string, unknown>]>): RowChangeSet =>
  ({ ...EMPTY, removed: rows.map(([rowId, row]) => ({ rowId, row: row ?? {} })) });

// ── setRules validation ─────────────────────────────────────────────────

describe('AlertsEngine — setRules validation', () => {
  it('reports parse errors with loc, skips the rule, keeps valid rules', () => {
    const { engine, events } = makeEngine();
    const res = engine.setRules([
      rule({ id: 'bad', trigger: { kind: 'dataChange', expression: '[price] >' } }),
      rule({ id: 'good' }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ ruleId: 'bad', code: 'parse' });
    expect(res.errors[0]!.loc).not.toBeNull();
    expect(engine.getRules().map((r) => r.id)).toEqual(['good']);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(1); // the valid rule still fires
  });

  it('reports unknown-fn from expression compile', () => {
    const { engine } = makeEngine();
    const res = engine.setRules([
      rule({ id: 'fn', trigger: { kind: 'dataChange', expression: 'NOSUCH([a]) > 1' } }),
    ]);
    expect(res.errors[0]).toMatchObject({ ruleId: 'fn', code: 'unknown-fn' });
  });

  it('reports bad-shape (loc null) for unrecognized trigger kinds', () => {
    const { engine } = makeEngine();
    const res = engine.setRules([
      rule({ id: 'weird', trigger: { kind: 'nope' } as unknown as AlertTrigger }),
    ]);
    expect(res.errors[0]).toMatchObject({ ruleId: 'weird', code: 'bad-shape', loc: null });
    expect(engine.getRules()).toEqual([]);
  });

  it('getRules returns valid rules sorted by priority asc', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({ id: 'p20', priority: 20 }), rule({ id: 'p10', priority: 10 })]);
    expect(engine.getRules().map((r) => r.id)).toEqual(['p10', 'p20']);
  });

  it('rules fire in priority-asc order', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ id: 'second', priority: 20 }), rule({ id: 'first', priority: 10 })]);
    engine.applyChanges(added(['x']));
    expect(events.map((e) => e.ruleId)).toEqual(['first', 'second']);
  });
});

// ── dataChange trigger ──────────────────────────────────────────────────

describe('AlertsEngine — dataChange trigger', () => {
  it('restricted: fires per changed cell in columnIds with that colId + cell value/prev', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 100', columnIds: ['price', 'qty'] },
    })]);
    engine.applyChanges(updated('r1', { price: 150, qty: 5, note: 'x' },
      [['price', 90, 150], ['note', 'a', 'x']]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rowId: 'r1', colId: 'price', value: 150, prev: 90 });
  });

  it('restricted: two watched cells in one tick collapse to the first via (ruleId,rowId) debounce', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 100', columnIds: ['price', 'qty'] },
    })]);
    engine.applyChanges(updated('r1', { price: 150, qty: 9 },
      [['price', 90, 150], ['qty', 1, 9]]));
    expect(events).toHaveLength(1);
    expect(events[0]!.colId).toBe('price'); // first ChangeRecord wins; second is debounced
  });

  it('restricted: no fire when only unwatched columns changed', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 100', columnIds: ['price'] },
    })]);
    engine.applyChanges(updated('r1', { price: 150, note: 'b' }, [['note', 'a', 'b']]));
    expect(events).toHaveLength(0);
  });

  it('restricted: expression evaluates against the post-change row (any field)', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[qty] > 3', columnIds: ['price'] },
    })]);
    engine.applyChanges(updated('r1', { price: 2, qty: 5 }, [['price', 1, 2]]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ colId: 'price', value: 2, prev: 1 });
  });

  it('restricted: empty columnIds array restricts literally — never fires', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 0', columnIds: [] },
    })]);
    engine.applyChanges(updated('r1', { price: 150 }, [['price', 90, 150]]));
    expect(events).toHaveLength(0);
  });

  it('unrestricted: fires once per updated row AND once per added row, colId/value/prev null', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges({
      added: [{ rowId: 'n1', row: { price: 500 } }, { rowId: 'n2', row: { price: 50 } }],
      updated: [{ rowId: 'u1', row: { price: 150 }, cells: [{ rowId: 'u1', colId: 'price', oldValue: 90, newValue: 150 }] }],
      removed: [],
    });
    expect(events).toHaveLength(2); // u1 (updated) + n1 (added); n2 fails the condition
    for (const e of events) {
      expect(e.colId).toBeNull();
      expect(e.value).toBeNull();
      expect(e.prev).toBeNull();
    }
    expect(events.map((e) => e.rowId)).toEqual(['u1', 'n1']);
  });

  it('unrestricted: removed rows never evaluate', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges(removed(['gone', { price: 500 }]));
    expect(events).toHaveLength(0);
  });

  it('an EvalError during evaluation is treated as non-matching and never throws', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[a] / [b] > 1' } })]);
    expect(() =>
      engine.applyChanges(updated('x', { a: 1, b: 0 }, [['a', 0, 1]])), // div-by-zero
    ).not.toThrow();
    expect(events).toHaveLength(0);
  });
});

// ── relativeChange trigger ──────────────────────────────────────────────

describe('AlertsEngine — relativeChange trigger', () => {
  it('ANY_CHANGE fires on old !== new with cell value/prev; equal values do not fire', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel() })]);
    engine.applyChanges(updated('x', { price: 101 }, [['price', 100, 101]]));
    engine.applyChanges(updated('y', { price: 100 }, [['price', 100, 100]]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rowId: 'x', colId: 'price', value: 101, prev: 100 });
  });

  it('ABSOLUTE_CHANGE: threshold boundary equality fires; below does not', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel({ mode: 'ABSOLUTE_CHANGE', threshold: 5 }) })]);
    engine.applyChanges(updated('a', { price: 105 }, [['price', 100, 105]])); // |Δ| = 5 → fires
    engine.applyChanges(updated('b', { price: 104 }, [['price', 100, 104]])); // |Δ| = 4 → no
    expect(events.map((e) => e.rowId)).toEqual(['a']);
  });

  it('PERCENT_CHANGE: boundary fires; old = 0 never fires', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel({ mode: 'PERCENT_CHANGE', threshold: 5 }) })]);
    engine.applyChanges(updated('a', { price: 210 }, [['price', 200, 210]])); // 5% exactly → fires
    engine.applyChanges(updated('b', { price: 209 }, [['price', 200, 209]])); // 4.5% → no
    engine.applyChanges(updated('c', { price: 50 }, [['price', 0, 50]]));     // old 0 → no
    expect(events.map((e) => e.rowId)).toEqual(['a']);
  });

  it('direction filters sign: up ignores down-moves, down ignores up-moves, both takes either', () => {
    const { engine, events } = makeEngine();
    engine.setRules([
      rule({ id: 'up', priority: 1, trigger: rel({ direction: 'up' }) }),
      rule({ id: 'down', priority: 2, trigger: rel({ direction: 'down' }) }),
      rule({ id: 'both', priority: 3, trigger: rel({ direction: 'both' }) }),
    ]);
    engine.applyChanges(updated('rise', { price: 105 }, [['price', 100, 105]]));
    engine.applyChanges(updated('fall', { price: 95 }, [['price', 100, 95]]));
    expect(events.map((e) => `${e.ruleId}:${e.rowId}`))
      .toEqual(['up:rise', 'both:rise', 'down:fall', 'both:fall']);
  });

  it('non-numeric or non-finite old/new values skip the record', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel() })]);
    engine.applyChanges(updated('s', { price: 105 }, [['price', '100', 105]]));
    engine.applyChanges(updated('n', { price: 5 }, [['price', Number.NaN, 5]]));
    engine.applyChanges(updated('i', { price: 5 }, [['price', Number.POSITIVE_INFINITY, 5]]));
    engine.applyChanges(updated('u', { price: 5 }, [['price', null, 5]]));
    expect(events).toHaveLength(0);
  });

  it('only ChangeRecords whose colId matches trigger.colId are considered', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel() })]);
    engine.applyChanges(updated('x', { qty: 10, price: 100 }, [['qty', 1, 10]]));
    expect(events).toHaveLength(0);
  });
});

// ── rowChange trigger ───────────────────────────────────────────────────

describe('AlertsEngine — rowChange trigger', () => {
  it('ROW_ADDED fires per added row with null colId/value/prev', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'rowChange', mode: 'ROW_ADDED' } })]);
    engine.applyChanges(added(['a'], ['b']));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.rowId)).toEqual(['a', 'b']);
    for (const e of events) {
      expect(e.colId).toBeNull();
      expect(e.value).toBeNull();
      expect(e.prev).toBeNull();
    }
  });

  it('ROW_REMOVED fires per removed row', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'rowChange', mode: 'ROW_REMOVED' } })]);
    engine.applyChanges(removed(['a']));
    expect(events.map((e) => e.rowId)).toEqual(['a']);
  });

  it('ROW_ADDED ignores updates and removals', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'rowChange', mode: 'ROW_ADDED' } })]);
    engine.applyChanges(updated('x', { price: 1 }, [['price', 0, 1]]));
    engine.applyChanges(removed(['y']));
    expect(events).toHaveLength(0);
  });
});

// ── pipeline: debounce ──────────────────────────────────────────────────

describe('AlertsEngine — debounce', () => {
  it('same rule + same row suppressed within the window; fires again after it elapses', () => {
    const { engine, events, clock } = makeEngine(); // defaultDebounceMs 1000
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges(updated('x', { price: 150 }, [['price', 90, 150]]));  // t=0 → fires
    clock.advance(500);
    engine.applyChanges(updated('x', { price: 160 }, [['price', 150, 160]])); // t=500 → suppressed
    expect(events).toHaveLength(1);
    clock.advance(500);
    engine.applyChanges(updated('x', { price: 170 }, [['price', 160, 170]])); // t=1000 → fires
    expect(events).toHaveLength(2);
  });

  it('different rows fire independently within the window', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges(updated('x', { price: 150 }, [['price', 90, 150]]));
    engine.applyChanges(updated('y', { price: 150 }, [['price', 90, 150]]));
    expect(events.map((e) => e.rowId)).toEqual(['x', 'y']);
  });

  it('per-rule debounceMs overrides the default; 0 falls back to defaultDebounceMs', () => {
    const { engine, events, clock } = makeEngine();
    engine.setRules([
      rule({ id: 'fast', priority: 1, debounceMs: 100 }),
      rule({ id: 'zero', priority: 2, debounceMs: 0 }),
    ]);
    engine.applyChanges(added(['x'])); // both fire at t=0
    expect(events).toHaveLength(2);
    clock.advance(100);
    engine.applyChanges(added(['x'])); // fast: 100 ≥ 100 → fires; zero: 100 < 1000 → suppressed
    expect(events.map((e) => e.ruleId)).toEqual(['fast', 'zero', 'fast']);
  });
});

// ── pipeline: channels ──────────────────────────────────────────────────

describe('AlertsEngine — channel filter', () => {
  it('all-channels-disabled events are suppressed and consume no bucket tokens', () => {
    const { engine, events } = makeEngine({
      maxNotificationsPerSecond: 2,
      enabledChannels: channels({ toast: false }),
    });
    engine.setRules([
      rule({ id: 'toastOnly', priority: 1, channels: ['toast'] }),
      rule({ id: 'badgeOnly', priority: 2, channels: ['badge'] }),
    ]);
    engine.applyChanges(added(['x'], ['y']));
    // toastOnly suppressed twice WITHOUT taking tokens → badgeOnly gets both.
    expect(events.map((e) => e.ruleId)).toEqual(['badgeOnly', 'badgeOnly']);
    expect(engine.droppedCount()).toBe(0);
  });

  it('event.channels is the enabled intersection of the rule channels', () => {
    const { engine, events } = makeEngine({ enabledChannels: channels({ toast: false }) });
    engine.setRules([rule({ channels: ['toast', 'badge'] })]);
    engine.applyChanges(added(['x']));
    expect(events[0]!.channels).toEqual(['badge']);
  });
});

// ── pipeline: token bucket ──────────────────────────────────────────────

describe('AlertsEngine — token bucket', () => {
  it('bucket exhaustion drops events, increments droppedCount, skips history + unread', () => {
    const { engine, events } = makeEngine({ maxNotificationsPerSecond: 2 });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c']));
    expect(events).toHaveLength(2);
    expect(engine.droppedCount()).toBe(1);
    expect(engine.getHistory()).toHaveLength(2);
    expect(engine.unreadCount()).toBe(2);
  });

  it('a dropped hit still consumed its debounce window; the bucket refills over time', () => {
    const { engine, events, clock } = makeEngine({ maxNotificationsPerSecond: 2 });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c'])); // c dropped at t=0, debounce stamped
    clock.advance(500);
    engine.applyChanges(added(['c'])); // t=500 < 1000 → debounced (not a bucket drop)
    expect(events).toHaveLength(2);
    expect(engine.droppedCount()).toBe(1);
    clock.advance(600);
    engine.applyChanges(added(['c'])); // t=1100: debounce clear, bucket refilled → fires
    expect(events.map((e) => e.rowId)).toEqual(['a', 'b', 'c']);
  });
});

// ── history + unread ────────────────────────────────────────────────────

describe('AlertsEngine — history ring + unread', () => {
  it('getHistory is newest-first and capped at historyLimit', () => {
    const { engine } = makeEngine({ historyLimit: 3 });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c'], ['d'], ['e']));
    const history = engine.getHistory();
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.rowId)).toEqual(['e', 'd', 'c']);
    expect(history.map((e) => e.seq)).toEqual([5, 4, 3]);
  });

  it('unreadCount counts emitted events; markAllRead resets; later alerts count again', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b']));
    expect(engine.unreadCount()).toBe(2);
    engine.markAllRead();
    expect(engine.unreadCount()).toBe(0);
    engine.applyChanges(added(['c']));
    expect(engine.unreadCount()).toBe(1);
  });

  it('clearHistory empties the ring and unread counter without touching rules', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a']));
    expect(engine.getHistory()).toHaveLength(1);
    expect(engine.unreadCount()).toBe(1);
    engine.clearHistory();
    expect(engine.getHistory()).toEqual([]);
    expect(engine.unreadCount()).toBe(0);
    expect(engine.getRules()).toHaveLength(1);
  });
});

// ── events: message + seq ───────────────────────────────────────────────

describe('AlertsEngine — event assembly', () => {
  it('renders the message template end-to-end from the hit context', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      name: 'Big move',
      trigger: rel({ mode: 'PERCENT_CHANGE', threshold: 5 }),
      message: '{rule}: {column} moved {prev} -> {value} on {rowId}',
    })]);
    engine.applyChanges(updated('AAPL', { price: 210 }, [['price', 200, 210]]));
    expect(events[0]!.message).toBe('Big move: price moved 200 -> 210 on AAPL');
    expect(events[0]!.severity).toBe('info');
  });

  it('seq is a monotonic counter starting at 1', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c']));
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('onAlert unsubscribe stops delivery', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    const seen: AlertEvent[] = [];
    const off = engine.onAlert((e) => seen.push(e));
    engine.applyChanges(added(['a']));
    off();
    engine.applyChanges(added(['b']));
    expect(seen.map((e) => e.rowId)).toEqual(['a']);
  });
});

// ── gates ───────────────────────────────────────────────────────────────

describe('AlertsEngine — gates', () => {
  it('settings.enabled false → applyChanges is a no-op', () => {
    const { engine, events } = makeEngine({ enabled: false });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
    expect(engine.unreadCount()).toBe(0);
  });

  it('disabled rules never evaluate', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ enabled: false })]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
  });

  it('a throwing subscriber does not block later subscribers or the rest of applyChanges', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    const calls: string[] = [];
    const seenBySecond: string[] = [];
    engine.onAlert(() => {
      calls.push('first');
      throw new Error('boom');
    });
    engine.onAlert((e) => {
      calls.push('second');
      seenBySecond.push(e.rowId);
    });
    expect(() => engine.applyChanges(added(['a'], ['b']))).not.toThrow();
    expect(calls).toEqual(['first', 'second', 'first', 'second']);
    expect(seenBySecond).toEqual(['a', 'b']);
  });
});

// ── evaluation modes + settings (Task 8) ────────────────────────────────

describe('AlertsEngine — evaluation modes + settings', () => {
  it('getSettings returns merged defaults and a defensive copy', () => {
    const { engine } = makeEngine({ defaultDebounceMs: 50 });
    const s = engine.getSettings();
    expect(s.defaultDebounceMs).toBe(50);
    expect(s.historyLimit).toBe(200);
    s.enabled = false;               // mutating the copy…
    s.enabledChannels.toast = false; // …including the nested record…
    expect(engine.getSettings().enabled).toBe(true);              // …never leaks back
    expect(engine.getSettings().enabledChannels.toast).toBe(true);
  });

  it('setSettings shallow-merges scalars and merges enabledChannels per key', () => {
    const { engine } = makeEngine();
    engine.setSettings({ defaultDebounceMs: 5, enabledChannels: channels({ toast: false }) });
    const s = engine.getSettings();
    expect(s.defaultDebounceMs).toBe(5);
    expect(s.maxNotificationsPerSecond).toBe(10); // untouched scalar keeps its default
    expect(s.enabledChannels).toEqual({ toast: false, badge: true, openfin: true });
  });

  it('paused: applyChanges is a no-op', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'paused' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
    engine.flushThrottled(); // nothing was queued either
    expect(events).toHaveLength(0);
  });

  it('throttled: queues + coalesces; flushThrottled processes in arrival order then clears', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'throttled' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    engine.applyChanges(added(['y']));
    expect(events).toHaveLength(0);
    engine.flushThrottled();
    expect(events.map((e) => e.rowId)).toEqual(['x', 'y']); // arrival order preserved
    engine.flushThrottled(); // queue was cleared by the first flush
    expect(events).toHaveLength(2);
  });

  it('switching to paused leaves a previously queued throttled batch untouched', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'throttled' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));                 // queued
    engine.setSettings({ evaluationMode: 'paused' });
    engine.applyChanges(added(['y']));                 // no-op — NOT queued
    engine.setSettings({ evaluationMode: 'throttled' });
    engine.flushThrottled();
    expect(events.map((e) => e.rowId)).toEqual(['x']);
  });

  it('switching throttled → realtime flushes the queue immediately', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'throttled' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
    engine.setSettings({ evaluationMode: 'realtime' });
    expect(events.map((e) => e.rowId)).toEqual(['x']); // flushed by the transition itself
    engine.applyChanges(added(['y']));                 // realtime processes directly
    expect(events).toHaveLength(2);
  });

  it('changing maxNotificationsPerSecond adjusts the live bucket (clamps stored tokens)', () => {
    const { engine, events } = makeEngine(); // default cap 10, bucket full
    engine.setRules([rule({})]);
    engine.setSettings({ maxNotificationsPerSecond: 1 });
    engine.applyChanges(added(['a'], ['b'])); // only 1 token survives the clamp
    expect(events).toHaveLength(1);
    expect(engine.droppedCount()).toBe(1);
  });

  it('channel-disabled suppression does not consume the debounce window', () => {
    const { engine, events } = makeEngine({ enabledChannels: channels({ toast: false }) });
    engine.setRules([rule({ channels: ['toast'] })]);
    engine.applyChanges(added(['x'])); // suppressed at the channel gate
    expect(events).toHaveLength(0);
    engine.setSettings({ enabledChannels: channels({ toast: true }) });
    engine.applyChanges(added(['x'])); // same rule + row, zero time elapsed
    expect(events).toHaveLength(1);    // fires — the suppressed hit never stamped debounce
  });

  it('lowering historyLimit keeps the newest events', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c'], ['d'], ['e']));
    engine.setSettings({ historyLimit: 2 });
    expect(engine.getHistory().map((e) => e.rowId)).toEqual(['e', 'd']);
  });
});
