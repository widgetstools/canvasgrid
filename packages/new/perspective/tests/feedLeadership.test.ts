import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedLeadership } from '../src/feedLeadership';
import {
  clearSharedFeedStop,
  feedStopStorageKey,
  isSharedFeedStopped,
  writeSharedFeedStop,
} from '../src/feedEpoch';
import { PerspectiveBook } from '../src/book';

describe('FeedLeadership', () => {
  it('dedicated / non-shared always wins tryLead', async () => {
    const lead = new FeedLeadership({
      lockName: 'test:feed:a',
      sharedTable: false,
      isDestroyed: () => false,
      isFeedStopped: () => false,
      onTakeover: () => undefined,
      hasWebLocks: () => false,
    });
    expect(await lead.tryLead()).toBe(true);
    expect(lead.getRole()).toBe('leader');
  });

  it('queueTakeover invokes resume callback when lock granted', async () => {
    type LockCb = (lock: { name: string } | null) => Promise<void>;
    const locks = {
      request: vi.fn((
        _name: string,
        optsOrCb: { ifAvailable?: boolean } | LockCb,
        maybeCb?: LockCb,
      ) => {
        const ifAvailable = typeof optsOrCb === 'object' && !!optsOrCb.ifAvailable;
        const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb)!;
        if (ifAvailable) {
          return cb(null);
        }
        return cb({ name: 'lock' });
      }),
    };
    vi.stubGlobal('navigator', { locks });

    const takeovers: number[] = [];
    const lead = new FeedLeadership({
      lockName: 'test:feed:b',
      sharedTable: true,
      isDestroyed: () => false,
      isFeedStopped: () => false,
      onTakeover: () => { takeovers.push(1); },
      hasWebLocks: () => true,
    });
    expect(await lead.tryLead()).toBe(false);
    lead.queueTakeover();
    // queueTakeover's request callback holds the lock via awaiting release —
    // onTakeover runs synchronously before that await.
    expect(takeovers.length).toBe(1);
    expect(lead.getRole()).toBe('leader');
    lead.release();
    vi.unstubAllGlobals();
  });
});

describe('stop epoch before unlock', () => {
  const schemaKey = 'test-stop-epoch';

  afterEach(() => {
    clearSharedFeedStop(schemaKey);
    try { localStorage.removeItem(feedStopStorageKey(schemaKey)); } catch { /* */ }
  });

  it('stopFeed writes localStorage epoch before releasing leadership', async () => {
    const events: string[] = [];
    const book = new PerspectiveBook({
      schemaKey,
      snapshotRows: 5,
      sharedTable: false,
    });
    await book.registerView({ id: 'v1' });
    await book.connect();
    await new Promise((r) => setTimeout(r, 30));
    expect(book.getLocalRowCount()).toBe(5);

    const releaseSpy = vi.spyOn(
      (book as unknown as { leadership: { release: () => void } }).leadership,
      'release',
    ).mockImplementation(() => {
      events.push('unlock');
      expect(isSharedFeedStopped(schemaKey)).toBe(true);
    });

    book.stopFeed();
    expect(events).toContain('unlock');
    expect(isSharedFeedStopped(schemaKey)).toBe(true);
    expect(book.getPhase()).toBe('disconnected');
    releaseSpy.mockRestore();
    book.destroy();
  });

  it('resumeLiveFeed does not clear the book', async () => {
    const book = new PerspectiveBook({ schemaKey, snapshotRows: 8 });
    await book.registerView({ id: 'v1' });
    await book.connect();
    await new Promise((r) => setTimeout(r, 30));
    const n = book.getLocalRowCount();
    book.resumeLiveFeed();
    expect(book.getLocalRowCount()).toBe(n);
    expect(book.getPhase()).toBe('live');
    book.destroy();
  });

  it('writeSharedFeedStop is readable cross-tab style', () => {
    writeSharedFeedStop(schemaKey, 3);
    expect(isSharedFeedStopped(schemaKey)).toBe(true);
    clearSharedFeedStop(schemaKey);
    expect(isSharedFeedStopped(schemaKey)).toBe(false);
  });
});
