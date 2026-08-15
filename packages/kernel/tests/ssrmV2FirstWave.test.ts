import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import {
  ServerSideRowModelV2Controller,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import { FlattenIndex, toDisplayOrder, extractRootAggregates } from '../src/core/ssrmFlattenIndex';
import type { IServerSideDatasourceV2, SkeletonGroup } from '../src/types/ssrm';
import type { FilterModel, SortModel } from '../src/types';

/**
 * First-wave AG parity on the sparse SSRM v2 path (2026-07-21):
 *  - group/grand total footers from the flatten index
 *  - grand totals from the skeleton root (`path: []`) → worker override
 *  - groupMaintainOrder skeleton-order pinning
 *  - expansion defaults (-1 / N levels / keys) under the null sentinel
 *  - selection descendant cascade via `getGroupLeafIds`
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
  HTMLCanvasElement.prototype.getContext = (() => ({
    scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, rect() {}, fill() {}, stroke() {},
    fillRect() {}, clearRect() {}, fillText() {}, drawImage() {},
    measureText: () => ({ width: 0 }),
    setTransform() {}, translate() {}, clip() {}, arc() {},
    canvas: { width: 1, height: 1 },
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const COLS = ['region', 'desk'];

/** region A → desks X, Y; region B → desk Z. Root row = grand totals. */
const SKELETON: SkeletonGroup[] = [
  { path: [], leafCount: 0, aggregates: { notional: 999 } },
  { path: ['A'], leafCount: 4, aggregates: { notional: 40 } },
  { path: ['A', 'X'], leafCount: 2, aggregates: { notional: 20 } },
  { path: ['A', 'Y'], leafCount: 2, aggregates: { notional: 20 } },
  { path: ['B'], leafCount: 2, aggregates: { notional: 10 } },
  { path: ['B', 'Z'], leafCount: 2, aggregates: { notional: 10 } },
];

describe('FlattenIndex footers + grand totals', () => {
  it('bottom footers land after each expanded group subtree; grand total caps the body', () => {
    const idx = new FlattenIndex(
      toDisplayOrder(SKELETON, COLS),
      new Set(['region:A', 'region:A::desk:X']),
      COLS.length - 1,
      { groupTotalRow: 'bottom', grandTotalRow: 'bottom' },
    );
    const kinds = idx.entriesInRange(0, idx.rowCount).map((e) =>
      e.kind === 'group' ? `g:${e.node.key}`
        : e.kind === 'leaf' ? 'leaf'
        : e.kind === 'footer' ? `f:${e.node.key}`
        : 'GT');
    expect(kinds).toEqual([
      'g:region:A',
      'g:region:A::desk:X', 'leaf', 'leaf', 'f:region:A::desk:X',
      'g:region:A::desk:Y',
      'f:region:A',
      'g:region:B',
      'GT',
    ]);
  });

  it("top footers land right after the group row; collapsed groups get none", () => {
    const idx = new FlattenIndex(
      toDisplayOrder(SKELETON, COLS),
      new Set(['region:A']),
      COLS.length - 1,
      { groupTotalRow: 'top', grandTotalRow: 'top' },
    );
    const kinds = idx.entriesInRange(0, idx.rowCount).map((e) =>
      e.kind === 'group' ? `g:${e.node.key}`
        : e.kind === 'footer' ? `f:${e.node.key}`
        : e.kind);
    expect(kinds).toEqual([
      'GT'.replace('GT', 'grandTotal'),
      'g:region:A', 'f:region:A',
      'g:region:A::desk:X',
      'g:region:A::desk:Y',
      'g:region:B',
    ]);
  });

  it('extractRootAggregates reads the path:[] carrier', () => {
    expect(extractRootAggregates(SKELETON)).toEqual({ notional: 999 });
    expect(extractRootAggregates(SKELETON.slice(1))).toBeNull();
  });
});

describe('worker ssrmSetGrandTotals override', () => {
  it('sparse chunk.totals come from the host-set grand totals, not AggPass', async () => {
    const replies: Array<{ id?: number; type: string; chunk?: { totals?: Record<string, number> } }> = [];
    const host = createWorkerHost((msg) => { replies.push(msg as never); });
    const send = (m: unknown): void => host.handle(m as WorkerRequest);
    const waitFor = async (id: number): Promise<(typeof replies)[number]> => {
      for (let i = 0; i < 200; i++) {
        const hit = replies.find((r) => r.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 0));
      }
      throw new Error(`no reply ${id}`);
    };

    send({
      id: 1, type: 'init',
      payload: {
        columns: [{ colId: 'notional', field: 'notional', type: 'number', aggFunc: 'sum' }],
        rowIdField: 'id',
      },
    });
    await waitFor(1);
    send({
      id: 2, type: 'ssrmHydrate',
      payload: { rowCount: 2, startRow: 0, rows: [{ id: 'r1', notional: 1 }, { id: 'r2', notional: 2 }], reset: true },
    });
    await waitFor(2);
    send({ id: 3, type: 'ssrmSetGrandTotals', payload: { totals: { notional: 4242 } } });
    await waitFor(3);
    send({ id: 4, type: 'getViewport', payload: { rowStart: 0, rowEnd: 2, columns: ['notional'] } });
    const reply = await waitFor(4);
    // AggPass would say 3 (hydrated rows only); the host truth wins.
    expect(reply.chunk?.totals?.notional).toBe(4242);
  });
});

describe('v2 controller — footers, grand totals, maintainOrder, leaf ids', () => {
  interface Row { id: string; region: string; desk: string; notional: number }

  function makeLeaves(prefix: string, n: number): Row[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i + 1}`, region: 'r', desk: 'd', notional: 1,
    }));
  }

  function build(opts: {
    groupTotalRow?: 'top' | 'bottom' | null;
    grandTotalRow?: 'top' | 'bottom' | null;
    maintainOrder?: boolean;
    skeleton?: () => SkeletonGroup[];
  } = {}): {
    ctrl: ServerSideRowModelV2Controller<Row>;
    events: Array<[string, ...unknown[]]>;
    expandedKeys: Set<string>;
    hydratedIds: () => string[];
  } {
    const expandedKeys = new Set<string>();
    const events: Array<[string, ...unknown[]]> = [];
    const leaves = new Map<string, Row[]>([
      ['A/X', makeLeaves('ax', 2)],
      ['A/Y', makeLeaves('ay', 2)],
      ['B/Z', makeLeaves('bz', 2)],
    ]);
    const skeletonFn = opts.skeleton ?? (() => SKELETON);
    const host: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => COLS,
      getExpandedGroupKeys: () => Array.from(expandedKeys),
      setGroupKeys: () => {},
      setGrandTotals: (totals) => events.push(['grandTotals', totals]),
      setRowCount: (count) => events.push(['rowCount', count]),
      getRefreshRange: () => ({ rowStart: 0, rowEnd: 20 }),
      hydrateWindow: async (startRow, rows) => {
        events.push(['hydrate', { startRow, ids: rows.map((r) => (r as Row).id) }]);
      },
      applyTransaction: () => {},
      requestViewport: () => {},
      isDestroyed: () => false,
    };
    const ds: IServerSideDatasourceV2<Row> = {
      getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
      getGroupSkeleton: ({ success }) =>
        success({ groups: skeletonFn().map((g) => ({ ...g, path: [...g.path] })) }),
      getLeafRows: ({ request, success }) => {
        const rows = leaves.get(request.groupPath.join('/')) ?? [];
        success({ rowData: rows.slice(request.startRow, request.endRow) });
      },
      getGroupLeafIds: ({ request, success }) => {
        const key = request.groupPath.join('/');
        if (request.groupPath.length === 1) {
          const all = [...(leaves.get(`${key}/X`) ?? []), ...(leaves.get(`${key}/Y`) ?? []), ...(leaves.get(`${key}/Z`) ?? [])];
          success({ ids: all.map((r) => r.id) });
        } else {
          success({ ids: (leaves.get(key) ?? []).map((r) => r.id) });
        }
      },
    };
    const ctrl = new ServerSideRowModelV2Controller<Row>(host, {
      rowIdField: 'id',
      cacheBlockSize: 10,
      groupTotalRow: opts.groupTotalRow ?? null,
      grandTotalRow: opts.grandTotalRow ?? null,
      maintainOrder: opts.maintainOrder === true,
    });
    ctrl.setDatasource(ds);
    const hydratedIds = (): string[] => {
      const last = events.filter((e) => e[0] === 'hydrate').at(-1);
      return last ? (last[1] as { ids: string[] }).ids : [];
    };
    return { ctrl, events, expandedKeys, hydratedIds };
  }

  it('materializes footer + grand-total rows with stable ids and CSRM footer meta', async () => {
    const { ctrl, expandedKeys, hydratedIds } = build({
      groupTotalRow: 'bottom',
      grandTotalRow: 'bottom',
    });
    expandedKeys.add('region:A').add('region:A::desk:X');
    await ctrl.ensureRange(0, 20);
    expect(hydratedIds()).toEqual([
      '__grp__region:A',
      '__grp__region:A::desk:X', 'ax1', 'ax2', '__footer__region:A::desk:X',
      '__grp__region:A::desk:Y',
      '__footer__region:A',
      '__grp__region:B',
      '__grand_total__',
    ]);
  });

  it('ships skeleton root aggregates as grand totals; purge clears them', async () => {
    const { ctrl, events } = build();
    await ctrl.ensureRange(0, 20);
    expect(events.some((e) => e[0] === 'grandTotals'
      && JSON.stringify(e[1]) === JSON.stringify({ notional: 999 }))).toBe(true);
    events.length = 0;
    await ctrl.refresh({ purge: true });
    expect(events.some((e) => e[0] === 'grandTotals' && e[1] === null)).toBe(true);
  });

  it('maintainOrder pins sibling order across a reordered skeleton refetch', async () => {
    let flipped = false;
    const skeleton = (): SkeletonGroup[] => {
      const base = SKELETON.slice(1); // no root for simplicity
      return flipped ? [base[3]!, base[4]!, base[0]!, base[1]!, base[2]!] : base;
    };
    const pinned = build({ maintainOrder: true, skeleton });
    await pinned.ctrl.ensureRange(0, 20);
    flipped = true;
    await pinned.ctrl.refresh({ purge: false });
    await pinned.ctrl.ensureRange(0, 20);
    // A stays before B despite the refetched order flipping them.
    expect(pinned.hydratedIds()).toEqual(['__grp__region:A', '__grp__region:B']);

    flipped = false;
    const free = build({ skeleton });
    await free.ctrl.ensureRange(0, 20);
    flipped = true;
    await free.ctrl.refresh({ purge: false });
    await free.ctrl.ensureRange(0, 20);
    // Without the flag the new server order wins.
    expect(free.hydratedIds()).toEqual(['__grp__region:B', '__grp__region:A']);
  });

  it('fetchGroupLeafIds resolves descendant ids at any depth', async () => {
    const { ctrl } = build();
    await ctrl.ensureRange(0, 20);
    expect(await ctrl.fetchGroupLeafIds('region:A')).toEqual(['ax1', 'ax2', 'ay1', 'ay2']);
    expect(await ctrl.fetchGroupLeafIds('region:A::desk:X')).toEqual(['ax1', 'ax2']);
    expect(await ctrl.fetchGroupLeafIds('region:NOPE')).toBeNull();
  });
});

describe('full-grid sparse defaults + selection cascade', () => {
  interface Row { id: string; region: string; desk: string; notional: number }

  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    private listeners = new Set<(e: MessageEvent) => void>();
    private host = createWorkerHost((msg) => {
      queueMicrotask(() => {
        const ev = { data: msg } as MessageEvent;
        this.onmessage?.(ev);
        for (const l of this.listeners) l(ev);
      });
    });
    postMessage(msg: unknown): void { this.host.handle(msg as WorkerRequest); }
    terminate(): void {}
    addEventListener(type: string, cb: (e: MessageEvent) => void): void {
      if (type === 'message') this.listeners.add(cb);
    }
    removeEventListener(type: string, cb: (e: MessageEvent) => void): void {
      this.listeners.delete(cb);
    }
  }

  function waitFor(pred: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = (): void => {
        if (pred()) { resolve(); return; }
        if (Date.now() - start > timeoutMs) { reject(new Error(`timed out: ${label}`)); return; }
        setTimeout(tick, 5);
      };
      tick();
    });
  }

  function makeDs(): IServerSideDatasourceV2<Row> {
    const leafRows = (path: string[]): Row[] => {
      const tag = path.join('-');
      return [1, 2].map((i) => ({ id: `${tag}-${i}`, region: path[0]!, desk: path[1] ?? '', notional: i }));
    };
    return {
      getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
      getGroupSkeleton: ({ success }) => success({ groups: SKELETON.map((g) => ({ ...g, path: [...g.path] })) }),
      getLeafRows: ({ request, success }) =>
        success({ rowData: leafRows(request.groupPath).slice(request.startRow, request.endRow) }),
      getGroupLeafIds: ({ request, success }) => {
        if (request.groupPath.length === 2) {
          success({ ids: leafRows(request.groupPath).map((r) => r.id) });
        } else {
          const desks = request.groupPath[0] === 'A' ? ['X', 'Y'] : ['Z'];
          success({
            ids: desks.flatMap((d) => leafRows([request.groupPath[0]!, d]).map((r) => r.id)),
          });
        }
      },
    };
  }

  async function withGrid(
    extraOpts: Record<string, unknown>,
    run: (grid: VelocityGrid<Row>) => Promise<void>,
  ): Promise<void> {
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);
    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [
        { field: 'region', enableRowGroup: true },
        { field: 'desk', enableRowGroup: true },
        { field: 'notional', type: 'number', aggFunc: 'sum' },
      ],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      serverSideEnableClientSidePipeline: false,
      cacheBlockSize: 10,
      serverSideDatasource: makeDs(),
      ...extraOpts,
    } as never);
    try {
      grid.setRowGroupColumns(['region', 'desk']);
      await run(grid);
    } finally {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    }
  }

  it('groupDefaultExpanded: 1 opens exactly the first level (AG levels-open semantics)', async () => {
    await withGrid({ groupDefaultExpanded: 1 }, async (grid) => {
      // A, X, Y, B, Z — first level open, deepest collapsed, no leaves.
      await waitFor(() => grid.getDisplayedRowCount() === 5,
        `first level open (rows=${grid.getDisplayedRowCount()})`);
    });
  });

  it('groupDefaultExpanded: -1 opens everything including leaves', async () => {
    await withGrid({ groupDefaultExpanded: -1 }, async (grid) => {
      // 2 roots + 3 desks + 6 leaves = 11.
      await waitFor(() => grid.getDisplayedRowCount() === 11,
        `all open (rows=${grid.getDisplayedRowCount()})`);
    });
  });

  it('groupDefaultExpandedKeys opens exactly the listed keys', async () => {
    await withGrid({ groupDefaultExpanded: 0, groupDefaultExpandedKeys: ['region:A'] }, async (grid) => {
      // A open (X, Y visible, collapsed) + B collapsed = 4.
      await waitFor(() => grid.getDisplayedRowCount() === 4,
        `keyed default (rows=${grid.getDisplayedRowCount()})`);
    });
  });

  // Task 4 — depth-based expansion (`groupDefaultExpanded: N`) derives
  // depth from the composite key's segment count. A region value that
  // itself contains the raw level separator `::` must NOT be misread as
  // two levels — `sparseDefaultExpandedKeys` (velocityGrid.ts) must use
  // `splitGroupKey`, never a raw `key.split('::')`.
  it('depth-based expansion (N levels) is not corrupted by a group value containing "::"', async () => {
    const poisonSkeleton: SkeletonGroup[] = [
      { path: [], leafCount: 0, aggregates: { notional: 999 } },
      { path: ['A::weird'], leafCount: 2, aggregates: { notional: 20 } },
      { path: ['A::weird', 'X'], leafCount: 2, aggregates: { notional: 20 } },
    ];
    const leafRows = (path: string[]): Row[] => {
      const tag = path.join('-');
      return [1, 2].map((i) => ({ id: `${tag}-${i}`, region: path[0]!, desk: path[1] ?? '', notional: i }));
    };
    const ds: IServerSideDatasourceV2<Row> = {
      getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
      getGroupSkeleton: ({ success }) =>
        success({ groups: poisonSkeleton.map((g) => ({ ...g, path: [...g.path] })) }),
      getLeafRows: ({ request, success }) =>
        success({ rowData: leafRows(request.groupPath).slice(request.startRow, request.endRow) }),
    };
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);
    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [
        { field: 'region', enableRowGroup: true },
        { field: 'desk', enableRowGroup: true },
        { field: 'notional', type: 'number', aggFunc: 'sum' },
      ],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      serverSideEnableClientSidePipeline: false,
      cacheBlockSize: 10,
      serverSideDatasource: ds,
      groupDefaultExpanded: 1,
    } as never);
    try {
      grid.setRowGroupColumns(['region', 'desk']);
      // Only ONE top-level group ('A::weird') exists — first-level-open
      // (N=1) expands it, rendering its single depth-1 child ('X',
      // itself collapsed, no leaves). If the "::" inside the region
      // value corrupted depth computation, the top-level group would
      // be misclassified as depth 1 and stay unexpanded (rowCount 1)
      // instead of correctly expanding to show its child (rowCount 2).
      await waitFor(() => grid.getDisplayedRowCount() === 2,
        `first level open despite "::"-bearing value (rows=${grid.getDisplayedRowCount()})`);
      const keys = grid.getExpandedKeys();
      expect(keys.size).toBe(1);
      const [onlyKey] = [...keys];
      // Round-trips back to the exact original value via the escaped
      // vocabulary — not corrupted into two segments.
      expect(onlyKey).toBeDefined();
    } finally {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    }
  });

  it('group checkbox cascade selects unloaded descendant leaves via getGroupLeafIds', async () => {
    await withGrid({
      groupDefaultExpanded: 0,
      rowSelection: 'multiple',
      groupSelectsChildren: true,
    }, async (grid) => {
      await waitFor(() => grid.getDisplayedRowCount() === 2,
        `collapsed roots (rows=${grid.getDisplayedRowCount()})`);
      (grid as unknown as {
        cascadeGroupSelectionFromUi(key: string, selected: boolean): void;
      }).cascadeGroupSelectionFromUi('region:A', true);
      await waitFor(
        () => grid.getSelectedRowIds().length === 4,
        `cascade selected A's 4 leaves (got ${grid.getSelectedRowIds().length})`,
      );
      expect(grid.getSelectedRowIds().sort()).toEqual(['A-X-1', 'A-X-2', 'A-Y-1', 'A-Y-2']);
    });
  });
});
