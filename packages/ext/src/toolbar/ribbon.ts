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
import type { EditBridgeHandle, SmartEditOp } from '@cgrid/edit';
import { createIconPicker, type IconPickerHandle, type IconSelection } from './iconPicker';
import { formatPickerMenu, type FormatPickerHost } from './formatPicker';
import { findPresetByFormat, type FormatDataType } from './formatPresets';

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

/** Icon button carrying a live colour swatch bar under the glyph (Excel-
 *  style): the bar mirrors the paired `<input type="color">` so the button
 *  itself shows what colour a click will apply. */
function swatchBtn(icon: string, title: string, input: HTMLInputElement): HTMLButtonElement {
  const b = iconBtn(icon, title);
  b.classList.add('cgext-rb-swatch');
  const bar = document.createElement('span');
  bar.className = 'cgext-rb-swatchbar';
  bar.style.background = input.value;
  b.append(bar);
  input.addEventListener('input', () => { bar.style.background = input.value; });
  input.addEventListener('change', () => { bar.style.background = input.value; });
  return b;
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
      // Single cell↔header target toggle: the button's face IS the current
      // target (icon + label), the trailing swap arrows say "click to
      // switch". Painted + wired in wireFormattingToolbar.
      const targetToggle = document.createElement('button');
      targetToggle.type = 'button';
      targetToggle.className = 'cgext-rb-targettoggle';
      targetToggle.dataset.rb = 'target';
      // Scope toggle (same anatomy): whether ribbon settings apply to the
      // SELECTED column(s) or to ALL columns.
      const scopeToggle = document.createElement('button');
      scopeToggle.type = 'button';
      scopeToggle.className = 'cgext-rb-targettoggle';
      scopeToggle.dataset.rb = 'scope';
      const selPill = pill('Select a cell', false);
      const bold = toggleBtn(I.bold, 'Bold');
      const italic = toggleBtn(I.italic, 'Italic');
      const underline = toggleBtn(I.underline, 'Underline');
      const strike = toggleBtn(I.strikethrough, 'Strikethrough');
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
      const textColorInput = document.createElement('input');
      textColorInput.type = 'color'; textColorInput.className = 'cgext-rb-colorinput'; textColorInput.value = DEFAULT_TEXT_COLOR;
      const fillColorInput = document.createElement('input');
      fillColorInput.type = 'color'; fillColorInput.className = 'cgext-rb-colorinput'; fillColorInput.value = DEFAULT_FILL_COLOR;
      const textColorBtn = swatchBtn(I.paintText, 'Text color', textColorInput);
      const fillColorBtn = swatchBtn(I.fill, 'Fill color', fillColorInput);
      // Icons — tile picker · colour · placement slot selector · clear. Icons
      // are column styling, so they share the Paint row. Placement is a SLOT
      // SELECTOR (see `wireFormattingToolbar`): the picker/colour/clear always
      // edit "the icon at the selected placement for the current target" — they
      // switch which slot is shown, never move an icon between slots.
      let iconApply: (sel: IconSelection) => void = () => {};
      const picker = createIconPicker({ onSelect: (sel) => iconApply(sel) });
      const iconColorInput = document.createElement('input');
      iconColorInput.type = 'color'; iconColorInput.className = 'cgext-rb-colorinput'; iconColorInput.value = DEFAULT_ICON_COLOR;
      const iconColorBtn = swatchBtn(I.paintText, 'Icon color', iconColorInput);
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
        grp('Font', mini(bold, italic, underline, strike, sizeWrap), mini(textColorBtn, textColorInput, fillColorBtn, fillColorInput)),
        grp('Alignment', mini(alignL, alignC, alignR)),
        grp('Number', mini(fmtCode), mini(fmtDollar, fmtPercent, fmtThousands, decDown, decUp)),
        grp('Icons', mini(picker.button, iconPlacePill), mini(iconColorBtn, iconColorInput, iconClear)),
        grp('Edit', mini(iconBtn(I.edit, 'Editor'), pill('None')), mini(iconBtn(I.filter, 'Filter'), pill('None'), iconBtn(I.filterOff, 'Clear filter'))),
        grp('Group', mini(iconBtn(I.agg, 'Aggregation'), pill('None')), mini(iconBtn(I.settings, 'Group settings'))),
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
        bold, italic, underline, strike, alignL, alignC, alignR,
        sizeVal, sizeUp, sizeDn,
        textColorBtn, textColorInput, fillColorBtn, fillColorInput,
        fmtDollar, fmtPercent, fmtThousands, decDown, decUp, fmtCode,
        clear, eraser,
        iconPicker: picker,
        setIconApply: (fn) => { iconApply = fn; },
        iconColorBtn, iconColorInput, iconPlacePill, iconClear,
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
  bold: HTMLButtonElement; italic: HTMLButtonElement; underline: HTMLButtonElement; strike: HTMLButtonElement;
  alignL: HTMLButtonElement; alignC: HTMLButtonElement; alignR: HTMLButtonElement;
  sizeVal: HTMLElement; sizeUp: HTMLButtonElement; sizeDn: HTMLButtonElement;
  textColorBtn: HTMLButtonElement; textColorInput: HTMLInputElement;
  fillColorBtn: HTMLButtonElement; fillColorInput: HTMLInputElement;
  fmtDollar: HTMLButtonElement; fmtPercent: HTMLButtonElement; fmtThousands: HTMLButtonElement;
  decDown: HTMLButtonElement; decUp: HTMLButtonElement; fmtCode: HTMLButtonElement;
  clear: HTMLButtonElement; eraser: HTMLButtonElement;
  iconPicker: IconPickerHandle;
  setIconApply: (fn: (sel: IconSelection) => void) => void;
  iconColorBtn: HTMLButtonElement; iconColorInput: HTMLInputElement;
  iconPlacePill: HTMLButtonElement; iconClear: HTMLButtonElement;
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

  // Target toggle (cell vs header styling) — ONE button whose face shows
  // the ACTIVE target; clicking flips it. `aria-pressed` reflects the
  // non-default (header) state for AT users.
  const paintTarget = () => {
    const isCell = target === 'cell';
    r.targetToggle.innerHTML =
      `${svg(isCell ? I.grid : I.rows, 14)}<span>${isCell ? 'Cells' : 'Header'}</span>${svg(I.swap, 11)}`;
    const title = `Styling target: ${isCell ? 'Cells' : 'Header'} — click to switch to ${isCell ? 'Header' : 'Cells'}`;
    r.targetToggle.title = title;
    r.targetToggle.setAttribute('aria-label', title);
    r.targetToggle.setAttribute('aria-pressed', String(!isCell));
    r.targetToggle.classList.toggle('is-header', !isCell);
  };
  const setTarget = (t: 'cell' | 'header') => {
    target = t;
    paintTarget();
    refresh();
  };
  paintTarget();
  r.targetToggle.addEventListener('click', () => setTarget(target === 'cell' ? 'header' : 'cell'));

  // Scope toggle (selected column(s) vs ALL columns) — same anatomy as the
  // target toggle: the face is the ACTIVE scope, arrows say "click to
  // switch". `aria-pressed` reflects the non-default (all) state.
  const paintScope = () => {
    const isSel = scope === 'selected';
    r.scopeToggle.innerHTML =
      `${svg(isSel ? I.selection : I.columns, 14)}<span>${isSel ? 'Selected' : 'All'}</span>${svg(I.swap, 11)}`;
    const title = `Scope: ${isSel ? 'selected column(s)' : 'ALL columns'} — click to apply to ${isSel ? 'all columns' : 'the selection'}`;
    r.scopeToggle.title = title;
    r.scopeToggle.setAttribute('aria-label', title);
    r.scopeToggle.setAttribute('aria-pressed', String(!isSel));
    r.scopeToggle.classList.toggle('is-header', !isSel);
  };
  paintScope();
  r.scopeToggle.addEventListener('click', () => {
    scope = scope === 'selected' ? 'all' : 'selected';
    paintScope();
    refresh();
  });

  // ── Icons section — placement is a SLOT SELECTOR: the picker/color/clear
  // always edit "the icon at `placement` for `target`". Changing placement
  // switches which slot is shown; it never moves an icon between slots.
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

  // Placement menu on the pill. Grouped by kind — inline slots that flow with
  // the label vs. the six positional slots pinned to a cell corner/middle —
  // because that grouping is real structure, not decoration. The active slot
  // is marked so the pill's dropdown reads as a selector, not a one-shot menu.
  const placeMenu = document.createElement('div');
  placeMenu.className = 'cgext-ip-placemenu'; placeMenu.hidden = true;
  placeMenu.setAttribute('role', 'menu');
  const placeItems = new Map<Placement, HTMLButtonElement>();
  const addPlaceGroup = (heading: string, entries: Array<[Placement, string]>): void => {
    const head = document.createElement('div');
    head.className = 'cgext-ip-placehead'; head.textContent = heading;
    placeMenu.append(head);
    for (const [value, itemLabel] of entries) {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'cgext-ip-placeitem';
      item.dataset.place = value; item.textContent = itemLabel;
      item.setAttribute('role', 'menuitemradio');
      item.addEventListener('click', () => {
        placement = value;
        r.iconPlacePill.querySelector('span')!.textContent = itemLabel;
        placeMenu.hidden = true;
        syncPlaceActive();
        refresh();
      });
      placeMenu.append(item);
      placeItems.set(value, item);
    }
  };
  addPlaceGroup('Inline', [['prefix', 'Prefix'], ['suffix', 'Suffix']]);
  addPlaceGroup('Positional', [
    ['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'],
    ['ml', 'Middle-left'], ['mr', 'Middle-right'],
  ]);
  const syncPlaceActive = (): void => {
    for (const [value, el] of placeItems) {
      const on = value === placement;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-checked', String(on));
    }
  };
  syncPlaceActive();
  document.body.append(placeMenu);
  disposers.push(() => placeMenu.remove());
  r.iconPlacePill.addEventListener('click', () => {
    if (!placeMenu.hidden) { placeMenu.hidden = true; return; }
    const rect = r.iconPlacePill.getBoundingClientRect();
    placeMenu.style.left = `${rect.left}px`; placeMenu.style.top = `${rect.bottom + 6}px`;
    placeMenu.hidden = false;
    const away = (e: MouseEvent): void => {
      if (!placeMenu.contains(e.target as Node) && !r.iconPlacePill.contains(e.target as Node)) {
        placeMenu.hidden = true;
        document.removeEventListener('mousedown', away);
      }
    };
    document.addEventListener('mousedown', away);
  });

  r.iconColorBtn.addEventListener('click', () => r.iconColorInput.click());
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
  r.textColorBtn.addEventListener('click', () => r.textColorInput.click());
  r.fillColorBtn.addEventListener('click', () => r.fillColorInput.click());
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
  font-size: 9.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
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
  font-size: 9.5px; color: var(--cg-muted-fg-color, #7f8ba0);
  white-space: nowrap;
}
.cgext-rb-spacer { flex: 1 1 auto; }

/* Cell↔header target toggle — the face shows the ACTIVE target, the
   trailing swap arrows signal "click to switch". */
.cgext-rb-targettoggle {
  appearance: none; display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 8px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px;
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
  border: none; border-radius: 5px; background: transparent;
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
  border-radius: 1.5px; pointer-events: none;
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.18);
}
.cgext-rb-btn:focus-visible, .cgext-rb-toggle:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-rb-toggle.is-on { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 22%, transparent); color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-pill {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #d6dce8); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.cgext-rb-pill:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-rb-pill svg { color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-rb-pill.cgext-rb-danger { color: var(--cg-neg-color, #e5646e); border-color: color-mix(in srgb, var(--cg-neg-color, #e5646e) 45%, var(--cg-border-color, #2a3140)); }
.cgext-rb-pill.is-set { color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-input {
  height: 24px; padding: 0 8px; box-sizing: border-box;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25)); color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.cgext-rb-input:focus { outline: none; border-color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-stat { font-size: 11.5px; color: var(--cg-muted-fg-color, #7f8ba0); font-variant-numeric: tabular-nums; }

.cgext-rb-stepper {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 4px 0 8px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04)); font-size: 12px; color: var(--cg-fg-color, #d6dce8);
}
.cgext-rb-step-stack { display: flex; flex-direction: column; }
.cgext-rb-step { appearance: none; border: none; background: transparent; color: var(--cg-muted-fg-color, #9aa4b6); cursor: pointer; height: 10px; display: flex; align-items: center; padding: 0; }
.cgext-rb-step:hover { color: var(--cg-fg-color, #e5e9f0); }

.cgext-rb-colorinput { width: 0; height: 0; padding: 0; border: none; opacity: 0; position: absolute; pointer-events: none; }

.cgext-rb-danger-btn { color: var(--cg-neg-color, #e5646e); }
.cgext-rb-danger-btn:hover { background: color-mix(in srgb, var(--cg-neg-color, #e5646e) 16%, transparent); color: var(--cg-neg-color, #e5646e); }

/* ── Icons section — tile picker · placement slot menu ─────────────────── */
.cgext-ip-open { font-size: 14px; }
.cgext-ip-open.is-open { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 22%, transparent); color: var(--cg-accent-color, #4f9cf9); }
.cgext-ip-open:disabled,
.cgext-rb-pill[data-ip="place"]:disabled,
.cgext-rb-btn[data-ip="color"]:disabled,
.cgext-rb-btn[data-ip="clear"]:disabled { opacity: 0.38; cursor: default; }
.cgext-ip-open:disabled:hover,
.cgext-rb-btn[data-ip="color"]:disabled:hover,
.cgext-rb-btn[data-ip="clear"]:disabled:hover { background: transparent; color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-rb-pill[data-ip="place"]:disabled:hover { border-color: var(--cg-border-color, #2a3140); }

.cgext-ip-panel {
  position: fixed; z-index: 1000; width: 340px; max-height: 428px;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--cg-popup-bg, #161b26); border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.5); padding: 10px;
}
.cgext-ip-panel[hidden] { display: none; }

.cgext-ip-searchwrap { position: relative; display: flex; align-items: center; margin-bottom: 8px; color: var(--cg-muted-fg-color, #7f8ba0); }
.cgext-ip-searchwrap > svg { position: absolute; left: 9px; pointer-events: none; }
.cgext-ip-search {
  width: 100%; box-sizing: border-box; height: 30px; padding: 0 10px 0 30px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 8px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25)); color: var(--cg-fg-color, #e5e9f0);
  font: inherit; font-size: 12.5px; transition: border-color 120ms ease, box-shadow 120ms ease;
}
.cgext-ip-search::placeholder { color: var(--cg-muted-fg-color, #7f8ba0); }
.cgext-ip-search:focus {
  outline: none; border-color: var(--cg-accent-color, #4f9cf9);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 20%, transparent);
}
.cgext-ip-search::-webkit-search-cancel-button { appearance: none; }

.cgext-ip-scroll { overflow-y: auto; flex: 1 1 auto; scrollbar-width: thin; margin: 0 -4px; padding: 0 4px; }
.cgext-ip-cat {
  font-size: 10px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #7f8ba0); margin: 12px 2px 6px;
  position: sticky; top: 0; z-index: 1;
  background: linear-gradient(var(--cg-popup-bg, #161b26) 78%, transparent); padding: 3px 0 4px;
}
.cgext-ip-section:first-child .cgext-ip-cat { margin-top: 0; }

.cgext-ip-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.cgext-ip-tile {
  appearance: none; border: none; border-radius: 7px; background: transparent;
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

.cgext-ip-placemenu {
  position: fixed; z-index: 1000; min-width: 158px; padding: 5px;
  background: var(--cg-popup-bg, #161b26); border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 9px; box-shadow: 0 12px 30px rgba(0,0,0,0.45);
  display: flex; flex-direction: column;
}
.cgext-ip-placemenu[hidden] { display: none; }
.cgext-ip-placehead {
  font-size: 9.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #7f8ba0); padding: 7px 8px 3px;
}
.cgext-ip-placehead:first-child { padding-top: 3px; }
.cgext-ip-placeitem {
  appearance: none; border: none; background: transparent; border-radius: 6px;
  padding: 6px 10px; text-align: left; font: inherit; font-size: 12px;
  color: var(--cg-fg-color, #d6dce8); cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  transition: background 90ms ease, color 90ms ease;
}
.cgext-ip-placeitem:hover { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 18%, transparent); }
.cgext-ip-placeitem.is-active { color: var(--cg-accent-color, #4f9cf9); background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent); }
.cgext-ip-placeitem.is-active::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--cg-accent-color, #4f9cf9); flex: 0 0 auto; }
`;
