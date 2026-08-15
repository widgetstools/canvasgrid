import { describe, it, expect, beforeEach } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmDatasource,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import type { FilterModel, SortModel } from '../src/types';

/**
 * Sparse SSRM block-cache invalidation across structural changes.
 *
 * Regression (originally found on the v1 controller): a structural change
 * shifts the flattened index of every row below it, but a soft refresh only
 * invalidated blocks in the viewport band — off-screen blocks kept pre-change
 * rows and rehydrated them at post-change indices (rows painted under the
 * wrong groups after scrolling).
 *
 * These scenarios were migrated from the decommissioned v1 controller onto
 * the v2 controller's FLAT path (`getRows`-only datasource, no skeleton),
 * which is what such a datasource mounts on now. Two notes on the migration:
 *
 *  - v1's `refreshExpansion` ("drop the whole cache") has no flat-path
 *    counterpart: expansion only exists on the skeleton path, where a toggle
 *    is a local reflow over per-group caches and cannot shift leaf indices at
 *    all. The equivalent flat entry point for "the book changed shape" is
 *    `refresh({ purge: true })`, which the first test drives; the second
 *    asserts `refreshExpansion` is inert on the flat path.
 *  - the changed-total safety net (test 3) was carried over from v1 into the
 *    v2 flat load path as part of the decommission.
 */

interface Row {
  id: string;
  g: string;
}

const BLOCK = 10;
const LEAVES = 100;

/** Two groups, A and B, each with 100 leaves. */
function flatten(expandedA: boolean, expandedB: boolean): Row[] {
  const out: Row[] = [{ id: 'grp-A', g: 'A' }];
  if (expandedA) {
    for (let i = 1; i <= LEAVES; i++) out.push({ id: `a${i}`, g: 'A' });
  }
  out.push({ id: 'grp-B', g: 'B' });
  if (expandedB) {
    for (let i = 1; i <= LEAVES; i++) out.push({ id: `b${i}`, g: 'B' });
  }
  return out;
}

describe('sparse SSRM block invalidation (v2 flat path)', () => {
  let expandedA: boolean;
  let expandedB: boolean;
  let requests: number[];
  let hydrated: Array<{ startRow: number; ids: string[] }>;
  let ctrl: ServerSideRowModelV2Controller<Row>;

  function makeController(): ServerSideRowModelV2Controller<Row> {
    const host: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      // Flat path — a getRows-only datasource never owns grouping.
      getRowGroupCols: () => [],
      getExpandedGroupKeys: () => {
        const keys: string[] = [];
        if (expandedA) keys.push('g:A');
        if (expandedB) keys.push('g:B');
        return keys;
      },
      setRowCount: () => {},
      getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
      hydrateWindow: async (startRow, rows) => {
        hydrated.push({ startRow, ids: rows.map((r) => r.id) });
      },
      applyTransaction: () => {},
      requestViewport: () => {},
      isDestroyed: () => false,
    };
    // getRows only — no getGroupSkeleton / getLeafRows. Since the v1
    // controller was decommissioned this is what such a datasource drives.
    const ds: SsrmDatasource<Row> = {
      getRows: ({ request, success }) => {
        requests.push(request.startRow);
        const flat = flatten(expandedA, expandedB);
        success({
          rowData: flat.slice(request.startRow, request.endRow),
          rowCount: flat.length,
        });
      },
    };
    const controller = new ServerSideRowModelV2Controller<Row>(host, {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
    });
    controller.setDatasource(ds);
    return controller;
  }

  beforeEach(() => {
    expandedA = true;
    expandedB = true;
    requests = [];
    hydrated = [];
    ctrl = makeController();
  });

  it('a structural purge drops the whole cache — no stale rows after a shift + scroll', async () => {
    // Both groups present: 202 rows. Block 5 (rows 50-59) starts at a50.
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(50, 60);
    expect(hydrated.at(-1)!.ids[0]).toBe('a50');

    // Book shrinks to 102 rows. Rows 50-59 are now b49..b58.
    expandedA = false;
    await ctrl.refresh({ purge: true });

    requests = [];
    hydrated = [];
    await ctrl.ensureRange(50, 60);

    // The old block 5 must have been dropped (refetched, not served stale).
    expect(requests).toContain(50);
    expect(hydrated.at(-1)!.ids[0]).toBe('b49');
  });

  it('refreshExpansion is inert on the flat path (expansion is a skeleton-path concept)', async () => {
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(50, 60);

    requests = [];
    await ctrl.refreshExpansion();
    await ctrl.ensureRange(50, 60);

    // No refetch of anything: flat rows carry no expansion state, so nothing
    // shifted. (On the skeleton path a toggle reflows locally instead.)
    expect(requests).toEqual([]);
  });

  it('plain soft refresh keeps off-band blocks when the total is unchanged', async () => {
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(50, 60);

    requests = [];
    await ctrl.refresh({ purge: false });
    await ctrl.ensureRange(50, 60);

    // Only the viewport band (block 0) refetched; block 5 served from cache.
    expect(requests).toEqual([0]);
  });

  it('a fetch reporting a changed total drops other loaded blocks (safety net)', async () => {
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(50, 60);
    expect(hydrated.at(-1)!.ids[0]).toBe('a50');

    // Structure changes server-side WITHOUT a purge (e.g. a live tick that
    // only soft-refreshes the band).
    expandedA = false;
    requests = [];
    hydrated = [];
    await ctrl.refresh({ purge: false });

    // The band reload reported 102 (was 202) — block 5 must be invalidated.
    await ctrl.ensureRange(50, 60);
    expect(requests).toEqual([0, 50]);
    expect(hydrated.at(-1)!.ids[0]).toBe('b49');
  });

  it('same-total fetches do not thrash the cache', async () => {
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(50, 60);
    await ctrl.ensureRange(110, 120);

    requests = [];
    // Re-request already-loaded ranges — everything served from cache.
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(50, 60);
    await ctrl.ensureRange(110, 120);
    expect(requests).toEqual([]);
  });
});
