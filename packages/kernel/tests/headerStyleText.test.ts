// Header caption styling — halign + textDecoration on leaf headers, and the
// fold's header-alignment default. Companion to the CGridExt formatting
// toolbar's Header target: all font styles must paint on column headers.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { headerCell } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

function makeGc(): CachedContext2D & { calls: { fillText: unknown[][]; moveTo: unknown[][]; lineTo: unknown[][] } } {
  const calls = { fillText: [] as unknown[][], moveTo: [] as unknown[][], lineTo: [] as unknown[][] };
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(),
    fillText: vi.fn((...a: unknown[]) => calls.fillText.push(a)),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn((...a: unknown[]) => calls.moveTo.push(a)),
    lineTo: vi.fn((...a: unknown[]) => calls.lineTo.push(a)),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    translate: vi.fn(), scale: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    letterSpacing: '0px', globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(t, k) { return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
  ctx.clearFill = vi.fn();
  ctx.calls = calls;
  return ctx;
}

const header = (over: Partial<CellPaintConfig> = {}): CellPaintConfig => ({
  value: '', valueFormatted: 'DV01',
  bounds: { x: 100, y: 0, w: 200, h: 32 },
  font: '13px Inter', fg: '#fff', bg: '#111', borderColor: '#333',
  halign: 'left', prefillColor: '#000',
  isFocused: false, isSelected: false, isHovered: false, isHeader: true,
  ...over,
});

describe('headerCell — halign', () => {
  it('right-aligns the caption when headerStyle sets halign right (reserving the sort slot)', () => {
    const gc = makeGc();
    headerCell.paint(gc, header({ halign: 'right', sortDirection: 'asc' }));
    // caption drawn right-anchored at bounds right minus sort reserve (8+14+2)
    const [text, x] = gc.calls.fillText[0]!;
    expect(text).toBe('DV01');
    expect(x).toBe(100 + 200 - (8 + 14 + 2));
    expect((gc as any).textAlign).toBe('right');
  });

  it('centers the caption when halign is center', () => {
    const gc = makeGc();
    headerCell.paint(gc, header({ halign: 'center' }));
    const [, x] = gc.calls.fillText[0]!;
    expect(x).toBe(100 + 200 / 2);
    expect((gc as any).textAlign).toBe('center');
  });

  it('keeps group-caret headers left-anchored regardless of halign', () => {
    const gc = makeGc();
    headerCell.paint(gc, header({ halign: 'right', pivotGroupExpand: 'open' }));
    const [, x] = gc.calls.fillText[0]!;
    expect(x).toBe(100 + 8); // textX = bounds.x + HEADER_PADDING
  });
});

describe('headerCell — textDecoration', () => {
  it('draws an underline under the caption', () => {
    const gc = makeGc();
    headerCell.paint(gc, header({ textDecoration: 'underline' }));
    expect(gc.calls.moveTo.length).toBe(1);
    const [x0, y] = gc.calls.moveTo[0]! as number[];
    const [x1] = gc.calls.lineTo[0]! as number[];
    expect(x0).toBe(108);        // textX (left-anchored)
    expect(x1).toBe(108 + 40);   // + measured width
    expect(y).toBe(16 + 2);      // cy + 2 (underline)
  });

  it('draws a line-through above the baseline midpoint', () => {
    const gc = makeGc();
    headerCell.paint(gc, header({ textDecoration: 'line-through' }));
    const [, y] = gc.calls.moveTo[0]! as number[];
    expect(y).toBe(16 - 3);
  });

  it('draws nothing for none/undefined', () => {
    const gc = makeGc();
    headerCell.paint(gc, header({}));
    expect(gc.calls.moveTo.length).toBe(0);
  });
});

// ─── Fold: header alignment default + headerStyle.halign override ─────────
import { applyCellProps, resolveColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { ColCellOverrides } from '../src/types';

function makeTheme(): ResolvedTheme {
  return {
    font: '13px Inter', fg: '#111', bg: '#fff',
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

function foldHeader(colDefIn: Record<string, unknown>): CellPaintConfig {
  const colDef = resolveColDef(colDefIn as any);
  const config: CellPaintConfig = {
    value: '', valueFormatted: '',
    bounds: { x: 0, y: 0, w: 100, h: 30 },
    font: '', fg: '', bg: '', borderColor: '',
    halign: 'left', prefillColor: '',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  };
  applyCellProps(config, {
    theme: makeTheme(), colDef,
    value: 'DV01', valueFormatted: 'DV01',
    x: 0, y: 0, w: 100, h: 30,
    rowBg: '#fff', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: true,
    rowData: {},
  } as any);
  return config;
}

describe('applyCellProps — header alignment', () => {
  it('numeric columns default their HEADER caption to left (cells stay right)', () => {
    const cfg = foldHeader({ field: 'dv01', cellDataType: 'number' });
    expect(cfg.halign).toBe('left'); // was 'right' via the cellDataType default
  });

  it('an explicit headerStyle.halign wins', () => {
    const cfg = foldHeader({
      field: 'dv01', cellDataType: 'number',
      headerStyle: { halign: 'center' },
    });
    expect(cfg.halign).toBe('center');
  });

  it('headerStyle font styles reach the header target (weight/style/decoration)', () => {
    const cfg = foldHeader({
      field: 'dv01', cellDataType: 'number',
      headerStyle: { fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'line-through', fontSize: 15 },
    });
    expect(cfg.font).toContain('bold');
    expect(cfg.font).toContain('italic');
    expect(cfg.font).toContain('15px');
    expect(cfg.textDecoration).toBe('line-through');
  });
});

describe('applyCellProps — header follows explicit cell alignment', () => {
  it('an explicit cellStyle.halign carries onto the header caption', () => {
    const cfg = foldHeader({
      field: 'dv01', cellDataType: 'number',
      cellStyle: { halign: 'center' },
    });
    expect(cfg.halign).toBe('center');
  });

  it('headerStyle.halign overrides the cell-derived alignment (split header from cells)', () => {
    const cfg = foldHeader({
      field: 'dv01', cellDataType: 'number',
      cellStyle: { halign: 'center' },
      headerStyle: { halign: 'right' },
    });
    expect(cfg.halign).toBe('right');
  });
});
