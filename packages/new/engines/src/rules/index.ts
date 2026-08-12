/**
 * Conditional styling rules — expression conditions + style patches.
 * Conditions use the shared expression DSL: `[pnl] < 0`.
 */
import { compile, evaluate, parse } from '../expression/index';
import type { Compiled } from '../expression/types';

export type StyleRule = {
  id: string;
  /** Expression DSL condition, e.g. `[pnl] < 0`. */
  expression: string;
  style: {
    backgroundColor?: string;
    color?: string;
    fontWeight?: string;
    borderColor?: string;
  };
  /** Optional column scope — empty = all columns. */
  colIds?: string[];
  enabled?: boolean;
  priority?: number;
};

type CompiledRule = StyleRule & {
  compiled: Compiled | null;
  error?: string;
};

export class RulesEngine {
  private rules: CompiledRule[] = [];

  setRules(rules: StyleRule[]): void {
    this.rules = rules
      .slice()
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((r) => this.compileOne(r));
  }

  getRules(): StyleRule[] {
    return this.rules.map(({ compiled: _c, error: _e, ...r }) => r);
  }

  addRule(rule: StyleRule): void {
    this.setRules([...this.getRules(), rule]);
  }

  removeRule(id: string): void {
    this.setRules(this.getRules().filter((r) => r.id !== id));
  }

  /** First matching enabled rule for a cell (column-scoped). */
  match(
    row: Record<string, unknown>,
    colId?: string,
  ): StyleRule | undefined {
    for (const rule of this.rules) {
      if (rule.enabled === false) continue;
      if (rule.colIds?.length && colId && !rule.colIds.includes(colId)) continue;
      if (!rule.compiled) continue;
      try {
        const v = evaluate(rule.compiled, { row });
        if (v === true) {
          const { compiled: _c, error: _e, ...rest } = rule;
          return rest;
        }
      } catch {
        /* fail closed — non-matching */
      }
    }
    return undefined;
  }

  /** Resolve style for a cell — merges first match. */
  styleFor(
    row: Record<string, unknown>,
    colId?: string,
  ): StyleRule['style'] | undefined {
    return this.match(row, colId)?.style;
  }

  private compileOne(rule: StyleRule): CompiledRule {
    const parsed = parse(rule.expression);
    if (!parsed.ok) {
      return { ...rule, compiled: null, error: parsed.error.message };
    }
    const compiled = compile(parsed.ast);
    if (!compiled.ok) {
      return { ...rule, compiled: null, error: compiled.error.message };
    }
    return { ...rule, compiled: compiled.compiled };
  }
}
