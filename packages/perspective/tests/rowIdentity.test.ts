import { describe, expect, it } from 'vitest';
import { resolveTableIndexField, rowIdentity } from '../src/rowIdentity';

describe('resolveTableIndexField', () => {
  it('uses a single keyColumn as the table index', () => {
    expect(resolveTableIndexField('tradeId')).toBe('tradeId');
  });

  it('unwraps a one-element key array', () => {
    expect(resolveTableIndexField(['orderId'])).toBe('orderId');
  });

  it('derives a composite carrier field from key names', () => {
    expect(resolveTableIndexField(['desk', 'book'])).toBe('desk_book');
  });

  it('throws when keyColumn is empty', () => {
    expect(() => resolveTableIndexField([])).toThrow(/keyColumn is required/);
  });
});

describe('rowIdentity', () => {
  it('reads a single key field', () => {
    expect(rowIdentity({ tradeId: 'T1', n: 1 }, 'tradeId')).toBe('T1');
  });

  it('composes a composite key', () => {
    expect(rowIdentity({ desk: 'A', book: '1' }, ['desk', 'book']))
      .toBe(['A', '1'].join('\u001F'));
  });

  it('returns null when a composite part is missing', () => {
    expect(rowIdentity({ desk: 'A' }, ['desk', 'book'])).toBeNull();
  });
});
