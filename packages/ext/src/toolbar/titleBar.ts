/**
 * Title-bar chrome for CGridExt — the slim always-on primary toolbar that
 * matches the MarketsGrid reference: brand + collapse on the left, an
 * expandable search in the center, and a right cluster of notifications,
 * layout switcher + dirty-aware layout save, date, settings launcher,
 * and an overflow menu.
 *
 * "Profile" and "layout" are the same trader concept here — only the
 * layouts control is mounted (kernel named views).
 *
 * Every item is a `toolbar-item` extension in a `primary-*` slot; all colour
 * comes from the grid's `--cg-*` theme tokens (CGridExt mirrors the theme
 * class onto the shell root) with a neutral dark fallback, so the bar reads
 * as one surface with the grid. Icons are inline single-path SVG (Lucide
 * geometry) — no external asset, crisp at any DPI.
 */
import type { CgExtension, CgExtContext, ToolbarItem, ToolbarItemInstance } from '../extension/types';
import { menu, mirrorThemeClass, svg, iconButton } from './ui';
import { layoutsItem, layoutSaveItem } from './layoutsMenu';
import { alertsBadgeItem } from './alertsChrome';
import { savedFiltersItem } from './savedFiltersToolbar';

export interface TitleBarOptions {
  /** Brand label shown at the far left (e.g. the grid's name). */
  name?: string;
  /** Initial ISO `YYYY-MM-DD` shown in the toolbar date picker. */
  date?: string;
  /** Fired when the user picks a date (ISO `YYYY-MM-DD`). */
  onDateChange?: (iso: string) => void;
  /**
   * When `false`, only today's date is selectable (live data only).
   * Defaults to `true` (any calendar day).
   */
  historyEnabled?: boolean;
}

/** Build the full title-bar extension set. Compose into `ext.extensions`
 *  (removing the default `settings-launcher`/`save` first — this set
 *  supersedes them with the richer bar).
 *
 *  Named views live under **layouts** only — "profile" was the same concept
 *  in MarketsGrid jargon; we do not mount a second switcher. */
export function titleBarExtensions(opts: TitleBarOptions = {}): CgExtension[] {
  injectTitleBarStyles();
  return [
    brandItem(opts.name ?? 'cgrid'),
    savedFiltersItem(),
    searchItem(),
    alertsBadgeItem(),
    layoutsItem(),
    layoutSaveItem(),
    dateItem({
      initial: opts.date ?? todayIsoDate(),
      onDateChange: opts.onDateChange,
      historyEnabled: opts.historyEnabled !== false,
    }),
    overflowItem(),
    settingsItem(),
  ];
}

// ── toolbar date helpers (ISO calendar day, local timezone) ───────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayIsoDate(): string {
  return dateToIso(new Date());
}

function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoToDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

function dateItem(opts: {
  initial: string;
  onDateChange?: (iso: string) => void;
  historyEnabled: boolean;
}): ToolbarItem {
  return item('date', 'primary-right', (host, ctx) => {
    let value = isoToDate(opts.initial) ? opts.initial : todayIsoDate();
    let pop: HTMLElement | null = null;
    let viewYear = 0;
    let viewMonth = 0; // 0-based

    const seedView = (): void => {
      const d = isoToDate(value) ?? new Date();
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
    };
    seedView();

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cgext-date';
    trigger.dataset.testid = 'toolbar-date-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    const paintTrigger = (): void => {
      trigger.setAttribute('aria-label', `Selected date ${value}`);
      trigger.title = `As-of date ${value}`;
      trigger.innerHTML = `${svg(ICON.calendar, 14)}<span class="cgext-date-label">${value || '—'}</span>`;
    };
    paintTrigger();

    const closePop = (): void => {
      if (!pop) return;
      pop.remove();
      pop = null;
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    };

    const onDoc = (e: PointerEvent): void => {
      if (!pop) return;
      const t = e.target as Node;
      if (!pop.contains(t) && !trigger.contains(t)) closePop();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePop();
        trigger.focus();
      }
    };

    const commit = (iso: string): void => {
      if (iso === value) {
        closePop();
        return;
      }
      value = iso;
      paintTrigger();
      opts.onDateChange?.(iso);
      ctx.events.emit({ type: 'date-change', date: iso });
      closePop();
    };

    const paintCalendar = (root: HTMLElement): void => {
      root.replaceChildren();
      const today = new Date();
      const selected = isoToDate(value);

      const head = document.createElement('div');
      head.className = 'cgext-cal-head';
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'cgext-cal-nav';
      prev.setAttribute('aria-label', 'Previous month');
      prev.innerHTML = svg('M15 18l-6-6 6-6', 14);
      prev.addEventListener('click', () => {
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        paintCalendar(root);
      });
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'cgext-cal-nav';
      next.setAttribute('aria-label', 'Next month');
      next.innerHTML = svg('M9 18l6-6-6-6', 14);
      next.addEventListener('click', () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        paintCalendar(root);
      });
      const title = document.createElement('div');
      title.className = 'cgext-cal-title';
      title.textContent = `${MONTH_LABELS[viewMonth]} ${viewYear}`;
      head.append(prev, title, next);
      root.appendChild(head);

      const dow = document.createElement('div');
      dow.className = 'cgext-cal-dow';
      for (const d of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
        const cell = document.createElement('span');
        cell.textContent = d;
        dow.appendChild(cell);
      }
      root.appendChild(dow);

      const grid = document.createElement('div');
      grid.className = 'cgext-cal-grid';
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', `${MONTH_LABELS[viewMonth]} ${viewYear}`);

      const first = new Date(viewYear, viewMonth, 1);
      const startDow = first.getDay(); // 0=Sun
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      for (let i = 0; i < startDow; i++) {
        const empty = document.createElement('span');
        empty.className = 'cgext-cal-day is-empty';
        grid.appendChild(empty);
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(viewYear, viewMonth, day);
        const iso = dateToIso(cellDate);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cgext-cal-day';
        btn.textContent = String(day);
        btn.setAttribute('aria-label', iso);
        if (sameDay(cellDate, today)) btn.classList.add('is-today');
        if (selected && sameDay(cellDate, selected)) {
          btn.classList.add('is-selected');
          btn.setAttribute('aria-pressed', 'true');
        }
        const blocked = !opts.historyEnabled && !sameDay(cellDate, today);
        if (blocked) {
          btn.disabled = true;
          btn.classList.add('is-disabled');
        } else {
          btn.addEventListener('click', () => commit(iso));
        }
        grid.appendChild(btn);
      }
      root.appendChild(grid);

      const foot = document.createElement('div');
      foot.className = 'cgext-cal-foot';
      const todayBtn = document.createElement('button');
      todayBtn.type = 'button';
      todayBtn.className = 'cgext-cal-today';
      todayBtn.textContent = 'Today';
      todayBtn.addEventListener('click', () => commit(todayIsoDate()));
      foot.appendChild(todayBtn);
      root.appendChild(foot);
    };

    const openPop = (): void => {
      if (pop) return;
      seedView();
      pop = document.createElement('div');
      pop.className = 'cgext-date-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Choose date');
      mirrorThemeClass(trigger, pop);
      paintCalendar(pop);
      document.body.appendChild(pop);

      const r = trigger.getBoundingClientRect();
      const margin = 8;
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      let top = Math.round(r.bottom + 6);
      let left = Math.round(r.right - w);
      left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
      if (top + h > window.innerHeight - margin && r.top - 6 - h >= margin) {
        top = Math.round(r.top - 6 - h);
      }
      pop.style.top = `${top}px`;
      pop.style.left = `${left}px`;

      trigger.setAttribute('aria-expanded', 'true');
      // Defer so the opening click doesn't immediately close.
      setTimeout(() => {
        document.addEventListener('pointerdown', onDoc, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    };

    trigger.addEventListener('click', () => {
      if (pop) closePop();
      else openPop();
    });

    host.appendChild(trigger);
    return {
      destroy() {
        closePop();
        host.replaceChildren();
      },
    };
  });
}

function settingsItem(): ToolbarItem {
  // Sliders icon hosts the More menu (Columns / toolbars / theme).
  return item('settings-launcher', 'primary-right', (host, ctx) => {
    const btn = iconButton(ICON.sliders, 'More');
    btn.classList.add('cgext-settings-launcher');
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
      const section = (label: string) => {
        const h = document.createElement('div');
        h.className = 'cgext-menu-section';
        h.textContent = label;
        list.appendChild(h);
      };
      section('View');
      entry(ICON.columns, 'Columns…', () => { try { ctx.grid.openToolPanel?.('columns'); } catch { /* ignore */ } });
      entry(ICON.wand, 'Auto format', () => ctx.events.emit({ type: 'auto-format' }));
      section('Toolbars');
      toggleEntry(ICON.pencil, 'Editing toolbar', 'edit', 'editing');
      toggleEntry(ICON.brush, 'Formatting toolbar', 'format', 'formatting');
      section('Appearance');
      themeEntry();
      return list;
    });
    btn.addEventListener('click', () => m.toggle());
    host.appendChild(btn);
    return { destroy() { m.destroy(); host.replaceChildren(); } };
  });
}

function overflowItem(): ToolbarItem {
  // Ellipsis opens the settings drawer.
  return item('overflow', 'primary-right', (host, ctx) => {
    const btn = iconButton(ICON.more, 'Settings');
    btn.addEventListener('click', () => ctx.events.emit({ type: 'open-settings', id: 'grid-options' }));
    host.appendChild(btn);
    return { destroy() { host.replaceChildren(); } };
  });
}

// ── styles ─────────────────────────────────────────────────────────────────
export function injectTitleBarStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('cgext-titlebar-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'cgext-titlebar-styles';
    document.head.appendChild(style);
  }
  style.textContent = TITLEBAR_CSS;
}

const TITLEBAR_CSS = `
/* Ext chrome token aliases — the ext stylesheets consume tokens the
 * kernel themes don't declare (--cg-accent-color / --cg-primary-color /
 * --cg-muted-fg-color / --cg-control-bg). Derive them from the active
 * theme's own tokens on ANY cg-theme-* class (grid root AND body-mounted
 * popups, which mirror the theme class) so every control follows the theme
 * instead of falling back to per-rule hardcoded colors.
 * Cursor light: primary/accent #2778C1 on #FCFCFC; dark Anysphere: #81A1C1 on #191c22.
 * Fallbacks preserve the pre-token look for unthemed hosts. */
[class*="cg-theme-"] {
  /* Primary fill + on-primary text from theme checkbox/button pair. */
  --cg-primary-color: var(--cg-chrome-accent, #4f9cf9);
  --cg-primary-fg: var(--cg-checkbox-checked-fg, #ffffff);
  --cg-accent-color: var(--cg-chrome-accent, #4f9cf9);
  --cg-accent-fg: var(--cg-checkbox-checked-fg, #ffffff);
  --cg-muted-fg-color: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 62%, transparent);
  --cg-control-bg: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 6%, transparent);
  --cgext-space-1: 4px;
  --cgext-space-2: 8px;
  --cgext-space-3: 12px;
  --cgext-space-4: 16px;
}

.cgext-iconbtn {
  appearance: none;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--cg-radius, 2px);
  background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cgext-iconbtn:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); color: var(--cg-fg-color, #e5e9f0); }
.cgext-iconbtn:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-iconbtn:disabled { opacity: 0.5; cursor: default; }
.cgext-iconbtn:disabled:hover { background: transparent; }

.cgext-brand { display: inline-flex; align-items: center; gap: var(--cgext-space-2); padding-right: var(--cgext-space-1); }
.cgext-brand-name { font-weight: 650; font-size: 14px; letter-spacing: -0.01em; color: var(--cg-fg-color, #e5e9f0); }
.cgext-brand-collapse { width: 28px; height: 28px; }

.cgext-search { display: inline-flex; align-items: center; gap: var(--cgext-space-1); }
.cgext-search-open { background: var(--cg-control-bg, rgba(255,255,255,0.05)); border-radius: var(--cg-radius, 2px); padding-left: 2px; }
.cgext-search-input {
  width: 260px; height: 30px; padding: 0 var(--cgext-space-3);
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 2px);
  background: var(--cg-control-bg, rgba(0,0,0,0.25));
  color: var(--cg-fg-color, #e5e9f0); font: inherit;
}
.cgext-search-input:focus { outline: none; border-color: var(--cg-accent-color, #4f9cf9); }

/* Shared named-picker chrome: profiles (user) vs layouts (grid). */
.cgext-pill {
  display: inline-flex; align-items: center; gap: 7px;
  height: 32px; padding: 0 10px 0 6px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 2px);
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.cgext-pill:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-pill-icon {
  width: 20px; height: 20px; border-radius: var(--cg-radius, 2px);
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--cg-muted-fg-color, #9aa4b6) 18%, transparent);
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-profile-avatar {
  width: 20px; height: 20px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 22%, transparent);
  color: var(--cg-accent-color, #4f9cf9);
}
.cgext-pill-name, .cgext-profile-name { font-weight: 550; font-size: 12.5px; }
.cgext-pill-caret { color: var(--cg-muted-fg-color, #9aa4b6); display: inline-flex; }

.cgext-save.is-dirty {
  color: var(--cg-warning-color, #e0b341);
}
.cgext-settings-launcher.cgext-iconbtn { color: var(--cg-accent-color, #4f9cf9); }

.cgext-date {
  appearance: none;
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 var(--cgext-space-3);
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 2px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12.5px;
  font-variant-numeric: tabular-nums; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.cgext-date:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-date:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-date svg { color: var(--cg-muted-fg-color, #9aa4b6); flex: 0 0 auto; }
.cgext-date-label { font-weight: 550; }

.cgext-date-pop {
  position: fixed; z-index: 70;
  width: 268px; padding: 10px;
  background: var(--cg-popup-bg, #171c26);
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 2px);
  box-shadow: 0 14px 36px rgba(0,0,0,0.42);
  color: var(--cg-fg-color, #e5e9f0);
  font: 12.5px/1.3 var(--cg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
.cgext-cal-head {
  display: grid; grid-template-columns: 28px 1fr 28px; align-items: center;
  gap: 4px; margin-bottom: 8px;
}
.cgext-cal-title {
  text-align: center; font-weight: 650; font-size: 13px; letter-spacing: -0.01em;
}
.cgext-cal-nav {
  appearance: none; width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--cg-radius, 2px);
  background: transparent; color: var(--cg-muted-fg-color, #9aa4b6); cursor: pointer;
}
.cgext-cal-nav:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.07)); color: var(--cg-fg-color, #e5e9f0); }
.cgext-cal-dow {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px;
}
.cgext-cal-dow > span {
  text-align: center; font-size: 10px; font-weight: 650; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--cg-muted-fg-color, #9aa4b6); padding: 4px 0;
}
.cgext-cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
}
.cgext-cal-day {
  appearance: none; height: 30px; padding: 0;
  border: none; border-radius: var(--cg-radius, 2px);
  background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.cgext-cal-day.is-empty { visibility: hidden; pointer-events: none; }
.cgext-cal-day:hover:not(:disabled) { background: var(--cg-row-alt-bg, rgba(255,255,255,0.07)); }
.cgext-cal-day.is-today { box-shadow: inset 0 0 0 1px var(--cg-accent-color, #4f9cf9); }
.cgext-cal-day.is-selected {
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 22%, transparent);
  color: var(--cg-accent-color, #4f9cf9); font-weight: 650;
}
.cgext-cal-day.is-disabled, .cgext-cal-day:disabled {
  opacity: 0.35; cursor: default;
}
.cgext-cal-foot {
  display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 85%, transparent);
}
.cgext-cal-today {
  appearance: none; border: none; background: transparent; cursor: pointer;
  color: var(--cg-accent-color, #4f9cf9); font: inherit; font-weight: 550; font-size: 12px;
  padding: 4px 6px; border-radius: var(--cg-radius, 2px);
}
.cgext-cal-today:hover { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent); }

/* Right cluster: breathing room + hairline before utility icons. */
.cgext-titlebar > .cgext-slot-primary-right {
  gap: var(--cgext-space-1);
  padding-left: var(--cgext-space-3);
  margin-left: var(--cgext-space-2);
  border-left: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 85%, transparent);
}

.cgext-menu {
  position: fixed; z-index: 60; min-width: 220px;
  top: var(--cgext-menu-top, 0);
  left: var(--cgext-menu-left, 0);
  padding: var(--cgext-space-2);
  background: var(--cg-popup-bg, #171c26);
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 2px);
  box-shadow: 0 14px 36px rgba(0,0,0,0.42);
  color: var(--cg-fg-color, #e5e9f0);
  font: 13px/1.35 var(--cg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
.cgext-menu-list { display: flex; flex-direction: column; gap: 1px; }
.cgext-menu-section {
  margin: var(--cgext-space-2) var(--cgext-space-1) var(--cgext-space-1);
  padding: 0 2px;
  font-size: 10.5px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-menu-section:first-child { margin-top: 2px; }
.cgext-menu-item {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center; column-gap: 10px;
  min-height: 34px;
  padding: 0 10px; border: none; border-radius: var(--cg-radius, 2px);
  background: transparent; color: inherit; font: inherit; font-weight: 500; text-align: left;
  cursor: pointer;
}
.cgext-menu-item:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.07)); }
.cgext-menu-item > svg:first-child {
  width: 15px; height: 15px; justify-self: center;
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-menu-item > span:nth-child(2) { min-width: 0; }
.cgext-menu-item.is-active { color: var(--cg-accent-color, #4f9cf9); }
.cgext-menu-item.is-active > svg:first-child { color: var(--cg-accent-color, #4f9cf9); }
.cgext-menu-item.is-active { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 10%, transparent); }
.cgext-menu-check {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; color: var(--cg-accent-color, #4f9cf9);
}
.cgext-menu-sep { height: 1px; margin: 6px 6px; background: var(--cg-border-color, #2a3140); }
`;