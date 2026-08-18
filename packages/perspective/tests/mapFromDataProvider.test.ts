import { describe, expect, it } from 'vitest';
import { columnDefinitionsToGridDefs } from '../src/mapFromDataProvider';

describe('columnDefinitionsToGridDefs valueGetter', () => {
  it('copies a trimmed expression onto the grid colDef', () => {
    const defs = columnDefinitionsToGridDefs([
      { field: 'spread', headerName: 'Spread', cellDataType: 'number', valueGetter: '  [ask] - [bid]  ' },
      { field: 'ticker', headerName: 'Ticker' },
    ]);
    expect(defs[0]!.valueGetter).toBe('[ask] - [bid]');
    expect(defs[1]!.valueGetter).toBeUndefined();
  });

  it('skips blank valueGetter strings', () => {
    const defs = columnDefinitionsToGridDefs([
      { field: 'ticker', valueGetter: '   ' },
    ]);
    expect(defs[0]!.valueGetter).toBeUndefined();
  });
});
