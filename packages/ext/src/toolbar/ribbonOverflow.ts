/**
 * Responsive ribbon overflow — keep labelled groups/segments wrappable, and
 * when content exceeds a max row budget move lowest-priority items into a
 * `⋯` menu (same DOM nodes, so existing control wiring stays intact).
 */
import { mirrorThemeClass } from './ui';

export type RibbonOverflowItem = {
  el: HTMLElement;
  /** Higher = overflow sooner. `0` / omitted = never overflows. */
  priority: number;
};

export type RibbonOverflowHandle = {
  /** Re-measure and move items (also runs on resize). */
  reflow: () => void;
  destroy: () => void;
};

/**
 * @param track     Flex container that holds the items (cluster / edit body).
 * @param items     Stable DOM-order list of overflow-capable children.
 * @param button    The `⋯` trigger (hidden automatically when stash is empty).
 * @param maxRows   Row budget before items spill into overflow (default 2).
 */
export function wireRibbonOverflow(opts: {
  track: HTMLElement;
  items: RibbonOverflowItem[];
  button: HTMLButtonElement;
  maxRows?: number;
}): RibbonOverflowHandle {
  const maxRows = Math.max(1, opts.maxRows ?? 2);
  const { track, items, button } = opts;

  // Hidden parking lot for overflowed nodes while the menu is closed.
  const stash = document.createElement('div');
  stash.className = 'vgext-rb-overflow-stash';
  stash.hidden = true;
  // Keep stash in the tree (not display:contents) so nodes stay alive.
  (track.parentElement ?? track).appendChild(stash);

  const byPriority = [...items]
    .filter((i) => i.priority > 0)
    .sort((a, b) => b.priority - a.priority);

  const restoreAll = (): void => {
    for (const item of items) track.appendChild(item.el);
  };

  const exceedsBudget = (): boolean => {
    const kids = Array.from(track.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
    if (kids.length === 0) return false;
    const tops = new Set(kids.map((k) => Math.round(k.offsetTop)));
    if (tops.size > maxRows) return true;
    const rowH = Math.max(...kids.map((k) => k.offsetHeight), 1);
    return track.scrollHeight > rowH * maxRows + 6;
  };

  const syncButton = (): void => {
    const n = stash.childElementCount;
    button.hidden = n === 0;
    button.classList.toggle('has-items', n > 0);
    button.title = n === 0 ? 'More tools' : `More tools (${n})`;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', panel ? 'true' : 'false');
  };

  let panel: HTMLElement | null = null;

  const closePanel = (): void => {
    if (!panel) return;
    // Rescue nodes BEFORE removing the panel (menu destroy would drop them).
    while (panel.firstChild) stash.appendChild(panel.firstChild);
    panel.remove();
    panel = null;
    document.removeEventListener('pointerdown', onDoc, true);
    button.classList.remove('is-open');
    syncButton();
  };

  const onDoc = (e: PointerEvent): void => {
    if (!panel) return;
    if (panel.contains(e.target as Node) || button.contains(e.target as Node)) return;
    closePanel();
  };

  const openPanel = (): void => {
    if (panel || stash.childElementCount === 0) return;
    panel = document.createElement('div');
    panel.className = 'vgext-menu vgext-rb-overflow-panel';
    mirrorThemeClass(button, panel);
    while (stash.firstChild) panel.appendChild(stash.firstChild);
    document.body.appendChild(panel);

    const margin = 8;
    const r = button.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - margin * 2);
    let left = r.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const top = Math.min(r.bottom + 6, window.innerHeight - margin - 40);
    panel.style.setProperty('--vgext-menu-top', `${top}px`);
    panel.style.setProperty('--vgext-menu-left', `${left}px`);
    panel.style.width = `${width}px`;

    document.addEventListener('pointerdown', onDoc, true);
    button.classList.add('is-open');
    syncButton();
  };

  const togglePanel = (): void => {
    if (panel) closePanel();
    else openPanel();
  };

  button.addEventListener('click', togglePanel);

  const reflow = (): void => {
    if (panel) closePanel();
    restoreAll();
    void track.offsetHeight;
    for (const cand of byPriority) {
      if (!exceedsBudget()) break;
      if (cand.el.parentElement === track) stash.appendChild(cand.el);
      void track.offsetHeight;
    }
    syncButton();
  };

  let ro: ResizeObserver | null = null;
  let raf = 0;
  const schedule = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      reflow();
    });
  };

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => schedule());
    ro.observe(track);
    const band = track.closest('.vgext-ribbon-band, .vgext-edit-strip, .vgext-ribbon');
    if (band) ro.observe(band);
  } else {
    window.addEventListener('resize', schedule);
  }

  schedule();

  return {
    reflow,
    destroy: () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', schedule);
      closePanel();
      button.removeEventListener('click', togglePanel);
      restoreAll();
      stash.remove();
    },
  };
}
