import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../../src/cgrid';
import { themeQuartz, themeStarui, createTheme } from '../../src/theming/theme';

// Stub Worker + canvas 2D context for happy-dom so CGrid can construct.
// Mirrors the setup in cgrid.integration.test.ts / theming.test.ts.
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

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px; height:600px;';
  document.body.appendChild(el);
  return el;
}

function makeGrid(container: HTMLElement, theme: any) {
  return new CGrid<{ id: string }>(container, {
    columnDefs: [{ field: 'id' }],
    getRowId: (r) => r.id,
    theme,
  });
}

describe('CgTheme DOM integration — construction', () => {
  it('injects withParams vars as inline --cg-* overrides on the grid root', () => {
    const container = makeContainer();
    const theme = themeQuartz.withParams({ accentColor: '#2f7bc4' });
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;

    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#2f7bc4');
    // Accent-dependent derivations should also be present (row hover/selected/range).
    expect(root.style.getPropertyValue('--cg-row-hover-bg')).toContain('color-mix');
    expect(root.style.getPropertyValue('--cg-row-selected-bg')).toContain('color-mix');
    expect(root.style.getPropertyValue('--cg-range-border-color')).toBe('var(--cg-chrome-accent)');
    expect(root.style.getPropertyValue('--cg-range-fill-color')).toContain('color-mix');

    // The resolved ResolvedTheme should reflect the injected accent (used
    // by the range/hover/selected painters).
    const resolved = (grid as any).theme;
    expect(resolved.rangeBorderColor).toContain('#2f7bc4');

    grid.destroy();
    container.remove();
  });

  it('applies the quartz base class alongside the object theme', () => {
    const container = makeContainer();
    const theme = themeQuartz.withParams({ accentColor: '#111111' });
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;
    expect(root.classList.contains('cg-theme-quartz')).toBe(true);
    grid.destroy();
    container.remove();
  });

  it('empty CgTheme (no withParams) behaves like the plain string class — no inline vars', () => {
    const container = makeContainer();
    const grid = makeGrid(container, themeQuartz);
    const root = (grid as any).root as HTMLElement;

    expect(root.classList.contains('cg-theme-quartz')).toBe(true);
    // No object-derived --cg-* inline overrides at all.
    expect(root.style.cssText).not.toMatch(/--cg-/);
    expect((grid as any).themeObjectVars.size).toBe(0);

    grid.destroy();
    container.remove();
  });

  it('getThemeParams() excludes object-derived vars but keeps user overrides', () => {
    const container = makeContainer();
    const theme = themeQuartz.withParams({ accentColor: '#2f7bc4' });
    const grid = makeGrid(container, theme);

    // Sanity: the object DID inject something object-derived.
    expect((grid as any).themeObjectVars.size).toBeGreaterThan(0);
    expect(grid.getThemeParams()).toEqual({});

    grid.setThemeParams({ '--cg-row-height': '40px' });
    expect(grid.getThemeParams()).toEqual({ '--cg-row-height': '40px' });

    grid.destroy();
    container.remove();
  });

  it('Part CSS is injected as a <style> element on the grid root', () => {
    const container = makeContainer();
    const theme = themeQuartz.withPart({ feature: 'icons', css: '.cg-foo{color:red}' });
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;
    const styleEl = root.querySelector('style.cg-theme-object-css');
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain('.cg-foo{color:red}');
    grid.destroy();
    container.remove();
  });

  it('data-cg-theme-mode="dark" on an ancestor applies the dark base class + dark vars', () => {
    const container = makeContainer();
    container.setAttribute('data-cg-theme-mode', 'dark');
    const theme = themeQuartz.withParams({ accentColor: '#ffffff' }, 'dark')
      .withParams({ accentColor: '#000000' }, 'light');
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;

    expect(root.classList.contains('cg-theme-quartz-dark')).toBe(true);
    expect(root.classList.contains('cg-theme-quartz')).toBe(false);
    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#ffffff');

    grid.destroy();
    container.remove();
  });
});

describe('CgTheme DOM integration — string / undefined regression', () => {
  it('theme: "cg-theme-quartz" (string) is unaffected', () => {
    const container = makeContainer();
    const grid = makeGrid(container, 'cg-theme-quartz');
    const root = (grid as any).root as HTMLElement;
    expect(root.classList.contains('cg-theme-quartz')).toBe(true);
    expect((grid as any).themeObject).toBeUndefined();
    expect((grid as any).themeObjectVars.size).toBe(0);
    grid.destroy();
    container.remove();
  });

  it('theme: undefined defaults to cg-theme-quartz (string path unchanged)', () => {
    const container = makeContainer();
    const grid = makeGrid(container, undefined);
    const root = (grid as any).root as HTMLElement;
    expect(root.classList.contains('cg-theme-quartz')).toBe(true);
    expect((grid as any).themeObject).toBeUndefined();
    grid.destroy();
    container.remove();
  });
});

describe('CgTheme DOM integration — setTheme swap', () => {
  it('swapping from an object theme to themeStarui removes the prior object vars and applies the starui base class', () => {
    const container = makeContainer();
    const theme = themeQuartz.withParams({ accentColor: '#2f7bc4' });
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;
    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#2f7bc4');

    grid.setTheme(themeStarui);

    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('');
    expect(root.classList.contains('cg-theme-starui')).toBe(true);
    expect(root.classList.contains('cg-theme-quartz')).toBe(false);
    expect((grid as any).themeObjectVars.size).toBe(0);

    grid.destroy();
    container.remove();
  });

  it('swapping from a string theme to an object theme injects vars', () => {
    const container = makeContainer();
    const grid = makeGrid(container, 'cg-theme-quartz');
    const root = (grid as any).root as HTMLElement;

    grid.setTheme(themeQuartz.withParams({ accentColor: '#123456' }));
    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#123456');
    expect(root.classList.contains('cg-theme-quartz')).toBe(true);

    grid.destroy();
    container.remove();
  });

  it('swapping from an object theme back to a string theme blanks the object vars', () => {
    const container = makeContainer();
    const theme = themeQuartz.withParams({ accentColor: '#2f7bc4' });
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;

    grid.setTheme('cg-theme-quartz');

    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('');
    expect((grid as any).themeObject).toBeUndefined();
    expect((grid as any).themeObjectVars.size).toBe(0);

    grid.destroy();
    container.remove();
  });
});

describe('CgTheme DOM integration — setThemeMode', () => {
  it('re-applies the dark base class + dark-mode vars for the active object theme', () => {
    const container = makeContainer();
    const theme = createTheme({ baseClass: { light: 'cg-theme-quartz', dark: 'cg-theme-quartz-dark' } })
      .withParams({ accentColor: '#111111' }, 'light')
      .withParams({ accentColor: '#eeeeee' }, 'dark');
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;
    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#111111');

    grid.setThemeMode('dark');

    expect(root.classList.contains('cg-theme-quartz-dark')).toBe(true);
    expect(root.classList.contains('cg-theme-quartz')).toBe(false);
    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#eeeeee');

    grid.destroy();
    container.remove();
  });

  it('is a no-op for a string theme', () => {
    const container = makeContainer();
    const grid = makeGrid(container, 'cg-theme-quartz');
    const root = (grid as any).root as HTMLElement;
    expect(() => grid.setThemeMode('dark')).not.toThrow();
    expect(root.classList.contains('cg-theme-quartz')).toBe(true);
    expect(root.classList.contains('cg-theme-quartz-dark')).toBe(false);
    grid.destroy();
    container.remove();
  });
});

describe('CgTheme DOM integration — pickMode priority', () => {
  it('an explicit data-cg-theme-mode="light" attribute wins even when the OS prefers dark', () => {
    const originalMatchMedia = window.matchMedia;
    (window as any).matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true, // OS says dark
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const container = makeContainer();
    container.setAttribute('data-cg-theme-mode', 'light');
    const theme = themeQuartz.withParams({ accentColor: '#aaaaaa' }, 'light')
      .withParams({ accentColor: '#bbbbbb' }, 'dark');
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;

    expect(root.classList.contains('cg-theme-quartz')).toBe(true);
    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#aaaaaa');

    grid.destroy();
    container.remove();
    window.matchMedia = originalMatchMedia;
  });

  it('falls back to the OS prefers-color-scheme when no attribute is present', () => {
    const originalMatchMedia = window.matchMedia;
    (window as any).matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true, // OS says dark
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const container = makeContainer();
    const theme = themeQuartz.withParams({ accentColor: '#aaaaaa' }, 'light')
      .withParams({ accentColor: '#bbbbbb' }, 'dark');
    const grid = makeGrid(container, theme);
    const root = (grid as any).root as HTMLElement;

    expect(root.classList.contains('cg-theme-quartz-dark')).toBe(true);
    expect(root.style.getPropertyValue('--cg-chrome-accent')).toBe('#bbbbbb');

    grid.destroy();
    container.remove();
    window.matchMedia = originalMatchMedia;
  });
});
