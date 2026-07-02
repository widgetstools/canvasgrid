import { describe, expect, it } from 'vitest';
import { RuleEngine } from '../src/ruleEngine';
import type {
  ConditionalStyleRule,
  IndicatorRule,
  RuleEvalContext,
  StyleRule,
} from '../src/types';

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
