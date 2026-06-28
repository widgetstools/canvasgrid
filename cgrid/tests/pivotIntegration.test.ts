// Cycle 18 / Task 3 — pivot render integration (main thread, end-to-end).
//
// Drives a fully-wired CGrid (real worker host bridged into the fake
// Worker, same harness as cgrid.integration / groupExpand) and asserts
// that turning pivot mode on:
//   - synthesizes the secondary (pivot result) columns into the visible
//     column order, nested under pivot column groups;
//   - keeps the auto-group column as the row-dim axis and HIDES the
//     primary columns;
//   - renders the cross-tab aggregate on each group row's pivot cell
//     (read from chunk.pivotValues);
//   - reverts cleanly to the primary columns when pivot mode is turned off.
//
// Design note: docs/superpowers/plans/notes/cycle-18-pivoting-design.md (Task 3).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import { pivotResultColumnId, isPivotResultColumnId } from '../src/core/pivotColumns';
import { isAutoGroupColumnId } from '../src/core/autoGroupColumn';

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

interface Row { id: string; region: string; sector: string; pnl: number; qty: number }
const ROWS: Row[] = [
  { id: '1', region: 'EMEA', sector: 'TECH', pnl: 100, qty: 10 },
  { id: '2', region: 'EMEA', sector: 'TECH', pnl: 200, qty: 20 },
  { id: '3', region: 'EMEA', sector: 'FIN',  pnl: 300, qty: 30 },
  { id: '4', region: 'APAC', sector: 'TECH', pnl: 400, qty: 40 },
  { id: '5', region: 'APAC', sector: 'FIN',  pnl: 500, qty: 50 },
];
const COLS = [
  { field: 'id' },
  { field: 'region', enableRowGroup: true },
  { field: 'sector', enablePivot: true },
  { field: 'pnl', type: 'number', headerName: 'PnL', enableValue: true },
  { field: 'qty', type: 'number', headerName: 'Qty', enableValue: true },
];

function buildWiredGrid() {
  const container = document.createElement('div');
  container.style.cssText = 'width:900px; height:600px;';
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
    columnDefs: COLS as Parameters<typeof CGrid<Row>>[1]['columnDefs'],
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

/** Visible column ids in render order (white-box read of columnOrder). */
function orderIds(grid: CGrid<Row>): string[] {
  return (grid as unknown as { columnOrder: Array<{ colId: string }> }).columnOrder.map((c) => c.colId);
}

/** Resolve a group row's pivot cell value via the grid's private cellAt
 *  (the exact path the renderer paints through). Finds the group row whose
 *  composite key matches `groupKey` in the current chunk. */
function pivotCell(grid: CGrid<Row>, groupKey: string, pivotColId: string): unknown {
  const g = grid as unknown as {
    chunk: { rowStart: number; rowCount: number; rowKinds: Uint8Array; groupKey?: string[] };
    cellAt: (rowIndex: number, colId: string) => { value: unknown; valueFormatted: string } | null;
  };
  const chunk = g.chunk;
  for (let i = 0; i < chunk.rowCount; i++) {
    const kind = chunk.rowKinds[i] ?? 0;
    if (kind !== 1) continue; // group rows only
    if ((chunk.groupKey?.[i] ?? '') !== groupKey) continue;
    return g.cellAt(chunk.rowStart + i, pivotColId)?.value;
  }
  return undefined;
}

describe('CGrid pivot — render integration', () => {
  it('synthesizes pivot result columns, hides primaries, keeps auto-group column', async () => {
    const { grid, restore } = buildWiredGrid();
    await tick();
    grid.setGroupModel({ rowGroupCols: ['region'] });
    await tick();

    grid.setPivotColumns(['sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.setPivotMode(true);
    await tick();

    expect(grid.isPivotMode()).toBe(true);
    const ids = orderIds(grid);

    // Auto-group column kept as the row-dim axis.
    expect(ids.some((id) => isAutoGroupColumnId(id))).toBe(true);
    // Secondary columns synthesized: one per (pivot key × value column).
    const finPnl = pivotResultColumnId(['FIN'], 'pnl');
    const techPnl = pivotResultColumnId(['TECH'], 'pnl');
    expect(ids).toContain(finPnl);
    expect(ids).toContain(techPnl);
    // Primary data columns hidden while pivoting.
    expect(ids).not.toContain('sector');
    expect(ids).not.toContain('pnl');
    expect(ids).not.toContain('qty');
    expect(ids).not.toContain('id');
    // Every non-auto-group visible column is a pivot result column.
    for (const id of ids) {
      if (isAutoGroupColumnId(id)) continue;
      expect(isPivotResultColumnId(id)).toBe(true);
    }

    grid.destroy();
    restore();
  });

  it('renders cross-tab aggregates on group rows from pivotValues', async () => {
    const { grid, restore } = buildWiredGrid();
    await tick();
    grid.setGroupModel({ rowGroupCols: ['region'] });
    await tick();
    grid.setPivotColumns(['sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.setPivotMode(true);
    await tick();
    // Collapse so only group rows show — a clean pivot matrix.
    grid.collapseAll();
    await tick();

    const finPnl = pivotResultColumnId(['FIN'], 'pnl');
    const techPnl = pivotResultColumnId(['TECH'], 'pnl');
    // EMEA: TECH = 100+200 = 300, FIN = 300. APAC: TECH = 400, FIN = 500.
    expect(pivotCell(grid, 'region:EMEA', techPnl)).toBe(300);
    expect(pivotCell(grid, 'region:EMEA', finPnl)).toBe(300);
    expect(pivotCell(grid, 'region:APAC', techPnl)).toBe(400);
    expect(pivotCell(grid, 'region:APAC', finPnl)).toBe(500);

    grid.destroy();
    restore();
  });

  it('reverts to primary columns when pivot mode is turned off', async () => {
    const { grid, restore } = buildWiredGrid();
    await tick();
    grid.setGroupModel({ rowGroupCols: ['region'] });
    await tick();
    grid.setPivotColumns(['sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.setPivotMode(true);
    await tick();
    expect(orderIds(grid).some(isPivotResultColumnId)).toBe(true);

    grid.setPivotMode(false);
    await tick();

    expect(grid.isPivotMode()).toBe(false);
    const ids = orderIds(grid);
    // No synthetic pivot columns remain.
    expect(ids.some(isPivotResultColumnId)).toBe(false);
    // Primary columns restored (still grouped, so 'region' is auto-hidden;
    // the other primaries are back).
    expect(ids).toContain('sector');
    expect(ids).toContain('pnl');
    expect(ids).toContain('qty');

    grid.destroy();
    restore();
  });

  it('exposes pivot state through the imperative API', async () => {
    const { grid, restore } = buildWiredGrid();
    await tick();
    grid.setPivotColumns(['sector']);
    grid.addValueColumn('pnl', 'sum');
    expect(grid.getPivotColumns()).toEqual(['sector']);
    expect(grid.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'sum' }]);
    grid.addPivotColumn('region');
    expect(grid.getPivotColumns()).toEqual(['sector', 'region']);
    grid.removePivotColumn('sector');
    expect(grid.getPivotColumns()).toEqual(['region']);
    grid.setValueColumnAggFunc('pnl', 'avg');
    expect(grid.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'avg' }]);
    grid.removeValueColumn('pnl');
    expect(grid.getValueColumns()).toEqual([]);
    grid.destroy();
    restore();
  });
});
