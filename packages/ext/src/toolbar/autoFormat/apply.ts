/**
 * Apply a field-catalog auto-format plan via calc `editColumn` — native
 * format strings + cellStyle (halign / fontWeight). Overwrites matched
 * columns so re-running Auto format refreshes catalog conventions.
 */
import { buildAutoFormatPlan } from './match';
import type { AutoFormatAssignment, AutoFormatColumn } from './types';

export type AutoFormatGrid = {
  getGridOption(key: string): unknown;
  editColumn(colId: string, patch: Record<string, unknown>): void;
  getTemplates?(): Array<{ id: string; overrides: Record<string, unknown> }>;
};

export type AutoFormatHost = {
  grid: AutoFormatGrid;
  profiles?: { markDirty(): void };
};

function readColumns(grid: AutoFormatGrid): AutoFormatColumn[] {
  const out: AutoFormatColumn[] = [];
  const walk = (defs: readonly unknown[]): void => {
    for (const d of defs) {
      const def = d as {
        colId?: string;
        field?: string;
        headerName?: string;
        cellDataType?: string;
        children?: unknown[];
      };
      if (def.children?.length) {
        walk(def.children);
        continue;
      }
      const colId = def.colId ?? (typeof def.field === 'string' ? def.field : undefined);
      if (!colId) continue;
      out.push({
        colId,
        field: typeof def.field === 'string' ? def.field : colId,
        headerName: typeof def.headerName === 'string' ? def.headerName : undefined,
        cellDataType: typeof def.cellDataType === 'string' ? def.cellDataType : undefined,
      });
    }
  };
  try {
    walk((grid.getGridOption('columnDefs') as unknown[]) ?? []);
  } catch { /* pre-init */ }
  return out;
}

function assignmentToPatch(spec: AutoFormatAssignment): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (spec.format !== undefined) patch.format = spec.format;
  const style: Record<string, unknown> = {};
  if (spec.alignment !== undefined) style.halign = spec.alignment;
  if (spec.bold) style.fontWeight = 'bold';
  if (Object.keys(style).length) patch.cellStyle = style;
  // headerName is intentionally NOT applied — calc does not template it;
  // renaming headers belongs in Column settings.
  return patch;
}

/**
 * Match every leaf column against the catalog and apply formatting.
 * @returns number of columns updated
 */
export function runAutoFormat(host: AutoFormatHost): number {
  const { grid } = host;
  if (typeof grid.editColumn !== 'function') return 0;

  const plan = buildAutoFormatPlan(readColumns(grid));
  const colIds = Object.keys(plan);
  if (colIds.length === 0) return 0;

  let n = 0;
  for (const colId of colIds) {
    const spec = plan[colId]!;
    const patch = assignmentToPatch(spec);
    if (Object.keys(patch).length === 0) continue;
    try {
      grid.editColumn(colId, patch);
      n += 1;
    } catch { /* unknown column / calc not wired */ }
  }
  if (n > 0) {
    try { host.profiles?.markDirty(); } catch { /* ignore */ }
  }
  return n;
}

export type { AutoFormatAssignment, AutoFormatColumn };
