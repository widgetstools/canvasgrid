import { describe, it, expect, beforeEach } from 'vitest';
import {
  ServerSideRowModelController,
  type SsrmHost,
} from '../src/core/serverSideRowModel';
import type { IServerSideDatasource } from '../src/types/ssrm';
import type { FilterModel, SortModel } from '../src/types';

/**
 * Sparse SSRM block-cache invalidation across expansion changes.
 *
 * Regression: an expand/collapse shifts the flattened index of every row
 * below the toggled group, but the soft refresh only invalidated blocks in
 * the viewport band — off-screen blocks kept pre-toggle rows and rehydrated
 * them at post-toggle indices (rows painted under the wrong groups after
 * scrolling). `refreshExpansion` must drop the whole cache; additionally,
 * any fetch that reports a changed total drops other loaded blocks (safety
 * net for server-side drift outside the toggle path).
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

describe('sparse SSRM block invalidation', () => {
  let expandedA: boolean;
  let expandedB: boolean;
  let requests: number[];
  let hydrated: Array<{ startRow: number; ids: string[] }>;
  let ctrl: ServerSideRowModelController<Row>;

  function makeController(): ServerSideRowModelController<Row> {
    const host: SsrmHost<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => ['g'],
      getGroupKeys: () => [],
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
    const ds: IServerSideDatasource<Row> = {
      getRows: ({ request, success }) => {
        requests.push(request.startRow);
        const flat = flatten(expandedA, expandedB);
        success({
          rowData: flat.slice(request.startRow, request.endRow),
          rowCount: flat.length,
        });
      },
    };
    const controller = new ServerSideRowModelController<Row>(host, {
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

  it('refreshExpansion drops the whole cache — no stale rows after a toggle + scroll', async () => {
    // Both expanded: 202 rows. Block 5 (rows 50-59) = a50..a59.
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(50, 60);
    expect(hydrated.at(-1)!.ids[0]).toBe('a50');

    // Collapse A: 102 rows. Rows 50-59 are now b49..b58.
    expandedA = false;
    await ctrl.refreshExpansion();

    requests = [];
    hydrated = [];
    await ctrl.ensureRange(50, 60);

    // The old block 5 must have been dropped (refetched, not served stale).
    expect(requests).toContain(50);
    expect(hydrated.at(-1)!.ids[0]).toBe('b49');
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

    // Structure changes server-side WITHOUT going through refreshExpansion
    // (e.g. a live tick that only soft-refreshes the band).
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
