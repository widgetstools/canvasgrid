/**
 * Responsive ribbon overflow — keep labelled groups/segments on the strip,
 * and when content cannot fit in the row budget move lowest-priority items
 * into a `⋯` menu (same DOM nodes, so existing control wiring stays intact).
 *
 * Items overflow ONLY when the track cannot fit them. A zero-width /
 * not-yet-laid-out track must not spill.
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

  const orderIndex = new Map(items.map((it, i) => [it.el, i]));

  const restoreAll = (): void => {
    for (const item of items) track.appendChild(item.el);
  };

  /**
   * True only when laid-out content exceeds the row budget.
   *
   * Single-row strips must NOT use unique `offsetTop` counts: with
   * `align-items: center`, shorter segments sit at a different top than
   * taller ones on the SAME row, which previously false-triggered overflow
   * while the bar still had empty space.
   */
  const exceedsBudget = (): boolean => {
    const cw = track.clientWidth;
    // Not laid out yet — never spill; a later resize/rAF reflow measures.
    if (cw < 8) return false;

    const kids = Array.from(track.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
    if (kids.length === 0) return false;

    if (maxRows === 1) {
      // nowrap track: horizontal overflow is the only signal.
      return track.scrollWidth > cw + 1;
    }

    // Multi-row: cluster tops within a tolerance so center-aligned
    // different-height siblings count as one row.
    const heights = kids.map((k) => k.offsetHeight);
    const medianH = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)] ?? 1;
    const tol = Math.max(4, medianH * 0.45);
    const rowTops: number[] = [];
    for (const k of kids) {
      const t = k.offsetTop;
      if (!rowTops.some((rt) => Math.abs(rt - t) <= tol)) rowTops.push(t);
    }
    if (rowTops.length > maxRows) return true;

    const rowH = Math.max(...heights, 1);
    return track.scrollHeight > rowH * maxRows + 6;
  };

  const syncButton = (): void => {
    const n = stash.childElementCount + (panel ? panel.childElementCount : 0);
    button.hidden = n === 0;
    button.classList.toggle('has-items', n > 0);
    button.title = n === 0 ? 'More tools' : `More tools (${n})`;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', panel ? 'true' : 'false');
  };

  let panel: HTMLElement | null = null;

  /** Keep overflow panel in toolbar DOM order (Templates/Clear last). */
  const appendStashInToolbarOrder = (host: HTMLElement): void => {
    const nodes = Array.from(stash.children) as HTMLElement[];
    nodes.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    for (const n of nodes) host.appendChild(n);
  };

  const closePanel = (): void => {
    if (!panel) return;
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
    appendStashInToolbarOrder(panel);
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
    void track.offsetWidth;
    for (const cand of byPriority) {
      if (!exceedsBudget()) break;
      if (cand.el.parentElement === track) stash.appendChild(cand.el);
      void track.offsetWidth;
    }
    syncButton();
  };

  let ro: ResizeObserver | null = null;
  let raf = 0;
  const schedule = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        raf = 0;
        reflow();
      });
    });
  };

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => schedule());
    ro.observe(track);
    const band = track.closest('.vgext-edit-strip, .vgext-format-strip, .vgext-ribbon');
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
