// Cycle 12 / Task 1 — getVisibleCellBounds helper.
//
// The helper is the band-aware sibling of `getCellBoundsAt`: it returns
// the same `{x, y, w, h}` rectangle whenever the cell is fully inside
// its column's horizontal band AND inside the data body's vertical band
// `[bodyTop, bodyBottom]`. Returns `null` for every leak case so the
// four overlay sites (focus ring, range overlay, DOM editor, floating-
// filter input) can stop reimplementing band math.
//
// The 12 cases below cover every band-leak shape we shipped a patch for
// across Cycles 10–11 (commit refs in the worklog).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import type { ViewportState, ViewportColumn, ViewportRow } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';

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

// A minimal data-subgrid stub used to flag a ViewportRow as a data row
// so getCellBoundsAt's `r.subgrid.isData && r.localRowIndex === rowIndex`
// filter matches. The helper never calls into the subgrid methods.
const dataSubgrid: Subgrid = {
  type: 'data',
  isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 0,
  getRowHeight: () => 30,
  getCell: () => null,
};

function buildGrid(): CGrid<{ id: string }> {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:400px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<{ id: string }>(container, {
    columnDefs: [{ field: 'id' }],
    getRowId: (r) => r.id,
  });
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return grid;
}

interface ViewportFixture {
  bodyTop?: number;
  bodyBottom?: number;
  bodyLeft?: number;
  bodyRight?: number;
  columns: ViewportColumn[];
  rows: ViewportRow[];
}

/** Replace `grid.viewport` with a hand-crafted state so each case
 *  exercises one precise band-leak shape independent of layout math. */
function setViewport(grid: CGrid<any>, fx: ViewportFixture): void {
  const vs: ViewportState = {
    visibleColumns: fx.columns,
    visibleRows: fx.rows,
    firstRow: 0,
    lastRow: fx.rows.filter((r) => r.subgrid.isData).length - 1,
    scrollLeft: 0,
    scrollTop: 0,
    bodyLeft: fx.bodyLeft ?? 80,
    bodyRight: fx.bodyRight ?? 720,
    bodyTop: fx.bodyTop ?? 32,
    bodyBottom: fx.bodyBottom ?? 400,
    bodyWidth: (fx.bodyRight ?? 720) - (fx.bodyLeft ?? 80),
    bodyHeight: (fx.bodyBottom ?? 400) - (fx.bodyTop ?? 32),
    contentWidth: 1000,
    contentHeight: 5000,
    maxScrollLeft: 200,
    maxScrollTop: 4600,
  };
  (grid as any).viewport = vs;
}

function col(
  colId: string,
  left: number,
  width: number,
  pinned?: 'left' | 'right',
): ViewportColumn {
  return { colId, index: 0, left, right: left + width, width, pinned };
}

function row(localRowIndex: number, top: number, height = 30): ViewportRow {
  return { rowIndex: 0, subgrid: dataSubgrid, localRowIndex, top, bottom: top + height, height };
}

describe('CGrid.getVisibleCellBounds', () => {
  // ---------------------------------------------------------------------------
  // center column
  // ---------------------------------------------------------------------------

  it('center column — cell fully in body band → returns bounds', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('a', 100, 200)],
      rows: [row(0, 50)],
    });
    expect(grid.getVisibleCellBounds(0, 'a')).toEqual({ x: 100, y: 50, w: 200, h: 30 });
    grid.destroy();
  });

  it('center column — cell scrolled past bodyLeft (straddles pinned-left edge) → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('a', 50, 200)], // x=[50, 250] crosses bodyLeft=80
      rows: [row(0, 50)],
    });
    expect(grid.getVisibleCellBounds(0, 'a')).toBeNull();
    grid.destroy();
  });

  it('center column — cell scrolled past bodyRight → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('a', 600, 200)], // x=[600, 800] crosses bodyRight=720
      rows: [row(0, 50)],
    });
    expect(grid.getVisibleCellBounds(0, 'a')).toBeNull();
    grid.destroy();
  });

  it('center column — row scrolled above bodyTop (straddles header) → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('a', 100, 200)],
      rows: [row(0, 20)], // y=[20, 50] crosses bodyTop=32
    });
    expect(grid.getVisibleCellBounds(0, 'a')).toBeNull();
    grid.destroy();
  });

  it('center column — row scrolled below bodyBottom → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('a', 100, 200)],
      rows: [row(0, 380)], // y=[380, 410] crosses bodyBottom=400
    });
    expect(grid.getVisibleCellBounds(0, 'a')).toBeNull();
    grid.destroy();
  });

  // ---------------------------------------------------------------------------
  // pinned-left column
  // ---------------------------------------------------------------------------

  it('pinned-left column — cell fully visible → returns bounds', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('pl', 0, 80, 'left')], // x=[0, 80] ⊂ [0, bodyLeft=80]
      rows: [row(0, 50)],
    });
    expect(grid.getVisibleCellBounds(0, 'pl')).toEqual({ x: 0, y: 50, w: 80, h: 30 });
    grid.destroy();
  });

  it('pinned-left column — row scrolled past bodyTop (header overlap) → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('pl', 0, 80, 'left')],
      rows: [row(0, 20)], // y=[20, 50] crosses bodyTop=32
    });
    expect(grid.getVisibleCellBounds(0, 'pl')).toBeNull();
    grid.destroy();
  });

  it('pinned-left column — fully visible regardless of horizontal scroll → returns bounds', () => {
    // Pinned-left columns never move; the helper must not reject them by
    // confusing their `left` with the center band's `[bodyLeft, bodyRight]`.
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('pl', 0, 80, 'left')],
      rows: [row(0, 100)],
    });
    // Mutate scrollLeft to simulate a horizontal scroll; the helper must
    // still return the bounds because the pinned column's band is
    // `[0, bodyLeft]`, not the center band.
    (grid as any).viewport.scrollLeft = 999;
    expect(grid.getVisibleCellBounds(0, 'pl')).toEqual({ x: 0, y: 100, w: 80, h: 30 });
    grid.destroy();
  });

  // ---------------------------------------------------------------------------
  // pinned-right column
  // ---------------------------------------------------------------------------

  it('pinned-right column — cell fully visible → returns bounds', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('pr', 720, 80, 'right')], // x=[720, 800] in right band [bodyRight=720, +∞)
      rows: [row(0, 50)],
    });
    expect(grid.getVisibleCellBounds(0, 'pr')).toEqual({ x: 720, y: 50, w: 80, h: 30 });
    grid.destroy();
  });

  it('pinned-right column — row scrolled past bodyBottom → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('pr', 720, 80, 'right')],
      rows: [row(0, 380)], // y=[380, 410] crosses bodyBottom=400
    });
    expect(grid.getVisibleCellBounds(0, 'pr')).toBeNull();
    grid.destroy();
  });

  // ---------------------------------------------------------------------------
  // miss cases — row / column not in viewport at all
  // ---------------------------------------------------------------------------

  it('off-viewport row (rowIndex past lastRow) → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('a', 100, 200)],
      rows: [row(0, 50)], // only localRowIndex=0 is materialised
    });
    expect(grid.getVisibleCellBounds(999, 'a')).toBeNull();
    grid.destroy();
  });

  it('unknown colId → null', () => {
    const grid = buildGrid();
    setViewport(grid, {
      columns: [col('a', 100, 200)],
      rows: [row(0, 50)],
    });
    expect(grid.getVisibleCellBounds(0, 'does-not-exist')).toBeNull();
    grid.destroy();
  });
});
