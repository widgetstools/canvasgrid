// @vitest-environment happy-dom
/**
 * What a tab learns when it is not the one holding the socket.
 *
 * Moving the STOMP transport into the SharedWorker removed the leader
 * election and left one broker connection per origin. It also, silently, took
 * something away: the tab used to parse the batch itself, so it knew exactly
 * which rows had moved. On the worker feed it knew only that the shared table
 * had changed, because that is all Perspective's `on_update` says.
 *
 * Values still arrived. Everything built on the old/new PAIRING did not —
 * cell flash, `[col.old]` diff styles, relative-change alerts. All three read
 * the previous row, and the previous row only exists if the grid is handed a
 * patch (`applyServerSideTransaction`) rather than told to re-read a block.
 * With `updates` always empty, `emitViewTick` never had a patch to send.
 *
 * The symptom was narrow and misleading: flash worked on the CSRM demo, and
 * on the SSRM demo with `?feed=main`, and died on the SSRM demo's default.
 * Nothing errored.
 *
 * So these tests assert the batch survives the trip, end to end through the
 * two seams it crosses, and that the degradation for a worker too old to send
 * it is a re-read rather than a freeze.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerFeedRegistry } from '../src/workerFeedHost';
import {
  isWorkerFeedRowsPush,
  isWorkerFeedPush,
  type WorkerFeedConfig,
} from '../src/workerFeedProtocol';
import { PerspectiveBook, type ViewTick } from '../src/book';
import type { PositionRow } from '../src/bootstrap';

// ── worker side ────────────────────────────────────────────────────────────

/** No engine, so `hostClient()` fails fast and the feed settles in `error`
 *  without touching WASM or a socket. The table is injected below; what is
 *  under test is the fan-out after a write, not the write. */
const bridge = { attachPort: () => {}, serverWasm: () => null };

const config = (tableName: string): WorkerFeedConfig => ({
  tableName,
  schema: { positionId: 'string', pnl: 'float' },
  index: 'positionId',
  keyColumn: 'positionId',
  wsUrl: 'ws://localhost:0',
  clientId: 'test',
  snapshotEndToken: 'Success',
  snapshotRows: 10,
  rate: 1,
  batchSize: 1,
  updatesPerTick: 1,
  clientWasmUrl: 'http://localhost/perspective-js.wasm',
});

/** A subscriber is only ever a `postMessage` target here — a real
 *  `MessageChannel` would make the assertions wait on the event loop for
 *  nothing. */
function fakePort(): { port: MessagePort; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  const port = {
    postMessage: (msg: Record<string, unknown>) => { sent.push(msg); },
  } as unknown as MessagePort;
  return { port, sent };
}

const rowPushes = (sent: Array<Record<string, unknown>>) =>
  sent.filter((m) => m.feed === 'rows');

/** Reach the feed the registry is holding. `feeds` is private; the registry
 *  exposes no way to drive a flush, and driving one is the whole point. */
function feedFor(registry: WorkerFeedRegistry, tableName: string): {
  table: unknown;
  buffer: unknown[];
  snapshotComplete: boolean;
  flush: () => Promise<void>;
} {
  return (registry as unknown as { feeds: Map<string, never> })
    .feeds.get(tableName) as never;
}

describe('the worker feed hands its subscribers each live batch', () => {
  let registry: WorkerFeedRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new WorkerFeedRegistry(bridge);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('every subscribed page gets the rows that just landed in the table', async () => {
    const a = fakePort();
    const b = fakePort();
    await registry.start(a.port, config('positions'));
    await registry.start(b.port, config('positions'));

    const feed = feedFor(registry, 'positions');
    feed.table = { update: vi.fn(async () => {}), size: vi.fn(async () => 0) };
    feed.snapshotComplete = true;
    feed.buffer.push({ positionId: 'p1', pnl: 5 });
    await feed.flush();

    // Both, not just the one that happened to ask first — they are reading
    // the same table and both need to know what moved in it.
    for (const { sent } of [a, b]) {
      expect(rowPushes(sent)).toEqual([
        { feed: 'rows', tableName: 'positions', rows: [{ positionId: 'p1', pnl: 5 }] },
      ]);
    }
  });

  it('does NOT broadcast the snapshot — a snapshot is not a tick', async () => {
    const a = fakePort();
    await registry.start(a.port, config('positions'));

    const feed = feedFor(registry, 'positions');
    feed.table = { update: vi.fn(async () => {}), size: vi.fn(async () => 0) };
    feed.snapshotComplete = false;          // still loading the book
    feed.buffer.push({ positionId: 'p1', pnl: 5 });
    await feed.flush();

    // Shipping the whole book to every tab would cost real bandwidth and
    // flash every cell on connect.
    expect(rowPushes(a.sent)).toEqual([]);
  });

  it('a page that released the feed stops hearing batches', async () => {
    const a = fakePort();
    const b = fakePort();
    await registry.start(a.port, config('positions'));
    await registry.start(b.port, config('positions'));
    registry.release(a.port, 'positions');

    const feed = feedFor(registry, 'positions');
    feed.table = { update: vi.fn(async () => {}), size: vi.fn(async () => 0) };
    feed.snapshotComplete = true;
    feed.buffer.push({ positionId: 'p1', pnl: 5 });
    await feed.flush();

    expect(rowPushes(a.sent)).toEqual([]);
    expect(rowPushes(b.sent)).toHaveLength(1);
  });
});

describe('the two control-port pushes stay distinguishable', () => {
  // They share one port with the request/reply traffic, so a predicate that
  // over-matched would route state into the row path (or the reverse) and
  // fail as a wrong-shape read somewhere far away.
  const rows = { feed: 'rows', tableName: 't', rows: [{ positionId: 'p1' }] };
  const state = { feed: 'state', state: { tableName: 't' } };

  it('a rows push is not a state push', () => {
    expect(isWorkerFeedRowsPush(rows)).toBe(true);
    expect(isWorkerFeedPush(rows)).toBe(false);
  });

  it('a state push is not a rows push', () => {
    expect(isWorkerFeedPush(state)).toBe(true);
    expect(isWorkerFeedRowsPush(state)).toBe(false);
  });

  it.each([
    ['a reply', { id: 1, ok: true, state: {} }],
    ['no rows array', { feed: 'rows', tableName: 't' }],
    ['null', null],
  ])('%s is neither', (_name, msg) => {
    expect(isWorkerFeedRowsPush(msg)).toBe(false);
  });
});

// ── page side ──────────────────────────────────────────────────────────────

/** Mirrors what `mountViews` builds; `book.ts` does not export `BoundView`,
 *  so tests reach it structurally (same approach as `book.test.ts`). */
function makeBoundView(id: string, groupBy: string[] = ['desk']): unknown {
  return {
    spec: { id, label: id },
    view: null, totalsView: null, leafView: null,
    leafRanges: null, leafRangeByPath: null, leafOffsetsUnreliable: false,
    dataUpdateCb: null, notifyTimer: null,
    groupBy,
    groupedRawCache: null, groupKeys: [], lastQuerySig: '',
    getRowsCalls: 0, rowsServed: 0, inflight: 0, projectedRows: 0,
    expressions: {}, readColumns: [],
    lastExtraFilter: [], lastSort: [], quickFilterText: '',
    quickFilterExpressions: {}, lastOrContains: {},
    valueAggOverrides: {}, pivotColIds: [], pivotViews: [],
    pivotKeyOrder: new Map(),
  };
}

function bookWithViews(ticks: ViewTick[], ids: string[], groupBy?: string[]): PerspectiveBook {
  const book = new PerspectiveBook({
    schema: { positionId: 'string', desk: 'string', pnl: 'float' },
    onViewTick: (t) => ticks.push(t),
  });
  for (const id of ids) {
    (book as never as { views: Map<string, unknown> })
      .views.set(id, makeBoundView(id, groupBy));
  }
  return book;
}

const priv = (book: PerspectiveBook) => book as never as {
  onWorkerFeedRows: (rows: PositionRow[]) => void;
  emitViewTick: (viewId: string) => Promise<void>;
  pendingLiveBatch: Map<string, PositionRow[]>;
  updateBuffer: PositionRow[];
  feedRole: string;
};

describe('a batch pushed from the worker reaches the grid as a patch', () => {
  it('lands in every mounted view\'s queue and ships as tick updates', async () => {
    const ticks: ViewTick[] = [];
    const book = bookWithViews(ticks, ['A', 'B']);
    const rows: PositionRow[] = [{ positionId: 'p1', desk: 'X', pnl: 7 }];

    priv(book).onWorkerFeedRows(rows);
    await priv(book).emitViewTick('A');
    await priv(book).emitViewTick('B');

    // `updates` is what the provider turns into `applyServerSideTransaction`,
    // which is what gives the grid an oldRow to diff against.
    expect(ticks.map((t) => t.updates)).toEqual([rows, rows]);
  });

  it('does not write them to the table again — the worker already did', () => {
    const book = bookWithViews([], ['A']);
    priv(book).onWorkerFeedRows([{ positionId: 'p1' }]);

    // `updateBuffer` is the queue feeding `table.update`. Re-enqueueing here
    // would cost a redundant WASM write per tab per tick, which is most of
    // what moving the feed into the worker was meant to save.
    expect(priv(book).updateBuffer).toEqual([]);
    expect(priv(book).pendingLiveBatch.get('A')).toEqual([{ positionId: 'p1' }]);
  });

  it('merges last-write-wins with a batch already queued', () => {
    const book = bookWithViews([], ['A']);
    priv(book).onWorkerFeedRows([{ positionId: 'p1', pnl: 1 }, { positionId: 'p2', pnl: 1 }]);
    priv(book).onWorkerFeedRows([{ positionId: 'p1', pnl: 2 }]);

    expect(priv(book).pendingLiveBatch.get('A')).toEqual([
      { positionId: 'p1', pnl: 2 },
      { positionId: 'p2', pnl: 1 },
    ]);
  });

  it('is inert with no views mounted', () => {
    const book = bookWithViews([], []);
    expect(() => priv(book).onWorkerFeedRows([{ positionId: 'p1' }])).not.toThrow();
    expect(priv(book).pendingLiveBatch.size).toBe(0);
  });
});

describe('a flat view on a worker feed that sends no rows still moves', () => {
  // The fallback for a shared worker deployed before the rows push existed:
  // new enough to take the feed, too old to say what moved. Apps ship on
  // their own cycle and the worker is deployed once per origin, so this skew
  // is normal rather than exceptional.
  it('asks for a band refresh when the batch never arrives', async () => {
    const ticks: ViewTick[] = [];
    const book = bookWithViews(ticks, ['A'], []);   // flat
    priv(book).feedRole = 'worker';
    // No `fetchGrandTotal` without a real totalsView; a null read is fine
    // here because `refreshSsrm` is what is under test.
    (book as never as { fetchGrandTotal: () => Promise<null> })
      .fetchGrandTotal = async () => null;

    await priv(book).emitViewTick('A');

    // Without this the tick carried no patch AND no refresh, so an ungrouped
    // view on the worker feed painted its first values forever.
    expect(ticks[0]).toMatchObject({ updates: [], refreshSsrm: true });
  });

  it('takes the cheap patch path once the batch does arrive', async () => {
    const ticks: ViewTick[] = [];
    const book = bookWithViews(ticks, ['A'], []);   // flat
    priv(book).feedRole = 'worker';
    (book as never as { fetchGrandTotal: () => Promise<null> })
      .fetchGrandTotal = async () => null;

    priv(book).onWorkerFeedRows([{ positionId: 'p1', desk: 'X', pnl: 7 }]);
    await priv(book).emitViewTick('A');

    // A patch carries the pairing a re-read cannot, and costs less.
    expect(ticks[0]).toMatchObject({ refreshSsrm: false });
    expect(ticks[0]?.updates).toHaveLength(1);
  });
});

describe('phase is a state, so onPhase fires on transitions only', () => {
  /**
   * The provider purges the SSRM caches when the book reaches `live` — once,
   * per its own comment, because a purge throws away every loaded block.
   *
   * `onWorkerFeedState` calls `setPhase` on every state push the worker
   * sends, and the worker sends one per live batch. With `setPhase`
   * notifying unconditionally, "purge once" became three or four purges a
   * SECOND: the visible window was discarded and re-fetched continuously, so
   * the grid showed blank rows, ticks were wiped before anyone could see
   * them, and a scroll landed in a window that had just been thrown away.
   *
   * Measured on the demo before the fix: 31 purging refreshes in 8 seconds.
   * After: 0.
   */
  const bookWithPhaseSpy = () => {
    const phases: string[] = [];
    const telemetry: unknown[] = [];
    const book = new PerspectiveBook({
      schema: { positionId: 'string' },
      onPhase: (p) => phases.push(p),
      onTelemetry: (t) => telemetry.push(t),
    });
    return { book, phases, telemetry };
  };

  const feedState = (over: Record<string, unknown> = {}) => ({
    tableName: 't', phase: 'live', snapshotRowsLoaded: 10, snapshotComplete: true,
    bookSize: 10, liveBatches: 1, liveRowsIn: 1, liveRowsPerSec: 1,
    droppedRowCount: 0, subscribers: 1, stopped: false, lastError: null,
    startedAt: 1, configMismatch: null, ...over,
  });

  const feed = (book: PerspectiveBook, state: unknown) =>
    (book as never as { onWorkerFeedState: (s: unknown) => void })
      .onWorkerFeedState(state);

  it('repeated `live` state pushes announce the phase once', () => {
    const { book, phases } = bookWithPhaseSpy();
    for (let i = 0; i < 20; i++) feed(book, feedState({ liveBatches: i }));
    expect(phases).toEqual(['live']);
  });

  it('still announces a REAL transition, so a reconnect purges again', () => {
    const { book, phases } = bookWithPhaseSpy();
    feed(book, feedState());
    feed(book, feedState({ phase: 'disconnected' }));
    feed(book, feedState({ phase: 'live' }));
    expect(phases).toEqual(['live', 'disconnected', 'live']);
  });

  it('telemetry still goes out on every push — its counters move constantly', () => {
    // Gating telemetry along with the phase would freeze the status bar's
    // rows/s and book size at whatever they were when the phase last moved.
    const { book, telemetry } = bookWithPhaseSpy();
    for (let i = 0; i < 5; i++) feed(book, feedState({ liveRowsPerSec: i }));
    expect(telemetry.length).toBeGreaterThanOrEqual(5);
  });
});

describe('an empty flat tick only re-reads when the feed cannot say what moved', () => {
  const flatBook = (ticks: ViewTick[], role: string, rowsSeen: boolean) => {
    const book = bookWithViews(ticks, ['A'], []);
    priv(book).feedRole = role;
    (book as never as { workerFeedRowsSeen: boolean }).workerFeedRowsSeen = rowsSeen;
    (book as never as { fetchGrandTotal: () => Promise<null> })
      .fetchGrandTotal = async () => null;
    return book;
  };

  it('a worker that HAS delivered batches: an empty tick means nothing matched', async () => {
    // Not ignorance but information — the feed moved rows and none belonged
    // to this view. Re-reading the band on that is a refresh per tick, which
    // blanks the window for nothing. A narrow quick filter, where most ticks
    // match nothing, is exactly where it bites.
    const ticks: ViewTick[] = [];
    await priv(flatBook(ticks, 'worker', true)).emitViewTick('A');
    expect(ticks[0]).toMatchObject({ updates: [], refreshSsrm: false });
  });

  it('a worker that has never delivered one: fall back to the band refresh', async () => {
    const ticks: ViewTick[] = [];
    await priv(flatBook(ticks, 'worker', false)).emitViewTick('A');
    expect(ticks[0]).toMatchObject({ updates: [], refreshSsrm: true });
  });

  it('a main-thread follower always falls back — the batch is in another tab', async () => {
    const ticks: ViewTick[] = [];
    await priv(flatBook(ticks, 'follower', true)).emitViewTick('A');
    expect(ticks[0]).toMatchObject({ updates: [], refreshSsrm: true });
  });
});
