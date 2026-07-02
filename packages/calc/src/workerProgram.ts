// Worker-side calc evaluation. evaluateCalcAst is the SELF-CONTAINED
// interpreter that crosses the postMessage boundary as source text —
// the worker/aggFuncRegistry.ts Function.toString() → new Function
// precedent (CSP caveat documented there; the source is static, never
// user input). Zero free variables, zero imports, every helper nested
// inside the function body. coverage-v8 profiles at the V8 level and
// does not rewrite this source.
//
// Semantics: mirrors packages/expression/src/compile.ts + builtins.ts
// for row-local programs, with ONE deliberate divergence (spec §5 risk
// table): wherever expression throws EvalError, this interpreter returns
// null — calc's "runtime errors → null cell" StarUI rule, applied at
// whole-expression granularity by the single try/catch at the root
// (exactly the granularity EvalError propagation gives the expression
// pipeline). tests/workerProgram.test.ts pins both halves of that
// contract with a seeded parity property.
//
// The synthetic roots '__cgridAgg' / '__cgridPrev' are HARDCODED strings
// here — self-containment forbids importing AGG_ROOT/PREV_ROOT from
// ./aggTransform; the test suite cross-checks them.
//
// Authoritative reference:
// docs/superpowers/specs/2026-07-02-cycle-21d-calc-design.md §2.3 + §5.

import type { Ast } from '@cgrid/expression';
import type { AggSpec, CellDataType } from './types';

/** One calc column as shipped to the kernel worker (plain JSON). */
export interface CompiledCalcColumn {
  colId: string;
  /** The REWRITTEN ast (aggregate/PREV sites are synthetic field reads). */
  ast: Ast;
  prePass: AggSpec[];
  cellDataType: CellDataType;
  usesPrev: boolean;
}

/** The full setCalcProgram payload (plain JSON + function-source strings). */
export interface WorkerCalcProgramPayload {
  columns: CompiledCalcColumn[];
  interpreterSource: string;
  aggregateSources: Array<{ name: string; source: string }>;
}

export function evaluateCalcAst(
  ast: unknown,
  row: Record<string, unknown>,
  aggSlots: ReadonlyArray<number | null>,
  prevLookup: ((colId: string) => unknown) | null,
): unknown {
  // Everything below is nested — fn.toString() must reconstruct standalone.
  // Type annotations erase; only runtime identifiers count as free variables.

  function truthy(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'number' && Number.isNaN(v)) return false;
    return Boolean(v);
  }

  function asNum(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    // expression: EvalError('null-field') — here: null at root.
    if (v === null || v === undefined) throw new Error('null-field');
    const n = Number(v);
    // expression: EvalError('type-error') — here: null at root.
    if (Number.isNaN(n)) throw new Error('type-error');
    return n;
  }

  function asStr(v: unknown): string {
    if (typeof v === 'string') return v;
    // expression: EvalError('null-field') via builtins asString — here: null at root.
    if (v === null || v === undefined) throw new Error('null-field');
    return String(v);
  }

  function cmp(l: unknown, r: unknown): number {
    if (typeof l === 'number' && typeof r === 'number') return l - r;
    if (typeof l === 'string' && typeof r === 'string') return l < r ? -1 : l > r ? 1 : 0;
    // expression: EvalError('type-error') — here: null at root.
    throw new Error('type-error');
  }

  function eq(l: unknown, r: unknown): boolean {
    // strict — no coercion, but null == undefined (mirror compile.ts eq).
    if (l === null || l === undefined) return r === null || r === undefined;
    return l === r;
  }

  // The 14 builtins, mirrored line-for-line from expression builtins.ts.
  // Arity/unknown-fn checks happened at compileCalc time — violations here
  // mean malformed input and surface as null via the root catch.
  function callBuiltin(name: string, a: unknown[]): unknown {
    switch (name) {
      case 'IF': return truthy(a[0]) ? a[1] : a[2];
      case 'COALESCE': {
        for (const v of a) {
          if (v !== null && v !== undefined) return v;
        }
        return null;
      }
      case 'NOT': return !truthy(a[0]);
      case 'AND': return a.every(truthy);
      case 'OR': return a.some(truthy);
      case 'ABS': return Math.abs(asNum(a[0]));
      case 'ROUND': {
        const n = asNum(a[0]);
        const digits = a.length === 2 ? asNum(a[1]) : 0;
        const p = Math.pow(10, digits);
        return Math.round(n * p) / p;
      }
      case 'MIN': return Math.min(...a.map(asNum));
      case 'MAX': return Math.max(...a.map(asNum));
      case 'FLOOR': return Math.floor(asNum(a[0]));
      case 'CEIL': return Math.ceil(asNum(a[0]));
      case 'LOWER': return asStr(a[0]).toLowerCase();
      case 'UPPER': return asStr(a[0]).toUpperCase();
      case 'LEN': return asStr(a[0]).length;
      default: throw new Error('unknown-fn'); // malformed input → null at root
    }
  }

  function readField(path: readonly string[]): unknown {
    if (path[0] === '__cgridAgg') {
      const v = aggSlots[Number(path[1])];
      return v === undefined ? null : v;
    }
    if (path[0] === '__cgridPrev') {
      if (!prevLookup) return null;
      const v = prevLookup(String(path[1]));
      return v === undefined ? null : v;
    }
    let cur: unknown = row;
    for (const seg of path) {
      if (cur === null || cur === undefined) return null;
      if (typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[seg];
    }
    return cur === undefined ? null : cur;
  }

  function ev(n: unknown): unknown {
    if (n === null || typeof n !== 'object') throw new Error('bad-ast');
    const node = n as Record<string, unknown>;
    switch (node.kind) {
      case 'literal':
        return node.value === undefined ? null : node.value;
      case 'field':
        return readField(node.path as readonly string[]);
      case 'unary': {
        if (node.op === '!') return !truthy(ev(node.arg));
        if (node.op === '-') return -asNum(ev(node.arg));
        throw new Error('bad-ast');
      }
      case 'binary': {
        const op = node.op;
        // Short-circuit forms evaluate the right side lazily and RETURN
        // OPERAND VALUES (mirror compile.ts '&&'/'||' exactly).
        if (op === '&&') {
          const lv = ev(node.left);
          if (!truthy(lv)) return lv;
          return ev(node.right);
        }
        if (op === '||') {
          const lv = ev(node.left);
          if (truthy(lv)) return lv;
          return ev(node.right);
        }
        const lv = ev(node.left);
        const rv = ev(node.right);
        switch (op) {
          case '+': {
            if (typeof lv === 'string' && typeof rv === 'string') return lv + rv;
            return asNum(lv) + asNum(rv);
          }
          case '-': return asNum(lv) - asNum(rv);
          case '*': return asNum(lv) * asNum(rv);
          case '/': {
            const ln = asNum(lv);
            const rn = asNum(rv);
            // expression: EvalError('div-by-zero') — here: null at root.
            if (rn === 0) throw new Error('div-by-zero');
            return ln / rn;
          }
          case '%': {
            const ln = asNum(lv);
            const rn = asNum(rv);
            // expression: EvalError('div-by-zero') — here: null at root.
            if (rn === 0) throw new Error('div-by-zero');
            return ln % rn;
          }
          case '<': return cmp(lv, rv) < 0;
          case '<=': return cmp(lv, rv) <= 0;
          case '>': return cmp(lv, rv) > 0;
          case '>=': return cmp(lv, rv) >= 0;
          case '==': return eq(lv, rv);
          case '!=': return !eq(lv, rv);
          default: throw new Error('bad-ast');
        }
      }
      case 'ternary':
        // LAZY — only the taken branch evaluates (mirror compileTernary).
        return truthy(ev(node.test)) ? ev(node.consequent) : ev(node.alternate);
      case 'call': {
        const args = node.args as readonly unknown[];
        // EAGER — expression compiles builtin args eagerly (compileCall
        // maps ALL args before impl runs); IF included.
        const values: unknown[] = [];
        for (const a of args) values.push(ev(a));
        return callBuiltin(String(node.name), values);
      }
      case 'aggregate':
      case 'prev':
        // Never present post-rewrite; un-rewritten input is malformed.
        throw new Error('bad-ast');
      default:
        throw new Error('bad-ast');
    }
  }

  try {
    return ev(ast);
  } catch {
    // The locked divergence (spec §5): expression throws EvalError;
    // calc renders a null cell. Malformed asts land here too.
    return null;
  }
}

/** Shipped to the kernel worker; reconstructed via new Function (guarded by test). */
export const INTERPRETER_SOURCE: string = evaluateCalcAst.toString();

/**
 * Plain-JSON program payload for the kernel's setCalcProgram message.
 * `aggregates` is a parameter (not a registry import) so this module stays
 * registry-independent — the bridge (Task 14) passes serializeAggregates()
 * output from the Task-5 registry; tests that need no aggregates omit it.
 */
export function buildWorkerCalcProgram(
  cols: CompiledCalcColumn[],
  aggregates: ReadonlyArray<{ name: string; source: string }> = [],
): WorkerCalcProgramPayload {
  return {
    columns: cols.map((c) => ({
      colId: c.colId,
      ast: c.ast,
      prePass: c.prePass.map((s) => ({
        slot: s.slot, fn: s.fn, colId: s.colId, scope: { kind: s.scope.kind },
      })),
      cellDataType: c.cellDataType,
      usesPrev: c.usesPrev,
    })),
    interpreterSource: INTERPRETER_SOURCE,
    aggregateSources: aggregates.map((a) => ({ name: a.name, source: a.source })),
  };
}
