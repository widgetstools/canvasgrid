import { describe, expect, it } from 'vitest';
import { mergeExpressionColumnDefs } from '../src/expressionColumns';

describe('mergeExpressionColumnDefs', () => {
  it('appends expression aliases and drops prior alias defs', () => {
    const base = [
      { colId: 'ticker', field: 'ticker' as const },
      { colId: 'oldCalc', field: 'oldCalc' as const },
    ];
    const next = mergeExpressionColumnDefs(
      base,
      { newCalc: '// newCalc\n"pnl" * 2', oldCalc: '// oldCalc\n"pnl"' },
      { newCalc: { headerName: 'New Calc', width: 140 } },
    );
    expect(next.map((d) => d.colId)).toEqual(['ticker', 'newCalc', 'oldCalc']);
    expect(next.find((d) => d.colId === 'newCalc')).toMatchObject({
      headerName: 'New Calc',
      width: 140,
      cellDataType: 'number',
      aggFunc: 'sum',
    });
  });
});
