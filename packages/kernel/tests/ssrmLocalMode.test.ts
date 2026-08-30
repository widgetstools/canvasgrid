import { describe, it, expect, vi } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import type { IServerSideDatasourceV2 } from '../src/types/ssrm';
import type { FilterModel, SortModel } from '../src/types';

/**
 * Local mode — the SSRM v2 controller mounted for a `clientSide` grid.
 *
 * The whole book already lives in the worker's RowStore (put there by
 * setRowData / applyTransaction), so every fetch-shaped operation the
 * controller owns must become a no-op: there is no latency to hide, no
 * remote dataset to page, and nothing to refresh FROM. These tests pin
 * that contract — a local-mode controller must never touch a datasource,
 * even when one is somehow present.
 */

interface Row { id: string; v: number }

function makeHost(events: string[]): SsrmHostV2<Row> {
  return {
    getRowId: (r) => r.id,
    getSortModel: () => [] as unknown as SortModel,
    getFilterModel: () => ({}) as FilterModel,
    getRowGroupCols: () => [],
    getExpandedGroupKeys: () => [],
    setRowCount: () => { events.push('setRowCount'); },
    hydrateWindow: async () => { events.push('hydrateWindow'); },
    applyTransaction: () => { events.push('applyTransaction'); },
    requestViewport: () => { events.push('requestViewport'); },
    isDestroyed: () => false,
  };
}

function makeLocalController(events: string[]): ServerSideRowModelV2Controller<Row> {
  return new ServerSideRowModelV2Controller<Row>(makeHost(events), {
    rowIdField: 'id',
    localMode: true,
  });
}

describe('SSRM v2 controller — local mode (clientSide grids)', () => {
  it('reports local mode; defaults to OFF so server-side construction is unchanged', () => {
    const events: string[] = [];
    expect(makeLocalController(events).isLocalMode()).toBe(true);
    // No `localMode` key at all — the shape every existing SSRM call site uses.
    const serverSide = new ServerSideRowModelV2Controller<Row>(makeHost(events), {
      rowIdField: 'id',
    });
    expect(serverSide.isLocalMode()).toBe(false);
  });

  it('ensureRange resolves without fetching — it runs on the scroll hot path', async () => {
    const events: string[] = [];
    const ctrl = makeLocalController(events);
    const ds = { getRows: vi.fn(), getGroupSkeleton: vi.fn(), getLeafRows: vi.fn() };
    ctrl.setDatasource(ds as unknown as IServerSideDatasourceV2<Row>);

    await ctrl.ensureRange(0, 500);
    await ctrl.ensureRange(500, 1000);

    expect(ds.getRows).not.toHaveBeenCalled();
    expect(ds.getLeafRows).not.toHaveBeenCalled();
    expect(events).not.toContain('hydrateWindow');
  });

  it('refresh is inert for both purge and soft variants', async () => {
    const events: string[] = [];
    const ctrl = makeLocalController(events);
    const ds = { getRows: vi.fn(), getGroupSkeleton: vi.fn(), getLeafRows: vi.fn() };
    ctrl.setDatasource(ds as unknown as IServerSideDatasourceV2<Row>);

    await ctrl.refresh({ purge: true });
    await ctrl.refresh({ purge: false });
    await ctrl.refresh();

    expect(ds.getRows).not.toHaveBeenCalled();
    expect(ds.getGroupSkeleton).not.toHaveBeenCalled();
    expect(events).not.toContain('hydrateWindow');
  });

  it('ensureFullyHydrated returns true immediately — the store IS the book', async () => {
    const events: string[] = [];
    const ctrl = makeLocalController(events);
    const ds = { getRows: vi.fn(), getGroupSkeleton: vi.fn(), getLeafRows: vi.fn() };
    ctrl.setDatasource(ds as unknown as IServerSideDatasourceV2<Row>);

    // Server-side would refuse this while grouped, or page the whole book in
    // blockSize chunks. Local mode answers yes without touching either.
    await expect(ctrl.ensureFullyHydrated()).resolves.toBe(true);
    expect(ds.getRows).not.toHaveBeenCalled();
    expect(events).not.toContain('hydrateWindow');
  });

  it('never dereferences a datasource, because local mode never installs one', async () => {
    // Mirrors the real wiring: mountSsrmController skips setDatasource for
    // clientSide grids, so `datasource` stays null for the controller's life.
    const events: string[] = [];
    const ctrl = makeLocalController(events);

    await expect(ctrl.ensureRange(0, 100)).resolves.toBeUndefined();
    await expect(ctrl.refresh({ purge: true })).resolves.toBeUndefined();
    await expect(ctrl.ensureFullyHydrated()).resolves.toBe(true);
    expect(events).toEqual([]);
  });
});
