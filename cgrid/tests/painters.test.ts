import { describe, it, expect, vi } from 'vitest';
import { paintHeader } from '../src/renderer/painters/headerPainter';
import { paintBody } from '../src/renderer/painters/bodyPainter';
import { paintOverlay } from '../src/renderer/painters/overlayPainter';
import { CellRendererRegistry, textCell, numberCell } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

function fakeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(),
    translate: vi.fn(), scale: vi.fn(),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [
    { rowIndex: 0, top: 32, bottom: 62, height: 30 },
    { rowIndex: 1, top: 62, bottom: 92, height: 30 },
  ],
  firstRow: 0, lastRow: 1,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 92, bodyWidth: 250, bodyHeight: 60,
  contentWidth: 250, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 0,
};
const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
};
const cols = new Map<string, ResolvedColDef>([
  ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
  ['b', { colId: 'b', headerName: 'B', minWidth: 30, maxWidth: Infinity, type: 'number', cellRenderer: 'number', sortable: true, resizable: true, editable: false }],
]);
const reg = new CellRendererRegistry();
reg.register('text', textCell); reg.register('number', numberCell);
const cellData = () => ({ value: 'x', valueFormatted: 'x' });
const selection = { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() };

describe('painters', () => {
  it('paintHeader fills + writes column header text per visible column', () => {
    const c = fakeGc();
    paintHeader(c, { viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData, selection, sortModel: [] });
    expect((c.fillRect as any)).toHaveBeenCalled();
    expect((c.fillText as any).mock.calls.length).toBe(2);
  });

  it('paintBody draws every visible cell', () => {
    const c = fakeGc();
    paintBody(c, { viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData, selection, sortModel: [] });
    // 2 rows x 2 cols = 4 fills (background per cell)
    expect((c.fillRect as any).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('paintOverlay draws focus ring when focused cell is set', () => {
    const c = fakeGc();
    paintOverlay(c, {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData,
      selection: { focusedRowIndex: 0, focusedColId: 'b', selectedRowIndices: new Set() },
      sortModel: [],
    });
    expect((c.strokeRect as any)).toHaveBeenCalled();
  });
});
