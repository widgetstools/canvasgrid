/**
 * PORT-NOTE: NOT a copied legacy test — added by the worker port.
 *
 * The pivot-result colId grammar exists twice in the rebuild: the worker's
 * copy at `src/worker/interop/pivotColumnIds.ts` (used by SortPass) and
 * `src/core/pivotColumns.ts` (used by main-thread column synthesis). The
 * duplication is deliberate — core already imports the worker's pivotPass, so
 * importing back the other way would close a cycle — but the grammar is a
 * WIRE FORMAT: main encodes the colId, the worker decodes it. If the two drift
 * there is no error, just a sort on a pivot-result column that silently stops
 * working, because `decodePivotResultColumnId` returns null and SortPass falls
 * through to its ordinary path.
 *
 * This pins them together so the drift is a red test instead of a silent
 * feature loss.
 */
import { describe, it, expect } from 'vitest';
import {
  pivotResultColumnId as workerEncode,
  decodePivotResultColumnId as workerDecode,
  pivotRowTotalColumnId as workerEncodeRowTotal,
  decodePivotRowTotalColumnId as workerDecodeRowTotal,
  isPivotResultColumnId as workerIsResult,
  isPivotRowTotalColumnId as workerIsRowTotal,
} from '../src/worker/interop/pivotColumnIds';
import {
  pivotResultColumnId as coreEncode,
  decodePivotResultColumnId as coreDecode,
  pivotRowTotalColumnId as coreEncodeRowTotal,
  decodePivotRowTotalColumnId as coreDecodeRowTotal,
  isPivotResultColumnId as coreIsResult,
  isPivotRowTotalColumnId as coreIsRowTotal,
} from '../src/core/pivotColumns';

const PATHS: string[][] = [
  ['EMEA'],
  ['EMEA', 'Rates'],
  ['EMEA', 'Rates', '2026-Q1'],
  [''],
  ['a:b', 'c::d'],
];

describe('pivot colId grammar — worker copy vs src/core copy', () => {
  it('encodes result colIds identically', () => {
    for (const path of PATHS) {
      expect(workerEncode(path, 'pnl')).toBe(coreEncode(path, 'pnl'));
    }
  });

  it('encodes row-total colIds identically', () => {
    expect(workerEncodeRowTotal('pnl')).toBe(coreEncodeRowTotal('pnl'));
  });

  it('each copy decodes what the other encodes', () => {
    for (const path of PATHS) {
      expect(workerDecode(coreEncode(path, 'pnl'))).toEqual({ pivotPath: path, valueColId: 'pnl' });
      expect(coreDecode(workerEncode(path, 'pnl'))).toEqual({ pivotPath: path, valueColId: 'pnl' });
    }
    expect(workerDecodeRowTotal(coreEncodeRowTotal('pnl'))).toBe('pnl');
    expect(coreDecodeRowTotal(workerEncodeRowTotal('pnl'))).toBe('pnl');
  });

  it('agrees on which ids are synthetic', () => {
    const ids = [
      workerEncode(['EMEA'], 'pnl'),
      workerEncodeRowTotal('pnl'),
      'pnl',
      'pivotcol',
      'pivotrowtotal',
      '',
    ];
    for (const id of ids) {
      expect(workerIsResult(id)).toBe(coreIsResult(id));
      expect(workerIsRowTotal(id)).toBe(coreIsRowTotal(id));
    }
  });
});
