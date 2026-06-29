// Cycle 20 / Task 3 — public export API on CGrid.
//
// Two pairs of methods:
//   - `exportDataAsCsv(params)` / `getDataAsCsv(params)`
//   - `exportDataAsExcel(params)` / `getDataAsExcel(params)`
//
// `exportDataAs*` triggers a browser download (createObjectURL +
// <a download> click). `getDataAs*` returns the bytes so the app can
// post to a server, preview, etc.
//
// Tests verify the worker round-trip + the API contracts. The
// download trigger is mocked via Anchor#click spy.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CGrid } from '../src/cgrid';
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
    return () => fakeCtx as CanvasRenderingContext2D;
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

interface Row { id: string; desk: string; region: string; pnl: number }
const ROWS: Row[] = [
  { id: '1', desk: 'APAC', region: 'Rates',  pnl: 100 },
  { id: '2', desk: 'EMEA', region: 'Credit', pnl: 200 },
  { id: '3', desk: 'AMER', region: 'Rates',  pnl:  50 },
];

function buildGrid() {
  const container = document.createElement('div');
  container.style.cssText = 'width:600px; height:400px;';
  container.className = 'cg-theme-quartz';
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
  const grid = new CGrid<Row>(container, {
    columnDefs: [
      { field: 'desk', headerName: 'Desk', cellDataType: 'text' },
      { field: 'region', headerName: 'Region', cellDataType: 'text' },
      { field: 'pnl', headerName: 'PnL', cellDataType: 'number' },
    ],
    getRowId: (r) => r.id,
    rowData: ROWS,
  });
  const restore = () => {
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('exportDataAs* / getDataAs* — CSV', () => {
  it('getDataAsCsv returns the full grid as a CSV string', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    const csv = await grid.getDataAsCsv();
    expect(csv).toContain('Desk,Region,PnL');
    expect(csv).toContain('APAC,Rates,100');
    expect(csv).toContain('EMEA,Credit,200');
    expect(csv).toContain('AMER,Rates,50');
    grid.destroy();
    restore();
  });

  it('getDataAsCsv honours columnKeys + custom separator', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    const csv = await grid.getDataAsCsv({ columnKeys: ['pnl', 'desk'], columnSeparator: '\t' });
    expect(csv.split('\r\n')[0]).toBe('PnL\tDesk');
    expect(csv).toContain('100\tAPAC');
    grid.destroy();
    restore();
  });

  it('exportDataAsCsv triggers a download via <a download>', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await grid.exportDataAsCsv({ fileName: 'trades.csv' });
    // `revokeObjectURL` is scheduled on a setTimeout(0); give it a tick.
    await tick(10);
    expect(urlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    urlSpy.mockRestore();
    revokeSpy.mockRestore();
    grid.destroy();
    restore();
  });
});

describe('exportDataAs* / getDataAs* — Excel', () => {
  it('getDataAsExcel returns a Blob with non-zero size', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    const blob = await grid.getDataAsExcel();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    // XLSX files start with the ZIP magic bytes — read the first 4
    // bytes and verify PK\x03\x04.
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 4);
    expect([head[0], head[1], head[2], head[3]]).toEqual([0x50, 0x4B, 0x03, 0x04]);
    grid.destroy();
    restore();
  });

  it('exportDataAsExcel triggers a download', async () => {
    const { grid, restore } = buildGrid();
    await tick();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await grid.exportDataAsExcel({ fileName: 'trades.xlsx' });
    await tick(10);
    expect(urlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    urlSpy.mockRestore();
    revokeSpy.mockRestore();
    grid.destroy();
    restore();
  });
});

afterEach(() => {});
