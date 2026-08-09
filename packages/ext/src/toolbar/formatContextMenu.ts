/**
 * Cell context-menu Format / Clear entries that reuse formatActions.
 * Compose with the kernel default items via `getContextMenuItems`.
 */
import type { VelocityGridExtContext } from '../extension/types';
import {
  applyCellStyle,
  clearCellFormatting,
  currentCellStyle,
  toggleBold,
} from './formatActions';

type MenuItem = {
  name: string;
  action?: (params: unknown) => void;
  disabled?: boolean;
  subMenu?: MenuItem[];
};

type CtxParams = {
  colId: string | null;
  defaultItems: MenuItem[];
};

/** Build a getContextMenuItems callback bound to an ext context. */
export function buildFormatContextMenuItems(ctx: VelocityGridExtContext) {
  return (params: CtxParams): MenuItem[] => {
    const colId = params.colId;
    const cols = colId ? [colId] : [];
    const hasCol = cols.length > 0;
    const style = hasCol ? currentCellStyle(
      ctx.grid as unknown as Parameters<typeof currentCellStyle>[0],
      cols[0]!,
    ) : {};

    const formatItems: MenuItem[] = [
      {
        name: 'Bold',
        disabled: !hasCol,
        action: () => { if (hasCol) toggleBold(ctx, cols); },
      },
      {
        name: style.bg ? 'Clear fill' : 'Highlight fill',
        disabled: !hasCol,
        action: () => {
          if (!hasCol) return;
          applyCellStyle(ctx, { bg: style.bg ? undefined : '#fff59d' }, cols);
        },
      },
      {
        name: 'Clear formatting',
        disabled: !hasCol,
        action: () => { if (hasCol) clearCellFormatting(ctx, cols); },
      },
      {
        name: 'Format…',
        action: () => { ctx.events.emit({ type: 'open-settings', id: 'column-settings' }); },
      },
      { name: '---' },
    ];
    return [...formatItems, ...params.defaultItems];
  };
}

/** Install format context-menu items on the live grid (after construct). */
export function wireFormatContextMenu(ctx: VelocityGridExtContext): void {
  try {
    ctx.grid.setGridOption(
      'getContextMenuItems' as never,
      buildFormatContextMenuItems(ctx) as never,
    );
  } catch (err) {
    console.warn('[cgext] wireFormatContextMenu failed:', err);
  }
}
