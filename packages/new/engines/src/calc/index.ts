/** Calculated columns — CSRM engine + SSRM ExprTK adapter seam. */

export type CalcColumn = {
  alias: string;
  expression: string;
  headerName?: string;
};

export class CalcEngine {
  private cols: CalcColumn[] = [];

  setColumns(cols: CalcColumn[]): void {
    this.cols = cols.slice();
  }

  getColumns(): CalcColumn[] {
    return this.cols.slice();
  }

  /** CSRM: evaluate simple `a + b` style expressions on a row. */
  evaluate(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of this.cols) {
      out[c.alias] = evalSimple(c.expression, row);
    }
    return out;
  }

  /** SSRM: expressions run in Perspective — return map for ViewConfig.expressions. */
  toPerspectiveExpressions(): Record<string, string> {
    return Object.fromEntries(this.cols.map((c) => [c.alias, `"${c.expression}"`]));
  }
}

function evalSimple(expr: string, row: Record<string, unknown>): unknown {
  const trimmed = expr.trim();
  const m = trimmed.match(/^([a-zA-Z_]\w*)\s*([+\-*/])\s*([a-zA-Z_]\w*)$/);
  if (!m) return row[trimmed];
  const a = Number(row[m[1]!]);
  const b = Number(row[m[3]!]);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  switch (m[2]) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? null : a / b;
    default: return null;
  }
}
