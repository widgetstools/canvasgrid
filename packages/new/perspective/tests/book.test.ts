import { describe, expect, it } from 'vitest';
import { PerspectiveBook } from '../src/book';
import { clearSharedFeedStop, isSharedFeedStopped, writeSharedFeedStop } from '../src/feedEpoch';

describe('PerspectiveBook feed epoch', () => {
  it('stop writes shared epoch and blocks connect', () => {
    const key = `test-${Date.now()}`;
    clearSharedFeedStop(key);
    const book = new PerspectiveBook({ schemaKey: key, snapshotRows: 10 });
    book.stopFeed();
    expect(book.isFeedStopped()).toBe(true);
    expect(isSharedFeedStopped(key)).toBe(true);
    book.connect();
    expect(book.getPhase()).toBe('disconnected');
    book.restartFeed();
    expect(book.isFeedStopped()).toBe(false);
    clearSharedFeedStop(key);
  });

  it('filter ops include ends with / not contains and fail closed', () => {
    expect(PerspectiveBook.rowMatchesFilterOp('ends with', 'Apple', 'le')).toBe(true);
    expect(PerspectiveBook.rowMatchesFilterOp('not contains', 'Apple', 'zz')).toBe(true);
    expect(PerspectiveBook.rowMatchesFilterOp('not contains', 'Apple', 'pp')).toBe(false);
    expect(PerspectiveBook.rowMatchesFilterOp('unknown', 'x', 'y')).toBe(false);
  });

  it('resumeLiveFeed does not clear snapshot', async () => {
    const book = new PerspectiveBook({ snapshotRows: 20 });
    book.connect();
    const before = await book.getSsrmRows('v', { startRow: 0, endRow: 5 });
    expect(before.rowCount).toBe(20);
    book.resumeLiveFeed();
    const after = await book.getSsrmRows('v', { startRow: 0, endRow: 5 });
    expect(after.rowCount).toBe(20);
    book.destroy();
  });
});

describe('feedEpoch helpers', () => {
  it('round-trips', () => {
    const key = `epoch-${Date.now()}`;
    writeSharedFeedStop(key, 1);
    expect(isSharedFeedStopped(key)).toBe(true);
    clearSharedFeedStop(key);
    expect(isSharedFeedStopped(key)).toBe(false);
  });
});
