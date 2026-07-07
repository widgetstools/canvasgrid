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
  decDown: 'M3 12h6M20 8l-4 4 4 4',
  decUp: 'M3 12h6M16 8l4 4-4 4',
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
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
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
function label(text: string): HTMLDivElement { return h('cgext-rb-label', text); }
function sep(): HTMLDivElement { return h('cgext-rb-sep'); }
function iconBtn(icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cgext-rb-btn'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = svg(icon);
  return b;
}
function toggleBtn(icon: string, title: string): HTMLButtonElement {
  const b = iconBtn(icon, title); b.classList.add('cgext-rb-toggle'); return b;
}
function group(...children: HTMLElement[]): HTMLDivElement {
  const g = h('cgext-rb-group'); g.append(...children); return g;
}
function section(name: string, ...children: HTMLElement[]): HTMLDivElement {
  const s = h('cgext-rb-section'); s.append(label(name), ...children); return s;
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
function stat(text: string): HTMLSpanElement {
  const s = document.createElement('span'); s.className = 'cgext-rb-stat'; s.textContent = text; return s;
}

function ribbonItem(getEdit?: EditHandleGetter): ToolbarItem {
  return {
    id: 'ribbon', kind: 'toolbar-item', slot: 'ribbon.main', init() {},
    render(host: HTMLElement, ctx: CgExtContext): ToolbarItemInstance {
      const root = h('cgext-ribbon-strip');

      // Row 1 — HISTORY · SMART · BULK (the Editing toolbar). Controls are
      // captured by reference so `wireEditingToolbar` can bind them to the
      // `@cgrid/edit` bridge (undo/redo journal, smart-edit ops, bulk update).
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

      const row1 = h('cgext-rb-row');
      row1.append(
        section('History', group(undo, redo), histCount),
        sep(),
        section('Smart', group(operand, opMul, opDiv, opAdd, opSub, setBtn), smartCount),
        sep(),
        section('Bulk', group(bulkValue, bulkApply), bulkCount),
      );

      // Row 2 — TARGET (cell/header) · selection readout · type B I U · align · size
      const targetCell = toggleBtn(I.grid, 'Style cells');
      const targetHeader = toggleBtn(I.rows, 'Style headers');
      targetCell.classList.add('is-on');
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

      // Paint — fg/bg colour pickers (share Formatting row A with Type/Icons)
      const textColorBtn = iconBtn(I.paintText, 'Text color');
      const fillColorBtn = iconBtn(I.fill, 'Fill color');
      const textColorInput = document.createElement('input');
      textColorInput.type = 'color'; textColorInput.className = 'cgext-rb-colorinput'; textColorInput.value = '#4fd1c5';
      const fillColorInput = document.createElement('input');
      fillColorInput.type = 'color'; fillColorInput.className = 'cgext-rb-colorinput'; fillColorInput.value = '#12333a';
      // Icons — tile picker · colour · placement slot selector · clear. Icons
      // are column styling, so they share the Paint row. Placement is a SLOT
      // SELECTOR (see `wireFormattingToolbar`): the picker/colour/clear always
      // edit "the icon at the selected placement for the current target" — they
      // switch which slot is shown, never move an icon between slots.
      let iconApply: (sel: IconSelection) => void = () => {};
      const picker = createIconPicker({ onSelect: (sel) => iconApply(sel) });
      const iconColorBtn = iconBtn(I.paintText, 'Icon color');
      iconColorBtn.dataset.ip = 'color';
      const iconColorInput = document.createElement('input');
      iconColorInput.type = 'color'; iconColorInput.className = 'cgext-rb-colorinput'; iconColorInput.value = '#4f9cf9';
      const iconPlacePill = pill('Prefix'); iconPlacePill.dataset.ip = 'place';
      const iconClear = iconBtn(I.eraser, 'Clear icon at this placement'); iconClear.dataset.ip = 'clear';
      document.body.append(picker.panel);

      const paint = section('Paint', group(textColorBtn, textColorInput, fillColorBtn, fillColorInput));
      const icons = section('Icons', group(picker.button, iconColorBtn, iconColorInput, iconPlacePill, iconClear));
      const spacer = h('cgext-rb-spacer');
      const pop = iconBtn(I.popout, 'Pop out');
      pop.addEventListener('click', () => ctx.events.emit({ type: 'popout' }));

      // Formatting row A — everything that styles the SELECTION, one dense
      // strip reading left-to-right: TARGET · readout · TYPE · align · size ·
      // PAINT · ICONS, popout pinned right.
      const rowA = h('cgext-rb-row');
      rowA.append(
        section('Target', group(targetCell, targetHeader)),
        sep(),
        group(selPill),
        sep(),
        section('Type', group(bold, italic, underline, strike)),
        group(alignL, alignC, alignR),
        sizeWrap,
        sep(),
        paint,
        sep(),
        icons,
        spacer,
        pop,
      );

      // Formatting row B — COLUMN semantics: FORMAT · EDIT · GROUP · TEMPLATES.
      const fmtDollar = iconBtn(I.dollar, 'Currency format');
      const fmtPercent = iconBtn(I.percent, 'Percent format');
      const fmtThousands = iconBtn(I.hash, 'Thousands format');
      const decDown = iconBtn(I.decDown, 'Fewer decimals');
      const decUp = iconBtn(I.decUp, 'More decimals');
      const fmtCode = pill('# Format');
      const clear = pill('Clear', false); clear.classList.add('cgext-rb-danger');
      clear.title = 'Clear styling + format on the selected columns';
      const eraser = iconBtn(I.eraser, 'Clear formatting');
      const rowB = h('cgext-rb-row');
      rowB.append(
        section('Format',
          group(fmtDollar, fmtPercent, fmtThousands),
          sep(),
          group(decDown, decUp),
          sep(),
          fmtCode,
        ),
        sep(),
        section('Edit', group(iconBtn(I.edit, 'Editor'), pill('None')), group(iconBtn(I.filter, 'Filter'), pill('None')), iconBtn(I.filterOff, 'Clear filter')),
        sep(),
        section('Group', group(iconBtn(I.agg, 'Aggregation'), pill('None'), iconBtn(I.settings, 'Group settings'))),
        sep(),
        section('Templates',
          group(iconBtn(I.templates, 'Templates'), pill('', true)),
          clear,
          eraser,
          dangerIcon(I.trash, 'Delete template'),
        ),
      );

      // Two independently-toggleable sub-toolbars (below the always-present
      // title bar). The Editing toolbar is the top ribbon row — History
      // undo/redo + Smart + Bulk. The Formatting toolbar is the two dense
      // rows below it — selection styling (row A) and column semantics
      // (row B). Each toggle is driven from the title-bar overflow menu,
      // which emits `toggle-ribbon` with the matching section.
      const editing = h('cgext-ribbon-strip'); editing.dataset.toolbar = 'editing';
      editing.append(row1);
      const formatting = h('cgext-ribbon-strip'); formatting.dataset.toolbar = 'formatting';
      formatting.append(rowA, rowB);
      root.append(editing, formatting);
      host.appendChild(root);

      const off = ctx.events.on('toggle-ribbon', (e) => {
        const section = (e as { section?: string }).section;
        if (section === 'edit') editing.hidden = !editing.hidden;
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
        targetCell, targetHeader, selPill,
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
  targetCell: HTMLButtonElement; targetHeader: HTMLButtonElement; selPill: HTMLButtonElement;
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
  };
  let target: 'cell' | 'header' = 'cell';

  /** Columns identified from the selected cells (ranges first, focus fallback). */
  const targetCols = (): string[] => {
    try {
      const fromRanges = grid.getCellRanges().flatMap((rg) => rg.colIds);
      if (fromRanges.length) return [...new Set(fromRanges)];
      const focus = grid.getFocusedCell();
      return focus ? [focus.colId] : [];
    } catch { return []; }
  };

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

  /** Reflect the first target column's state into the controls. */
  const refresh = (): void => {
    const cols = targetCols();
    const none = cols.length === 0;
    r.selPill.querySelector('span')!.textContent = none
      ? 'Select a cell'
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

    // Icons — reflect the selected slot into the picker preview + enablement.
    const slot = none ? null : currentIconSlot();
    r.iconPicker.setPreview(slot);
    const emojiSel = slot !== null && slot.emoji !== undefined;
    r.iconColorBtn.disabled = none || emojiSel; // color is SVG-only
    r.iconClear.disabled = none || slot === null;
    r.iconPicker.button.disabled = none;
    r.iconPlacePill.disabled = none;
    if (slot?.color) r.iconColorInput.value = slot.color;
  };

  // Target toggle (cell vs header styling)
  const setTarget = (t: 'cell' | 'header') => {
    target = t;
    r.targetCell.classList.toggle('is-on', t === 'cell');
    r.targetHeader.classList.toggle('is-on', t === 'header');
    refresh();
  };
  r.targetCell.addEventListener('click', () => setTarget('cell'));
  r.targetHeader.addEventListener('click', () => setTarget('header'));

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
  r.fmtCode.addEventListener('click', () => {
    const entered = window.prompt('Format code (format DSL, e.g. $#,##0.00 or 0.00%)', currentFormat() ?? '#,##0.00');
    if (entered) applyFormat(entered);
  });

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
.cgext-ribbon-strip { display: flex; flex-direction: column; }
.cgext-ribbon-strip[hidden] { display: none; }
.cgext-rb-row {
  display: flex; align-items: center; gap: 8px;
  box-sizing: border-box; padding: 3px 10px; min-height: 32px;
  border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 55%, transparent);
}
.cgext-rb-row:last-child { border-bottom: none; }
.cgext-rb-section { display: flex; align-items: center; gap: 6px; }
.cgext-rb-label {
  font-size: 9px; font-weight: 650; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #7f8ba0);
}
.cgext-rb-group { display: inline-flex; align-items: center; gap: 1px; padding: 1px; border-radius: 7px; background: var(--cg-control-bg, rgba(255,255,255,0.035)); }
.cgext-rb-sep { width: 1px; align-self: stretch; margin: 3px 2px; background: color-mix(in srgb, var(--cg-border-color, #2a3140) 80%, transparent); }
.cgext-rb-spacer { flex: 1 1 auto; }

.cgext-rb-btn, .cgext-rb-toggle {
  appearance: none; width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 5px; background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6); cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}
.cgext-rb-btn:hover, .cgext-rb-toggle:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.07)); color: var(--cg-fg-color, #e5e9f0); }
.cgext-rb-btn:focus-visible, .cgext-rb-toggle:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-rb-toggle.is-on { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 22%, transparent); color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-pill {
  display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 7px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #d6dce8); font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap;
}
.cgext-rb-pill:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-rb-pill svg { color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-rb-pill.cgext-rb-danger { color: var(--cg-neg-color, #e5646e); border-color: color-mix(in srgb, var(--cg-neg-color, #e5646e) 45%, var(--cg-border-color, #2a3140)); }

.cgext-rb-input {
  height: 22px; padding: 0 7px; box-sizing: border-box;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25)); color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 11.5px;
}
.cgext-rb-input:focus { outline: none; border-color: var(--cg-accent-color, #4f9cf9); }

.cgext-rb-stat { font-size: 10.5px; color: var(--cg-muted-fg-color, #7f8ba0); font-variant-numeric: tabular-nums; }

.cgext-rb-stepper {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 3px 0 8px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04)); font-size: 11.5px; color: var(--cg-fg-color, #d6dce8);
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
