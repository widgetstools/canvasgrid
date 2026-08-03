import { describe, expect, it } from 'vitest';
import { RuleEngine } from '../src/ruleEngine';
import type {
  ConditionalStyleRule,
  IndicatorRule,
  RuleEvalContext,
  StyleRule,
} from '../src/types';
import { makeClock } from './helpers/fakeClock';

// ─── Fixtures ───────────────────────────────────────────────────────────

function styleRule(
  over: Partial<ConditionalStyleRule> & Pick<ConditionalStyleRule, 'id' | 'priority'>,
): ConditionalStyleRule {
  return {
    kind: 'style',
    name: over.id,
    enabled: true,
    condition: '[pnl] < 0',
    scope: { kind: 'cell', columnIds: ['pnl'] },
    style: { base: { color: '#c62828' } },
    ...over,
  };
}

const rowRule: ConditionalStyleRule = {
  kind: 'style',
  id: 'row-hl',
  name: 'row-hl',
  enabled: true,
  priority: 5,
  condition: '[price] > 50',
  scope: { kind: 'row' },
  style: { base: { backgroundColor: '#e8f5e9' } },
};

function ctx(over?: Partial<RuleEvalContext>): RuleEvalContext {
  return { row: { pnl: -5, price: 100 }, rowId: 'row-1', colId: 'pnl', theme: 'light', ...over };
}

function engineWith(...rules: StyleRule[]): RuleEngine {
  const engine = new RuleEngine();
  engine.setRules(rules);
  return engine;
}

// ─── evaluateCell fold ──────────────────────────────────────────────────

describe('RuleEngine — evaluateCell fold', () => {
  it('later (higher) priority wins per-property; untouched properties survive', () => {
    const engine = engineWith(
      styleRule({ id: 'B', priority: 20, style: { base: { color: '#1565c0' } } }),
      styleRule({
        id: 'A',
        priority: 10,
        style: { base: { color: '#c62828', backgroundColor: '#ffebee' } },
      }),
    );
    const res = engine.evaluateCell(ctx());
    expect(res.matched).toEqual(['A', 'B']); // priority asc, not declaration order
    expect(res.style).toEqual({ color: '#1565c0', backgroundColor: '#ffebee' });
  });

  it('equal priority ties break by setRules array order (stable)', () => {
    const engine = engineWith(
      styleRule({ id: 'first', priority: 10, style: { base: { color: '#111111' } } }),
      styleRule({ id: 'second', priority: 10, style: { base: { color: '#222222' } } }),
    );
    const res = engine.evaluateCell(ctx());
    expect(res.matched).toEqual(['first', 'second']);
    expect(res.style!.color).toBe('#222222');
  });

  it('theme resolution: base ⊕ dark slice, per-property', () => {
    const engine = engineWith(
      styleRule({
        id: 'T',
        priority: 1,
        style: { base: { color: '#111111', fontWeight: 'bold' }, dark: { color: '#eeeeee' } },
      }),
    );
    expect(engine.evaluateCell(ctx({ theme: 'dark' })).style).toEqual({
      color: '#eeeeee',
      fontWeight: 'bold',
    });
    expect(engine.evaluateCell(ctx({ theme: 'light' })).style).toEqual({
      color: '#111111',
      fontWeight: 'bold',
    });
  });

  it('per-side border spec folds like any property: wholesale replace, no per-side merge', () => {
    const engine = engineWith(
      styleRule({
        id: 'lo',
        priority: 10,
        style: { base: { border: { top: { width: 2, color: '#c62828', style: 'dashed' } } } },
      }),
      styleRule({
        id: 'hi',
        priority: 20,
        style: { base: { border: { bottom: { width: 1, color: '#2dd4bf', style: 'solid' } } } },
      }),
    );
    const res = engine.evaluateCell(ctx());
    // The winning rule's spec replaces the whole `border` object (same
    // wholesale semantics as kernel override patches) — the low-priority
    // rule's `top` edge does NOT survive into the fold.
    expect(res.style!.border).toEqual({ bottom: { width: 1, color: '#2dd4bf', style: 'solid' } });
  });

  it('theme slice border replaces the base border wholesale', () => {
    const engine = engineWith(
      styleRule({
        id: 'TB',
        priority: 1,
        style: {
          base: { border: { all: { width: 1, color: '#111111', style: 'solid' } } },
          dark: { border: { left: { width: 3, color: '#eeeeee', style: 'double' } } },
        },
      }),
    );
    expect(engine.evaluateCell(ctx({ theme: 'dark' })).style!.border).toEqual({
      left: { width: 3, color: '#eeeeee', style: 'double' },
    });
    expect(engine.evaluateCell(ctx({ theme: 'light' })).style!.border).toEqual({
      all: { width: 1, color: '#111111', style: 'solid' },
    });
  });
});

// ─── Scope targeting ────────────────────────────────────────────────────

describe('RuleEngine — scope targeting', () => {
  it('cell-scope rules do not affect other columns', () => {
    const engine = engineWith(styleRule({ id: 'A', priority: 1 })); // columnIds: ['pnl']
    expect(engine.evaluateCell(ctx({ colId: 'price' })).matched).toEqual([]);
  });

  it('row-scope rules apply to every colId including null (row-scope eval)', () => {
    const engine = engineWith(rowRule);
    for (const colId of ['pnl', 'price', null]) {
      const res = engine.evaluateCell(ctx({ colId }));
      expect(res.matched).toEqual(['row-hl']);
      expect(res.style).toEqual({ backgroundColor: '#e8f5e9' });
    }
  });
});

// ─── setRules behavior ──────────────────────────────────────────────────

describe('RuleEngine — setRules', () => {
  it('disabled rules are validated but never match', () => {
    const engine = new RuleEngine();
    const res = engine.setRules([{ ...styleRule({ id: 'off', priority: 1 }), enabled: false }]);
    expect(res).toEqual({ ok: true, errors: [] });
    expect(engine.evaluateCell(ctx()).matched).toEqual([]);
  });

  it('invalid rules are skipped + reported; valid rules still apply', () => {
    const engine = new RuleEngine();
    const res = engine.setRules([
      styleRule({ id: 'broken', priority: 1, condition: '[pnl] <' }),
      styleRule({ id: 'good', priority: 2 }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ ruleId: 'broken', code: 'parse' });
    expect(engine.evaluateCell(ctx()).matched).toEqual(['good']);
  });

  it('getRules returns the full supplied set (serializable snapshot, fresh array)', () => {
    const rules: StyleRule[] = [
      styleRule({ id: 'A', priority: 1 }),
      { ...styleRule({ id: 'off', priority: 2 }), enabled: false },
    ];
    const engine = engineWith(...rules);
    expect(engine.getRules()).toEqual(rules);
    expect(engine.getRules()).not.toBe(rules);
  });
});

// ─── EMPTY_RESULT identity ──────────────────────────────────────────────

describe('RuleEngine — EMPTY_RESULT', () => {
  it('no-match calls return the shared frozen EMPTY_RESULT (zero allocation)', () => {
    const engine = engineWith(styleRule({ id: 'A', priority: 1 }));
    const r1 = engine.evaluateCell(ctx({ row: { pnl: 5 } })); // condition false
    const r2 = engine.evaluateCell(ctx({ row: { pnl: 7 }, rowId: 'row-2' }));
    const r3 = engine.evaluateCell(ctx({ colId: 'untargeted' })); // no candidates
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(Object.isFrozen(r1)).toBe(true);
    expect(r1.matched).toEqual([]);
  });
});

// ─── Per-rule valueFormatter ────────────────────────────────────────────

describe('RuleEngine — valueFormatter', () => {
  it("winning rule's valueFormatter compiles to a live FormatProgram", () => {
    const engine = engineWith(styleRule({ id: 'fmt', priority: 1, valueFormatter: '0.00%' }));
    const res = engine.evaluateCell(ctx());
    expect(res.formatProgram).not.toBeNull();
    expect(
      res.formatProgram!.formatText({ value: 0.1234, row: ctx().row, colId: 'pnl' }),
    ).toBe('12.34%');
  });
});

// ─── resolveRuleRef ─────────────────────────────────────────────────────

describe('RuleEngine — resolveRuleRef', () => {
  const themed = styleRule({
    id: 'ref',
    priority: 1,
    style: { base: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
  });

  it('matching + enabled → theme-resolved style.color', () => {
    const engine = engineWith(themed);
    expect(engine.resolveRuleRef('ref', ctx())).toBe('#c62828');
    expect(engine.resolveRuleRef('ref', ctx({ theme: 'dark' }))).toBe('#ef9a9a');
  });

  it('non-matching ctx → null', () => {
    expect(engineWith(themed).resolveRuleRef('ref', ctx({ row: { pnl: 5 } }))).toBeNull();
  });

  it('unknown ruleId → null', () => {
    expect(engineWith(themed).resolveRuleRef('nope', ctx())).toBeNull();
  });

  it('disabled rule → null', () => {
    expect(engineWith({ ...themed, enabled: false }).resolveRuleRef('ref', ctx())).toBeNull();
  });

  it('matching rule without a color channel → null', () => {
    const engine = engineWith(
      styleRule({ id: 'nc', priority: 1, style: { base: { fontWeight: 'bold' } } }),
    );
    expect(engine.resolveRuleRef('nc', ctx())).toBeNull();
  });

  it('indicator rules carry no style → null', () => {
    const ind: IndicatorRule = {
      kind: 'indicator',
      id: 'ind',
      name: 'ind',
      enabled: true,
      priority: 1,
      condition: '[pnl] < 0',
      scope: { kind: 'row' },
      indicator: { iconName: 'star', color: '#fbc02d', target: 'row-start', position: 'before' },
    };
    expect(engineWith(ind).resolveRuleRef('ind', ctx())).toBeNull();
  });
});

// ─── Task 4: match counting ─────────────────────────────────────────────

describe('RuleEngine — match counting (Task 4)', () => {
  const countRules: StyleRule[] = [
    styleRule({ id: 'neg', priority: 10 }), // [pnl] < 0, cell scope ['pnl']
    {
      kind: 'style',
      id: 'big',
      name: 'big',
      enabled: true,
      priority: 20,
      condition: '[price] > 100',
      scope: { kind: 'row' },
      style: { base: { backgroundColor: '#fff3e0' } },
    },
  ];
  const seedRows = [
    { rowId: 'a', row: { pnl: -1, price: 50 } },
    { rowId: 'b', row: { pnl: 3, price: 150 } },
    { rowId: 'c', row: { pnl: -9, price: 200 } },
  ];

  it('recount equals replaying the same rows as an applyChanges add stream (parity)', () => {
    const full = new RuleEngine();
    full.setRules(countRules);
    full.recount(seedRows);

    const incremental = new RuleEngine();
    incremental.setRules(countRules);
    for (const r of seedRows) {
      incremental.applyChanges({ added: [r], updated: [], removed: [] });
    }
    for (const ruleId of ['neg', 'big']) {
      expect(incremental.matchCount(ruleId)).toBe(full.matchCount(ruleId));
    }
    expect(full.matchCount('neg')).toBe(2); // rows a + c, one cell each
    expect(full.matchCount('big')).toBe(2); // rows b + c, row scope
  });

  it('removal decrements; update flips', () => {
    const engine = new RuleEngine();
    engine.setRules(countRules);
    engine.recount(seedRows);
    const rowC = seedRows[2]!;
    engine.applyChanges({ added: [], updated: [], removed: [{ rowId: 'c', row: rowC.row }] });
    expect(engine.matchCount('neg')).toBe(1);
    expect(engine.matchCount('big')).toBe(1);
    engine.applyChanges({
      added: [],
      removed: [],
      updated: [
        {
          rowId: 'a',
          row: { pnl: 5, price: 50 },
          cells: [{ rowId: 'a', colId: 'pnl', oldValue: -1, newValue: 5 }],
        },
      ],
    });
    expect(engine.matchCount('neg')).toBe(0);
  });
});

// ─── Task 4: tick-scoped diff map ───────────────────────────────────────

describe('RuleEngine — tick-scoped diff map (Task 4)', () => {
  const tickRule: ConditionalStyleRule = {
    kind: 'style',
    id: 'up',
    name: 'up',
    enabled: true,
    priority: 10,
    condition: '[price.old] != null && [price] > [price.old]',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { color: '#2e7d32' } },
  };

  it('[price.old] matches during the tick, stops after endTick; counts follow', () => {
    const engine = new RuleEngine();
    engine.setRules([tickRule]);
    const row = { price: 105 };
    engine.recount([{ rowId: 'a', row }]);
    expect(engine.matchCount('up')).toBe(0); // quiescent — diff-aware can't match

    engine.applyChanges({
      added: [],
      removed: [],
      updated: [
        { rowId: 'a', row, cells: [{ rowId: 'a', colId: 'price', oldValue: 100, newValue: 105 }] },
      ],
    });
    const during = engine.evaluateCell({ row, rowId: 'a', colId: 'price', theme: 'light' });
    expect(during.matched).toEqual(['up']);
    expect(engine.matchCount('up')).toBe(1);

    engine.endTick();
    const after = engine.evaluateCell({ row, rowId: 'a', colId: 'price', theme: 'light' });
    expect(after.matched).toEqual([]); // .old resolves null after the clear
    expect(engine.matchCount('up')).toBe(0); // eager counts force-recounted
  });

  it('evalErrorCount increments when a condition throws EvalError', () => {
    const engine = new RuleEngine();
    engine.setRules([
      {
        kind: 'style',
        id: 'div',
        name: 'div',
        enabled: true,
        priority: 1,
        condition: '[a] / [b] > 0',
        scope: { kind: 'row' },
        style: { base: { color: '#000000' } },
      },
    ]);
    expect(engine.evalErrorCount('div')).toBe(0);
    const res = engine.evaluateCell({ row: { a: 1, b: 0 }, rowId: 'x', colId: null, theme: 'light' });
    expect(res.matched).toEqual([]); // div-by-zero → non-matching
    expect(engine.evalErrorCount('div')).toBe(1);
  });
});

// ─── Task 4 review fix: row-scope memo invalidation on in-place mutation ──

describe('RuleEngine — row-scope memo invalidation (Task 4 review fix)', () => {
  const priceRule: ConditionalStyleRule = {
    kind: 'style',
    id: 'hot',
    name: 'hot',
    enabled: true,
    priority: 10,
    condition: '[price] > 100',
    scope: { kind: 'row' },
    style: { base: { backgroundColor: '#fff3e0' } },
  };

  it('evaluateCell + matchCount reflect an in-place mutation reported via applyChanges (reviewer repro)', () => {
    const engine = new RuleEngine();
    engine.setRules([priceRule]);

    // The kernel mutates row objects in place — same identity across ticks.
    const row: Record<string, unknown> = { price: 50 };
    engine.recount([{ rowId: 'a', row }]);
    expect(engine.matchCount('hot')).toBe(0);

    // Warm the row-scope memo pre-mutation (paint pass reads a non-match).
    const before = engine.evaluateCell({ row, rowId: 'a', colId: null, theme: 'light' });
    expect(before.matched).toEqual([]);

    // Mutate the SAME object in place, then report the update.
    row.price = 150;
    engine.applyChanges({
      added: [],
      removed: [],
      updated: [
        { rowId: 'a', row, cells: [{ rowId: 'a', colId: 'price', oldValue: 50, newValue: 150 }] },
      ],
    });

    const after = engine.evaluateCell({ row, rowId: 'a', colId: null, theme: 'light' });
    expect(after.matched).toEqual(['hot']);
    expect(engine.matchCount('hot')).toBe(1);

    // Parity: a fresh engine's recount over the same (now-mutated) rows
    // must agree with the incrementally-updated engine's matchCount.
    const fresh = new RuleEngine();
    fresh.setRules([priceRule]);
    fresh.recount([{ rowId: 'a', row }]);
    expect(engine.matchCount('hot')).toBe(fresh.matchCount('hot'));
  });

  it('removed rows drop their row-scope memo entry (no leak / stale reuse)', () => {
    const engine = new RuleEngine();
    engine.setRules([priceRule]);
    const row: Record<string, unknown> = { price: 150 };
    engine.recount([{ rowId: 'a', row }]);
    engine.evaluateCell({ row, rowId: 'a', colId: null, theme: 'light' }); // warm memo
    expect(engine.matchCount('hot')).toBe(1);

    engine.applyChanges({ added: [], updated: [], removed: [{ rowId: 'a', row }] });
    expect(engine.matchCount('hot')).toBe(0);

    // Same rowId reused for a fresh, non-matching row object — must not
    // resurrect the removed row's stale memoized `true`.
    const row2: Record<string, unknown> = { price: 10 };
    engine.applyChanges({ added: [{ rowId: 'a', row: row2 }], updated: [], removed: [] });
    const res = engine.evaluateCell({ row: row2, rowId: 'a', colId: null, theme: 'light' });
    expect(res.matched).toEqual([]);
    expect(engine.matchCount('hot')).toBe(0);
  });

  it('endTick: diff-aware decay is correct even when the base row object was memoized by a row-scope rule pre-tick', () => {
    const diffRule: ConditionalStyleRule = {
      kind: 'style',
      id: 'rose',
      name: 'rose',
      enabled: true,
      priority: 10,
      condition: '[price.old] != null && [price] > [price.old]',
      scope: { kind: 'row' },
      style: { base: { color: '#2e7d32' } },
    };
    const staticRowRule: ConditionalStyleRule = {
      kind: 'style',
      id: 'hi',
      name: 'hi',
      enabled: true,
      priority: 5,
      condition: '[price] > 100',
      scope: { kind: 'row' },
      style: { base: { backgroundColor: '#fff3e0' } },
    };
    const engine = new RuleEngine();
    engine.setRules([diffRule, staticRowRule]);

    const row: Record<string, unknown> = { price: 105 };
    engine.recount([{ rowId: 'a', row }]);

    // Warm the row-scope memo pre-tick via the non-diff-aware rule
    // (`staticRowRule`) on the base row object — this is the memo entry
    // the finding warned could go stale across a tick boundary.
    const preTick = engine.evaluateCell({ row, rowId: 'a', colId: null, theme: 'light' });
    expect(preTick.matched).toEqual(['hi']);

    engine.applyChanges({
      added: [],
      removed: [],
      updated: [
        { rowId: 'a', row, cells: [{ rowId: 'a', colId: 'price', oldValue: 100, newValue: 105 }] },
      ],
    });
    const during = engine.evaluateCell({ row, rowId: 'a', colId: null, theme: 'light' });
    expect(during.matched).toEqual(['hi', 'rose']);
    expect(engine.matchCount('rose')).toBe(1);

    engine.endTick();
    const after = engine.evaluateCell({ row, rowId: 'a', colId: null, theme: 'light' });
    // diff-aware rule decays after endTick; the memoized non-diff-aware
    // rule's match must remain correct (it was never diff-dependent).
    expect(after.matched).toEqual(['hi']);
    expect(engine.matchCount('rose')).toBe(0);

    const fresh = new RuleEngine();
    fresh.setRules([diffRule, staticRowRule]);
    fresh.recount([{ rowId: 'a', row }]);
    expect(engine.matchCount('hi')).toBe(fresh.matchCount('hi'));
    expect(engine.matchCount('rose')).toBe(fresh.matchCount('rose'));
  });
});

// ─── Task 5: activeDurationMs + flash directives ────────────────────────

describe('RuleEngine — activeDurationMs (Task 5)', () => {
  const blinkRule: ConditionalStyleRule = {
    kind: 'style',
    id: 'blink',
    name: 'blink',
    enabled: true,
    priority: 1,
    condition: '[price.old] != null',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { backgroundColor: '#fff9c4' } },
    activeDurationMs: 1000,
  };
  const oneTick = (row: Record<string, unknown>) => ({
    added: [],
    removed: [],
    updated: [
      { rowId: 'a', row, cells: [{ rowId: 'a', colId: 'price', oldValue: 100, newValue: 105 }] },
    ],
  });

  it('match survives endTick for the window, then expires with onExpire cells', () => {
    const clock = makeClock();
    const engine = new RuleEngine({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    engine.setRules([blinkRule]);
    const expiries: Array<Array<{ rowId: string; colId: string | null }>> = [];
    engine.onExpire((cells) => expiries.push(cells));

    const row = { price: 105 };
    engine.applyChanges(oneTick(row));
    const cellCtx: RuleEvalContext = { row, rowId: 'a', colId: 'price', theme: 'light' };
    expect(engine.evaluateCell(cellCtx).matched).toEqual(['blink']);

    engine.endTick(); // diff cleared — the active window keeps it matched
    expect(engine.evaluateCell(cellCtx).matched).toEqual(['blink']);

    clock.advance(1000);
    expect(expiries).toEqual([[{ rowId: 'a', colId: 'price' }]]);
    expect(engine.evaluateCell(cellCtx).matched).toEqual([]);
  });

  it('onExpire unsubscribe stops notifications', () => {
    const clock = makeClock();
    const engine = new RuleEngine({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    engine.setRules([blinkRule]);
    const seen: unknown[] = [];
    const un = engine.onExpire((cells) => seen.push(cells));
    un();
    engine.applyChanges(oneTick({ price: 105 }));
    clock.advance(5000);
    expect(seen).toEqual([]);
  });
});

describe('RuleEngine — flash directives (Task 5)', () => {
  it('fire only on false→true transitions, with the rule flash config', () => {
    const engine = new RuleEngine();
    engine.setRules([
      {
        kind: 'style',
        id: 'hot',
        name: 'hot',
        enabled: true,
        priority: 1,
        condition: '[price] > 100',
        scope: { kind: 'cell', columnIds: ['price'] },
        style: { base: { color: '#e65100' } },
        flash: { enabled: true, target: 'cell', mode: 'pulse', color: '#ff6f00', durationMs: 600 },
      },
    ]);
    const tick = (price: number, oldValue: number) =>
      engine.applyChanges({
        added: [],
        removed: [],
        updated: [
          {
            rowId: 'a',
            row: { price },
            cells: [{ rowId: 'a', colId: 'price', oldValue, newValue: price }],
          },
        ],
      });

    const flash = { rowId: 'a', colIds: ['price'], color: '#ff6f00', mode: 'pulse', durationMs: 600 };
    expect(tick(150, 50)).toEqual([flash]); // false→true
    expect(tick(160, 150)).toEqual([]); // stays true — no re-flash
    expect(tick(50, 160)).toEqual([]); // true→false — no flash
    expect(tick(200, 50)).toEqual([flash]); // re-activation flashes again
  });

  it('row-target flash directive carries colIds: null', () => {
    const engine = new RuleEngine();
    engine.setRules([
      {
        kind: 'style',
        id: 'row-hot',
        name: 'row-hot',
        enabled: true,
        priority: 1,
        condition: '[price] > 100',
        scope: { kind: 'row' },
        style: { base: { color: '#e65100' } },
        flash: { enabled: true, target: 'row', mode: 'glow', color: '#ffa000', durationMs: 900 },
      },
    ]);
    const directives = engine.applyChanges({
      added: [{ rowId: 'a', row: { price: 150 } }],
      updated: [],
      removed: [],
    });
    expect(directives).toEqual([
      { rowId: 'a', colIds: null, color: '#ffa000', mode: 'glow', durationMs: 900 },
    ]);
  });

  // ─── Task 15 ─────────────────────────────────────────────────────────

  it('watchedColIds() unions condition references and cell-scope columnIds', () => {
    const engine = new RuleEngine();
    engine.setRules([
      { kind: 'style', id: 'r1', name: 'r1', enabled: true, priority: 1,
        condition: '[pnl] < 0 && [qty] > 10', scope: { kind: 'cell', columnIds: ['pnl'] },
        style: { base: { color: '#c62828' } } },
      { kind: 'style', id: 'off', name: 'off', enabled: false, priority: 2,
        condition: '[hidden] = 1', scope: { kind: 'row' }, style: { base: {} } },
    ]);
    expect([...engine.watchedColIds()].sort()).toEqual(['pnl', 'qty']);
  });
});
