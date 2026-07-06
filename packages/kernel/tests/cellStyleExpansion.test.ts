// Cycle 27 / Task 1 — Cell-style expansion tests.
// Drives: valign, font breakouts, textTransform, letterSpacing, lineHeight,
// padding, headerStyle, groupHeaderStyle.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { textCell, numberCell } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

function makeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    translate: vi.fn(), scale: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    letterSpacing: '0px',
    globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const baseParams = (over: Partial<CellPaintConfig> = {}): CellPaintConfig => ({
  value: '', valueFormatted: 'hi',
  bounds: { x: 0, y: 0, w: 100, h: 30 },
  font: '13px Inter', fg: '#000', bg: '#eee', borderColor: '#ccc',
  halign: 'left', prefillColor: '#fff',
  isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  ...over,
});

// ─── font breakouts ────────────────────────────────────────────────────────

import { composeFont, resolveColDef, applyCellProps } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { ColCellOverrides } from '../src/types';

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

function runApplyCellProps(opts: {
  cellStyle?: ColCellOverrides | ((p: any) => ColCellOverrides | null);
  value?: unknown;
  valueFormatted?: string;
}): CellPaintConfig {
  const colDef = resolveColDef({ field: 'price', cellStyle: opts.cellStyle as any });
  const config = makeConfig();
  applyCellProps(config, {
    theme: makeTheme(),
    colDef,
    value: opts.value ?? 100,
    valueFormatted: opts.valueFormatted ?? '100',
    x: 0, y: 0, w: 100, h: 30,
    rowBg: '#fff', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    rowData: {},
  });
  return config;
}

describe('composeFont', () => {
  const fallback = '13px Inter';

  it('returns fallback when no breakouts set', () => {
    expect(composeFont({}, fallback)).toBe(fallback);
  });

  it('explicit font shorthand wins over breakouts (predictable precedence)', () => {
    expect(composeFont(
      { font: '600 16px Helvetica', fontSize: 99, fontWeight: 'bold' },
      fallback,
    )).toBe('600 16px Helvetica');
  });

  it('fontSize override substitutes into fallback family', () => {
    expect(composeFont({ fontSize: 20 }, fallback)).toBe('20px Inter');
  });

  it('fontFamily override substitutes into fallback size', () => {
    expect(composeFont({ fontFamily: 'Helvetica' }, fallback)).toBe('13px Helvetica');
  });

  it('fontWeight numeric prepends to shorthand', () => {
    expect(composeFont({ fontWeight: 700 }, fallback)).toBe('700 13px Inter');
  });

  it('fontWeight keyword prepends to shorthand', () => {
    expect(composeFont({ fontWeight: 'bold' }, fallback)).toBe('bold 13px Inter');
  });

  it('fontStyle italic prepends to shorthand', () => {
    expect(composeFont({ fontStyle: 'italic' }, fallback)).toBe('italic 13px Inter');
  });

  it('all four breakouts compose into a complete shorthand', () => {
    expect(composeFont(
      { fontStyle: 'italic', fontWeight: 700, fontSize: 18, fontFamily: 'Helvetica' },
      fallback,
    )).toBe('italic 700 18px Helvetica');
  });

  it('preserves a pre-weighted fallback when only fontSize is set', () => {
    expect(composeFont({ fontSize: 20 }, '600 13px Inter')).toBe('600 20px Inter');
  });
});

// ─── breakouts integrate via applyCellProps ────────────────────────────────

describe('cellStyle breakouts integrate through applyCellProps', () => {
  it('cellStyle.fontSize lands on config.font', () => {
    const config = runApplyCellProps({ cellStyle: { fontSize: 20 } });
    expect(config.font).toBe('20px Inter');
  });

  it('cellStyle.fontWeight prepends to config.font', () => {
    const config = runApplyCellProps({ cellStyle: { fontWeight: 700 } });
    expect(config.font).toBe('700 13px Inter');
  });

  it('cellStyle.fontStyle italic prepends to config.font', () => {
    const config = runApplyCellProps({ cellStyle: { fontStyle: 'italic' } });
    expect(config.font).toBe('italic 13px Inter');
  });

  it('multiple cellStyle breakouts compose', () => {
    const config = runApplyCellProps({
      cellStyle: { fontStyle: 'italic', fontWeight: 700, fontSize: 18, fontFamily: 'Helvetica' },
    });
    expect(config.font).toBe('italic 700 18px Helvetica');
  });

  it('cellStyle.valign lands on config.valign', () => {
    const config = runApplyCellProps({ cellStyle: { valign: 'top' } });
    expect(config.valign).toBe('top');
  });

  it('explicit cellStyle.font wins over its breakouts', () => {
    const config = runApplyCellProps({
      cellStyle: { font: '900 24px Helvetica', fontSize: 99, fontWeight: 100 },
    });
    expect(config.font).toBe('900 24px Helvetica');
  });

  it('function-form cellStyle breakouts also apply', () => {
    const config = runApplyCellProps({
      cellStyle: (() => ({ fontSize: 22, fontWeight: 'bold' })) as any,
    });
    expect(config.font).toBe('bold 22px Inter');
  });
});

// ─── textTransform ─────────────────────────────────────────────────────────

describe('textTransform', () => {
  it("'uppercase' uppercases valueFormatted on render", () => {
    const config = runApplyCellProps({
      cellStyle: { textTransform: 'uppercase' as any } as any,
      valueFormatted: 'hello world',
    });
    expect(config.valueFormatted).toBe('HELLO WORLD');
  });

  it("'lowercase' lowercases valueFormatted", () => {
    const config = runApplyCellProps({
      cellStyle: { textTransform: 'lowercase' as any } as any,
      valueFormatted: 'HELLO World',
    });
    expect(config.valueFormatted).toBe('hello world');
  });

  it("'capitalize' uppercases the first letter of each word", () => {
    const config = runApplyCellProps({
      cellStyle: { textTransform: 'capitalize' as any } as any,
      valueFormatted: 'hello world',
    });
    expect(config.valueFormatted).toBe('Hello World');
  });

  it("'none' leaves text unchanged", () => {
    const config = runApplyCellProps({
      cellStyle: { textTransform: 'none' as any } as any,
      valueFormatted: 'Hello World',
    });
    expect(config.valueFormatted).toBe('Hello World');
  });

  it('undefined textTransform leaves text unchanged (existing behavior)', () => {
    const config = runApplyCellProps({
      cellStyle: {} as any,
      valueFormatted: 'Hello World',
    });
    expect(config.valueFormatted).toBe('Hello World');
  });
});

// ─── letterSpacing ─────────────────────────────────────────────────────────

describe('letterSpacing', () => {
  it('cellStyle.letterSpacing lands on config.letterSpacing', () => {
    const config = runApplyCellProps({
      cellStyle: { letterSpacing: 2 as any } as any,
    });
    expect((config as any).letterSpacing).toBe(2);
  });

  it('textCell applies letterSpacing to the canvas context', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valueFormatted: 'X', letterSpacing: 3 } as any));
    expect((gc as any).letterSpacing).toBe('3px');
  });

  it('textCell resets letterSpacing to 0 when not set', () => {
    const gc = makeGc();
    (gc as any).letterSpacing = '99px'; // dirty starting state
    textCell.paint(gc, baseParams({ valueFormatted: 'X' }));
    expect((gc as any).letterSpacing).toBe('0px');
  });
});

// ─── lineHeight (wrapText) ─────────────────────────────────────────────────

import { wrapTextCell } from '../src/renderer/cellRenderers/wrapText';

describe('lineHeight', () => {
  it('cellStyle.lineHeight lands on config.lineHeight', () => {
    const config = runApplyCellProps({
      cellStyle: { lineHeight: 2 as any } as any,
    });
    expect((config as any).lineHeight).toBe(2);
  });

  it('wrapText painter uses default 1.2 line-height when unset', () => {
    const gc = makeGc();
    // Need multiple lines: pass a long string that will wrap.
    // measureText is mocked to return width: 50 for everything in makeGc above —
    // override here so each word measures as 50 px and the bound forces wrap.
    (gc as any).measureText = vi.fn((s: string) => ({ width: s.length * 10 }));
    wrapTextCell.paint(gc, baseParams({
      valueFormatted: 'one two three four five six seven',
      bounds: { x: 0, y: 0, w: 60, h: 200 },
      font: '13px Inter',
    }));
    const calls = (gc.fillText as any).mock.calls;
    if (calls.length < 2) throw new Error('expected wrap to produce >= 2 lines');
    // Default 1.2 multiplier with 13px font → lineHeight = round(13 * 1.2) = 16
    const dy = calls[1][2] - calls[0][2];
    expect(dy).toBe(16);
  });

  it('wrapText painter uses cellStyle lineHeight=2 multiplier', () => {
    const gc = makeGc();
    (gc as any).measureText = vi.fn((s: string) => ({ width: s.length * 10 }));
    wrapTextCell.paint(gc, baseParams({
      valueFormatted: 'one two three four five six seven',
      bounds: { x: 0, y: 0, w: 60, h: 400 },
      font: '13px Inter',
      lineHeight: 2,
    } as any));
    const calls = (gc.fillText as any).mock.calls;
    if (calls.length < 2) throw new Error('expected wrap to produce >= 2 lines');
    // 2.0 × 13 = 26 (rounded)
    const dy = calls[1][2] - calls[0][2];
    expect(dy).toBe(26);
  });
});

// ─── padding ───────────────────────────────────────────────────────────────

describe('padding', () => {
  it('uniform padding number normalizes to all four sides', () => {
    const config = runApplyCellProps({
      cellStyle: { padding: 10 as any } as any,
    });
    expect((config as any).padding).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });

  it('per-side padding object passes through unchanged', () => {
    const config = runApplyCellProps({
      cellStyle: { padding: { left: 20, right: 4 } as any } as any,
    });
    expect((config as any).padding).toEqual({ left: 20, right: 4 });
  });

  it('textCell honors padding.left when halign=left (text shifts right)', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      valueFormatted: 'X',
      padding: { left: 30 } as any,
    } as any));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(30);
  });

  it('textCell honors padding.right when halign=right', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      valueFormatted: 'X',
      bounds: { x: 0, y: 0, w: 100, h: 30 },
      halign: 'right',
      padding: { right: 25 } as any,
    } as any));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(75); // 100 - 25
  });

  it('numberCell honors padding.right (default halign for numbers)', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      valueFormatted: '99',
      bounds: { x: 0, y: 0, w: 100, h: 30 },
      halign: 'right',
      padding: { right: 25 } as any,
    } as any));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(75);
  });

  it('undefined padding falls back to the default 6px (existing behavior)', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valueFormatted: 'X' }));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(6);
  });
});

// ─── headerStyle on CColDef ────────────────────────────────────────────────

describe('headerStyle (CColDef)', () => {
  function runHeader(opts: {
    headerStyle?: ColCellOverrides | ((p: any) => ColCellOverrides | null);
  }): CellPaintConfig {
    const colDef = resolveColDef({ field: 'price', headerStyle: opts.headerStyle as any });
    const config = makeConfig();
    applyCellProps(config, {
      theme: makeTheme(),
      colDef,
      value: 'Price',
      valueFormatted: 'Price',
      x: 0, y: 0, w: 100, h: 32,
      rowBg: '#eee', prefillColor: '#eee',
      isFocused: false, isSelected: false, isHovered: false,
      isHeader: true,
      rowData: {},
    });
    return config;
  }

  it('static headerStyle.bg lands on header config', () => {
    const config = runHeader({ headerStyle: { bg: '#abc123' } });
    expect(config.bg).toBe('#abc123');
  });

  it('static headerStyle.fontWeight composes into header config.font', () => {
    const config = runHeader({ headerStyle: { fontWeight: 700 } });
    expect(config.font).toBe('700 13px Inter');
  });

  it('function-form headerStyle is invoked', () => {
    const config = runHeader({
      headerStyle: ((p: any) => ({ bg: '#deadbe', halign: 'center' })) as any,
    });
    expect(config.bg).toBe('#deadbe');
    expect(config.halign).toBe('center');
  });

  it('headerStyle does NOT leak into data cells', () => {
    const colDef = resolveColDef({
      field: 'price',
      headerStyle: { bg: '#000000' } as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: makeTheme(),
      colDef,
      value: 100,
      valueFormatted: '100',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false,
      isHeader: false, // data cell, not header
      rowData: {},
    });
    expect(config.bg).not.toBe('#000000');
  });
});

// ─── groupHeaderStyle on CColGroupDef ──────────────────────────────────────

describe('groupHeaderStyle (CColGroupDef)', () => {
  it('group headerStyle (via groupHeaderClassNames-style path) applies to group header cells', () => {
    // Group headers paint via applyCellProps with isHeader: true and a
    // `groupHeaderStyle` patch resolved by the column-tree builder. For
    // this unit test we simulate by passing groupHeaderStyle on the
    // ApplyCellPropsInput directly.
    const colDef = resolveColDef({ field: 'price' });
    const config = makeConfig();
    applyCellProps(config, {
      theme: makeTheme(),
      colDef,
      value: 'Pricing',
      valueFormatted: 'Pricing',
      x: 0, y: 0, w: 200, h: 32,
      rowBg: '#eee', prefillColor: '#eee',
      isFocused: false, isSelected: false, isHovered: false,
      isHeader: true,
      groupHeaderStyle: { bg: '#cafe00', fontWeight: 900 } as any,
      rowData: {},
    } as any);
    expect(config.bg).toBe('#cafe00');
    expect(config.font).toBe('900 13px Inter');
  });
});

// ─── Workstream C — token-referenceable cellStyle/headerStyle values ───────
// A `cellStyle`/`headerStyle` object value of the form `var(--cg-…)` (or
// `var(--cg-…, fallback)`) is resolved through `theme.resolveVarRef` at
// `applyCellProps` time. Literal values (hex/rgb) pass straight through
// unchanged (regression). Scope: fg/bg + border side colors only.

describe('Workstream C — cellStyle token resolution (var(--cg-…))', () => {
  function themeWithResolver(tokens: Record<string, string>): ResolvedTheme {
    const resolveVarRef = (value: string): string => {
      const m = /^var\(\s*(--cg-[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(value.trim());
      if (!m) return value;
      const name = m[1]!;
      const fallback = m[2]?.trim();
      const resolved = tokens[name];
      if (resolved) return resolved;
      return fallback !== undefined ? fallback : value;
    };
    return { ...makeTheme(), resolveVarRef } as ResolvedTheme;
  }

  it('cellStyle.fg resolves a var(--cg-…) reference to the theme token value', () => {
    const colDef = resolveColDef({
      field: 'pnl',
      cellStyle: { fg: 'var(--cg-pos-color)' } as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: themeWithResolver({ '--cg-pos-color': '#16a34a' }),
      colDef,
      value: 100, valueFormatted: '100',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect(config.fg).toBe('#16a34a');
  });

  it('cellStyle.bg resolves a var(--cg-…, fallback) to the fallback when the token is undeclared', () => {
    const colDef = resolveColDef({
      field: 'pnl',
      cellStyle: { bg: 'var(--cg-missing-bg, #f0fdf4)' } as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: themeWithResolver({}),
      colDef,
      value: 100, valueFormatted: '100',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect(config.bg).toBe('#f0fdf4');
  });

  it('cellStyle.border side colors resolve var(--cg-…) refs; width/style pass through untouched', () => {
    const colDef = resolveColDef({
      field: 'pnl',
      cellStyle: {
        border: { left: { width: 2, style: 'solid', color: 'var(--cg-neg-color)' } },
      } as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: themeWithResolver({ '--cg-neg-color': '#dc2626' }),
      colDef,
      value: -50, valueFormatted: '-50',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect(config.border).toEqual({ left: { width: 2, style: 'solid', color: '#dc2626' } });
  });

  it('cellStyle content + decorator colors resolve var(--cg-…) refs', () => {
    const colDef = resolveColDef({
      field: 'pnl',
      cellStyle: {
        content: { kind: 'icon', icon: 'triangle-down', color: 'var(--cg-neg-color)' },
        decorators: [
          { position: 'tr', kind: 'emoji', value: '▼', color: 'var(--cg-neg-color)', bg: 'var(--cg-neg-color)' },
        ],
      } as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: themeWithResolver({ '--cg-neg-color': '#dc2626' }),
      colDef,
      value: -50, valueFormatted: '-50',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect((config.content as { color?: string }).color).toBe('#dc2626');
    expect((config.decorators as Array<{ color?: string; bg?: string }>)[0]!.color).toBe('#dc2626');
    expect((config.decorators as Array<{ color?: string; bg?: string }>)[0]!.bg).toBe('#dc2626');
  });

  it('a literal cellStyle color (#hex) is left unchanged (regression — no var() resolution attempted)', () => {
    const colDef = resolveColDef({
      field: 'pnl',
      cellStyle: { fg: '#e63946', bg: 'rgba(230,57,70,.08)' } as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: themeWithResolver({ '--cg-pos-color': '#16a34a' }),
      colDef,
      value: -50, valueFormatted: '-50',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect(config.fg).toBe('#e63946');
    expect(config.bg).toBe('rgba(230,57,70,.08)');
  });

  it('headerStyle.fg also resolves a var(--cg-…) reference', () => {
    const colDef = resolveColDef({
      field: 'price',
      headerStyle: { fg: 'var(--cg-header-accent)' } as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: themeWithResolver({ '--cg-header-accent': '#0d9488' }),
      colDef,
      value: 'Price', valueFormatted: 'Price',
      x: 0, y: 0, w: 100, h: 32,
      rowBg: '#eee', prefillColor: '#eee',
      isFocused: false, isSelected: false, isHovered: false,
      isHeader: true,
      rowData: {},
    });
    expect(config.fg).toBe('#0d9488');
  });

  it('function-form cellStyle return value also resolves var(--cg-…) refs', () => {
    const colDef = resolveColDef({
      field: 'pnl',
      cellStyle: (() => ({ fg: 'var(--cg-pos-color)' })) as any,
    });
    const config = makeConfig();
    applyCellProps(config, {
      theme: themeWithResolver({ '--cg-pos-color': '#16a34a' }),
      colDef,
      value: 100, valueFormatted: '100',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect(config.fg).toBe('#16a34a');
  });

  it('works with a ResolvedTheme that has no resolveVarRef (hand-built fixture) — no-op passthrough, no throw', () => {
    const colDef = resolveColDef({
      field: 'pnl',
      cellStyle: { fg: 'var(--cg-pos-color)' } as any,
    });
    const config = makeConfig();
    expect(() => applyCellProps(config, {
      theme: makeTheme(), // no resolveVarRef field at all
      colDef,
      value: 100, valueFormatted: '100',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    })).not.toThrow();
    // No resolver available — the raw var() text lands unresolved (documents
    // the fallback behavior for legacy hand-built theme fixtures).
    expect(config.fg).toBe('var(--cg-pos-color)');
  });
});

// ─── valign ────────────────────────────────────────────────────────────────

describe('valign', () => {
  it("valign='top' renders text near the top of the cell", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valign: 'top' }));
    const [, , y] = (gc.fillText as any).mock.calls[0]!;
    // Cell y=0, h=30. Top should be near 0, not the middle (15).
    expect(y).toBeLessThan(10);
    // Text baseline should be 'top' for top alignment.
    expect((gc as any).textBaseline).toBe('top');
  });

  it("valign='bottom' renders text near the bottom of the cell", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valign: 'bottom' }));
    const [, , y] = (gc.fillText as any).mock.calls[0]!;
    // Cell h=30. Bottom should be > 20.
    expect(y).toBeGreaterThan(20);
    expect((gc as any).textBaseline).toBe('alphabetic');
  });

  it("valign='middle' (default) keeps the existing centered behavior", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valign: 'middle' }));
    const [, , y] = (gc.fillText as any).mock.calls[0]!;
    // Cell h=30. Middle is y=15.
    expect(y).toBe(15);
    expect((gc as any).textBaseline).toBe('middle');
  });

  it('undefined valign defaults to middle (existing behavior preserved)', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({})); // no valign
    const [, , y] = (gc.fillText as any).mock.calls[0]!;
    expect(y).toBe(15);
    expect((gc as any).textBaseline).toBe('middle');
  });

  it('numberCell respects valign too', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({ valign: 'bottom', halign: 'right' }));
    const [, , y] = (gc.fillText as any).mock.calls[0]!;
    expect(y).toBeGreaterThan(20);
  });
});
