import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';

/**
 * AG-Grid row-grouping parity fixes (2026-07-21 audit):
 *  1. `groupDefaultExpanded: -1` = expand ALL (AG semantics; was collapse-all).
 *  2. Null/empty group keys label as "(Blanks)".
 *  3. `groupHideParentOfSingleChild: true | 'leafGroupsOnly'`.
 *  4. Construction-time `colDef.rowGroup` / `rowGroupIndex` seed grouping.
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

interface Reply {
  id?: number;
  type: string;
  visibleCount?: number;
  chunk?: { groupValue?: string[] };
  [k: string]: unknown;
}

function makeHost(): { send: (msg: unknown) => void; waitFor: (id: number) => Promise<Reply> } {
  const replies: Reply[] = [];
  const host = createWorkerHost((msg) => {
    replies.push(msg as Reply);
  });
  return {
    send: (msg) => host.handle(msg as WorkerRequest),
    waitFor: async (id) => {
      for (let i = 0; i < 200; i++) {
        const hit = replies.find((r) => r.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 0));
      }
      throw new Error(`no worker reply for ${id}`);
    },
  };
}

const COLUMNS = [
  { colId: 'desk', field: 'desk', type: 'text' as const },
  { colId: 'region', field: 'region', type: 'text' as const },
];

describe('groupDefaultExpanded AG semantics', () => {
  async function visibleCountFor(groupDefaultExpanded: number): Promise<number> {
    const { send, waitFor } = makeHost();
    send({ id: 1, type: 'init', payload: { columns: COLUMNS, rowIdField: 'id', groupDefaultExpanded } });
    await waitFor(1);
    send({
      id: 2, type: 'setRowData',
      payload: { rows: [
        { id: 'r1', desk: 'FX', region: 'AMER' },
        { id: 'r2', desk: 'FX', region: 'EMEA' },
        { id: 'r3', desk: 'Rates', region: 'AMER' },
        { id: 'r4', desk: 'Rates', region: 'EMEA' },
      ] },
    });
    await waitFor(2);
    send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] } });
    const reply = await waitFor(3);
    return reply.visibleCount ?? -1;
  }

  it('-1 expands everything (AG parity — was collapse-all)', async () => {
    // 2 groups + 4 leaves, all expanded.
    expect(await visibleCountFor(-1)).toBe(6);
  });

  it('other negatives collapse everything', async () => {
    expect(await visibleCountFor(-2)).toBe(2);
  });

  it('0 opens nothing (AG levels-open semantics: N = number of levels open)', async () => {
    // AG parity 2026-07-21: N counts LEVELS OPEN, so 0 = all collapsed
    // (cgrid previously used depth <= N — off by one from ag-grid).
    expect(await visibleCountFor(0)).toBe(2);
  });

  it('1 opens exactly the first level', async () => {
    // 2 groups expanded → 4 leaves visible (single-level grouping).
    expect(await visibleCountFor(1)).toBe(6);
  });

  it('groupMaintainOrder locks group order against sorts', async () => {
    async function groupOrderFor(maintain: boolean): Promise<string[]> {
      const { send, waitFor } = makeHost();
      send({
        id: 1, type: 'init',
        payload: { columns: COLUMNS, rowIdField: 'id', groupMaintainOrder: maintain },
      });
      await waitFor(1);
      send({
        id: 2, type: 'setRowData',
        payload: { rows: [
          { id: 'r1', desk: 'Alpha', region: 'AMER' },
          { id: 'r2', desk: 'Zulu', region: 'EMEA' },
        ] },
      });
      await waitFor(2);
      send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] } });
      await waitFor(3);
      send({ id: 4, type: 'setSortModel', payload: [{ colId: 'desk', direction: 'desc' }] });
      await waitFor(4);
      send({ id: 5, type: 'getViewport', payload: { rowStart: 0, rowEnd: 10, columns: ['desk'] } });
      const reply = await waitFor(5);
      return (reply.chunk?.groupValue ?? []).filter((v) => v !== '');
    }
    // Without the flag, desk desc re-orders groups: Zulu before Alpha.
    expect(await groupOrderFor(false)).toEqual(['Zulu', 'Alpha']);
    // With it, the group pass order (Alpha, Zulu) survives the sort.
    expect(await groupOrderFor(true)).toEqual(['Alpha', 'Zulu']);
  });
});

describe('(Blanks) group label', () => {
  it('null group keys paint as "(Blanks)" instead of an empty label', async () => {
    const { send, waitFor } = makeHost();
    send({ id: 1, type: 'init', payload: { columns: COLUMNS, rowIdField: 'id' } });
    await waitFor(1);
    send({
      id: 2, type: 'setRowData',
      payload: { rows: [
        { id: 'r1', desk: 'FX', region: 'AMER' },
        { id: 'r2', desk: null, region: 'EMEA' },
      ] },
    });
    await waitFor(2);
    send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] } });
    await waitFor(3);
    send({
      id: 4, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 10, columns: ['desk', 'region'] },
    });
    const reply = await waitFor(4);
    expect(reply.chunk?.groupValue).toContain('(Blanks)');
    expect(reply.chunk?.groupValue).toContain('FX');
  });
});

describe('groupHideParentOfSingleChild', () => {
  /** desk A → region X (1 leaf); desk C → region W (1 leaf). A and C both
   *  funnel to a single leaf (childCount 1 at every level). */
  async function visibleCountWith(
    mode: boolean | 'leafGroupsOnly',
  ): Promise<number> {
    const { send, waitFor } = makeHost();
    send({
      id: 1, type: 'init',
      payload: { columns: COLUMNS, rowIdField: 'id', groupHideParentOfSingleChild: mode },
    });
    await waitFor(1);
    send({
      id: 2, type: 'setRowData',
      payload: { rows: [
        { id: 'r1', desk: 'A', region: 'X' },
        { id: 'r2', desk: 'C', region: 'W' },
      ] },
    });
    await waitFor(2);
    send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk', 'region'] } });
    const reply = await waitFor(3);
    return reply.visibleCount ?? -1;
  }

  it("true elides every single-child level (chains collapse to the leaf)", async () => {
    // A, X, C, W all elided → just the 2 leaf rows.
    expect(await visibleCountWith(true)).toBe(2);
  });

  it("'leafGroupsOnly' elides only leaf-level groups, keeping parents", async () => {
    // X and W (leaf-level, single child) elide; A and C stay → 4 rows.
    expect(await visibleCountWith('leafGroupsOnly')).toBe(4);
  });
});

describe('construction-time colDef.rowGroup seeding', () => {
  it('rowGroup / rowGroupIndex on columnDefs group at construction, ordered by index', async () => {
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = class FakeWorker {
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
    };

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const grid = new VelocityGrid(el, {
      columnDefs: [
        { field: 'desk', rowGroupIndex: 1 },
        { field: 'region', rowGroupIndex: 0 },
        { field: 'ticker' },
      ],
      getRowId: (r: { id: string }) => r.id,
      rowData: [
        { id: 'r1', desk: 'FX', region: 'AMER', ticker: 'AAPL' },
        { id: 'r2', desk: 'Rates', region: 'AMER', ticker: 'MSFT' },
      ],
    } as never);

    try {
      const start = Date.now();
      while (Date.now() - start < 4000) {
        const cols = grid.getRowGroupColumns();
        if (cols.length === 2) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      // rowGroupIndex 0 (region) orders before rowGroupIndex 1 (desk).
      expect(grid.getRowGroupColumns()).toEqual(['region', 'desk']);
    } finally {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    }
  }, 15000);
});
