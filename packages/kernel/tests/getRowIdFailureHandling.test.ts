import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid, SYNTHETIC_ROW_ID_FIELD } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideGetRowsParams } from '../src/types/ssrm';

/**
 * fix-wave-4 Q5 / Q6.
 *
 * Q6 — `catch { id = ''; }` used to stamp EVERY row whose `getRowId` threw
 * with the same empty-string synthetic id, so they collided onto one
 * RowStore key and silently overwrote each other. A row that fails must be
 * dropped, not merged, and the failure must be surfaced once (not per row).
 *
 * `stampSyntheticRowIds` serves two structurally different callers and the
 * correct "drop" mechanic differs between them (verified against the real
 * call sites, not assumed from the finding's suggested wording):
 *  - `setRowData` / `applyTransaction` / `dispatchAsyncTransaction` hand an
 *    UNORDERED list straight to the worker's `RowStore.setAll` / `apply`,
 *    which resolve each row's id with NO per-row try/catch — an uncaught
 *    throw there aborts the WHOLE batch. The row must be filtered out of
 *    the array before it ever reaches the worker.
 *  - SSRM `hydrateWindow` hands a POSITIONAL window
 *    (`[startRow, startRow + rows.length)`); filtering an element would
 *    shift every following row to the wrong index. The worker's sparse
 *    hydrate path already resolves each row's id inside its own try/catch
 *    and just skips that slot, so the row is left in the array unstamped.
 *
 * Q5 — B-A4 removed the throw for a `getRowId` that isn't a simple
 * `row => row.<field>` accessor, but with it went the only signal that a
 * per-row `{...row}` clone is now happening on every row into the worker.
 * `usesSyntheticRowId()` must warn once (memoized), not per row.
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
}

function field(row: Row): unknown {
  return (row as unknown as Record<string, unknown>)[SYNTHETIC_ROW_ID_FIELD];
}

/** Lightweight grid for whitebox tests of `stampSyntheticRowIds` /
 *  `usesSyntheticRowId` — no worker traffic is exercised, so a spy stub
 *  (never processed) is enough. */
function makeGrid(getRowId: (r: Row) => string): VelocityGrid<Row> {
  const origWorker = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker: unknown }).Worker = class {
    listeners: Array<(e: { data: unknown }) => void> = [];
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: unknown }) => void): void => {
      this.listeners.push(cb);
    };
    terminate = vi.fn();
  };
  const el = document.createElement('div');
  el.style.cssText = 'width:800px; height:600px;';
  document.body.appendChild(el);
  const grid = new VelocityGrid<Row>(el, {
    columnDefs: [{ field: 'a' }, { field: 'b', type: 'number' }],
    getRowId,
  });
  (grid as unknown as { __origWorker?: unknown }).__origWorker = origWorker;
  return grid;
}

function restoreAfter(grid: VelocityGrid<Row>): void {
  const origWorker = (grid as unknown as { __origWorker?: unknown }).__origWorker;
  grid.destroy();
  (globalThis as { Worker?: unknown }).Worker = origWorker;
}

describe('stampSyntheticRowIds — a throwing getRowId drops, never merges', () => {
  it('positional (hydrateWindow): the row stays at its index, unstamped, not merged', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwFor = new Set([1, 3]);
    const getRowId = (r: Row): string => {
      if (throwFor.has(r.b)) throw new Error(`boom ${r.b}`);
      return `${r.a}:${r.b}`;
    };
    const grid = makeGrid(getRowId);
    const g = grid as unknown as {
      stampSyntheticRowIds(rows: Row[] | undefined, positional: boolean): Row[] | undefined;
    };
    const rows: Row[] = [0, 1, 2, 3, 4].map((b) => ({ a: 'x', b }));

    const out = g.stampSyntheticRowIds(rows, true)!;

    // Same length, same order — positions are never shifted.
    expect(out.length).toBe(5);
    expect(field(out[0]!)).toBe('x:0');
    // Failing rows are left WITHOUT a stamped id — never a shared ''.
    expect(field(out[1]!)).toBeUndefined();
    expect(field(out[2]!)).toBe('x:2');
    expect(field(out[3]!)).toBeUndefined();
    expect(field(out[4]!)).toBe('x:4');
    // Two failing rows in the SAME call — still only one warning.
    expect(errSpy).toHaveBeenCalledTimes(1);

    restoreAfter(grid);
    errSpy.mockRestore();
  });

  it('non-positional (setRowData / applyTransaction): the failing row is filtered out entirely', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwFor = new Set([1, 3]);
    const getRowId = (r: Row): string => {
      if (throwFor.has(r.b)) throw new Error(`boom ${r.b}`);
      return `${r.a}:${r.b}`;
    };
    const grid = makeGrid(getRowId);
    const g = grid as unknown as {
      stampSyntheticRowIds(rows: Row[] | undefined, positional: boolean): Row[] | undefined;
    };
    const rows: Row[] = [0, 1, 2, 3, 4].map((b) => ({ a: 'x', b }));

    const out = g.stampSyntheticRowIds(rows, false)!;

    // The two failing rows are gone — an unordered list can safely shrink
    // (unlike the positional window above); RowStore.setAll/apply have no
    // per-row guard, so leaving them in would throw mid-batch instead.
    expect(out.map((r) => field(r))).toEqual(['x:0', 'x:2', 'x:4']);
    expect(errSpy).toHaveBeenCalledTimes(1);

    restoreAfter(grid);
    errSpy.mockRestore();
  });

  it('the warning is deduped across calls too, not just within one', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getRowId = (r: Row): string => {
      if (r.b === 9) throw new Error('boom 9');
      return `${r.a}:${r.b}`;
    };
    const grid = makeGrid(getRowId);
    const g = grid as unknown as {
      stampSyntheticRowIds(rows: Row[] | undefined, positional: boolean): Row[] | undefined;
    };
    g.stampSyntheticRowIds([{ a: 'x', b: 9 }], true);
    g.stampSyntheticRowIds([{ a: 'x', b: 9 }], false);
    g.stampSyntheticRowIds([{ a: 'x', b: 9 }], true);
    expect(errSpy).toHaveBeenCalledTimes(1);

    restoreAfter(grid);
    errSpy.mockRestore();
  });
});

describe('usesSyntheticRowId — warns once naming the perf cost, never per row', () => {
  it('a composite accessor warns exactly once no matter how many times it is consulted', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = makeGrid((r: Row) => `${r.a}:${r.b}`);
    const g = grid as unknown as { usesSyntheticRowId(): boolean };

    expect(g.usesSyntheticRowId()).toBe(true);
    expect(g.usesSyntheticRowId()).toBe(true);
    expect(g.usesSyntheticRowId()).toBe(true);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/getRowId/);

    restoreAfter(grid);
    warnSpy.mockRestore();
  });

  it('a simple single-field accessor never warns (zero-cost common case)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = makeGrid((r: Row) => r.a);
    const g = grid as unknown as { usesSyntheticRowId(): boolean };

    expect(g.usesSyntheticRowId()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();

    restoreAfter(grid);
    warnSpy.mockRestore();
  });
});

describe('end-to-end: SSRM hydrateWindow — failing rows do not corrupt sibling rows', () => {
  it('good rows adjacent to failing ones keep their own distinct data', async () => {
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
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const book: Row[] = Array.from({ length: 12 }, (_, i) => ({ a: `desk${i % 3}`, b: i }));

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'a' }, { field: 'b', type: 'number' }],
      // Composite id — forces the synthetic-field path — and throws for
      // two specific rows in the window (simulating a bad record).
      getRowId: (r: Row) => {
        if (r.b === 3 || r.b === 7) throw new Error(`boom ${r.b}`);
        return `${r.a}:${r.b}`;
      },
      rowModelType: 'serverSide',
      cacheBlockSize: 100,
      serverSideDatasource: {
        getRows: ({ request, success }: IServerSideGetRowsParams<Row>) => {
          const rowData = book.slice(request.startRow, request.endRow);
          success({ rowData, rowCount: book.length });
        },
      },
    } as never);

    await waitFor(() => grid.getDisplayedRowCount() === book.length, 'rows hydrated');

    // The total count is unaffected — positions were never shifted.
    expect(grid.getDisplayedRowCount()).toBe(book.length);

    const wc = (grid as unknown as {
      workerCoord: {
        getRowByIndex(i: number): Promise<{ rowId: string | null; data: unknown | null }>;
      };
    }).workerCoord;

    // Rows adjacent to the two failing indices (3, 7) keep their OWN
    // correct, distinct data — proof the failures did not merge onto (or
    // shift into) a neighbor.
    const r2 = await wc.getRowByIndex(2);
    expect(r2.rowId).toBe('desk2:2');
    const r4 = await wc.getRowByIndex(4);
    expect(r4.rowId).toBe('desk1:4');
    const r6 = await wc.getRowByIndex(6);
    expect(r6.rowId).toBe('desk0:6');
    const r8 = await wc.getRowByIndex(8);
    expect(r8.rowId).toBe('desk2:8');

    // Two failing rows in one window — still just one console.error.
    expect(errSpy).toHaveBeenCalledTimes(1);

    grid.destroy();
    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
    errSpy.mockRestore();
  }, 15000);
});

describe('end-to-end: clientSide applyTransaction — a failing row does not abort the batch', () => {
  it('the failing row is dropped; every other row in the same batch still lands', async () => {
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
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    // Composite id, throws for b === 2 — an UNORDERED list this time
    // (clientSide setRowData / applyTransaction), not a positional window.
    // If a bad row were left unfiltered here, RowStore.setAll/apply (no
    // per-row try/catch) would throw mid-loop and abort the WHOLE batch —
    // this test fails loudly (timeout) if that regression is reintroduced.
    const getRowId = (r: Row): string => {
      if (r.b === 2) throw new Error('boom');
      return `${r.a}:${r.b}`;
    };
    const initial: Row[] = [0, 1, 2, 3, 4].map((b) => ({ a: 'x', b }));

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'a' }, { field: 'b', type: 'number' }],
      getRowId,
      rowData: initial,
    } as never);

    // 5 rows in, 1 fails → 4 land. Had the batch aborted instead, this
    // would time out at 0.
    await waitFor(() => grid.getDisplayedRowCount() === 4, 'initial load minus the bad row');

    // A transaction reusing the same failing key (b: 2) alongside two good
    // adds — the good ones must still land in the SAME transaction.
    grid.applyTransaction({
      add: [{ a: 'y', b: 0 }, { a: 'y', b: 1 }, { a: 'y', b: 2 }],
    });

    await waitFor(() => grid.getDisplayedRowCount() === 6, '2 of 3 transaction adds land');

    expect(errSpy).toHaveBeenCalledTimes(1);

    grid.destroy();
    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
    errSpy.mockRestore();
  }, 15000);
});
