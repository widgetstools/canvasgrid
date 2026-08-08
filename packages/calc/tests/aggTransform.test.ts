import { describe, expect, it } from 'vitest';
import { parse } from '@wellsfargo-starui/velocity-grid-expression';
import type { Ast, AstNode, BinaryNode, CallNode, FieldNode, Schema } from '@wellsfargo-starui/velocity-grid-expression';
import {
  AGG_ROOT, PREV_ROOT, collectWatchedColIds, transformAggregates,
} from '../src/aggTransform';

const schema: Schema = {
  fields: { price: 'number', qty: 'number', px: 'number', sym: 'string' },
};

function astOf(source: string): Ast {
  const parsed = parse(source);
  if (!parsed.ok) throw new Error(`parse failed for '${source}': ${parsed.error.message}`);
  return parsed.ast;
}

function mustTransform(source: string, sch?: Schema) {
  const res = transformAggregates(astOf(source), sch);
  if (!res.ok) throw new Error(`expected ok for '${source}', got ${res.error.code}: ${res.error.message}`);
  return res;
}

function mustFail(source: string, sch?: Schema) {
  const res = transformAggregates(astOf(source), sch);
  if (res.ok) throw new Error(`expected transform failure for '${source}'`);
  return res.error;
}

function fieldPath(node: AstNode): string[] {
  expect(node.kind).toBe('field');
  return (node as FieldNode).path;
}

describe('transformAggregates — aggregate rewrite', () => {
  it('SUM([price]) → slot 0 + synthetic __cgridAgg field read', () => {
    const res = mustTransform('SUM([price])');
    expect(res.prePass).toEqual([
      { slot: 0, fn: 'SUM', colId: 'price', scope: { kind: 'visible' } },
    ]);
    expect(fieldPath(res.ast)).toEqual([AGG_ROOT, '0']);
    expect(res.usesPrev).toBe(false);
  });

  it("records the spec default scope 'visible' when no literal is given (worker promotes visible→group under grouping — Stage B contract, Task 10)", () => {
    const res = mustTransform('AVG([qty])');
    expect(res.prePass[0]!.scope).toEqual({ kind: 'visible' });
  });

  it('duplicate (fn, colId, scope) triples share one slot', () => {
    const res = mustTransform('SUM([price]) + SUM([price])');
    expect(res.prePass).toHaveLength(1);
    const bin = res.ast as BinaryNode;
    expect(fieldPath(bin.left)).toEqual([AGG_ROOT, '0']);
    expect(fieldPath(bin.right)).toEqual([AGG_ROOT, '0']);
  });

  it('distinct triples get distinct slots — scope participates in the intern key', () => {
    const res = mustTransform("SUM([price]) + SUM([qty]) + SUM([price], 'group')");
    expect(res.prePass).toEqual([
      { slot: 0, fn: 'SUM', colId: 'price', scope: { kind: 'visible' } },
      { slot: 1, fn: 'SUM', colId: 'qty', scope: { kind: 'visible' } },
      { slot: 2, fn: 'SUM', colId: 'price', scope: { kind: 'group' } },
    ]);
  });

  it('rewrites nested aggregate call sites — SUM inside IF(...)', () => {
    const res = mustTransform("IF([qty] > 0, SUM([price], 'group'), 0)");
    const call = res.ast as CallNode;
    expect(call.kind).toBe('call');
    expect(call.name).toBe('IF');
    expect(fieldPath(call.args[1]!)).toEqual([AGG_ROOT, '0']);
    expect(res.prePass).toEqual([
      { slot: 0, fn: 'SUM', colId: 'price', scope: { kind: 'group' } },
    ]);
  });

  it('dot-path aggregate source records the FULL dotted colId', () => {
    const res = mustTransform('AVG([trade.px])');
    expect(res.prePass[0]!.colId).toBe('trade.px');
  });

  it('preserves the call-site loc on the synthetic field read', () => {
    const src = 'SUM([price])';
    const res = mustTransform(src);
    expect(res.ast.loc).toEqual({ start: 0, end: src.length });
  });
});

describe('MIN/MAX disambiguation (arg shape)', () => {
  it.each([
    ['MIN([price])', 'MIN'],
    ['MAX([price])', 'MAX'],
    ["MIN([price], 'group')", 'MIN'],
  ])('%s → aggregate (%s)', (source, fn) => {
    const res = mustTransform(source);
    expect(res.prePass).toHaveLength(1);
    expect(res.prePass[0]!.fn).toBe(fn);
    expect(res.ast.kind).toBe('field');
  });

  it("MIN([price], 'group') consumes the scope literal", () => {
    const res = mustTransform("MIN([price], 'group')");
    expect(res.prePass[0]!.scope).toEqual({ kind: 'group' });
  });

  it.each([
    ['MIN(1, 2)'],
    ['MIN([price], [qty])'],
    ['MAX([price], [qty], [px])'],
    ['MIN([price], 1)'],
  ])('%s → left as the variadic builtin call', (source) => {
    const res = mustTransform(source);
    expect(res.prePass).toEqual([]);
    expect(res.ast.kind).toBe('call');
    expect((res.ast as CallNode).name).toBe(source.startsWith('MIN') ? 'MIN' : 'MAX');
  });

  it("MIN([price], 'bogus') → unknown-scope (a string second arg selects the aggregate reading)", () => {
    const err = mustFail("MIN([price], 'bogus')");
    expect(err.code).toBe('unknown-scope');
    expect(err.colId).toBeNull();
    expect(err.loc).not.toBeNull();
  });
});

describe('aggregate shape errors (non-variadic names)', () => {
  it.each([
    ['SUM(1)'],
    ['SUM([price], [qty])'],
    ['AVG()'],
    ['SUM([price] * 2)'],
    ['COUNT([price], 42)'],
  ])('%s → bad-shape', (source) => {
    expect(mustFail(source).code).toBe('bad-shape');
  });
});

describe('PERCENTILE parameter channel', () => {
  it("PERCENTILE([price], 95) → fn 'PERCENTILE(95)' (the literal IS percent points)", () => {
    const res = mustTransform('PERCENTILE([price], 95)');
    expect(res.prePass).toEqual([
      { slot: 0, fn: 'PERCENTILE(95)', colId: 'price', scope: { kind: 'visible' } },
    ]);
  });

  it("PERCENTILE([price], 50, 'all') → param + scope", () => {
    const res = mustTransform("PERCENTILE([price], 50, 'all')");
    expect(res.prePass[0]!.fn).toBe('PERCENTILE(50)');
    expect(res.prePass[0]!.scope).toEqual({ kind: 'all' });
  });

  it("PERCENTILE([price], 0.5) is VALID — 0.5 percent points, NOT a fraction reading", () => {
    const res = mustTransform('PERCENTILE([price], 0.5)');
    expect(res.prePass[0]!.fn).toBe('PERCENTILE(0.5)');
  });

  it('PERCENTILE([price], 150) — outside the 0–100 percent-point range → bad-shape', () => {
    const err = mustFail('PERCENTILE([price], 150)');
    expect(err.code).toBe('bad-shape');
    expect(err.message).toMatch(/percent points 0–100/);
  });

  it('PERCENTILE([price]) without the percentile → bad-shape', () => {
    expect(mustFail('PERCENTILE([price])').code).toBe('bad-shape');
  });

  it("PERCENTILE([price], 'group') — a scope where the percentile belongs → bad-shape", () => {
    expect(mustFail("PERCENTILE([price], 'group')").code).toBe('bad-shape');
  });
});

describe('scope literals', () => {
  it.each([['all'], ['visible'], ['group'], ['parent']])(
    "SUM([price], '%s') records the scope",
    (kind) => {
      const res = mustTransform(`SUM([price], '${kind}')`);
      expect(res.prePass[0]!.scope).toEqual({ kind });
    },
  );

  it("unknown scope literal → unknown-scope with the expected-set message", () => {
    const err = mustFail("SUM([price], 'window')");
    expect(err.code).toBe('unknown-scope');
    expect(err.message).toMatch(/expected 'all'/);
  });
});

describe('PREV', () => {
  it('PREV([price]) → synthetic __cgridPrev read + usesPrev', () => {
    const res = mustTransform('PREV([price])');
    expect(fieldPath(res.ast)).toEqual([PREV_ROOT, 'price']);
    expect(res.usesPrev).toBe(true);
    expect(res.prePass).toEqual([]);
  });

  it('[price] - PREV([price]) rewrites only the PREV site', () => {
    const res = mustTransform('[price] - PREV([price])');
    expect(res.usesPrev).toBe(true);
    const bin = res.ast as BinaryNode;
    expect(fieldPath(bin.left)).toEqual(['price']);
    expect(fieldPath(bin.right)).toEqual([PREV_ROOT, 'price']);
  });

  it('PREV([trade.px]) carries the full dotted colId as ONE synthetic segment', () => {
    const res = mustTransform('PREV([trade.px])');
    expect(fieldPath(res.ast)).toEqual([PREV_ROOT, 'trade.px']);
  });

  it.each([
    ['PREV(1)'],
    ['PREV([price], [qty])'],
    ['PREV()'],
    ['PREV(SUM([price]))'],
  ])('%s → bad-shape', (source) => {
    expect(mustFail(source).code).toBe('bad-shape');
  });
});

describe('order-dependent reserves', () => {
  it.each([
    ['RANK'], ['DENSE_RANK'], ['PERCENT_RANK'],
    ['RUNNING_SUM'], ['RUNNING_AVG'], ['MOVING_AVG'],
    ['DELTA_FROM_PREV'], ['DELTA_FROM_FIRST'], ['DELTA_FROM_LAST'],
  ])('%s([price]) → not-yet-implemented naming the follow-up', (name) => {
    const err = mustFail(`${name}([price])`);
    expect(err.code).toBe('not-yet-implemented');
    expect(err.message).toMatch(/follow-up/);
  });
});

describe('watchedColIds via collectWatchedColIds', () => {
  it('collects every field head PRE-rewrite, including aggregate + PREV sources', () => {
    const heads = collectWatchedColIds(astOf('[qty] * SUM([price]) + PREV([px])'));
    expect([...heads].sort()).toEqual(['price', 'px', 'qty']);
  });

  it('dot-path reads watch the head colId', () => {
    const heads = collectWatchedColIds(astOf('AVG([trade.px]) + [trade.qty]'));
    expect([...heads]).toEqual(['trade']);
  });

  it('excludes the synthetic roots when run on a rewritten ast', () => {
    const res = mustTransform('SUM([price]) + PREV([px])');
    expect(collectWatchedColIds(res.ast).size).toBe(0);
  });
});

describe('schema validation', () => {
  it("unknown aggregate source → bad-shape: unknown field 'bogus'", () => {
    const err = mustFail('SUM([bogus])', schema);
    expect(err.code).toBe('bad-shape');
    expect(err.message).toMatch(/unknown field 'bogus'/);
  });

  it('unknown plain field read → bad-shape', () => {
    expect(mustFail('[price] + [bogus]', schema).code).toBe('bad-shape');
  });

  it('known fields across aggregate, PREV, and plain reads pass', () => {
    const res = mustTransform("SUM([price], 'group') + [qty] - PREV([px])", schema);
    expect(res.prePass).toHaveLength(1);
    expect(res.usesPrev).toBe(true);
  });

  it('no schema → lenient (compile stage owns nothing here)', () => {
    expect(mustTransform('SUM([whatever])').prePass[0]!.colId).toBe('whatever');
  });
});

describe('non-aggregate passthrough', () => {
  it('row-local expressions come back structurally identical with an empty pre-pass', () => {
    const res = mustTransform('[price] * 2');
    expect(res.ast).toEqual(astOf('[price] * 2'));
    expect(res.prePass).toEqual([]);
    expect(res.usesPrev).toBe(false);
  });

  it('unknown function names are left for the compile stage (unknown-fn belongs to 21b)', () => {
    const res = mustTransform('FOO([price])');
    expect(res.ast.kind).toBe('call');
    expect((res.ast as CallNode).name).toBe('FOO');
    expect(res.prePass).toEqual([]);
  });
});
