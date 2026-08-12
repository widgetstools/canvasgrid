// Cycle 27 / Task 3 — Cell content slots + corner/edge decorators.
//
// Drives:
//   - CellContent (text/icon/emoji/icon-text) on ColCellOverrides
//   - CellDecorator (dot/icon/emoji/text) at 6 positions (TL/TR/BL/BR/ML/MR)
//   - paintCellDecorators pure painter with optional bg badge
//   - Painter integration via textCell + numberCell
//   - User-extensible icon registry (registerIcon / registerIcons)

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { textCell, numberCell } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';
import {
  paintCellDecorators,
  computeDecoratorPosition,
} from '../src/renderer/painters/cellDecoratorsPainter';
import { resolveColDef, applyCellProps } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type {
  ColCellOverrides,
  CellContent,
  CellDecorator,
  DecoratorPosition,
} from '../src/types';
import {
  registerIcon, registerIcons, hasIcon, unregisterIconForTest,
} from '../src/renderer/icons';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

// ─── Shared helpers ────────────────────────────────────────────────────────

function makeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn(() => ({ width: 12 })),
    translate: vi.fn(), scale: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    letterSpacing: '0px',
    globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) {
      if (key === 'setLineDash') return undefined;
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
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

// ─── 1. CellContent slot dispatcher ────────────────────────────────────────

describe('cellStyle.content slot', () => {
  it('content lands on config.content via applyCellProps', () => {
    const content: CellContent = { kind: 'emoji', value: '✓' };
    const colDef = resolveColDef({ field: 'status', cellStyle: { content } });
    const config = makeConfig();
    applyCellProps(config, {
      theme: makeTheme(),
      colDef,
      value: true, valueFormatted: 'true',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    });
    expect((config as any).content).toEqual({ kind: 'emoji', value: '✓' });
  });

  it("content kind 'emoji' renders the emoji value, NOT the formatted text", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      valueFormatted: 'true',
      content: { kind: 'emoji', value: '✅' } as CellContent,
    } as any));
    const renderedTexts = (gc.fillText as any).mock.calls.map((c: any[]) => c[0]);
    expect(renderedTexts).toContain('✅');
    expect(renderedTexts).not.toContain('true');
  });

  it("content kind 'text' renders the provided value, NOT valueFormatted", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      valueFormatted: 'raw',
      content: { kind: 'text', value: 'override' } as CellContent,
    } as any));
    const renderedTexts = (gc.fillText as any).mock.calls.map((c: any[]) => c[0]);
    expect(renderedTexts).toContain('override');
    expect(renderedTexts).not.toContain('raw');
  });

  it("undefined content renders valueFormatted (default text path preserved)", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valueFormatted: 'normal text' }));
    const renderedTexts = (gc.fillText as any).mock.calls.map((c: any[]) => c[0]);
    expect(renderedTexts).toContain('normal text');
  });

  it("content kind 'icon' calls stroke (icon path) and skips text fill of valueFormatted", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      valueFormatted: 'value',
      content: { kind: 'icon', icon: 'chevron-up', color: '#0a0', size: 14 } as CellContent,
    } as any));
    // Icon path is stroked, not fillText'd. valueFormatted should NOT be rendered.
    expect((gc.stroke as any).mock.calls.length).toBeGreaterThan(0);
    const renderedTexts = (gc.fillText as any).mock.calls.map((c: any[]) => c[0]);
    expect(renderedTexts).not.toContain('value');
  });

  it("content kind 'icon-text' renders BOTH icon stroke AND text fill", () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      valueFormatted: 'ignored',
      content: { kind: 'icon-text', icon: 'chevron-up', text: '4.5', iconPosition: 'before' } as CellContent,
    } as any));
    expect((gc.stroke as any).mock.calls.length).toBeGreaterThan(0);
    const renderedTexts = (gc.fillText as any).mock.calls.map((c: any[]) => c[0]);
    expect(renderedTexts).toContain('4.5');
    expect(renderedTexts).not.toContain('ignored');
  });
});

// ─── 2. Decorator position computation (pure) ─────────────────────────────

describe('computeDecoratorPosition', () => {
  const bounds = { x: 100, y: 200, w: 80, h: 40 };
  const size = 10;
  const inset = 2;

  it('tl positions at top-left corner inset', () => {
    const p = computeDecoratorPosition(bounds, 'tl', size, inset);
    // Center of a size×size box, inset from edges by `inset`
    expect(p).toEqual({ x: 100 + 2 + 5, y: 200 + 2 + 5 });
  });

  it('tr positions at top-right corner inset', () => {
    const p = computeDecoratorPosition(bounds, 'tr', size, inset);
    expect(p).toEqual({ x: 100 + 80 - 2 - 5, y: 200 + 2 + 5 });
  });

  it('bl positions at bottom-left corner inset', () => {
    const p = computeDecoratorPosition(bounds, 'bl', size, inset);
    expect(p).toEqual({ x: 100 + 2 + 5, y: 200 + 40 - 2 - 5 });
  });

  it('br positions at bottom-right corner inset', () => {
    const p = computeDecoratorPosition(bounds, 'br', size, inset);
    expect(p).toEqual({ x: 100 + 80 - 2 - 5, y: 200 + 40 - 2 - 5 });
  });

  it('ml positions at middle-left (vertically centered)', () => {
    const p = computeDecoratorPosition(bounds, 'ml', size, inset);
    expect(p).toEqual({ x: 100 + 2 + 5, y: 200 + 20 });
  });

  it('mr positions at middle-right (vertically centered)', () => {
    const p = computeDecoratorPosition(bounds, 'mr', size, inset);
    expect(p).toEqual({ x: 100 + 80 - 2 - 5, y: 200 + 20 });
  });
});

// ─── 3. paintCellDecorators painter ────────────────────────────────────────

describe('paintCellDecorators', () => {
  it("'dot' kind paints a circle at the position", () => {
    const gc = makeGc();
    const decorators: CellDecorator[] = [
      { position: 'tr', kind: 'dot', color: '#f00', size: 6 },
    ];
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, decorators);
    expect((gc.arc as any).mock.calls.length).toBe(1);
    expect((gc.fill as any).mock.calls.length).toBeGreaterThan(0);
  });

  it("'icon' kind resolves catalog icons from the Lucide icon-set registry (not just the chrome set)", async () => {
    const { registerIconSet, _resetIconRegistry_forTests } = await import('../src/icons/registry');
    registerIconSet('lucide', { flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3' });
    try {
      const gc = makeGc();
      paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, [
        { position: 'tr', kind: 'icon', icon: 'flame', color: '#f80', size: 10 },
      ]);
      // Previously hasIcon('flame') was false (chrome set only) and the
      // decorator was SILENTLY dropped — the icon vanished at tl/tr/….
      expect((gc.stroke as any).mock.calls.length).toBeGreaterThan(0);
      expect((gc.translate as any).mock.calls.length).toBeGreaterThan(0);
    } finally {
      _resetIconRegistry_forTests();
    }
  });

  it("'emoji' kind fillText's the emoji at the position", () => {
    const gc = makeGc();
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, [
      { position: 'tl', kind: 'emoji', value: '⭐', size: 12 },
    ]);
    const calls = (gc.fillText as any).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('⭐');
  });

  it("'text' kind fillText's the text at the position", () => {
    const gc = makeGc();
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, [
      { position: 'br', kind: 'text', value: 'NEW', size: 10, color: '#fff' },
    ]);
    const calls = (gc.fillText as any).mock.calls;
    expect(calls[0][0]).toBe('NEW');
  });

  it("'icon' kind strokes an icon at the position", () => {
    const gc = makeGc();
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, [
      { position: 'ml', kind: 'icon', icon: 'chevron-up', color: '#000', size: 12 },
    ]);
    expect((gc.stroke as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('optional bg paints a circle behind a decorator (badge backdrop)', () => {
    const gc = makeGc();
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, [
      { position: 'tr', kind: 'dot', color: '#fff', size: 6, bg: '#000' },
    ]);
    // bg = 1 arc + 1 fill, dot = 1 arc + 1 fill. So at least 2 of each.
    expect((gc.arc as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((gc.fill as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('paints multiple decorators in array order', () => {
    const gc = makeGc();
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, [
      { position: 'tl', kind: 'dot', color: '#f00', size: 4 },
      { position: 'br', kind: 'dot', color: '#0f0', size: 4 },
    ]);
    expect((gc.arc as any).mock.calls.length).toBe(2);
  });

  it('no-op on empty array', () => {
    const gc = makeGc();
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, []);
    expect((gc.fill as any).mock.calls.length).toBe(0);
    expect((gc.arc as any).mock.calls.length).toBe(0);
    expect((gc.fillText as any).mock.calls.length).toBe(0);
  });
});

// ─── 4. Painter integration ────────────────────────────────────────────────

describe('textCell + numberCell call paintCellDecorators', () => {
  it('textCell paints decorators after content', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      valueFormatted: 'X',
      decorators: [{ position: 'tr', kind: 'dot', color: '#f00' }],
    } as any));
    expect((gc.arc as any).mock.calls.length).toBe(1);
  });

  it('numberCell paints decorators', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      valueFormatted: '42',
      decorators: [{ position: 'ml', kind: 'dot', color: '#00f' }],
    } as any));
    expect((gc.arc as any).mock.calls.length).toBe(1);
  });

  it('no decorators field → painters do not arc/fill anything decorator-related (default preserved)', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ valueFormatted: 'X' }));
    expect((gc.arc as any).mock.calls.length).toBe(0);
  });
});

// ─── 4b. Per-cell reset (regression: no leak across cells) ────────────────

describe('applyCellProps resets opt-in fields between cells', () => {
  it("content set by cell A does not leak into cell B (no override)", () => {
    const colA = resolveColDef({
      field: 'a',
      cellStyle: { content: { kind: 'emoji', value: '✓' } as CellContent },
    });
    const colB = resolveColDef({ field: 'b' }); // no overrides

    const config = makeConfig();
    const baseInput = {
      theme: makeTheme(),
      value: 0, valueFormatted: 'x',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    };
    applyCellProps(config, { ...baseInput, colDef: colA });
    expect((config as any).content).toEqual({ kind: 'emoji', value: '✓' });
    // SAME config object reused for cell B (mirrors the production paint
    // loop where one CellPaintConfig is recycled across cells).
    applyCellProps(config, { ...baseInput, colDef: colB });
    expect((config as any).content).toBeUndefined();
  });

  it("decorators set by cell A does not leak into cell B", () => {
    const colA = resolveColDef({
      field: 'a',
      cellStyle: { decorators: [{ position: 'tr', kind: 'dot', color: '#f00' }] },
    });
    const colB = resolveColDef({ field: 'b' });
    const config = makeConfig();
    const baseInput = {
      theme: makeTheme(), value: 0, valueFormatted: 'x',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    };
    applyCellProps(config, { ...baseInput, colDef: colA });
    expect((config as any).decorators).toBeDefined();
    applyCellProps(config, { ...baseInput, colDef: colB });
    expect((config as any).decorators).toBeUndefined();
  });

  it("valign / textTransform / letterSpacing / lineHeight / padding / border also reset", () => {
    const colA = resolveColDef({
      field: 'a',
      cellStyle: {
        valign: 'top',
        textTransform: 'uppercase',
        letterSpacing: 3,
        lineHeight: 2,
        padding: { left: 99 },
        border: { top: { width: 5, color: 'red' } },
      },
    });
    const colB = resolveColDef({ field: 'b' });
    const config = makeConfig();
    const baseInput = {
      theme: makeTheme(), value: 0, valueFormatted: 'x',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: '#fff', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowData: {},
    };
    applyCellProps(config, { ...baseInput, colDef: colA });
    applyCellProps(config, { ...baseInput, colDef: colB });
    expect((config as any).valign).toBeUndefined();
    expect((config as any).textTransform).toBeUndefined();
    expect((config as any).letterSpacing).toBeUndefined();
    expect((config as any).lineHeight).toBeUndefined();
    expect((config as any).padding).toBeUndefined();
    expect((config as any).border).toBeUndefined();
  });
});

// ─── 5. User-extensible icon registry ──────────────────────────────────────

describe('icon registry', () => {
  afterEach(() => {
    // Clean up between tests so test order doesn't bleed registrations.
    unregisterIconForTest('mystar');
    unregisterIconForTest('myhello');
  });

  it('registerIcon makes a custom icon available to drawIcon', () => {
    expect(hasIcon('mystar')).toBe(false);
    registerIcon('mystar', 'M12 2l3 7h7l-5 4 2 7-7-4-7 4 2-7-5-4h7z');
    expect(hasIcon('mystar')).toBe(true);
  });

  it('registerIcons batches multiple registrations', () => {
    registerIcons({
      mystar: 'M12 2l3 7h7l-5 4 2 7-7-4-7 4 2-7-5-4h7z',
      myhello: 'M3 3h18v18H3z',
    });
    expect(hasIcon('mystar')).toBe(true);
    expect(hasIcon('myhello')).toBe(true);
  });

  it('built-in icons remain registered (no clobber)', () => {
    expect(hasIcon('chevron-up')).toBe(true);
    expect(hasIcon('filter')).toBe(true);
  });

  it('decorator with custom icon strokes via the registry', () => {
    registerIcon('mystar', 'M12 2l3 7h7l-5 4 2 7-7-4-7 4 2-7-5-4h7z');
    const gc = makeGc();
    paintCellDecorators(gc, { x: 0, y: 0, w: 100, h: 30 }, [
      { position: 'br', kind: 'icon', icon: 'mystar', color: '#fa0', size: 12 },
    ]);
    expect((gc.stroke as any).mock.calls.length).toBeGreaterThan(0);
  });
});
