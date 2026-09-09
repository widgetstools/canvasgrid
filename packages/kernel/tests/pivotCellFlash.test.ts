/**
 * Cell flash under pivot mode.
 *
 * A pivot cross-tab replaces the primary columns with synthesized pivot
 * result columns, and those cells read their value from `chunk.pivotValues`
 * — not from `groupTotals`, which is the only thing `diffAggregates` looked
 * at. So `groupFlashMap` could only ever hold real column ids, and
 * `groupFlashAlpha(groupKey, pivotColId)` in `applyCellProps` never resolved.
 * The paint side was wired the whole time; nothing wrote the entry.
 *
 * The effect: with `enableCellChangeFlash` on, pivot mode measured the only
 * cells on screen and none of them could flash. Confirmed on both demos
 * before the fix — the flash map held `pnl`/`marketValue`/`dailyPnl` and
 * never one `pivotcol…` id, while the pivot values themselves ticked on
 * every sample.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import { pivotResultColumnId } from '../src/core/pivotColumns';

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: Record<string, unknown> = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as CanvasRenderingContext2D;
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

interface Row { id: string; region: string; sector: string; pnl: number }
const ROWS: Row[] = [
  { id: '1', region: 'EMEA', sector: 'TECH', pnl: 100 },
  { id: '2', region: 'EMEA', sector: 'FIN', pnl: 300 },
  { id: '3', region: 'APAC', sector: 'TECH', pnl: 400 },
];
const COLS = [
  { field: 'id' },
  { field: 'region', enableRowGroup: true },
  { field: 'sector', enablePivot: true },
  { field: 'pnl', type: 'number', enableValue: true },
];

function buildWiredGrid() {
  const container = document.createElement('div');
  container.style.cssText = 'width:900px; height:600px;';
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
    columnDefs: COLS as Parameters<typeof VelocityGrid<Row>>[1]['columnDefs'],
    getRowId: (r) => r.id,
    rowData: ROWS,
    enableCellChangeFlash: true,
  });
  const restore = () => {
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** Column ids currently carrying a live flash entry, whatever their group. */
function flashedColumns(grid: VelocityGrid<Row>): string[] {
  const NUL = String.fromCharCode(0);
  const map = (grid as unknown as { groupFlashMap: Map<string, number> }).groupFlashMap;
  const out = new Set<string>();
  for (const key of map.keys()) {
    const i = key.indexOf(NUL);
    out.add(i >= 0 ? key.slice(i + 1) : key);
  }
  return [...out];
}

async function pivotedGrid() {
  const built = buildWiredGrid();
  await tick();
  built.grid.setGroupModel({ rowGroupCols: ['region'] });
  await tick();
  built.grid.setPivotColumns(['sector']);
  built.grid.addValueColumn('pnl', 'sum');
  built.grid.setPivotMode(true);
  await tick(120);
  return built;
}

describe('pivot cells flash when their cross-tab value changes', () => {
  it('a changed pivot value marks its OWN synthesized column', async () => {
    const { grid, restore } = await pivotedGrid();
    expect(grid.isPivotMode()).toBe(true);
    const techPnl = pivotResultColumnId(['TECH'], 'pnl');

    (grid as unknown as { groupFlashMap: Map<string, number> }).groupFlashMap.clear();
    // Move one EMEA/TECH row's pnl — only the EMEA × TECH cell changes.
    grid.applyTransaction({ update: [{ id: '1', region: 'EMEA', sector: 'TECH', pnl: 999 }] });
    await tick(150);

    expect(flashedColumns(grid)).toContain(techPnl);
    grid.destroy();
    restore();
  });

  it('the flash is keyed to the group row whose value moved', async () => {
    const { grid, restore } = await pivotedGrid();
    const NUL = String.fromCharCode(0);
    const techPnl = pivotResultColumnId(['TECH'], 'pnl');
    const map = (grid as unknown as { groupFlashMap: Map<string, number> }).groupFlashMap;
    map.clear();
    grid.applyTransaction({ update: [{ id: '1', region: 'EMEA', sector: 'TECH', pnl: 999 }] });
    await tick(150);

    // Some key must name this column; its group half is what addresses the
    // row, so an entry with no group key at all would flash nothing.
    const forCol = [...map.keys()].filter((k) => k.endsWith(NUL + techPnl));
    expect(forCol.length).toBeGreaterThan(0);
    grid.destroy();
    restore();
  });

  it('does nothing when the flash feature is off', async () => {
    // The whole block is gated on `enableCellChangeFlash`; a grid without it
    // must not accumulate entries (they would drive damage for no paint).
    const container = document.createElement('div');
    container.style.cssText = 'width:900px; height:600px;';
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
      columnDefs: COLS as Parameters<typeof VelocityGrid<Row>>[1]['columnDefs'],
      getRowId: (r) => r.id,
      rowData: ROWS,
      // enableCellChangeFlash omitted
    });
    await tick();
    grid.setGroupModel({ rowGroupCols: ['region'] });
    await tick();
    grid.setPivotColumns(['sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.setPivotMode(true);
    await tick(120);
    grid.applyTransaction({ update: [{ id: '1', region: 'EMEA', sector: 'TECH', pnl: 999 }] });
    await tick(150);

    expect(flashedColumns(grid)).toEqual([]);
    grid.destroy();
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  });
});
