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

  it('pivotMaxGeneratedColumns breach fires the pivotMaxColumnsReached event AND pivot result columns are NOT synthesized (Task 8a)', async () => {
    const { grid, restore } = buildWiredGrid();
    await tick();
    grid.setGroupModel({ rowGroupCols: ['region'] });
    await tick();

    const breaches: Array<{ generatedColumns: number; cap: number }> = [];
    grid.on('pivotMaxColumnsReached' as never, ((e: {
      type: 'pivotMaxColumnsReached'; generatedColumns: number; cap: number;
    }) => {
      breaches.push({ generatedColumns: e.generatedColumns, cap: e.cap });
    }) as never);

    // 2 leaves (FIN+TECH) × 2 value cols (pnl+qty) = 4. Cap at 3 forces the breach.
    grid.setGridOption('pivotMaxGeneratedColumns', 3);
    grid.setPivotColumns(['sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.addValueColumn('qty', 'sum');
    grid.setPivotMode(true);
    await tick();
    await tick();

    expect(breaches.length).toBeGreaterThanOrEqual(1);
    const last = breaches[breaches.length - 1]!;
    expect(last.generatedColumns).toBe(4);
    expect(last.cap).toBe(3);

    // Pivot output bypassed → no pivot result columns synthesized.
    const ids = orderIds(grid);
    expect(ids.some(isPivotResultColumnId)).toBe(false);

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

  // Cycle 18 / Task 4 — pivot column-group expand / collapse.
  //
  // Wires the full CGrid → real worker host on a 2-level pivot (Sector ×
  // AssetClass). Asserts the collapsed-state defaults (only the per-Sector
  // total leaves visible, rolled-up aggregates correct), then toggles a
  // pivot group through `toggleColumnGroup` (the same call the canvas
  // header click dispatches) and verifies the child columns
  // appear / disappear and the column-order count tracks the change.
  //
  // Design note: docs/superpowers/plans/notes/cycle-18-pivoting-design.md (Task 4).
  describe('pivot column-group expand / collapse', () => {
    interface SubRow {
      id: string;
      region: string;
      sector: string;
      assetClass: string;
      pnl: number;
    }
    const SUB_ROWS: SubRow[] = [
      { id: '1', region: 'EMEA', sector: 'TECH', assetClass: 'EQ',   pnl: 100 },
      { id: '2', region: 'EMEA', sector: 'TECH', assetClass: 'BOND', pnl: 200 },
      { id: '3', region: 'EMEA', sector: 'FIN',  assetClass: 'EQ',   pnl: 300 },
      { id: '4', region: 'APAC', sector: 'TECH', assetClass: 'EQ',   pnl: 400 },
      { id: '5', region: 'APAC', sector: 'FIN',  assetClass: 'EQ',   pnl: 500 },
      { id: '6', region: 'APAC', sector: 'TECH', assetClass: 'BOND', pnl: 600 },
    ];
    const SUB_COLS = [
      { field: 'id' },
      { field: 'region', enableRowGroup: true },
      { field: 'sector', enablePivot: true },
      { field: 'assetClass', enablePivot: true },
      { field: 'pnl', type: 'number', headerName: 'PnL', enableValue: true },
    ];

    function buildSubGrid() {
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
      const grid = new CGrid<SubRow>(container, {
        columnDefs: SUB_COLS as Parameters<typeof CGrid<SubRow>>[1]['columnDefs'],
        getRowId: (r) => r.id,
        rowData: SUB_ROWS,
      });
      const restore = () => {
        (globalThis as { Worker?: unknown }).Worker = prevWorker;
        container.remove();
      };
      return { grid, restore };
    }

    function subOrderIds(grid: CGrid<SubRow>): string[] {
      return (grid as unknown as { columnOrder: Array<{ colId: string }> }).columnOrder.map((c) => c.colId);
    }

    function subPivotCell(grid: CGrid<SubRow>, groupKey: string, pivotColId: string): unknown {
      const g = grid as unknown as {
        chunk: { rowStart: number; rowCount: number; rowKinds: Uint8Array; groupKey?: string[] };
        cellAt: (rowIndex: number, colId: string) => { value: unknown; valueFormatted: string } | null;
      };
      const chunk = g.chunk;
      for (let i = 0; i < chunk.rowCount; i++) {
        if ((chunk.rowKinds[i] ?? 0) !== 1) continue;
        if ((chunk.groupKey?.[i] ?? '') !== groupKey) continue;
        return g.cellAt(chunk.rowStart + i, pivotColId)?.value;
      }
      return undefined;
    }

    it('collapsed-by-default: shows only per-sector group total leaves with rolled-up aggregates', async () => {
      const { grid, restore } = buildSubGrid();
      await tick();
      grid.setGroupModel({ rowGroupCols: ['region'] });
      await tick();
      grid.setPivotColumns(['sector', 'assetClass']);
      grid.addValueColumn('pnl', 'sum');
      grid.setPivotMode(true);
      await tick();
      grid.collapseAll();
      await tick();

      const ids = subOrderIds(grid);
      const techTotal = pivotResultColumnId(['TECH'], 'pnl');
      const finTotal = pivotResultColumnId(['FIN'], 'pnl');
      const techEqLeaf = pivotResultColumnId(['TECH', 'EQ'], 'pnl');
      const techBondLeaf = pivotResultColumnId(['TECH', 'BOND'], 'pnl');

      // Defaults: every BRANCH pivot group is closed → totals visible,
      // deeper leaves hidden via cascading collapse.
      expect(ids).toContain(techTotal);
      expect(ids).toContain(finTotal);
      expect(ids).not.toContain(techEqLeaf);
      expect(ids).not.toContain(techBondLeaf);

      // Rolled-up aggregates on the per-region group rows come from
      // PivotPass's prefix-path aggregates (Cycle 18 / Task 2). EMEA TECH
      // = 100 + 200 = 300; APAC TECH = 400 + 600 = 1000; APAC FIN = 500.
      expect(subPivotCell(grid, 'region:EMEA', techTotal)).toBe(300);
      expect(subPivotCell(grid, 'region:EMEA', finTotal)).toBe(300);
      expect(subPivotCell(grid, 'region:APAC', techTotal)).toBe(1000);
      expect(subPivotCell(grid, 'region:APAC', finTotal)).toBe(500);

      grid.destroy();
      restore();
    });

    it('toggleColumnGroup on a pivot group reveals its child columns, re-toggle hides them', async () => {
      const { grid, restore } = buildSubGrid();
      await tick();
      grid.setGroupModel({ rowGroupCols: ['region'] });
      await tick();
      grid.setPivotColumns(['sector', 'assetClass']);
      grid.addValueColumn('pnl', 'sum');
      grid.setPivotMode(true);
      await tick();
      grid.collapseAll();
      await tick();

      const techTotal = pivotResultColumnId(['TECH'], 'pnl');
      const techEqLeaf = pivotResultColumnId(['TECH', 'EQ'], 'pnl');
      const techBondLeaf = pivotResultColumnId(['TECH', 'BOND'], 'pnl');
      const techGroupId = ['pivotcol', 'grp', 'TECH'].join('\x01');

      // Pre-toggle: TECH total visible, TECH child leaves hidden.
      const before = subOrderIds(grid);
      expect(before).toContain(techTotal);
      expect(before).not.toContain(techEqLeaf);
      expect(before).not.toContain(techBondLeaf);

      // Sanity-check the group id exists in the synthesized tree so a
      // typo / wrong-separator never silently no-ops the toggle.
      const treeGroups = (grid as unknown as { columnTree: { groupById: Map<string, unknown> } }).columnTree.groupById;
      expect(treeGroups.has(techGroupId)).toBe(true);

      // Expand TECH via the same imperative call the canvas header click
      // dispatches (interaction/features/headerClick.ts → toggleColumnGroup).
      (grid as unknown as { toggleColumnGroup: (g: string) => void }).toggleColumnGroup(techGroupId);
      await tick();

      const expanded = subOrderIds(grid);
      // TECH total now hidden; TECH/EQ + TECH/BOND leaves visible.
      expect(expanded).not.toContain(techTotal);
      expect(expanded).toContain(techEqLeaf);
      expect(expanded).toContain(techBondLeaf);
      // Aggregates on the deeper leaves: EMEA TECH/EQ = 100, EMEA TECH/BOND
      // = 200, APAC TECH/EQ = 400, APAC TECH/BOND = 600.
      expect(subPivotCell(grid, 'region:EMEA', techEqLeaf)).toBe(100);
      expect(subPivotCell(grid, 'region:EMEA', techBondLeaf)).toBe(200);
      expect(subPivotCell(grid, 'region:APAC', techEqLeaf)).toBe(400);
      expect(subPivotCell(grid, 'region:APAC', techBondLeaf)).toBe(600);

      // Re-toggle → back to the collapsed total view.
      (grid as unknown as { toggleColumnGroup: (g: string) => void }).toggleColumnGroup(techGroupId);
      await tick();

      const recollapsed = subOrderIds(grid);
      expect(recollapsed).toContain(techTotal);
      expect(recollapsed).not.toContain(techEqLeaf);
      expect(recollapsed).not.toContain(techBondLeaf);

      grid.destroy();
      restore();
    });

    it('pivotDefaultExpanded: 1 starts with depth-0 groups expanded so deeper leaves are visible from first paint', async () => {
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
      const grid = new CGrid<SubRow>(container, {
        columnDefs: SUB_COLS as Parameters<typeof CGrid<SubRow>>[1]['columnDefs'],
        getRowId: (r) => r.id,
        rowData: SUB_ROWS,
        pivotDefaultExpanded: 1,
      });
      const restore = () => {
        (globalThis as { Worker?: unknown }).Worker = prevWorker;
        container.remove();
      };

      await tick();
      grid.setGroupModel({ rowGroupCols: ['region'] });
      await tick();
      grid.setPivotColumns(['sector', 'assetClass']);
      grid.addValueColumn('pnl', 'sum');
      grid.setPivotMode(true);
      await tick();

      const ids = subOrderIds(grid);
      // pivotDefaultExpanded=1 → TECH (depth 0) is open from first paint.
      // The TECH total leaf is hidden; deeper TECH/EQ + TECH/BOND show.
      expect(ids).not.toContain(pivotResultColumnId(['TECH'], 'pnl'));
      expect(ids).toContain(pivotResultColumnId(['TECH', 'EQ'], 'pnl'));
      expect(ids).toContain(pivotResultColumnId(['TECH', 'BOND'], 'pnl'));

      grid.destroy();
      restore();
    });
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
