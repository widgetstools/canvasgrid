import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Per-column row-select checkbox feature.
 *
 * API surface added:
 *   • CColDef.checkboxSelection       — per-row toggle checkbox
 *   • CColDef.headerCheckboxSelection — tri-state select-all header checkbox
 *   • CGridOptions.suppressRowClickSelection — force checkbox-only selection
 *   • CGridOptions.rowMultiSelectWithClick   — Ctrl-key-less multi-select
 */
beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
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
    return () => fakeCtx as any;
  })() as any;
});

describe('Phase 1 — checkboxSelection forces rowSelectCheckbox cell renderer', () => {
  it('a column with checkboxSelection: true resolves cellRenderer to "rowSelectCheckbox"', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'sel', checkboxSelection: true, width: 40, pinned: 'left' } as any,
        { colId: 'name', field: 'name', cellDataType: 'text' },
      ],
    } as any);
    const def = (grid as any).columnDefsMap.get('sel');
    expect(def.cellRenderer).toBe('rowSelectCheckbox');
    grid.destroy();
  });

  it('the rowSelectCheckbox renderer paints the box reflecting p.isSelected', async () => {
    const { rowSelectCheckboxCell } = await import('../src/renderer/cellRenderers/rowSelectCheckbox');
    const calls = { fillRect: 0, strokeRect: 0, stroke: 0 };
    const ctx: any = {
      fillRect: () => calls.fillRect++,
      strokeRect: () => calls.strokeRect++,
      stroke: () => calls.stroke++,
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
    };
    ctx.cache = new Proxy(ctx, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    ctx.clearFill = vi.fn();
    // Unselected — outline only, no check stroke.
    rowSelectCheckboxCell.paint(ctx, {
      value: false, valueFormatted: '',
      bounds: { x: 0, y: 0, w: 40, h: 30 },
      font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc',
      halign: 'center', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    } as any);
    expect(calls.strokeRect).toBeGreaterThanOrEqual(1); // outline
    expect(calls.stroke).toBe(0);                       // no check glyph
  });

  it('the rowSelectCheckbox renderer paints the check glyph when isSelected is true', async () => {
    const { rowSelectCheckboxCell } = await import('../src/renderer/cellRenderers/rowSelectCheckbox');
    const calls = { fillRect: 0, strokeRect: 0, stroke: 0 };
    const ctx: any = {
      fillRect: () => calls.fillRect++,
      strokeRect: () => calls.strokeRect++,
      stroke: () => calls.stroke++,
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
    };
    ctx.cache = new Proxy(ctx, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    ctx.clearFill = vi.fn();
    rowSelectCheckboxCell.paint(ctx, {
      value: true, valueFormatted: '',
      bounds: { x: 0, y: 0, w: 40, h: 30 },
      font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc',
      halign: 'center', prefillColor: '#fff',
      isFocused: false, isSelected: true, isHovered: false, isHeader: false,
    } as any);
    expect(calls.strokeRect).toBeGreaterThanOrEqual(1);
    expect(calls.stroke).toBe(1); // check glyph
  });
});

describe('Phase 2 — clicking a checkboxSelection cell toggles row selection', () => {
  it('mousedown on a checkboxSelection cell toggles the row, sets focus, does NOT add cell range', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'sel', checkboxSelection: true, width: 40, pinned: 'left' } as any,
        { colId: 'name', field: 'name', cellDataType: 'text' },
      ],
      rowSelection: 'multiple',
    } as any);
    const head = (grid as any).featureChain.head;
    head.handleMouseDown({
      grid: (grid as any).featureChain.grid,
      hit: { kind: 'cell', rowIndex: 2, colId: 'sel' },
      point: { x: 0, y: 0 },
      raw: new MouseEvent('mousedown', { button: 0 }),
    });
    const sel = (grid as any).selection;
    expect(sel.state.selectedRowIndices.has(2)).toBe(true);
    // No cell range created — checkbox click is row-toggle only.
    expect(sel.state.ranges.length).toBe(0);
    grid.destroy();
  });

  it('the click toggles back to unselected on second press', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'sel', checkboxSelection: true, width: 40 } as any,
        { colId: 'name', field: 'name', cellDataType: 'text' },
      ],
      rowSelection: 'multiple',
    } as any);
    const head = (grid as any).featureChain.head;
    const fire = () => head.handleMouseDown({
      grid: (grid as any).featureChain.grid,
      hit: { kind: 'cell', rowIndex: 3, colId: 'sel' },
      point: { x: 0, y: 0 },
      raw: new MouseEvent('mousedown', { button: 0 }),
    });
    fire();
    expect((grid as any).selection.state.selectedRowIndices.has(3)).toBe(true);
    fire();
    expect((grid as any).selection.state.selectedRowIndices.has(3)).toBe(false);
    grid.destroy();
  });
});

describe('Phase 3 — headerCheckboxSelection toggles select-all', () => {
  it('clicking the header checkbox when no rows are selected selects all', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'sel', checkboxSelection: true, headerCheckboxSelection: true, width: 40 } as any,
        { colId: 'name', field: 'name', cellDataType: 'text' },
      ],
      rowSelection: 'multiple',
    } as any);
    // Simulate worker ready so rowCount lands.
    const w = (grid as any).workerClient.worker;
    w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
    (grid as any).rowCount = 50;
    (grid as any).toggleHeaderCheckbox?.('sel');
    expect((grid as any).selection.state.selectedRowIndices.size).toBe(50);
    grid.destroy();
  });

  it('clicking the header checkbox when ALL rows are selected deselects all', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'sel', checkboxSelection: true, headerCheckboxSelection: true, width: 40 } as any,
        { colId: 'name', field: 'name', cellDataType: 'text' },
      ],
      rowSelection: 'multiple',
    } as any);
    (grid as any).rowCount = 50;
    const sel = (grid as any).selection;
    for (let i = 0; i < 50; i++) sel.state.selectedRowIndices.add(i);
    (grid as any).toggleHeaderCheckbox?.('sel');
    expect(sel.state.selectedRowIndices.size).toBe(0);
    grid.destroy();
  });
});

describe('Phase 4 — grid-level selection options', () => {
  it('suppressRowClickSelection: true → plain click on body cell does NOT toggle row selection', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'name', field: 'name', cellDataType: 'text' }],
      rowSelection: 'multiple',
      suppressRowClickSelection: true,
    } as any);
    const head = (grid as any).featureChain.head;
    head.handleMouseDown({
      grid: (grid as any).featureChain.grid,
      hit: { kind: 'cell', rowIndex: 5, colId: 'name' },
      point: { x: 0, y: 0 },
      raw: new MouseEvent('mousedown', { button: 0 }),
    });
    // Row NOT selected — the body click is selection-suppressed.
    expect((grid as any).selection.state.selectedRowIndices.has(5)).toBe(false);
    // Focus DOES move (the cell is still focusable for keyboard nav).
    expect((grid as any).selection.state.focusedRowIndex).toBe(5);
    grid.destroy();
  });

  it('rowMultiSelectWithClick: true → plain click toggles row (no Ctrl/Cmd needed)', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'name', field: 'name', cellDataType: 'text' }],
      rowSelection: 'multiple',
      rowMultiSelectWithClick: true,
    } as any);
    const head = (grid as any).featureChain.head;
    const click = (r: number) => head.handleMouseDown({
      grid: (grid as any).featureChain.grid,
      hit: { kind: 'cell', rowIndex: r, colId: 'name' },
      point: { x: 0, y: 0 },
      raw: new MouseEvent('mousedown', { button: 0 }),
    });
    click(0);
    click(2);
    click(4);
    const sel = (grid as any).selection;
    // All three rows are selected via plain clicks.
    expect(sel.state.selectedRowIndices.has(0)).toBe(true);
    expect(sel.state.selectedRowIndices.has(2)).toBe(true);
    expect(sel.state.selectedRowIndices.has(4)).toBe(true);
    grid.destroy();
  });
});
