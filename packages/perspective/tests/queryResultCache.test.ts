import { describe, expect, it, vi } from 'vitest';
import { PerspectiveBook } from '../src/book';

/**
 * Cross-view query-result cache.
 *
 * Several grids on one page share ONE PerspectiveBook, each with its own
 * View, so two blotters showing the same thing used to issue byte-identical
 * WASM reads independently. The cache lets the second ride the first's.
 *
 * The two things worth pinning hardest are the ones that would be silent
 * bugs: identical-looking-but-different queries must NEVER collide (a view
 * served another view's rows is a data leak), and a live tick must drop
 * everything (a blotter painting stale rows forever).
 */

interface FakeView {
  reads: number;
  rows: Record<string, unknown>[];
}

/** Fake Table/View pair with a shared read counter across every View it
 *  hands out — assertions read as "the underlying WASM read ran N times"
 *  regardless of which view served it. */
function makeFakeTable(rows: Record<string, unknown>[]) {
  const state = { reads: 0, rows, gate: null as null | (() => void) };
  const makeView = (): unknown => ({
    to_columns_string: async () => {
      state.reads++;
      if (state.gate) {
        await new Promise<void>((resolve) => { state.gate = resolve; });
      }
      // Columnar JSON, matching what readRows parses.
      const cols: Record<string, unknown[]> = {};
      for (const row of state.rows) {
        for (const k of Object.keys(row)) (cols[k] ??= []).push(row[k]);
      }
      return JSON.stringify(cols);
    },
    num_rows: async () => state.rows.length,
    on_update: async () => 1,
    remove_update: async () => {},
    delete: async () => {},
  });
  return { state, makeView, table: { view: async () => makeView() } };
}

function makeBoundView(id: string, view: unknown, overrides: Record<string, unknown> = {}): unknown {
  return {
    spec: { id, label: id },
    view,
    totalsView: null,
    leafView: null,
    leafRanges: null,
    leafRangeByPath: null,
    leafOffsetsUnreliable: false,
    dataUpdateCb: null,
    notifyTimer: null,
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
    ...overrides,
  };
}

const GROUPED_ROWS = [
  { __ROW_PATH__: [], positionId: 4, pnl: 100 },
  { __ROW_PATH__: ['Rates'], positionId: 2, pnl: 40 },
  { __ROW_PATH__: ['Credit'], positionId: 2, pnl: 60 },
];

/** Book with two bound views over one fake table. `getGroupedRaw` is private;
 *  tests reach it structurally, the same way book.test.ts reaches `views`. */
function setup(overridesB: Record<string, unknown> = {}) {
  const fake = makeFakeTable(GROUPED_ROWS);
  const book = new PerspectiveBook({ feed: 'seed' });
  const internal = book as unknown as {
    table: unknown;
    views: Map<string, unknown>;
    getGroupedRaw(bound: unknown): Promise<Record<string, unknown>[]>;
    invalidateQueryResultCache(): void;
  };
  internal.table = fake.table;
  const a = makeBoundView('a', fake.makeView());
  const b = makeBoundView('b', fake.makeView(), overridesB);
  internal.views.set('a', a);
  internal.views.set('b', b);
  return { book, internal, fake, a, b };
}

describe('PerspectiveBook — cross-view query-result cache', () => {
  it('two views with an identical query issue ONE underlying read', async () => {
    const { internal, fake, a, b } = setup();
    await internal.getGroupedRaw(a);
    await internal.getGroupedRaw(b);
    expect(fake.state.reads).toBe(1);
  });

  it('each view gets its own array — a cache hit must not couple them', async () => {
    const { internal, a, b } = setup();
    const rowsA = await internal.getGroupedRaw(a);
    const rowsB = await internal.getGroupedRaw(b);
    expect(rowsA).not.toBe(rowsB);
    expect(rowsA).toEqual(rowsB);
  });

  it('a differing per-view fixed filter does NOT collide (data-leak guard)', async () => {
    const { internal, fake, a, b } = setup({
      spec: { id: 'b', label: 'b', filter: [['desk', '==', 'Rates']] },
    });
    await internal.getGroupedRaw(a);
    await internal.getGroupedRaw(b);
    // `bound.lastQuerySig` omits spec.filter — keying on it would have
    // served view B view A's unfiltered rows.
    expect(fake.state.reads).toBe(2);
  });

  it('differing calculated columns do NOT collide (data-leak guard)', async () => {
    const { internal, fake, a, b } = setup({ expressions: { pnlPct: '"pnl" / 100' } });
    await internal.getGroupedRaw(a);
    await internal.getGroupedRaw(b);
    expect(fake.state.reads).toBe(2);
  });

  it.each([
    ['sort', { lastSort: [['pnl', 'desc']] }],
    ['filter', { lastExtraFilter: [['pnl', '>', 10]] }],
    ['quick filter', { quickFilterText: 'rates' }],
    ['groupBy', { groupBy: ['region'] }],
    ['aggFunc override', { valueAggOverrides: { pnl: 'avg' } }],
  ])('a differing %s does not collide', async (_label, overrides) => {
    const { internal, fake, a, b } = setup(overrides);
    await internal.getGroupedRaw(a);
    await internal.getGroupedRaw(b);
    expect(fake.state.reads).toBe(2);
  });

  it('coalesces concurrent identical requests onto one in-flight read', async () => {
    const { internal, fake, a, b } = setup();
    // Park the first read mid-flight so both calls overlap.
    fake.state.gate = () => {};
    const pa = internal.getGroupedRaw(a);
    const pb = internal.getGroupedRaw(b);
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.state.reads).toBe(1);

    (fake.state.gate as unknown as () => void)();
    fake.state.gate = null;
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(ra).toEqual(rb);
    expect(ra).not.toBe(rb);
    expect(fake.state.reads).toBe(1);
  });

  it('a live tick invalidates — the next identical query re-reads', async () => {
    const { internal, fake, a, b } = setup();
    await internal.getGroupedRaw(a);
    expect(fake.state.reads).toBe(1);

    // What a View on_update does.
    internal.invalidateQueryResultCache();

    await internal.getGroupedRaw(b);
    expect(fake.state.reads).toBe(2);
  });

  it('TTL backstop: serves inside the window, re-reads past it', async () => {
    const fake = makeFakeTable(GROUPED_ROWS);
    const book = new PerspectiveBook({ feed: 'seed', queryResultCacheTtlMs: 40 });
    const internal = book as unknown as {
      table: unknown; views: Map<string, unknown>;
      getGroupedRaw(b: unknown): Promise<Record<string, unknown>[]>;
    };
    internal.table = fake.table;
    const a = makeBoundView('a', fake.makeView());
    const b = makeBoundView('b', fake.makeView());
    const c = makeBoundView('c', fake.makeView());

    await internal.getGroupedRaw(a);
    await internal.getGroupedRaw(b);
    expect(fake.state.reads).toBe(1);

    await new Promise((r) => setTimeout(r, 60));
    await internal.getGroupedRaw(c);
    expect(fake.state.reads).toBe(2);
    book.destroy();
  });

  it('a failed read is evicted, not cached for the TTL', async () => {
    const fake = makeFakeTable(GROUPED_ROWS);
    const book = new PerspectiveBook({ feed: 'seed' });
    const internal = book as unknown as {
      table: unknown; views: Map<string, unknown>;
      getGroupedRaw(b: unknown): Promise<Record<string, unknown>[]>;
    };
    internal.table = fake.table;
    let fail = true;
    const flaky = {
      to_columns_string: async () => {
        fake.state.reads++;
        if (fail) throw new Error('wasm blew up');
        return JSON.stringify({ positionId: [1] });
      },
    };
    const a = makeBoundView('a', flaky);
    await expect(internal.getGroupedRaw(a)).rejects.toThrow('wasm blew up');

    fail = false;
    // Would still be the poisoned entry if failures were cached.
    await expect(internal.getGroupedRaw(makeBoundView('b', flaky))).resolves.toBeDefined();
    expect(fake.state.reads).toBe(2);
    book.destroy();
  });

  it('reports hit / miss / size telemetry', async () => {
    const { book, internal, a, b } = setup();
    await internal.getGroupedRaw(a);
    await internal.getGroupedRaw(b);
    const t = book.getTelemetry();
    expect(t.queryResultCacheMisses).toBe(1);
    expect(t.queryResultCacheHits).toBe(1);
    expect(t.queryResultCacheSize).toBe(1);
  });

  it('destroy() clears the cache', async () => {
    const { book, internal, a } = setup();
    await internal.getGroupedRaw(a);
    expect(book.getTelemetry().queryResultCacheSize).toBe(1);
    book.destroy();
    expect(book.getTelemetry().queryResultCacheSize).toBe(0);
  });
});
