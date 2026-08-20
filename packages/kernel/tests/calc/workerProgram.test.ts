import { describe, expect, it } from 'vitest';
import { compile, evaluate, parse, EvalError } from '../../src/expression/index';
import type { Ast } from '../../src/expression/index';
import { AGG_ROOT, PREV_ROOT } from '../../src/calc/aggTransform';
import { compileCalc } from '../../src/calc/compile';
import {
  buildWorkerCalcProgram, evaluateCalcAst, INTERPRETER_SOURCE,
} from '../../src/calc/workerProgram';
import type { CompiledCalcColumn } from '../../src/calc/workerProgram';

function astOf(source: string): Ast {
  const parsed = parse(source);
  if (!parsed.ok) throw new Error(`parse failed for '${source}': ${parsed.error.message}`);
  return parsed.ast;
}

function calcAst(source: string): Ast {
  const res = compileCalc(source);
  if (!res.ok) throw new Error(`compileCalc failed for '${source}': ${res.error.message}`);
  return res.compiled.ast;
}

// ─── Seeded PRNG (no Math.random anywhere in this file) ────────────────

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

// ─── Generator grammar — every emission parses AND compiles ────────────

const NUM_FIELDS = ['a', 'b', 'c'] as const;
const STR_FIELDS = ['s', 't'] as const;

function genNum(rnd: () => number): string {
  const n = Math.floor(rnd() * 21); // nonnegative — negatives come from unary minus
  return rnd() < 0.3 ? `${n}.${Math.floor(rnd() * 10)}` : String(n);
}

function genExpr(rnd: () => number, depth: number): string {
  if (depth <= 0) {
    const r = rnd();
    if (r < 0.45) return `[${pick(rnd, NUM_FIELDS)}]`;
    if (r < 0.75) return genNum(rnd);
    if (r < 0.85) return `[${pick(rnd, STR_FIELDS)}]`;
    if (r < 0.95) return `'${pick(rnd, ['x', 'yy', 'zzz'])}'`;
    return pick(rnd, ['true', 'false']);
  }
  const r = rnd();
  const sub = (): string => genExpr(rnd, depth - 1);
  if (r < 0.3) return `(${sub()} ${pick(rnd, ['+', '-', '*', '/', '%'])} ${sub()})`;
  if (r < 0.45) return `(${sub()} ${pick(rnd, ['<', '<=', '>', '>=', '==', '!='])} ${sub()})`;
  if (r < 0.55) return `(${sub()} ${pick(rnd, ['&&', '||'])} ${sub()})`;
  if (r < 0.62) return `(${sub()} ? ${sub()} : ${sub()})`;
  if (r < 0.67) return `(-${sub()})`;
  if (r < 0.72) return `(!${sub()})`;
  const fns: ReadonlyArray<readonly [string, number]> = [
    ['ABS', 1], ['FLOOR', 1], ['CEIL', 1], ['ROUND', 2],
    ['MIN', 2], ['MAX', 3], ['COALESCE', 2], ['IF', 3],
    ['NOT', 1], ['AND', 2], ['OR', 2],
    ['LOWER', 1], ['UPPER', 1], ['LEN', 1],
  ];
  const [fn, arity] = pick(rnd, fns);
  const args: string[] = [];
  for (let i = 0; i < arity; i++) args.push(sub());
  return `${fn}(${args.join(', ')})`;
}

function genRow(rnd: () => number): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const f of NUM_FIELDS) row[f] = rnd() < 0.15 ? null : Math.floor(rnd() * 41) - 20;
  for (const f of STR_FIELDS) row[f] = rnd() < 0.15 ? null : pick(rnd, ['x', 'yy', 'zzz', '']);
  return row;
}

describe('evaluateCalcAst — parity property vs expression.compile + evaluate', () => {
  it('matches on 240 seeded row-local cases; EvalError cases map to null', () => {
    const rnd = lcg(20260702);
    let okCount = 0;
    let threwCount = 0;
    for (let i = 0; i < 240; i++) {
      const source = genExpr(rnd, 1 + Math.floor(rnd() * 3));
      const parsed = parse(source);
      expect(parsed.ok, `generator must emit parseable source: ${source}`).toBe(true);
      if (!parsed.ok) continue;
      const compiled = compile(parsed.ast);
      expect(compiled.ok, `generator must emit compilable source: ${source}`).toBe(true);
      if (!compiled.ok) continue;
      const row = genRow(rnd);
      let expected: unknown = null;
      let threw = false;
      try {
        expected = evaluate(compiled.compiled, { row });
      } catch (e) {
        if (e instanceof EvalError) threw = true;
        else throw e;
      }
      const actual = evaluateCalcAst(parsed.ast, row, [], null);
      if (threw) {
        threwCount += 1;
        // The locked divergence: expression throws EvalError → interpreter null.
        expect(actual, `EvalError case must map to null: ${source} row=${JSON.stringify(row)}`).toBeNull();
      } else {
        okCount += 1;
        expect(actual, `parity failure: ${source} row=${JSON.stringify(row)}`).toEqual(expected);
      }
    }
    expect(okCount + threwCount).toBe(240);
    expect(threwCount).toBeGreaterThan(0); // the null-on-EvalError branch IS exercised
    expect(okCount).toBeGreaterThan(100); // and the generator is not degenerate
  });

  it('returns null where expression.evaluate throws EvalError (explicit divergence pin)', () => {
    const parsed = parse('[a] / [b]');
    if (!parsed.ok) throw new Error('unreachable');
    const compiled = compile(parsed.ast);
    if (!compiled.ok) throw new Error('unreachable');
    expect(() => evaluate(compiled.compiled, { row: { a: 1, b: 0 } })).toThrow(EvalError);
    expect(evaluateCalcAst(parsed.ast, { a: 1, b: 0 }, [], null)).toBeNull();
    expect(evaluateCalcAst(parsed.ast, { a: 1, b: 2 }, [], null)).toBe(0.5);
  });

  it('IF is EAGER like the expression builtin — a throwing untaken branch still nulls the cell', () => {
    expect(evaluateCalcAst(astOf('IF(true, 1, 1 / 0)'), {}, [], null)).toBeNull();
  });

  it('the ternary is LAZY — the untaken branch never evaluates', () => {
    expect(evaluateCalcAst(astOf('true ? 1 : 1 / 0'), {}, [], null)).toBe(1);
  });
});

describe('INTERPRETER_SOURCE — reconstruction through new Function', () => {
  it('reconstructs a working interpreter with full parity on a 20-case subset', () => {
    // eslint-disable-next-line no-new-func -- worker/aggFuncRegistry.ts precedent; source is static, never user input.
    const rebuilt = new Function('return (' + INTERPRETER_SOURCE + ')')() as typeof evaluateCalcAst;
    expect(typeof rebuilt).toBe('function');
    const rnd = lcg(0xbadc0de);
    for (let i = 0; i < 20; i++) {
      const source = genExpr(rnd, 2);
      const parsed = parse(source);
      if (!parsed.ok) throw new Error(`generator emitted unparseable source: ${source}`);
      const row = genRow(rnd);
      expect(rebuilt(parsed.ast, row, [], null), `rebuilt parity failure: ${source}`)
        .toEqual(evaluateCalcAst(parsed.ast, row, [], null));
    }
  });

  it('the rebuilt interpreter reads agg slots and prev identically', () => {
    // eslint-disable-next-line no-new-func -- worker/aggFuncRegistry.ts precedent; source is static, never user input.
    const rebuilt = new Function('return (' + INTERPRETER_SOURCE + ')')() as typeof evaluateCalcAst;
    const ast = calcAst('[price] - PREV([price]) + SUM([price])');
    const prev = (colId: string): unknown => (colId === 'price' ? 100 : null);
    expect(rebuilt(ast, { price: 105 }, [500], prev)).toBe(505);
    expect(rebuilt(ast, { price: 105 }, [500], prev))
      .toBe(evaluateCalcAst(ast, { price: 105 }, [500], prev));
  });
});

describe('evaluateCalcAst — agg slots + prev reads', () => {
  it('reads pre-pass slots through the hardcoded __cgridAgg root (cross-checked against Task 2)', () => {
    expect(AGG_ROOT).toBe('__cgridAgg'); // self-containment forbids importing it — pin the string
    expect(PREV_ROOT).toBe('__cgridPrev');
    const ast = calcAst("[price] / SUM([price], 'group')");
    expect(evaluateCalcAst(ast, { price: 50 }, [200], null)).toBe(0.25);
  });

  it('a missing slot reads null → whole cell null', () => {
    const ast = calcAst('[price] / SUM([price])');
    expect(evaluateCalcAst(ast, { price: 50 }, [], null)).toBeNull();
  });

  it('PREV reads flow through prevLookup', () => {
    const ast = calcAst('[price] - PREV([price])');
    expect(evaluateCalcAst(ast, { price: 105 }, [], (colId) => (colId === 'price' ? 100 : null)))
      .toBe(5);
  });

  it('prevLookup === null → PREV reads null → cell null', () => {
    const ast = calcAst('[price] - PREV([price])');
    expect(evaluateCalcAst(ast, { price: 105 }, [], null)).toBeNull();
  });

  it('passes the dotted colId to prevLookup as ONE key', () => {
    const ast = calcAst('PREV([trade.px])');
    const seen: string[] = [];
    expect(evaluateCalcAst(ast, {}, [], (colId) => {
      seen.push(colId);
      return 7;
    })).toBe(7);
    expect(seen).toEqual(['trade.px']);
  });
});

describe('evaluateCalcAst — malformed ast → null, never a throw', () => {
  it.each([
    [undefined],
    [{ kind: 'nope' }],
    [{ kind: 'binary', op: '**', left: { kind: 'literal', value: 1, loc: { start: 0, end: 1 } }, right: { kind: 'literal', value: 2, loc: { start: 0, end: 1 } } }],
    [{ kind: 'field' }], // missing path
    [{ kind: 'aggregate', name: 'SUM', args: [], loc: { start: 0, end: 3 } }], // un-rewritten reserved node
  ])('malformed ast %# → null', (ast) => {
    expect(evaluateCalcAst(ast, { a: 1 }, [], null)).toBeNull();
  });
});

describe('buildWorkerCalcProgram', () => {
  function compiledColumn(source: string, colId: string): CompiledCalcColumn {
    const res = compileCalc(source);
    if (!res.ok) throw new Error(`compileCalc failed for '${source}': ${res.error.message}`);
    return {
      colId,
      ast: res.compiled.ast,
      prePass: res.compiled.prePass,
      cellDataType: res.compiled.cellDataType,
      usesPrev: res.compiled.usesPrev,
    };
  }

  it('builds a plain-JSON payload with the interpreter source and empty aggregate sources by default', () => {
    const col = compiledColumn("[price] / SUM([price], 'group')", 'pctOfGroup');
    const payload = buildWorkerCalcProgram([col]);
    expect(payload.columns).toHaveLength(1);
    expect(payload.columns[0]!.colId).toBe('pctOfGroup');
    expect(payload.columns[0]!.prePass).toEqual([
      { slot: 0, fn: 'SUM', colId: 'price', scope: { kind: 'group' } },
    ]);
    expect(payload.columns[0]!.cellDataType).toBe('number');
    expect(payload.columns[0]!.usesPrev).toBe(false);
    expect(payload.interpreterSource).toBe(INTERPRETER_SOURCE);
    expect(payload.aggregateSources).toEqual([]);
  });

  it('copies provided aggregate sources (registry-independent parameter — Task 5 supplies serializeAggregates())', () => {
    const col = compiledColumn('SUM([price])', 'total');
    const payload = buildWorkerCalcProgram([col], [{ name: 'SUM', source: 'function sumAgg() {}' }]);
    expect(payload.aggregateSources).toEqual([{ name: 'SUM', source: 'function sumAgg() {}' }]);
  });

  it('round-trips structuredClone (postMessage-safe)', () => {
    const col = compiledColumn('[price] - PREV([price])', 'delta');
    const payload = buildWorkerCalcProgram([col]);
    expect(structuredClone(payload)).toEqual(payload);
  });

  it('deep-copies prePass — mutating the payload never mutates the compiled column', () => {
    const col = compiledColumn('SUM([price])', 'total');
    const payload = buildWorkerCalcProgram([col]);
    payload.columns[0]!.prePass[0]!.slot = 99;
    expect(col.prePass[0]!.slot).toBe(0);
  });
});
