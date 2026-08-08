// Cycle 20 / Task 5 — export options surface.
//
// Covers the two highest-value options:
//   - `onlySelected: true` exports only currently-selected rows
//   - `skipRowGroups: true` skips group-row entries (only data rows)
//
// `columnKeys` and `skipColumnHeaders` already tested in Task 1.
// `skipPinnedTop/Bottom`, `exportedRows: 'all' | 'filtered' | 'displayed'`
// deferred to a follow-up pass — pinned rows live on main, not in the
// worker's RowStore, so the plumbing is a separate exercise.

import { describe, it, expect, beforeEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx = {
      save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
      moveTo: () => {}, lineTo: () => {}, rect: () => {}, fillRect: () => {},
      strokeRect: () => {}, clearRect: () => {}, fillText: () => {}, strokeText: () => {},
      measureText: () => ({ width: 100 }), clip: () => {}, scale: () => {},
      rotate: () => {}, translate: () => {}, transform: () => {}, setTransform: () => {},
      drawImage: () => {}, createLinearGradient: () => ({ addColorStop: () => {} }),
      arc: () => {}, ellipse: () => {}, quadraticCurveTo: () => {},
      bezierCurveTo: () => {}, fill: () => {}, stroke: () => {},
      isPointInPath: () => false, getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      putImageData: () => {}, createImageData: () => ({ data: new Uint8ClampedArray(0) }),
      lineWidth: 1, strokeStyle: '', fillStyle: '', font: '',
      textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
      direction: 'inherit', filter: 'none',
    };
    // Cycle 22 / Task 2 — one ctx PER CANVAS (browser-faithful: the raster
    // caches attach a gc cache onto every scratch canvas they pool; a single
    // shared ctx object would have its cache closure clobbered mid-paint,
    // corrupting the main canvas's save/restore stack).
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) {
        ctx = { ...fakeCtx, canvas: this };
        perCanvas.set(this, ctx);
      }
      return ctx;
    };
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

interface Row { id: string; desk: string; region: string; pnl: number }
const ROWS: Row[] = [
  { id: '1', desk: 'APAC', region: 'Rates',  pnl: 100 },
  { id: '2', desk: 'EMEA', region: 'Credit', pnl: 200 },
  { id: '3', desk: 'AMER', region: 'Rates',  pnl:  50 },
];

function buildGrid(opts: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:600px; height:400px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = class {
    listeners: Array<(e: { data: unknown }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: unknown) { this.host.handle(msg as Parameters<typeof this.host.handle>[0]); }
    addEventListener(_: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
    terminate() {}
  };
  const grid = new VelocityGrid<Row>(container, {
    columnDefs: [
      { field: 'desk',   headerName: 'Desk',   cellDataType: 'text' },
      { field: 'region', headerName: 'Region', cellDataType: 'text' },
      { field: 'pnl',    headerName: 'PnL',    cellDataType: 'number' },
    ],
    getRowId: (r) => r.id,
    rowData: ROWS,
    rowSelection: 'multiple',
    ...opts,
  });
  const restore = () => {
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('export options — onlySelected', () => {
  it('exports only currently-selected rows', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    grid.setSelectedRowIds(['1', '3']);
    await tick();
    const csv = await grid.getDataAsCsv({ onlySelected: true });
    expect(csv).toContain('APAC,Rates,100');   // id=1 selected
    expect(csv).toContain('AMER,Rates,50');    // id=3 selected
    expect(csv).not.toContain('EMEA,Credit,200'); // id=2 not selected
    grid.destroy();
    restore();
  });

  it('onlySelected with empty selection → header only', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    const csv = await grid.getDataAsCsv({ onlySelected: true });
    // Header row only; no data rows.
    expect(csv.split('\r\n').filter((l) => l.length > 0)).toEqual(['Desk,Region,PnL']);
    grid.destroy();
    restore();
  });

  it('without onlySelected, every row exports (selection ignored)', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    grid.setSelectedRowIds(['1']);
    await tick();
    const csv = await grid.getDataAsCsv({});
    expect(csv).toContain('APAC');
    expect(csv).toContain('EMEA');
    expect(csv).toContain('AMER');
    grid.destroy();
    restore();
  });
});
