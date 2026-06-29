import { describe, it, expect, beforeEach } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

/**
 * Cycle 22 / Task 1 — CSS variable audit. Adds tokens for inputs,
 * tooltips, popups/menus, the optional inter-column rule, and a
 * filled-checkbox accent. Each new token has a JS-readable counterpart
 * on `ResolvedTheme` so painters and overlays can consume them
 * without re-reading the DOM per cell.
 */

function makeContainer(tokens: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('div');
  const lines = Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join(' ');
  el.style.cssText = lines;
  document.body.appendChild(el);
  return el;
}

describe('Cycle 22 / Task 1 — input tokens', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads --cg-input-bg / -fg / -border / -focus-border / -disabled-bg', () => {
    const c = makeContainer({
      '--cg-input-bg': '#ffffff',
      '--cg-input-fg': '#111827',
      '--cg-input-border': '#d1d5db',
      '--cg-input-focus-border': '#2563eb',
      '--cg-input-disabled-bg': '#f3f4f6',
    });
    const r = new CssReader(c).read();
    expect(r.inputBg).toBe('#ffffff');
    expect(r.inputFg).toBe('#111827');
    expect(r.inputBorder).toBe('#d1d5db');
    expect(r.inputFocusBorder).toBe('#2563eb');
    expect(r.inputDisabledBg).toBe('#f3f4f6');
  });

  it('falls back to body fg/bg + border when input tokens are undeclared', () => {
    const c = makeContainer({
      '--cg-fg-color': '#1a1f24',
      '--cg-bg-color': '#ffffff',
      '--cg-border-color': '#d5dbe0',
      '--cg-focus-ring-color': '#3b82f6',
    });
    const r = new CssReader(c).read();
    expect(r.inputBg).toBe('#ffffff');
    expect(r.inputFg).toBe('#1a1f24');
    expect(r.inputBorder).toBe('#d5dbe0');
    expect(r.inputFocusBorder).toBe('#3b82f6');
  });
});

describe('Cycle 22 / Task 1 — tooltip tokens', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads --cg-tooltip-bg / -fg / -border', () => {
    const c = makeContainer({
      '--cg-tooltip-bg': 'rgba(15,23,42,0.95)',
      '--cg-tooltip-fg': '#ffffff',
      '--cg-tooltip-border': 'rgba(255,255,255,0.1)',
    });
    const r = new CssReader(c).read();
    expect(r.tooltipBg).toBe('rgba(15,23,42,0.95)');
    expect(r.tooltipFg).toBe('#ffffff');
    expect(r.tooltipBorder).toBe('rgba(255,255,255,0.1)');
  });
});

describe('Cycle 22 / Task 1 — checkbox accent tokens', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads --cg-checkbox-checked-bg / -checked-fg', () => {
    const c = makeContainer({
      '--cg-checkbox-checked-bg': '#2563eb',
      '--cg-checkbox-checked-fg': '#ffffff',
    });
    const r = new CssReader(c).read();
    expect(r.checkboxCheckedBg).toBe('#2563eb');
    expect(r.checkboxCheckedFg).toBe('#ffffff');
  });

  it('defaults checkboxCheckedBg to "transparent" so the existing outlined-only checkbox stays unchanged', () => {
    const c = makeContainer({});
    const r = new CssReader(c).read();
    expect(r.checkboxCheckedBg).toBe('transparent');
  });
});

describe('Cycle 22 / Task 1 — checkbox painter accent wiring', () => {
  it('paints an accent fill behind the check when checkboxCheckedBg is set + value is true', async () => {
    const { checkboxCell } = await import('../src/renderer/cellRenderers/registry');
    const { vi } = await import('vitest');
    const ctx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
      globalAlpha: 1, lineWidth: 1, measureText: () => ({ width: 0 }),
    };
    ctx.cache = new Proxy(ctx, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    ctx.clearFill = vi.fn();
    checkboxCell.paint(ctx, {
      value: true, valueFormatted: '',
      bounds: { x: 0, y: 0, w: 50, h: 30 },
      font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc',
      halign: 'left', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      checkboxCheckedBg: '#2563eb',
      checkboxCheckedFg: '#ffffff',
    } as any);
    // Accent path: fillRect (for the box fill) + stroke (for the checkmark).
    expect((ctx.fillRect as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    expect((ctx.stroke as any)).toHaveBeenCalled();
    // The checkmark stroke should use the accent fg, not the body fg.
    expect(ctx.strokeStyle).toBe('#ffffff');
  });

  it('stays outlined-only when checkboxCheckedBg is transparent (default)', async () => {
    const { checkboxCell } = await import('../src/renderer/cellRenderers/registry');
    const { vi } = await import('vitest');
    const ctx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
      globalAlpha: 1, lineWidth: 1, measureText: () => ({ width: 0 }),
    };
    ctx.cache = new Proxy(ctx, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    ctx.clearFill = vi.fn();
    checkboxCell.paint(ctx, {
      value: true, valueFormatted: '',
      bounds: { x: 0, y: 0, w: 50, h: 30 },
      font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc',
      halign: 'left', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      checkboxCheckedBg: 'transparent',
    } as any);
    // Outlined-only: strokeRect for the outline + stroke for the check.
    // The fillRect for accent must NOT fire.
    expect((ctx.strokeRect as any)).toHaveBeenCalled();
    // No accent fillRect call — the background-fill path is gated on a
    // non-transparent checkboxCheckedBg.
    expect((ctx.fillRect as any)).not.toHaveBeenCalled();
  });
});

describe('Cycle 22 / Task 1 — inter-column rule + popup/menu tokens', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads --cg-cell-horizontal-border-color and defaults to "transparent"', () => {
    const c = makeContainer({});
    const r = new CssReader(c).read();
    expect(r.cellHorizontalBorderColor).toBe('transparent');

    const c2 = makeContainer({ '--cg-cell-horizontal-border-color': '#e5e7eb' });
    const r2 = new CssReader(c2).read();
    expect(r2.cellHorizontalBorderColor).toBe('#e5e7eb');
  });

  it('reads --cg-popup-bg / -popup-border / -menu-hover-bg', () => {
    const c = makeContainer({
      '--cg-popup-bg': '#ffffff',
      '--cg-popup-border': '#d1d5db',
      '--cg-menu-hover-bg': '#f3f4f6',
    });
    const r = new CssReader(c).read();
    expect(r.popupBg).toBe('#ffffff');
    expect(r.popupBorder).toBe('#d1d5db');
    expect(r.menuHoverBg).toBe('#f3f4f6');
  });
});
