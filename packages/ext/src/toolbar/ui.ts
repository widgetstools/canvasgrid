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

/** Simple click-away popup menu anchored under `anchor`. */
export function menu(
  anchor: HTMLElement,
  build: (close: () => void) => HTMLElement,
  onOpenChange?: (open: boolean) => void,
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
    document.body.appendChild(panel);
    const r = anchor.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 4)}px`;
    // right-align to the anchor, clamped so wide panels can't go off-screen left
    panel.style.left = `${Math.round(Math.max(8, r.right - panel.offsetWidth))}px`;
    document.addEventListener('pointerdown', onDoc, true);
    onOpenChange?.(true);
  };
  return { toggle: () => (panel ? close() : open()), destroy: close };
}
