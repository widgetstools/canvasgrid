/**
 * The book speaks `{ rows }`; the grid's `LoadSuccessParams` reads `rowData`.
 * Passing a book result straight through to `params.success` type-checks
 * against nothing useful and yields an empty grid with no error anywhere —
 * that shipped once and emptied the Perspective SSRM demo. These tests pin
 * the key names on every datasource method the grid calls.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  StompPerspectiveProvider,
  __resetProviderBooksForTests,
  type PositionRow,
} from '../src/index';

afterEach(() => {
  __resetProviderBooksForTests();
});

const makeProvider = (providerId: string): StompPerspectiveProvider =>
  new StompPerspectiveProvider({
    providerId,
    feed: 'seed',
    engine: 'memory',
    snapshotRows: 200,
  });

/** Poll a datasource method until it serves a payload the grid can read. */
const pollFor = async <T>(
  call: (resolve: (v: T | 'fail') => void) => void,
  isReady: (v: T) => boolean,
  attempts = 40,
): Promise<T | 'fail'> => {
  let last: T | 'fail' = 'fail';
  for (let i = 0; i < attempts; i++) {
    last = await new Promise<T | 'fail'>((resolve) => call(resolve));
    if (last !== 'fail' && isReady(last)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  return last;
};

describe('StompPerspectiveProvider — grid datasource contract', () => {
  it('getRows serves rows under `rowData`, not `rows`', async () => {
    const provider = makeProvider('contract-getRows');
    const res = await pollFor<{ rowData?: PositionRow[]; rowCount?: number }>(
      (resolve) => provider.getRows({
        request: {
          startRow: 0,
          endRow: 50,
          sortModel: [],
          filterModel: {},
          groupKeys: [],
          rowGroupCols: [],
          valueCols: [],
          pivotCols: [],
          pivotMode: false,
        },
        success: (r) => resolve(r as never),
        fail: () => resolve('fail'),
      } as never),
      (r) => (r.rowData?.length ?? 0) > 0,
    );

    expect(res).not.toBe('fail');
    const payload = res as { rowData?: PositionRow[]; rowCount?: number };
    expect(Array.isArray(payload.rowData)).toBe(true);
    expect(payload.rowData!.length).toBeGreaterThan(0);
    expect(payload.rowData![0]).toHaveProperty('positionId');
    expect(payload.rowCount).toBeGreaterThan(0);
    // The book's own key must not leak through.
    expect(payload).not.toHaveProperty('rows');
    provider.destroy();
  });

  it('getGroupSkeleton serves `groups` with path + leafCount', async () => {
    const provider = makeProvider('contract-skeleton');
    const res = await pollFor<{ groups?: Array<{ path: string[]; leafCount: number }> }>(
      (resolve) => provider.getGroupSkeleton({
        request: { rowGroupCols: ['desk'], groupPath: [], sortModel: [], filterModel: {} },
        success: (r) => resolve(r as never),
        fail: () => resolve('fail'),
      } as never),
      (r) => (r.groups?.length ?? 0) > 0,
    );

    expect(res).not.toBe('fail');
    const payload = res as { groups?: Array<{ path: string[]; leafCount: number }> };
    expect(Array.isArray(payload.groups)).toBe(true);
    expect(payload.groups!.length).toBeGreaterThan(0);
    expect(payload.groups![0]).toHaveProperty('path');
    expect(payload.groups![0]).toHaveProperty('leafCount');
    provider.destroy();
  });

  it('getLeafRows serves leaves under `rowData`, not `rows`', async () => {
    const provider = makeProvider('contract-leaves');
    const res = await pollFor<{ rowData?: PositionRow[] }>(
      (resolve) => provider.getLeafRows({
        request: {
          groupPath: ['EQ'],
          startRow: 0,
          endRow: 25,
          rowGroupCols: ['desk'],
          sortModel: [],
          filterModel: {},
        },
        success: (r) => resolve(r as never),
        fail: () => resolve('fail'),
      } as never),
      (r) => (r.rowData?.length ?? 0) > 0,
    );

    expect(res).not.toBe('fail');
    const payload = res as { rowData?: PositionRow[] };
    expect(Array.isArray(payload.rowData)).toBe(true);
    expect(payload).not.toHaveProperty('rows');
    provider.destroy();
  });

  it('getGroupLeafIds serves `ids`', async () => {
    const provider = makeProvider('contract-leafIds');
    const res = await pollFor<{ ids?: string[] }>(
      (resolve) => provider.getGroupLeafIds({
        request: { groupPath: ['EQ'], rowGroupCols: ['desk'], sortModel: [], filterModel: {} },
        success: (r) => resolve(r as never),
        fail: () => resolve('fail'),
      } as never),
      (r) => Array.isArray(r.ids),
    );

    expect(res).not.toBe('fail');
    expect(Array.isArray((res as { ids?: string[] }).ids)).toBe(true);
    provider.destroy();
  });
});
