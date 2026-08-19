import { describe, expect, it } from 'vitest';
import { columnDefinitionsToGridDefs, columnDefinitionsToPerspectiveSchema } from '../src/mapFromDataProvider';

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

describe('columnDefinitionsToPerspectiveSchema composite-key collision', () => {
  it('throws when a composite keyColumn synthesizes an index field that collides with a real column', () => {
    const cols = [
      { field: 'desk', cellDataType: 'text' as const },
      { field: 'book', cellDataType: 'text' as const },
      // Real, distinct field that happens to share the synthesized name.
      { field: 'desk_book', cellDataType: 'number' as const },
    ];
    expect(() => columnDefinitionsToPerspectiveSchema(cols, ['desk', 'book']))
      .toThrow(/desk_book/);
  });

  it('does not throw for a single-field keyColumn even though the column itself is named after it', () => {
    const cols = [
      { field: 'positionId', cellDataType: 'text' as const },
      { field: 'ticker', cellDataType: 'text' as const },
    ];
    expect(() => columnDefinitionsToPerspectiveSchema(cols, 'positionId')).not.toThrow();
  });

  it('does not throw for a composite keyColumn when no real column collides', () => {
    const cols = [
      { field: 'desk', cellDataType: 'text' as const },
      { field: 'book', cellDataType: 'text' as const },
      { field: 'notional', cellDataType: 'number' as const },
    ];
    const schema = columnDefinitionsToPerspectiveSchema(cols, ['desk', 'book']);
    expect(schema.desk_book).toBe('string');
    expect(schema.notional).toBe('float');
  });
});
