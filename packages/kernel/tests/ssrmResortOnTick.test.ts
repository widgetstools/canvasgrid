import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

/**
 * Sparse SSRM patches live ticks in place and keeps server order fixed.
 * When a sort is active and a sorted column's value changes, the grid must
 * soft-refresh so getRows re-applies sort (AG SSRM parity).
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
  HTMLCanvasElement.prototype.getContext = (() => ({
    scale() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    fill() {},
    stroke() {},
    fillRect() {},
    clearRect() {},
    fillText() {},
    measureText: () => ({ width: 0 }),
    setTransform() {},
    translate() {},
    clip() {},
    arc() {},
    canvas: { width: 1, height: 1 },
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  document.body.replaceChildren();
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mountGrid() {
  const origWorker = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker: unknown }).Worker = class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    private host = createWorkerHost((msg, _xfer) => {
      queueMicrotask(() => this.onmessage?.({ data: msg } as MessageEvent));
    });
    postMessage(msg: unknown) {
      this.host.onmessage?.({ data: msg } as MessageEvent);
    }
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  };

  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '400px';
  document.body.appendChild(el);

  const grid = new VelocityGrid(el, {
    columnDefs: [
      { field: 'symbol' },
      { field: 'pnl', type: 'number' },
    ],
    getRowId: (r: { id: string }) => r.id,
    rowData: [
      { id: 'a', symbol: 'AAA', pnl: 10 },
      { id: 'b', symbol: 'BBB', pnl: 20 },
    ],
  } as never);

  // Install a stub SSRM controller so applyServerSideTransaction routes
  // through the sparse-SSRM dispatch path without waiting on async mount.
  const fakeSsrm = {
    applyServerSideTransaction: vi.fn(),
    refresh: vi.fn(async () => undefined),
    destroy: vi.fn(),
  };
  (grid as unknown as { ssrm: unknown; ssrmClientPipeline: boolean }).ssrm = fakeSsrm;
  (grid as unknown as { ssrmClientPipeline: boolean }).ssrmClientPipeline = false;

  return {
    grid,
    fakeSsrm,
    restore: () => {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    },
  };
}

describe('SSRM re-sort on live tick', () => {
  it('soft-refreshes when an active sort column value changes via applyServerSideTransaction', async () => {
    const { grid, fakeSsrm, restore } = mountGrid();
    // Construction-time rowData lands async on gridReady — seed the mirror
    // the way a prior SSRM hydrate / tick would.
    const mirror = (grid as unknown as { rowDataById: Map<string, unknown> }).rowDataById;
    mirror.set('a', { id: 'a', symbol: 'AAA', pnl: 10 });
    mirror.set('b', { id: 'b', symbol: 'BBB', pnl: 20 });

    grid.setSortModel([{ colId: 'pnl', direction: 'desc' }]);
    const refreshSpy = vi.spyOn(grid, 'refreshServerSide');
    refreshSpy.mockClear();

    // Unrelated column — must not schedule a resort refresh.
    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAZ', pnl: 10 }] });
    expect(fakeSsrm.applyServerSideTransaction).toHaveBeenCalled();
    await sleep(120);
    expect(refreshSpy).not.toHaveBeenCalled();

    // Sorted column changes — trailing debounce soft-refreshes once.
    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAZ', pnl: 99 }] });
    expect(refreshSpy).not.toHaveBeenCalled();
    await sleep(250);
    expect(refreshSpy).toHaveBeenCalledWith({ purge: false });

    restore();
  });

  it('does not soft-refresh when unsorted (preserves cell-flash tx path)', async () => {
    const { grid, restore } = mountGrid();
    const mirror = (grid as unknown as { rowDataById: Map<string, unknown> }).rowDataById;
    mirror.set('a', { id: 'a', symbol: 'AAA', pnl: 10 });

    const refreshSpy = vi.spyOn(grid, 'refreshServerSide');
    refreshSpy.mockClear();

    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAA', pnl: 11 }] });
    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAA', pnl: 12 }] });
    await sleep(250);
    expect(refreshSpy).not.toHaveBeenCalled();

    restore();
  });

  it('coalesces rapid sort-key ticks into one soft refresh', async () => {
    const { grid, restore } = mountGrid();
    const mirror = (grid as unknown as { rowDataById: Map<string, unknown> }).rowDataById;
    mirror.set('a', { id: 'a', symbol: 'AAA', pnl: 10 });

    grid.setSortModel([{ colId: 'pnl', direction: 'asc' }]);
    const refreshSpy = vi.spyOn(grid, 'refreshServerSide');
    refreshSpy.mockClear();

    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAA', pnl: 11 }] });
    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAA', pnl: 12 }] });
    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAA', pnl: 13 }] });
    await sleep(250);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith({ purge: false });

    restore();
  });

  it('still soft-refreshes under continuous sort-key ticks (maxWait)', async () => {
    // Pure trailing debounce never fires when ticks keep resetting it —
    // live blotters tick the sort column continuously.
    const { grid, restore } = mountGrid();
    const mirror = (grid as unknown as { rowDataById: Map<string, unknown> }).rowDataById;
    mirror.set('a', { id: 'a', symbol: 'AAA', pnl: 10 });

    grid.setSortModel([{ colId: 'pnl', direction: 'desc' }]);
    const refreshSpy = vi.spyOn(grid, 'refreshServerSide');
    refreshSpy.mockClear();

    let pnl = 10;
    const iv = setInterval(() => {
      pnl += 1;
      grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAA', pnl }] });
    }, 40);
    await sleep(450);
    clearInterval(iv);
    await sleep(50);
    expect(refreshSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(refreshSpy).toHaveBeenCalledWith({ purge: false });

    restore();
  });

  it('soft-refreshes on sort-key change even when visible-band order looks stable', async () => {
    // Off-screen rows can rise into the viewport when a sort key changes;
    // gating on visible-band order alone would miss that and leave rows stuck.
    const { grid, restore } = mountGrid();
    const internal = grid as unknown as {
      rowDataById: Map<string, unknown>;
      chunk: { stringRowIds: string[]; rowIds: Uint32Array; rowCount: number; rowStart: number } | null;
    };
    internal.rowDataById.set('a', { id: 'a', symbol: 'AAA', pnl: 10 });
    internal.rowDataById.set('b', { id: 'b', symbol: 'BBB', pnl: 20 });
    internal.chunk = {
      rowStart: 0,
      rowCount: 2,
      rowIds: new Uint32Array([1, 2]),
      stringRowIds: ['a', 'b'],
    };

    grid.setSortModel([{ colId: 'pnl', direction: 'asc' }]);
    const refreshSpy = vi.spyOn(grid, 'refreshServerSide');
    refreshSpy.mockClear();

    // Visible order unchanged (a stays above b) — still must soft-refresh.
    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAA', pnl: 15 }] });
    await sleep(250);
    expect(refreshSpy).toHaveBeenCalledWith({ purge: false });

    restore();
  });

  it('does not treat omitted sort fields as a sort-key change', async () => {
    const { grid, restore } = mountGrid();
    const mirror = (grid as unknown as { rowDataById: Map<string, unknown> }).rowDataById;
    mirror.set('a', { id: 'a', symbol: 'AAA', pnl: 10 });

    grid.setSortModel([{ colId: 'pnl', direction: 'asc' }]);
    const refreshSpy = vi.spyOn(grid, 'refreshServerSide');
    refreshSpy.mockClear();

    // Thin tick without pnl — must not soft-refresh.
    grid.applyServerSideTransaction({ update: [{ id: 'a', symbol: 'AAZ' }] as never });
    await sleep(250);
    expect(refreshSpy).not.toHaveBeenCalled();

    restore();
  });
});
