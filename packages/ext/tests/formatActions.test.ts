import { describe, it, expect, vi } from 'vitest';
import {
  selectedColIds,
  applyCellStyle,
  clearCellFormatting,
  toggleBold,
  type FormatGrid,
} from '../src/toolbar/formatActions';
import type { VelocityGridExtContext } from '../src/extension/types';

function fakeGrid(overrides: Partial<FormatGrid> = {}): FormatGrid {
  return {
    getCellRanges: () => [{ colIds: ['bid', 'ask'] }],
    getFocusedCell: () => null,
    editColumn: vi.fn(),
    getTemplates: () => [
      { id: '__cgridOwn:bid', overrides: { cellStyle: { fontWeight: 'bold' } } },
    ],
    addEventListener: () => () => {},
    ...overrides,
  };
}

function fakeCtx(grid: FormatGrid): VelocityGridExtContext {
  return {
    grid,
    profiles: { markDirty: vi.fn() },
  } as unknown as VelocityGridExtContext;
}

describe('formatActions', () => {
  it('selectedColIds prefers ranges over focus', () => {
    const grid = fakeGrid();
    expect(selectedColIds(grid)).toEqual(['bid', 'ask']);
  });

  it('toggleBold flips bold on selected columns', () => {
    const grid = fakeGrid();
    const ctx = fakeCtx(grid);
    toggleBold(ctx, ['bid']);
    expect(grid.editColumn).toHaveBeenCalledWith('bid', { cellStyle: { fontWeight: 'normal' } });
  });

  it('applyCellStyle and clearCellFormatting write editColumn patches', () => {
    const grid = fakeGrid();
    const ctx = fakeCtx(grid);
    applyCellStyle(ctx, { bg: '#ff0' }, ['mid']);
    expect(grid.editColumn).toHaveBeenCalledWith('mid', { cellStyle: { bg: '#ff0' } });
    clearCellFormatting(ctx, ['mid']);
    expect(grid.editColumn).toHaveBeenCalledWith('mid', expect.objectContaining({ format: null }));
  });
});
