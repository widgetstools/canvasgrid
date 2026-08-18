import { describe, expect, it } from 'vitest';
import {
  compileValueGetterSrc,
  evalValueGetterSrc,
  valueGetterFnFromSrc,
} from '../../src/core/valueGetterExpr';
import { resolveColDefs } from '../../src/core/propertyChain';
import { readWorkerCellValue } from '../../src/worker/readCellValue';
import type { WorkerColumn } from '../../src/worker/protocol';

describe('compileValueGetterSrc / evalValueGetterSrc', () => {
  it('evaluates arithmetic field refs', () => {
    expect(evalValueGetterSrc('[ask] - [bid]', { ask: 10, bid: 4 })).toBe(6);
  });

  it('evaluates IF and ternary', () => {
    expect(evalValueGetterSrc('IF([qty] > 0, [pnl], 0)', { qty: 2, pnl: 12 })).toBe(12);
    expect(evalValueGetterSrc('IF([qty] > 0, [pnl], 0)', { qty: 0, pnl: 12 })).toBe(0);
    expect(evalValueGetterSrc('[desk] == "NY" ? [spread] : 0', { desk: 'NY', spread: 1.5 })).toBe(1.5);
    expect(evalValueGetterSrc('[desk] == "NY" ? [spread] : 0', { desk: 'LN', spread: 1.5 })).toBe(0);
  });

  it('returns null for invalid source', () => {
    expect(compileValueGetterSrc('IF([qty]')).toBeNull();
    expect(evalValueGetterSrc('IF([qty]', { qty: 1 })).toBeNull();
  });

  it('valueGetterFnFromSrc matches AG params shape', () => {
    const fn = valueGetterFnFromSrc<{ ask: number; bid: number }>('[ask] - [bid]');
    expect(fn({ data: { ask: 5, bid: 2 }, colId: 'spread' })).toBe(3);
  });
});

describe('resolveColDefs string valueGetter', () => {
  it('compiles the expression onto a function and keeps the source', () => {
    const resolved = resolveColDefs([{ field: 'spread', valueGetter: '[ask] - [bid]' }] as any);
    expect(resolved[0]!._valueGetterSrc).toBe('[ask] - [bid]');
    expect(typeof resolved[0]!.valueGetter).toBe('function');
    expect(resolved[0]!.valueGetter!({ data: { ask: 9, bid: 3 }, colId: 'spread' } as any)).toBe(6);
  });

  it('leaves function-form valueGetter identity intact', () => {
    const vg = (p: any) => p.data?.ask;
    const resolved = resolveColDefs([{ field: 'ask', valueGetter: vg }] as any);
    expect(resolved[0]!.valueGetter).toBe(vg);
    expect(resolved[0]!._valueGetterSrc).toBeUndefined();
  });
});

describe('readWorkerCellValue', () => {
  it('prefers valueGetter over the raw field', () => {
    const col: WorkerColumn = { colId: 'spread', field: 'spread', type: 'number', valueGetter: '[ask] - [bid]' };
    expect(readWorkerCellValue({ spread: 99, ask: 10, bid: 4 }, col)).toBe(6);
  });

  it('falls back to field when no getter', () => {
    const col: WorkerColumn = { colId: 'ticker', field: 'ticker', type: 'text' };
    expect(readWorkerCellValue({ ticker: 'AAPL' }, col)).toBe('AAPL');
  });
});
