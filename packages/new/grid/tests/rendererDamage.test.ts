import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Renderer, type RendererOpts } from '../src/renderer/renderer';
import { CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

// ─── fakeGc ──────────────────────────────────────────────────────────────────
// Mirrors the recording idiom from tests/byRows.test.ts's fakeGc, but records
// every call (method name + args) into a flat array so the assertions below
// can inspect ORDER + args across save/restore/beginPath/rect/clip/fillRect.

interface RecordedCall { m: string; args: unknown[] }

function fakeGc(): { gc: CachedContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const rec = (m: string) => (...args: unknown[]) => { calls.push({ m, args }); };
  const ctx: any = {
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'),
    save: rec('save'), restore: rec('restore'),
    rect: rec('rect'), clip: rec('clip'), beginPath: rec('beginPath'), stroke: rec('stroke'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'), closePath: rec('closePath'),
    translate: rec('translate'), scale: rec('scale'),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return { gc: ctx as CachedContext2D, calls };
}

// ─── Empty viewport + minimal opts ───────────────────────────────────────────
// Empty visibleColumns/visibleRows means every painter (byRows, gridLines,
// stickyGroups, overlay, rangeOverlay) early-exits with zero gc calls, so
// the ONLY calls renderer.paint() itself makes are the bg-fill / clip calls
// under test.

const CANVAS_W = 400;
const CANVAS_H = 300;

function makeEmptyViewport(): ViewportState {
  return {
    visibleColumns: [], visibleRows: [],
    firstRow: -1, lastRow: -1,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 0, bodyTop: 0, bodyBottom: 0, bodyWidth: 0, bodyHeight: 0,
    contentWidth: 0, contentHeight: 0, maxScrollLeft: 0, maxScrollTop: 0,
  };
}

const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as ResolvedTheme;

function makeOpts(): RendererOpts {
  const columnDefs = new Map<string, ResolvedColDef>();
  return {
    getViewport: () => makeEmptyViewport(),
    getTheme: () => theme,
    getColumnDefs: () => columnDefs,
    cellRenderers: new CellRendererRegistry(),
    cellData: () => null,
    getSelection: () => ({
      focusedRowIndex: null, focusedColId: null,
      selectedRowIndices: new Set<number>(), ranges: [],
    }),
    getSortModel: () => [],
    getCanvasWidth: () => CANVAS_W,
    getCanvasHeight: () => CANVAS_H,
    rowDataSnapshotAt: () => ({}),
    getQuickFilterLowerTerms: () => [],
    getShowFillHandle: () => false,
    getSuppressAggFuncInHeader: () => false,
    getVisibleCellBounds: () => null,
    getGroupRowStrip: () => null,
    getRowKindAt: () => 0,
    getGroupHideOpenParents: () => false,
    getStickyAncestors: () => [],
    getGroupDepthAt: () => 0,
    getGroupKeyAt: () => '',
  };
}

describe('Renderer.paint — damage-aware clip + background fill', () => {
  let renderer: Renderer;

  beforeEach(() => {
    renderer = new Renderer(makeOpts());
  });

  it('full damage paints without any clip', () => {
    const { gc, calls } = fakeGc();
    renderer.paint(gc, { full: true, chromeRects: [], dataRects: [], blit: null });
    expect(calls.filter((c) => c.m === 'clip')).toHaveLength(0);
    expect(calls.some((c) => c.m === 'fillRect' && c.args[2] === CANVAS_W && c.args[3] === CANVAS_H)).toBe(true);
  });

  // `makeEmptyViewport` has scrollTop === bodyTop === 0, so `dataRects`
  // entries map back to screen space unchanged (`dataRectToScreen` is a
  // numeric no-op) — same rect values the pre-two-domain `rects` field used.
  it('partial damage clips to the union and background-fills per rect', () => {
    const { gc, calls } = fakeGc();
    renderer.paint(gc, { full: false, chromeRects: [], dataRects: [{ x: 10, y: 20, w: 100, h: 50 }], blit: null });
    expect(calls.some((c) => c.m === 'clip')).toBe(true);
    expect(calls.some((c) => c.m === 'rect' && c.args[0] === 10 && c.args[1] === 20)).toBe(true);
    // background fill is per damage rect, NOT full surface
    expect(calls.some((c) => c.m === 'fillRect' && c.args[2] === CANVAS_W && c.args[3] === CANVAS_H)).toBe(false);
    expect(calls.some((c) => c.m === 'fillRect' && c.args[0] === 10 && c.args[3] === 50)).toBe(true);
  });

  it('zero-rect partial damage paints nothing', () => {
    const { gc, calls } = fakeGc();
    const before = calls.length;
    renderer.paint(gc, { full: false, chromeRects: [], dataRects: [], blit: null });
    expect(calls.length).toBe(before); // no draw calls at all
  });

  it('undefined damage behaves as full (back-compat)', () => {
    const { gc, calls } = fakeGc();
    renderer.paint(gc);
    expect(calls.some((c) => c.m === 'fillRect' && c.args[2] === CANVAS_W)).toBe(true);
  });

  it('partial damage wraps the clip + fills in a save/restore pair', () => {
    const { gc, calls } = fakeGc();
    renderer.paint(gc, { full: false, chromeRects: [{ x: 0, y: 0, w: 10, h: 10 }], dataRects: [], blit: null });
    expect(calls[0]!.m).toBe('save');
    expect(calls[calls.length - 1]!.m).toBe('restore');
  });
});
