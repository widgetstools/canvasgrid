/**
 * Sync VelocityGrid light/dark theme into the provider-editor popout.
 *
 * about:blank popouts do not load `tokens.css`, so we:
 *   1. Resolve light|dark from the opener (theme class / data attr / OS)
 *   2. Stamp `data-vg-theme-mode` + `color-scheme` on the popout <html>
 *   3. Copy computed `--vg-*` custom properties from a themed opener node
 *   4. Re-sync when the opener theme class / mode attr changes
 */

export type ThemeMode = 'light' | 'dark';

const THEME_VARS = [
  '--vg-fg-color',
  '--vg-bg-color',
  '--vg-muted-fg-color',
  '--vg-border-color',
  '--vg-header-bg',
  '--vg-header-fg',
  '--vg-popup-bg',
  '--vg-popup-border',
  '--vg-input-bg',
  '--vg-input-fg',
  '--vg-input-border',
  '--vg-row-alt-bg',
  '--vg-primary-color',
  '--vg-primary-fg',
  '--vg-accent-color',
  '--vg-accent-fg',
  '--vg-chrome-accent',
  '--vg-focus-ring-color',
  '--vg-font-family',
  '--vg-radius',
  '--vg-menu-hover-bg',
  '--vg-scrollbar-thickness',
  '--vg-scrollbar-thumb',
  '--vg-scrollbar-thumb-hover',
  '--vg-scrollbar-thumb-active',
  '--vg-scrollbar-track',
  '--vg-scrollbar-firefox',
] as const;

/** Find the best themed node in the opener document. */
export function findThemeSource(preferred?: HTMLElement | null): HTMLElement {
  if (preferred && preferred.isConnected) return preferred;
  const doc = preferred?.ownerDocument ?? document;
  return (
    doc.querySelector<HTMLElement>('.vgext-root[class*="vg-theme-"]')
    ?? doc.querySelector<HTMLElement>('[class*="vg-theme-"]')
    ?? doc.querySelector<HTMLElement>('[data-vg-theme-mode]')
    ?? doc.querySelector<HTMLElement>('.vgext-root')
    ?? doc.documentElement
  );
}

/** Resolve light|dark the same way the kernel theme-kind helper does. */
export function resolveThemeMode(source: HTMLElement): ThemeMode {
  const attrHost = source.closest('[data-vg-theme-mode]') ?? source;
  const attr = attrHost.getAttribute?.('data-vg-theme-mode');
  if (attr === 'dark' || attr === 'light') return attr;

  let themeClass: string | undefined;
  for (const c of Array.from(source.classList)) {
    if (c.startsWith('vg-theme-')) {
      themeClass = c;
      break;
    }
  }
  if (!themeClass) {
    const rooted = source.closest<HTMLElement>('[class*="vg-theme-"]');
    if (rooted) {
      for (const c of Array.from(rooted.classList)) {
        if (c.startsWith('vg-theme-')) {
          themeClass = c;
          break;
        }
      }
    }
  }

  if (themeClass === 'vg-theme-auto') {
    return typeof matchMedia === 'function'
      && matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  if (themeClass?.endsWith('-dark')) return 'dark';
  if (themeClass) return 'light';

  // Fallback: luminance of resolved background, then OS preference.
  try {
    const bg = getComputedStyle(source).getPropertyValue('--vg-bg-color').trim()
      || getComputedStyle(source).backgroundColor;
    if (bg && isDarkColor(bg)) return 'dark';
    if (bg && parseColor(bg)) return 'light';
  } catch { /* ignore */ }

  return typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyThemeToPopout(
  win: Window,
  source?: HTMLElement | null,
): ThemeMode {
  const src = findThemeSource(source ?? null);
  const mode = resolveThemeMode(src);
  const html = win.document.documentElement;
  const body = win.document.body;

  html.setAttribute('data-vg-theme-mode', mode);
  html.style.colorScheme = mode;
  if (body) body.style.colorScheme = mode;

  // Mirror theme class so any future stylesheet hooks can key off it.
  for (const el of [html, body].filter(Boolean) as HTMLElement[]) {
    for (const c of Array.from(el.classList)) {
      if (c.startsWith('vg-theme-')) el.classList.remove(c);
    }
  }
  let themeClass: string | undefined;
  for (const c of Array.from(src.classList)) {
    if (c.startsWith('vg-theme-')) {
      themeClass = c;
      break;
    }
  }
  if (!themeClass) {
    const rooted = src.closest<HTMLElement>('[class*="vg-theme-"]');
    themeClass = rooted
      ? Array.from(rooted.classList).find((c) => c.startsWith('vg-theme-'))
      : undefined;
  }
  if (themeClass) {
    html.classList.add(themeClass);
    body?.classList.add(themeClass);
  }

  // Copy resolved tokens from the opener themed node (tokens.css isn't in the popout).
  try {
    const cs = getComputedStyle(src);
    for (const key of THEME_VARS) {
      const v = cs.getPropertyValue(key).trim();
      if (v) html.style.setProperty(key, v);
    }
    // Sweep any other --vg-* custom props the browser enumerates.
    for (let i = 0; i < cs.length; i++) {
      const name = cs.item(i);
      if (name.startsWith('--vg-') && !THEME_VARS.includes(name as typeof THEME_VARS[number])) {
        const v = cs.getPropertyValue(name).trim();
        if (v) html.style.setProperty(name, v);
      }
    }
  } catch { /* ignore */ }

  return mode;
}

/**
 * Keep the popout in sync while open. Returns a disposer.
 * Watches theme class / data-vg-theme-mode on the opener, plus OS scheme for auto.
 */
export function watchThemeSync(
  win: Window,
  source?: HTMLElement | null,
): () => void {
  const sync = () => {
    if (win.closed) return;
    applyThemeToPopout(win, source);
  };
  sync();

  const observer = new MutationObserver(sync);
  try {
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-vg-theme-mode', 'style'],
      subtree: true,
    });
  } catch { /* ignore */ }

  let mql: MediaQueryList | null = null;
  let mqlHandler: (() => void) | null = null;
  if (typeof matchMedia === 'function') {
    mql = matchMedia('(prefers-color-scheme: dark)');
    mqlHandler = () => sync();
    mql.addEventListener('change', mqlHandler);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') sync();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    observer.disconnect();
    if (mql && mqlHandler) mql.removeEventListener('change', mqlHandler);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

function parseColor(color: string): [number, number, number] | null {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function isDarkColor(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}
