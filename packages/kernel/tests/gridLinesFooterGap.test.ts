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

/**
 * The totals row's hairline must not live in the layer's territory.
 *
 * The border is chrome art — the `'layer'` pass skips it deliberately. But it
 * was painted at `row.top - 1`, and for a BOTTOM-pinned totals row that is
 * the last pixel of the body, which the damage model assigns to the data
 * domain. So a frame carrying data damage and no chrome damage repainted that
 * pixel with the row background and nothing put the hairline back until the
 * next chrome frame. The divider above the grand total blinked, which reads
 * as the row changing height.
 *
 * Measured on the demos before the fix, border present per 120 frames:
 * SSRM 27, CSRM 51. After: 120 and 120.
 *
 * Pixels at or past `bodyBottom` are never touched by the layer, so the
 * hairline goes on the totals row's own first pixel. A TOP-pinned row keeps
 * the lift, because there it rises into the header band, which is chrome.
 */
describe('the pinned totals hairline survives a data-only repaint', () => {
  /**
   * Real geometry, taken from the running demos: a pinned totals row starts
   * exactly AT `bodyBottom` (measured 441/441 ungrouped, 512/512 grouped).
   * The band above it can be empty — the body owns that space either way.
   */
  function pinnedVs(): ViewportState {
    return {
      ...makeVs(),
      bodyBottom: 270,
      visibleRows: [
        ...makeVs().visibleRows.slice(0, 3),
        { rowIndex: 3, subgrid: totalsSubgrid, localRowIndex: 0, top: 270, bottom: 300, height: 30 },
      ],
    } as ViewportState;
  }

  const borderRects = (rects: Rect[]) =>
    rects.filter((r) => r.h === 1 && r.w > 2).map((r) => Math.round(r.y));

  function paintWith(mode: 'layer' | 'chrome' | undefined, vs: ViewportState): number[] {
    const { gc, rects } = recordingGc();
    paintGridLines(gc, { viewport: vs, theme } as never, mode);
    return borderRects(rects);
  }

  it('a bottom-pinned row draws its border INSIDE itself, not in the body', () => {
    const lines = paintWith(undefined, pinnedVs());
    // 270 is the row's own first pixel and past bodyBottom; 269 is the body's
    // last pixel, which the layer repaints.
    expect(lines).toContain(270);
    expect(lines).not.toContain(269);
  });

  it('nothing the chrome pass draws below the header sits inside the body', () => {
    // The general invariant behind the fix: chrome art inside [bodyTop,
    // bodyBottom) is art the layer will erase.
    const vs = pinnedVs();
    for (const y of paintWith('chrome', vs)) {
      if (y >= vs.bodyTop) expect(y).toBeGreaterThanOrEqual(vs.bodyBottom);
    }
  });

  it('a TOP-pinned totals row keeps the lift — it rises into the header', () => {
    const base = makeVs();
    const lifted: ViewportState = {
      ...base,
      bodyTop: 62,
      visibleRows: [
        base.visibleRows[0]!,
        { rowIndex: 1, subgrid: totalsSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
        { ...base.visibleRows[1]!, top: 62, bottom: 92 },
      ],
    } as ViewportState;
    // 31 is above bodyTop, so chrome owns it and the lift is safe to keep.
    expect(paintWith(undefined, lifted)).toContain(31);
  });
});
