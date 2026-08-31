// Live column widths survive calc-driven rebuilds. A drag-resize /
// setColumnWidths mutates ONLY the resolved def; rebuildColumns
// (fired by every calc mutation — editColumn styling a header, applying a
// template, …) re-resolves from options.columnDefs and used to silently
// reset the user's widths. Regression for the VelocityGridExt formatting-toolbar
// requirement: "applying styles to column headers must not alter widths".

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
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

function mountGrid(): { grid: VelocityGrid<any>; host: HTMLDivElement } {
  const host = document.createElement('div');
  host.style.cssText = 'width:800px; height:600px;';
  host.className = 'vg-theme-quartz';
  document.body.appendChild(host);
  const grid = new VelocityGrid<{ id: string; a: number }>(host, {
    columnDefs: [
      { colId: 'id', field: 'id', width: 90 },
      { colId: 'a', field: 'a', cellDataType: 'number', width: 120 },
    ],
    getRowId: (r) => r.id,
    theme: 'vg-theme-quartz',
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

function widthOf(grid: VelocityGrid<any>, colId: string): number | undefined {
  return grid.getColumnState().find((c) => c.colId === colId)?.width;
}

function hiddenIds(grid: VelocityGrid<any>): string[] {
  return grid.getColumnState().filter((c) => c.hide).map((c) => c.colId);
}

function pinnedIds(grid: VelocityGrid<any>): string[] {
  return grid.getColumnState()
    .filter((c) => c.pinned)
    .map((c) => `${c.colId}:${c.pinned}`);
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

/**
 * Visibility and pinning are live state too — mutated on the resolved def by
 * setColumnsVisible / setColumnsPinned, never written back to `columnDefs`.
 * Neither was carried across a rebuild, so any calc mutation un-hid every
 * hidden column and unpinned every pinned one: the same defect as width, one
 * property over.
 *
 * Auto format is what made it obvious — it edits every matched column in a
 * single pass, so one click reverted the whole grid. The reported symptom was
 * "auto format makes all the columns visible without syncing the columns side
 * bar", and the side bar was the half telling the truth.
 */
describe('rebuildColumns — live visibility and pinning', () => {
  it('a hidden column stays hidden across a calc-driven rebuild', () => {
    const { grid, host } = mountGrid();
    grid.setColumnsVisible(['a'], false);
    expect(hiddenIds(grid)).toEqual(['a']);

    grid.registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId) => colId === 'id' ? { headerStyle: { fontWeight: 'bold' } } : null,
    }));

    expect(hiddenIds(grid)).toEqual(['a']);
    grid.destroy(); host.remove();
  });

  it('a pinned column stays pinned across a calc-driven rebuild', () => {
    const { grid, host } = mountGrid();
    grid.setColumnsPinned(['id'], 'left');
    expect(pinnedIds(grid)).toEqual(['id:left']);

    grid.registerCalcProvider(makeProvider({
      resolvedPatchFor: () => ({ cellStyle: { halign: 'right' } }),
    }));

    expect(pinnedIds(grid)).toEqual(['id:left']);
    grid.destroy(); host.remove();
  });

  it('an explicit calc override still wins over the live value', () => {
    const { grid, host } = mountGrid();
    grid.setColumnsVisible(['a'], false);
    grid.registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId) => colId === 'a' ? { hide: false } : null,
    }));
    expect(hiddenIds(grid)).toEqual([]);
    grid.destroy(); host.remove();
  });

  it('a CHANGED host colDef wins; re-pushing the same defs does not', () => {
    const { grid, host } = mountGrid();
    grid.setColumnsVisible(['a'], false);

    // Re-pushing identical defs is not new intent — the user's choice stands.
    // This is the case that matters in practice: a provider rebind pushes the
    // catalog's columnDefs again on every Apply.
    grid.updateGridOptions({ columnDefs: grid.getGridOption('columnDefs') as never });
    expect(hiddenIds(grid)).toEqual(['a']);

    // Declaring a DIFFERENT value is new intent, and outranks the live value.
    grid.updateGridOptions({
      columnDefs: [
        { colId: 'id', field: 'id', width: 90, hide: true },
        { colId: 'a', field: 'a', cellDataType: 'number', width: 120 },
      ] as never,
    });
    expect(hiddenIds(grid)).toContain('id');
    grid.destroy(); host.remove();
  });
});
