/**
 * Shared grid-introspection helpers for the customizer settings modules —
 * expression Schema + column catalogs sourced from the live grid.
 */
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import type { VelocityGridExtContext } from '../extension/types';
import type { ExpressionColumn } from './expressionEditor';

interface RawColDef {
  colId?: string;
  field?: string;
  headerName?: string;
  cellDataType?: string;
  children?: unknown[];
}

/** Leaf column defs from the live grid (groups flattened). */
export function leafColumns(grid: VelocityGridExtContext['grid']): RawColDef[] {
  const out: RawColDef[] = [];
  const walk = (defs: readonly unknown[]): void => {
    for (const d of defs) {
      const def = d as RawColDef;
      if (def.children?.length) { walk(def.children); continue; }
      if (def.colId ?? def.field) out.push(def);
    }
  };
  try { walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { /* detached */ }
  return out;
}

/** @wellsfargo-starui/velocity-grid-expression Schema from the grid's leaf columns. */
export function schemaFromGrid(grid: VelocityGridExtContext['grid']): Schema {
  const fields: Schema['fields'] = {};
  for (const def of leafColumns(grid)) {
    const id = def.colId ?? def.field;
    if (!id) continue;
    const t = def.cellDataType;
    fields[id] =
      t === 'number' || t === 'boolean' || t === 'date'
        ? t
        : t === 'text' || t === 'string'
          ? 'string'
          : 'unknown';
  }
  return { fields };
}

/** Completion catalog for the expression editor. */
export function editorColumns(grid: VelocityGridExtContext['grid']): ExpressionColumn[] {
  return leafColumns(grid).map((def) => ({
    colId: (def.colId ?? def.field)!,
    headerName: def.headerName,
    dataType: def.cellDataType,
  }));
}
