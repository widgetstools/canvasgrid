import { describe, it, expect } from 'vitest';
import { POSITION_COLUMNS } from '../src/positionColumns';

/**
 * Pivot / row-group / value opt-ins on the curated positions columns.
 *
 * These flags are what the Columns tool panel consults before accepting a
 * drag: `isColumnPivotEnabled` gates the Column Labels zone,
 * `isColumnValueEnabled` gates Values, `enableRowGroup` gates Row Groups.
 *
 * `enablePivot` was missing here, so Column Labels rejected every column.
 * Turning Pivot Mode on then hid the primary columns with no pivot columns
 * to replace them, leaving only the auto-group column — which reads as
 * "values are never visible in the grid". Nothing in the pivot engine was
 * wrong; the columns simply never opted in.
 */

const DIMENSIONS = ['ticker', 'desk', 'region', 'instrumentType'];
const MEASURES = ['notionalAmount', 'marketValue', 'pnl', 'dailyPnl'];

function col(colId: string) {
  const c = POSITION_COLUMNS.find((d) => d.colId === colId);
  expect(c, `missing column ${colId}`).toBeDefined();
  return c!;
}

describe('POSITION_COLUMNS — panel opt-ins', () => {
  it.each(DIMENSIONS)('%s is pivotable (Column Labels accepts it)', (colId) => {
    expect(col(colId).enablePivot).toBe(true);
  });

  it.each(DIMENSIONS)('%s is row-groupable', (colId) => {
    expect(col(colId).enableRowGroup).toBe(true);
  });

  it.each(MEASURES)('%s is a value column with an aggFunc', (colId) => {
    const c = col(colId);
    expect(c.enableValue).toBe(true);
    // Values need an aggregation or they cannot aggregate on group rows.
    expect(c.aggFunc).toBeDefined();
  });

  it('offers at least one pivotable AND one value column', () => {
    // Pivot needs both axes: without either, pivot mode produces an empty
    // matrix and hides the primaries — a blank grid.
    expect(POSITION_COLUMNS.some((c) => c.enablePivot === true)).toBe(true);
    expect(POSITION_COLUMNS.some((c) => c.enableValue === true)).toBe(true);
  });
});
