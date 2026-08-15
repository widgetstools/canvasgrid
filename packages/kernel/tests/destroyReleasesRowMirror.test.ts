import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';

/**
 * A-L4 (production hardening) — `destroy()` must release the main-thread
 * dataset mirror.
 *
 * `rowDataById` holds the whole book for a CSRM grid (and every hydrated row
 * for an SSRM one); `rowVersionByRowId`, `knownGroupKeys` and
 * `groupDescendantsByKey` scale with it. None of them were cleared in
 * `destroy()`, so a destroyed-but-still-referenced grid — held by an app
 * cache, an event closure, or a devtools retainer — pinned the entire dataset
 * for the life of the page.
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

interface Row { id: string; grp: string; v: number }

function installFakeWorker(): unknown {
  const orig = (globalThis as { Worker?: unknown }).Worker;
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
    removeEventListener(_type: string, cb: (e: MessageEvent) => void): void {
      this.listeners.delete(cb);
    }
  };
  return orig;
}

describe('A-L4 — destroy() releases the main-thread dataset mirror', () => {
  it('clears rowDataById, rowVersionByRowId, knownGroupKeys and groupDescendantsByKey', async () => {
    const origWorker = installFakeWorker();
    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
      id: `r${i}`, grp: `g${i % 5}`, v: i,
    }));

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'id' }, { field: 'grp' }, { field: 'v' }],
      getRowId: (r: Row) => r.id,
    } as never);

    grid.setRowData(rows);
    await waitFor(() => grid.getDisplayedRowCount() === rows.length, 'rows landed');

    const internals = grid as unknown as {
      rowDataById: Map<string, Row>;
      rowVersionByRowId: Map<string, number>;
      knownGroupKeys: string[];
      groupDescendantsByKey: Map<string, readonly string[]>;
    };

    // Pre-condition — the mirror really is populated (guards a vacuous pass).
    expect(internals.rowDataById.size).toBe(rows.length);
    internals.rowVersionByRowId.set('r0', 3);
    internals.knownGroupKeys = ['grp:g0'];
    internals.groupDescendantsByKey.set('grp:g0', ['r0']);

    grid.destroy();

    expect(internals.rowDataById.size).toBe(0);
    expect(internals.rowVersionByRowId.size).toBe(0);
    expect(internals.knownGroupKeys).toEqual([]);
    expect(internals.groupDescendantsByKey.size).toBe(0);

    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 20000);

  it('a second destroy() is still a no-op', async () => {
    const origWorker = installFakeWorker();
    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'id' }],
      getRowId: (r: Row) => r.id,
    } as never);
    grid.setRowData([{ id: 'a', grp: 'g', v: 1 }]);
    await waitFor(() => grid.getDisplayedRowCount() === 1, 'row landed');

    grid.destroy();
    expect(() => grid.destroy()).not.toThrow();

    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 20000);
});
