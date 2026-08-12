/**
 * Calculated columns — expression DSL on CSRM; Perspective ExprTK map for SSRM.
 */
import { compile, evaluate, parse, validate } from '../expression/index';
import type { Compiled, Schema } from '../expression/types';

export type CalcColumn = {
  alias: string;
  expression: string;
  headerName?: string;
  enabled?: boolean;
};

type CompiledCalc = CalcColumn & {
  compiled: Compiled | null;
  error?: string;
};

export class CalcEngine {
  private cols: CompiledCalc[] = [];
  private schema: Schema | undefined;

  setSchema(schema: Schema | undefined): void {
    this.schema = schema;
    // Recompile against new schema
    this.setColumns(this.getColumns());
  }

  setColumns(cols: CalcColumn[]): void {
    // Reject calc-on-calc references (alias in another expression).
    const aliases = new Set(cols.map((c) => c.alias));
    this.cols = cols.map((c) => {
      for (const other of aliases) {
        if (other === c.alias) continue;
        if (c.expression.includes(`[${other}]`)) {
          return {
            ...c,
            compiled: null,
            error: `calc-on-calc reference to '${other}' is not allowed`,
          };
        }
      }
      return this.compileOne(c);
    });
  }

  getColumns(): CalcColumn[] {
    return this.cols.map(({ compiled: _c, error: _e, ...r }) => r);
  }

  getErrors(): Array<{ alias: string; error: string }> {
    return this.cols
      .filter((c) => c.error)
      .map((c) => ({ alias: c.alias, error: c.error! }));
  }

  /** Validate an expression without installing it. */
  validateExpression(expression: string): { ok: true } | { ok: false; error: string } {
    if (this.schema) {
      const v = validate(expression, this.schema);
      if (!v.ok) {
        return { ok: false, error: v.errors[0]?.message ?? 'invalid expression' };
      }
      return { ok: true };
    }
    const parsed = parse(expression);
    if (!parsed.ok) return { ok: false, error: parsed.error.message };
    const c = compile(parsed.ast);
    if (!c.ok) return { ok: false, error: c.error.message };
    return { ok: true };
  }

  /** CSRM: evaluate all enabled calc columns onto a row. */
  evaluate(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of this.cols) {
      if (c.enabled === false || !c.compiled) continue;
      try {
        out[c.alias] = evaluate(c.compiled, { row });
      } catch {
        out[c.alias] = null;
      }
    }
    return out;
  }

  /** Merge calc outputs into a copy of the row. */
  enrich(row: Record<string, unknown>): Record<string, unknown> {
    return { ...row, ...this.evaluate(row) };
  }

  /**
   * SSRM / Perspective adapter — map alias → expression string for ViewConfig.
   * Perspective ExprTK uses different quoting; callers may remap.
   */
  toPerspectiveExpressions(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of this.cols) {
      if (c.enabled === false || c.error) continue;
      // Strip `[field]` → `"field"` for Perspective-ish ExprTK.
      out[c.alias] = c.expression.replace(/\[([^\]]+)\]/g, '"$1"');
    }
    return out;
  }

  /** Output aliases for SSRM columnKeys / watched cols. */
  outputIds(): string[] {
    return this.cols.filter((c) => c.enabled !== false && !c.error).map((c) => c.alias);
  }

  private compileOne(col: CalcColumn): CompiledCalc {
    const parsed = parse(col.expression);
    if (!parsed.ok) {
      return { ...col, compiled: null, error: parsed.error.message };
    }
    const c = compile(parsed.ast);
    if (!c.ok) {
      return { ...col, compiled: null, error: c.error.message };
    }
    return { ...col, compiled: c.compiled };
  }
}
