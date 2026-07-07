/**
 * Title-bar chrome for CGridExt — the slim always-on primary toolbar that
 * matches the MarketsGrid reference: brand + collapse on the left, an
 * expandable search in the center, and a right cluster of notifications,
 * layout switcher, dirty-aware layout-update save, date, settings launcher,
 * and an overflow menu (toolbar toggles + Columns…).
 *
 * Every item is a `toolbar-item` extension in a `primary-*` slot; all colour
 * comes from the grid's `--cg-*` theme tokens (CGridExt mirrors the theme
 * class onto the shell root) with a neutral dark fallback, so the bar reads
 * as one surface with the grid. Icons are inline single-path SVG (Lucide
 * geometry) — no external asset, crisp at any DPI.
 */
import type { CgExtension, CgExtContext, ToolbarItem, ToolbarItemInstance } from '../extension/types';
import { menu, svg, iconButton } from './ui';
import { layoutsItem, layoutSaveItem } from './layoutsMenu';

export interface TitleBarOptions {
  /** Brand label shown at the far left (e.g. the grid's name). */
  name?: string;
  /** Date shown in the date pill (display-only; caller controls semantics). */
  date?: string;
}

/** Build the full title-bar extension set. Compose into `ext.extensions`
 *  (removing the default `settings-launcher`/`save` first — this set
 *  supersedes them with the richer bar). */
export function titleBarExtensions(opts: TitleBarOptions = {}): CgExtension[] {
  injectTitleBarStyles();
  return [
    brandItem(opts.name ?? 'cgrid'),
    searchItem(),
    notificationsItem(),
    layoutsItem(),
    layoutSaveItem(),
    dateItem(opts.date ?? ''),
    settingsItem(),
    overflowItem(),
  ];
}

// ── icons ────────────────────────────────────────────────────────────────
const ICON = {
  chevronsLeft: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  search: 'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  more: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  columns: 'M3 3h18v18H3zM12 3v18',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  brush: 'M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
};

// ── item factories ─────────────────────────────────────────────────────────

function item(
  id: string,
  slot: ToolbarItem['slot'],
  render: (host: HTMLElement, ctx: CgExtContext) => ToolbarItemInstance,
): ToolbarItem {
  return { id, kind: 'toolbar-item', slot, init() {}, render };
}

function brandItem(name: string): ToolbarItem {
  return item('brand', 'primary-left', (host) => {
    const wrap = document.createElement('div');
    wrap.className = 'cgext-brand';
    const label = document.createElement('span');
    label.className = 'cgext-brand-name';
    label.textContent = name;
    const collapse = iconButton(ICON.chevronsLeft, 'Collapse');
    collapse.classList.add('cgext-brand-collapse');
    wrap.append(label, collapse);
    host.appendChild(wrap);
    return { destroy() { host.replaceChildren(); } };
  });
}

function searchItem(): ToolbarItem {
  return item('search', 'primary-center', (host, ctx) => {
    const wrap = document.createElement('div');
    wrap.className = 'cgext-search';
    const btn = iconButton(ICON.search, 'Search grid');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'cgext-search-input';
    input.placeholder = 'Search grid…';
    input.hidden = true;
    const expand = (on: boolean) => {
      input.hidden = !on;
      wrap.classList.toggle('cgext-search-open', on);
      if (on) input.focus();
    };
    btn.addEventListener('click', () => expand(input.hidden));
    input.addEventListener('input', () => {
      // Best-effort quick filter — harmless no-op if the kernel build
      // doesn't expose the option.
      try { ctx.grid.setGridOption('quickFilterText' as any, input.value as any); } catch { /* ignore */ }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); expand(false); } });
    input.addEventListener('blur', () => { if (!input.value) expand(false); });
    wrap.append(btn, input);
    host.appendChild(wrap);
    return { destroy() { host.replaceChildren(); } };
  });
}

function notificationsItem(): ToolbarItem {
  return item('notifications', 'primary-right', (host) => {
    host.appendChild(iconButton(ICON.bell, 'Notifications'));
    return { destroy() { host.replaceChildren(); } };
  });
}

function dateItem(date: string): ToolbarItem {
  return item('date', 'primary-right', (host) => {
    const pill = document.createElement('div');
    pill.className = 'cgext-date';
    pill.innerHTML = `${svg(ICON.calendar, 14)}<span>${date || '—'}</span>`;
    host.appendChild(pill);
    return { destroy() { host.replaceChildren(); } };
  });
}

function settingsItem(): ToolbarItem {
  return item('settings-launcher', 'primary-right', (host, ctx) => {
    const btn = iconButton(ICON.sliders, 'Settings');
    btn.classList.add('cgext-settings-launcher');
    btn.addEventListener('click', () => ctx.events.emit({ type: 'open-settings', id: 'grid-options' }));
    host.appendChild(btn);
    return { destroy() { host.replaceChildren(); } };
  });
}

function overflowItem(): ToolbarItem {
  return item('overflow', 'primary-right', (host, ctx) => {
    const btn = iconButton(ICON.more, 'More');
    const m = menu(btn, (close) => {
      const list = document.createElement('div');
      list.className = 'cgext-menu-list';
      const entry = (icon: string, text: string, onClick: () => void) => {
        const it = document.createElement('button');
        it.type = 'button';
        it.className = 'cgext-menu-item';
        it.innerHTML = `${svg(icon, 15)}<span>${text}</span>`;
        it.addEventListener('click', () => { onClick(); close(); });
        list.appendChild(it);
      };
      // A checkable toggle for a sub-toolbar: reflects the live ribbon DOM
      // state, stays open, and repaints its checkmark on each toggle.
      const toggleEntry = (icon: string, text: string, section: string, toolbar: string) => {
        const strip = () => document.querySelector<HTMLElement>(`.cgext-ribbon [data-toolbar="${toolbar}"]`);
        const it = document.createElement('button');
        it.type = 'button';
        const paint = () => {
          const on = !!strip() && !strip()!.hidden;
          it.className = 'cgext-menu-item cgext-menu-toggle' + (on ? ' is-active' : '');
          it.innerHTML = `${svg(icon, 15)}<span>${text}</span><span class="cgext-menu-check">${on ? svg('M20 6L9 17l-5-5', 13) : ''}</span>`;
        };
        paint();
        it.addEventListener('click', () => { ctx.events.emit({ type: 'toggle-ribbon', section }); paint(); });
        list.appendChild(it);
      };
      // Dark-theme toggle. Every built-in theme ships as a light/dark pair
      // sharing a class stem (`cg-theme-starui[-dark]`, `cg-theme-quartz[-dark]`,
      // …), so flipping the `-dark` suffix swaps mode while preserving the
      // family. The new class goes to BOTH the kernel (setTheme repaints the
      // canvas) and the shell root, which mirrors the theme class so the
      // chrome's `--cg-*` tokens track the grid (see CGridExt constructor).
      const themeEntry = () => {
        const root = host.closest<HTMLElement>('.cgext-root');
        const current = () =>
          (root && Array.from(root.classList).find((c) => c.startsWith('cg-theme-'))) || 'cg-theme-quartz';
        const it = document.createElement('button');
        it.type = 'button';
        const paint = () => {
          const dark = current().endsWith('-dark');
          it.className = 'cgext-menu-item cgext-menu-toggle' + (dark ? ' is-active' : '');
          it.innerHTML = `${svg(ICON.moon, 15)}<span>Dark theme</span><span class="cgext-menu-check">${dark ? svg('M20 6L9 17l-5-5', 13) : ''}</span>`;
        };
        paint();
        it.addEventListener('click', () => {
          const cur = current();
          const next = cur.endsWith('-dark') ? cur.slice(0, -'-dark'.length) : `${cur}-dark`;
          try { ctx.grid.setTheme(next); } catch { /* ignore */ }
          if (root) { root.classList.remove(cur); root.classList.add(next); }
          paint();
        });
        list.appendChild(it);
      };
      entry(ICON.columns, 'Columns…', () => { try { ctx.grid.openToolPanel?.('columns'); } catch { /* ignore */ } });
      entry(ICON.wand, 'Auto format', () => ctx.events.emit({ type: 'auto-format' }));
      const sep = document.createElement('div'); sep.className = 'cgext-menu-sep'; list.appendChild(sep);
      toggleEntry(ICON.brush, 'Formatting toolbar', 'format', 'formatting');
      toggleEntry(ICON.pencil, 'Editing toolbar', 'edit', 'editing');
      const sep2 = document.createElement('div'); sep2.className = 'cgext-menu-sep'; list.appendChild(sep2);
      themeEntry();
      return list;
    });
    btn.addEventListener('click', () => m.toggle());
    host.appendChild(btn);
    return { destroy() { m.destroy(); host.replaceChildren(); } };
  });
}

// ── styles ─────────────────────────────────────────────────────────────────
export function injectTitleBarStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-titlebar-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-titlebar-styles';
  style.textContent = TITLEBAR_CSS;
  document.head.appendChild(style);
}

const TITLEBAR_CSS = `
.cgext-iconbtn {
  appearance: none;
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 7px;
  background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cgext-iconbtn:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); color: var(--cg-fg-color, #e5e9f0); }
.cgext-iconbtn:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-iconbtn:disabled { opacity: 0.5; cursor: default; }
.cgext-iconbtn:disabled:hover { background: transparent; }

.cgext-brand { display: inline-flex; align-items: center; gap: 6px; padding-right: 4px; }
.cgext-brand-name { font-weight: 650; font-size: 14px; letter-spacing: -0.01em; color: var(--cg-fg-color, #e5e9f0); }
.cgext-brand-collapse { width: 26px; height: 26px; }

.cgext-search { display: inline-flex; align-items: center; gap: 4px; }
.cgext-search-open { background: var(--cg-control-bg, rgba(255,255,255,0.05)); border-radius: 8px; padding-left: 2px; }
.cgext-search-input {
  width: 260px; height: 28px; padding: 0 10px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 8px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25));
  color: var(--cg-fg-color, #e5e9f0); font: inherit;
}
.cgext-search-input:focus { outline: none; border-color: var(--cg-accent-color, #4f9cf9); }

.cgext-profile {
  display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 8px 0 5px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 8px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.cgext-profile:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-profile-avatar {
  width: 20px; height: 20px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 22%, transparent);
  color: var(--cg-accent-color, #4f9cf9);
}
.cgext-profile-name { font-weight: 550; font-size: 12.5px; }
.cgext-profile-caret { color: var(--cg-muted-fg-color, #9aa4b6); display: inline-flex; }

.cgext-save.is-dirty {
  color: var(--cg-warning-color, #e0b341);
}
.cgext-settings-launcher.cgext-iconbtn { color: var(--cg-accent-color, #4f9cf9); }

.cgext-date {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 10px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 8px;
  color: var(--cg-fg-color, #e5e9f0); font-size: 12.5px; font-variant-numeric: tabular-nums;
}
.cgext-date svg { color: var(--cg-muted-fg-color, #9aa4b6); }

/* divider before the right icon cluster */
.cgext-titlebar > .cgext-slot-primary-right { gap: 6px; }

.cgext-menu {
  position: fixed; z-index: 60; min-width: 190px;
  padding: 5px;
  background: var(--cg-popup-bg, #171c26);
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  color: var(--cg-fg-color, #e5e9f0);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
.cgext-menu-list { display: flex; flex-direction: column; }
.cgext-menu-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px; border: none; border-radius: 7px;
  background: transparent; color: inherit; font: inherit; text-align: left;
  cursor: pointer;
}
.cgext-menu-item:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.07)); }
.cgext-menu-item svg { color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-menu-item.is-active { color: var(--cg-accent-color, #4f9cf9); }
.cgext-menu-item.is-active svg { color: var(--cg-accent-color, #4f9cf9); }
.cgext-menu-toggle { min-width: 200px; }
.cgext-menu-toggle span:nth-child(2) { flex: 1 1 auto; }
.cgext-menu-check { display: inline-flex; width: 14px; color: var(--cg-accent-color, #4f9cf9); }
.cgext-menu-sep { height: 1px; margin: 5px 4px; background: var(--cg-border-color, #2a3140); }
`;
