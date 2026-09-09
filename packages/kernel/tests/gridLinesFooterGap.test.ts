/**
 * The two paint paths must draw the same vertical lines.
 *
 * Body gridlines reach the canvas two different ways. A full repaint calls
 * `paintGridLines(gc, pctx)` once; the paint-cache path splits it into a
 * `'chrome'` pass (header region only) and a `'layer'` pass (the data band).
 * Whichever runs, the result has to look identical — the layer exists to
 * avoid repainting, not to paint something else.
 *
 * They disagreed about where the verticals STOP. The scan that finds the
 * bottom-most row skipped non-data rows only in `'layer'` mode, so the
 * combined pass ran the lattice down through a pinned bottom totals row
 * while the layer pass stopped at the last data row. With rows filling the
 * viewport nothing showed, because both bottoms coincide. Leave a gap —
 * a grouped SSRM view collapsed to eight rows above a pinned grand total —
 * and every alternation between the two paths added or removed a column
 * lattice in the empty band. It read as vertical lines flickering on and
 * off below the last row.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { paintGridLines } from '../src/renderer/painters/gridLinesPainter';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

beforeAll(() => {
  if (typeof (globalThis as never as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as never as { Path2D: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
});

const CANVAS_W = 300;

const theme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

const headerSubgrid: Subgrid = {
  type: 'header', isHeader: true, isData: false, isTotals: false, isFooter: false,
  getRowCount: () => 1, getRowHeight: () => 32, getCell: () => null,
};
const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 2, getRowHeight: () => 30, getCell: () => null,
};
/** The pinned grand total, parked at the bottom of the body. */
const totalsSubgrid: Subgrid = {
  type: 'totals', isHeader: false, isData: false, isTotals: true, isFooter: true,
  getRowCount: () => 1, getRowHeight: () => 30, getCell: () => null,
};

/**
 * Header 0-32, two data rows 32-92, then a GAP, then the pinned total at
 * 270-300. The gap is the whole point: without it both passes stop in the
 * same place and the disagreement is invisible.
 */
function makeVs(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 150, width: 150 },
      { colId: 'b', index: 1, left: 150, right: CANVAS_W, width: 150 },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
      { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 1, top: 62, bottom: 92, height: 30 },
      { rowIndex: 3, subgrid: totalsSubgrid, localRowIndex: 0, top: 270, bottom: 300, height: 30 },
    ],
    firstRow: 1, lastRow: 3,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: CANVAS_W, bodyTop: 32, bodyBottom: 300,
    bodyWidth: CANVAS_W, bodyHeight: 268,
    contentWidth: CANVAS_W, contentHeight: 268, maxScrollLeft: 0, maxScrollTop: 0,
  } as ViewportState;
}

interface Rect { x: number; y: number; w: number; h: number }

/** Records `fillRect`; verticals are the tall, hairline-wide ones. */
function recordingGc(): { gc: CachedContext2D; rects: Rect[] } {
  const rects: Rect[] = [];
  const ctx: Record<string, unknown> = {
    fillRect: (x: number, y: number, w: number, h: number) => { rects.push({ x, y, w, h }); },
    strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), arcTo: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
    measureText: () => ({ width: 10 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1,
  };
  ctx.cache = new Proxy(ctx, {
    get: (t, k) => (t as Record<string | symbol, unknown>)[k],
    set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; },
  });
  ctx.clearFill = vi.fn();
  return { gc: ctx as unknown as CachedContext2D, rects };
}

const verticals = (rects: Rect[]) =>
  rects.filter((r) => r.w <= 2 && r.h > 2)
    .map((r) => `${Math.round(r.x)}:${Math.round(r.y)}..${Math.round(r.y + r.h)}`)
    .sort();

function paint(mode?: 'layer' | 'chrome'): string[] {
  const { gc, rects } = recordingGc();
  paintGridLines(gc, { viewport: makeVs(), theme } as never, mode);
  return verticals(rects);
}

describe('vertical gridlines below the last data row', () => {
  it('the combined pass and the layered passes agree', () => {
    // The invariant. A full repaint and a chrome+layer repaint of the same
    // viewport must put the same verticals in the same places — otherwise
    // whichever path runs this frame changes what the user sees.
    const combined = paint();
    const layered = [...paint('chrome'), ...paint('layer')].sort();
    expect(layered).toEqual(combined);
  });

  it('nothing is drawn in the gap above the pinned total', () => {
    // 92 is the bottom of the last data row, 270 the top of the pinned
    // total. A vertical crossing that band is the flicker.
    for (const v of paint()) {
      const end = Number(v.split('..')[1]);
      expect(end).toBeLessThanOrEqual(92);
    }
  });

  it('the data band itself still gets its verticals', () => {
    // Guard against "fixed" by drawing nothing at all.
    expect(paint().length).toBeGreaterThan(0);
    expect(paint('layer').length).toBeGreaterThan(0);
  });
});
