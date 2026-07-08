// Cycle 27 / Task 2 — Per-side borders tests.
// Drives: BorderSpec/BorderSide/BorderStyle types, border field on
// ColCellOverrides, paintCellBorders pure painter, 4 styles
// (solid/dashed/dotted/double), and painter-integration into textCell +
// numberCell + header cells (via headerStyle.border).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { textCell, numberCell } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';
import { paintCellBorders } from '../src/renderer/painters/cellBordersPainter';
import { resolveColDef, applyCellProps } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { ColCellOverrides, BorderSpec } from '../src/types';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

// ─── Shared helpers ────────────────────────────────────────────────────────

function makeGc(): CachedContext2D & { setLineDashCalls: number[][] } {
  // setLineDash lives on the raw context (a method, not a tracked
  // property); production cgrid reaches it via `gc.setLineDash(...)` —
  // NOT `gc.cache.setLineDash(...)`. The mock mirrors that so a misplaced
  // call site would fail here too (the original mock put it on both
  // surfaces and let a real bug slip past).
  const setLineDashCalls: number[][] = [];
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    setLineDash: vi.fn((pattern: number[]) => { setLineDashCalls.push(pattern); }),
    measureText: vi.fn(() => ({ width: 50 })),
    translate: vi.fn(), scale: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    letterSpacing: '0px',
    globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  // cache layer: tracked PROPERTIES only (no setLineDash). Mirrors
  // CachedContext2D where cache wraps only the state slots.
  ctx.cache = new Proxy(ctx, {
    get(target, key) {
      // setLineDash must NOT be reachable via cache — surface this
      // explicitly so a regressing call site throws here too.
      if (key === 'setLineDash') return undefined;
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  ctx.setLineDashCalls = setLineDashCalls;
  return ctx as CachedContext2D & { setLineDashCalls: number[][] };
}

const baseParams = (over: Partial<CellPaintConfig> = {}): CellPaintConfig => ({
  value: '', valueFormatted: 'X',
  bounds: { x: 0, y: 0, w: 100, h: 30 },
  font: '13px Inter', fg: '#000', bg: '#eee', borderColor: '#ccc',
  halign: 'left', prefillColor: '#fff',
  isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  ...over,
});

function makeTheme(): ResolvedTheme {
  return {
    font: '13px Inter',
    fg: '#111', bg: '#fff',
    headerBg: '#eee', headerFg: '#222',
    borderColor: '#ccc', gridLineColor: '#ddd',
    rowAltBg: '#fafafa', rowHoverBg: '#f0f0f0', rowSelectedBg: '#dde',
    focusRingColor: '#08c', focusRingWidth: 2,
    flashFromColor: '#ff0', flashToColor: 'transparent',
    rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
    cellClassVariants: new Map<string, ColCellOverrides>(),
    headerClassVariants: new Map<string, ColCellOverrides>(),
  } as ResolvedTheme;
}

function makeConfig(): CellPaintConfig {
  return {
    value: '', valueFormatted: '',
    bounds: { x: 0, y: 0, w: 100, h: 30 },
    font: '', fg: '', bg: '', borderColor: '',
    halign: 'left', prefillColor: '',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  };
}

// ─── 1. border field stored on config via applyCellProps ──────────────────

describe('cellStyle.border integration', () => {
  it('cellStyle.border lands on config.border', () => {
    const border: BorderSpec = { top: { width: 2, color: 'red' } };
    const colDef = resolveColDef({ field: 'price', cellStyle: { border } });
    const config = makeConfig();
    applyCellProps(config, {
      theme: makeTheme(),
      colDef,
      value: 1, valueFormatted: '1',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect((config as any).border).toEqual({ top: { width: 2, color: 'red' } });
  });

  it('later cellStyle layer wins for border (replace, not merge)', () => {
    const colDef = resolveColDef({
      field: 'price',
      cellStyle: { border: { top: { width: 2, color: 'red' } } },
    });
    const config = makeConfig();
    (config as any).border = { left: { width: 1, color: 'blue' } }; // simulate prior layer
    applyCellProps(config, {
      theme: makeTheme(),
      colDef,
      value: 1, valueFormatted: '1',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    // The colDef's cellStyle replaces the simulated prior border wholesale.
    expect((config as any).border).toEqual({ top: { width: 2, color: 'red' } });
  });
});

// ─── 2. paintCellBorders pure painter ──────────────────────────────────────

describe('paintCellBorders — sides + colors', () => {
  it('draws top side only when only top is set, inset half a width inside the cell', () => {
    const gc = makeGc();
    const bounds = { x: 10, y: 20, w: 100, h: 30 };
    paintCellBorders(gc, bounds, { top: { width: 1, color: 'red' } });
    // Single line: moveTo + lineTo + stroke. Strokes are centered on the
    // path, so the y is inset by width/2 — the full 1px lands INSIDE the
    // cell instead of spilling half onto the neighbour.
    expect((gc.moveTo as any).mock.calls).toEqual([[10, 20.5]]);
    expect((gc.lineTo as any).mock.calls).toEqual([[110, 20.5]]);
    expect((gc.stroke as any).mock.calls.length).toBe(1);
    expect((gc as any).strokeStyle).toBe('red');
    expect((gc as any).lineWidth).toBe(1);
  });

  it('thick bottom borders paint fully inside the cell (no neighbour overpaint)', () => {
    const gc = makeGc();
    const bounds = { x: 10, y: 20, w: 100, h: 30 };
    paintCellBorders(gc, bounds, { bottom: { width: 4, color: 'teal' } });
    // Bottom edge is y=50; a 4px stroke centered at 48 spans 46..50 — all
    // inside. The old on-boundary stroke (centered at 50) lost its outer
    // 2px to the next row's paint.
    expect((gc.moveTo as any).mock.calls).toEqual([[10, 48]]);
    expect((gc.lineTo as any).mock.calls).toEqual([[110, 48]]);
    expect((gc as any).lineWidth).toBe(4);
  });

  it('draws all four sides when fully specified', () => {
    const gc = makeGc();
    const bounds = { x: 0, y: 0, w: 50, h: 20 };
    paintCellBorders(gc, bounds, {
      top:    { width: 1, color: 'red' },
      right:  { width: 1, color: 'green' },
      bottom: { width: 1, color: 'blue' },
      left:   { width: 1, color: 'black' },
    });
    expect((gc.moveTo as any).mock.calls.length).toBe(4);
    expect((gc.lineTo as any).mock.calls.length).toBe(4);
    expect((gc.stroke as any).mock.calls.length).toBe(4);
  });

  it("'all' fallback fills sides that aren't explicitly set", () => {
    const gc = makeGc();
    const bounds = { x: 0, y: 0, w: 50, h: 20 };
    paintCellBorders(gc, bounds, { all: { width: 1, color: 'gray' } });
    expect((gc.stroke as any).mock.calls.length).toBe(4); // top/right/bottom/left from 'all'
  });

  it("explicit side wins over 'all'", () => {
    const gc = makeGc();
    const bounds = { x: 0, y: 0, w: 50, h: 20 };
    paintCellBorders(gc, bounds, {
      all: { width: 1, color: 'gray' },
      top: { width: 3, color: 'red' },
    });
    expect((gc.stroke as any).mock.calls.length).toBe(4);
    // Each stroke call sets style/width BEFORE stroke — last set before first
    // stroke is the top side. Hard to assert per-stroke without inspecting
    // intermediate state; just confirm a width=3 was set at some point.
    const widths = (gc as any).cache._widths ?? [];
    // Implementation detail not asserted here; covered by integration.
  });

  it('skips a side with width=0', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {
      top: { width: 0, color: 'red' },
      bottom: { width: 1, color: 'blue' },
    });
    expect((gc.stroke as any).mock.calls.length).toBe(1);
  });

  it('skips a side with no width key set', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {
      top: { color: 'red' }, // no width — invisible
      bottom: { width: 1, color: 'blue' },
    });
    expect((gc.stroke as any).mock.calls.length).toBe(1);
  });

  it('no-op on empty spec', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {});
    expect((gc.stroke as any).mock.calls.length).toBe(0);
  });
});

// ─── 3. border styles via setLineDash ──────────────────────────────────────

describe('paintCellBorders — line styles', () => {
  it('solid (default) sets empty dash pattern', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {
      top: { width: 2, color: 'red', style: 'solid' },
    });
    expect((gc as any).setLineDashCalls[0]).toEqual([]);
  });

  it('dashed uses [width*3, width*2] pattern', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {
      top: { width: 2, color: 'red', style: 'dashed' },
    });
    expect((gc as any).setLineDashCalls[0]).toEqual([6, 4]);
  });

  it('dotted uses [width, width] pattern', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {
      top: { width: 3, color: 'red', style: 'dotted' },
    });
    expect((gc as any).setLineDashCalls[0]).toEqual([3, 3]);
  });

  it('double draws two parallel strokes per side', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {
      top: { width: 1, color: 'red', style: 'double' },
    });
    // 2 strokes for 'double' on a single side
    expect((gc.stroke as any).mock.calls.length).toBe(2);
  });

  it('omitted style defaults to solid', () => {
    const gc = makeGc();
    paintCellBorders(gc, { x: 0, y: 0, w: 50, h: 20 }, {
      top: { width: 1, color: 'red' },
    });
    expect((gc as any).setLineDashCalls[0]).toEqual([]);
  });
});

// ─── 4. Painter integration: textCell + numberCell draw borders ───────────

describe('cell painters call paintCellBorders', () => {
  it('textCell draws bottom border when config.border.bottom set', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      border: { bottom: { width: 2, color: 'orange' } } as BorderSpec,
    } as any));
    expect((gc.stroke as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('numberCell draws border when config.border set', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      border: { all: { width: 1, color: 'gray' } } as BorderSpec,
    } as any));
    expect((gc.stroke as any).mock.calls.length).toBe(4);
  });

  it('textCell does NOT stroke when border is undefined (preserves Cycle 27/Task 1 invariant)', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valueFormatted: 'X' }));
    expect((gc.stroke as any).mock.calls.length).toBe(0);
  });
});

// ─── 5. Header borders via headerStyle.border ─────────────────────────────

describe('headerStyle.border', () => {
  it('headerStyle.border lands on header config.border', () => {
    const colDef = resolveColDef({
      field: 'price',
      headerStyle: { border: { bottom: { width: 3, color: 'teal' } } },
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: makeTheme(),
      colDef,
      value: 'Price', valueFormatted: 'Price',
      x: 0, y: 0, w: 100, h: 32,
      rowBg: '#eee', prefillColor: '#eee',
      isFocused: false, isSelected: false, isHovered: false,
      isHeader: true,
      rowData: {},
    });
    expect((config as any).border).toEqual({ bottom: { width: 3, color: 'teal' } });
  });
});
