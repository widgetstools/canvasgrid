import { describe, it, expect, vi } from 'vitest';
import { paintHeader } from '../src/renderer/painters/headerPainter';
import { paintBody } from '../src/renderer/painters/bodyPainter';
import { paintOverlay } from '../src/renderer/painters/overlayPainter';
import { paintGridLines } from '../src/renderer/painters/gridLinesPainter';
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

  it('paintGridLines writes one fillRect per row bottom + one per inter-column gap', () => {
    const c = fakeGc();
    paintGridLines(c, { viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData, selection, sortModel: [] });
    // Every fillRect call is a 1px-wide-or-tall line. Count the horizontals: one
    // per visible row whose bottom sits inside the body band (here both rows do).
    // Count the verticals: visibleColumns has 2 center columns → 1 inter-column gap.
    // No pinned columns in `vs`, so no band-edge lines either.
    const calls = (c.fillRect as any).mock.calls as number[][];
    const horizontals = calls.filter((call) => call[3] === 1).length; // height === 1
    const verticals = calls.filter((call) => call[2] === 1).length;   // width === 1
    expect(horizontals).toBe(vs.visibleRows.length); // 2
    expect(verticals).toBe(vs.visibleColumns.length - 1); // 1
  });

  it('paintGridLines does not call stroke or strokeRect', () => {
    const c = fakeGc();
    paintGridLines(c, { viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData, selection, sortModel: [] });
    expect((c.stroke as any)).not.toHaveBeenCalled();
    expect((c.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('paintGridLines adds heavier band-edge lines for pinned columns', () => {
    const c = fakeGc();
    // Layout: left-pinned [0..60], body [60..200], right-pinned [200..250].
    const vsPinned = {
      ...vs,
      bodyLeft: 60, bodyRight: 200, bodyWidth: 140,
      visibleColumns: [
        { colId: 'p', index: 0, left: 0, right: 60, width: 60, pinned: 'left' as const },
        { colId: 'a', index: 1, left: 60, right: 130, width: 70 },
        { colId: 'b', index: 2, left: 130, right: 200, width: 70 },
        { colId: 'q', index: 3, left: 200, right: 250, width: 50, pinned: 'right' as const },
      ],
    };
    paintGridLines(c, { viewport: vsPinned, theme, columnDefs: cols, cellRenderers: reg, cellData, selection, sortModel: [] });
    // Count width=1, height=bodyHeight fills — should include both band edges
    // (heavier borderColor lines) + the single inter-center vertical.
    const calls = (c.fillRect as any).mock.calls as number[][];
    const bodyH = vsPinned.bodyBottom - vsPinned.bodyTop;
    const fullHeightVerticals = calls.filter((call) => call[2] === 1 && call[3] === bodyH).length;
    expect(fullHeightVerticals).toBe(3); // 2 band edges + 1 inter-center gap
  });
});
