import { describe, it, expect, vi } from 'vitest';
import { paintCellsByRows } from '../src/renderer/painters/byRows';
import { paintGridLines } from '../src/renderer/painters/gridLinesPainter';
import { paintOverlay } from '../src/renderer/painters/overlayPainter';
import { CellRendererRegistry, textCell, numberCell, headerCell } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import { HeaderGroupSubgrid, type Subgrid } from '../src/core/subgrid';
import { resolveColumnTree } from '../src/core/columnTree';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

// ─── Shared subgrid stubs ────────────────────────────────────────────────────

const headerSubgrid: Subgrid = {
  type: 'header', isHeader: true, isData: false, isTotals: false, isFooter: false,
  getRowCount: () => 1, getRowHeight: () => 32, getCell: () => null,
};

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 1000, getRowHeight: () => 30, getCell: () => null,
};

// ─── fakeGc ──────────────────────────────────────────────────────────────────

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

// ─── Shared theme ────────────────────────────────────────────────────────────

const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
};

// ─── Shared column defs ───────────────────────────────────────────────────────

const cols = new Map<string, ResolvedColDef>([
  ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
  ['b', { colId: 'b', headerName: 'B', minWidth: 30, maxWidth: Infinity, type: 'number', cellRenderer: 'number', sortable: true, resizable: true, editable: false }],
  ['c', { colId: 'c', headerName: 'C', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
]);

// Viewport with a header row + 3 data rows (all on alt indices: 1, 3, 5 → rowAltBg)
// Used to test bundle consolidation.
function makeVsAltRows(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
      { colId: 'c', index: 2, left: 200, right: 300, width: 100 },
    ],
    visibleRows: [
      // 3 consecutive rows on alt indices (localRowIndex 1, 3, 5) → all rowAltBg
      { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 1, top: 32, bottom: 62, height: 30 },
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 3, top: 62, bottom: 92, height: 30 },
      { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 5, top: 92, bottom: 122, height: 30 },
    ],
    firstRow: 1, lastRow: 5,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 300, bodyTop: 32, bodyBottom: 122, bodyWidth: 300, bodyHeight: 90,
    contentWidth: 300, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 910,
  };
}

// Viewport with mixed row backgrounds: [alt, alt, default, alt, alt]
function makeVsMixedRows(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 1, top: 32, bottom: 62, height: 30 },  // alt
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 3, top: 62, bottom: 92, height: 30 },  // alt
      { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 2, top: 92, bottom: 122, height: 30 }, // default (even)
      { rowIndex: 3, subgrid: dataSubgrid, localRowIndex: 5, top: 122, bottom: 152, height: 30 }, // alt
      { rowIndex: 4, subgrid: dataSubgrid, localRowIndex: 7, top: 152, bottom: 182, height: 30 }, // alt
    ],
    firstRow: 1, lastRow: 7,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 100, bodyTop: 32, bodyBottom: 182, bodyWidth: 100, bodyHeight: 150,
    contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 850,
  };
}

// Viewport with a header row + 2 data rows on default bg (even indices 0, 2 → theme.bg)
function makeVsHeaderPlusDefault(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 }, // even → bg
      { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 2, top: 62, bottom: 92, height: 30 }, // even → bg
    ],
    firstRow: 0, lastRow: 2,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 100, bodyTop: 32, bodyBottom: 92, bodyWidth: 100, bodyHeight: 60,
    contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 910,
  };
}

// ─── Shared registry builders ────────────────────────────────────────────────

function makeReg(): CellRendererRegistry {
  const reg = new CellRendererRegistry();
  reg.register('text', textCell);
  reg.register('number', numberCell);
  reg.register('header', headerCell);
  return reg;
}

const cellData = () => ({ value: 'x', valueFormatted: 'x' });
const selection = { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() };

// ─── Bundle consolidation tests ───────────────────────────────────────────────

describe('paintCellsByRows — bundle consolidation', () => {
  it('3 consecutive alt rows produce exactly 1 bundle fillRect', () => {
    const gc = fakeGc();
    const vs = makeVsAltRows();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: cols, cellRenderers: makeReg(),
      cellData, selection, sortModel: [],
    });
    const calls = (gc.fillRect as any).mock.calls as number[][];
    // Bundle fillRects span a height > 30 (one row). The single alt bundle covers
    // all 3 rows: top=32, bottom=122, height=90. Filter by height to find it.
    const bundleFills = calls.filter((c) => c[3] === 90);
    expect(bundleFills.length).toBe(1);
    expect(bundleFills[0]![1]).toBe(32);  // top
  });

  it('mixed [alt, alt, default, alt, alt] rows produce 2 bundles', () => {
    const gc = fakeGc();
    const vs = makeVsMixedRows();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: cols, cellRenderers: makeReg(),
      cellData, selection, sortModel: [],
    });
    const calls = (gc.fillRect as any).mock.calls as number[][];
    // alt bundles have height=60 (2 rows × 30px each).
    const altBundles = calls.filter((c) => c[3] === 60);
    expect(altBundles.length).toBe(2);
  });

  it('header row + 2 default-bg data rows produce exactly 1 bundle (the header)', () => {
    const gc = fakeGc();
    const vs = makeVsHeaderPlusDefault();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: new Map([
        ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
      ]), cellRenderers: makeReg(),
      cellData, selection, sortModel: [],
    });
    const calls = (gc.fillRect as any).mock.calls as number[][];
    // Only the header bundle (height=32) should be painted. Data rows are theme.bg → skipped.
    // Header bg is #eee ≠ theme.bg (#fff), so 1 bundle.
    const headerBundle = calls.filter((c) => c[1] === 0 && c[3] === 32);
    expect(headerBundle.length).toBe(1);
  });
});

// ─── Cell paint count ─────────────────────────────────────────────────────────

describe('paintCellsByRows — cell paint count', () => {
  it('2 data rows × 3 columns + 1 header row × 3 columns = 9 cell paints total', () => {
    const paintSpy = vi.fn();
    const spyRenderer = { paint: paintSpy };
    const spyReg = new CellRendererRegistry();
    spyReg.register('text', spyRenderer);
    spyReg.register('number', spyRenderer);
    spyReg.register('header', spyRenderer);

    const vs: ViewportState = {
      visibleColumns: [
        { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
        { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
        { colId: 'c', index: 2, left: 200, right: 300, width: 100 },
      ],
      visibleRows: [
        { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
        { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
        { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 1, top: 62, bottom: 92, height: 30 },
      ],
      firstRow: 0, lastRow: 1,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: 300, bodyTop: 32, bodyBottom: 92, bodyWidth: 300, bodyHeight: 60,
      contentWidth: 300, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 940,
    };

    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: cols, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });

    // 1 header row × 3 cols + 2 data rows × 3 cols = 9
    expect(paintSpy).toHaveBeenCalledTimes(9);
  });
});

// ─── prefillColor propagation ─────────────────────────────────────────────────

describe('paintCellsByRows — prefillColor propagation', () => {
  it('bundled alt rows pass rowAltBg as prefillColor to the cell renderer', () => {
    const captured: CellPaintConfig[] = [];
    const spyRenderer = { paint: (_gc: CachedContext2D, p: CellPaintConfig) => { captured.push({ ...p, bounds: { ...p.bounds } }); } };
    const spyReg = new CellRendererRegistry();
    spyReg.register('text', spyRenderer);
    spyReg.register('number', spyRenderer);
    spyReg.register('header', spyRenderer);

    const vs = makeVsAltRows();
    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: cols, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });

    // All data cells in the alt-row bundle should have prefillColor === theme.rowAltBg
    for (const cfg of captured) {
      expect(cfg.prefillColor).toBe(theme.rowAltBg);
    }
  });
});

// ─── Column cellStyle override ─────────────────────────────────────────────────

describe('paintCellsByRows — column cellStyle override', () => {
  it('cellStyle.font on a column propagates to config.font', () => {
    const captured: CellPaintConfig[] = [];
    const spyRenderer = { paint: (_gc: CachedContext2D, p: CellPaintConfig) => { captured.push({ ...p, bounds: { ...p.bounds } }); } };
    const spyReg = new CellRendererRegistry();
    spyReg.register('text', spyRenderer);
    spyReg.register('header', spyRenderer);

    const colsWithStyle = new Map<string, ResolvedColDef>([
      ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text',
               sortable: true, resizable: true, editable: false, cellStyle: { font: '20px serif' } }],
    ]);

    const vs: ViewportState = {
      visibleColumns: [{ colId: 'a', index: 0, left: 0, right: 100, width: 100 }],
      visibleRows: [
        { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
      ],
      firstRow: 0, lastRow: 0,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: 100, bodyTop: 32, bodyBottom: 62, bodyWidth: 100, bodyHeight: 30,
      contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 970,
    };

    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colsWithStyle, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]!.font).toBe('20px serif');
  });
});

// ─── Header dispatch ──────────────────────────────────────────────────────────

describe('paintCellsByRows — header dispatch', () => {
  it('calls header renderer for header rows and NOT text renderer for them', () => {
    const capturedHeader: CellPaintConfig[] = [];
    const headerSpy = vi.fn((_gc: CachedContext2D, p: CellPaintConfig) => {
      capturedHeader.push({ ...p, bounds: { ...p.bounds } });
    });
    const textSpy = vi.fn();
    const spyReg = new CellRendererRegistry();
    spyReg.register('header', { paint: headerSpy });
    spyReg.register('text', { paint: textSpy });

    const colsA = new Map<string, ResolvedColDef>([
      ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
    ]);

    const vs: ViewportState = {
      visibleColumns: [{ colId: 'a', index: 0, left: 0, right: 100, width: 100 }],
      visibleRows: [
        { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
        { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
      ],
      firstRow: 0, lastRow: 0,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: 100, bodyTop: 32, bodyBottom: 62, bodyWidth: 100, bodyHeight: 30,
      contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 970,
    };

    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colsA, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });

    expect(headerSpy).toHaveBeenCalledTimes(1);  // 1 header row × 1 col
    expect(textSpy).toHaveBeenCalledTimes(1);    // 1 data row × 1 col
    // The captured snapshot from the header call must have isHeader=true
    expect(capturedHeader[0]!.isHeader).toBe(true);
  });
});

// ─── Header-region bleed regression ───────────────────────────────────────────

describe('paintCellsByRows — data rows do not bleed into header region', () => {
  // When the user scrolls, computeViewport returns overscan data rows whose
  // `top` is < bodyTop (i.e. visually inside the header band). Without per-band
  // clipping the painter draws those rows' backgrounds and cell text on top of
  // the header. Regression repro for the screenshot reported in Cycle 4.

  function makeScrolledViewport(): ViewportState {
    // Layout: 1 header row (height 32), bodyTop=32, body height=120.
    // First "visible" data row is local index 4 (rowH=30, scrollTop≈100), but
    // overscan pulls in local 1..3 too — and local 1's top = 32 + 30 - 100 = -38.
    return {
      visibleColumns: [
        { colId: 'p', index: 0, left: 0, right: 60, width: 60, pinned: 'left' },
        { colId: 'a', index: 1, left: 60, right: 160, width: 100 },
        { colId: 'r', index: 2, left: 160, right: 220, width: 60, pinned: 'right' },
      ],
      visibleRows: [
        { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
        // Overscan rows above the viewport — all have top < bodyTop (32).
        { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: -38, bottom: -8, height: 30 },
        { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 3, top: -8, bottom: 22, height: 30 },
        { rowIndex: 3, subgrid: dataSubgrid, localRowIndex: 5, top: 22, bottom: 52, height: 30 },
      ],
      firstRow: 1, lastRow: 5,
      scrollLeft: 0, scrollTop: 100,
      bodyLeft: 60, bodyRight: 160, bodyTop: 32, bodyBottom: 152,
      bodyWidth: 100, bodyHeight: 120,
      contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 850,
    };
  }

  const colsLPR = new Map<string, ResolvedColDef>([
    ['p', { colId: 'p', headerName: 'P', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false, columnGroupShow: null }],
    ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false, columnGroupShow: null }],
    ['r', { colId: 'r', headerName: 'R', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false, columnGroupShow: null }],
  ]);

  it('row-background fillRects for data rows never paint above bodyTop', () => {
    const gc = fakeGc();
    const vs = makeScrolledViewport();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colsLPR, cellRenderers: makeReg(),
      cellData, selection, sortModel: [],
    });
    const calls = (gc.fillRect as any).mock.calls as number[][];
    // The header row uses theme.headerBg (different from theme.bg), so it
    // produces a bundle fillRect with top=0, height=32 — that is allowed.
    // Every OTHER fillRect (data-row bundles) must NOT cross y=bodyTop.
    for (const [, top, , height] of calls) {
      if (top === 0 && height === 32) continue; // header bundle
      expect(top).toBeGreaterThanOrEqual(vs.bodyTop);
    }
  });

  it('pinned-left band wraps its data-row paints in a clip from bodyTop', () => {
    const paintsByCol: { colId: string; y: number }[] = [];
    const captureRenderer = {
      paint: (_gc: CachedContext2D, p: CellPaintConfig) => {
        paintsByCol.push({ colId: '', y: p.bounds.y }); // colId not on config; y is what we assert
      },
    };
    const spyReg = new CellRendererRegistry();
    spyReg.register('text', captureRenderer);
    spyReg.register('header', captureRenderer);

    const gc = fakeGc();
    const vs = makeScrolledViewport();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colsLPR, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });
    // The painter must save/clip/restore around the pinned-left + pinned-right
    // data-row paints. Without it, data cells with bounds.y < bodyTop paint
    // visibly into the header area. Look for at least one clip rect that
    // starts at y=bodyTop and spans the body region.
    const rectCalls = (gc.rect as any).mock.calls as number[][];
    const bodyClips = rectCalls.filter(([, y, , h]) =>
      y === vs.bodyTop && h === vs.bodyBottom - vs.bodyTop,
    );
    // One per band (left + center + right) when data subgrid is active.
    expect(bodyClips.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Within-band cell-to-cell bleed regression ────────────────────────────────

describe('paintCellsByRows — text in one cell cannot bleed into the next cell', () => {
  // When a value is wider than its column (e.g. a long Position ID in a
  // narrow pinned-left column) the cell renderer draws past col.right. The
  // band-level clip prevents bleed BETWEEN bands but not WITHIN one — two
  // adjacent pinned-left columns share the same band clip, so Position ID
  // overflows into CUSIP unless every cell additionally clips to its own
  // bounds. Regression repro for the second screenshot in Cycle 4.

  it('wraps each cell paint in a clip rect matching its column bounds', () => {
    const colsTwo = new Map<string, ResolvedColDef>([
      ['posId', { colId: 'posId', headerName: 'Position ID', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false, columnGroupShow: null }],
      ['cusip', { colId: 'cusip', headerName: 'CUSIP', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false, columnGroupShow: null }],
    ]);
    const vs: ViewportState = {
      visibleColumns: [
        { colId: 'posId', index: 0, left: 0, right: 80, width: 80, pinned: 'left' },
        { colId: 'cusip', index: 1, left: 80, right: 160, width: 80, pinned: 'left' },
      ],
      visibleRows: [
        { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 1, top: 32, bottom: 62, height: 30 },
      ],
      firstRow: 1, lastRow: 1,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 160, bodyRight: 400, bodyTop: 32, bodyBottom: 200,
      bodyWidth: 240, bodyHeight: 168,
      contentWidth: 240, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 800,
    };
    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colsTwo, cellRenderers: makeReg(),
      cellData: () => ({ value: 'POS-' + 'x'.repeat(50), valueFormatted: 'POS-' + 'x'.repeat(50) }),
      selection, sortModel: [],
    });
    // The painter must set a per-cell clip rect of [col.left, row.top, col.width, row.height]
    // around each cell paint. With 2 cells in the row we expect at least 2 such rect calls.
    const rectCalls = (gc.rect as any).mock.calls as number[][];
    const cellClips = rectCalls.filter(([x, y, w, h]) =>
      ((x === 0 && w === 80) || (x === 80 && w === 80)) && y === 32 && h === 30,
    );
    expect(cellClips.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Pinned columns paint ──────────────────────────────────────────────────────

describe('paintCellsByRows — pinned columns paint', () => {
  it('calls renderer for left-pinned column cells', () => {
    const paintSpy = vi.fn();
    const spyReg = new CellRendererRegistry();
    spyReg.register('text', { paint: paintSpy });
    spyReg.register('header', { paint: paintSpy });

    const colsWithPinned = new Map<string, ResolvedColDef>([
      ['p', { colId: 'p', headerName: 'P', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
      ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
    ]);

    const vs: ViewportState = {
      visibleColumns: [
        { colId: 'p', index: 0, left: 0, right: 60, width: 60, pinned: 'left' },
        { colId: 'a', index: 1, left: 60, right: 160, width: 100 },
      ],
      visibleRows: [
        { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
      ],
      firstRow: 0, lastRow: 0,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 60, bodyRight: 160, bodyTop: 32, bodyBottom: 62, bodyWidth: 100, bodyHeight: 30,
      contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 970,
    };

    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colsWithPinned, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });

    // 1 data row × 2 cols (1 pinned + 1 center) = 2 calls
    expect(paintSpy).toHaveBeenCalledTimes(2);
  });
});

// ─── Clip calls for center band ───────────────────────────────────────────────

describe('paintCellsByRows — center band clipping', () => {
  it('calls gc.save and gc.clip when there are center columns', () => {
    const vs: ViewportState = {
      visibleColumns: [
        { colId: 'a', index: 0, left: 0, right: 100, width: 100 }, // center (no pinned)
      ],
      visibleRows: [
        { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
      ],
      firstRow: 0, lastRow: 0,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: 100, bodyTop: 32, bodyBottom: 62, bodyWidth: 100, bodyHeight: 30,
      contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 970,
    };

    const spyReg = makeReg();
    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: cols, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });

    expect((gc.save as any)).toHaveBeenCalled();
    expect((gc.clip as any)).toHaveBeenCalled();
  });
});

// ─── HeaderGroupSubgrid span paint ────────────────────────────────────────────

describe('paintCellsByRows — HeaderGroupSubgrid span paint', () => {
  it('3 adjacent leaves sharing a group paint as one span (one header renderer call) with merged width', () => {
    const tree = resolveColumnTree([
      { field: 'id' },
      { groupId: 'pnl', headerName: 'P&L',
        children: [{ field: 'daily' }, { field: 'mtd' }, { field: 'ytd' }] },
    ]);
    const groupSubgrid = new HeaderGroupSubgrid(() => tree, () => 24, 0, () => ['id', 'daily', 'mtd', 'ytd']);

    const captured: CellPaintConfig[] = [];
    const headerSpy = vi.fn((_gc: CachedContext2D, p: CellPaintConfig) => {
      captured.push({ ...p, bounds: { ...p.bounds } });
    });
    const textSpy = vi.fn();
    const numberSpy = vi.fn();
    const spyReg = new CellRendererRegistry();
    spyReg.register('header', { paint: headerSpy });
    spyReg.register('text', { paint: textSpy });
    spyReg.register('number', { paint: numberSpy });

    const colDefs = new Map<string, ResolvedColDef>([
      ['id',    { colId: 'id',    headerName: 'ID',    minWidth: 30, maxWidth: Infinity, type: 'text',   cellRenderer: 'text',   sortable: true, resizable: true, editable: false }],
      ['daily', { colId: 'daily', headerName: 'Daily', minWidth: 30, maxWidth: Infinity, type: 'number', cellRenderer: 'number', sortable: true, resizable: true, editable: false }],
      ['mtd',   { colId: 'mtd',   headerName: 'MTD',   minWidth: 30, maxWidth: Infinity, type: 'number', cellRenderer: 'number', sortable: true, resizable: true, editable: false }],
      ['ytd',   { colId: 'ytd',   headerName: 'YTD',   minWidth: 30, maxWidth: Infinity, type: 'number', cellRenderer: 'number', sortable: true, resizable: true, editable: false }],
    ]);

    const vs: ViewportState = {
      visibleColumns: [
        { colId: 'id',    index: 0, left: 0,   right: 60,  width: 60 },
        { colId: 'daily', index: 1, left: 60,  right: 160, width: 100 },
        { colId: 'mtd',   index: 2, left: 160, right: 260, width: 100 },
        { colId: 'ytd',   index: 3, left: 260, right: 360, width: 100 },
      ],
      visibleRows: [
        { rowIndex: 0, subgrid: groupSubgrid, localRowIndex: 0, top: 0, bottom: 24, height: 24 },
      ],
      firstRow: 0, lastRow: -1,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: 360, bodyTop: 24, bodyBottom: 24, bodyWidth: 360, bodyHeight: 0,
      contentWidth: 360, contentHeight: 0, maxScrollLeft: 0, maxScrollTop: 0,
    };

    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colDefs, cellRenderers: spyReg,
      cellData, selection, sortModel: [],
    });

    // Only one header renderer call for the spanned group; 'id' has no group at this depth → no call.
    expect(headerSpy).toHaveBeenCalledTimes(1);
    expect(textSpy).not.toHaveBeenCalled();
    expect(numberSpy).not.toHaveBeenCalled();
    // Captured config should have the merged width (daily.left=60 to ytd.right=360) = 300.
    expect(captured[0]!.bounds.x).toBe(60);
    expect(captured[0]!.bounds.w).toBe(300);
    expect(captured[0]!.valueFormatted).toBe('P&L');
    expect(captured[0]!.isHeader).toBe(true);
  });
});

// ─── paintGridLines tests (carried over + new header→body separator test) ─────

const vsGridLines: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [
    { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
    { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: 62, bottom: 92, height: 30 },
  ],
  firstRow: 0, lastRow: 1,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 92, bodyWidth: 250, bodyHeight: 60,
  contentWidth: 250, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 0,
};

const selectionEmpty = { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() };

describe('paintGridLines', () => {
  it('writes one fillRect per row bottom + one per inter-column gap + one header separator', () => {
    const c = fakeGc();
    paintGridLines(c, { viewport: vsGridLines, theme, columnDefs: cols, cellRenderers: makeReg(), cellData, selection: selectionEmpty, sortModel: [] });
    const calls = (c.fillRect as any).mock.calls as number[][];
    const horizontals = calls.filter((call) => call[3] === 1).length; // height === 1
    const verticals = calls.filter((call) => call[2] === 1).length;   // width === 1
    // 2 data row bottoms + 1 header→body separator = 3 horizontal lines
    expect(horizontals).toBe(vsGridLines.visibleRows.length + 1); // 3
    expect(verticals).toBe(vsGridLines.visibleColumns.length - 1); // 1
  });

  it('does not call stroke or strokeRect', () => {
    const c = fakeGc();
    paintGridLines(c, { viewport: vsGridLines, theme, columnDefs: cols, cellRenderers: makeReg(), cellData, selection: selectionEmpty, sortModel: [] });
    expect((c.stroke as any)).not.toHaveBeenCalled();
    expect((c.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('adds heavier band-edge lines for pinned columns', () => {
    const c = fakeGc();
    const vsPinned: ViewportState = {
      ...vsGridLines,
      bodyLeft: 60, bodyRight: 200, bodyWidth: 140,
      visibleColumns: [
        { colId: 'p', index: 0, left: 0, right: 60, width: 60, pinned: 'left' as const },
        { colId: 'a', index: 1, left: 60, right: 130, width: 70 },
        { colId: 'b', index: 2, left: 130, right: 200, width: 70 },
        { colId: 'q', index: 3, left: 200, right: 250, width: 50, pinned: 'right' as const },
      ],
    };
    paintGridLines(c, { viewport: vsPinned, theme, columnDefs: cols, cellRenderers: makeReg(), cellData, selection: selectionEmpty, sortModel: [] });
    const calls = (c.fillRect as any).mock.calls as number[][];
    const bodyH = vsPinned.bodyBottom - vsPinned.bodyTop;
    const fullHeightVerticals = calls.filter((call) => call[2] === 1 && call[3] === bodyH).length;
    expect(fullHeightVerticals).toBe(3); // 2 band edges + 1 inter-center gap
  });

  it('paints the header→body separator when bodyTop > 0', () => {
    const c = fakeGc();
    // Use vsGridLines which has bodyTop = 32
    paintGridLines(c, { viewport: vsGridLines, theme, columnDefs: cols, cellRenderers: makeReg(), cellData, selection: selectionEmpty, sortModel: [] });
    const calls = (c.fillRect as any).mock.calls as number[][];
    // Separator: y = Math.round(32) - 1 = 31, height = 1, x = 0, width = rightEdge
    const rightEdge = Math.max(vsGridLines.bodyRight, ...vsGridLines.visibleColumns.map((c) => c.right));
    const separators = calls.filter((call) => call[1] === 31 && call[3] === 1 && call[2] === rightEdge);
    expect(separators.length).toBe(1);
  });
});

// ─── paintOverlay tests (carried over verbatim) ───────────────────────────────

describe('paintOverlay', () => {
  it('draws focus ring when focused cell is set', () => {
    const c = fakeGc();
    paintOverlay(c, {
      viewport: vsGridLines, theme, columnDefs: cols, cellRenderers: makeReg(), cellData,
      selection: { focusedRowIndex: 0, focusedColId: 'b', selectedRowIndices: new Set() },
      sortModel: [],
    });
    expect((c.strokeRect as any)).toHaveBeenCalled();
  });

  it('does not draw focus ring when no cell is focused', () => {
    const c = fakeGc();
    paintOverlay(c, {
      viewport: vsGridLines, theme, columnDefs: cols, cellRenderers: makeReg(), cellData,
      selection: selectionEmpty,
      sortModel: [],
    });
    expect((c.strokeRect as any)).not.toHaveBeenCalled();
  });
});
