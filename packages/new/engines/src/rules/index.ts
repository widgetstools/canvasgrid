/** Conditional styling rules engine. */

export type StyleRule = {
  id: string;
  expression: string;
  style: { backgroundColor?: string; color?: string };
};

export class RulesEngine {
  private rules: StyleRule[] = [];

  setRules(rules: StyleRule[]): void {
    this.rules = rules.slice();
  }

  getRules(): StyleRule[] {
    return this.rules.slice();
  }

  /** Evaluate against a merged rule-row (mirror ⊕ snapshot). */
  match(row: Record<string, unknown>): StyleRule | undefined {
    for (const rule of this.rules) {
      if (evalPredicate(rule.expression, row)) return rule;
    }
    return undefined;
  }
}

function evalPredicate(expr: string, row: Record<string, unknown>): boolean {
  const m = expr.trim().match(/^([a-zA-Z_]\w*)\s*(<|>|<=|>=|==|!=)\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return false;
  const left = Number(row[m[1]!]);
  const right = Number(m[3]);
  if (Number.isNaN(left)) return false;
  switch (m[2]) {
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    case '==': return left === right;
    case '!=': return left !== right;
    default: return false;
  }
}
