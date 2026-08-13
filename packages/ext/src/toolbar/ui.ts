/**
 * Shared plain-DOM toolbar primitives for VelocityGridExt chrome: inline Lucide-path
 * SVG, the 30px icon button, and the click-away anchored popup. Extracted from
 * titleBar.ts so sibling toolbar modules (layoutsMenu) reuse them without an
 * import cycle. Styling comes from the title-bar stylesheet (`.vgext-iconbtn`,
 * `.vgext-menu*`) — callers must have called `injectTitleBarStyles()`.
 */

export function svg(path: string, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

export function iconButton(icon: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'vgext-iconbtn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg(icon);
  return b;
}

/** Mirror the anchor's active `.vg-theme-*` class onto a body-mounted
 *  element. Popups mount OUTSIDE the shell root that carries the theme
 *  class, so without this every `--vg-*` token falls back to the
 *  neutral-dark defaults and popups render dark on light themes. Clears
 *  any previously-mirrored theme class first (the theme can be toggled
 *  between opens). */
export function mirrorThemeClass(anchor: HTMLElement, el: HTMLElement): void {
  for (const c of Array.from(el.classList)) if (c.startsWith('vg-theme-')) el.classList.remove(c);
  const root = anchor.closest<HTMLElement>('.vgext-root');
  const themeClass = root && Array.from(root.classList).find((c) => c.startsWith('vg-theme-'));
  if (themeClass) el.classList.add(themeClass);
}

/** Simple click-away popup menu anchored under `anchor`.
 *  `opts.align` picks which anchor edge the panel hugs (default right).
 *  `opts.fitTo` clamps width + position into a container (e.g. cockpit pane)
 *  so wide panels like the format picker stay inside settings editors. */
export function menu(
  anchor: HTMLElement,
  build: (close: () => void) => HTMLElement,
  onOpenChange?: (open: boolean) => void,
  opts?: {
    align?: 'left' | 'right';
    fitTo?: HTMLElement | (() => HTMLElement | null | undefined);
    /** Preferred width before fitTo / viewport clamping. */
    preferWidth?: number;
    /** Below this fitted width, `is-compact` is added on the panel. */
    compactBelow?: number;
  },
): { toggle: () => void; destroy: () => void } {
  let panel: HTMLElement | null = null;
  const close = () => {
    if (!panel) return;
    panel.remove(); panel = null;
    document.removeEventListener('pointerdown', onDoc, true);
    onOpenChange?.(false);
  };
  const onDoc = (e: PointerEvent) => {
    if (panel && !panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const open = () => {
    panel = build(close);
    panel.classList.add('vgext-menu');
    mirrorThemeClass(anchor, panel);
    document.body.appendChild(panel);

    const margin = 8;
    const fitSrc = typeof opts?.fitTo === 'function' ? opts.fitTo() : opts?.fitTo;
    const fitEl = fitSrc ?? null;
    const fit = fitEl?.getBoundingClientRect();
    const bounds = fit
      ? {
          left: fit.left + margin,
          right: fit.right - margin,
          top: Math.max(margin, fit.top + margin),
          bottom: Math.min(window.innerHeight - margin, fit.bottom - margin),
        }
      : {
          left: margin,
          right: window.innerWidth - margin,
          top: margin,
          bottom: window.innerHeight - margin,
        };
    const maxW = Math.max(220, bounds.right - bounds.left);
    const prefer = opts?.preferWidth ?? panel.offsetWidth;
    const width = Math.min(prefer, maxW);
    panel.style.width = `${Math.round(width)}px`;
    panel.style.maxWidth = `${Math.round(maxW)}px`;
    panel.classList.toggle('is-compact', width < (opts?.compactBelow ?? 380));

    const r = anchor.getBoundingClientRect();
    let top = Math.round(r.bottom + 4);
    let left = opts?.align === 'left'
      ? Math.round(r.left)
      : Math.round(r.right - width);
    left = Math.max(bounds.left, Math.min(left, bounds.right - width));
    // Prefer below the anchor; flip above when the fitted box would clip.
    const availH = Math.max(160, bounds.bottom - bounds.top);
    panel.style.maxHeight = `${Math.round(availH)}px`;
    // Read height after maxHeight so flip/clamp use the constrained size.
    const h = Math.min(panel.offsetHeight, availH);
    if (top + h > bounds.bottom && r.top - 4 - h >= bounds.top) {
      top = Math.round(r.top - 4 - h);
    }
    top = Math.max(bounds.top, Math.min(top, Math.max(bounds.top, bounds.bottom - h)));

    panel.style.setProperty('--vgext-menu-top', `${top}px`);
    panel.style.setProperty('--vgext-menu-left', `${left}px`);
    document.addEventListener('pointerdown', onDoc, true);
    onOpenChange?.(true);
  };
  return { toggle: () => (panel ? close() : open()), destroy: close };
}
