/**
 * Merge Perspective ExprTK output aliases into a VelocityGrid columnDefs list.
 * Expression aliases are View outputs (not DataProvider catalog fields) — they
 * must be re-attached after catalog Apply / columnDefs resets.
 */
import type { CColDef } from '@wellsfargo-starui/velocity-grid';

export type ExpressionColumnMeta = {
  headerName?: string;
  cellDataType?: 'text' | 'number' | 'boolean' | 'date';
  width?: number;
  format?: string;
};

/** Drop prior expression cols, then append one def per alias. */
export function mergeExpressionColumnDefs<T = unknown>(
  base: readonly CColDef<T>[],
  expressions: Record<string, string>,
  meta: Record<string, ExpressionColumnMeta> = {},
): CColDef<T>[] {
  const aliases = new Set(Object.keys(expressions));
  const out = base.filter((d) => {
    const id = String(d.colId ?? d.field ?? '');
    return id && !aliases.has(id);
  });
  for (const alias of aliases) {
    const m = meta[alias] ?? {};
    out.push({
      colId: alias,
      field: alias as keyof T & string,
      headerName: m.headerName ?? alias,
      cellDataType: m.cellDataType ?? 'number',
      width: m.width ?? 120,
      ...(m.format ? { format: m.format } : {}),
      // Expression outputs are leaf measures — enable value agg when numeric.
      ...(m.cellDataType !== 'text' && m.cellDataType !== 'boolean' && m.cellDataType !== 'date'
        ? { aggFunc: 'sum', enableValue: true }
        : {}),
    } as CColDef<T>);
  }
  return out;
}
