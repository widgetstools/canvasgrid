// Live column widths survive calc-driven rebuilds. A drag-resize /
// setColumnWidths mutates ONLY the resolved def; rebuildColumns
// (fired by every calc mutation — editColumn styling a header, applying a
// template, …) re-resolves from options.columnDefs and used to silently
// reset the user's widths. Regression for the CGridExt formatting-toolbar
// requirement: "applying styles to column headers must not alter widths".

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { CGrid } from '../src/cgrid';
import { _resetCalcProvider_forTests, type CalcProviderShape } from '../src/core/calcSlot';

beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      postedMessages: any[] = [];
      constructor(public url: URL) {}
      postMessage(msg: any): void { this.postedMessages.push(msg); }
      addEventListener = (_: string, cb: (e: { data: any }) => void) => {
        this.listeners.push(cb);
      };
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
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

afterEach(() => _resetCalcProvider_forTests());

function mountGrid(): { grid: CGrid<any>; host: HTMLDivElement } {
  const host = document.createElement('div');
  host.style.cssText = 'width:800px; height:600px;';
  host.className = 'cg-theme-quartz';
  document.body.appendChild(host);
  const grid = new CGrid<{ id: string; a: number }>(host, {
    columnDefs: [
      { colId: 'id', field: 'id', width: 90 },
      { colId: 'a', field: 'a', cellDataType: 'number', width: 120 },
    ],
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
  });
  const worker = (grid as any).workerClient.worker;
  worker.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return { grid, host };
}

function makeProvider(overrides: Partial<CalcProviderShape> = {}): CalcProviderShape {
  return {
    synthesizedColDefs: () => [],
    resolvedPatchFor: () => null,
    workerProgram: () => null,
    onColumnsChanged: () => () => {},
    ...overrides,
  };
}

function widthOf(grid: CGrid<any>, colId: string): number | undefined {
  return grid.getColumnState().find((c) => c.colId === colId)?.width;
}

describe('rebuildColumns — live width preservation', () => {
  it('a resized width survives a calc-driven rebuild (style-only patch)', () => {
    const { grid, host } = mountGrid();
    grid.setColumnWidths([{ key: 'id', newWidth: 150 }]);
    expect(widthOf(grid, 'id')).toBe(150);

    // Register a style-only provider — registration itself fires the
    // rebuild path (onCalcColumnsChanged), exactly like editColumn does.
    grid.registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId) => colId === 'id' ? { headerStyle: { fontWeight: 'bold' } } : null,
    }));

    expect(widthOf(grid, 'id')).toBe(150);   // was reset to the authored 90
    expect(widthOf(grid, 'a')).toBe(120);    // untouched columns keep authored width
    grid.destroy(); host.remove();
  });

  it('an explicit calc width override still wins over the live width', () => {
    const { grid, host } = mountGrid();
    grid.setColumnWidths([{ key: 'a', newWidth: 200 }]);
    grid.registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId) => colId === 'a' ? { width: 260 } : null,
    }));
    expect(widthOf(grid, 'a')).toBe(260);    // override width beats carry-over
    grid.destroy(); host.remove();
  });
});
