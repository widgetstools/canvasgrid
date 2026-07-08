/**
 * Shared plain-DOM toolbar primitives for CGridExt chrome: inline Lucide-path
 * SVG, the 30px icon button, and the click-away anchored popup. Extracted from
 * titleBar.ts so sibling toolbar modules (layoutsMenu) reuse them without an
 * import cycle. Styling comes from the title-bar stylesheet (`.cgext-iconbtn`,
 * `.cgext-menu*`) — callers must have called `injectTitleBarStyles()`.
 */

export function svg(path: string, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

export function iconButton(icon: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cgext-iconbtn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg(icon);
  return b;
}

/** Mirror the anchor's active `.cg-theme-*` class onto a body-mounted
 *  element. Popups mount OUTSIDE the shell root that carries the theme
 *  class, so without this every `--cg-*` token falls back to the
 *  neutral-dark defaults and popups render dark on light themes. Clears
 *  any previously-mirrored theme class first (the theme can be toggled
 *  between opens). */
export function mirrorThemeClass(anchor: HTMLElement, el: HTMLElement): void {
  for (const c of Array.from(el.classList)) if (c.startsWith('cg-theme-')) el.classList.remove(c);
  const root = anchor.closest<HTMLElement>('.cgext-root');
  const themeClass = root && Array.from(root.classList).find((c) => c.startsWith('cg-theme-'));
  if (themeClass) el.classList.add(themeClass);
}

/** Simple click-away popup menu anchored under `anchor`.
 *  `opts.align` picks which anchor edge the panel hugs (default right). */
export function menu(
  anchor: HTMLElement,
  build: (close: () => void) => HTMLElement,
  onOpenChange?: (open: boolean) => void,
  opts?: { align?: 'left' | 'right' },
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
    panel.classList.add('cgext-menu');
    mirrorThemeClass(anchor, panel);
    document.body.appendChild(panel);
    const r = anchor.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 4)}px`;
    // Align to the anchor, clamped so wide panels can't go off-screen left.
    panel.style.left = opts?.align === 'left'
      ? `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)))}px`
      : `${Math.round(Math.max(8, r.right - panel.offsetWidth))}px`;
    document.addEventListener('pointerdown', onDoc, true);
    onOpenChange?.(true);
  };
  return { toggle: () => (panel ? close() : open()), destroy: close };
}
