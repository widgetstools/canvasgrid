import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/**
 * Cycle 24 / Tasks 1-7 — accessibility + keyboard tests.
 *
 * Stubs Worker + 2D canvas so a CGrid can construct under happy-dom.
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

describe('Cycle 24 / Task 1 — keyboard matrix completion', () => {
  it('Ctrl+Home jumps focus to row 0 / first column', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const feature = new CellSelection();
    const ctx = makeKeyCtx({
      key: 'Home', ctrlKey: true,
      sel: { state: { focusedRowIndex: 5, focusedColId: 'b', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c'],
      rowCount: 100,
    });
    feature.handleKeyDown(ctx as any);
    expect(setFocusAndCollapseRanges).toHaveBeenCalledWith(0, 'a');
  });

  it('Ctrl+End jumps focus to last row / last column', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const feature = new CellSelection();
    const ctx = makeKeyCtx({
      key: 'End', ctrlKey: true,
      sel: { state: { focusedRowIndex: 0, focusedColId: 'a', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c'],
      rowCount: 100,
    });
    feature.handleKeyDown(ctx as any);
    expect(setFocusAndCollapseRanges).toHaveBeenCalledWith(99, 'c');
  });

  it('Ctrl+ArrowDown jumps focus to last row in same column', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const feature = new CellSelection();
    const ctx = makeKeyCtx({
      key: 'ArrowDown', ctrlKey: true,
      sel: { state: { focusedRowIndex: 5, focusedColId: 'b', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c'],
      rowCount: 100,
    });
    feature.handleKeyDown(ctx as any);
    expect(setFocusAndCollapseRanges).toHaveBeenCalledWith(99, 'b');
  });

  it('Ctrl+ArrowUp jumps focus to row 0 in same column', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const feature = new CellSelection();
    const ctx = makeKeyCtx({
      key: 'ArrowUp', ctrlKey: true,
      sel: { state: { focusedRowIndex: 50, focusedColId: 'b', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c'],
      rowCount: 100,
    });
    feature.handleKeyDown(ctx as any);
    expect(setFocusAndCollapseRanges).toHaveBeenCalledWith(0, 'b');
  });

  it('Ctrl+ArrowRight jumps focus to last column in same row', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const feature = new CellSelection();
    const ctx = makeKeyCtx({
      key: 'ArrowRight', ctrlKey: true,
      sel: { state: { focusedRowIndex: 5, focusedColId: 'a', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c', 'd'],
      rowCount: 100,
    });
    feature.handleKeyDown(ctx as any);
    expect(setFocusAndCollapseRanges).toHaveBeenCalledWith(5, 'd');
  });

  it('Ctrl+ArrowLeft jumps focus to first column in same row', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const feature = new CellSelection();
    const ctx = makeKeyCtx({
      key: 'ArrowLeft', ctrlKey: true,
      sel: { state: { focusedRowIndex: 5, focusedColId: 'c', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c', 'd'],
      rowCount: 100,
    });
    feature.handleKeyDown(ctx as any);
    expect(setFocusAndCollapseRanges).toHaveBeenCalledWith(5, 'a');
  });

  it('Ctrl+A on the grid selects all rows', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      rowSelection: 'multiple',
    } as any);
    const selectAll = vi.spyOn(grid as any, 'selectAll');
    // Construct an in-grid Ctrl+A keydown via the feature chain's head.
    const head = (grid as any).featureChain.head;
    head.handleKeyDown({
      grid: (grid as any).featureChain.grid,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }),
    });
    expect(selectAll).toHaveBeenCalled();
    grid.destroy();
  });
});

describe('Cycle 24 / Task 2 — suppressKeyboardEvent per column', () => {
  it('returning true from suppressKeyboardEvent short-circuits the grid handler', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const suppress = vi.fn(() => true);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'a', field: 'a', cellDataType: 'text', suppressKeyboardEvent: suppress },
      ],
    } as any);
    // Move focus to the cell so the gate has a column to consult.
    (grid as any).selection.setFocus(0, 'a');
    const sel = (grid as any).selection;
    const before = sel.state.focusedColId;
    const head = (grid as any).featureChain.head;
    head.handleKeyDown({
      grid: (grid as any).featureChain.grid,
      hit: { kind: 'cell', rowIndex: 0, colId: 'a' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    });
    expect(suppress).toHaveBeenCalled();
    // ArrowRight did NOT move focus — the column suppressed it.
    expect(sel.state.focusedColId).toBe(before);
    grid.destroy();
  });

  it('returning false leaves the grid handler intact (key proceeds through the chain)', async () => {
    const { CellKeyboardEvents } = await import('../src/interaction/features/cellKeyboardEvents');
    const feature = new CellKeyboardEvents();
    const next = { handleKeyDown: vi.fn() };
    (feature as any).next = next;
    const suppress = vi.fn(() => false);
    feature.handleKeyDown({
      grid: {
        selection: { state: { focusedRowIndex: 0, focusedColId: 'a' } },
        getColSuppressKeyboardEvent: () => suppress,
        isEditing: () => false,
        getRowDataAt: () => ({ a: 'x' }),
        emitCellKeyDown: () => false,
        emitCellKeyPress: () => false,
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    });
    expect(suppress).toHaveBeenCalled();
    // Returned false → downstream handler ran.
    expect(next.handleKeyDown).toHaveBeenCalled();
  });
});

describe('Cycle 24 / Task 3 — A11y overlay attributes', () => {
  it('sets aria-label on the grid root when CGridOptions.ariaLabel is supplied', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      ariaLabel: 'My data grid',
    } as any);
    const gridEl = host.querySelector('[role="grid"]') as HTMLElement;
    expect(gridEl).not.toBeNull();
    expect(gridEl.getAttribute('aria-label')).toBe('My data grid');
    grid.destroy();
  });

  it('sets aria-busy on the grid root when the loading flag is true', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      loading: true,
    } as any);
    const gridEl = host.querySelector('[role="grid"]') as HTMLElement;
    expect(gridEl.getAttribute('aria-busy')).toBe('true');
    grid.setGridOption('loading', false);
    expect(gridEl.getAttribute('aria-busy')).toBe('false');
    grid.destroy();
  });
});

describe('Cycle 24 / Task 4 — screen-reader announcements', () => {
  it('mounts a role="status" aria-live region in the a11y overlay', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);
    const live = host.querySelector('[role="status"][aria-live="polite"]') as HTMLElement;
    expect(live).not.toBeNull();
    grid.destroy();
  });

  it('announces "Sorted by X ascending" after a sort change', async () => {
    vi.useFakeTimers();
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number' }],
    } as any);
    (grid as any).events.emit({
      type: 'sortChanged',
      sortModel: [{ colId: 'price', direction: 'asc' }],
    });
    // Debounce window = 250ms. Advance past it so the live region
    // text lands before we assert.
    vi.advanceTimersByTime(300);
    const live = host.querySelector('[role="status"]') as HTMLElement;
    expect(live.textContent).toContain('Price');
    expect(live.textContent).toContain('ascending');
    grid.destroy();
    vi.useRealTimers();
  });
});

describe('Cycle 24 / Task 5 — high-contrast theme', () => {
  it('declares cg-theme-high-contrast in tokens.css with WCAG AAA tokens', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'src/theming/tokens.css');
    const src = fs.readFileSync(file, 'utf-8');
    expect(src).toMatch(/\.cg-theme-high-contrast\b/);
    // Black on white at 7:1+ — the canonical WCAG AAA pairing.
    expect(src).toMatch(/--cg-fg-color\s*:\s*#000000/);
    // Thicker focus ring (≥ 3px) for high-contrast.
    const match = src.match(/\.cg-theme-high-contrast[^}]*\}/);
    expect(match![0]).toMatch(/--cg-focus-ring-width\s*:\s*3px/);
  });

  it('pairs the high-contrast theme with a dark variant', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'src/theming/tokens.css');
    const src = fs.readFileSync(file, 'utf-8');
    expect(src).toMatch(/\.cg-theme-high-contrast-dark\b/);
  });
});

describe('Cycle 24 / Task 6 — tabToNextHeader / tabToPreviousHeader callbacks', () => {
  it('Tab at the last cell calls tabToNextHeader and stays in-grid when the callback returns true', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const tabToNextHeader = vi.fn(() => true);
    const feature = new CellSelection();
    const ctx = makeKeyCtx({
      key: 'Tab',
      sel: { state: { focusedRowIndex: 99, focusedColId: 'c', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c'],
      rowCount: 100,
      tabToNextHeader,
    });
    feature.handleKeyDown(ctx as any);
    expect(tabToNextHeader).toHaveBeenCalled();
    // Callback returned true → wrap to first cell.
    expect(setFocusAndCollapseRanges).toHaveBeenCalledWith(0, 'a');
  });

  it('Tab at the last cell calls tabToNextHeader and exits the grid when the callback returns false', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const setFocusAndCollapseRanges = vi.fn();
    const tabToNextHeader = vi.fn(() => false);
    const feature = new CellSelection();
    const e = new KeyboardEvent('keydown', { key: 'Tab' });
    const ctx = makeKeyCtx({
      key: 'Tab', raw: e,
      sel: { state: { focusedRowIndex: 99, focusedColId: 'c', selectedRowIndices: new Set() }, setFocusAndCollapseRanges, range: vi.fn(), toggleMulti: vi.fn(), selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn() },
      cols: ['a', 'b', 'c'],
      rowCount: 100,
      tabToNextHeader,
    });
    feature.handleKeyDown(ctx as any);
    expect(tabToNextHeader).toHaveBeenCalled();
    // No focus move — the callback opted out of wrapping.
    expect(setFocusAndCollapseRanges).not.toHaveBeenCalled();
    // The native Tab default must NOT have been prevented (so the browser
    // can move focus to the next focusable element on the page).
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('Cycle 24 / Task 7 — prefers-reduced-motion', () => {
  it('tokens.css scopes flash-from-color to transparent when prefers-reduced-motion is set', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'src/theming/tokens.css');
    const src = fs.readFileSync(file, 'utf-8');
    expect(src).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    const motionBlock = src.match(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/);
    expect(motionBlock).not.toBeNull();
    expect(motionBlock![0]).toMatch(/--cg-flash-from-color\s*:\s*transparent/);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeKeyCtx(opts: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  sel: any;
  cols: string[];
  rowCount: number;
  tabToNextHeader?: (params: any) => boolean;
  tabToPreviousHeader?: (params: any) => boolean;
  raw?: KeyboardEvent;
}): any {
  const raw = opts.raw ?? new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey,
    shiftKey: opts.shiftKey,
  });
  return {
    grid: {
      selection: opts.sel,
      allColIds: () => opts.cols,
      totalRowCount: () => opts.rowCount,
      visibleRowIndices: () => [],
      isEditing: () => false,
      getEditingFlags: () => ({
        singleClickEdit: false,
        suppressClickEdit: false,
        enterNavigatesVertically: false,
        enterNavigatesVerticallyAfterEdit: false,
        suppressStartEditOnTab: false,
        enableCellEditingOnBackspace: false,
        enableExcelEditing: false,
      }),
      isCellEditable: () => false,
      getTabToNextHeader: () => opts.tabToNextHeader,
      getTabToPreviousHeader: () => opts.tabToPreviousHeader,
    },
    hit: { kind: 'empty' },
    point: { x: 0, y: 0 },
    raw,
  };
}
