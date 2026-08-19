/**
 * Formatting / editing toolbars for VelocityGridExt. Two single-row strips
 * in the shell's `.vgext-ribbon` host, with labelled segments and `⋯`
 * overflow when space is tight:
 *
 *   Editing:    HISTORY · SMART · BULK
 *   Formatting: Target · Font · Format · Align · Borders · Icons · Column · Templates · Clear · …
 *
 * Colour comes entirely from the grid's `--vg-*` theme tokens. Toggle
 * visibility via the `toggle-ribbon` ext event (title-bar More menu).
 */
import type { VelocityGridExtension, VelocityGridExtContext, ToolbarItem, ToolbarItemInstance, Unsub } from '../extension/types';
import { menu, mirrorThemeClass } from './ui';
import { injectTitleBarStyles } from './titleBar';
import type { EditBridgeHandle, SmartEditOp } from '@wellsfargo-starui/velocity-grid-edit';
import { createIconPicker, type IconPickerHandle, type IconSelection } from './iconPicker';
import { formatPickerMenu, type FormatPickerHost } from './formatPicker';
import { adjustFormatDecimals, findPresetByFormat, type FormatDataType } from './formatPresets';
import { columnPanelMenu, effectiveFlag, aggFuncChoices, type ColumnConfigGrid, type ColumnPanelHost } from './columnPanel';
import {
  activeLibraryTemplateId,
  libraryTemplates,
  templateManagerMenu,
  type TemplateManagerGrid,
  type TemplateManagerHost,
} from './templateManager';
import { createFormatHistory, type FormatHistoryGrid } from './formatHistory';
import { isOwnTemplateId } from '@wellsfargo-starui/velocity-grid-calc';
import {
  ribbonColorSwatch,
  syncRibbonColor,
  type RibbonColorSwatch,
} from './colorSwatch';
import { wireRibbonOverflow } from './ribbonOverflow';
import { lucideBundle } from '@wellsfargo-starui/velocity-grid/icons/lucide.generated';

/** Floating-filter type choices — same vocabulary as the Column popover's
 *  Filter type segment (`auto` clears to kernel default via `filter: null`). */
const FILTER_TYPE_OPTIONS = [
  { v: 'auto', text: 'Auto', menu: 'Auto' },
  { v: 'text', text: 'Text', menu: 'Text' },
  { v: 'number', text: 'Num', menu: 'Number' },
  { v: 'date', text: 'Date', menu: 'Date' },
  { v: 'set', text: 'Set', menu: 'Set' },
] as const;

/** Lazily supplies the `@wellsfargo-starui/velocity-grid-edit` handle — the demo/consumer wires the
 *  edit engine after the grid is constructed, so the ribbon reads it on
 *  demand rather than capturing it at build time. */
export type EditHandleGetter = () => EditBridgeHandle | undefined;

const I = {
  undo: lucideBundle['undo-2']!,
  redo: lucideBundle['redo-2']!,
  cursor: 'M3 3l7.07 17 2.51-7.39L20 10.06z',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  rows: 'M3 3h18v18H3zM3 9h18M3 15h18',
  range: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z',
  italic: 'M19 4h-9M14 20H5M15 4L9 20',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 21h16',
  strikethrough: 'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  alignLeft: 'M17 10H3M21 6H3M21 14H3M17 18H3',
  alignCenter: 'M18 10H6M21 6H3M21 14H3M18 18H6',
  alignRight: 'M21 10H7M21 6H3M21 14H3M21 18H7',
  paintText: 'M4 20h16M6 16l4-11 4 11M7.5 13h5',
  fill: 'M19 11l-8-8-8.5 8.5a2 2 0 0 0 0 3L8 20a2 2 0 0 0 3 0l8-8zM2 20h20',
  selection: 'M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3',
  close: 'M18 6L6 18M6 6l12 12',
  dollar: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  percent: 'M19 5L5 19M6.5 6.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M17.5 17.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
  columns: 'M3 3h18v18H3zM9 3v18M15 3v18',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54z',
  filterOff: 'M22 3H2l8 9.46V19l4 2v-4M2 2l20 20',
  agg: 'M4 4h16v4H4zM4 10h10v4H4zM4 16h6v4H4z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 14H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6h.09A1.65 1.65 0 0 0 12 3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 19 4.6l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 11h.1a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.6 1z',
  templates: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  eraser: 'M7 21h13M5 13l6 6M20 8l-9 9-6-6 9-9a2.8 2.8 0 0 1 4 0l2 2a2.8 2.8 0 0 1 0 4z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  /** Solid dots — Lucide's h.01 ellipsis reads as nearly invisible at 14px. */
  more: 'M5 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M19 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
};

function svg(path: string, size = 14): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

/** Compact two-state icon toggle: shows the ACTIVE state's icon only;
 *  tooltip carries the label + "click to switch". Used for Cells↔Header
 *  and Selected↔All so the Target cluster stays toolbar-width, not a
 *  third of the strip. */
function stateToggle(opts: {
  rb: string;
  a: { icon: string; label: string };
  b: { icon: string; label: string };
  title: (isA: boolean) => string;
}): { el: HTMLButtonElement; paint: (isA: boolean) => void } {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'vgext-rb-targettoggle';
  el.dataset.rb = opts.rb;
  const paint = (isA: boolean): void => {
    const s = isA ? opts.a : opts.b;
    el.innerHTML = svg(s.icon, 14);
    const title = opts.title(isA);
    el.title = title;
    el.setAttribute('aria-label', title);
    el.setAttribute('aria-pressed', String(!isA));
    el.classList.toggle('is-header', !isA);
  };
  return { el, paint };
}

export interface RibbonExtensionsOpts {
  edit?: EditHandleGetter;
  /** Start with the formatting strip hidden (toggle via More → Formatting toolbar). */
  formatHidden?: boolean;
  /** Start with the editing strip hidden (toggle via More → Editing toolbar). */
  editHidden?: boolean;
}

/** Build the ribbon extension (one item at `ribbon.main`). Compose into
 *  `ext.extensions`. Toggle visibility via the `toggle-ribbon` ext event. */
export function ribbonExtensions(opts: RibbonExtensionsOpts = {}): VelocityGridExtension[] {
  injectRibbonStyles();
  return [ribbonItem(opts)];
}

// ── small builders ──────────────────────────────────────────────────────
function h(cls: string, html?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
}
function iconBtn(icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'vgext-rb-btn'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = svg(icon);
  return b;
}

/** Labeled dropdown trigger (Borders / Column) — same chrome as icon picker. */
function dropdownBtn(icon: string, label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'vgext-ip-open';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML =
    `${svg(icon, 14)}<span>${label}</span>` +
    '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  return b;
}

/**
 * Flyout that keeps a persistent content node alive across open/close so
 * ribbon control wiring (borders, icon tools) is not rebuilt each time.
 * Nested popovers (color picker, icon panel, `.vgext-menu`) do not dismiss it.
 */
function persistentFlyout(
  anchor: HTMLButtonElement,
  content: HTMLElement,
  opts?: { preferWidth?: number },
): { toggle: () => void; destroy: () => void } {
  const stash = document.createElement('div');
  stash.className = 'vgext-rb-flyout-stash';
  stash.hidden = true;
  stash.appendChild(content);
  let panel: HTMLElement | null = null;

  const close = (): void => {
    if (!panel) return;
    stash.appendChild(content);
    panel.remove();
    panel = null;
    document.removeEventListener('pointerdown', onDoc, true);
    anchor.classList.remove('is-open');
    anchor.setAttribute('aria-expanded', 'false');
  };

  const onDoc = (e: PointerEvent): void => {
    if (!panel) return;
    const t = e.target as Node;
    if (panel.contains(t) || anchor.contains(t)) return;
    const el = t instanceof Element ? t : t.parentElement;
    if (el?.closest('.vgext-menu, .vg-colorpicker, .vgext-ip-panel, .vg-popup')) return;
    close();
  };

  const open = (): void => {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'vgext-menu vgext-rb-tool-flyout';
    mirrorThemeClass(anchor, panel);
    panel.appendChild(content);
    document.body.appendChild(panel);

    const margin = 8;
    const prefer = opts?.preferWidth ?? 300;
    const width = Math.min(prefer, window.innerWidth - margin * 2);
    panel.style.width = `${width}px`;
    const r = anchor.getBoundingClientRect();
    let left = Math.round(r.left);
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = Math.round(r.bottom + 4);
    const h = panel.offsetHeight;
    if (top + h > window.innerHeight - margin && r.top - 4 - h >= margin) {
      top = Math.round(r.top - 4 - h);
    }
    panel.style.setProperty('--vgext-menu-top', `${top}px`);
    panel.style.setProperty('--vgext-menu-left', `${left}px`);
    document.addEventListener('pointerdown', onDoc, true);
    anchor.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
  };

  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-expanded', 'false');
  const onClick = (): void => { if (panel) close(); else open(); };
  anchor.addEventListener('click', onClick);

  return {
    toggle: () => { if (panel) close(); else open(); },
    destroy: () => {
      close();
      anchor.removeEventListener('click', onClick);
      stash.remove();
    },
  };
}
/** Excel-style increase/decrease-decimal glyphs — composite two-row icons
 *  (digits in the icon colour + an accent arrow), not single Lucide paths:
 *  fewer = "←0 / .00", more = ".00 / →0". Text inherits the ribbon font. */
function decimalIcon(kind: 'fewer' | 'more'): string {
  // 18-unit grid: the ribbon lays every icon into a 12px content box scaled
  // by 12/viewBox, so the tighter box (vs the stock 24) is what makes these
  // two-row glyphs read at the same optical size as their siblings.
  const digit = (x: number, y: number, s: string) =>
    `<text x="${x}" y="${y}" fill="currentColor" font-size="10" font-weight="700">${s}</text>`;
  const arrow = (d: string) =>
    `<path d="${d}" fill="none" stroke="var(--vg-chrome-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const rows = kind === 'fewer'
    ? arrow('M9.5 4H1.5M4.5 1l-3 3 3 3') + digit(11.5, 7.5, '0') + digit(0.5, 17.5, '.00')
    : digit(0.5, 7.5, '.00') + arrow('M1.5 14h8M6.5 11l3 3-3 3') + digit(11.5, 17.5, '0');
  return `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">${rows}</svg>`;
}
function decimalBtn(kind: 'fewer' | 'more', title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'vgext-rb-btn'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = decimalIcon(kind);
  return b;
}
function toggleBtn(icon: string, title: string): HTMLButtonElement {
  const b = iconBtn(icon, title); b.classList.add('vgext-rb-toggle'); return b;
}
function pill(text: string, caret = true): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'vgext-rb-pill';
  b.innerHTML = `<span>${text}</span>` + (caret ? svg('M6 9l6 6 6-6', 12) : '');
  return b;
}
function textInput(placeholder: string, size: 'sm' | 'md' = 'sm'): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text'; i.className = `vgext-rb-input vgext-rb-input--${size}`; i.placeholder = placeholder;
  return i;
}
// Colour-picker defaults — the swatch a picker shows when the focused
// column has NO explicit colour of its own (refresh() reverts to these).
// Text + border track the theme foreground (not the chrome accent).
const DEFAULT_FILL_COLOR = '#12333a';

/** Resolve a `--vg-*` color token to a `#rrggbb` the native color input can hold. */
function themeColorHex(token: string, fallback: string, anchor?: HTMLElement | null): string {
  try {
    const root =
      anchor?.closest<HTMLElement>('.vgext-root')
      ?? document.querySelector<HTMLElement>('.vgext-root')
      ?? document.body;
    const raw = getComputedStyle(root).getPropertyValue(token).trim() || fallback;
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      const r = raw[1]!, g = raw[2]!, b = raw[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    const probe = document.createElement('div');
    probe.style.color = raw;
    root.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
    if (!m) return fallback;
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${hex(+m[1]!)}${hex(+m[2]!)}${hex(+m[3]!)}`;
  } catch {
    return fallback;
  }
}

/** Resolve `--vg-fg-color` to a `#rrggbb` the native color input can hold. */
function defaultForeColor(anchor?: HTMLElement | null): string {
  return themeColorHex('--vg-fg-color', '#e5e9f0', anchor);
}

function defaultChromeAccent(anchor?: HTMLElement | null): string {
  return themeColorHex('--vg-chrome-accent', '#2778C1', anchor);
}

/** Border-side segment: a faint frame with the chosen edge emphasized —
 *  reads as "which border am I editing" at a glance. */
export type BorderSideKey = 'all' | 'top' | 'bottom' | 'left' | 'right';
const BORDER_EDGE_PATHS: Record<BorderSideKey, string> = {
  all: 'M5 5h14v14H5z',
  top: 'M5 5h14',
  bottom: 'M5 19h14',
  left: 'M5 5v14',
  right: 'M19 5v14',
};
function borderSideBtn(side: BorderSideKey): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'vgext-rb-toggle vgext-rb-bside';
  b.dataset.side = side;
  b.title = side === 'all' ? 'All borders' : `${side.charAt(0).toUpperCase()}${side.slice(1)} border`;
  b.innerHTML =
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">` +
    `<path d="M5 5h14v14H5z" stroke-width="1" opacity="0.35"/>` +
    `<path d="${BORDER_EDGE_PATHS[side]}" stroke-width="2.6"/></svg>`;
  return b;
}

function stat(text: string): HTMLSpanElement {
  const s = document.createElement('span'); s.className = 'vgext-rb-stat'; s.textContent = text; return s;
}

function ribbonItem(opts: RibbonExtensionsOpts = {}): ToolbarItem {
  const getEdit = opts.edit;
  return {
    id: 'ribbon', kind: 'toolbar-item', slot: 'ribbon.main', init() {},
    render(host: HTMLElement, ctx: VelocityGridExtContext): ToolbarItemInstance {
      // Two single-row toolbars (editing + formatting). Controls are captured
      // by reference so the wire fns can bind them to their engines.
      // Title-bar styles carry the shared `.vgext-menu*` popup rules the
      // border style/width dropdowns ride — inject for standalone ribbons.
      injectTitleBarStyles();

      // Editing cluster — HISTORY · SMART · BULK.
      const undo = iconBtn(I.undo, 'Undo');
      const redo = iconBtn(I.redo, 'Redo');
      const histCount = stat('0 entries');
      const operand = textInput('1', 'sm'); operand.value = '1';
      const opMul = iconBtn('M6 6l12 12M18 6L6 18', 'Multiply');
      const opDiv = iconBtn('M5 12h14M12 6h.01M12 18h.01', 'Divide');
      const opAdd = iconBtn('M12 5v14M5 12h14', 'Add');
      const opSub = iconBtn('M5 12h14', 'Subtract');
      const setBtn = pill('Set…', false);
      const smartCount = stat('0 cells');
      const bulkValue = textInput('New value', 'md');
      const bulkApply = iconBtn('M20 6L9 17l-5-5', 'Apply');
      const bulkCount = stat('0 selected');

      // Formatting cluster controls — target, type, paint, icons, number,
      // edit/group pickers, templates.
      // Cell↔header target + selected↔all scope toggles — both instances of
      // the shared stateToggle control; painted + wired in
      // wireFormattingToolbar via the paint fns carried on FormattingRefs.
      const targetT = stateToggle({
        rb: 'target',
        a: { icon: I.grid, label: 'Cells' },
        b: { icon: I.rows, label: 'Header' },
        title: (isCell) => `Styling target: ${isCell ? 'Cells' : 'Header'} — click to switch to ${isCell ? 'Header' : 'Cells'}`,
      });
      const scopeT = stateToggle({
        rb: 'scope',
        a: { icon: I.selection, label: 'Selected' },
        b: { icon: I.columns, label: 'All' },
        title: (isSel) => `Scope: ${isSel ? 'selected column(s)' : 'ALL columns'} — click to apply to ${isSel ? 'all columns' : 'the selection'}`,
      });
      const targetToggle = targetT.el;
      const scopeToggle = scopeT.el;
      const selPill = pill('—', false);
      selPill.classList.add('vgext-rb-selpill');
      selPill.title = 'Selection target';
      const bold = toggleBtn(I.bold, 'Bold');
      const italic = toggleBtn(I.italic, 'Italic');
      const underline = toggleBtn(I.underline, 'Underline');
      const strike = toggleBtn(I.strikethrough, 'Strikethrough');
      // Borders — per-side border editor: side segments + live preview chip
      // (row A), colour / line-style / width / clear (row B).
      const borderSideBtns: Record<BorderSideKey, HTMLButtonElement> = {
        all: borderSideBtn('all'),
        top: borderSideBtn('top'),
        bottom: borderSideBtn('bottom'),
        left: borderSideBtn('left'),
        right: borderSideBtn('right'),
      };
      const borderPreview = h('vgext-rb-bpreview');
      borderPreview.title = 'Current borders';
      const borderColor = ribbonColorSwatch(
        'M4 4h16v16H4zM12 12h.01', 'Border color', defaultForeColor());
      const borderColorBtn = borderColor.button;
      const borderStylePill = pill('Solid');
      const borderWidthPill = pill('1 px');
      const borderClear = iconBtn(I.eraser, 'Remove the border at this side');

      // AB — header-caption case toggle (uppercase ⇄ original), all columns.
      const headerCase = document.createElement('button');
      headerCase.type = 'button';
      headerCase.className = 'vgext-rb-toggle vgext-rb-ab';
      headerCase.textContent = 'AB';
      const alignL = toggleBtn(I.alignLeft, 'Align left');
      const alignC = toggleBtn(I.alignCenter, 'Align center');
      const alignR = toggleBtn(I.alignRight, 'Align right');
      const sizeVal = document.createElement('span'); sizeVal.textContent = '12px';
      const sizeUp = document.createElement('button'); sizeUp.type = 'button'; sizeUp.className = 'vgext-rb-step'; sizeUp.title = 'Larger font'; sizeUp.innerHTML = svg('M6 15l6-6 6 6', 11);
      const sizeDn = document.createElement('button'); sizeDn.type = 'button'; sizeDn.className = 'vgext-rb-step'; sizeDn.title = 'Smaller font'; sizeDn.innerHTML = svg('M6 9l6 6 6-6', 11);
      const sizeWrap = h('vgext-rb-stepper');
      const sizeStack = h('vgext-rb-step-stack'); sizeStack.append(sizeUp, sizeDn);
      sizeWrap.append(sizeVal, sizeStack);

      // Paint — fg/bg colour pickers (share Formatting row A with Type/Icons).
      // Buttons carry a live swatch bar; the shared ColorPickerControl popover
      // (same as Grid Options) opens from the button.
      const textColor = ribbonColorSwatch(I.paintText, 'Text color', defaultForeColor());
      const textColorBtn = textColor.button;
      const fillColor = ribbonColorSwatch(I.fill, 'Fill color', DEFAULT_FILL_COLOR);
      const fillColorBtn = fillColor.button;
      // Icons — tile picker · colour · placement slot selector · clear. Icons
      // are column styling, so they share the Paint row. Placement is a SLOT
      // SELECTOR (see `wireFormattingToolbar`): the picker/colour/clear always
      // edit "the icon at the selected placement for the current target" — they
      // switch which slot is shown, never move an icon between slots.
      let iconApply: (sel: IconSelection) => void = () => {};
      const picker = createIconPicker({ onSelect: (sel) => iconApply(sel) });
      const iconColor = ribbonColorSwatch(I.paintText, 'Icon color', defaultChromeAccent());
      const iconColorBtn = iconColor.button;
      iconColorBtn.dataset.ip = 'color';
      const iconPlacePill = pill('Prefix'); iconPlacePill.dataset.ip = 'place';
      const iconClear = iconBtn(I.eraser, 'Clear icon at this placement'); iconClear.dataset.ip = 'clear';
      document.body.append(picker.panel);
      // Place / colour / clear sit in the Icons flyout next to the picker.
      const iconTools = h('vgext-ip-tools');
      iconTools.append(iconPlacePill, iconColorBtn, iconColor.host, iconClear);

      const fmtDollar = iconBtn(I.dollar, 'Currency format');
      const fmtPercent = iconBtn(I.percent, 'Percent format');
      const fmtThousands = iconBtn(I.hash, 'Thousands format');
      const decDown = decimalBtn('fewer', 'Fewer decimals');
      const decUp = decimalBtn('more', 'More decimals');
      // Caret after the quick icons opens the full custom format picker.
      const fmtCode = document.createElement('button');
      fmtCode.type = 'button';
      fmtCode.className = 'vgext-rb-btn vgext-rb-fmt-caret';
      fmtCode.title = 'Custom format…';
      fmtCode.setAttribute('aria-label', 'Custom format');
      fmtCode.setAttribute('aria-haspopup', 'dialog');
      fmtCode.dataset.fmt = 'picker';
      fmtCode.innerHTML = svg('M6 9l6 6 6-6', 12);
      const eraser = dangerIcon(I.eraser, 'Clear column customization');
      eraser.dataset.fmt = 'clear';
      eraser.title = 'Clear styling, format, filter, and template references for the selected column(s) in this layout';
      const tplOpen = iconBtn(I.templates, 'Column templates');
      tplOpen.dataset.tpl = 'open';
      tplOpen.title = 'Column templates — apply, save, rename, or delete reusable styling presets';
      const tplPill = pill('', true);
      tplPill.dataset.tpl = 'pill';
      tplPill.setAttribute('aria-label', 'Templates');
      tplPill.title = 'Column templates — apply, save, rename, or delete reusable styling presets';
      const clearAll = dangerIcon(I.trash, 'Clear all customization in this layout');
      clearAll.dataset.fmt = 'clearAll';
      clearAll.title = 'Clear every column\'s styling, format, filter, and template references from this layout';
      const fmtUndo = iconBtn(I.undo, 'Undo formatting');
      fmtUndo.dataset.fmt = 'undo';
      fmtUndo.title = 'Undo formatting changes (until the layout is saved)';
      const fmtRedo = iconBtn(I.redo, 'Redo formatting');
      fmtRedo.dataset.fmt = 'redo';
      fmtRedo.title = 'Redo formatting changes';

      // Column — strip shows the settings dropdown; quick toggles live in
      // a flyout so the strip stays compact (full detail is in the panel).
      const colOpen = dropdownBtn(I.settings, 'Column', 'Column settings');
      colOpen.dataset.col = 'open';
      const aggPill = pill('Σ None');
      aggPill.dataset.col = 'agg';
      const colFF = toggleBtn(I.filter, 'Floating filter');
      colFF.dataset.col = 'ff';
      // Filter type for the floating-filter row — only shown while FF is on
      // (mirrors the Column popover's Filter type segment).
      const filterTypePill = pill('Auto');
      filterTypePill.dataset.col = 'filterType';
      filterTypePill.title = 'Floating filter type';
      filterTypePill.setAttribute('aria-label', 'Floating filter type');
      filterTypePill.hidden = true;
      const colGrp = toggleBtn(I.agg, 'Groupable');
      colGrp.dataset.col = 'grp';
      const colAggH = toggleBtn(I.rows, 'Show aggregation in header');
      colAggH.dataset.col = 'aggh';
      const bordersOpen = dropdownBtn('M5 5h14v14H5z', 'Borders', 'Border styling');
      bordersOpen.dataset.rb = 'borders-open';
      const iconsOpen = dropdownBtn(I.templates, 'Icons', 'Icons and placement');
      iconsOpen.dataset.ip = 'tools-open';
      // Compact the picker trigger — the Icons flyout hosts it.
      picker.button.querySelector('.vgext-ip-openlabel')!.textContent = 'Pick…';

      // Flat labelled segments shared by both strips. The
      // `[data-toolbar="…"]` hooks stay so the title-bar More toggles keep
      // addressing each strip.
      const seg = (label: string, ...controls: HTMLElement[]): HTMLElement => {
        const s = h('vgext-es-seg');
        const l = document.createElement('span');
        l.className = 'vgext-es-label';
        l.textContent = label;
        s.append(l, ...controls);
        return s;
      };

      const editStrip = h('vgext-edit-strip');
      editStrip.dataset.toolbar = 'editing';
      const histSeg = seg('History', undo, redo, histCount);
      const smartSeg = seg('Smart edit', operand, opMul, opDiv, opAdd, opSub, setBtn, smartCount);
      const bulkSeg = seg('Bulk', bulkValue, bulkApply, bulkCount);
      const editBody = h('vgext-es-body');
      editBody.append(histSeg, smartSeg, bulkSeg);
      const editOverflow = iconBtn(I.more, 'More editing tools');
      editOverflow.dataset.tb = 'edit-overflow';
      editOverflow.hidden = true;
      const editClose = iconBtn(I.close, 'Hide editing toolbar');
      editClose.dataset.tb = 'close-edit';
      editClose.classList.add('vgext-es-close');
      editClose.addEventListener('click', () => {
        if (!editStrip.hidden) ctx.events.emit({ type: 'toggle-ribbon', section: 'edit' });
      });
      editStrip.append(editBody, editOverflow, editClose);

      // Formatting — single-row strip (same pattern as editing), not Excel decks.
      const formatting = h('vgext-edit-strip');
      formatting.classList.add('vgext-format-strip');
      formatting.dataset.toolbar = 'formatting';
      // No "Target" label — icon toggles + compact selection chip are enough.
      const gTarget = seg('', selPill, targetToggle, scopeToggle);
      gTarget.classList.add('vgext-es-seg--target');
      const gFont = seg(
        'Font',
        bold, italic, underline, strike, sizeWrap,
        textColorBtn, textColor.host, fillColorBtn, fillColor.host, headerCase,
      );
      const gAlign = seg('Align', alignL, alignC, alignR);
      // Borders / Icons / Column — compact dropdown triggers; dense controls
      // live in flyouts (or the existing Column / icon picker panels).
      // Format — quick icons on the strip ($ % # · decimals), not a Format ▾.
      const bordersBody = h('vgext-rb-tool-flyout-body');
      const bordersRowSides = h('vgext-rb-flyout-row');
      bordersRowSides.append(
        borderSideBtns.all, borderSideBtns.top, borderSideBtns.bottom,
        borderSideBtns.left, borderSideBtns.right, borderPreview,
      );
      const bordersRowStyle = h('vgext-rb-flyout-row');
      bordersRowStyle.append(
        borderColorBtn, borderColor.host, borderStylePill, borderWidthPill, borderClear,
      );
      bordersBody.append(bordersRowSides, bordersRowStyle);
      const bordersFly = persistentFlyout(bordersOpen, bordersBody, { preferWidth: 280 });
      const gBorders = seg('', bordersOpen);

      // Quick format icons + caret (opens the custom format picker).
      const gFormat = seg('', fmtDollar, fmtPercent, fmtThousands, decDown, decUp, fmtCode);

      const iconsBody = h('vgext-rb-tool-flyout-body');
      iconsBody.append(picker.button, iconTools);
      const iconsFly = persistentFlyout(iconsOpen, iconsBody, { preferWidth: 320 });
      const gIcons = seg('', iconsOpen);

      // Full column settings are in the Column dropdown panel (filter,
      // grouping, aggregation, behavior). Keep strip-side quick toggles
      // wired for refresh/agg menus but park them off-strip — the panel
      // is the primary surface now.
      const columnQuickPark = h('vgext-rb-flyout-stash');
      columnQuickPark.hidden = true;
      columnQuickPark.append(aggPill, colFF, filterTypePill, colGrp, colAggH);
      const gColumn = seg('', colOpen);

      const gTemplates = seg('Templates', tplOpen, tplPill);
      const gClear = seg('', fmtUndo, fmtRedo, eraser, clearAll);
      const formatBody = h('vgext-es-body');
      // Primary strip order: target → font → number formats → align →
      // flyout triggers → templates/clear last (spill first when tight).
      formatBody.append(
        gTarget, gFont, gFormat, gAlign, gBorders, gIcons, gColumn, gTemplates, gClear,
      );

      const fmtOverflow = iconBtn(I.more, 'More formatting tools');
      fmtOverflow.dataset.tb = 'format-overflow';
      fmtOverflow.hidden = true;
      const fmtClose = iconBtn(I.close, 'Hide formatting toolbar');
      fmtClose.dataset.tb = 'close-format';
      fmtClose.classList.add('vgext-es-close');
      fmtClose.addEventListener('click', () => {
        if (!formatting.hidden) ctx.events.emit({ type: 'toggle-ribbon', section: 'format' });
      });
      formatting.append(formatBody, fmtOverflow, fmtClose, columnQuickPark);
      host.append(editStrip, formatting);

      const editOverflowHandle = wireRibbonOverflow({
        track: editBody,
        button: editOverflow,
        maxRows: 1,
        items: [
          { el: histSeg, priority: 0 },
          { el: smartSeg, priority: 1 },
          { el: bulkSeg, priority: 2 },
        ],
      });
      // Keep $/%/#/decimals + Align on the strip whenever they fit.
      // Spill order when the strip is truly too narrow: Templates → Clear →
      // Column → Icons → Borders (Format/Align/Font/Target stay longest).
      const fmtOverflowHandle = wireRibbonOverflow({
        track: formatBody,
        button: fmtOverflow,
        maxRows: 1,
        items: [
          { el: gTarget, priority: 0 },
          { el: gFont, priority: 0 },
          { el: gFormat, priority: 0 },
          { el: gAlign, priority: 0 },
          { el: gBorders, priority: 2 },
          { el: gIcons, priority: 3 },
          { el: gColumn, priority: 4 },
          // restoreAll appends in this order — Templates before Clear so
          // Clear stays the rightmost section on the strip and in overflow.
          { el: gTemplates, priority: 6 },
          { el: gClear, priority: 5 },
        ],
      });

      // Hide the whole `.vgext-ribbon` when BOTH toolbars are off.
      const syncRibbonChrome = () => {
        const formatOff = formatting.hidden;
        const editOff = editStrip.hidden;
        if (formatOff) {
          fmtOverflow.hidden = true;
        } else {
          fmtOverflowHandle.reflow();
        }
        if (editOff) {
          editOverflow.hidden = true;
        } else {
          editOverflowHandle.reflow();
        }
        const ribbonHost = host.closest('.vgext-ribbon');
        if (ribbonHost instanceof HTMLElement) {
          ribbonHost.hidden = formatOff && editOff;
        }
      };

      const off = ctx.events.on('toggle-ribbon', (e) => {
        const section = (e as { section?: string }).section;
        if (section === 'edit') editStrip.hidden = !editStrip.hidden;
        else if (section === 'format') formatting.hidden = !formatting.hidden;
        syncRibbonChrome();
      });

      // Initial visibility (compact chrome starts both strips hidden).
      if (opts.editHidden) editStrip.hidden = true;
      if (opts.formatHidden) formatting.hidden = true;
      syncRibbonChrome();

      const disposeEditing = getEdit
        ? wireEditingToolbar(ctx, getEdit, {
            undo, redo, histCount,
            operand, ops: { multiply: opMul, divide: opDiv, add: opAdd, subtract: opSub, set: setBtn },
            smartCount, bulkValue, bulkApply, bulkCount,
          })
        : undefined;

      const disposeFormatting = wireFormattingToolbar(ctx, {
        targetToggle, scopeToggle, selPill,
        paintTargetToggle: targetT.paint, paintScopeToggle: scopeT.paint,
        bold, italic, underline, strike, alignL, alignC, alignR,
        sizeVal, sizeUp, sizeDn,
        textColor, fillColor, headerCase,
        borderSideBtns, borderPreview, borderColor,
        borderStylePill, borderWidthPill, borderClear,
        fmtDollar, fmtPercent, fmtThousands, decDown, decUp, fmtCode,
        eraser,
        tplOpen, tplPill, clearAll,
        fmtUndo, fmtRedo,
        iconPicker: picker,
        setIconApply: (fn) => { iconApply = fn; },
        iconColor, iconPlacePill, iconClear,
        colOpen, aggPill, colFF, filterTypePill, colGrp, colAggH,
      });

      return {
        destroy() {
          bordersFly.destroy();
          iconsFly.destroy();
          columnQuickPark.remove();
          editOverflowHandle.destroy();
          fmtOverflowHandle.destroy();
          disposeEditing?.();
          disposeFormatting();
          textColor.destroy();
          fillColor.destroy();
          borderColor.destroy();
          iconColor.destroy();
          picker.destroy();
          off();
          host.replaceChildren();
        },
      };
    },
  };
}

function dangerIcon(icon: string, title: string): HTMLButtonElement {
  const b = iconBtn(icon, title); b.classList.add('vgext-rb-danger-btn'); return b;
}

/** Toolbar count is a synchronous range-geometry estimate; `collectTargets()`
 *  resolves eligibility asynchronously and can come back empty (readonly
 *  cells, hidden columns, …) even when the toolbar showed a non-zero count.
 *  Surface that instead of a silent no-op — a small auto-dismissing notice
 *  anchored under the clicked control. */
function showNoEligibleCellsNotice(anchor: HTMLElement): void {
  document.querySelectorAll('.vgext-elig-notice').forEach((n) => n.remove());
  const rect = anchor.getBoundingClientRect();
  const notice = document.createElement('div');
  notice.className = 'vgext-elig-notice';
  notice.textContent = 'No eligible cells in this selection';
  notice.style.left = `${rect.left}px`;
  notice.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 2200);
}

// ── Editing-toolbar wiring (@wellsfargo-starui/velocity-grid-edit bridge) ──────────────────────────
interface EditingRefs {
  undo: HTMLButtonElement; redo: HTMLButtonElement; histCount: HTMLElement;
  operand: HTMLInputElement; ops: Record<SmartEditOp, HTMLButtonElement>;
  smartCount: HTMLElement; bulkValue: HTMLInputElement; bulkApply: HTMLButtonElement; bulkCount: HTMLElement;
}

/** Bind the History / Smart / Bulk controls to the live `@wellsfargo-starui/velocity-grid-edit` handle:
 *  undo/redo through the journal (with reactive count + enablement), numeric
 *  ops and set-value across the current cell selection, and bulk set-value.
 *  Returns a disposer. */
function wireEditingToolbar(ctx: VelocityGridExtContext, getEdit: EditHandleGetter, r: EditingRefs): () => void {
  const disposers: Array<() => void> = [];
  const onGrid = (type: string, fn: () => void) =>
    disposers.push((ctx.grid.addEventListener as any)(type, fn) as Unsub);

  const refreshHistory = () => {
    const j = getEdit()?.journal;
    if (!j) return;
    r.undo.disabled = !j.canUndo();
    r.redo.disabled = !j.canRedo();
    const n = j.entries().length;
    r.histCount.textContent = `${n} ${n === 1 ? 'entry' : 'entries'}`;
  };
  r.undo.addEventListener('click', () => { getEdit()?.journal.undo(); refreshHistory(); });
  r.redo.addEventListener('click', () => { getEdit()?.journal.redo(); refreshHistory(); });

  const runSmart = (op: SmartEditOp) => {
    const e = getEdit(); if (!e) return;
    const operand = Number(r.operand.value);
    if (!Number.isFinite(operand)) return;
    void e.smartEdit.collectTargets().then((t) => {
      if (t.length) void e.smartEdit.apply(t, op, operand);
      else showNoEligibleCellsNotice(r.ops[op]);
    });
  };
  (Object.keys(r.ops) as SmartEditOp[]).forEach((op) => r.ops[op].addEventListener('click', () => runSmart(op)));

  r.bulkApply.addEventListener('click', () => {
    const e = getEdit(); if (!e) return;
    const raw = r.bulkValue.value;
    if (!raw.trim()) return;
    void e.bulkUpdate.collectTargets().then((t) => {
      if (t.length) void e.bulkUpdate.apply(t, raw);
      else showNoEligibleCellsNotice(r.bulkApply);
    });
  });

  const refreshCounts = () => {
    const e = getEdit(); if (!e) return;
    // Count from range geometry only — NEVER call collectTargets here.
    // Header-click column bands are full-height (20k rows); collectTargets
    // fans out one getRowByIndex per row and floods the worker so
    // setSortModel / viewport replies starve and the grid looks like
    // sort "did nothing" even though cycleSort already ran on main.
    const gridApi = ctx.grid as unknown as {
      getCellRanges(): Array<{ rowStart: number; rowEnd: number; colIds: string[] }>;
    };
    const ranges = gridApi.getCellRanges?.() ?? [];
    let cellCount = 0;
    let selectedRows = 0;
    if (ranges.length === 1) {
      const range = ranges[0]!;
      const rows = Math.max(0, range.rowEnd - range.rowStart + 1);
      selectedRows = rows;
      cellCount = rows * range.colIds.length;
    } else if (ranges.length > 1) {
      // Dedupe the actual cell union — summing `rows * colIds.length` per
      // range double-counts any cell covered by more than one range.
      const covered = new Map<number, Set<string>>();
      for (const range of ranges) {
        for (let i = range.rowStart; i <= range.rowEnd; i++) {
          let cols = covered.get(i);
          if (!cols) { cols = new Set<string>(); covered.set(i, cols); }
          for (const colId of range.colIds) cols.add(colId);
        }
      }
      for (const cols of covered.values()) cellCount += cols.size;
      selectedRows = covered.size;
    }
    r.smartCount.textContent = `${cellCount} ${cellCount === 1 ? 'cell' : 'cells'}`;
    const none = cellCount === 0;
    for (const op of Object.keys(r.ops) as SmartEditOp[]) r.ops[op].disabled = none;
    r.bulkCount.textContent = `${selectedRows} selected`;
    r.bulkApply.disabled = selectedRows === 0;
  };

  // The edit engine is wired just after the grid is constructed — a tick
  // after the ribbon renders — so subscribe as soon as the handle appears.
  let subscribed = false;
  const trySubscribe = () => {
    const e = getEdit();
    if (!e || subscribed) return;
    subscribed = true;
    disposers.push(e.journal.subscribe(refreshHistory));
    onGrid('cellSelectionChanged', refreshCounts);
    onGrid('cellFocused', refreshCounts);
    refreshHistory();
    refreshCounts();
  };
  trySubscribe();
  if (!subscribed) {
    const t = setTimeout(trySubscribe, 0);
    disposers.push(() => clearTimeout(t));
  }

  return () => { for (const d of disposers) { try { d(); } catch { /* ignore */ } } };
}

// ── Formatting-toolbar wiring (column styling via @wellsfargo-starui/velocity-grid-calc editColumn) ──
interface FormattingRefs {
  targetToggle: HTMLButtonElement; scopeToggle: HTMLButtonElement; selPill: HTMLButtonElement;
  paintTargetToggle: (isCell: boolean) => void; paintScopeToggle: (isSelected: boolean) => void;
  bold: HTMLButtonElement; italic: HTMLButtonElement; underline: HTMLButtonElement; strike: HTMLButtonElement;
  alignL: HTMLButtonElement; alignC: HTMLButtonElement; alignR: HTMLButtonElement;
  sizeVal: HTMLElement; sizeUp: HTMLButtonElement; sizeDn: HTMLButtonElement;
  textColor: RibbonColorSwatch;
  fillColor: RibbonColorSwatch;
  headerCase: HTMLButtonElement;
  borderSideBtns: Record<BorderSideKey, HTMLButtonElement>;
  borderPreview: HTMLElement;
  borderColor: RibbonColorSwatch;
  borderStylePill: HTMLButtonElement; borderWidthPill: HTMLButtonElement;
  borderClear: HTMLButtonElement;
  fmtDollar: HTMLButtonElement; fmtPercent: HTMLButtonElement; fmtThousands: HTMLButtonElement;
  decDown: HTMLButtonElement; decUp: HTMLButtonElement; fmtCode: HTMLButtonElement;
  eraser: HTMLButtonElement;
  tplOpen: HTMLButtonElement; tplPill: HTMLButtonElement; clearAll: HTMLButtonElement;
  fmtUndo: HTMLButtonElement; fmtRedo: HTMLButtonElement;
  iconPicker: IconPickerHandle;
  setIconApply: (fn: (sel: IconSelection) => void) => void;
  iconColor: RibbonColorSwatch;
  iconPlacePill: HTMLButtonElement; iconClear: HTMLButtonElement;
  colOpen: HTMLButtonElement; aggPill: HTMLButtonElement;
  colFF: HTMLButtonElement; filterTypePill: HTMLButtonElement;
  colGrp: HTMLButtonElement; colAggH: HTMLButtonElement;
}

/** Bind the Formatting toolbar to the kernel + calc engine: derive target
 *  COLUMNS from the current cell selection, then write static styling to
 *  those columns' cells or headers (Target toggle) via the public
 *  `editColumn(colId, { cellStyle | headerStyle })` — kernel `ColCellOverrides`
 *  vocabulary (`fg`/`bg`/`halign`/`fontWeight`/`fontStyle`/`textDecoration`/
 *  `fontSize`) — and number formats via `editColumn(colId, { format })`.
 *  Toggle states reflect the first target column's own-template overrides
 *  (`__cgridOwn:<colId>` from `getTemplates()` — the public read surface).
 *  Returns a disposer. */
function wireFormattingToolbar(ctx: VelocityGridExtContext, r: FormattingRefs): () => void {
  const disposers: Array<() => void> = [];
  const grid = ctx.grid as unknown as {
    getCellRanges(): Array<{ colIds: string[] }>;
    getFocusedCell(): { rowId: string; colId: string } | null;
    getColumnHeaderName(colId: string): string | undefined;
    editColumn(colId: string, patch: Record<string, unknown>): void;
    getTemplates(): Array<{ id: string; name: string; overrides: Record<string, unknown> }>;
    getState(): { modules?: Record<string, { data?: unknown }> };
    saveTemplate(spec: { id: string; name: string; overrides: Record<string, unknown> }): void;
    renameTemplate(templateId: string, name: string): void;
    deleteTemplate(templateId: string): void;
    applyTemplate(colId: string, templateId: string): void;
    removeTemplate(colId: string, templateId: string): void;
    setState(snapshot: { version: number; modules: Record<string, { version: number; data: unknown }> }): void;
    addEventListener(type: string, fn: (...args: unknown[]) => void): Unsub;
    getGridOption(key: string): unknown;
    getValueColumns(): Array<{ colId: string; aggFunc: string }>;
    addValueColumn(colId: string, aggFunc: string): void;
    setValueColumnAggFunc(colId: string, aggFunc: string): void;
    removeValueColumn(colId: string): void;
    setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
    getColumnState(): Array<{ colId: string; pinned?: 'left' | 'right' | null }>;
  };
  let target: 'cell' | 'header' = 'cell';
  let scope: 'selected' | 'all' = 'selected';

  const history = createFormatHistory(grid as unknown as FormatHistoryGrid);
  const refreshHistoryBtns = (): void => {
    r.fmtUndo.disabled = !history.canUndo();
    r.fmtRedo.disabled = !history.canRedo();
  };
  disposers.push(history.subscribe(refreshHistoryBtns));
  /** Push an undo checkpoint, then run a formatting mutation. */
  const withHistory = (mutate: () => void): void => {
    history.push();
    mutate();
  };

  /** Columns identified from the selected cells (ranges first, focus fallback). */
  const selectedCols = (): string[] => {
    try {
      const fromRanges = grid.getCellRanges().flatMap((rg) => rg.colIds);
      if (fromRanges.length) return [...new Set(fromRanges)];
      const focus = grid.getFocusedCell();
      return focus ? [focus.colId] : [];
    } catch { return []; }
  };
  /** Every leaf column id from the live columnDefs tree. */
  const allCols = (): string[] => {
    const out: string[] = [];
    const walk = (defs: readonly unknown[]): void => {
      for (const d of defs) {
        const def = d as { colId?: string; children?: unknown[] };
        if (def.children) walk(def.children);
        else if (def.colId) out.push(def.colId);
      }
    };
    try { walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { /* pre-init */ }
    return out;
  };
  /** The columns ribbon settings apply to, per the scope toggle. */
  const targetCols = (): string[] => (scope === 'all' ? allCols() : selectedCols());

  /** The first target column's own-template style slice for the active target. */
  const currentStyle = (): Record<string, unknown> => {
    const cols = targetCols();
    if (!cols.length) return {};
    try {
      const own = grid.getTemplates().find((t) => t.id === `__cgridOwn:${cols[0]}`);
      const slice = own?.overrides?.[target === 'header' ? 'headerStyle' : 'cellStyle'];
      return (slice as Record<string, unknown>) ?? {};
    } catch { return {}; }
  };
  const currentFormat = (): string | undefined => {
    const cols = targetCols();
    if (!cols.length) return undefined;
    try {
      const own = grid.getTemplates().find((t) => t.id === `__cgridOwn:${cols[0]}`);
      return own?.overrides?.format as string | undefined;
    } catch { return undefined; }
  };

  const applyStyle = (patch: Record<string, unknown>): void => {
    const cols = targetCols();
    if (!cols.length) {
      r.selPill.title = 'Select a cell or column first';
      r.selPill.classList.add('vgext-rb-sel--need');
      window.setTimeout(() => r.selPill.classList.remove('vgext-rb-sel--need'), 900);
      return;
    }
    const key = target === 'header' ? 'headerStyle' : 'cellStyle';
    withHistory(() => {
      for (const colId of cols) {
        try { grid.editColumn(colId, { [key]: patch }); } catch { /* unknown column */ }
      }
    });
    ctx.profiles.markDirty();
    refresh();
  };
  const applyFormat = (format: string): void => {
    const cols = targetCols();
    if (!cols.length) {
      r.selPill.title = 'Select a cell or column first';
      r.selPill.classList.add('vgext-rb-sel--need');
      window.setTimeout(() => r.selPill.classList.remove('vgext-rb-sel--need'), 900);
      return;
    }
    withHistory(() => {
      for (const colId of cols) {
        try { grid.editColumn(colId, { format }); } catch { /* non-compiling / unknown */ }
      }
    });
    ctx.profiles.markDirty();
    refresh();
  };

  /** Data type of the first target column, from the live columnDefs tree. */
  const targetDataType = (): FormatDataType => {
    const colId = targetCols()[0];
    if (!colId) return 'number';
    const walk = (defs: readonly unknown[]): string | undefined => {
      for (const d of defs) {
        const def = d as { colId?: string; cellDataType?: string; children?: unknown[] };
        if (def.colId === colId) return def.cellDataType;
        if (def.children) {
          const hit = walk(def.children);
          if (hit !== undefined) return hit;
        }
      }
      return undefined;
    };
    try {
      const t = walk((grid.getGridOption('columnDefs') as unknown[]) ?? []);
      return t === 'text' || t === 'date' || t === 'boolean' ? t : 'number';
    } catch { return 'number'; }
  };

  const clearFormat = (): void => {
    withHistory(() => {
      for (const colId of targetCols()) {
        try { grid.editColumn(colId, { format: null }); } catch { /* calc not wired */ }
      }
    });
    ctx.profiles.markDirty();
    refresh();
  };

  const pickerHost: FormatPickerHost = {
    targetCols,
    currentFormat,
    applyFormat: (f) => { applyFormat(f); },
    clearFormat,
    dataType: targetDataType,
  };
  const fmtPicker = formatPickerMenu(r.fmtCode, pickerHost);
  disposers.push(() => fmtPicker.destroy());

  /** True when the header-caption uppercase toggle is ON (read from the
   *  first column's own template — the toggle always writes ALL columns,
   *  so any one of them is representative). */
  const headerCaseOn = (): boolean => {
    const first = allCols()[0];
    if (!first) return false;
    try {
      const own = grid.getTemplates().find((t) => t.id === `__cgridOwn:${first}`);
      return (own?.overrides?.headerStyle as { textTransform?: string } | undefined)?.textTransform === 'uppercase';
    } catch { return false; }
  };

  /** Reflect the first target column's state into the controls. */
  const refresh = (): void => {
    const cols = targetCols();
    const none = cols.length === 0;
    // Compact selection chip — short face text; full detail in the tooltip.
    const oneName = !none && cols.length === 1
      ? (grid.getColumnHeaderName?.(cols[0]!) ?? cols[0]!)
      : '';
    const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    r.selPill.querySelector('span')!.textContent = none
      ? '—'
      : scope === 'all'
        ? `All·${cols.length}`
        : cols.length === 1
          ? truncate(oneName, 10)
          : String(cols.length);
    r.selPill.title = none
      ? 'Select a cell'
      : scope === 'all'
        ? `All columns (${cols.length})`
        : cols.length === 1
          ? oneName
          : `${cols.length} columns selected`;
    for (const b of [r.bold, r.italic, r.underline, r.strike, r.alignL, r.alignC, r.alignR,
      r.textColor.button, r.fillColor.button, r.fmtDollar, r.fmtPercent, r.fmtThousands,
      r.decDown, r.decUp, r.fmtCode, r.eraser, r.sizeUp, r.sizeDn,
      r.tplOpen, r.tplPill]) {
      (b as HTMLButtonElement).disabled = none;
    }
    const s = currentStyle();
    r.bold.classList.toggle('is-on', s.fontWeight === 'bold');
    r.italic.classList.toggle('is-on', s.fontStyle === 'italic');
    r.underline.classList.toggle('is-on', s.textDecoration === 'underline');
    r.strike.classList.toggle('is-on', s.textDecoration === 'line-through');
    r.alignL.classList.toggle('is-on', s.halign === 'left');
    r.alignC.classList.toggle('is-on', s.halign === 'center');
    r.alignR.classList.toggle('is-on', s.halign === 'right');
    r.sizeVal.textContent = `${(s.fontSize as number | undefined) ?? 12}px`;

    // AB header-case toggle: header-target only; acts on ALL columns, so it
    // ignores the selection/scope and never disables for lack of one.
    r.headerCase.disabled = target !== 'header';
    r.headerCase.classList.toggle('is-on', headerCaseOn());
    r.headerCase.title = target !== 'header'
      ? 'Switch target to Header to toggle header case'
      : headerCaseOn()
        ? 'Restore original header caption case'
        : 'Uppercase all column header captions';

    // Colour swatches — read the column's own fg/bg back into the pickers.
    // Token/var() values read as unset. A column WITHOUT the setting reverts
    // the picker to its default swatch.
    syncRibbonColor(r.textColor, s.fg, defaultForeColor(r.textColor.button));
    syncRibbonColor(r.fillColor, s.bg, DEFAULT_FILL_COLOR);

    // Borders — segment selection + per-side "has a border" dots, the active
    // side's stored values in the colour/style/width controls, and a live
    // preview chip mirroring the whole spec. Sides without a stored border
    // keep the last-chosen style/width (they're the "next apply" values);
    // the colour reverts to its default like the other pickers.
    {
      const bSpec = (s.border as Partial<Record<BorderSideKey, { width?: number; style?: string; color?: string }>> | undefined) ?? {};
      for (const side of Object.keys(r.borderSideBtns) as BorderSideKey[]) {
        const b = r.borderSideBtns[side];
        b.disabled = none;
        b.classList.toggle('is-on', borderSide === side);
        b.classList.toggle('has-border', bSpec[side] !== undefined);
      }
      const active = bSpec[borderSide];
      if (active?.style === 'solid' || active?.style === 'dashed' || active?.style === 'dotted') borderStyleVal = active.style;
      if (typeof active?.width === 'number') borderWidthVal = active.width;
      r.borderStylePill.querySelector('span')!.textContent =
        borderStyleVal.charAt(0).toUpperCase() + borderStyleVal.slice(1);
      r.borderWidthPill.querySelector('span')!.textContent = `${borderWidthVal} px`;
      syncRibbonColor(r.borderColor, active?.color, defaultForeColor(r.borderColor.button));
      for (const el of [r.borderStylePill, r.borderWidthPill, r.borderClear, r.borderColor.button]) el.disabled = none;
      const p = r.borderPreview.style;
      p.border = ''; p.borderTop = ''; p.borderRight = ''; p.borderBottom = ''; p.borderLeft = '';
      const fg = defaultForeColor(r.borderColor.button);
      const css = (sd?: { width?: number; style?: string; color?: string }) =>
        sd ? `${sd.width ?? 1}px ${sd.style ?? 'solid'} ${sd.color ?? fg}` : '';
      if (bSpec.all) p.border = css(bSpec.all);
      if (bSpec.top) p.borderTop = css(bSpec.top);
      if (bSpec.bottom) p.borderBottom = css(bSpec.bottom);
      if (bSpec.left) p.borderLeft = css(bSpec.left);
      if (bSpec.right) p.borderRight = css(bSpec.right);
    }

    // Column group — quick toggles + agg / filter-type pills mirror the focused column.
    // `colOpen` stays enabled even with no target: the popover's own
    // "Select a cell or column first" hint explains the empty state instead
    // of a disabled trigger silently doing nothing.
    const colFirst = cols[0];
    r.aggPill.disabled = none;
    r.filterTypePill.disabled = none;
    for (const b of [r.colFF, r.colGrp, r.colAggH]) b.disabled = none;
    if (!none && colFirst) {
      const cg = grid as unknown as ColumnConfigGrid;
      const ffOn = !!effectiveFlag(cg, colFirst, 'floatingFilter');
      r.colFF.classList.toggle('is-on', ffOn);
      r.colGrp.classList.toggle('is-on', !!effectiveFlag(cg, colFirst, 'enableRowGroup'));
      r.colAggH.classList.toggle('is-on', !effectiveFlag(cg, colFirst, 'suppressAggFuncInHeader'));
      // Filter type only applies while the floating filter row is showing.
      r.filterTypePill.hidden = !ffOn;
      if (ffOn) {
        const raw = effectiveFlag(cg, colFirst, 'filter');
        const key = (typeof raw === 'string' && raw.length > 0) ? raw : 'auto';
        const label = FILTER_TYPE_OPTIONS.find((o) => o.v === key)?.text ?? 'Auto';
        r.filterTypePill.querySelector('span')!.textContent = label;
        r.filterTypePill.classList.toggle('is-set', key !== 'auto');
      } else {
        r.filterTypePill.classList.remove('is-set');
      }
      let agg: string | undefined;
      try { agg = cg.getValueColumns().find((v) => v.colId === colFirst)?.aggFunc; } catch { /* absent */ }
      r.aggPill.querySelector('span')!.textContent = `Σ ${agg ?? 'None'}`;
      r.aggPill.classList.toggle('is-set', agg !== undefined);
    } else {
      r.aggPill.querySelector('span')!.textContent = 'Σ None';
      r.aggPill.classList.remove('is-set');
      r.filterTypePill.hidden = true;
      r.filterTypePill.classList.remove('is-set');
      for (const b of [r.colFF, r.colGrp, r.colAggH]) b.classList.remove('is-on');
    }

    // Format caret — tooltip tracks the applied format; accent when set.
    const fmt = currentFormat();
    const label = fmt === undefined
      ? undefined
      : findPresetByFormat(fmt)?.label ?? (fmt.length > 28 ? `${fmt.slice(0, 27)}…` : fmt);
    r.fmtCode.title = label === undefined ? 'Custom format…' : `Format: ${label}`;
    r.fmtCode.setAttribute('aria-label', r.fmtCode.title);
    r.fmtCode.classList.toggle('is-set', fmt !== undefined);

    // Templates — pill shows the active library template name (if any).
    {
      const tplGrid = grid as unknown as TemplateManagerGrid;
      const activeId = !none && cols[0] ? activeLibraryTemplateId(tplGrid, cols[0]) : undefined;
      const activeName = activeId
        ? libraryTemplates(tplGrid).find((t) => t.id === activeId)?.name
        : undefined;
      const tplCap = r.tplPill.querySelector('span');
      if (tplCap) tplCap.textContent = activeName ?? '';
      r.tplPill.classList.toggle('is-set', !!activeId);
    }

    // Icons — reflect the selected slot into the picker preview + enablement.
    const slot = none ? null : currentIconSlot();
    r.iconPicker.setPreview(slot);
    const emojiSel = slot !== null && slot.emoji !== undefined;
    r.iconColor.button.disabled = none || emojiSel; // color is SVG-only
    r.iconClear.disabled = none || slot === null;
    r.iconPicker.button.disabled = none;
    r.iconPlacePill.disabled = none;
    // Icon colour reverts to its default swatch when the slot has none.
    syncRibbonColor(r.iconColor, slot?.color, defaultChromeAccent(r.iconColor.button));
  };

  // Target toggle (cell vs header styling) — shared stateToggle control;
  // the factory owns the face/aria painting.
  const paintTarget = () => r.paintTargetToggle(target === 'cell');
  const setTarget = (t: 'cell' | 'header') => {
    target = t;
    paintTarget();
    refresh();
  };
  paintTarget();
  r.targetToggle.addEventListener('click', () => setTarget(target === 'cell' ? 'header' : 'cell'));

  // Scope toggle (selected column(s) vs ALL columns) — shared stateToggle.
  const paintScope = () => r.paintScopeToggle(scope === 'selected');
  paintScope();
  r.scopeToggle.addEventListener('click', () => {
    scope = scope === 'selected' ? 'all' : 'selected';
    paintScope();
    refresh();
  });

  // ── Icons section — the picker/color/clear always edit "the icon at
  // `placement` for `target`". Changing placement MOVES the current slot's
  // icon along when the destination is empty (the intuitive "change its
  // location"); a destination that already holds an icon is only selected,
  // so multi-slot editing stays possible.
  type Placement = 'prefix' | 'suffix' | 'tl' | 'tr' | 'bl' | 'br' | 'ml' | 'mr';
  let placement: Placement = 'prefix';

  type IconOverride = { name?: string; emoji?: string; color?: string; position?: 'leading' | 'trailing' };
  type Decorator = { position: string; kind: string; icon?: string; value?: string; color?: string };

  const ownOverrides = (colId: string): Record<string, unknown> =>
    (grid.getTemplates().find((t) => t.id === `__cgridOwn:${colId}`)?.overrides ?? {}) as Record<string, unknown>;

  /** The first target column's icon at the selected slot (for reflection). */
  const currentIconSlot = (): { name?: string; emoji?: string; color?: string } | null => {
    const cols = targetCols();
    if (!cols.length) return null;
    const own = ownOverrides(cols[0]!);
    if (placement === 'prefix' || placement === 'suffix') {
      const ref = own[target === 'header' ? 'headerIcon' : 'cellIcon'] as IconOverride | undefined;
      if (!ref) return null;
      const want = placement === 'prefix' ? 'leading' : 'trailing';
      return (ref.position ?? 'leading') === want ? ref : null;
    }
    const style = own[target === 'header' ? 'headerStyle' : 'cellStyle'] as { decorators?: Decorator[] } | undefined;
    const d = style?.decorators?.find((x) => x.position === placement);
    if (!d) return null;
    if (d.kind === 'icon') return { name: d.icon, color: d.color };
    if (d.kind === 'emoji') return { emoji: d.value };
    return null;
  };

  /** Write `sel` (or clear on null) into the selected slot on every target column. */
  const applyIconSlot = (sel: IconSelection | null): void => {
    const cols = targetCols();
    if (!cols.length) return;
    const color = sel?.name ? r.iconColor.input.value : undefined; // color is SVG-only
    withHistory(() => {
      for (const colId of cols) {
        try {
          if (placement === 'prefix' || placement === 'suffix') {
            const key = target === 'header' ? 'headerIcon' : 'cellIcon';
            const value = sel === null
              ? null
              : { ...sel, ...(color ? { color } : {}), position: placement === 'prefix' ? 'leading' : 'trailing' };
            grid.editColumn(colId, { [key]: value });
          } else {
            const styleKey = target === 'header' ? 'headerStyle' : 'cellStyle';
            const existing = ((ownOverrides(colId)[styleKey] as { decorators?: Decorator[] } | undefined)?.decorators ?? []);
            const kept = existing.filter((d) => d.position !== placement);
            const next = sel === null ? kept : [...kept,
              sel.name
                ? { position: placement, kind: 'icon', icon: sel.name, ...(color ? { color } : {}) }
                : { position: placement, kind: 'emoji', value: sel.emoji! }];
            grid.editColumn(colId, { [styleKey]: { decorators: next } });
          }
        } catch { /* unknown column */ }
      }
    });
    ctx.profiles.markDirty();
    refresh();
  };
  r.setIconApply(applyIconSlot);

  // Placement menu on the pill — rides the shared `menu()` popup (click-
  // away, positioning, theme-class mirroring for free; the previous hand-
  // rolled dropdown re-implemented all three and MISSED the theme mirror).
  // Grouped by kind — inline slots that flow with the label vs. the six
  // positional slots pinned to a cell corner/middle. The active slot is
  // marked so the dropdown reads as a selector, not a one-shot menu.
  const PLACE_GROUPS: Array<[string, Array<[Placement, string]>]> = [
    ['Inline', [['prefix', 'Prefix'], ['suffix', 'Suffix']]],
    ['Positional', [
      ['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'],
      ['ml', 'Middle-left'], ['mr', 'Middle-right'],
    ]],
  ];
  const pickPlacement = (value: Placement, itemLabel: string, altKey: boolean): void => {
    const prev = placement;
    if (value !== prev && !altKey) {
      // MOVE semantics: picking a new placement carries the icon at the
      // current slot along when the destination is empty — "change the
      // icon's location" just works. A destination that already holds
      // an icon is only SELECTED. Alt-click always only selects, which
      // is how a second icon lands on another slot (multi-slot editing).
      const moving = currentIconSlot();
      placement = value;
      const atDestination = currentIconSlot();
      if (moving && !atDestination) {
        if (typeof moving.color === 'string') {
          r.iconColor.setValue(moving.color); // carry the tint along
        }
        placement = prev;
        applyIconSlot(null);                     // clear the old slot…
        placement = value;
        applyIconSlot(moving.name ? { name: moving.name } : { emoji: moving.emoji! }); // …rewrite at the new one
      }
    } else {
      placement = value;
    }
    r.iconPlacePill.querySelector('span')!.textContent = itemLabel;
    refresh();
  };
  const placeMenu = menu(r.iconPlacePill, (close) => {
    const list = document.createElement('div');
    list.className = 'vgext-ip-placemenu';
    list.setAttribute('role', 'menu');
    for (const [heading, entries] of PLACE_GROUPS) {
      const head = document.createElement('div');
      head.className = 'vgext-ip-placehead';
      head.textContent = heading;
      list.append(head);
      for (const [value, itemLabel] of entries) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'vgext-ip-placeitem' + (value === placement ? ' is-active' : '');
        item.dataset.place = value;
        item.textContent = itemLabel;
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(value === placement));
        item.title = 'Click: move the current icon here · Alt-click: just switch slots';
        item.addEventListener('click', (e: MouseEvent) => { pickPlacement(value, itemLabel, e.altKey); close(); });
        list.append(item);
      }
    }
    return list;
  }, undefined, { align: 'left' });
  r.iconPlacePill.addEventListener('click', () => placeMenu.toggle());
  disposers.push(() => placeMenu.destroy());

  r.iconColor.input.addEventListener('change', () => {
    const cur = currentIconSlot();
    if (cur?.name) applyIconSlot({ name: cur.name }); // re-apply with new color
  });
  r.iconClear.addEventListener('click', () => applyIconSlot(null));

  // Type: bold / italic / underline (toggle against current own-template state)
  r.bold.addEventListener('click', () =>
    applyStyle({ fontWeight: currentStyle().fontWeight === 'bold' ? 'normal' : 'bold' }));
  r.italic.addEventListener('click', () =>
    applyStyle({ fontStyle: currentStyle().fontStyle === 'italic' ? 'normal' : 'italic' }));
  // Underline / strikethrough share the kernel's single `textDecoration`
  // slot ('none'|'underline'|'line-through') — enabling one replaces the other.
  r.underline.addEventListener('click', () =>
    applyStyle({ textDecoration: currentStyle().textDecoration === 'underline' ? 'none' : 'underline' }));
  r.strike.addEventListener('click', () =>
    applyStyle({ textDecoration: currentStyle().textDecoration === 'line-through' ? 'none' : 'line-through' }));
  r.alignL.addEventListener('click', () => applyStyle({ halign: 'left' }));
  r.alignC.addEventListener('click', () => applyStyle({ halign: 'center' }));
  r.alignR.addEventListener('click', () => applyStyle({ halign: 'right' }));

  // Font size stepper (8–24px)
  const bumpSize = (delta: number) => {
    const cur = (currentStyle().fontSize as number | undefined) ?? 12;
    applyStyle({ fontSize: Math.min(24, Math.max(8, cur + delta)) });
  };
  r.sizeUp.addEventListener('click', () => bumpSize(1));
  r.sizeDn.addEventListener('click', () => bumpSize(-1));

  // Paint: fg / bg via shared ColorPickerControl
  r.textColor.input.addEventListener('change', () => applyStyle({ fg: r.textColor.input.value }));
  r.fillColor.input.addEventListener('change', () => applyStyle({ bg: r.fillColor.input.value }));

  // Format presets + decimals (cell data only — formats don't apply to headers).
  // Decimal bumpers preserve the active format (currency / % / sections) and
  // only change the `.0+` precision — they do not replace with a plain number.
  const decimalsOf = (fmt: string | undefined): number => {
    const m = /\.(0+)/.exec(fmt ?? '');
    return m ? m[1]!.length : 2;
  };
  const numberFormat = (decimals: number): string =>
    decimals <= 0 ? '#,##0' : `#,##0.${'0'.repeat(decimals)}`;
  r.fmtDollar.addEventListener('click', () => applyFormat(`$${numberFormat(decimalsOf(currentFormat()))}`));
  r.fmtPercent.addEventListener('click', () => applyFormat('0.00%'));
  r.fmtThousands.addEventListener('click', () => applyFormat(numberFormat(decimalsOf(currentFormat()))));
  r.decDown.addEventListener('click', () => applyFormat(adjustFormatDecimals(currentFormat(), -1)));
  r.decUp.addEventListener('click', () => applyFormat(adjustFormatDecimals(currentFormat(), +1)));
  r.fmtCode.addEventListener('click', () => fmtPicker.toggle());

  // Eraser: drop ALL layout customization for the selected column(s) —
  // own-template fork, library template assignments, and direct override
  // fields (style / format / filter / flags). Library template defs stay.
  const clearColumnCustomization = () => {
    const cols = targetCols();
    if (!cols.length) return;
    const drop = new Set(cols);
    withHistory(() => {
      let overrides: Array<{ colId?: string }> = [];
      try {
        const data = grid.getState()?.modules?.columnOverrides?.data;
        overrides = Array.isArray(data) ? (data as Array<{ colId?: string }>) : [];
      } catch { /* pre-init */ }
      const next = overrides.filter((o) => typeof o.colId === 'string' && !drop.has(o.colId));
      try {
        grid.setState({
          version: 4,
          modules: { columnOverrides: { version: 1, data: next } },
        });
      } catch { /* calc not wired */ }
      for (const colId of cols) {
        try { grid.deleteTemplate(`__cgridOwn:${colId}`); } catch { /* absent */ }
      }
    });
    ctx.profiles.markDirty();
    refresh();
  };
  r.eraser.addEventListener('click', clearColumnCustomization);

  // Trash: wipe EVERY column's layout customization (stern "Clear all").
  // Shared library template defs are preserved; only assignments + own forks go.
  const clearLayoutCustomization = () => {
    withHistory(() => {
      try {
        grid.setState({
          version: 4,
          modules: { columnOverrides: { version: 1, data: [] } },
        });
      } catch { /* calc not wired */ }
      try {
        for (const t of grid.getTemplates()) {
          if (isOwnTemplateId(t.id)) {
            try { grid.deleteTemplate(t.id); } catch { /* absent */ }
          }
        }
      } catch { /* calc not wired */ }
    });
    ctx.profiles.markDirty();
    refresh();
  };
  r.clearAll.addEventListener('click', clearLayoutCustomization);

  // Formatting undo/redo — session stack until a layout save/switch.
  r.fmtUndo.addEventListener('click', () => {
    if (!history.undo()) return;
    ctx.profiles.markDirty();
    refresh();
  });
  r.fmtRedo.addEventListener('click', () => {
    if (!history.redo()) return;
    ctx.profiles.markDirty();
    refresh();
  });
  refreshHistoryBtns();
  try {
    disposers.push(grid.addEventListener('layoutChanged', () => { history.reset(); refreshHistoryBtns(); }));
  } catch { /* bare test surfaces */ }

  // ── Templates — library manager (stern ModuleLibrary parity) ─────────────
  const tplHost: TemplateManagerHost = {
    targetCols,
    grid: grid as unknown as TemplateManagerGrid,
    defaultSaveName: () => {
      const first = targetCols()[0];
      if (!first) return 'Style';
      const name = grid.getColumnHeaderName?.(first) ?? first;
      return `${name} Style`;
    },
    beforeChange: () => history.push(),
    onApplied: () => { ctx.profiles.markDirty(); refresh(); },
  };
  const tplMenu = templateManagerMenu(r.tplPill, tplHost);
  const openTpl = (): void => {
    if (r.tplPill.disabled && r.tplOpen.disabled) return;
    tplMenu.toggle();
  };
  r.tplPill.addEventListener('click', openTpl);
  r.tplOpen.addEventListener('click', openTpl);
  disposers.push(() => tplMenu.destroy());

  // ── Borders — per-side editor. The side segments are a SLOT SELECTOR
  // (like icon placement): colour/style/width always edit "the border at
  // `borderSide` for the current target (cell/header)"; switching sides
  // re-reads that side's stored values. Writes replace the whole `border`
  // object on the own template (cellStyle/headerStyle key-level merge).
  interface BorderSideSpec { width?: number; style?: string; color?: string }
  let borderSide: BorderSideKey = 'all';
  let borderStyleVal: 'solid' | 'dashed' | 'dotted' = 'solid';
  let borderWidthVal = 1;

  const currentBorderSpec = (): Partial<Record<BorderSideKey, BorderSideSpec>> =>
    ({ ...((currentStyle().border as Partial<Record<BorderSideKey, BorderSideSpec>> | undefined) ?? {}) });

  const applyBorderEdit = (): void => {
    const spec = currentBorderSpec();
    spec[borderSide] = { width: borderWidthVal, style: borderStyleVal, color: r.borderColor.input.value };
    applyStyle({ border: spec });
  };

  for (const side of Object.keys(r.borderSideBtns) as BorderSideKey[]) {
    r.borderSideBtns[side].addEventListener('click', () => { borderSide = side; refresh(); });
  }
  r.borderColor.input.addEventListener('change', applyBorderEdit);
  const lineSampleItem = (
    label: string,
    sample: { style?: string; width?: number },
    onPick: () => void,
  ): HTMLButtonElement => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'vgext-menu-item';
    const sampleEl = document.createElement('span');
    sampleEl.className = 'vgext-rb-linesample';
    if (sample.style) sampleEl.dataset.lineStyle = sample.style;
    if (sample.width != null) sampleEl.dataset.lineWidth = String(sample.width);
    const lab = document.createElement('span');
    lab.textContent = label;
    it.append(sampleEl, lab);
    it.addEventListener('click', onPick);
    return it;
  };
  const borderStyleMenu = menu(r.borderStylePill, (close) => {
    const list = h('vgext-menu-list');
    for (const styleOpt of ['solid', 'dashed', 'dotted'] as const) {
      list.appendChild(lineSampleItem(
        styleOpt.charAt(0).toUpperCase() + styleOpt.slice(1),
        { style: styleOpt },
        () => { borderStyleVal = styleOpt; applyBorderEdit(); close(); },
      ));
    }
    return list;
  });
  r.borderStylePill.addEventListener('click', () => borderStyleMenu.toggle());
  disposers.push(() => borderStyleMenu.destroy());
  const borderWidthMenu = menu(r.borderWidthPill, (close) => {
    const list = h('vgext-menu-list');
    for (const w of [1, 2, 3, 4]) {
      list.appendChild(lineSampleItem(`${w} px`, { width: w },
        () => { borderWidthVal = w; applyBorderEdit(); close(); }));
    }
    return list;
  });
  r.borderWidthPill.addEventListener('click', () => borderWidthMenu.toggle());
  disposers.push(() => borderWidthMenu.destroy());
  r.borderClear.addEventListener('click', () => {
    if (borderSide === 'all') { applyStyle({ border: undefined }); return; }
    const spec = currentBorderSpec();
    delete spec[borderSide];
    applyStyle({ border: Object.keys(spec).length > 0 ? spec : undefined });
  });

  // AB — toggle every column header caption to UPPERCASE and back to the
  // original case ('none'): headerStyle.textTransform rides the own
  // templates, so it persists into layouts like any other header styling.
  r.headerCase.addEventListener('click', () => {
    const next = headerCaseOn() ? 'none' : 'uppercase';
    withHistory(() => {
      for (const colId of allCols()) {
        try { grid.editColumn(colId, { headerStyle: { textTransform: next } }); } catch { /* unknown column */ }
      }
    });
    ctx.profiles.markDirty();
    refresh();
  });

  // ── Column group — popover + agg pill + quick toggles ────────────────────
  const colGrid = grid as unknown as ColumnConfigGrid;
  const colHost: ColumnPanelHost = {
    targetCols,
    grid: colGrid,
    beforeChange: () => history.push(),
    onApplied: () => { ctx.profiles.markDirty(); refresh(); },
  };
  const colPanel = columnPanelMenu(r.colOpen, colHost);
  r.colOpen.addEventListener('click', () => colPanel.toggle());
  disposers.push(() => colPanel.destroy());

  const aggOfFirst = (): string | undefined => {
    const c = targetCols()[0];
    if (!c) return undefined;
    try { return colGrid.getValueColumns().find((v) => v.colId === c)?.aggFunc; } catch { return undefined; }
  };
  const aggMenu = menu(r.aggPill, (close) => {
    const list = h('vgext-menu-list');
    for (const v of ['none', ...aggFuncChoices(colGrid)]) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'vgext-menu-item' + ((aggOfFirst() ?? 'none') === v ? ' is-active' : '');
      it.textContent = v === 'none' ? 'None' : v;
      it.addEventListener('click', () => {
        for (const colId of targetCols()) {
          try {
            const has = colGrid.getValueColumns().some((x) => x.colId === colId);
            if (v === 'none') { if (has) colGrid.removeValueColumn(colId); }
            else if (has) colGrid.setValueColumnAggFunc(colId, v);
            else colGrid.addValueColumn(colId, v);
          } catch { /* non-aggregable */ }
        }
        ctx.profiles.markDirty();
        refresh();
        close();
      });
      list.appendChild(it);
    }
    return list;
  });
  r.aggPill.addEventListener('click', () => aggMenu.toggle());
  disposers.push(() => aggMenu.destroy());

  const quickFlag = (btn: HTMLButtonElement, key: 'floatingFilter' | 'enableRowGroup', patch: (next: boolean) => Record<string, unknown>): void => {
    btn.addEventListener('click', () => {
      const first = targetCols()[0];
      if (!first) return;
      const next = !effectiveFlag(colGrid, first, key);
      withHistory(() => {
        for (const colId of targetCols()) {
          try { grid.editColumn(colId, patch(next)); } catch { /* unknown column */ }
        }
      });
      ctx.profiles.markDirty();
      refresh();
    });
  };
  quickFlag(r.colFF, 'floatingFilter', (next) => ({ floatingFilter: next }));
  quickFlag(r.colGrp, 'enableRowGroup', (next) => ({ enableRowGroup: next }));

  const filterTypeOfFirst = (): string => {
    const c = targetCols()[0];
    if (!c) return 'auto';
    const raw = effectiveFlag(colGrid, c, 'filter');
    return (typeof raw === 'string' && raw.length > 0) ? raw : 'auto';
  };
  const filterTypeMenu = menu(r.filterTypePill, (close) => {
    const list = h('vgext-menu-list');
    const current = filterTypeOfFirst();
    for (const opt of FILTER_TYPE_OPTIONS) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'vgext-menu-item' + (current === opt.v ? ' is-active' : '');
      it.textContent = opt.menu;
      it.addEventListener('click', () => {
        withHistory(() => {
          for (const colId of targetCols()) {
            try { grid.editColumn(colId, { filter: opt.v === 'auto' ? null : opt.v }); } catch { /* unknown */ }
          }
        });
        ctx.profiles.markDirty();
        refresh();
        close();
      });
      list.appendChild(it);
    }
    return list;
  });
  r.filterTypePill.addEventListener('click', () => {
    if (r.filterTypePill.hidden || r.filterTypePill.disabled) return;
    filterTypeMenu.toggle();
  });
  disposers.push(() => filterTypeMenu.destroy());

  r.colAggH.addEventListener('click', () => {
    const first = targetCols()[0];
    if (!first) return;
    const next = !effectiveFlag(colGrid, first, 'suppressAggFuncInHeader'); // toggle suppress
    withHistory(() => {
      for (const colId of targetCols()) {
        try { grid.editColumn(colId, { suppressAggFuncInHeader: next }); } catch { /* unknown column */ }
      }
    });
    ctx.profiles.markDirty();
    refresh();
  });

  // Selection-driven readout
  try {
    disposers.push(grid.addEventListener('cellSelectionChanged', refresh));
    disposers.push(grid.addEventListener('cellFocused', refresh));
    disposers.push(grid.addEventListener('templatesChanged', refresh));
  } catch { /* bare test surfaces */ }
  refresh();

  return () => { for (const d of disposers) { try { d(); } catch { /* ignore */ } } };
}

// ── styles ──────────────────────────────────────────────────────────────
export function injectRibbonStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('vgext-ribbon-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'vgext-ribbon-styles';
    document.head.appendChild(style);
  }
  style.textContent = RIBBON_CSS;
}

const RIBBON_CSS = `
.vgext-ribbon {
  flex: 0 0 auto;
  min-width: 0;
  width: 100%;
  background: var(--vg-header-bg, var(--vg-popup-bg, #141922));
  border-bottom: 1px solid var(--vg-border-color, #2a3140);
}
.vgext-ribbon:empty,
.vgext-ribbon[hidden] { display: none; }
/* ONE font size for every element in the bar: controls, labels, stats. */
.vgext-edit-strip { font-size: 12px; }

/* Two stacked single-row strips; shell toolbar-item is row by default. */
.vgext-ribbon .vgext-toolbar-item { display: flex; flex-direction: column; align-items: stretch; min-width: 0; }

/* Editing + formatting strips — single-row labelled segments + overflow. */
.vgext-edit-strip {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  padding: 4px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 70%, transparent);
  min-width: 0;
  box-sizing: border-box;
}
.vgext-edit-strip[hidden] { display: none; }
.vgext-es-body {
  display: flex;
  /* Single-row strip: never wrap — overflow is measured via scrollWidth and
   * sections move into the ⋯ menu. Wrapping + align-items:center made
   * different-height segments look like multiple rows and false-spilled. */
  flex-wrap: nowrap;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  column-gap: 0;
}
.vgext-es-seg { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.vgext-es-seg + .vgext-es-seg {
  margin-left: 10px; padding-left: 10px;
  border-left: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
}
.vgext-es-label {
  font-size: 10.5px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--vg-muted-fg-color, #7f8ba0); margin-right: 6px; white-space: nowrap;
}
.vgext-es-label:empty { display: none; margin: 0; }
.vgext-es-seg--target { gap: 2px; }
.vgext-es-seg > .vgext-rb-stat { margin-left: 4px; }
.vgext-es-close,
.vgext-rb-btn[data-tb="close-format"] {
  flex: 0 0 auto;
  align-self: center;
  color: var(--vg-muted-fg-color, #7f8ba0);
}
.vgext-es-close { margin-left: 0; }
.vgext-es-close:hover,
.vgext-rb-btn[data-tb="close-format"]:hover { color: var(--vg-fg-color, #e5e9f0); }

/* Overflow ⋯ — high-contrast chip so it doesn't disappear into the strip.
 * Only shown when wireRibbonOverflow has stashed items (button.hidden). */
.vgext-rb-btn[data-tb="edit-overflow"],
.vgext-rb-btn[data-tb="format-overflow"] {
  flex: 0 0 auto;
  align-self: center;
  width: 28px;
  height: 28px;
  color: var(--vg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 28%, var(--vg-border-color, #2a3140));
  box-sizing: border-box;
}
/* Author display:inline-flex on .vgext-rb-btn beats the UA [hidden] rule. */
.vgext-rb-btn[data-tb="edit-overflow"][hidden],
.vgext-rb-btn[data-tb="format-overflow"][hidden] {
  display: none !important;
}
.vgext-rb-btn[data-tb="edit-overflow"] svg,
.vgext-rb-btn[data-tb="format-overflow"] svg {
  width: 16px;
  height: 16px;
  /* Fill the solid-dot path; stroke alone still looked faint. */
  fill: currentColor;
  stroke: none;
}
.vgext-rb-btn[data-tb="edit-overflow"]:hover,
.vgext-rb-btn[data-tb="format-overflow"]:hover {
  color: var(--vg-accent-fg, #ffffff);
  background: var(--vg-chrome-accent);
  border-color: var(--vg-chrome-accent);
}
.vgext-rb-btn[data-tb="edit-overflow"].is-open,
.vgext-rb-btn[data-tb="format-overflow"].is-open,
.vgext-rb-btn[data-tb="edit-overflow"].has-items,
.vgext-rb-btn[data-tb="format-overflow"].has-items {
  color: var(--vg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--vg-chrome-accent) 28%, transparent);
  border-color: color-mix(in srgb, var(--vg-chrome-accent) 70%, transparent);
}
.vgext-rb-btn[data-tb="edit-overflow"].is-open,
.vgext-rb-btn[data-tb="format-overflow"].is-open {
  color: var(--vg-accent-fg, #ffffff);
  background: var(--vg-chrome-accent);
  border-color: var(--vg-chrome-accent);
}
/* Group decks still used by drawer style chrome (styleChrome.ts). */
.vgext-rb-cluster {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  align-content: flex-start;
  flex: 1 1 auto;
  min-width: 0;
  row-gap: 2px;
  column-gap: 0;
}
.vgext-rb-grp {
  display: flex; flex-direction: column; padding: 0 6px;
  border-right: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 70%, transparent);
  flex: 0 0 auto;
  max-width: 100%;
}
.vgext-rb-cluster > .vgext-rb-grp:first-child { padding-left: 2px; }
.vgext-rb-cluster[data-toolbar="group-style"] > .vgext-rb-grp:last-child { border-right: none; }
.vgext-rb-deck { display: flex; flex-direction: column; gap: 3px; justify-content: center; flex: 1 1 auto; }
.vgext-rb-mini { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; }
.vgext-rb-mini > .vgext-rb-pill:first-child:last-child { flex: 1 1 auto; min-width: 0; }
.vgext-rb-grp-name {
  padding: 2px 0 0; text-align: center;
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--vg-muted-fg-color, #7f8ba0);
  white-space: nowrap;
}
.vgext-rb-overflow-stash,
.vgext-rb-flyout-stash { display: none !important; }
.vgext-menu.vgext-rb-tool-flyout {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  max-height: min(70vh, 420px);
  overflow: auto;
  scrollbar-width: auto;
}
.vgext-rb-tool-flyout-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.vgext-rb-flyout-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.vgext-rb-flyout-row > .vgext-rb-pill:first-child:last-child {
  flex: 1 1 auto;
  min-width: 0;
}
/* Caret after $ % # decimals — opens the custom format picker. */
.vgext-rb-fmt-caret {
  width: 18px;
  margin-left: 2px;
  color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-rb-fmt-caret:hover,
.vgext-rb-fmt-caret.is-set {
  color: var(--vg-chrome-accent);
}
.vgext-rb-fmt-caret.is-set {
  background: color-mix(in srgb, var(--vg-chrome-accent) 16%, transparent);
}
.vgext-ip-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 70%, transparent);
}
.vgext-menu.vgext-rb-overflow-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 8px;
  max-height: min(70vh, 480px);
  overflow: auto;
  scrollbar-width: auto;
}
.vgext-rb-overflow-panel > .vgext-rb-grp,
.vgext-rb-overflow-panel > .vgext-es-seg {
  border-right: none;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 80%, transparent);
  border-radius: var(--vg-radius, 2px);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 3%, transparent);
  flex-wrap: wrap;
  max-width: min(360px, 80vw);
}
.vgext-rb-overflow-panel > .vgext-es-seg + .vgext-es-seg {
  margin-left: 0;
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 80%, transparent);
}
.vgext-rb-overflow-panel > .vgext-rb-grp .vgext-rb-grp-name { text-align: left; padding-top: 4px; }
.vgext-rb-overflow-empty {
  padding: 8px 10px;
  color: var(--vg-muted-fg-color, #7f8ba0);
  font-size: 12px;
}

/* Borders group — side segments with a "has border" dot, live preview chip,
   line-sample dropdown rows. */
.vgext-rb-bside { position: relative; }
.vgext-rb-bside.has-border::after {
  content: ''; position: absolute; right: 2px; top: 2px; width: 4px; height: 4px;
  border-radius: 50%; background: var(--vg-chrome-accent);
}
.vgext-rb-bpreview {
  width: 20px; height: 20px; margin-left: 4px; border-radius: 2px; align-self: center;
  border: 1px dashed color-mix(in srgb, var(--vg-muted-fg-color, #7f8ba0) 55%, transparent);
  box-sizing: border-box;
}
.vgext-rb-linesample {
  display: inline-block; width: 26px; height: 0;
  border-top: 1px solid currentColor; flex: 0 0 auto;
}
.vgext-rb-linesample[data-line-style="solid"] { border-top-style: solid; }
.vgext-rb-linesample[data-line-style="dashed"] { border-top-style: dashed; }
.vgext-rb-linesample[data-line-style="dotted"] { border-top-style: dotted; }
.vgext-rb-linesample[data-line-width="1"] { border-top-width: 1px; }
.vgext-rb-linesample[data-line-width="2"] { border-top-width: 2px; }
.vgext-rb-linesample[data-line-width="3"] { border-top-width: 3px; }
.vgext-rb-linesample[data-line-width="4"] { border-top-width: 4px; }

/* AB — header-caption uppercase toggle (text glyph, not an icon path). */
.vgext-rb-ab {
  width: auto; padding: 0 6px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
}
.vgext-rb-ab:disabled { opacity: 0.45; cursor: default; }

/* Cells↔Header / Selected↔All — icon-only (same footprint as .vgext-rb-btn). */
.vgext-rb-targettoggle {
  appearance: none; -webkit-appearance: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0; box-sizing: border-box;
  border: none; border-radius: 2px;
  background: transparent; color: var(--vg-chrome-accent);
  cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}
.vgext-rb-targettoggle:hover {
  background: var(--vg-row-alt-bg, rgba(255,255,255,0.07));
  color: var(--vg-chrome-accent);
}
.vgext-rb-targettoggle:focus-visible { outline: 2px solid var(--vg-chrome-accent); outline-offset: 1px; }
.vgext-rb-targettoggle.is-header {
  background: color-mix(in srgb, var(--vg-chrome-accent) 22%, transparent);
  color: var(--vg-chrome-accent);
}
.vgext-rb-selpill {
  max-width: 64px; min-width: 28px; padding: 0 6px;
  font-size: 11px; font-weight: 550;
}
.vgext-rb-selpill.vgext-rb-sel--need {
  outline: 2px solid var(--vg-chrome-accent);
  outline-offset: 1px;
}
.vgext-rb-selpill > span {
  overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.vgext-rb-btn, .vgext-rb-toggle {
  appearance: none; -webkit-appearance: none;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 2px; background: transparent;
  color: var(--vg-fg-color, #d3dbe7); cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}
.vgext-rb-btn:hover, .vgext-rb-toggle:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.07)); color: var(--vg-chrome-accent); }
.vgext-rb-btn:disabled, .vgext-rb-toggle:disabled { color: var(--vg-muted-fg-color, #9aa4b6); opacity: 0.45; cursor: default; }
.vgext-rb-btn:disabled:hover, .vgext-rb-toggle:disabled:hover { background: transparent; }

.vgext-rb-swatch { position: relative; }
.vgext-rb-swatch svg { transform: translateY(-1.5px); }
.vgext-rb-swatchbar {
  position: absolute; left: 5px; right: 5px; bottom: 3px; height: 3px;
  border-radius: 1.5px; pointer-events: none;
  background: var(--vgext-swatch, currentColor);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.18);
}
.vgext-rb-btn:focus-visible, .vgext-rb-toggle:focus-visible { outline: 2px solid var(--vg-chrome-accent); outline-offset: 1px; }
.vgext-rb-toggle.is-on { background: color-mix(in srgb, var(--vg-chrome-accent) 22%, transparent); color: var(--vg-chrome-accent); }

.vgext-rb-pill {
  appearance: none; -webkit-appearance: none;
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; box-sizing: border-box;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: 2px;
  background: var(--vg-control-bg, rgba(255,255,255,0.04));
  color: var(--vg-fg-color, #d6dce8); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
/* Author display on .vgext-rb-pill otherwise overrides the UA [hidden]
 * rule — the filter-type pill is gated with hidden while floating filter is off. */
.vgext-rb-pill[hidden] { display: none; }
.vgext-rb-pill:hover { border-color: var(--vg-chrome-accent); }
.vgext-rb-pill svg { color: var(--vg-muted-fg-color, #9aa4b6); }
.vgext-rb-pill.vgext-rb-danger { color: var(--vg-neg-color, #e5646e); border-color: color-mix(in srgb, var(--vg-neg-color, #e5646e) 45%, var(--vg-border-color, #2a3140)); }
.vgext-rb-pill.is-set { color: var(--vg-chrome-accent); }

.vgext-rb-input {
  appearance: none; -webkit-appearance: none;
  height: 24px; padding: 0 8px; box-sizing: border-box;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: 2px;
  background: var(--vg-control-bg, rgba(0,0,0,0.25)); color: var(--vg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.vgext-rb-input--sm { width: 44px; }
.vgext-rb-input--md { width: 96px; }
.vgext-rb-input:focus { outline: none; border-color: var(--vg-chrome-accent); }

.vgext-rb-stat { font-size: 12px; color: var(--vg-muted-fg-color, #7f8ba0); font-variant-numeric: tabular-nums; }

.vgext-rb-stepper {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 4px 0 8px; box-sizing: border-box;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: 2px;
  background: var(--vg-control-bg, rgba(255,255,255,0.04)); font-size: 12px; color: var(--vg-fg-color, #d6dce8);
}
.vgext-rb-step-stack { display: flex; flex-direction: column; }
.vgext-rb-step { appearance: none; -webkit-appearance: none; border: none; background: transparent; color: var(--vg-muted-fg-color, #9aa4b6); cursor: pointer; height: 10px; display: flex; align-items: center; padding: 0; }
.vgext-rb-step:hover { color: var(--vg-fg-color, #e5e9f0); }

.vgext-rb-colorinput { width: 0; height: 0; padding: 0; border: none; opacity: 0; position: absolute; pointer-events: none; }
.vgext-rb-colorpicker-host {
  position: absolute; width: 0; height: 0; overflow: hidden;
  margin: 0; padding: 0; border: none; pointer-events: none;
}

.vgext-rb-danger-btn { color: var(--vg-neg-color, #e5646e); }
.vgext-rb-danger-btn:hover { background: color-mix(in srgb, var(--vg-neg-color, #e5646e) 16%, transparent); color: var(--vg-neg-color, #e5646e); }

/* ── Icons section — tile picker · placement slot menu ─────────────────── */
/* Labeled trigger (target-toggle chrome): preview well + label + caret —
   the picker is a first-class control now, not an easy-to-miss glyph. */
.vgext-ip-open {
  appearance: none; -webkit-appearance: none;
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 7px 0 3px; box-sizing: border-box;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: 2px;
  background: transparent; color: var(--vg-fg-color, #d3dbe7);
  font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: border-color 110ms ease, background 110ms ease;
}
.vgext-ip-open:hover:not(:disabled) { border-color: var(--vg-chrome-accent); }
.vgext-ip-open:focus-visible { outline: 2px solid var(--vg-chrome-accent); outline-offset: 1px; }
.vgext-ip-open > svg:last-child { color: var(--vg-muted-fg-color, #7f8ba0); flex: 0 0 auto; }
.vgext-ip-well {
  width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 2px; font-size: 12px; line-height: 1;
  color: var(--vg-muted-fg-color, #7f8ba0);
  background: color-mix(in srgb, var(--vg-muted-fg-color, #7f8ba0) 10%, transparent);
}
.vgext-ip-well.has-icon {
  color: var(--vg-chrome-accent);
  background: color-mix(in srgb, var(--vg-chrome-accent) 14%, transparent);
}
.vgext-ip-open.is-open { border-color: var(--vg-chrome-accent); background: color-mix(in srgb, var(--vg-chrome-accent) 12%, transparent); }
.vgext-ip-open:disabled,
.vgext-rb-pill[data-ip="place"]:disabled,
.vgext-rb-btn[data-ip="color"]:disabled,
.vgext-rb-btn[data-ip="clear"]:disabled { opacity: 0.38; cursor: default; }
.vgext-ip-open:disabled:hover,
.vgext-rb-btn[data-ip="color"]:disabled:hover,
.vgext-rb-btn[data-ip="clear"]:disabled:hover { background: transparent; color: var(--vg-muted-fg-color, #9aa4b6); }
.vgext-rb-pill[data-ip="place"]:disabled:hover { border-color: var(--vg-border-color, #2a3140); }

.vgext-ip-panel {
  /* Body-mounted popup — declare the Inter stack explicitly (no inherited
     shell font out here; the browser default serif leaked through). */
  font-family: var(--vg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
  position: fixed; z-index: 1000; width: 340px; max-height: 428px;
  top: var(--vgext-menu-top, 0);
  left: var(--vgext-menu-left, 0);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--vg-popup-bg, #161b26); border: 1px solid var(--vg-border-color, #2a3140);
  border-radius: var(--vg-radius, 12px); box-shadow: 0 16px 40px rgba(0,0,0,0.5); padding: 10px;
}
.vgext-ip-panel[hidden] { display: none; }

.vgext-ip-searchwrap { position: relative; display: flex; align-items: center; margin-bottom: 8px; color: var(--vg-muted-fg-color, #7f8ba0); }
.vgext-ip-searchwrap > svg { position: absolute; left: 9px; pointer-events: none; }
.vgext-ip-search {
  appearance: none; -webkit-appearance: none;
  width: 100%; box-sizing: border-box; height: 30px; padding: 0 10px 0 30px;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: 2px;
  background: var(--vg-control-bg, rgba(0,0,0,0.25)); color: var(--vg-fg-color, #e5e9f0);
  font: inherit; font-size: 12.5px; transition: border-color 120ms ease, box-shadow 120ms ease;
}
.vgext-ip-search::placeholder { color: var(--vg-muted-fg-color, #7f8ba0); }
.vgext-ip-search:focus {
  outline: none; border-color: var(--vg-chrome-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-chrome-accent) 20%, transparent);
}
.vgext-ip-search::-webkit-search-cancel-button { appearance: none; }

.vgext-ip-scroll { overflow-y: auto; flex: 1 1 auto; margin: 0 -4px; padding: 0 4px;
  /* OS-native scrollbars — no ::-webkit-scrollbar / scrollbar-color theming. */
  scrollbar-width: auto;
}
.vgext-ip-cat {
  font-size: 10px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--vg-muted-fg-color, #7f8ba0); margin: 12px 2px 6px;
  position: sticky; top: 0; z-index: 1;
  background: linear-gradient(var(--vg-popup-bg, #161b26) 78%, transparent); padding: 3px 0 4px;
}
.vgext-ip-section:first-child .vgext-ip-cat { margin-top: 0; }

.vgext-ip-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.vgext-ip-tile {
  appearance: none; -webkit-appearance: none; border: none; border-radius: 2px; background: transparent;
  width: 100%; aspect-ratio: 1; display: inline-flex; align-items: center; justify-content: center;
  color: var(--vg-muted-fg-color, #9aa4b6); font-size: 15px; line-height: 1; cursor: pointer;
  transition: background 90ms ease, color 90ms ease, transform 90ms ease;
}
.vgext-ip-tile:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.08)); color: var(--vg-fg-color, #e5e9f0); transform: scale(1.14); }
.vgext-ip-tile:active { transform: scale(0.96); }
.vgext-ip-tile:focus-visible { outline: 2px solid var(--vg-chrome-accent); outline-offset: -2px; }

.vgext-ip-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 34px 0 30px; color: var(--vg-muted-fg-color, #7f8ba0); }
.vgext-ip-empty[hidden] { display: none; }
.vgext-ip-empty > svg { width: 22px; height: 22px; opacity: 0.55; }
.vgext-ip-empty-msg { font-size: 12px; }

/* Positioning/away/theming come from the shared .vgext-menu popup shell
   (ui.ts menu()); this class only adds the placemenu's own shape. */
.vgext-ip-placemenu {
  font-size: 12px; min-width: 158px;
  display: flex; flex-direction: column;
}
.vgext-ip-placehead {
  font-size: 9.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--vg-muted-fg-color, #7f8ba0); padding: 7px 8px 3px;
}
.vgext-ip-placehead:first-child { padding-top: 3px; }
.vgext-ip-placeitem {
  appearance: none; -webkit-appearance: none; border: none; background: transparent; border-radius: 2px;
  padding: 6px 10px; text-align: left; font: inherit; font-size: 12px;
  color: var(--vg-fg-color, #d6dce8); cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  transition: background 90ms ease, color 90ms ease;
}
.vgext-ip-placeitem:hover { background: color-mix(in srgb, var(--vg-chrome-accent) 18%, transparent); }
.vgext-ip-placeitem.is-active { color: var(--vg-chrome-accent); background: color-mix(in srgb, var(--vg-chrome-accent) 12%, transparent); }
.vgext-ip-placeitem.is-active::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--vg-chrome-accent); flex: 0 0 auto; }

/* Flat 2px chrome — beat UA button/input rounding on Windows/Chromium. */
.vgext-ribbon .vgext-rb-pill,
.vgext-ribbon .vgext-rb-input,
.vgext-ribbon .vgext-rb-stepper,
.vgext-ribbon .vgext-rb-targettoggle,
.vgext-ribbon .vgext-rb-btn,
.vgext-ribbon .vgext-rb-toggle,
.vgext-ribbon .vgext-ip-open,
.vgext-edit-strip .vgext-rb-pill,
.vgext-edit-strip .vgext-rb-input,
.vgext-edit-strip .vgext-rb-stepper {
  border-radius: 2px !important;
}
.vgext-elig-notice {
  position: fixed;
  z-index: 1200;
  max-width: 240px;
  padding: 6px 10px;
  font-family: var(--vg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--vg-fg-color, #e5e9f0);
  background: var(--vg-popup-bg, #161b26);
  border: 1px solid color-mix(in srgb, var(--vg-warning-color, #f0b429) 45%, var(--vg-border-color, #2a3140));
  border-radius: var(--vg-radius, 2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  animation: vgext-elig-fade 2200ms ease forwards;
}
@keyframes vgext-elig-fade {
  0% { opacity: 0; transform: translateY(-2px); }
  8% { opacity: 1; transform: translateY(0); }
  82% { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .vgext-elig-notice { animation: none; }
}
`;
