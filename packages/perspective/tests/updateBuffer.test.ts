import { describe, expect, it } from 'vitest';
import { boundUpdateBuffer, updateBufferCap } from '../src/updateBuffer';

describe('boundUpdateBuffer', () => {
  it('returns the same array when under the cap', () => {
    const rows = [
      { tradeId: 'a', n: 1 },
      { tradeId: 'b', n: 2 },
    ];
    expect(boundUpdateBuffer(rows, 10, 'tradeId')).toBe(rows);
  });

  it('keeps the latest row per configured key when over the cap', () => {
    const rows = [
      { tradeId: 'a', n: 1 },
      { tradeId: 'b', n: 1 },
      { tradeId: 'a', n: 2 },
      { tradeId: 'c', n: 1 },
      { tradeId: 'b', n: 2 },
    ];
    expect(boundUpdateBuffer(rows, 3, 'tradeId')).toEqual([
      { tradeId: 'a', n: 2 },
      { tradeId: 'c', n: 1 },
      { tradeId: 'b', n: 2 },
    ]);
  });

  it('coalesces on a composite keyColumn', () => {
    const rows = [
      { desk: 'A', book: '1', n: 1 },
      { desk: 'A', book: '2', n: 1 },
      { desk: 'A', book: '1', n: 2 },
      { desk: 'B', book: '1', n: 1 },
      { desk: 'A', book: '2', n: 9 }, // push length over cap
    ];
    expect(boundUpdateBuffer(rows, 3, ['desk', 'book'])).toEqual([
      { desk: 'A', book: '1', n: 2 },
      { desk: 'B', book: '1', n: 1 },
      { desk: 'A', book: '2', n: 9 },
    ]);
  });

  it('trims to the most recently seen keys when unique count exceeds cap', () => {
    const rows = [
      { id: 'a', n: 1 },
      { id: 'b', n: 1 },
      { id: 'c', n: 1 },
      { id: 'd', n: 1 },
      { id: 'e', n: 1 },
    ];
    expect(boundUpdateBuffer(rows, 2, 'id')).toEqual([
      { id: 'd', n: 1 },
      { id: 'e', n: 1 },
    ]);
  });

  it('skips rows missing any composite key part when capping', () => {
    const rows = [
      { desk: 'A', book: '1', n: 1 },
      { desk: 'A', n: 2 },
      { desk: 'B', book: '1', n: 3 },
      { desk: 'A', book: '1', n: 4 },
      { desk: 'C', book: '9', n: 5 },
    ];
    expect(boundUpdateBuffer(rows, 2, ['desk', 'book'])).toEqual([
      { desk: 'A', book: '1', n: 4 },
      { desk: 'C', book: '9', n: 5 },
    ]);
  });

  it('returns empty for non-positive caps', () => {
    expect(boundUpdateBuffer([{ id: 'a', n: 1 }], 0, 'id')).toEqual([]);
  });
});

describe('updateBufferCap', () => {
  it('uses a higher floor during snapshot', () => {
    const live = updateBufferCap({ snapshotComplete: true, batchSize: 200, snapshotRows: 10_000 });
    const snap = updateBufferCap({ snapshotComplete: false, batchSize: 200, snapshotRows: 10_000 });
    expect(snap).toBeGreaterThan(live);
    expect(live).toBe(Math.max(200 * 40, 2_500));
    expect(snap).toBe(Math.max(200 * 40, 20_000, 5_000));
  });
});
