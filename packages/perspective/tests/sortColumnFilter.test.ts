import { describe, it, expect, vi, beforeAll } from 'vitest';
import { PerspectiveBook } from '../src/book';

// These tests run in the default `node` environment (the package has no
// vitest config), but the book schedules view ticks through `window` timers.
// Stub just that surface rather than pulling in a DOM environment.
beforeAll(() => {
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as { window?: unknown }).window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    };
  }
});

/**
 * Sorts must never reference a column Perspective doesn't have.
 *
 * The grid's sort model can carry columns that exist only in the kernel:
 * pivot result columns (`pivotcol\x01EMEA\x01marketValue`), pivot row totals,
 * and the auto-group column. Passing one into a Perspective view config
 * aborts the engine —
 *
 *   Abort(): Invalid column 'pivotcol...' found in View sorts
 *   Uncaught Error: null pointer passed to rust
 *
 * — and the WASM instance is unusable afterwards, so the live feed dies for
 * the whole page. Clicking a pivot column header did exactly that: the grid
 * froze permanently and no further ticks painted.
 *
 * These drive the private `syncQuery` seam because that is where the sort is
 * converted, and assert on the config actually handed to `table.view()`.
 */

interface Bound { [k: string]: unknown }

function makeBook() {
  const viewConfigs: Array<Record<string, unknown>> = [];
  const book = new PerspectiveBook({ feed: 'seed' });
  const view = {
    to_columns_string: async () => JSON.stringify({ positionId: [] }),
    num_rows: async () => 0,
    on_update: async () => 1,
    remove_update: async () => {},
    delete: async () => {},
    column_paths: async () => [],
  };
  const internal = book as unknown as {
    table: unknown;
    views: Map<string, Bound>;
    syncQuery(
      bound: Bound, viewId: string, sort: unknown, filter: unknown,
      rowGroupCols: string[], trustEmptyGroupBy?: boolean,
    ): Promise<{ sort: Array<[string, string]> }>;
  };
  internal.table = {
    view: async (cfg: Record<string, unknown>) => { viewConfigs.push(cfg); return view; },
  };
  const bound: Bound = {
    spec: { id: 'v', label: 'v' },
    view, totalsView: null, leafView: null,
    leafRanges: null, leafRangeByPath: null, leafOffsetsUnreliable: false,
    dataUpdateCb: null, notifyTimer: null,
    groupBy: ['desk'], groupedRawCache: null, groupKeys: [], lastQuerySig: '',
    getRowsCalls: 0, rowsServed: 0, inflight: 0, projectedRows: 0,
    expressions: {}, readColumns: [], lastExtraFilter: [], lastSort: [],
    quickFilterText: '', quickFilterExpressions: {}, lastOrContains: {},
    valueAggOverrides: {}, pivotColIds: [], pivotViews: [],
  };
  internal.views.set('v', bound);
  return { book, internal, bound, viewConfigs };
}

describe('sort columns are filtered to what Perspective has', () => {
  it('drops a pivot result column instead of aborting the engine', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { book, internal, bound } = makeBook();
    const res = await internal.syncQuery(
      bound, 'v',
      [{ colId: 'pivotcolEMEAmarketValue', direction: 'asc' }],
      {}, ['desk'], true,
    );
    expect(res.sort).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignoring sort on column(s)'));
    warn.mockRestore();
    book.destroy();
  });

  it('keeps real table columns', async () => {
    const { book, internal, bound } = makeBook();
    const res = await internal.syncQuery(
      bound, 'v', [{ colId: 'pnl', direction: 'desc' }], {}, ['desk'], true,
    );
    expect(res.sort).toEqual([['pnl', 'desc']]);
    book.destroy();
  });

  it('keeps the valid half of a mixed sort model', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { book, internal, bound } = makeBook();
    const res = await internal.syncQuery(
      bound, 'v',
      [
        { colId: 'desk', direction: 'asc' },
        { colId: 'pivotcolAMERpnl', direction: 'desc' },
        { colId: 'ag-Grid-AutoColumn', direction: 'asc' },
      ],
      {}, ['desk'], true,
    );
    expect(res.sort).toEqual([['desk', 'asc']]);
    warn.mockRestore();
    book.destroy();
  });

  it('never lets an unknown column reach a Perspective view config', async () => {
    // The abort happens inside table.view() — assert nothing invalid is ever
    // handed to it, not merely that syncQuery's return value is clean.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { book, internal, bound, viewConfigs } = makeBook();
    await internal.syncQuery(
      bound, 'v',
      [{ colId: 'pivotcolEMEAmarketValue', direction: 'asc' }],
      {}, ['desk'], true,
    );
    for (const cfg of viewConfigs) {
      for (const [colId] of (cfg.sort ?? []) as Array<[string, string]>) {
        expect(colId.startsWith('pivotcol')).toBe(false);
        expect(colId).not.toBe('ag-Grid-AutoColumn');
      }
    }
    warn.mockRestore();
    book.destroy();
  });
});
