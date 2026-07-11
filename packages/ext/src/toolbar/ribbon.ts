/**
 * Formatting / editing ribbon for CGridExt — the dense multi-row toolbar
 * from the MarketsGrid reference. It renders as one strip in the shell's
 * `.cgext-ribbon` host, organised into labelled sections:
 *
 *   HISTORY · SMART · BULK        (edit ops on the current selection)
 *   SCOPE · type · B I U · align · size
 *   PAINT · fill
 *   FORMAT · EDIT · GROUP
 *   TEMPLATES
 *
 * Structural signature: each section leads with a small UPPERCASE label,
 * the way the reference encodes "what this cluster acts on". Colour comes
 * entirely from the grid's `--cg-*` theme tokens.
 *
 * This pass ships the full chrome (every section + control, themed and
 * laid out to match the reference) with the History undo/redo wired to the
 * kernel and the section-toggle plumbing live; the remaining controls carry
 * their real affordances and wire to their engines (format / edit / calc /
 * rules) as those module waves land — no control is faked to look enabled
 * when it isn't.
 */
import type { CgExtension, CgExtContext, ToolbarItem, ToolbarItemInstance, Unsub } from '../extension/types';
import { menu } from './ui';
import { injectTitleBarStyles } from './titleBar';
import type { EditBridgeHandle, SmartEditOp } from '@cgrid/edit';
import { createIconPicker, type IconPickerHandle, type IconSelection } from './iconPicker';
import { formatPickerMenu, type FormatPickerHost } from './formatPicker';
import { findPresetByFormat, type FormatDataType } from './formatPresets';
import { columnPanelMenu, effectiveFlag, aggFuncChoices, type ColumnConfigGrid, type ColumnPanelHost } from './columnPanel';

/** Lazily supplies the `@cgrid/edit` handle — the demo/consumer wires the
 *  edit engine after the grid is constructed, so the ribbon reads it on
 *  demand rather than capturing it at build time. */
export type EditHandleGetter = () => EditBridgeHandle | undefined;

const I = {
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  redo: 'M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8',
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
  popout: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
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
};

function svg(path: string, size = 14): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

/** ONE colour-picker control: swatch button (live colour bar under the
 *  glyph, Excel-style) + its hidden `<input type="color">`, with the
 *  click-to-open forwarding and bar repaint wired in. Every colour picker
 *  in the ribbon is built from this — hand-assembling the trio per site
 *  is how the border picker shipped with a dead swatch (no forwarding). */
function colorSwatch(icon: string, title: string, defaultColor: string): {
  button: HTMLButtonElement; input: HTMLInputElement;
} {
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'cgext-rb-colorinput';
  input.value = defaultColor;
  const button = iconBtn(icon, title);
  button.classList.add('cgext-rb-swatch');
  const bar = document.createElement('span');
  bar.className = 'cgext-rb-swatchbar';
  bar.style.background = input.value;
  button.append(bar);
  input.addEventListener('input', () => { bar.style.background = input.value; });
  input.addEventListener('change', () => { bar.style.background = input.value; });
  button.addEventListener('click', () => input.click());
  return { button, input };
}

/** ONE two-state labeled toggle (target-toggle chrome): the face shows the
 *  ACTIVE state's icon + label with trailing swap arrows; clicking flips.
 *  Both Target (Cells↔Header) and Scope (Selected↔All) are built from
 *  this — their construction + paint logic used to be duplicated inline. */
function stateToggle(opts: {
  rb: string;
  a: { icon: string; label: string };
  b: { icon: string; label: string };
  title: (isA: boolean) => string;
}): { el: HTMLButtonElement; paint: (isA: boolean) => void } {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'cgext-rb-targettoggle';
  el.dataset.rb = opts.rb;
  const paint = (isA: boolean): void => {
    const s = isA ? opts.a : opts.b;
    el.innerHTML = `${svg(s.icon, 14)}<span>${s.label}</span>${svg(I.swap, 11)}`;
    const title = opts.title(isA);
    el.title = title;
    el.setAttribute('aria-label', title);
    el.setAttribute('aria-pressed', String(!isA));
    el.classList.toggle('is-header', !isA);
  };
  return { el, paint };
}

/** Build the ribbon extension (one item at `ribbon.main`). Compose into
 *  `ext.extensions`. Toggle visibility via the `toggle-ribbon` ext event. */
export function ribbonExtensions(opts: { edit?: EditHandleGetter } = {}): CgExtension[] {
  injectRibbonStyles();
  return [ribbonItem(opts.edit)];
}

// ── small builders ──────────────────────────────────────────────────────
function h(cls: string, html?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
}
/** One horizontal run of small controls inside a group's deck. */
function mini(...children: HTMLElement[]): HTMLDivElement {
  const r = h('cgext-rb-mini'); r.append(...children); return r;
}
/** Excel-ribbon group: stacked mini-rows with the group name centered
 *  underneath, hairline-separated from its neighbours. */
function grp(name: string, ...rows: HTMLElement[]): HTMLDivElement {
  const g = h('cgext-rb-grp');
  const deck = h('cgext-rb-deck'); deck.append(...rows);
  g.append(deck, h('cgext-rb-grp-name', name));
  return g;
}
function iconBtn(icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cgext-rb-btn'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = svg(icon);
  return b;
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
    `<path d="${d}" fill="none" stroke="var(--cg-accent-color, #4f9cf9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const rows = kind === 'fewer'
    ? arrow('M9.5 4H1.5M4.5 1l-3 3 3 3') + digit(11.5, 7.5, '0') + digit(0.5, 17.5, '.00')
    : digit(0.5, 7.5, '.00') + arrow('M1.5 14h8M6.5 11l3 3-3 3') + digit(11.5, 17.5, '0');
  return `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">${rows}</svg>`;
}
function decimalBtn(kind: 'fewer' | 'more', title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cgext-rb-btn'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = decimalIcon(kind);
  return b;
}
function toggleBtn(icon: string, title: string): HTMLButtonElement {
  const b = iconBtn(icon, title); b.classList.add('cgext-rb-toggle'); return b;
}
function pill(text: string, caret = true): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cgext-rb-pill';
  b.innerHTML = `<span>${text}</span>` + (caret ? svg('M6 9l6 6 6-6', 12) : '');
  return b;
}
function textInput(placeholder: string, width = 70): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text'; i.className = 'cgext-rb-input'; i.placeholder = placeholder;
  i.style.width = `${width}px`;
  return i;
}
// Colour-picker defaults — the swatch a picker shows when the focused
// column has NO explicit colour of its own (refresh() reverts to these).
const DEFAULT_TEXT_COLOR = '#4fd1c5';
const DEFAULT_FILL_COLOR = '#12333a';
const DEFAULT_ICON_COLOR = '#4f9cf9';
const DEFAULT_BORDER_COLOR = '#2dd4bf';

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
  b.className = 'cgext-rb-toggle cgext-rb-bside';
  b.dataset.side = side;
  b.title = side === 'all' ? 'All borders' : `${side.charAt(0).toUpperCase()}${side.slice(1)} border`;
  b.innerHTML =
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">` +
    `<path d="M5 5h14v14H5z" stroke-width="1" opacity="0.35"/>` +
    `<path d="${BORDER_EDGE_PATHS[side]}" stroke-width="2.6"/></svg>`;
  return b;
}

function stat(text: string): HTMLSpanElement {
  const s = document.createElement('span'); s.className = 'cgext-rb-stat'; s.textContent = text; return s;
}

function ribbonItem(getEdit?: EditHandleGetter): ToolbarItem {
  return {
    id: 'ribbon', kind: 'toolbar-item', slot: 'ribbon.main', init() {},
    render(host: HTMLElement, ctx: CgExtContext): ToolbarItemInstance {
      // Excel-ribbon band: ONE horizontal strip of hairline-separated groups,
      // each a stacked deck of mini-rows with the group's name centered
      // underneath. Controls are captured by reference so the wire fns can
      // bind them to their engines (edit journal, calc editColumn).
      // Title-bar styles carry the shared `.cgext-menu*` popup rules the
      // border style/width dropdowns ride — inject for standalone ribbons.
      injectTitleBarStyles();
      const root = h('cgext-ribbon-band');

      // Editing cluster — HISTORY · SMART · BULK.
      const undo = iconBtn(I.undo, 'Undo');
      const redo = iconBtn(I.redo, 'Redo');
      const histCount = stat('0 entries');
      const operand = textInput('1', 44); operand.value = '1';
      const opMul = iconBtn('M6 6l12 12M18 6L6 18', 'Multiply');
      const opDiv = iconBtn('M5 12h14M12 6h.01M12 18h.01', 'Divide');
      const opAdd = iconBtn('M12 5v14M5 12h14', 'Add');
      const opSub = iconBtn('M5 12h14', 'Subtract');
      const setBtn = pill('Set…', false);
      const smartCount = stat('0 cells');
      const bulkValue = textInput('New value', 96);
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
      const selPill = pill('Select a cell', false);
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
      const borderPreview = h('cgext-rb-bpreview');
      borderPreview.title = 'Current borders';
      const { button: borderColorBtn, input: borderColorInput } =
        colorSwatch('M4 4h16v16H4zM12 12h.01', 'Border color', DEFAULT_BORDER_COLOR);
      const borderStylePill = pill('Solid');
      const borderWidthPill = pill('1 px');
      const borderClear = iconBtn(I.eraser, 'Remove the border at this side');

      // AB — header-caption case toggle (uppercase ⇄ original), all columns.
      const headerCase = document.createElement('button');
      headerCase.type = 'button';
      headerCase.className = 'cgext-rb-toggle cgext-rb-ab';
      headerCase.textContent = 'AB';
      const alignL = toggleBtn(I.alignLeft, 'Align left');
      const alignC = toggleBtn(I.alignCenter, 'Align center');
      const alignR = toggleBtn(I.alignRight, 'Align right');
      const sizeVal = document.createElement('span'); sizeVal.textContent = '12px';
      const sizeUp = document.createElement('button'); sizeUp.type = 'button'; sizeUp.className = 'cgext-rb-step'; sizeUp.title = 'Larger font'; sizeUp.innerHTML = svg('M6 15l6-6 6 6', 11);
      const sizeDn = document.createElement('button'); sizeDn.type = 'button'; sizeDn.className = 'cgext-rb-step'; sizeDn.title = 'Smaller font'; sizeDn.innerHTML = svg('M6 9l6 6 6-6', 11);
      const sizeWrap = h('cgext-rb-stepper');
      const sizeStack = h('cgext-rb-step-stack'); sizeStack.append(sizeUp, sizeDn);
      sizeWrap.append(sizeVal, sizeStack);

      // Paint — fg/bg colour pickers (share Formatting row A with Type/Icons).
      // Buttons carry a live swatch bar mirroring their hidden colour input.
      const { button: textColorBtn, input: textColorInput } =
        colorSwatch(I.paintText, 'Text color', DEFAULT_TEXT_COLOR);
      const { button: fillColorBtn, input: fillColorInput } =
        colorSwatch(I.fill, 'Fill color', DEFAULT_FILL_COLOR);
      // Icons — tile picker · colour · placement slot selector · clear. Icons
      // are column styling, so they share the Paint row. Placement is a SLOT
      // SELECTOR (see `wireFormattingToolbar`): the picker/colour/clear always
      // edit "the icon at the selected placement for the current target" — they
      // switch which slot is shown, never move an icon between slots.
      let iconApply: (sel: IconSelection) => void = () => {};
      const picker = createIconPicker({ onSelect: (sel) => iconApply(sel) });
      const { button: iconColorBtn, input: iconColorInput } =
        colorSwatch(I.paintText, 'Icon color', DEFAULT_ICON_COLOR);
      iconColorBtn.dataset.ip = 'color';
      const iconPlacePill = pill('Prefix'); iconPlacePill.dataset.ip = 'place';
      const iconClear = iconBtn(I.eraser, 'Clear icon at this placement'); iconClear.dataset.ip = 'clear';
      document.body.append(picker.panel);

      const fmtDollar = iconBtn(I.dollar, 'Currency format');
      const fmtPercent = iconBtn(I.percent, 'Percent format');
      const fmtThousands = iconBtn(I.hash, 'Thousands format');
      const decDown = decimalBtn('fewer', 'Fewer decimals');
      const decUp = decimalBtn('more', 'More decimals');
      const fmtCode = pill('# Format');
      const clear = pill('Clear', false); clear.classList.add('cgext-rb-danger');
      clear.title = 'Clear styling + format on the selected columns';
      const eraser = iconBtn(I.eraser, 'Clear formatting');
      const pop = iconBtn(I.popout, 'Pop out');
      pop.addEventListener('click', () => ctx.events.emit({ type: 'popout' }));

      // Column group — quick per-column configuration (spec 2026-07-08).
      const colOpen = document.createElement('button');
      colOpen.type = 'button';
      colOpen.className = 'cgext-ip-open'; // labeled-control chrome (well-less variant)
      colOpen.dataset.col = 'open';
      colOpen.innerHTML =
        `${svg(I.settings, 14)}<span>Column</span>` +
        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      const aggPill = pill('Σ None');
      aggPill.dataset.col = 'agg';
      const colFF = toggleBtn(I.filter, 'Floating filter');
      colFF.dataset.col = 'ff';
      const colGrp = toggleBtn(I.agg, 'Groupable');
      colGrp.dataset.col = 'grp';
      const colAggH = toggleBtn(I.rows, 'Show aggregation in header');
      colAggH.dataset.col = 'aggh';

      // Editing strip — a STANDALONE single-row toolbar rendered ABOVE the
      // ribbon band, not part of it: flat segments with inline labels
      // instead of the band's 2-deep group decks. Same control references,
      // so the edit-engine wiring below is unchanged; the
      // `[data-toolbar="editing"]` hook stays so the title-bar overflow
      // toggle keeps addressing it.
      const editStrip = h('cgext-edit-strip');
      editStrip.dataset.toolbar = 'editing';
      const seg = (label: string, ...controls: HTMLElement[]): HTMLElement => {
        const s = h('cgext-es-seg');
        const l = document.createElement('span');
        l.className = 'cgext-es-label';
        l.textContent = label;
        s.append(l, ...controls);
        return s;
      };
      editStrip.append(
        seg('History', undo, redo, histCount),
        seg('Smart edit', operand, opMul, opDiv, opAdd, opSub, setBtn, smartCount),
        seg('Bulk', bulkValue, bulkApply, bulkCount),
      );

      const formatting = h('cgext-rb-cluster'); formatting.dataset.toolbar = 'formatting';
      formatting.append(
        grp('Target', mini(selPill), mini(targetToggle, scopeToggle)),
        grp('Font', mini(bold, italic, underline, strike, sizeWrap), mini(textColorBtn, textColorInput, fillColorBtn, fillColorInput, headerCase)),
        grp('Alignment', mini(alignL, alignC, alignR)),
        grp('Borders',
          mini(borderSideBtns.all, borderSideBtns.top, borderSideBtns.bottom, borderSideBtns.left, borderSideBtns.right, borderPreview),
          mini(borderColorBtn, borderColorInput, borderStylePill, borderWidthPill, borderClear)),
        grp('Number', mini(fmtCode), mini(fmtDollar, fmtPercent, fmtThousands, decDown, decUp)),
        grp('Icons', mini(picker.button, iconPlacePill), mini(iconColorBtn, iconColorInput, iconClear)),
        grp('Column', mini(colOpen, aggPill), mini(colFF, colGrp, colAggH)),
        grp('Templates', mini(iconBtn(I.templates, 'Templates'), pill('', true)), mini(clear, eraser, dangerIcon(I.trash, 'Delete template'))),
      );

      const spacer = h('cgext-rb-spacer');
      root.append(formatting, spacer, pop);
      host.append(editStrip, root);

      const off = ctx.events.on('toggle-ribbon', (e) => {
        const section = (e as { section?: string }).section;
        if (section === 'edit') editStrip.hidden = !editStrip.hidden;
        else if (section === 'format') formatting.hidden = !formatting.hidden;
      });

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
        textColorBtn, textColorInput, fillColorBtn, fillColorInput, headerCase,
        borderSideBtns, borderPreview, borderColorBtn, borderColorInput,
        borderStylePill, borderWidthPill, borderClear,
        fmtDollar, fmtPercent, fmtThousands, decDown, decUp, fmtCode,
        clear, eraser,
        iconPicker: picker,
        setIconApply: (fn) => { iconApply = fn; },
        iconColorBtn, iconColorInput, iconPlacePill, iconClear,
        colOpen, aggPill, colFF, colGrp, colAggH,
      });

      return { destroy() { disposeEditing?.(); disposeFormatting(); picker.destroy(); off(); host.replaceChildren(); } };
    },
  };
}

function stepper(value: string): HTMLDivElement {
  const wrap = h('cgext-rb-stepper');
  const val = document.createElement('span'); val.textContent = value;
  const up = document.createElement('button'); up.type = 'button'; up.className = 'cgext-rb-step'; up.innerHTML = svg('M6 15l6-6 6 6', 11);
  const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'cgext-rb-step'; dn.innerHTML = svg('M6 9l6 6 6-6', 11);
  const stack = h('cgext-rb-step-stack'); stack.append(up, dn);
  wrap.append(val, stack);
  return wrap;
}
function dangerIcon(icon: string, title: string): HTMLButtonElement {
  const b = iconBtn(icon, title); b.classList.add('cgext-rb-danger-btn'); return b;
}

// ── Editing-toolbar wiring (@cgrid/edit bridge) ──────────────────────────
interface EditingRefs {
  undo: HTMLButtonElement; redo: HTMLButtonElement; histCount: HTMLElement;
  operand: HTMLInputElement; ops: Record<SmartEditOp, HTMLButtonElement>;
  smartCount: HTMLElement; bulkValue: HTMLInputElement; bulkApply: HTMLButtonElement; bulkCount: HTMLElement;
}

/** Bind the History / Smart / Bulk controls to the live `@cgrid/edit` handle:
 *  undo/redo through the journal (with reactive count + enablement), numeric
 *  ops and set-value across the current cell selection, and bulk set-value.
 *  Returns a disposer. */
function wireEditingToolbar(ctx: CgExtContext, getEdit: EditHandleGetter, r: EditingRefs): () => void {
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
    void e.smartEdit.collectTargets().then((t) => { if (t.length) void e.smartEdit.apply(t, op, operand); });
  };
  (Object.keys(r.ops) as SmartEditOp[]).forEach((op) => r.ops[op].addEventListener('click', () => runSmart(op)));

  r.bulkApply.addEventListener('click', () => {
    const e = getEdit(); if (!e) return;
    const raw = r.bulkValue.value;
    if (!raw.trim()) return;
    void e.bulkUpdate.collectTargets().then((t) => { if (t.length) void e.bulkUpdate.apply(t, raw); });
  });

  const refreshCounts = () => {
    const e = getEdit(); if (!e) return;
    void e.smartEdit.collectTargets().then((t) => {
      r.smartCount.textContent = `${t.length} ${t.length === 1 ? 'cell' : 'cells'}`;
      const none = t.length === 0;
      for (const op of Object.keys(r.ops) as SmartEditOp[]) r.ops[op].disabled = none;
    });
    void e.bulkUpdate.collectTargets().then((t) => {
      r.bulkCount.textContent = `${t.length} selected`;
      r.bulkApply.disabled = t.length === 0;
    });
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

// ── Formatting-toolbar wiring (column styling via @cgrid/calc editColumn) ──
interface FormattingRefs {
  targetToggle: HTMLButtonElement; scopeToggle: HTMLButtonElement; selPill: HTMLButtonElement;
  paintTargetToggle: (isCell: boolean) => void; paintScopeToggle: (isSelected: boolean) => void;
  bold: HTMLButtonElement; italic: HTMLButtonElement; underline: HTMLButtonElement; strike: HTMLButtonElement;
  alignL: HTMLButtonElement; alignC: HTMLButtonElement; alignR: HTMLButtonElement;
  sizeVal: HTMLElement; sizeUp: HTMLButtonElement; sizeDn: HTMLButtonElement;
  textColorBtn: HTMLButtonElement; textColorInput: HTMLInputElement;
  fillColorBtn: HTMLButtonElement; fillColorInput: HTMLInputElement;
  headerCase: HTMLButtonElement;
  borderSideBtns: Record<BorderSideKey, HTMLButtonElement>;
  borderPreview: HTMLElement;
  borderColorBtn: HTMLButtonElement; borderColorInput: HTMLInputElement;
  borderStylePill: HTMLButtonElement; borderWidthPill: HTMLButtonElement;
  borderClear: HTMLButtonElement;
  fmtDollar: HTMLButtonElement; fmtPercent: HTMLButtonElement; fmtThousands: HTMLButtonElement;
  decDown: HTMLButtonElement; decUp: HTMLButtonElement; fmtCode: HTMLButtonElement;
  clear: HTMLButtonElement; eraser: HTMLButtonElement;
  iconPicker: IconPickerHandle;
  setIconApply: (fn: (sel: IconSelection) => void) => void;
  iconColorBtn: HTMLButtonElement; iconColorInput: HTMLInputElement;
  iconPlacePill: HTMLButtonElement; iconClear: HTMLButtonElement;
  colOpen: HTMLButtonElement; aggPill: HTMLButtonElement;
  colFF: HTMLButtonElement; colGrp: HTMLButtonElement; colAggH: HTMLButtonElement;
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
function wireFormattingToolbar(ctx: CgExtContext, r: FormattingRefs): () => void {
  const disposers: Array<() => void> = [];
  const grid = ctx.grid as unknown as {
    getCellRanges(): Array<{ colIds: string[] }>;
    getFocusedCell(): { rowId: string; colId: string } | null;
    getColumnHeaderName(colId: string): string | undefined;
    editColumn(colId: string, patch: Record<string, unknown>): void;
    getTemplates(): Array<{ id: string; overrides: Record<string, unknown> }>;
    removeTemplate(colId: string, templateId: string): void;
    deleteTemplate(templateId: string): void;
    addEventListener(type: string, fn: () => void): Unsub;
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
    if (!cols.length) return;
    const key = target === 'header' ? 'headerStyle' : 'cellStyle';
    for (const colId of cols) {
      try { grid.editColumn(colId, { [key]: patch }); } catch { /* unknown column */ }
    }
    ctx.profiles.markDirty();
    refresh();
  };
  const applyFormat = (format: string): void => {
    const cols = targetCols();
    if (!cols.length) return;
    for (const colId of cols) {
      try { grid.editColumn(colId, { format }); } catch { /* non-compiling / unknown */ }
    }
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
    for (const colId of targetCols()) {
      try { grid.editColumn(colId, { format: null }); } catch { /* calc not wired */ }
    }
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
    r.selPill.querySelector('span')!.textContent = none
      ? 'Select a cell'
      : scope === 'all'
        ? `All columns (${cols.length})`
        : cols.length === 1
          ? (grid.getColumnHeaderName?.(cols[0]!) ?? cols[0]!)
          : `${cols.length} columns`;
    for (const b of [r.bold, r.italic, r.underline, r.strike, r.alignL, r.alignC, r.alignR,
      r.textColorBtn, r.fillColorBtn, r.fmtDollar, r.fmtPercent, r.fmtThousands,
      r.decDown, r.decUp, r.fmtCode, r.clear, r.eraser, r.sizeUp, r.sizeDn]) {
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

    // Colour swatches — read the column's own fg/bg back into the pickers
    // (the swatch bar repaints off the input event). Hex inputs can only
    // represent #rrggbb; token/var() values read as unset. A column WITHOUT
    // the setting reverts the picker to its default swatch, so the control
    // always shows the focused column's state, never the previous pick.
    const syncColor = (input: HTMLInputElement, value: unknown, fallback: string) => {
      const next = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
      if (input.value !== next) {
        input.value = next;
        input.dispatchEvent(new Event('input'));
      }
    };
    syncColor(r.textColorInput, s.fg, DEFAULT_TEXT_COLOR);
    syncColor(r.fillColorInput, s.bg, DEFAULT_FILL_COLOR);

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
      syncColor(r.borderColorInput, active?.color, DEFAULT_BORDER_COLOR);
      for (const el of [r.borderStylePill, r.borderWidthPill, r.borderClear, r.borderColorBtn]) el.disabled = none;
      const p = r.borderPreview.style;
      p.border = ''; p.borderTop = ''; p.borderRight = ''; p.borderBottom = ''; p.borderLeft = '';
      const css = (sd?: { width?: number; style?: string; color?: string }) =>
        sd ? `${sd.width ?? 1}px ${sd.style ?? 'solid'} ${sd.color ?? DEFAULT_BORDER_COLOR}` : '';
      if (bSpec.all) p.border = css(bSpec.all);
      if (bSpec.top) p.borderTop = css(bSpec.top);
      if (bSpec.bottom) p.borderBottom = css(bSpec.bottom);
      if (bSpec.left) p.borderLeft = css(bSpec.left);
      if (bSpec.right) p.borderRight = css(bSpec.right);
    }

    // Column group — quick toggles + agg pill mirror the focused column.
    // `colOpen` stays enabled even with no target: the popover's own
    // "Select a cell or column first" hint explains the empty state instead
    // of a disabled trigger silently doing nothing.
    const colFirst = cols[0];
    r.aggPill.disabled = none;
    for (const b of [r.colFF, r.colGrp, r.colAggH]) b.disabled = none;
    if (!none && colFirst) {
      const cg = grid as unknown as ColumnConfigGrid;
      r.colFF.classList.toggle('is-on', !!effectiveFlag(cg, colFirst, 'floatingFilter'));
      r.colGrp.classList.toggle('is-on', !!effectiveFlag(cg, colFirst, 'enableRowGroup'));
      r.colAggH.classList.toggle('is-on', !effectiveFlag(cg, colFirst, 'suppressAggFuncInHeader'));
      let agg: string | undefined;
      try { agg = cg.getValueColumns().find((v) => v.colId === colFirst)?.aggFunc; } catch { /* absent */ }
      r.aggPill.querySelector('span')!.textContent = `Σ ${agg ?? 'None'}`;
      r.aggPill.classList.toggle('is-set', agg !== undefined);
    } else {
      r.aggPill.querySelector('span')!.textContent = 'Σ None';
      r.aggPill.classList.remove('is-set');
      for (const b of [r.colFF, r.colGrp, r.colAggH]) b.classList.remove('is-on');
    }

    // # Format pill caption tracks the target column's current format.
    const fmt = currentFormat();
    const label = fmt === undefined
      ? 'Format'
      : findPresetByFormat(fmt)?.label ?? (fmt.length > 18 ? `${fmt.slice(0, 17)}…` : fmt);
    const captionEl = r.fmtCode.querySelector('span');
    if (captionEl) captionEl.textContent = `# ${label}`;
    r.fmtCode.classList.toggle('is-set', fmt !== undefined);

    // Icons — reflect the selected slot into the picker preview + enablement.
    const slot = none ? null : currentIconSlot();
    r.iconPicker.setPreview(slot);
    const emojiSel = slot !== null && slot.emoji !== undefined;
    r.iconColorBtn.disabled = none || emojiSel; // color is SVG-only
    r.iconClear.disabled = none || slot === null;
    r.iconPicker.button.disabled = none;
    r.iconPlacePill.disabled = none;
    // Icon colour reverts to its default swatch when the slot has none.
    syncColor(r.iconColorInput, slot?.color, DEFAULT_ICON_COLOR);
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
    const color = sel?.name ? r.iconColorInput.value : undefined; // color is SVG-only
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
        if (typeof moving.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(moving.color)) {
          r.iconColorInput.value = moving.color; // carry the tint along
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
    list.className = 'cgext-ip-placemenu';
    list.setAttribute('role', 'menu');
    for (const [heading, entries] of PLACE_GROUPS) {
      const head = document.createElement('div');
      head.className = 'cgext-ip-placehead';
      head.textContent = heading;
      list.append(head);
      for (const [value, itemLabel] of entries) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'cgext-ip-placeitem' + (value === placement ? ' is-active' : '');
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

  r.iconColorInput.addEventListener('change', () => {
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

  // Paint: fg / bg via native color inputs
  r.textColorInput.addEventListener('change', () => applyStyle({ fg: r.textColorInput.value }));
  r.fillColorInput.addEventListener('change', () => applyStyle({ bg: r.fillColorInput.value }));

  // Format presets + decimals (cell data only — formats don't apply to headers)
  const decimalsOf = (fmt: string | undefined): number => {
    const m = /\.(0+)/.exec(fmt ?? '');
    return m ? m[1]!.length : 2;
  };
  const numberFormat = (decimals: number): string =>
    decimals <= 0 ? '#,##0' : `#,##0.${'0'.repeat(decimals)}`;
  r.fmtDollar.addEventListener('click', () => applyFormat(`$${numberFormat(decimalsOf(currentFormat()))}`));
  r.fmtPercent.addEventListener('click', () => applyFormat('0.00%'));
  r.fmtThousands.addEventListener('click', () => applyFormat(numberFormat(decimalsOf(currentFormat()))));
  r.decDown.addEventListener('click', () => applyFormat(numberFormat(decimalsOf(currentFormat()) - 1)));
  r.decUp.addEventListener('click', () => applyFormat(numberFormat(decimalsOf(currentFormat()) + 1)));
  r.fmtCode.addEventListener('click', () => fmtPicker.toggle());

  // Clear: drop the target columns' own templates (styling + format)
  const clearFormatting = () => {
    const cols = targetCols();
    for (const colId of cols) {
      const ownId = `__cgridOwn:${colId}`;
      try { grid.removeTemplate(colId, ownId); } catch { /* not assigned */ }
      try { grid.deleteTemplate(ownId); } catch { /* not present */ }
    }
    if (cols.length) { ctx.profiles.markDirty(); refresh(); }
  };
  r.clear.addEventListener('click', clearFormatting);
  r.eraser.addEventListener('click', clearFormatting);

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
    spec[borderSide] = { width: borderWidthVal, style: borderStyleVal, color: r.borderColorInput.value };
    applyStyle({ border: spec });
  };

  for (const side of Object.keys(r.borderSideBtns) as BorderSideKey[]) {
    r.borderSideBtns[side].addEventListener('click', () => { borderSide = side; refresh(); });
  }
  r.borderColorInput.addEventListener('change', applyBorderEdit);
  const lineSampleItem = (label: string, sampleCss: string, onPick: () => void): HTMLButtonElement => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'cgext-menu-item';
    it.innerHTML = `<span class="cgext-rb-linesample" style="${sampleCss}"></span><span></span>`;
    it.querySelector('span:last-child')!.textContent = label;
    it.addEventListener('click', onPick);
    return it;
  };
  const borderStyleMenu = menu(r.borderStylePill, (close) => {
    const list = h('cgext-menu-list');
    for (const styleOpt of ['solid', 'dashed', 'dotted'] as const) {
      list.appendChild(lineSampleItem(
        styleOpt.charAt(0).toUpperCase() + styleOpt.slice(1),
        `border-top-style:${styleOpt}`,
        () => { borderStyleVal = styleOpt; applyBorderEdit(); close(); },
      ));
    }
    return list;
  });
  r.borderStylePill.addEventListener('click', () => borderStyleMenu.toggle());
  disposers.push(() => borderStyleMenu.destroy());
  const borderWidthMenu = menu(r.borderWidthPill, (close) => {
    const list = h('cgext-menu-list');
    for (const w of [1, 2, 3, 4]) {
      list.appendChild(lineSampleItem(`${w} px`, `border-top-width:${w}px`,
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
    for (const colId of allCols()) {
      try { grid.editColumn(colId, { headerStyle: { textTransform: next } }); } catch { /* unknown column */ }
    }
    ctx.profiles.markDirty();
    refresh();
  });

  // ── Column group — popover + agg pill + quick toggles ────────────────────
  const colGrid = grid as unknown as ColumnConfigGrid;
  const colHost: ColumnPanelHost = { targetCols, grid: colGrid, onApplied: () => { ctx.profiles.markDirty(); refresh(); } };
  const colPanel = columnPanelMenu(r.colOpen, colHost);
  r.colOpen.addEventListener('click', () => colPanel.toggle());
  disposers.push(() => colPanel.destroy());

  const aggOfFirst = (): string | undefined => {
    const c = targetCols()[0];
    if (!c) return undefined;
    try { return colGrid.getValueColumns().find((v) => v.colId === c)?.aggFunc; } catch { return undefined; }
  };
  const aggMenu = menu(r.aggPill, (close) => {
    const list = h('cgext-menu-list');
    for (const v of ['none', ...aggFuncChoices(colGrid)]) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'cgext-menu-item' + ((aggOfFirst() ?? 'none') === v ? ' is-active' : '');
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
      for (const colId of targetCols()) {
        try { grid.editColumn(colId, patch(next)); } catch { /* unknown column */ }
      }
      ctx.profiles.markDirty();
      refresh();
    });
  };
  quickFlag(r.colFF, 'floatingFilter', (next) => ({ floatingFilter: next }));
  quickFlag(r.colGrp, 'enableRowGroup', (next) => ({ enableRowGroup: next }));
  r.colAggH.addEventListener('click', () => {
    const first = targetCols()[0];
    if (!first) return;
    const next = !effectiveFlag(colGrid, first, 'suppressAggFuncInHeader'); // toggle suppress
    for (const colId of targetCols()) {
      try { grid.editColumn(colId, { suppressAggFuncInHeader: next }); } catch { /* unknown column */ }
    }
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
  if (document.getElementById('cgext-ribbon-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-ribbon-styles';
  style.textContent = RIBBON_CSS;
  document.head.appendChild(style);
}

const RIBBON_CSS = `
.cgext-ribbon { flex: 0 0 auto; background: var(--cg-header-bg, var(--cg-popup-bg, #141922)); border-bottom: 1px solid var(--cg-border-color, #2a3140); }
/* ONE font size for every element in the bar (user request): controls,
   labels, stats, and captions all read at 12px. */
.cgext-ribbon-band, .cgext-edit-strip { font-size: 12px; }
.cgext-ribbon-band { display: flex; align-items: stretch; padding: 4px 8px 2px; box-sizing: border-box; }
.cgext-rb-cluster { display: flex; align-items: stretch; }
.cgext-rb-cluster[hidden] { display: none; }

/* The ribbon item renders TWO stacked strips (edit strip above the band);
   the shell's generic toolbar-item host is inline-flex ROW, so re-scope it
   to a column inside the ribbon slot. */
.cgext-ribbon .cgext-toolbar-item { display: flex; flex-direction: column; align-items: stretch; }

/* Editing strip — standalone single-row toolbar ABOVE the ribbon band. */
.cgext-edit-strip {
  display: flex; align-items: center; gap: 0;
  padding: 4px 11px;
  border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 70%, transparent);
}
.cgext-edit-strip[hidden] { display: none; }
.cgext-es-seg { display: inline-flex; align-items: center; gap: 3px; }
.cgext-es-seg + .cgext-es-seg {
  margin-left: 14px; padding-left: 14px;
  border-left: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 70%, transparent);
}
.cgext-es-label {
  font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #7f8ba0); margin-right: 6px; white-space: nowrap;
}
.cgext-es-seg > .cgext-rb-stat { margin-left: 5px; }
.cgext-rb-grp {
  display: flex; flex-direction: column; padding: 0 9px;
  border-right: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 70%, transparent);
}
.cgext-rb-cluster > .cgext-rb-grp:first-child { padding-left: 3px; }
.cgext-rb-cluster[data-toolbar="formatting"] > .cgext-rb-grp:last-child { border-right: none; }
.cgext-rb-deck { display: flex; flex-direction: column; gap: 3px; justify-content: center; flex: 1 1 auto; }
.cgext-rb-mini { display: flex; align-items: center; gap: 2px; }
.cgext-rb-mini > .cgext-rb-pill:first-child:last-child { flex: 1 1 auto; }
.cgext-rb-grp-name {
  padding: 3px 0 1px; text-align: center;
  font-size: 12px; color: var(--cg-muted-fg-color, #7f8ba0);
  white-space: nowrap;
}
.cgext-rb-spacer { flex: 1 1 auto; }

/* Borders group — side segments with a "has border" dot, live preview chip,
   line-sample dropdown rows. */
.cgext-rb-bside { position: relative; }
.cgext-rb-bside.has-border::after {
  content: ''; position: absolute; right: 2px; top: 2px; width: 4px; height: 4px;
  border-radius: 50%; background: var(--cg-accent-color, #4f9cf9);
}
.cgext-rb-bpreview {
  width: 20px; height: 20px; margin-left: 4px; border-radius: var(--cg-radius, 4px); align-self: center;
  border: 1px dashed color-mix(in srgb, var(--cg-muted-fg-color, #7f8ba0) 55%, transparent);
  box-sizing: border-box;
}
.cgext-rb-linesample {
  display: inline-block; width: 26px; height: 0;
  border-top: 1px solid currentColor; flex: 0 0 auto;
}

/* AB — header-caption uppercase toggle (text glyph, not an icon path). */
.cgext-rb-ab {
  width: auto; padding: 0 6px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
}
.cgext-rb-ab:disabled { opacity: 0.45; cursor: default; }

/* Cell↔header target toggle — the face shows the ACTIVE target, the
   trailing swap arrows signal "click to switch". */
.cgext-rb-targettoggle {
  appearance: none; display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 8px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 6px);
  background: transparent; color: var(--cg-fg-color, #d3dbe7);
  font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: border-color 110ms ease, background 110ms ease;
}
.cgext-rb-targettoggle:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-rb-targettoggle:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-rb-targettoggle > svg:first-child { color: var(--cg-accent-color, #4f9cf9); }
.cgext-rb-targettoggle > svg:last-child { color: var(--cg-muted-fg-color, #7f8ba0); }
.cgext-rb-targettoggle.is-header {
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 10%, transparent);
}
.cgext-ribbon-band > .cgext-rb-btn { align-self: flex-start; margin-top: 2px; }

.cgext-rb-btn, .cgext-rb-toggle {
  appearance: none; width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--cg-radius, 5px); background: transparent;
  color: var(--cg-fg-color, #d3dbe7); cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}
.cgext-rb-btn:hover, .cgext-rb-toggle:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.07)); color: var(--cg-accent-color, #4f9cf9); }
.cgext-rb-btn:disabled, .cgext-rb-toggle:disabled { color: var(--cg-muted-fg-color, #9aa4b6); opacity: 0.45; cursor: default; }
.cgext-rb-btn:disabled:hover, .cgext-rb-toggle:disabled:hover { background: transparent; }

.cgext-rb-swatch { position: relative; }
.cgext-rb-swatch svg { transform: translateY(-1.5px); }
.cgext-rb-swatchbar {
  position: absolute; left: 5px; right: 5px; bottom: 3px; height: 3px;
  border-radius: var(--cg-radius, 1.5px); pointer-events: none;
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.18);
}
.cgext-rb-btn:focus-visible, .cgext-rb-toggle:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-rb-toggle.is-on { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 22%, transparent); color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-pill {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 6px);
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #d6dce8); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.cgext-rb-pill:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-rb-pill svg { color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-rb-pill.cgext-rb-danger { color: var(--cg-neg-color, #e5646e); border-color: color-mix(in srgb, var(--cg-neg-color, #e5646e) 45%, var(--cg-border-color, #2a3140)); }
.cgext-rb-pill.is-set { color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-input {
  height: 24px; padding: 0 8px; box-sizing: border-box;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 6px);
  background: var(--cg-control-bg, rgba(0,0,0,0.25)); color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.cgext-rb-input:focus { outline: none; border-color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-stat { font-size: 12px; color: var(--cg-muted-fg-color, #7f8ba0); font-variant-numeric: tabular-nums; }

.cgext-rb-stepper {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 4px 0 8px; box-sizing: border-box;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 6px);
  background: var(--cg-control-bg, rgba(255,255,255,0.04)); font-size: 12px; color: var(--cg-fg-color, #d6dce8);
}
.cgext-rb-step-stack { display: flex; flex-direction: column; }
.cgext-rb-step { appearance: none; border: none; background: transparent; color: var(--cg-muted-fg-color, #9aa4b6); cursor: pointer; height: 10px; display: flex; align-items: center; padding: 0; }
.cgext-rb-step:hover { color: var(--cg-fg-color, #e5e9f0); }

.cgext-rb-colorinput { width: 0; height: 0; padding: 0; border: none; opacity: 0; position: absolute; pointer-events: none; }

.cgext-rb-danger-btn { color: var(--cg-neg-color, #e5646e); }
.cgext-rb-danger-btn:hover { background: color-mix(in srgb, var(--cg-neg-color, #e5646e) 16%, transparent); color: var(--cg-neg-color, #e5646e); }

/* ── Icons section — tile picker · placement slot menu ─────────────────── */
/* Labeled trigger (target-toggle chrome): preview well + label + caret —
   the picker is a first-class control now, not an easy-to-miss glyph. */
.cgext-ip-open {
  appearance: none; display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 7px 0 3px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 6px);
  background: transparent; color: var(--cg-fg-color, #d3dbe7);
  font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: border-color 110ms ease, background 110ms ease;
}
.cgext-ip-open:hover:not(:disabled) { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-ip-open:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-ip-open > svg:last-child { color: var(--cg-muted-fg-color, #7f8ba0); flex: 0 0 auto; }
.cgext-ip-well {
  width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--cg-radius, 4px); font-size: 12px; line-height: 1;
  color: var(--cg-muted-fg-color, #7f8ba0);
  background: color-mix(in srgb, var(--cg-muted-fg-color, #7f8ba0) 10%, transparent);
}
.cgext-ip-well.has-icon {
  color: var(--cg-accent-color, #4f9cf9);
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 14%, transparent);
}
.cgext-ip-open.is-open { border-color: var(--cg-accent-color, #4f9cf9); background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent); }
.cgext-ip-open:disabled,
.cgext-rb-pill[data-ip="place"]:disabled,
.cgext-rb-btn[data-ip="color"]:disabled,
.cgext-rb-btn[data-ip="clear"]:disabled { opacity: 0.38; cursor: default; }
.cgext-ip-open:disabled:hover,
.cgext-rb-btn[data-ip="color"]:disabled:hover,
.cgext-rb-btn[data-ip="clear"]:disabled:hover { background: transparent; color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-rb-pill[data-ip="place"]:disabled:hover { border-color: var(--cg-border-color, #2a3140); }

.cgext-ip-panel {
  /* Body-mounted popup — declare the Inter stack explicitly (no inherited
     shell font out here; the browser default serif leaked through). */
  font-family: var(--cg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
  position: fixed; z-index: 1000; width: 340px; max-height: 428px;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--cg-popup-bg, #161b26); border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: var(--cg-radius, 12px); box-shadow: 0 16px 40px rgba(0,0,0,0.5); padding: 10px;
}
.cgext-ip-panel[hidden] { display: none; }

.cgext-ip-searchwrap { position: relative; display: flex; align-items: center; margin-bottom: 8px; color: var(--cg-muted-fg-color, #7f8ba0); }
.cgext-ip-searchwrap > svg { position: absolute; left: 9px; pointer-events: none; }
.cgext-ip-search {
  width: 100%; box-sizing: border-box; height: 30px; padding: 0 10px 0 30px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: var(--cg-radius, 8px);
  background: var(--cg-control-bg, rgba(0,0,0,0.25)); color: var(--cg-fg-color, #e5e9f0);
  font: inherit; font-size: 12.5px; transition: border-color 120ms ease, box-shadow 120ms ease;
}
.cgext-ip-search::placeholder { color: var(--cg-muted-fg-color, #7f8ba0); }
.cgext-ip-search:focus {
  outline: none; border-color: var(--cg-accent-color, #4f9cf9);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 20%, transparent);
}
.cgext-ip-search::-webkit-search-cancel-button { appearance: none; }

.cgext-ip-scroll { overflow-y: auto; flex: 1 1 auto; margin: 0 -4px; padding: 0 4px;
  /* Theme-aware scrollbar (Firefox) — muted thumb over a transparent track
     in both modes; the raw browser default painted a glaring white rail on
     dark themes. */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--cg-muted-fg-color, #7f8ba0) 55%, transparent) transparent;
}
/* Theme-aware scrollbar (WebKit/Chromium). */
.cgext-ip-scroll::-webkit-scrollbar { width: 10px; }
.cgext-ip-scroll::-webkit-scrollbar-track { background: transparent; }
.cgext-ip-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--cg-muted-fg-color, #7f8ba0) 45%, transparent);
  border-radius: var(--cg-radius, 5px);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.cgext-ip-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--cg-muted-fg-color, #7f8ba0) 70%, transparent);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.cgext-ip-cat {
  font-size: 10px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #7f8ba0); margin: 12px 2px 6px;
  position: sticky; top: 0; z-index: 1;
  background: linear-gradient(var(--cg-popup-bg, #161b26) 78%, transparent); padding: 3px 0 4px;
}
.cgext-ip-section:first-child .cgext-ip-cat { margin-top: 0; }

.cgext-ip-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.cgext-ip-tile {
  appearance: none; border: none; border-radius: var(--cg-radius, 7px); background: transparent;
  width: 100%; aspect-ratio: 1; display: inline-flex; align-items: center; justify-content: center;
  color: var(--cg-muted-fg-color, #9aa4b6); font-size: 15px; line-height: 1; cursor: pointer;
  transition: background 90ms ease, color 90ms ease, transform 90ms ease;
}
.cgext-ip-tile:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.08)); color: var(--cg-fg-color, #e5e9f0); transform: scale(1.14); }
.cgext-ip-tile:active { transform: scale(0.96); }
.cgext-ip-tile:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: -2px; }

.cgext-ip-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 34px 0 30px; color: var(--cg-muted-fg-color, #7f8ba0); }
.cgext-ip-empty[hidden] { display: none; }
.cgext-ip-empty > svg { width: 22px; height: 22px; opacity: 0.55; }
.cgext-ip-empty-msg { font-size: 12px; }

/* Positioning/away/theming come from the shared .cgext-menu popup shell
   (ui.ts menu()); this class only adds the placemenu's own shape. */
.cgext-ip-placemenu {
  font-size: 12px; min-width: 158px;
  display: flex; flex-direction: column;
}
.cgext-ip-placehead {
  font-size: 9.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #7f8ba0); padding: 7px 8px 3px;
}
.cgext-ip-placehead:first-child { padding-top: 3px; }
.cgext-ip-placeitem {
  appearance: none; border: none; background: transparent; border-radius: var(--cg-radius, 6px);
  padding: 6px 10px; text-align: left; font: inherit; font-size: 12px;
  color: var(--cg-fg-color, #d6dce8); cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  transition: background 90ms ease, color 90ms ease;
}
.cgext-ip-placeitem:hover { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 18%, transparent); }
.cgext-ip-placeitem.is-active { color: var(--cg-accent-color, #4f9cf9); background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent); }
.cgext-ip-placeitem.is-active::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--cg-accent-color, #4f9cf9); flex: 0 0 auto; }
`;
