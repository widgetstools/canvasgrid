/**
 * Which grids share a book.
 *
 * Sharing is the point of the book cache — several grids on a page reading one
 * provider should hit one table and one feed. But sharing is only correct when
 * they are reading the SAME ROWS, and the key used to decide that folded the
 * `providerId` and the schema alone.
 *
 * A catalog entry resolves, through AppData tokens like `{{session.trader}}`
 * and per-app overlays, to a broker and a topic. Two grids naming one provider
 * can land on different ones. With those dropped from the key the second grid
 * silently adopted the first's book and showed another topic's rows under its
 * own name — no error, no warning, just other people's data.
 */
import { describe, it, expect } from 'vitest';
import { bookCacheKey } from '../src/provider';

const base = {
  providerId: 'positions',
  wsUrl: 'ws://broker-a:8081',
  snapshotTopic: '/snapshot/positions/desk-1',
  schema: { positionId: 'string', pnl: 'float' },
  keyColumn: 'positionId',
} as never;

const withField = (over: Record<string, unknown>) => ({ ...(base as object), ...over } as never);

describe('two grids share a book when they read the same rows', () => {
  it('same provider, same endpoint, same schema → one book', () => {
    expect(bookCacheKey(base)).toBe(bookCacheKey(withField({})));
  });

  it('several grids on a page still converge — the sharing this exists for', () => {
    const keys = [1, 2, 3].map(() => bookCacheKey(withField({})));
    expect(new Set(keys).size).toBe(1);
  });
});

describe('and not when they read different rows', () => {
  it('a different resolved topic splits them', () => {
    // The reported case: one providerId, two desks, two topics.
    expect(bookCacheKey(withField({ snapshotTopic: '/snapshot/positions/desk-2' })))
      .not.toBe(bookCacheKey(base));
  });

  it('a different broker splits them', () => {
    expect(bookCacheKey(withField({ wsUrl: 'ws://broker-b:8081' })))
      .not.toBe(bookCacheKey(base));
  });

  it('a different schema splits them', () => {
    expect(bookCacheKey(withField({ schema: { positionId: 'string', pnl: 'float', extra: 'string' } })))
      .not.toBe(bookCacheKey(base));
  });

  it('a different clientId splits them when it is what names the topic', () => {
    const noTopic = withField({ snapshotTopic: undefined, clientId: 'desk-1' });
    const other = withField({ snapshotTopic: undefined, clientId: 'desk-2' });
    expect(bookCacheKey(noTopic)).not.toBe(bookCacheKey(other));
  });
});

describe('delivery tuning does NOT split a book', () => {
  // These change how the same rows are paced, not which rows arrive. Splitting
  // on them would break the sharing the cache exists to provide; where two
  // callers disagree the first wins and the worker feed reports the mismatch.
  it.each([
    ['rate', { rate: 80 }],
    ['batchSize', { batchSize: 500 }],
    ['updatesPerTick', { updatesPerTick: 25 }],
    ['snapshotRows', { snapshotRows: 50_000 }],
  ])('%s is not part of the identity', (_name, over) => {
    expect(bookCacheKey(withField(over))).toBe(bookCacheKey(base));
  });
});

describe('without a providerId', () => {
  it('every config field participates, since there is no shared name to mean anything else', () => {
    const anon = { ...(base as object), providerId: undefined } as never;
    const slower = { ...(anon as object), rate: 80 } as never;
    // No provider id means no claim that these are the same logical source, so
    // the conservative key is the right one.
    expect(bookCacheKey(slower)).not.toBe(bookCacheKey(anon));
  });
});
