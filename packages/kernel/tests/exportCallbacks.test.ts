// Cycle 20 / Task 4 — process callbacks via name registry.
//
// `processCellCallback`, `processHeaderCallback`, and
// `processRowGroupCallback` transform values during export. Functions
// can't cross the postMessage boundary, so apps register callbacks at
// construction time keyed by name and reference them by name in
// export params:
//
//   const grid = new CGrid(host, {
//     exportCallbacks: {
//       formatPrice: ({ value }) => Number(value).toFixed(4),
//     },
//   });
//   await grid.getDataAsCsv({ processCellCallback: 'formatPrice' });
//
// The worker walks the rows + cells the same way as Task 3 + 5 but
// pipes each (value, colId, rowId) through the named callback before
// the writer sees it. The registry mirrors the
// Cycle 8 comparator-registry + Cycle 14 aggFunc-registry pattern.

import { describe, it, expect, beforeEach } from 'vitest';
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

interface Row { id: string; desk: string; pnl: number }
const ROWS: Row[] = [
  { id: '1', desk: 'APAC', pnl: 100.123 },
  { id: '2', desk: 'EMEA', pnl: 200.456 },
];

function buildGrid(opts: Record<string, unknown> = {}) {
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
      { field: 'pnl', headerName: 'PnL', cellDataType: 'number' },
    ],
    getRowId: (r) => r.id,
    rowData: ROWS,
    ...opts,
  });
  const restore = () => {
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('export callbacks — processCellCallback', () => {
  it('transforms cell values by callback name', async () => {
    const { grid, restore } = buildGrid({
      exportCallbacks: {
        formatPrice: ({ value }: { value: unknown }) => {
          if (typeof value !== 'number') return value;
          return `$${value.toFixed(2)}`;
        },
      },
    });
    await tick();
    const csv = await grid.getDataAsCsv({ processCellCallback: 'formatPrice' });
    expect(csv).toContain('$100.12');
    expect(csv).toContain('$200.46');
    // Headers don't go through processCellCallback — they're separate.
    expect(csv).toContain('Desk');
    expect(csv).toContain('PnL');
    grid.destroy();
    restore();
  });

  it('callback receives colId so it can switch on column', async () => {
    const seen: string[] = [];
    const { grid, restore } = buildGrid({
      exportCallbacks: {
        tagged: ({ value, colId }: { value: unknown; colId: string }) => {
          seen.push(colId);
          return `${colId}:${value}`;
        },
      },
    });
    await tick();
    const csv = await grid.getDataAsCsv({ processCellCallback: 'tagged' });
    expect(csv).toContain('desk:APAC');
    expect(csv).toContain('pnl:100.123');
    // Both columns were sampled.
    expect(new Set(seen)).toEqual(new Set(['desk', 'pnl']));
    grid.destroy();
    restore();
  });

  it('unknown callback name resolves to identity (no transform, no error)', async () => {
    const { grid, restore } = buildGrid({});
    await tick();
    const csv = await grid.getDataAsCsv({ processCellCallback: 'doesNotExist' });
    expect(csv).toContain('APAC,100.123');
    grid.destroy();
    restore();
  });
});

describe('export callbacks — processHeaderCallback', () => {
  it('transforms header labels by callback name', async () => {
    const { grid, restore } = buildGrid({
      exportCallbacks: {
        upper: ({ value }: { value: unknown }) => String(value).toUpperCase(),
      },
    });
    await tick();
    const csv = await grid.getDataAsCsv({ processHeaderCallback: 'upper' });
    expect(csv.split('\r\n')[0]).toBe('DESK,PNL');
    grid.destroy();
    restore();
  });
});

describe('export callbacks — XLSX path', () => {
  it('processCellCallback fires for the XLSX writer too', async () => {
    const { grid, restore } = buildGrid({
      exportCallbacks: {
        formatPrice: ({ value, colId }: { value: unknown; colId: string }) => {
          if (colId !== 'pnl' || typeof value !== 'number') return value;
          return `$${value.toFixed(2)}`;
        },
      },
    });
    await tick();
    const blob = await grid.getDataAsExcel({ processCellCallback: 'formatPrice' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Find the embedded XML text — the shared-strings part holds
    // every text cell. `$100.12` lives there once the callback fired.
    const text = new TextDecoder().decode(buf);
    expect(text).toContain('$100.12');
    expect(text).toContain('$200.46');
    grid.destroy();
    restore();
  });
});
