import { describe, expect, it } from 'vitest';
import { PerspectiveBook } from '../src/book';

describe('PerspectiveBook STOMP ingest', () => {
  it('maps JSON frames onto rows the grid can read', async () => {
    const book = new PerspectiveBook({
      feed: 'stomp',
      wsUrl: 'ws://localhost:9',
      snapshotRows: 10,
    });
    await book.registerView({ id: 'v' });
    book.__ingestStompBodyForTests(JSON.stringify([
      { positionId: 'P1', desk: 'EQ', pnl: 12 },
      { positionId: 'P2', desk: 'FX', pnl: -4 },
    ]));
    book.__ingestStompBodyForTests('Success');
    const res = await book.getSsrmRows('v', { startRow: 0, endRow: 10 });
    expect(res.rowCount).toBe(2);
    expect(res.rows.map((r) => r.positionId).sort()).toEqual(['P1', 'P2']);
    book.destroy();
  });
});
