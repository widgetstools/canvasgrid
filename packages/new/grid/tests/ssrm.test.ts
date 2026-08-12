import { describe, expect, it, vi } from 'vitest';
import { ServerSideRowModel, type SsrmHost } from '../src/ssrm/serverSideRowModel';
import type {
  IServerSideDatasourceV2,
  IServerSideGetLeafRowsParams,
  IServerSideGetRowsParams,
  IServerSideGetSkeletonParams,
} from '../src/ssrm/types';
import { buildCompositeGroupKey } from '../src/ssrm/groupKeys';

type Row = { id: string; desk: string; region: string; pnl: number };

function makeBook(n = 20): Row[] {
  const desks = ['EQ', 'FX'];
  const regions = ['AMER', 'EMEA'];
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `R${i}`,
      desk: desks[i % desks.length]!,
      region: regions[i % regions.length]!,
      pnl: i * 10,
    });
  }
  return rows;
}

function mockDs(book: Row[]): IServerSideDatasourceV2<Row> & {
  skeletonCalls: number;
  leafCalls: number;
  flatCalls: number;
} {
  const state = { skeletonCalls: 0, leafCalls: 0, flatCalls: 0 };
  return {
    get skeletonCalls() { return state.skeletonCalls; },
    get leafCalls() { return state.leafCalls; },
    get flatCalls() { return state.flatCalls; },
    getRows(params: IServerSideGetRowsParams<Row>): void {
      state.flatCalls++;
      const { startRow, endRow } = params.request;
      queueMicrotask(() => {
        params.success({
          rows: book.slice(startRow, endRow),
          rowCount: book.length,
        });
      });
    },
    getGroupSkeleton(params: IServerSideGetSkeletonParams): void {
      state.skeletonCalls++;
      const cols = params.request.rowGroupCols;
      queueMicrotask(() => {
        type Agg = { leafCount: number; pnl: number };
        const byPath = new Map<string, Agg>();
        let total = 0;
        for (const row of book) {
          total += row.pnl;
          for (let d = 1; d <= cols.length; d++) {
            const path = cols.slice(0, d).map((c) => String((row as Record<string, unknown>)[c] ?? ''));
            const key = path.join('\0');
            const agg = byPath.get(key) ?? { leafCount: 0, pnl: 0 };
            agg.leafCount++;
            agg.pnl += row.pnl;
            byPath.set(key, agg);
          }
        }
        params.success({
          groups: [
            { path: [], leafCount: book.length, aggregates: { pnl: total } },
            ...[...byPath].map(([key, agg]) => ({
              path: key.split('\0'),
              leafCount: agg.leafCount,
              aggregates: { pnl: agg.pnl },
            })),
          ],
        });
      });
    },
    getLeafRows(params: IServerSideGetLeafRowsParams<Row>): void {
      state.leafCalls++;
      const { groupPath, rowGroupCols, startRow, endRow } = params.request;
      queueMicrotask(() => {
        const rows = book.filter((row) =>
          groupPath.every((v, i) => String((row as Record<string, unknown>)[rowGroupCols[i]!] ?? '') === v),
        );
        params.success({ rows: rows.slice(startRow, endRow) });
      });
    },
  };
}

function makeHost(overrides: Partial<SsrmHost<Row>> = {}): SsrmHost<Row> & {
  windows: Array<{ start: number; rows: Row[]; rowCount: number; replace: boolean }>;
  expanded: string[];
  groups: string[];
  sparse: boolean;
  pipeline: boolean;
} {
  const windows: Array<{ start: number; rows: Row[]; rowCount: number; replace: boolean }> = [];
  const host = {
    windows,
    expanded: [] as string[],
    groups: [] as string[],
    sparse: true,
    pipeline: false,
    getRowId: (r: Row) => r.id,
    isDestroyed: () => false,
    hydrateWindow: (start: number, rows: Row[], rowCount: number, replace: boolean) => {
      windows.push({ start, rows: rows.slice(), rowCount, replace });
    },
    getRowGroupCols: () => host.groups.slice(),
    getExpandedGroupKeys: () => host.expanded.slice(),
    getSortModel: () => [],
    getFilterModel: () => ({}),
    getRefreshRange: () => ({ rowStart: 0, rowEnd: 50 }),
    isSparse: () => host.sparse,
    wantsClientPipeline: () => host.pipeline,
    ...overrides,
  };
  return host;
}

describe('ServerSideRowModel flat', () => {
  it('loads blocks and hydrates windows', async () => {
    const book = makeBook(25);
    const ds = mockDs(book);
    const host = makeHost();
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 10 });
    ssrm.setDatasource(ds);
    await ssrm.ensureRange(0, 15);
    expect(ssrm.getRowCount()).toBe(25);
    expect(ds.flatCalls).toBeGreaterThan(0);
    expect(host.windows.some((w) => w.rows.length > 0)).toBe(true);
  });

  it('id-merges soft refresh without blanking prior fields', async () => {
    const book = makeBook(10);
    const ds = mockDs(book);
    const host = makeHost();
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 10 });
    ssrm.setDatasource(ds);
    await ssrm.ensureRange(0, 10);
    book[0] = { ...book[0]!, pnl: 999 };
    // Column slice missing desk — merge must keep prior desk
    const origGetRows = ds.getRows.bind(ds);
    ds.getRows = (params) => {
      origGetRows({
        ...params,
        success: (r) => {
          params.success({
            rows: (r.rows ?? []).map((row) => ({ id: row.id, pnl: row.pnl } as Row)),
            rowCount: r.rowCount,
          });
        },
      });
    };
    await ssrm.refresh({ purge: false });
    await ssrm.ensureRange(0, 10);
    const last = host.windows[host.windows.length - 1]!;
    const row0 = last.rows.find((r) => r.id === 'R0');
    expect(row0?.pnl).toBe(999);
    expect(row0?.desk).toBe('EQ');
  });

  it('ensureFullyHydrated fail-closed without pipeline flag', async () => {
    const host = makeHost({ pipeline: false });
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 10 });
    ssrm.setDatasource(mockDs(makeBook(5)));
    await ssrm.ensureRange(0, 5);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await ssrm.ensureFullyHydrated()).toBe(false);
    warn.mockRestore();
  });

  it('ensureFullyHydrated replaces window when pipeline enabled', async () => {
    const book = makeBook(12);
    const host = makeHost({ pipeline: true, sparse: false });
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 5 });
    ssrm.setDatasource(mockDs(book));
    expect(await ssrm.ensureFullyHydrated()).toBe(true);
    expect(ssrm.isFullyHydrated()).toBe(true);
    const replace = host.windows.find((w) => w.replace);
    expect(replace?.rows.length).toBe(12);
  });

  it('soft refresh conflates while queued', async () => {
    const book = makeBook(10);
    const ds = mockDs(book);
    const host = makeHost();
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 10 });
    ssrm.setDatasource(ds);
    await ssrm.ensureRange(0, 10);
    const a = ssrm.refresh({ purge: false });
    const b = ssrm.refresh({ purge: false });
    expect(a).toBe(b);
    await a;
  });
});

describe('ServerSideRowModel grouped sparse', () => {
  it('builds skeleton + expand loads leaf blocks via getLeafRows', async () => {
    const book = makeBook(20);
    const ds = mockDs(book);
    const host = makeHost();
    host.groups = ['desk', 'region'];
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 10, rowIdField: 'id' });
    ssrm.setDatasource(ds);
    await ssrm.ensureRange(0, 10);
    expect(ds.skeletonCalls).toBeGreaterThan(0);
    expect(ssrm.getSkeleton().length).toBeGreaterThan(0);
    // collapsed: only desk groups
    expect(ssrm.getRowCount()).toBe(2);

    const eq = buildCompositeGroupKey(['desk', 'region'], ['EQ']);
    const eqAmer = buildCompositeGroupKey(['desk', 'region'], ['EQ', 'AMER']);
    host.expanded = [eq, eqAmer];
    await ssrm.refreshExpansion();
    expect(ssrm.getRowCount()).toBeGreaterThan(2);
    expect(ds.leafCalls).toBeGreaterThan(0);
    const last = host.windows[host.windows.length - 1]!;
    expect(last.rows.some((r) => (r as Row & { __isGroup?: boolean }).__isGroup)).toBe(true);
    expect(last.rows.some((r) => r.id?.startsWith('R'))).toBe(true);
  });

  it('expansion does not bump dataGen / purge leaf caches for untouched groups', async () => {
    const book = makeBook(20);
    const ds = mockDs(book);
    const host = makeHost();
    host.groups = ['desk'];
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 50, rowIdField: 'id' });
    ssrm.setDatasource(ds);
    await ssrm.ensureRange(0, 5);
    const gen = ssrm.getDataGen();
    const eq = buildCompositeGroupKey(['desk'], ['EQ']);
    host.expanded = [eq];
    await ssrm.refreshExpansion();
    expect(ssrm.getDataGen()).toBe(gen);
  });

  it('purge refresh bumps dataGen and clears skeleton', async () => {
    const host = makeHost();
    host.groups = ['desk'];
    const ssrm = new ServerSideRowModel(host, { cacheBlockSize: 10 });
    ssrm.setDatasource(mockDs(makeBook(8)));
    await ssrm.ensureRange(0, 5);
    const gen = ssrm.getDataGen();
    await ssrm.refresh({ purge: true });
    expect(ssrm.getDataGen()).toBe(gen + 1);
  });

  it('assertPivotAllowed fail-closed when sparse', () => {
    const host = makeHost({ sparse: true });
    const ssrm = new ServerSideRowModel(host);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(ssrm.assertPivotAllowed()).toBe(false);
    warn.mockRestore();
  });
});
