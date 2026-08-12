/**
 * PORT-NOTE: NOT a copied legacy test — added by the worker port.
 *
 * The pivot-result colId grammar is a WIRE FORMAT: the main thread's column
 * synthesis encodes the colId, the worker's SortPass decodes it. If the two
 * ends disagree there is no error, just a sort on a pivot-result column that
 * silently stops working, because `decodePivotResultColumnId` returns null and
 * SortPass falls through to its ordinary path.
 *
 * `src/core/pivotColumns.ts` is the single owner of the grammar (as in legacy,
 * where SortPass reached into `../../core/pivotColumns` for the decoder). This
 * pins the encoding shape and the encode/decode round trips so a change to
 * either end is a red test instead of a silent feature loss.
 */
import { describe, it, expect } from 'vitest';
import {
  pivotResultColumnId,
  decodePivotResultColumnId,
  pivotRowTotalColumnId,
  decodePivotRowTotalColumnId,
  isPivotResultColumnId,
  isPivotRowTotalColumnId,
  PIVOT_RESULT_COL_PREFIX,
  PIVOT_ROW_TOTAL_COL_PREFIX,
} from '../src/core/pivotColumns';

/** The separator is module-private; the tests spell it out so a change to it
 *  fails here rather than silently redefining the wire format. */
const SEP = '\u0001';

const PATHS: string[][] = [
  ['EMEA'],
  ['EMEA', 'Rates'],
  ['EMEA', 'Rates', '2026-Q1'],
  [''],
  ['a:b', 'c::d'],
];

describe('pivot colId grammar — src/core/pivotColumns', () => {
  it('encodes result colIds as prefix + path segments + value colId', () => {
    expect(pivotResultColumnId(['EMEA'], 'pnl'))
      .toBe(`${PIVOT_RESULT_COL_PREFIX}${SEP}EMEA${SEP}pnl`);
    expect(pivotResultColumnId(['EMEA', 'Rates'], 'pnl'))
      .toBe(`${PIVOT_RESULT_COL_PREFIX}${SEP}EMEA${SEP}Rates${SEP}pnl`);
  });

  it('encodes row-total colIds as prefix + value colId', () => {
    expect(pivotRowTotalColumnId('pnl'))
      .toBe(`${PIVOT_ROW_TOTAL_COL_PREFIX}${SEP}pnl`);
  });

  it('round-trips every pivot path through encode → decode', () => {
    for (const path of PATHS) {
      const id = pivotResultColumnId(path, 'pnl');
      expect(decodePivotResultColumnId(id)).toEqual({ pivotPath: path, valueColId: 'pnl' });
    }
    expect(decodePivotRowTotalColumnId(pivotRowTotalColumnId('pnl'))).toBe('pnl');
  });

  it('classifies which ids are synthetic, and decodes nothing out of the rest', () => {
    const cases: Array<{ id: string; result: boolean; rowTotal: boolean }> = [
      { id: pivotResultColumnId(['EMEA'], 'pnl'), result: true, rowTotal: false },
      { id: pivotRowTotalColumnId('pnl'), result: false, rowTotal: true },
      { id: 'pnl', result: false, rowTotal: false },
      // Bare prefixes with no separator are ordinary colIds, not synthetics.
      { id: PIVOT_RESULT_COL_PREFIX, result: false, rowTotal: false },
      { id: PIVOT_ROW_TOTAL_COL_PREFIX, result: false, rowTotal: false },
      { id: '', result: false, rowTotal: false },
    ];
    for (const { id, result, rowTotal } of cases) {
      expect(isPivotResultColumnId(id)).toBe(result);
      expect(isPivotRowTotalColumnId(id)).toBe(rowTotal);
    }
    for (const id of ['pnl', PIVOT_RESULT_COL_PREFIX, '', pivotRowTotalColumnId('pnl')]) {
      expect(decodePivotResultColumnId(id)).toBeNull();
    }
    for (const id of ['pnl', PIVOT_ROW_TOTAL_COL_PREFIX, '', pivotResultColumnId(['EMEA'], 'pnl')]) {
      expect(decodePivotRowTotalColumnId(id)).toBeNull();
    }
    // Prefix + a single segment cannot name both a path and a value column.
    expect(decodePivotResultColumnId(pivotResultColumnId([], 'pnl'))).toBeNull();
  });
});
