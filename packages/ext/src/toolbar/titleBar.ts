/**
 * Title-bar chrome for VelocityGridExt — the slim always-on primary toolbar that
 * matches the MarketsGrid reference: brand + filter-pill collapse on the left,
 * an expandable search in the center, and a right cluster of notifications,
 * layout switcher + dirty-aware layout save, date, settings launcher,
 * and an overflow menu.
 *
 * "Profile" and "layout" are the same trader concept here — only the
 * layouts control is mounted (kernel named views).
 *
 * Every item is a `toolbar-item` extension in a `primary-*` slot; all colour
 * comes from the grid's `--vg-*` theme tokens (VelocityGridExt mirrors the theme
 * class onto the shell root) with a neutral dark fallback, so the bar reads
 * as one surface with the grid. Icons are inline single-path SVG (Lucide
 * geometry) — no external asset, crisp at any DPI.
 */
import type { VelocityGridExtension, VelocityGridExtContext, ToolbarItem, ToolbarItemInstance } from '../extension/types';
import { menu, mirrorThemeClass, svg, iconButton } from './ui';
import { layoutsItem, layoutSaveItem } from './layoutsMenu';
import { alertsBadgeItem } from './alertsChrome';
import { savedFiltersItem } from './savedFiltersToolbar';
import { runAutoFormat, type AutoFormatGrid } from './autoFormat';

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
export function titleBarExtensions(opts: TitleBarOptions = {}): VelocityGridExtension[] {
  injectTitleBarStyles();
  return [
    brandItem(opts.name ?? 'VelocityGrid'),
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
  chevronsRight: 'M13 17l5-5-5-5M6 17l5-5-5-5',
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
  render: (host: HTMLElement, ctx: VelocityGridExtContext) => ToolbarItemInstance,
): ToolbarItem {
  return { id, kind: 'toolbar-item', slot, init() {}, render };
}

function brandItem(name: string): ToolbarItem {
  return item('brand', 'primary-left', (host) => {
    const wrap = document.createElement('div');
    wrap.className = 'vgext-brand';
    const label = document.createElement('span');
    label.className = 'vgext-brand-name';
    label.textContent = name;
    // `<<` collapses the saved-filter pill strip beside the brand (not the
    // editing/formatting toolbars — those toggle from More → Toolbars).
    const collapse = iconButton(ICON.chevronsLeft, 'Hide filter pills');
    collapse.classList.add('vgext-brand-collapse');

    const filterPills = (): HTMLElement | null => {
      const root = host.closest('.vgext-root') ?? document;
      return root.querySelector<HTMLElement>('[data-testid="vgext-saved-filters"]');
    };

    const paint = (): void => {
      const sf = filterPills();
      const hidden = !!sf?.hidden;
      collapse.innerHTML = svg(hidden ? ICON.chevronsRight : ICON.chevronsLeft);
      const title = !sf
        ? 'Filter pills unavailable'
        : hidden
          ? 'Show filter pills'
          : 'Hide filter pills';
      collapse.title = title;
      collapse.setAttribute('aria-label', title);
      collapse.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      collapse.disabled = !sf;
      collapse.classList.toggle('is-collapsed', hidden);
    };

    collapse.addEventListener('click', () => {
      const sf = filterPills();
      if (!sf) return;
      sf.hidden = !sf.hidden;
      paint();
    });
    wrap.append(label, collapse);
    host.appendChild(wrap);
    // Saved-filters mounts in the same slot after brand — paint once it's in.
    queueMicrotask(paint);
    return { destroy() { host.replaceChildren(); } };
  });
}

function searchItem(): ToolbarItem {
  // Sit in the right cluster immediately before the alerts badge so search
  // and bell are adjacent (not split by the center slot / right-cluster rule).
  return item('search', 'primary-right', (host, ctx) => {
    const wrap = document.createElement('div');
    wrap.className = 'vgext-search';
    const btn = iconButton(ICON.search, 'Search grid');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'vgext-search-input';
    input.placeholder = 'Search grid…';
    input.hidden = true;
    const expand = (on: boolean) => {
      input.hidden = !on;
      wrap.classList.toggle('vgext-search-open', on);
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
    trigger.className = 'vgext-date';
    trigger.dataset.testid = 'toolbar-date-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    const paintTrigger = (): void => {
      trigger.setAttribute('aria-label', `Selected date ${value}`);
      trigger.title = `As-of date ${value}`;
      trigger.innerHTML = `${svg(ICON.calendar, 14)}<span class="vgext-date-label">${value || '—'}</span>`;
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
      head.className = 'vgext-cal-head';
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'vgext-cal-nav';
      prev.setAttribute('aria-label', 'Previous month');
      prev.innerHTML = svg('M15 18l-6-6 6-6', 14);
      prev.addEventListener('click', () => {
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        paintCalendar(root);
      });
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'vgext-cal-nav';
      next.setAttribute('aria-label', 'Next month');
      next.innerHTML = svg('M9 18l6-6-6-6', 14);
      next.addEventListener('click', () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        paintCalendar(root);
      });
      const title = document.createElement('div');
      title.className = 'vgext-cal-title';
      title.textContent = `${MONTH_LABELS[viewMonth]} ${viewYear}`;
      head.append(prev, title, next);
      root.appendChild(head);

      const dow = document.createElement('div');
      dow.className = 'vgext-cal-dow';
      for (const d of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
        const cell = document.createElement('span');
        cell.textContent = d;
        dow.appendChild(cell);
      }
      root.appendChild(dow);

      const grid = document.createElement('div');
      grid.className = 'vgext-cal-grid';
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', `${MONTH_LABELS[viewMonth]} ${viewYear}`);

      const first = new Date(viewYear, viewMonth, 1);
      const startDow = first.getDay(); // 0=Sun
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      for (let i = 0; i < startDow; i++) {
        const empty = document.createElement('span');
        empty.className = 'vgext-cal-day is-empty';
        grid.appendChild(empty);
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(viewYear, viewMonth, day);
        const iso = dateToIso(cellDate);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vgext-cal-day';
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
      foot.className = 'vgext-cal-foot';
      const todayBtn = document.createElement('button');
      todayBtn.type = 'button';
      todayBtn.className = 'vgext-cal-today';
      todayBtn.textContent = 'Today';
      todayBtn.addEventListener('click', () => commit(todayIsoDate()));
      foot.appendChild(todayBtn);
      root.appendChild(foot);
    };

    const openPop = (): void => {
      if (pop) return;
      seedView();
      pop = document.createElement('div');
      pop.className = 'vgext-date-pop';
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
    btn.classList.add('vgext-settings-launcher');
    const offAutoFormat = ctx.events.on('auto-format', () => {
      runAutoFormat({
        grid: ctx.grid as unknown as AutoFormatGrid,
        profiles: ctx.profiles,
      });
    });
    const m = menu(btn, (close) => {
      const list = document.createElement('div');
      list.className = 'vgext-menu-list';
      const entry = (icon: string, text: string, onClick: () => void) => {
        const it = document.createElement('button');
        it.type = 'button';
        it.className = 'vgext-menu-item';
        it.innerHTML = `${svg(icon, 15)}<span>${text}</span>`;
        it.addEventListener('click', () => { onClick(); close(); });
        list.appendChild(it);
      };
      // A checkable toggle for a sub-toolbar: reflects the live ribbon DOM
      // state, stays open, and repaints its checkmark on each toggle.
      const toggleEntry = (icon: string, text: string, section: string, toolbar: string) => {
        const strip = () => document.querySelector<HTMLElement>(`.vgext-ribbon [data-toolbar="${toolbar}"]`);
        const it = document.createElement('button');
        it.type = 'button';
        const paint = () => {
          const on = !!strip() && !strip()!.hidden;
          it.className = 'vgext-menu-item vgext-menu-toggle' + (on ? ' is-active' : '');
          it.innerHTML = `${svg(icon, 15)}<span>${text}</span><span class="vgext-menu-check">${on ? svg('M20 6L9 17l-5-5', 13) : ''}</span>`;
        };
        paint();
        it.addEventListener('click', () => { ctx.events.emit({ type: 'toggle-ribbon', section }); paint(); });
        list.appendChild(it);
      };
      // Dark-theme toggle. Every built-in theme ships as a light/dark pair
      // sharing a class stem (`vg-theme-starui[-dark]`, `vg-theme-quartz[-dark]`,
      // …), so flipping the `-dark` suffix swaps mode while preserving the
      // family. The new class goes to BOTH the kernel (setTheme repaints the
      // canvas) and the shell root, which mirrors the theme class so the
      // chrome's `--vg-*` tokens track the grid (see VelocityGridExt constructor).
      const themeEntry = () => {
        const root = host.closest<HTMLElement>('.vgext-root');
        const current = () =>
          (root && Array.from(root.classList).find((c) => c.startsWith('vg-theme-'))) || 'vg-theme-quartz';
        const it = document.createElement('button');
        it.type = 'button';
        const paint = () => {
          const dark = current().endsWith('-dark');
          it.className = 'vgext-menu-item vgext-menu-toggle' + (dark ? ' is-active' : '');
          it.innerHTML = `${svg(ICON.moon, 15)}<span>Dark theme</span><span class="vgext-menu-check">${dark ? svg('M20 6L9 17l-5-5', 13) : ''}</span>`;
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
        h.className = 'vgext-menu-section';
        h.textContent = label;
        list.appendChild(h);
      };
      section('View');
      entry(ICON.columns, 'Columns…', () => { try { ctx.grid.openToolPanel?.('columns'); } catch { /* ignore */ } });
      entry(ICON.wand, 'Auto format', () => ctx.events.emit({ type: 'auto-format' }));
      section('Configure');
      entry(ICON.brush, 'Column format…', () => ctx.events.emit({ type: 'open-settings', id: 'column-settings' }));
      entry(ICON.pencil, 'Smart edit…', () => ctx.events.emit({ type: 'open-settings', id: 'smart-edit' }));
      entry(ICON.sliders, 'Conditional styling…', () => ctx.events.emit({ type: 'open-settings', id: 'conditional-styling' }));
      entry(ICON.sliders, 'Grid options…', () => ctx.events.emit({ type: 'open-settings', id: 'grid-options' }));
      section('Toolbars');
      toggleEntry(ICON.pencil, 'Editing toolbar', 'edit', 'editing');
      toggleEntry(ICON.brush, 'Formatting toolbar', 'format', 'formatting');
      section('Appearance');
      themeEntry();
      return list;
    });
    btn.addEventListener('click', () => m.toggle());
    host.appendChild(btn);
    return {
      destroy() {
        offAutoFormat();
        m.destroy();
        host.replaceChildren();
      },
    };
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
  let style = document.getElementById('vgext-titlebar-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'vgext-titlebar-styles';
    document.head.appendChild(style);
  }
  style.textContent = TITLEBAR_CSS;
}

const TITLEBAR_CSS = `
/* Ext chrome token aliases — the ext stylesheets consume tokens the
 * kernel themes don't declare (--vg-accent-color / --vg-primary-color /
 * --vg-muted-fg-color / --vg-control-bg). Derive them from the active
 * theme's own tokens on ANY vg-theme-* class (grid root AND body-mounted
 * popups, which mirror the theme class) so every control follows the theme
 * instead of falling back to per-rule hardcoded colors.
 * Cursor light: primary/accent #2778C1 on #FCFCFC; dark Anysphere: #81A1C1 on #191c22.
 * Fallbacks preserve the pre-token look for unthemed hosts. */
[class*="vg-theme-"] {
  /* Primary fill + on-primary text from theme checkbox/button pair. */
  --vg-primary-color: var(--vg-chrome-accent, #4f9cf9);
  --vg-primary-fg: var(--vg-checkbox-checked-fg, #ffffff);
  --vg-accent-color: var(--vg-chrome-accent, #4f9cf9);
  --vg-accent-fg: var(--vg-checkbox-checked-fg, #ffffff);
  --vg-muted-fg-color: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 62%, transparent);
  --vg-control-bg: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 6%, transparent);
  --vgext-space-1: 4px;
  --vgext-space-2: 8px;
  --vgext-space-3: 12px;
  --vgext-space-4: 16px;
}

.vgext-iconbtn {
  appearance: none;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--vg-radius, 2px);
  background: transparent;
  color: var(--vg-muted-fg-color, #9aa4b6);
  cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}
.vgext-iconbtn:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.06)); color: var(--vg-fg-color, #e5e9f0); }
.vgext-iconbtn:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: 1px; }
.vgext-iconbtn:disabled { opacity: 0.5; cursor: default; }
.vgext-iconbtn:disabled:hover { background: transparent; }

.vgext-brand { display: inline-flex; align-items: center; gap: var(--vgext-space-2); padding-right: var(--vgext-space-1); }
.vgext-brand-name { font-weight: 650; font-size: 14px; letter-spacing: -0.01em; color: var(--vg-fg-color, #e5e9f0); }
.vgext-brand-collapse { width: 28px; height: 28px; }
.vgext-brand-collapse.is-collapsed { color: var(--vg-accent-color, #4f9cf9); }

.vgext-search { display: inline-flex; align-items: center; gap: var(--vgext-space-1); }
.vgext-search-open { background: var(--vg-control-bg, rgba(255,255,255,0.05)); border-radius: var(--vg-radius, 2px); padding-left: 2px; }
.vgext-search-input {
  width: 260px; height: 30px; padding: 0 var(--vgext-space-3);
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 2px);
  background: var(--vg-control-bg, rgba(0,0,0,0.25));
  color: var(--vg-fg-color, #e5e9f0); font: inherit;
}
.vgext-search-input:focus { outline: none; border-color: var(--vg-accent-color, #4f9cf9); }

/* Shared named-picker chrome: profiles (user) vs layouts (grid). */
.vgext-pill {
  display: inline-flex; align-items: center; gap: 7px;
  height: 32px; padding: 0 10px 0 6px;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 2px);
  background: var(--vg-control-bg, rgba(255,255,255,0.04));
  color: var(--vg-fg-color, #e5e9f0); font: inherit; cursor: pointer;
  transition: border-color 110ms ease, background 110ms ease;
}
.vgext-pill:hover { border-color: var(--vg-accent-color, #4f9cf9); }
.vgext-pill-icon {
  width: 20px; height: 20px; border-radius: var(--vg-radius, 2px);
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--vg-muted-fg-color, #9aa4b6) 18%, transparent);
  color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-profile-avatar {
  width: 20px; height: 20px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 22%, transparent);
  color: var(--vg-accent-color, #4f9cf9);
}
.vgext-pill-name, .vgext-profile-name { font-weight: 550; font-size: 12.5px; }
.vgext-pill-caret { color: var(--vg-muted-fg-color, #9aa4b6); display: inline-flex; }

/* Layout selector stays a fixed footprint so a growing filter-pill
 * strip (or a long layout name) cannot stretch or squeeze it. */
.vgext-titlebar > .vgext-slot-primary-right > .vgext-toolbar-item[data-item-id="layouts"] {
  flex: 0 0 auto;
}
.vgext-layouts-trigger {
  box-sizing: border-box;
  width: 180px;
  min-width: 180px;
  max-width: 180px;
  flex: 0 0 180px;
}
.vgext-layouts-trigger .vgext-pill-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.vgext-save.is-dirty {
  color: var(--vg-warning-color, #e0b341);
}
.vgext-settings-launcher.vgext-iconbtn { color: var(--vg-accent-color, #4f9cf9); }

.vgext-date {
  appearance: none;
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 var(--vgext-space-3);
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: 2px;
  background: var(--vg-control-bg, rgba(255,255,255,0.04));
  color: var(--vg-fg-color, #e5e9f0); font: inherit; font-size: 12.5px;
  font-variant-numeric: tabular-nums; cursor: pointer;
  transition: border-color 110ms ease, background 110ms ease;
}
.vgext-date:hover { border-color: var(--vg-accent-color, #4f9cf9); }
.vgext-date:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: 1px; }
.vgext-date svg { color: var(--vg-muted-fg-color, #9aa4b6); flex: 0 0 auto; }
.vgext-date-label { font-weight: 550; }

.vgext-date-pop {
  position: fixed; z-index: 70;
  width: 268px; padding: 10px;
  background: var(--vg-popup-bg, #171c26);
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 2px);
  box-shadow: 0 14px 36px rgba(0,0,0,0.42);
  color: var(--vg-fg-color, #e5e9f0);
  font: 12.5px/1.3 var(--vg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
.vgext-cal-head {
  display: grid; grid-template-columns: 28px 1fr 28px; align-items: center;
  gap: 4px; margin-bottom: 8px;
}
.vgext-cal-title {
  text-align: center; font-weight: 650; font-size: 13px; letter-spacing: -0.01em;
}
.vgext-cal-nav {
  appearance: none; width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--vg-radius, 2px);
  background: transparent; color: var(--vg-muted-fg-color, #9aa4b6); cursor: pointer;
}
.vgext-cal-nav:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.07)); color: var(--vg-fg-color, #e5e9f0); }
.vgext-cal-dow {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px;
}
.vgext-cal-dow > span {
  text-align: center; font-size: 10px; font-weight: 650; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--vg-muted-fg-color, #9aa4b6); padding: 4px 0;
}
.vgext-cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
}
.vgext-cal-day {
  appearance: none; height: 30px; padding: 0;
  border: none; border-radius: var(--vg-radius, 2px);
  background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.vgext-cal-day.is-empty { visibility: hidden; pointer-events: none; }
.vgext-cal-day:hover:not(:disabled) { background: var(--vg-row-alt-bg, rgba(255,255,255,0.07)); }
.vgext-cal-day.is-today { box-shadow: inset 0 0 0 1px var(--vg-accent-color, #4f9cf9); }
.vgext-cal-day.is-selected {
  background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 22%, transparent);
  color: var(--vg-accent-color, #4f9cf9); font-weight: 650;
}
.vgext-cal-day.is-disabled, .vgext-cal-day:disabled {
  opacity: 0.35; cursor: default;
}
.vgext-cal-foot {
  display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
}
.vgext-cal-today {
  appearance: none; border: none; background: transparent; cursor: pointer;
  color: var(--vg-accent-color, #4f9cf9); font: inherit; font-weight: 550; font-size: 12px;
  padding: 4px 6px; border-radius: var(--vg-radius, 2px);
}
.vgext-cal-today:hover { background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 12%, transparent); }

/* Right cluster: search sits flush with the left side; hairline separates
   search from the alerts / layouts / date utilities that follow.
   Shell styles own flex-wrap / sizing so this strip can drop to a second
   row instead of colliding with the filter-pill strip. */
.vgext-titlebar > .vgext-slot-primary-right {
  gap: var(--vgext-space-1);
  margin-left: auto;
}
.vgext-titlebar > .vgext-slot-primary-right > .vgext-toolbar-item[data-item-id="notifications"] {
  margin-left: var(--vgext-space-2);
  padding-left: var(--vgext-space-3);
  border-left: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
}

.vgext-menu {
  position: fixed; z-index: 1100; min-width: 220px;
  top: var(--vgext-menu-top, 0);
  left: var(--vgext-menu-left, 0);
  padding: var(--vgext-space-2);
  background: var(--vg-popup-bg, #171c26);
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 2px);
  box-shadow: 0 14px 36px rgba(0,0,0,0.42);
  color: var(--vg-fg-color, #e5e9f0);
  font: 13px/1.35 var(--vg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
.vgext-menu-list { display: flex; flex-direction: column; gap: 1px; }
.vgext-menu-section {
  margin: var(--vgext-space-2) var(--vgext-space-1) var(--vgext-space-1);
  padding: 0 2px;
  font-size: 10.5px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-menu-section:first-child { margin-top: 2px; }
.vgext-menu-item {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center; column-gap: 10px;
  min-height: 34px;
  padding: 0 10px; border: none; border-radius: var(--vg-radius, 2px);
  background: transparent; color: inherit; font: inherit; font-weight: 500; text-align: left;
  cursor: pointer;
}
.vgext-menu-item:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.07)); }
.vgext-menu-item > svg:first-child {
  width: 15px; height: 15px; justify-self: center;
  color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-menu-item > span:nth-child(2) { min-width: 0; }
.vgext-menu-item.is-active { color: var(--vg-accent-color, #4f9cf9); }
.vgext-menu-item.is-active > svg:first-child { color: var(--vg-accent-color, #4f9cf9); }
.vgext-menu-item.is-active { background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 10%, transparent); }
.vgext-menu-check {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; color: var(--vg-accent-color, #4f9cf9);
}
.vgext-menu-sep { height: 1px; margin: 6px 6px; background: var(--vg-border-color, #2a3140); }
`;