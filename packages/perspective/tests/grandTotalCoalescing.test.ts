// @vitest-environment happy-dom
/**
 * How often the footer is allowed to cost a scroll.
 *
 * `totalsView` aggregates the whole FILTERED set, and a filtered Perspective
 * view has to rescan after every table write. On a 10k-row book under a
 * 40 rows/s feed that is 120-480ms of engine time per read — measured, not
 * estimated.
 *
 * `emitViewTick` awaited a fresh one on every tick, and ticks fire about ten
 * times a second. That hands the engine more grand-total work than a second
 * contains, so the reads queue and the queue grows for as long as the feed
 * runs. A `getRows` issued mid-scroll lands behind all of it: blocks that
 * take 1-5ms on a quiet table took seconds, which is exactly what fast
 * scrolling under a quick filter looked like — blank rows that filled in a
 * few seconds after stopping.
 *
 * The grouped path had already hit this and stopped awaiting totals. These
 * tests hold the same line for flat views: a burst of callers costs ONE read,
 * and the value stays servable briefly afterwards.
 */
import { describe, it, expect, vi } from 'vitest';
import { PerspectiveBook } from '../src/book';

/** Mirrors what `mountViews` builds, with a totalsView that counts reads. */
function bookWithTotals(readDelayMs = 0) {
  let reads = 0;
  const totalsView = {
    to_json: async () => {
      reads++;
      if (readDelayMs > 0) await new Promise((r) => setTimeout(r, readDelayMs));
      return [{ __ROW_PATH__: [], pnl: reads }];
    },
  };
  const book = new PerspectiveBook({ schema: { positionId: 'string', pnl: 'float' } });
  (book as never as { views: Map<string, unknown> }).views.set('A', {
    spec: { id: 'A', label: 'A' },
    view: null, totalsView, leafView: null,
    leafRanges: null, leafRangeByPath: null, leafOffsetsUnreliable: false,
    dataUpdateCb: null, notifyTimer: null, groupBy: [],
    groupedRawCache: null, groupKeys: [], lastQuerySig: '',
    getRowsCalls: 0, rowsServed: 0, inflight: 0, projectedRows: 0,
    expressions: {}, readColumns: [], lastExtraFilter: [], lastSort: [],
    quickFilterText: '', quickFilterExpressions: {}, lastOrContains: {},
    valueAggOverrides: {}, pivotColIds: [], pivotViews: [],
    pivotKeyOrder: new Map(),
  });
  return { book, reads: () => reads };
}

describe('the grand total is computed once per burst, not once per tick', () => {
  it('ten concurrent callers cost ONE read', async () => {
    // The shape of the bug: ten ticks a second, each awaiting its own read.
    const { book, reads } = bookWithTotals(5);
    await Promise.all(Array.from({ length: 10 }, () => book.fetchGrandTotal('A')));
    expect(reads()).toBe(1);
  });

  it('concurrent callers all get the same value, not a stale default', async () => {
    const { book } = bookWithTotals(5);
    const all = await Promise.all(
      Array.from({ length: 5 }, () => book.fetchGrandTotal('A')),
    );
    for (const row of all) expect(row.pnl).toBe(1);
  });

  it('a caller just after the read still costs nothing', async () => {
    const { book, reads } = bookWithTotals();
    await book.fetchGrandTotal('A');
    await book.fetchGrandTotal('A');
    await book.fetchGrandTotal('A');
    expect(reads()).toBe(1);
  });

  it('but the total is not frozen — it recomputes once the window passes', async () => {
    // A footer that never updates is a different bug from one that costs a
    // scroll. Both are wrong.
    vi.useFakeTimers();
    try {
      const { book, reads } = bookWithTotals();
      await book.fetchGrandTotal('A');
      expect(reads()).toBe(1);
      vi.setSystemTime(Date.now() + 5_000);
      await book.fetchGrandTotal('A');
      expect(reads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a view with no totalsView answers with an empty row rather than throwing', async () => {
    const book = new PerspectiveBook({ schema: { positionId: 'string' } });
    await expect(book.fetchGrandTotal('nope')).resolves.toBeTypeOf('object');
  });
});

describe('a remount drops the cached total', () => {
  it('unregistering the view clears its entry', async () => {
    // The cached value describes a `totalsView` that no longer exists — a
    // remount changes the query, so serving it would report another
    // filter's numbers under this one's name.
    const { book } = bookWithTotals();
    await book.fetchGrandTotal('A');
    const cache = book as never as { grandTotalCache: Map<string, unknown> };
    expect(cache.grandTotalCache.has('A')).toBe(true);
    await book.unregisterView('A');
    expect(cache.grandTotalCache.has('A')).toBe(false);
  });
});
