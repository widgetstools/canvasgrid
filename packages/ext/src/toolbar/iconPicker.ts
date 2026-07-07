// Icon/emoji tile picker for the Formatting ribbon's Icons section.
// One button + one anchored dropdown panel: a search field on top, then
// category sections (Lucide vector icons first, then emojis), each an
// 8-per-row tile grid. Tiles are lazily built on first open (1500+ nodes).
//
// Selection contract: fires onSelect({name}) for a Lucide tile or
// onSelect({emoji}) for an emoji tile, then closes. The caller owns all
// apply semantics (placement slots, editColumn) — this module is pure UI.

import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';
import { lucideCategories } from './iconCatalog.generated';
import { emojiCategories } from './emojiCatalog';

export interface IconSelection { name?: string; emoji?: string }

export interface IconPickerHandle {
  button: HTMLButtonElement;
  panel: HTMLDivElement;
  setPreview(sel: IconSelection | null): void;
  destroy(): void;
}

// A neutral "no icon yet" affordance for the trigger button — a dotted picker
// square, so the empty slot reads as "choose one" rather than a real glyph.
const PLACEHOLDER_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2.6 2.8" aria-hidden="true">'
  + '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8.5v7M8.5 12h7" stroke-dasharray="0"/></svg>';

// A muted magnifier for the empty-search state and the search field's leading
// adornment — both drawn solid (no dashes) at their own sizes.
const SEARCH_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';

function tileSvg(d: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

export function createIconPicker(opts: { onSelect: (sel: IconSelection) => void }): IconPickerHandle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cgext-rb-btn cgext-ip-open';
  button.title = 'Pick icon or emoji';
  button.setAttribute('aria-label', 'Pick icon or emoji');
  button.dataset.ip = 'open';
  button.innerHTML = PLACEHOLDER_SVG;

  const panel = document.createElement('div');
  panel.className = 'cgext-ip-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Icons and emojis');
  panel.hidden = true;

  let built = false;
  const build = (): void => {
    built = true;

    // Search field — a solid leading magnifier framing the input, which keeps
    // the real E2E hook (`[data-ip="search"]`) on the <input> itself.
    const searchWrap = document.createElement('div');
    searchWrap.className = 'cgext-ip-searchwrap';
    searchWrap.innerHTML = SEARCH_SVG;
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search icons & emojis…';
    search.className = 'cgext-ip-search';
    search.dataset.ip = 'search';
    search.setAttribute('aria-label', 'Search icons and emojis');
    searchWrap.append(search);

    const scroller = document.createElement('div');
    scroller.className = 'cgext-ip-scroll';

    // Empty state — a directive line that echoes what was searched, so a
    // no-match read gives the person something to correct, not just a shrug.
    const empty = document.createElement('div');
    empty.className = 'cgext-ip-empty';
    empty.innerHTML = SEARCH_SVG;
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'cgext-ip-empty-msg';
    emptyMsg.textContent = 'No icons match';
    empty.append(emptyMsg);
    empty.hidden = true;

    interface Section { root: HTMLElement; grid: HTMLElement; tiles: Array<{ el: HTMLButtonElement; key: string }> }
    const sections: Section[] = [];

    const addSection = (
      title: string,
      entries: ReadonlyArray<{ key: string; sel: IconSelection; html?: string; text?: string }>,
    ): void => {
      const root = document.createElement('div');
      root.className = 'cgext-ip-section';
      const label = document.createElement('div');
      label.className = 'cgext-ip-cat';
      label.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'cgext-ip-grid';
      const tiles: Section['tiles'] = [];
      for (const e of entries) {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'cgext-ip-tile';
        t.title = e.key;
        t.setAttribute('aria-label', e.key);
        if (e.sel.name) t.dataset.icon = e.sel.name;
        if (e.sel.emoji) t.dataset.emoji = e.sel.emoji;
        if (e.html) t.innerHTML = e.html; else t.textContent = e.text!;
        t.addEventListener('click', () => { opts.onSelect(e.sel); close(); });
        grid.append(t);
        tiles.push({ el: t, key: e.key.toLowerCase() });
      }
      root.append(label, grid);
      scroller.append(root);
      sections.push({ root, grid, tiles });
    };

    for (const cat of lucideCategories) {
      addSection(cat.category, cat.icons.map((name) => ({
        key: name, sel: { name }, html: tileSvg(lucideBundle[name]!),
      })));
    }
    for (const cat of emojiCategories) {
      addSection(`Emoji · ${cat.category}`, cat.emojis.map((emoji) => ({
        key: emoji, sel: { emoji }, text: emoji,
      })));
    }

    // Filtering DETACHES non-matching tiles rather than hiding them, so a
    // hidden tile is genuinely gone from the tree (querySelector-invisible).
    // Matches are re-appended in catalog order via one fragment per section.
    let lastQuery: string | null = null;
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      if (q === lastQuery) return;
      lastQuery = q;
      let any = false;
      for (const s of sections) {
        const frag = document.createDocumentFragment();
        let visible = 0;
        for (const t of s.tiles) {
          const hit = q === '' || t.key.includes(q) || (t.el.dataset.emoji?.includes(q) ?? false);
          if (hit) { frag.append(t.el); visible++; }
        }
        s.grid.replaceChildren(frag);
        s.root.hidden = visible === 0;
        if (visible > 0) any = true;
      }
      emptyMsg.textContent = q === '' ? 'No icons match' : `Nothing matches “${search.value.trim()}”`;
      empty.hidden = any;
    });

    panel.append(searchWrap, scroller, empty);
  };

  const onDocClick = (e: MouseEvent): void => {
    if (panel.hidden) return;
    const t = e.target as Node;
    if (!panel.contains(t) && !button.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };

  const open = (): void => {
    if (!built) build();
    const r = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 348))}px`;
    panel.style.top = `${r.bottom + 6}px`;
    panel.hidden = false;
    button.classList.add('is-open');
    (panel.querySelector('[data-ip="search"]') as HTMLInputElement | null)?.focus();
  };
  const close = (): void => { panel.hidden = true; button.classList.remove('is-open'); };
  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onKey);

  const setPreview = (sel: IconSelection | null): void => {
    if (sel?.emoji) { button.textContent = sel.emoji; return; }
    if (sel?.name && lucideBundle[sel.name]) { button.innerHTML = tileSvg(lucideBundle[sel.name]!); return; }
    button.innerHTML = PLACEHOLDER_SVG;
  };

  return {
    button, panel, setPreview,
    destroy() {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      panel.remove();
    },
  };
}
