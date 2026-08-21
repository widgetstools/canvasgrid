import { describe, it, expect, beforeAll } from 'vitest';
import {
  VelocityGrid,
  inferRowIdField,
  SYNTHETIC_ROW_ID_FIELD,
} from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideGetRowsParams } from '../src/types/ssrm';

/**
 * B-A4 — arbitrary `getRowId`.
 *
 * `inferRowIdField` used to throw for anything that wasn't a single
 * `row => row.<field>` accessor, so a composite or computed row id could not
 * mount at all. It now falls back to a synthetic field which the grid
 * materializes on rows heading into the worker, keeping the worker's flat
 * `row[rowIdField]` lookup intact.
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

function waitFor(pred: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out: ${label}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

interface Row {
  a: string;
  b: number;
  notional: number;
}

describe('inferRowIdField', () => {
  it('captures the field in a single-level accessor', () => {
    expect(inferRowIdField((row: { id: string }) => row.id)).toBe('id');
  });

  it('falls back to the synthetic field for a nested accessor (row.meta.id)', () => {
    expect(inferRowIdField((row: { meta: { id: string } }) => row.meta.id))
      .toBe(SYNTHETIC_ROW_ID_FIELD);
  });

  it('falls back to the synthetic field for a deeply-nested accessor', () => {
    expect(inferRowIdField((row: { deeply: { nested: { field: string } } }) => row.deeply.nested.field))
      .toBe(SYNTHETIC_ROW_ID_FIELD);
  });

  it('falls back to the synthetic field for a composite accessor', () => {
    expect(inferRowIdField((row: Row) => `${row.a}:${row.b}`))
      .toBe(SYNTHETIC_ROW_ID_FIELD);
  });

  it('falls back to the synthetic field when no property access is present', () => {
    expect(inferRowIdField(() => 'literal')).toBe(SYNTHETIC_ROW_ID_FIELD);
  });

  it('falls back to the synthetic field for an accessor that references an unrelated property once (regression: StompPerspectiveProvider)', () => {
    // Shape of StompPerspectiveProvider.gridOptions()'s real getRowId — it
    // references `this.keyColumn` (one dot-token, nothing to do with the row
    // parameter) while deriving the actual id via a function call. A prior
    // "count the dots in the source" heuristic misread `this.keyColumn`'s
    // single `.keyColumn` token as a trivial `row.keyColumn` accessor and
    // pointed the worker's flat lookup at a field no row actually has —
    // every row got silently dropped as "missing rowIdField 'keyColumn'".
    const self = { keyColumn: 'positionId' };
    function composeId(row: Record<string, unknown>, keyColumn: string): string {
      return String(row[keyColumn]);
    }
    const getRowId = (r: Record<string, unknown>) => {
      const id = composeId(r, self.keyColumn);
      return id ?? '';
    };
    expect(inferRowIdField(getRowId)).toBe(SYNTHETIC_ROW_ID_FIELD);
  });

  it('still infers a trivial accessor with a block body and explicit return', () => {
    expect(inferRowIdField((row: { id: string }) => { return row.id; })).toBe('id');
  });
});

describe('SSRM with an arbitrary getRowId', () => {
  it('mounts and hydrates a datasource whose row id is composite', async () => {
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
      postMessage(msg: unknown): void {
        this.host.handle(msg as WorkerRequest);
      }
      terminate(): void {}
      addEventListener(type: string, cb: (e: MessageEvent) => void): void {
        if (type === 'message') this.listeners.add(cb);
      }
      removeEventListener(_type: string, cb: (e: MessageEvent) => void): void {
        this.listeners.delete(cb);
      }
    };

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const book: Row[] = Array.from({ length: 12 }, (_, i) => ({
      a: `desk${i % 3}`,
      b: i,
      notional: i * 10,
    }));
    const servedRows: Row[][] = [];

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'a' }, { field: 'b' }, { field: 'notional', type: 'number' }],
      // Composite id — `inferRowIdField` cannot reduce this to a field name.
      getRowId: (r: Row) => `${r.a}:${r.b}`,
      rowModelType: 'serverSide',
      cacheBlockSize: 100,
      serverSideDatasource: {
        getRows: ({ request, success }: IServerSideGetRowsParams<Row>) => {
          const rowData = book.slice(request.startRow, request.endRow);
          servedRows.push(rowData);
          success({ rowData, rowCount: book.length });
        },
      },
    } as never);

    await waitFor(() => grid.getDisplayedRowCount() === book.length, 'rows hydrated');

    // The worker sees rows carrying the materialized id, so its flat
    // `row[rowIdField]` lookup resolves the composite id.
    const first = await (grid as unknown as {
      workerCoord: {
        getRowByIndex(i: number): Promise<{ rowId: string | null; data: unknown | null }>;
      };
    }).workerCoord.getRowByIndex(0);
    expect(first.rowId).toBe('desk0:0');
    expect((first.data as Record<string, unknown>)[SYNTHETIC_ROW_ID_FIELD]).toBe('desk0:0');

    // The datasource itself was never asked to produce the synthetic field.
    expect(servedRows[0]?.[0]).not.toHaveProperty(SYNTHETIC_ROW_ID_FIELD);

    grid.destroy();
    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 15000);
});
