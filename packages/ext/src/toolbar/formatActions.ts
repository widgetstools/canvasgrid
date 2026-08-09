/**
 * Shared column-style helpers for the selection mini-bar and context menu.
 * Uses the same `editColumn` / own-template path as the classic ribbon.
 */
import type { VelocityGridExtContext } from '../extension/types';

export type FormatGrid = {
  getCellRanges(): Array<{ colIds: string[] }>;
  getFocusedCell(): { rowId: string; colId: string } | null;
  editColumn(colId: string, patch: Record<string, unknown>): void;
  getTemplates(): Array<{ id: string; overrides: Record<string, unknown> }>;
  addEventListener(type: string, fn: (...args: unknown[]) => void): () => void;
};

export function asFormatGrid(ctx: VelocityGridExtContext): FormatGrid {
  return ctx.grid as unknown as FormatGrid;
}

/** Columns from the active cell ranges (focus fallback). */
export function selectedColIds(grid: FormatGrid): string[] {
  try {
    const fromRanges = grid.getCellRanges().flatMap((rg) => rg.colIds);
    if (fromRanges.length) return [...new Set(fromRanges)];
    const focus = grid.getFocusedCell();
    return focus ? [focus.colId] : [];
  } catch {
    return [];
  }
}

export function currentCellStyle(grid: FormatGrid, colId: string): Record<string, unknown> {
  try {
    const own = grid.getTemplates().find((t) => t.id === `__cgridOwn:${colId}`);
    return (own?.overrides?.cellStyle as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function applyCellStyle(
  ctx: VelocityGridExtContext,
  patch: Record<string, unknown>,
  colIds?: string[],
): void {
  const grid = asFormatGrid(ctx);
  const cols = colIds ?? selectedColIds(grid);
  if (!cols.length) return;
  for (const colId of cols) {
    try { grid.editColumn(colId, { cellStyle: patch }); } catch { /* unknown column */ }
  }
  ctx.profiles.markDirty();
}

export function clearCellFormatting(ctx: VelocityGridExtContext, colIds?: string[]): void {
  const grid = asFormatGrid(ctx);
  const cols = colIds ?? selectedColIds(grid);
  if (!cols.length) return;
  for (const colId of cols) {
    try {
      grid.editColumn(colId, {
        cellStyle: {
          fontWeight: 'normal',
          fontStyle: 'normal',
          textDecoration: 'none',
          fg: undefined,
          bg: undefined,
        },
        format: null,
      });
    } catch { /* ignore */ }
  }
  ctx.profiles.markDirty();
}

export function toggleBold(ctx: VelocityGridExtContext, colIds?: string[]): void {
  const grid = asFormatGrid(ctx);
  const cols = colIds ?? selectedColIds(grid);
  const first = cols[0];
  if (!first) return;
  const on = currentCellStyle(grid, first).fontWeight === 'bold';
  applyCellStyle(ctx, { fontWeight: on ? 'normal' : 'bold' }, cols);
}
