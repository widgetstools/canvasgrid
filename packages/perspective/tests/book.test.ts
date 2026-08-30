import { describe, expect, it, vi } from 'vitest';
import { PerspectiveBook, mergeLiveBatch, type ViewTick } from '../src/book';
import type { PositionRow } from '../src/bootstrap';

// Minimal BoundView fixture — mirrors the shape `mountViews` builds, so
// tests exercise the real `emitViewTick` / `unregisterView` code paths
// (not a reimplementation of them) without needing a real Perspective
// WASM Table/View. `book.ts`'s own `BoundView` interface isn't exported;
// tests reach it structurally via `(book as any).views.set(...)`.
function makeBoundView(id: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    spec: { id, label: id },
    view: null,
    totalsView: null,
    leafView: null,
    leafRanges: null,
    leafRangeByPath: null,
    leafOffsetsUnreliable: false,
    dataUpdateCb: null,
    notifyTimer: null,
    // Grouped so `emitViewTick` takes the early-return branch that never
    // touches `fetchGrandTotal` / the (WASM-backed) totalsView.
    groupBy: ['desk'],
    groupedRawCache: null,
    groupKeys: [],
    lastQuerySig: '',
    getRowsCalls: 0,
    rowsServed: 0,
    inflight: 0,
    projectedRows: 0,
    expressions: {},
    readColumns: [],
    lastExtraFilter: [],
    lastSort: [],
    quickFilterText: '',
    quickFilterExpressions: {},
    lastOrContains: {},
    valueAggOverrides: {},
    pivotColIds: [],
    pivotViews: [],
    pivotKeyOrder: new Map(),
    ...overrides,
  };
}

describe('mergeLiveBatch', () => {
  it('returns incoming rows as-is when existing is empty', () => {
    const incoming: PositionRow[] = [{ positionId: 'a' }];
    expect(mergeLiveBatch([], incoming, 'positionId')).toEqual(incoming);
  });

  it('keeps the latest row per id, unioning existing + incoming (LWW)', () => {
    const existing: PositionRow[] = [{ positionId: 'a', pnl: 1 }, { positionId: 'b', pnl: 1 }];
    const incoming: PositionRow[] = [{ positionId: 'a', pnl: 2 }, { positionId: 'c', pnl: 1 }];
    expect(mergeLiveBatch(existing, incoming, 'positionId')).toEqual([
      { positionId: 'a', pnl: 2 },
      { positionId: 'b', pnl: 1 },
      { positionId: 'c', pnl: 1 },
    ]);
  });

  it('supports a composite keyColumn', () => {
    const existing: PositionRow[] = [{ positionId: 'x', desk: 'A', book: '1', pnl: 1 } as PositionRow];
    const incoming: PositionRow[] = [
      { positionId: 'x', desk: 'A', book: '1', pnl: 2 } as PositionRow,
      { positionId: 'y', desk: 'B', book: '2', pnl: 1 } as PositionRow,
    ];
    expect(mergeLiveBatch(existing, incoming, ['desk', 'book'])).toEqual([
      { positionId: 'x', desk: 'A', book: '1', pnl: 2 },
      { positionId: 'y', desk: 'B', book: '2', pnl: 1 },
    ]);
  });
});

describe('PerspectiveBook composite keyColumn collision (constructor)', () => {
  it('throws when a composite keyColumn synthesizes an index field colliding with a schema column', () => {
    expect(() => new PerspectiveBook({
      keyColumn: ['desk', 'book'],
      schema: { desk: 'string', book: 'string', desk_book: 'float' },
    })).toThrow(/desk_book/);
  });

  it('does not throw when the synthesized index field has no schema collision', () => {
    expect(() => new PerspectiveBook({
      keyColumn: ['desk', 'book'],
      schema: { desk: 'string', book: 'string', notional: 'float' },
    })).not.toThrow();
  });

  it('does not throw for a single-field keyColumn (the field IS the index, not a collision)', () => {
    expect(() => new PerspectiveBook({
      keyColumn: 'positionId',
      schema: { positionId: 'string', ticker: 'string' },
    })).not.toThrow();
  });
});

// [HIGH] a single view's remount used to clear the WHOLE book's shared
// `pendingLiveBatch`, silently dropping every other view's queued live
// ticks. Fixed by keying pendingLiveBatch per viewId.
describe('per-view pending live batch isolation (book.ts)', () => {
  it('clearing one view\'s pending batch (as remountDataView does) does not drop another view\'s queue', async () => {
    const ticks: ViewTick[] = [];
    const book = new PerspectiveBook({
      schema: { positionId: 'string', desk: 'string' },
      onViewTick: (t) => ticks.push(t),
    });
    (book as any).views.set('A', makeBoundView('A'));
    (book as any).views.set('B', makeBoundView('B'));

    const rowsA: PositionRow[] = [{ positionId: 'p1', desk: 'X' }];
    const rowsB: PositionRow[] = [{ positionId: 'p2', desk: 'Y' }];
    (book as any).pendingLiveBatch.set('A', rowsA);
    (book as any).pendingLiveBatch.set('B', rowsB);

    // Exactly what remountDataView now does for a single remounting view.
    (book as any).pendingLiveBatch.delete('A');

    await (book as any).emitViewTick('A');
    await (book as any).emitViewTick('B');

    expect(ticks.find((t) => t.viewId === 'A')?.updates).toEqual([]);
    expect(ticks.find((t) => t.viewId === 'B')?.updates).toEqual(rowsB);
  });

  it('flushUpdates merges a successful live batch into every registered view\'s own queue', async () => {
    const fakeTable = { update: vi.fn(async () => {}), size: vi.fn(async () => 0) };
    const book = new PerspectiveBook({ schema: { positionId: 'string' } });
    (book as any).table = fakeTable;
    (book as any).snapshotComplete = true;
    (book as any).views.set('A', makeBoundView('A'));
    (book as any).views.set('B', makeBoundView('B'));

    (book as any).enqueueUpdates([{ positionId: 'p1' }]);
    await (book as any).flushUpdates();

    expect((book as any).pendingLiveBatch.get('A')).toEqual([{ positionId: 'p1' }]);
    expect((book as any).pendingLiveBatch.get('B')).toEqual([{ positionId: 'p1' }]);
  });

  it('unregisterView drops only that view\'s pending batch entry', async () => {
    const book = new PerspectiveBook({ schema: { positionId: 'string' } });
    (book as any).views.set('A', makeBoundView('A'));
    (book as any).views.set('B', makeBoundView('B'));
    (book as any).pendingLiveBatch.set('A', [{ positionId: 'p1' }]);
    (book as any).pendingLiveBatch.set('B', [{ positionId: 'p2' }]);

    await book.unregisterView('A');

    expect((book as any).pendingLiveBatch.has('A')).toBe(false);
    expect((book as any).pendingLiveBatch.get('B')).toEqual([{ positionId: 'p2' }]);
  });
});

// [MEDIUM] a wedged table.update() used to retry immediately (via
// flushQueued re-arm) on every subsequent flush, spamming console.error
// forever. Fixed with a fixed-step backoff gated on consecutiveFlushFailures.
describe('flushUpdates backoff on persistent failure', () => {
  it('suppresses retries until the backoff window elapses, then retries', async () => {
    vi.useFakeTimers();
    try {
      let updateCalls = 0;
      const fakeTable = {
        update: vi.fn(async () => { updateCalls++; throw new Error('wedged'); }),
        size: vi.fn(async () => 0),
      };
      const phases: string[] = [];
      const book = new PerspectiveBook({
        schema: { positionId: 'string' },
        onPhase: (p) => phases.push(p),
      });
      (book as any).table = fakeTable;
      (book as any).snapshotComplete = true;

      (book as any).enqueueUpdates([{ positionId: 'p1' }]);
      await (book as any).flushUpdates();
      expect(updateCalls).toBe(1);
      expect(phases).toContain('error');

      // A live row arrives immediately after — the ordinary (non-force)
      // retry path must be a no-op while backed off, not hit the table again.
      (book as any).enqueueUpdates([{ positionId: 'p2' }]);
      await (book as any).flushUpdates();
      expect(updateCalls).toBe(1);

      // Past the first backoff step, the next ordinary flush retries.
      vi.advanceTimersByTime(1_000);
      await (book as any).flushUpdates();
      expect(updateCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the failure count (and backoff step) after a successful flush', async () => {
    vi.useFakeTimers();
    try {
      let shouldFail = true;
      let updateCalls = 0;
      const fakeTable = {
        update: vi.fn(async () => {
          updateCalls++;
          if (shouldFail) throw new Error('wedged');
        }),
        size: vi.fn(async () => 0),
      };
      const book = new PerspectiveBook({ schema: { positionId: 'string' } });
      (book as any).table = fakeTable;
      (book as any).snapshotComplete = true;

      (book as any).enqueueUpdates([{ positionId: 'p1' }]);
      await (book as any).flushUpdates();
      expect(updateCalls).toBe(1);
      expect((book as any).consecutiveFlushFailures).toBe(1);

      vi.advanceTimersByTime(1_000);
      shouldFail = false;
      (book as any).enqueueUpdates([{ positionId: 'p2' }]);
      await (book as any).flushUpdates();
      expect(updateCalls).toBe(2);
      expect((book as any).consecutiveFlushFailures).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// [MEDIUM] `await flushUpdates(true)` at the snapshot-end token used to
// return as soon as it was QUEUED behind an in-flight flush, not once the
// queued rows were actually applied — snapshotComplete/phase=live could
// fire while the last chunk was still buffered.
describe('flushUpdates(force) waits for the full in-flight drain', () => {
  it('does not resolve until a batch queued behind an in-flight flush is actually applied', async () => {
    let resolveFirst!: () => void;
    let updateCalls = 0;
    const fakeTable = {
      update: vi.fn(async () => {
        updateCalls++;
        if (updateCalls === 1) {
          await new Promise<void>((resolve) => { resolveFirst = resolve; });
        }
      }),
      size: vi.fn(async () => 0),
    };
    const book = new PerspectiveBook({ schema: { positionId: 'string' } });
    (book as any).table = fakeTable;
    (book as any).snapshotComplete = true;

    (book as any).enqueueUpdates([{ positionId: 'p1' }]);
    const firstFlush: Promise<void> = (book as any).flushUpdates();

    // Let the first round actually reach table.update() and start awaiting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateCalls).toBe(1);

    (book as any).enqueueUpdates([{ positionId: 'p2' }]);
    const forceFlush: Promise<void> = (book as any).flushUpdates(true);
    let forceResolved = false;
    void forceFlush.then(() => { forceResolved = true; });

    // Force call must still be pending — it was queued, not yet applied.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forceResolved).toBe(false);
    expect(updateCalls).toBe(1);

    // Unblock the first table.update() — the SAME in-flight loop must then
    // pick up the queued second batch before either promise settles.
    resolveFirst();
    await firstFlush;
    await forceFlush;

    expect(forceResolved).toBe(true);
    expect(updateCalls).toBe(2);
  });
});

// [MEDIUM] a WASM boot failure inside `ensureTable()` used to become an
// unhandled rejection with the book stuck at 'idle'/'bootstrapping' —
// `setPhase('error')` never fired, unlike the `connectSeed` sibling path.
describe('WASM boot failure surfaces phase=error (book.ts)', () => {
  it('connectRouted sets phase=error when ensureTable rejects', async () => {
    const phases: string[] = [];
    const book = new PerspectiveBook({
      schema: { positionId: 'string' },
      feed: 'seed',
      onPhase: (p) => phases.push(p),
    });
    (book as any).ensureTable = () => Promise.reject(new Error('wasm init failed'));

    await (book as any).connectRouted();

    expect(book.getPhase()).toBe('error');
    expect(phases).toContain('error');
  });

  it('activateStomp sets phase=error when ensureTable rejects', async () => {
    const book = new PerspectiveBook({ schema: { positionId: 'string' }, feed: 'stomp' });
    (book as any).ensureTable = () => Promise.reject(new Error('wasm init failed'));

    (book as any).activateStomp();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(book.getPhase()).toBe('error');
  });
});

describe('flat-view ticks carry grand totals that nothing refreshes on their own', () => {
  /**
   * Regression: an ungrouped view on the feed leader takes the cheap patch
   * path — `refreshSsrm: false` — so `getRows` is never re-issued and the
   * `grandTotals` that ride a getRows reply never arrive again. The tick's
   * own `totals` are therefore the ONLY live source for the pinned
   * grand-total row, and the provider must consume them (it now calls
   * `grid.setServerSideGrandTotals`). Before that, rows ticked while the
   * grand total painted its first value forever.
   */
  it('emits totals with refreshSsrm:false for a flat leader tick', async () => {
    const ticks: ViewTick[] = [];
    const book = new PerspectiveBook({
      schema: { positionId: 'string', desk: 'string' },
      onViewTick: (t) => ticks.push(t),
    });
    // Ungrouped (flat). `totalsView: null` keeps `fetchGrandTotal` on its
    // no-WASM early return, so this exercises the real branch.
    (book as any).views.set('F', makeBoundView('F', { groupBy: [] }));
    (book as any).pendingLiveBatch.set('F', [{ positionId: 'p1', desk: 'X' }]);

    await (book as any).emitViewTick('F');

    const tick = ticks.find((t) => t.viewId === 'F');
    expect(tick).toBeTruthy();
    expect(tick!.updates).toHaveLength(1);
    // The row patch is the whole refresh — nothing re-fetches a window.
    expect(tick!.refreshSsrm).toBe(false);
    // …so these totals are the only live figure the grid can use.
    expect(tick!.totals).toBeTruthy();
  });

  it('grouped ticks still ask for a soft refresh and carry a placeholder', async () => {
    const ticks: ViewTick[] = [];
    const book = new PerspectiveBook({
      schema: { positionId: 'string', desk: 'string' },
      onViewTick: (t) => ticks.push(t),
    });
    (book as any).views.set('G', makeBoundView('G', { groupBy: ['desk'] }));
    (book as any).pendingLiveBatch.set('G', [{ positionId: 'p1', desk: 'X' }]);

    await (book as any).emitViewTick('G');

    const tick = ticks.find((t) => t.viewId === 'G');
    // Grouped totals come from the skeleton root on the soft refresh — the
    // provider must NOT push this placeholder into the grid.
    expect(tick!.refreshSsrm).toBe(true);
  });
});
