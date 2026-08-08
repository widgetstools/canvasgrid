import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import { groupFooterCell } from '../src/renderer/cellRenderers/groupFooter';
import { buildAutoGroupColumn } from '../src/core/autoGroupColumn';

/**
 * AG-parity second wave (2026-07-21):
 *  1. `totalValueGetter` — custom footer labels via
 *     autoGroupColumnDef.cellRendererParams (AG rename of footerValueGetter).
 *  2. `keyCreator` — group-key derivation, worker-serialized like comparators.
 *  3. `groupAggFiltering` — filters evaluate group aggregates; passing
 *     groups include whole subtrees; chrome ancestors survive.
 *  4. `filter: 'agGroupColumnFilter'` — the auto-group column inherits the
 *     underlying grouped column's filter (field + type).
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

// ─── 1. totalValueGetter (painter unit) ─────────────────────────────────

describe('totalValueGetter footer label', () => {
  function paintLabel(params: unknown, valueFormatted: string): string {
    let painted = '';
    const gc = {
      cache: { fillStyle: '', font: '', textBaseline: '', textAlign: '', save() {}, restore() {}, globalAlpha: 1 },
      fillRect() {},
      fillText(text: string) { painted = text; },
    };
    groupFooterCell.paint(gc as never, {
      value: { kind: 'group', rowKind: 3, depth: 0, valueFormatted },
      valueFormatted: '',
      bounds: { x: 0, y: 0, w: 200, h: 24 },
      fg: '#fff', bg: '#000', prefillColor: '#000', font: '12px x',
      halign: 'left', borderColor: '#000',
      params,
    } as never);
    return painted;
  }

  it('defaults to `Total {value}` / `Total`', () => {
    expect(paintLabel(undefined, 'FX')).toBe('Total FX');
    expect(paintLabel(undefined, '')).toBe('Total');
  });

  it('totalValueGetter (cellRendererParams) customizes both forms', () => {
    const params = {
      totalValueGetter: (p: { value: string; isGrandTotal: boolean }) =>
        p.isGrandTotal ? 'GRAND TOTAL' : `Subtotal — ${p.value}`,
    };
    expect(paintLabel(params, 'FX')).toBe('Subtotal — FX');
    expect(paintLabel(params, '')).toBe('GRAND TOTAL');
  });
});

// ─── worker-host helper ─────────────────────────────────────────────────

interface Reply {
  id?: number;
  type: string;
  visibleCount?: number;
  chunk?: { groupValue?: string[]; totals?: Record<string, number> };
  [k: string]: unknown;
}

function makeHost(): { send: (m: unknown) => void; waitFor: (id: number) => Promise<Reply> } {
  const replies: Reply[] = [];
  const host = createWorkerHost((msg) => { replies.push(msg as Reply); });
  return {
    send: (m) => host.handle(m as WorkerRequest),
    waitFor: async (id) => {
      for (let i = 0; i < 200; i++) {
        const hit = replies.find((r) => r.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 0));
      }
      throw new Error(`no reply ${id}`);
    },
  };
}

// ─── 2. keyCreator ──────────────────────────────────────────────────────

describe('keyCreator', () => {
  it('groups by the creator-derived key and displays it as the group label', async () => {
    const { send, waitFor } = makeHost();
    send({
      id: 1, type: 'init',
      payload: {
        columns: [
          {
            colId: 'qty', field: 'qty', type: 'number',
            keyCreatorSource: '(p) => p.value > 100 ? "BIG" : "SMALL"',
          },
        ],
        rowIdField: 'id',
      },
    });
    await waitFor(1);
    send({
      id: 2, type: 'setRowData',
      payload: { rows: [
        { id: 'r1', qty: 50 },
        { id: 'r2', qty: 500 },
        { id: 'r3', qty: 60 },
      ] },
    });
    await waitFor(2);
    send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['qty'] } });
    const model = await waitFor(3);
    // 2 derived buckets (BIG, SMALL) + 3 leaves, all expanded by default.
    expect(model.visibleCount).toBe(5);
    send({ id: 4, type: 'getViewport', payload: { rowStart: 0, rowEnd: 10, columns: ['qty'] } });
    const vp = await waitFor(4);
    const labels = (vp.chunk?.groupValue ?? []).filter((v) => v !== '');
    expect(labels.sort()).toEqual(['BIG', 'SMALL']);
  });
});

// ─── 3. groupAggFiltering ───────────────────────────────────────────────

describe('groupAggFiltering', () => {
  const COLUMNS = [
    { colId: 'region', field: 'region', type: 'text' as const },
    { colId: 'desk', field: 'desk', type: 'text' as const },
    { colId: 'notional', field: 'notional', type: 'number' as const, aggFunc: 'sum' },
  ];
  /** R1: desk A (100+200=300), desk B (30); R2: desk C (30). */
  const ROWS = [
    { id: 'a1', region: 'R1', desk: 'A', notional: 100 },
    { id: 'a2', region: 'R1', desk: 'A', notional: 200 },
    { id: 'b1', region: 'R1', desk: 'B', notional: 30 },
    { id: 'c1', region: 'R2', desk: 'C', notional: 30 },
  ];

  async function visibleWith(aggFiltering: boolean, filterModel: unknown): Promise<number> {
    const { send, waitFor } = makeHost();
    send({
      id: 1, type: 'init',
      payload: { columns: COLUMNS, rowIdField: 'id', groupAggFiltering: aggFiltering },
    });
    await waitFor(1);
    send({ id: 2, type: 'setRowData', payload: { rows: ROWS } });
    await waitFor(2);
    send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['region', 'desk'] } });
    await waitFor(3);
    send({ id: 4, type: 'setFilterModel', payload: filterModel });
    const reply = await waitFor(4);
    return reply.visibleCount ?? -1;
  }

  it('a passing group keeps its WHOLE subtree; chrome ancestors survive', async () => {
    // sum(notional) < 100 → passes: desk B (30), region R2 (30, whole
    // subtree incl. desk C). R1 (330) fails but survives as chrome above B.
    // Visible: R1, B, b1  +  R2, C, c1  = 6.
    const model = { notional: { type: 'number', op: 'lt', value: 100 } };
    expect(await visibleWith(true, model)).toBe(6);
  });

  it('without the flag the same model filters leaves instead', async () => {
    // Leaf filter notional < 100: rows b1, c1 → R1/B + R2/C chains = 6?
    // leaves: b1 under R1/B, c1 under R2/C → R1, B, b1, R2, C, c1 = 6 —
    // same count here, so assert a model that DISTINGUISHES: gt 100.
    const gt = { notional: { type: 'number', op: 'gt', value: 100 } };
    // aggFiltering: passes → A (300), R1 (330): R1's whole subtree incl.
    // desk B chrome? A passes → subtree of A; R1 passes → WHOLE R1 subtree
    // (A + B + all leaves) = R1, A, a1, a2, B, b1 = 6; R2 (30) drops.
    expect(await visibleWith(true, gt)).toBe(6);
    // Leaf filtering: only a2 (200) passes → R1, A, a2 = 3.
    expect(await visibleWith(false, gt)).toBe(3);
  });
});

// ─── 4. agGroupColumnFilter ─────────────────────────────────────────────

describe('agGroupColumnFilter redirect', () => {
  it('auto-group def adopts the underlying column field + filter type', () => {
    const def = buildAutoGroupColumn({
      override: { filter: 'agGroupColumnFilter' },
      sourceColumns: [{ field: 'desk', filter: 'text' }],
    });
    expect(def.field).toBe('desk');
    expect(def.filter).toBe('text');
  });

  it('drops the filter affordance when there is no underlying field', () => {
    const def = buildAutoGroupColumn({
      override: { filter: 'agGroupColumnFilter' },
      sourceColumns: [],
    });
    expect(def.filter).toBeUndefined();
  });

  it('end-to-end: filtering the auto column filters by the grouped field', async () => {
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

    interface Row { id: string; desk: string; notional: number }
    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [
        { field: 'desk', enableRowGroup: true, filter: 'text' },
        { field: 'notional', type: 'number' },
      ],
      getRowId: (r: Row) => r.id,
      autoGroupColumnDef: { filter: 'agGroupColumnFilter' },
      rowData: [
        { id: 'r1', desk: 'FX', notional: 1 },
        { id: 'r2', desk: 'FX', notional: 2 },
        { id: 'r3', desk: 'Rates', notional: 3 },
      ],
    } as never);

    const waitFor = (pred: () => boolean, label: string): Promise<void> => {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const tick = (): void => {
          if (pred()) { resolve(); return; }
          if (Date.now() - start > 4000) { reject(new Error(`timed out: ${label}`)); return; }
          setTimeout(tick, 5);
        };
        tick();
      });
    };

    try {
      grid.setRowGroupColumns(['desk']);
      await waitFor(() => grid.getDisplayedRowCount() === 5,
        `grouped all-expanded (rows=${grid.getDisplayedRowCount()})`);

      // Filter through the AUTO column's colId — redirected to `desk`.
      grid.setFilterModel({ 'ag-Grid-AutoColumn': { type: 'text', op: 'contains', value: 'FX' } } as never);
      await waitFor(() => grid.getDisplayedRowCount() === 3,
        `auto-column filter applied (rows=${grid.getDisplayedRowCount()})`);
    } finally {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    }
  }, 15000);
});
