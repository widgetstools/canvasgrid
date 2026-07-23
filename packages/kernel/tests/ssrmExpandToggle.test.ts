import { describe, it, expect, beforeAll, vi } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';

/**
 * Sparse SSRM + groupDefaultExpanded:0 — first expand must open ONLY the
 * clicked group. Regression: null expandedKeys materialised knownGroupKeys
 * (CSRM expand-all) then removed the clicked key, expanding every other desk.
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

function buildWiredSparseSsrmGrid(): { grid: CGrid; restore: () => void } {
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

  const grid = new CGrid(el, {
    columnDefs: [
      { field: 'desk', enableRowGroup: true },
      { field: 'notional', type: 'number', aggFunc: 'sum' },
    ],
    getRowId: (r: { positionId?: string }) => String(r.positionId ?? ''),
    rowModelType: 'serverSide',
    serverSideEnableClientSidePipeline: false,
    groupDefaultExpanded: 0,
    serverSideDatasource: {
      getRows: (params: { success: (r: { rowData: unknown[]; rowCount: number }) => void }) => {
        params.success({ rowData: [], rowCount: 0 });
      },
    },
  } as never);

  // Simulate Perspective mergeGroupKeys after first grouped getRows.
  const internal = grid as unknown as {
    knownGroupKeys: string[];
    expandedKeys: Set<string> | null;
    toggleGroupExpandedFromUi: (key: string) => void;
  };
  internal.knownGroupKeys = [
    'desk:Credit Trading',
    'desk:Equity Derivatives',
    'desk:FX Trading',
  ];
  internal.expandedKeys = null;

  return {
    grid,
    restore: () => {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    },
  };
}

describe('sparse SSRM expand toggle', () => {
  it('first UI toggle expands only the clicked desk (not every other known key)', () => {
    const { grid, restore } = buildWiredSparseSsrmGrid();
    const internal = grid as unknown as {
      toggleGroupExpandedFromUi: (key: string) => void;
    };

    expect(grid.getExpandedKeys().size).toBe(0);

    // Spy shipExpandedKeys path — ssrm.refresh may reject without hydrate; we
    // only care about the expandedKeys mirror after the click.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    internal.toggleGroupExpandedFromUi('desk:Credit Trading');

    const keys = grid.getExpandedKeys();
    expect(keys.has('desk:Credit Trading')).toBe(true);
    expect(keys.has('desk:Equity Derivatives')).toBe(false);
    expect(keys.has('desk:FX Trading')).toBe(false);
    expect(keys.size).toBe(1);
    restore();
  });

  it('setExpanded(true) from null expands only that key', () => {
    const { grid, restore } = buildWiredSparseSsrmGrid();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    grid.setExpanded('desk:Credit Trading', true);
    expect([...grid.getExpandedKeys()]).toEqual(['desk:Credit Trading']);
    restore();
  });
});
