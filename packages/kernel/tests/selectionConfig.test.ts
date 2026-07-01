import { describe, it, expect, vi, beforeAll } from 'vitest';
import { resolveSelection } from '../src/core/selectionConfig';

/**
 * Unified `selection` config — ag-grid v33+ parity.
 *
 * Unit tests against the pure resolver, then integration tests that
 * confirm a CGrid constructed with the new shape behaves the same
 * as one constructed with the equivalent legacy options.
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

describe('resolveSelection — single-row mode', () => {
  it('singleRow defaults: row click selects, no checkbox column', () => {
    const r = resolveSelection({ mode: 'singleRow' });
    expect(r).not.toBeNull();
    expect(r!.rowSelectionMode).toBe('single');
    expect(r!.suppressRowClickSelection).toBe(false);
    expect(r!.rowMultiSelectWithClick).toBe(false);
    expect(r!.syntheticCheckboxColumn).toBeNull();
  });

  it('singleRow + checkboxes: true injects a pinned-left checkbox col', () => {
    const r = resolveSelection({ mode: 'singleRow', checkboxes: true });
    expect(r!.syntheticCheckboxColumn).not.toBeNull();
    expect(r!.syntheticCheckboxColumn).toMatchObject({
      colId: '__cg_select__',
      checkboxSelection: true,
      pinned: 'left',
      sortable: false,
    });
  });

  it('singleRow + enableClickSelection: false → suppressRowClickSelection: true', () => {
    const r = resolveSelection({ mode: 'singleRow', enableClickSelection: false });
    expect(r!.suppressRowClickSelection).toBe(true);
  });
});

describe('resolveSelection — multi-row mode', () => {
  it('multiRow defaults: multi selection, click toggles via Ctrl', () => {
    const r = resolveSelection({ mode: 'multiRow' });
    expect(r!.rowSelectionMode).toBe('multiple');
    expect(r!.rowMultiSelectWithClick).toBe(false);
  });

  it('multiRow + enableSelectionWithoutKeys: true → plain click toggles', () => {
    const r = resolveSelection({
      mode: 'multiRow',
      enableSelectionWithoutKeys: true,
    });
    expect(r!.rowMultiSelectWithClick).toBe(true);
  });

  it('multiRow + checkboxes + headerCheckbox + click-suppressed → blotter pattern', () => {
    const r = resolveSelection({
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false,
    });
    expect(r!.rowSelectionMode).toBe('multiple');
    expect(r!.suppressRowClickSelection).toBe(true);
    expect(r!.syntheticCheckboxColumn).toMatchObject({
      checkboxSelection: true,
      headerCheckboxSelection: true,
    });
  });

  it('multiRow + enableClickSelection: "enableDeselection" sets the deselect flag but keeps clicks active', () => {
    const r = resolveSelection({
      mode: 'multiRow',
      enableClickSelection: 'enableDeselection',
    });
    expect(r!.suppressRowClickSelection).toBe(false);
    expect(r!.enableDeselection).toBe(true);
  });
});

describe('resolveSelection — cell mode', () => {
  it('cell mode disables row selection entirely', () => {
    const r = resolveSelection({ mode: 'cell' });
    expect(r!.rowSelectionMode).toBe('none');
    expect(r!.suppressRowClickSelection).toBe(false);
    expect(r!.syntheticCheckboxColumn).toBeNull();
  });
});

describe('resolveSelection — undefined', () => {
  it('undefined returns null so the resolver short-circuits (legacy path)', () => {
    expect(resolveSelection(undefined)).toBeNull();
  });
});

describe('CGridOptions.selection — integration', () => {
  it('selection: { mode: "multiRow" } gives the same row selection as rowSelection: "multiple"', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      selection: { mode: 'multiRow' },
    } as any);
    expect((grid as any).selection.getMode()).toBe('multiple');
    grid.destroy();
  });

  it('selection: { mode: "singleRow" } gives row selection: "single"', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      selection: { mode: 'singleRow' },
    } as any);
    expect((grid as any).selection.getMode()).toBe('single');
    grid.destroy();
  });

  it('selection: { mode: "cell" } sets row selection to "none"', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      selection: { mode: 'cell' },
    } as any);
    expect((grid as any).selection.getMode()).toBe('none');
    grid.destroy();
  });

  it('selection: { checkboxes: true } auto-injects a pinned-left checkbox column at index 0', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'a', field: 'a', cellDataType: 'text' },
        { colId: 'b', field: 'b', cellDataType: 'text' },
      ],
      selection: { mode: 'multiRow', checkboxes: true, headerCheckbox: true },
    } as any);
    const cols = (grid as any).columnDefsMap;
    expect(cols.has('__cg_select__')).toBe(true);
    const checkboxDef = cols.get('__cg_select__');
    expect(checkboxDef.checkboxSelection).toBe(true);
    expect(checkboxDef.headerCheckboxSelection).toBe(true);
    expect(checkboxDef.pinned).toBe('left');
    grid.destroy();
  });

  it('selection: { mode: "multiRow", enableClickSelection: false } suppresses row-click selection', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      selection: { mode: 'multiRow', enableClickSelection: false },
    } as any);
    expect((grid as any).options.suppressRowClickSelection).toBe(true);
    grid.destroy();
  });

  it('selection: { mode: "multiRow", enableSelectionWithoutKeys: true } flips rowMultiSelectWithClick', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      selection: { mode: 'multiRow', enableSelectionWithoutKeys: true },
    } as any);
    expect((grid as any).options.rowMultiSelectWithClick).toBe(true);
    grid.destroy();
  });
});
