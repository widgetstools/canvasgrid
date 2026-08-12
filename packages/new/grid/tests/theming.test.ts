import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

// Stub Worker + canvas 2D context for happy-dom so VelocityGrid can construct.
// Mirrors the setup in cgrid.integration.test.ts.
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

  it('reads --vg-input-bg / -fg / -border / -focus-border / -disabled-bg', () => {
    const c = makeContainer({
      '--vg-input-bg': '#ffffff',
      '--vg-input-fg': '#111827',
      '--vg-input-border': '#d1d5db',
      '--vg-input-focus-border': '#2563eb',
      '--vg-input-disabled-bg': '#f3f4f6',
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
      '--vg-fg-color': '#1a1f24',
      '--vg-bg-color': '#ffffff',
      '--vg-border-color': '#d5dbe0',
      '--vg-focus-ring-color': '#3b82f6',
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

  it('reads --vg-tooltip-bg / -fg / -border', () => {
    const c = makeContainer({
      '--vg-tooltip-bg': 'rgba(15,23,42,0.95)',
      '--vg-tooltip-fg': '#ffffff',
      '--vg-tooltip-border': 'rgba(255,255,255,0.1)',
    });
    const r = new CssReader(c).read();
    expect(r.tooltipBg).toBe('rgba(15,23,42,0.95)');
    expect(r.tooltipFg).toBe('#ffffff');
    expect(r.tooltipBorder).toBe('rgba(255,255,255,0.1)');
  });
});

describe('Cycle 22 / Task 1 — checkbox accent tokens', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads --vg-checkbox-checked-bg / -checked-fg', () => {
    const c = makeContainer({
      '--vg-checkbox-checked-bg': '#2563eb',
      '--vg-checkbox-checked-fg': '#ffffff',
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

describe('Cycle 22 / Task 2 — density modes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('applies the vg-density-<mode> class on construction when density is set', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
      density: 'compact',
    } as any);
    const root = host.querySelector('.vg-grid') as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root!.classList.contains('vg-density-compact')).toBe(true);
    grid.destroy();
  });

  it('omits density classes entirely when no density is specified', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
    } as any);
    const cls = (host.querySelector('.vg-grid') as HTMLElement).className;
    expect(cls).not.toContain('vg-density-');
    grid.destroy();
  });

  it('swaps the density class via setGridOption("density", ...)', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
      density: 'normal',
    } as any);
    grid.setGridOption('density', 'comfortable');
    const root = host.querySelector('.vg-grid') as HTMLElement;
    expect(root.classList.contains('vg-density-comfortable')).toBe(true);
    expect(root.classList.contains('vg-density-normal')).toBe(false);
    grid.destroy();
  });

  it('clears the density class when set to undefined', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
      density: 'compact',
    } as any);
    grid.setGridOption('density', undefined);
    const root = host.querySelector('.vg-grid') as HTMLElement;
    expect(root.className).not.toContain('vg-density-');
    grid.destroy();
  });
});

describe('Cycle 22 / Task 3 — setThemeParams API', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('writes inline CSS custom properties onto the grid root', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
    } as any);
    grid.setThemeParams({
      '--vg-row-height': '36px',
      '--vg-header-bg': '#0f172a',
    });
    const root = host.querySelector('.vg-grid') as HTMLElement;
    expect(root.style.getPropertyValue('--vg-row-height')).toBe('36px');
    expect(root.style.getPropertyValue('--vg-header-bg')).toBe('#0f172a');
    grid.destroy();
  });

  it('round-trips the params through getThemeParams', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
    } as any);
    grid.setThemeParams({ '--vg-row-height': '36px' });
    expect(grid.getThemeParams()).toEqual({ '--vg-row-height': '36px' });
    grid.setThemeParams({ '--vg-header-bg': '#000' });
    // Merge — both keys present.
    expect(grid.getThemeParams()).toEqual({
      '--vg-row-height': '36px',
      '--vg-header-bg': '#000',
    });
    grid.destroy();
  });

  it('removes a token when its value is the empty string', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
    } as any);
    grid.setThemeParams({ '--vg-row-height': '36px' });
    grid.setThemeParams({ '--vg-row-height': '' });
    const root = host.querySelector('.vg-grid') as HTMLElement;
    expect(root.style.getPropertyValue('--vg-row-height')).toBe('');
    expect(grid.getThemeParams()['--vg-row-height']).toBeUndefined();
    grid.destroy();
  });

  it('re-reads the theme so cssReader picks up the override on the next paint', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
    } as any);
    const before = (grid as any).theme.headerBg;
    grid.setThemeParams({ '--vg-header-bg': '#000000' });
    const after = (grid as any).theme.headerBg;
    expect(after).not.toBe(before);
    expect(after).toBe('#000000');
    grid.destroy();
  });
});

describe('Cycle 22 / Task 4 — vg-theme-auto class', () => {
  // happy-dom doesn't honor CSS imports at module-load time, so a
  // standard `document.styleSheets` walk returns empty. Read the
  // source as text and assert against the declarations — covers both
  // the `.vg-theme-auto` selector AND the `@media (prefers-color-
  // scheme: dark)` rule it ships paired with.
  let cssSource: string;
  beforeAll(async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'src/theming/tokens.css');
    cssSource = fs.readFileSync(file, 'utf-8');
  });

  it('declares a .vg-theme-auto selector in tokens.css', () => {
    expect(cssSource).toMatch(/\.vg-theme-auto\b/);
  });

  it('pairs the auto selector with a @media (prefers-color-scheme: dark) override', () => {
    expect(cssSource).toMatch(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
  });

  it('the dark @media block sets a dark-tone --vg-bg-color (sanity check the dark bundle landed)', () => {
    // Pluck the dark media block and confirm it sets bg-color to a value
    // distinct from the light theme's #ffffff.
    const match = cssSource.match(
      /@media[^{]*prefers-color-scheme:\s*dark[^{]*\{([\s\S]*?)\}\s*\}/,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/--vg-bg-color\s*:\s*#1e1e1e/);
  });
});

describe('Cycle 22 / Task 5 — shadow-root option', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('attaches a shadow root to the container when shadowRoot is true', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
      shadowRoot: true,
    } as any);
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot!.querySelector('.vg-grid')).not.toBeNull();
    grid.destroy();
  });

  it('injects a <style> element inside the shadow root for tokens.css', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
      shadowRoot: true,
    } as any);
    // The element MUST exist so production builds (where Vite's
    // `?inline` resolves to the compiled CSS text) ship a self-
    // contained shadow tree. In the test runtime Vite's inline
    // pipeline returns an empty string, so we only assert the element
    // attaches — the content assertion is covered by the prod
    // production bundle test (verified by the showcase build target).
    const styleEl = host.shadowRoot!.querySelector('style.vg-shadow-tokens');
    expect(styleEl).not.toBeNull();
    grid.destroy();
  });

  it('does NOT attach a shadow root when shadowRoot is unset or false (default)', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
    } as any);
    expect(host.shadowRoot).toBeNull();
    expect(host.querySelector('.vg-grid')).not.toBeNull();
    grid.destroy();
  });

  it('setThemeParams writes onto the root inside the shadow tree, not the light DOM', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      theme: 'vg-theme-quartz',
      shadowRoot: true,
    } as any);
    grid.setThemeParams({ '--vg-row-height': '42px' });
    const rootInShadow = host.shadowRoot!.querySelector('.vg-grid') as HTMLElement;
    expect(rootInShadow.style.getPropertyValue('--vg-row-height')).toBe('42px');
    // No leak into the light DOM.
    expect((host as HTMLElement).style.getPropertyValue('--vg-row-height')).toBe('');
    grid.destroy();
  });
});

describe('Cycle 22 / Task 1 — inter-column rule + popup/menu tokens', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads --vg-cell-horizontal-border-color and defaults to "transparent"', () => {
    const c = makeContainer({});
    const r = new CssReader(c).read();
    expect(r.cellHorizontalBorderColor).toBe('transparent');

    const c2 = makeContainer({ '--vg-cell-horizontal-border-color': '#e5e7eb' });
    const r2 = new CssReader(c2).read();
    expect(r2.cellHorizontalBorderColor).toBe('#e5e7eb');
  });

  it('reads --vg-popup-bg / -popup-border / -menu-hover-bg', () => {
    const c = makeContainer({
      '--vg-popup-bg': '#ffffff',
      '--vg-popup-border': '#d1d5db',
      '--vg-menu-hover-bg': '#f3f4f6',
    });
    const r = new CssReader(c).read();
    expect(r.popupBg).toBe('#ffffff');
    expect(r.popupBorder).toBe('#d1d5db');
    expect(r.menuHoverBg).toBe('#f3f4f6');
  });
});
