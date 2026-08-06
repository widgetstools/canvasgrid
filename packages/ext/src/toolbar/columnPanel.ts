/**
 * Column configuration popover — the ribbon's quick per-column settings:
 * FILTER (floating filter, filter type incl. set), GROUPING (row group,
 * pivot), AGGREGATION (function + show-in-header), BEHAVIOR (sortable,
 * resizable, editable, pinned, hidden). Def-level flags write through the
 * calc own-template pipeline (persist via profiles/layouts); aggregation
 * and pinning use the kernel's runtime state APIs. Every edit applies to
 * ALL target columns immediately; the popover stays open for more edits.
 *
 * State resolution (`effectiveFlag`/`mixedValue`), row factories
 * (`switchRow`/`segRow`/`sectionCaps`), and the panel shell. `renderSections`
 * renders the four sections in full: FILTER (floating filter, filter type
 * incl. set), GROUPING (row group, pivot), AGGREGATION (function picker,
 * show-in-header), BEHAVIOR (sortable, resizable, editable, pinned, hidden).
 */
import { menu } from './ui';

export type AggFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';
export const AGG_FUNCS: readonly AggFunc[] = ['sum', 'avg', 'min', 'max', 'count', 'first', 'last'];

/** Builtins + any host-registered `aggFuncs` (`setGridOption('aggFuncs', …)`)
 *  — the pill dropdown and Function select both list "the agg registry", not
 *  just the seven built-ins. */
export function aggFuncChoices(grid: ColumnConfigGrid): readonly string[] {
  let custom: Record<string, unknown> = {};
  try { custom = (grid.getGridOption('aggFuncs') as Record<string, unknown>) ?? {}; } catch { /* engine absent */ }
  const extra = Object.keys(custom).filter((name) => !(AGG_FUNCS as readonly string[]).includes(name));
  return extra.length === 0 ? AGG_FUNCS : [...AGG_FUNCS, ...extra];
}

export interface ColumnConfigGrid {
  editColumn(colId: string, patch: Record<string, unknown>): unknown;
  getTemplates(): Array<{ id: string; overrides: Record<string, unknown> }>;
  getGridOption(key: string): unknown;
  getValueColumns(): Array<{ colId: string; aggFunc: string }>;
  addValueColumn(colId: string, aggFunc: string): void;
  setValueColumnAggFunc(colId: string, aggFunc: string): void;
  removeValueColumn(colId: string): void;
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
  getColumnState(): Array<{ colId: string; pinned?: 'left' | 'right' | null; hide?: boolean }>;
}
export interface ColumnPanelHost {
  targetCols(): string[];
  grid: ColumnConfigGrid;
  onApplied(): void;
  /** Called once before a mutating apply so the ribbon can push undo. */
  beforeChange?(): void;
}

export type FlagKey =
  | 'floatingFilter' | 'filter' | 'enableRowGroup' | 'enablePivot'
  | 'sortable' | 'resizable' | 'suppressAggFuncInHeader' | 'hide' | 'editable';

const FLAG_DEFAULTS: Partial<Record<FlagKey, unknown>> = {
  sortable: true, resizable: true,
  enableRowGroup: false, enablePivot: false, hide: false, editable: false,
};

function baseDefOf(grid: ColumnConfigGrid, colId: string): Record<string, unknown> | undefined {
  const walk = (defs: readonly unknown[]): Record<string, unknown> | undefined => {
    for (const d of defs) {
      const def = d as { colId?: string; field?: string; children?: unknown[] };
      if (def.colId === colId || (def.colId === undefined && def.field === colId)) return def as Record<string, unknown>;
      if (def.children) { const hit = walk(def.children); if (hit) return hit; }
    }
    return undefined;
  };
  try { return walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { return undefined; }
}

/**
 * `defaultColDef`/`columnTypes` fallback for the def-level flags, mirroring
 * the kernel's own merge order in `resolveColDef`
 * (`{ ...typeBundle, ...defaultColDef, ...colDef }` — colDef itself is
 * already checked by `baseDefOf` before this runs, so here we only need
 * defaultColDef beating the column's `type` bundle(s), last-named-type-wins
 * for a given key, same as the kernel's left-to-right spread).
 */
function defaultChainValue(grid: ColumnConfigGrid, colId: string, key: FlagKey): unknown {
  let defaultColDef: Record<string, unknown> = {};
  try { defaultColDef = (grid.getGridOption('defaultColDef') as Record<string, unknown>) ?? {}; } catch { /* engine absent */ }
  if (defaultColDef[key] !== undefined) return defaultColDef[key];

  const def = baseDefOf(grid, colId);
  const rawType = def?.type;
  const typeNames: string[] = Array.isArray(rawType) ? (rawType as string[])
    : typeof rawType === 'string' ? [rawType] : [];
  if (typeNames.length === 0) return undefined;
  let columnTypes: Record<string, Record<string, unknown>> = {};
  try { columnTypes = (grid.getGridOption('columnTypes') as Record<string, Record<string, unknown>>) ?? {}; } catch { /* engine absent */ }
  let result: unknown;
  for (const name of typeNames) {
    const bundle = columnTypes[name];
    if (bundle && bundle[key] !== undefined) result = bundle[key];
  }
  return result;
}

/** Own template → base colDef → `defaultColDef`/`columnTypes` → per-key default. */
export function effectiveFlag(grid: ColumnConfigGrid, colId: string, key: FlagKey): unknown {
  // Live columnState wins for hide — Columns-panel / API hide is authoritative.
  if (key === 'hide') {
    try {
      const st = grid.getColumnState().find((s) => s.colId === colId) as
        | { colId: string; hide?: boolean } | undefined;
      if (st && typeof st.hide === 'boolean') return st.hide;
    } catch { /* engine absent */ }
  }
  try {
    // Known limitation (matches the ribbon's existing formatting-toggle
    // readout convention): only the column's OWN template
    // (`__cgridOwn:<colId>`) is consulted here. A flag applied via a SHARED
    // template resolves at the kernel/calc fold layer (and IS live on the
    // column) but is invisible to this read — the popover/quick-toggle can
    // show "off" for a value that's actually on, and the first toggle from
    // that state writes what the user thinks is already active.
    const own = grid.getTemplates().find((t) => t.id === `__cgridOwn:${colId}`);
    const v = own?.overrides?.[key];
    if (v !== undefined) return v;
  } catch { /* engine absent */ }
  const base = baseDefOf(grid, colId)?.[key];
  if (base !== undefined) return base;
  const chained = defaultChainValue(grid, colId, key);
  if (chained !== undefined) return chained;
  // Mirrors the kernel's own `isFloatingFilterEnabled()` default: the row
  // renders unless the grid EXPLICITLY sets `floatingFilter: false`. Most
  // hosts never set the option (relying on the kernel's default-on
  // behavior), so `getGridOption('floatingFilter')` reads back `undefined`
  // — coercing that with `!!` collapsed to `false` and made the popover
  // show "off" for a column whose floating filter was actually rendering.
  if (key === 'floatingFilter') { try { return grid.getGridOption('floatingFilter') !== false; } catch { return true; } }
  // Same `!!undefined` collapse, on the other grid-option-inheriting key
  // (`byRows.ts` `decorateHeader`: an unset per-column flag defers to the
  // grid-level `CGridOptions.suppressAggFuncInHeader`, default off).
  if (key === 'suppressAggFuncInHeader') {
    try { return grid.getGridOption('suppressAggFuncInHeader') === true; } catch { return false; }
  }
  return FLAG_DEFAULTS[key]; // filter → undefined = Auto
}

/** All targets agree → {value, mixed:false}; else {undefined, mixed:true}. */
export function mixedValue(grid: ColumnConfigGrid, cols: string[], key: FlagKey): { value: unknown; mixed: boolean } {
  const values = cols.map((c) => effectiveFlag(grid, c, key));
  const first = values[0];
  return values.every((v) => v === first) ? { value: first, mixed: false } : { value: undefined, mixed: true };
}

export function columnPanelMenu(anchor: HTMLElement, host: ColumnPanelHost): { toggle(): void; destroy(): void } {
  injectColumnPanelStyles();
  // Every row apply calls `rerender()` (renderSections rebuilds the rows
  // from scratch), which removes the just-clicked control from the DOM and
  // drops focus back to <body>. `buildPanel`'s own keydown listener lives on
  // the panel root, so once focus is no longer inside it Escape stops
  // reaching that listener. Mirror it with a document-level Escape listener
  // scoped to THIS popover's own open/close lifecycle (added on open,
  // removed on close/destroy) — narrower than patching the shared `menu()`
  // factory, which other popovers (formatPicker, layoutsMenu's nested
  // rename/cancel inputs) rely on with their own, different Escape/
  // stopPropagation semantics.
  let onKeyDoc: ((e: KeyboardEvent) => void) | null = null;
  const detachKey = (): void => {
    if (onKeyDoc) { document.removeEventListener('keydown', onKeyDoc); onKeyDoc = null; }
  };
  const m = menu(anchor, (close) => {
    const wrappedClose = (): void => { detachKey(); close(); };
    const panel = buildPanel(host, wrappedClose);
    onKeyDoc = (e) => { if (e.key === 'Escape') wrappedClose(); };
    document.addEventListener('keydown', onKeyDoc);
    return panel;
  }, undefined, { align: 'left' });
  return { toggle: m.toggle, destroy: () => { detachKey(); m.destroy(); } };
}

function buildPanel(host: ColumnPanelHost, close: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cgext-col';
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  if (host.targetCols().length === 0) {
    el.innerHTML = `<div class="cgext-fmt-empty">Select a cell or column first.</div>`;
    return el;
  }
  renderColumnSettingsSections(el, host);
  return el;
}

// ── Row factories (Task 4 wires the remaining rows through these) ─────────
export function switchRow(
  key: string, label: string,
  state: { value: unknown; mixed: boolean },
  onToggle: (next: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cgext-col-row';
  row.dataset.k = key;
  const lab = document.createElement('span');
  lab.className = 'cgext-col-label';
  lab.textContent = label;
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'cgext-col-switch' + (state.mixed ? ' is-mixed' : '');
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', state.mixed ? 'mixed' : String(!!state.value));
  sw.innerHTML = '<span class="cgext-col-knob"></span>';
  sw.addEventListener('click', () => onToggle(state.mixed ? true : !state.value));
  row.append(lab, sw);
  return row;
}

export function segRow(
  key: string, label: string,
  options: Array<{ v: string; text: string }>,
  active: string | undefined, // undefined on mixed → nothing marked
  onPick: (v: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cgext-col-row';
  row.dataset.k = key;
  const lab = document.createElement('span');
  lab.className = 'cgext-col-label';
  lab.textContent = label;
  const seg = document.createElement('span');
  seg.className = 'cgext-col-seg';
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = opt.v;
    b.textContent = opt.text;
    b.classList.toggle('is-on', opt.v === active);
    b.addEventListener('click', () => onPick(opt.v));
    seg.append(b);
  }
  row.append(lab, seg);
  return row;
}

export function sectionCaps(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'cgext-col-caps';
  h.textContent = text;
  return h;
}

/** Render FILTER / GROUPING / AGGREGATION / BEHAVIOR controls into `el`.
 *  Shared by the ribbon popover and the Column Settings settings module. */
export function renderColumnSettingsSections(el: HTMLElement, host: ColumnPanelHost): void {
  const { grid } = host;
  const cols = host.targetCols();
  const rerender = () => {
    el.querySelectorAll('.cgext-col-caps, .cgext-col-row').forEach((n) => n.remove());
    renderColumnSettingsSections(el, host);
  };
  /** Fan an apply over every target; error-tints the row on throw. */
  const applyAll = (row: HTMLElement, fn: (colId: string) => void): void => {
    row.classList.remove('is-error');
    row.removeAttribute('title');
    host.beforeChange?.();
    let errored = false;
    for (const colId of cols) {
      try { fn(colId); } catch (err) {
        errored = true;
        row.classList.add('is-error');
        row.title = err instanceof Error ? err.message : String(err);
      }
    }
    host.onApplied();
    // Re-read live state so every row reflects the new truth — but only on
    // success; on error, skip the rerender so the tinted row stays visible.
    if (!errored) rerender();
  };
  const flagSwitch = (key: FlagKey, label: string, patchKey?: string): HTMLElement => {
    const state = mixedValue(grid, cols, key);
    const row = switchRow(key, label, state, (next) => {
      applyAll(row, (colId) => grid.editColumn(colId, { [patchKey ?? key]: next }));
    });
    return row;
  };

  // ── FILTER ──
  el.append(sectionCaps('FILTER'));
  el.append(flagSwitch('floatingFilter', 'Floating filter'));
  {
    const state = mixedValue(grid, cols, 'filter');
    const active = state.mixed ? undefined : ((state.value as string | undefined) ?? 'auto');
    const row = segRow('filter', 'Filter type', [
      { v: 'auto', text: 'Auto' }, { v: 'text', text: 'Text' }, { v: 'number', text: 'Num' },
      { v: 'date', text: 'Date' }, { v: 'set', text: 'Set' },
    ], active, (v) => {
      applyAll(row, (colId) => grid.editColumn(colId, { filter: v === 'auto' ? null : v }));
    });
    el.append(row);
  }

  // ── GROUPING ──
  el.append(sectionCaps('GROUPING'));
  el.append(flagSwitch('enableRowGroup', 'Groupable'));
  el.append(flagSwitch('enablePivot', 'Pivotable'));

  // ── AGGREGATION ──
  el.append(sectionCaps('AGGREGATION'));
  {
    const valueCols = grid.getValueColumns();
    const aggOf = (colId: string) => valueCols.find((v) => v.colId === colId)?.aggFunc;
    const aggs = cols.map(aggOf);
    const mixed = !aggs.every((a) => a === aggs[0]);
    const current = mixed ? '' : (aggs[0] ?? 'none');
    const row = document.createElement('div');
    row.className = 'cgext-col-row';
    row.dataset.k = 'aggFunc';
    const lab = document.createElement('span');
    lab.className = 'cgext-col-label';
    lab.textContent = 'Function';
    const sel = document.createElement('select');
    sel.className = 'cgext-col-select';
    for (const v of ['none', ...aggFuncChoices(grid)]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v === 'none' ? 'None' : v;
      sel.append(o);
    }
    if (mixed) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '(mixed)'; o.disabled = true;
      sel.prepend(o);
    }
    sel.value = current;
    sel.addEventListener('change', () => {
      const v = sel.value;
      applyAll(row, (colId) => {
        const has = grid.getValueColumns().some((x) => x.colId === colId);
        if (v === 'none') { if (has) grid.removeValueColumn(colId); }
        else if (has) grid.setValueColumnAggFunc(colId, v);
        else grid.addValueColumn(colId, v);
      });
    });
    row.append(lab, sel);
    el.append(row);

    // Show-in-header — inverse of suppressAggFuncInHeader; needs an agg.
    const anyAgg = cols.some((c) => aggOf(c) !== undefined);
    const supState = mixedValue(grid, cols, 'suppressAggFuncInHeader');
    const shown = { value: supState.mixed ? undefined : !(supState.value as boolean), mixed: supState.mixed };
    const hdrRow = switchRow('aggHeader', 'Show in header', shown, (next) => {
      applyAll(hdrRow, (colId) => grid.editColumn(colId, { suppressAggFuncInHeader: !next }));
    });
    const hdrSwitch = hdrRow.querySelector<HTMLButtonElement>('.cgext-col-switch')!;
    hdrSwitch.disabled = !anyAgg;
    el.append(hdrRow);
  }

  // ── BEHAVIOR ──
  el.append(sectionCaps('BEHAVIOR'));
  el.append(flagSwitch('sortable', 'Sortable'));
  el.append(flagSwitch('resizable', 'Resizable'));
  el.append(flagSwitch('editable', 'Editable'));
  {
    const states = cols.map((c) => grid.getColumnState().find((s) => s.colId === c)?.pinned ?? null);
    const mixed = !states.every((s) => s === states[0]);
    const active = mixed ? undefined : (states[0] ?? 'none') || 'none';
    const row = segRow('pinned', 'Pinned', [
      { v: 'left', text: 'Left' }, { v: 'none', text: '–' }, { v: 'right', text: 'Right' },
    ], active === null ? 'none' : (active as string), (v) => {
      row.classList.remove('is-error');
      row.removeAttribute('title');
      let errored = false;
      try { grid.setColumnsPinned(cols, v === 'none' ? null : (v as 'left' | 'right')); }
      catch (err) { errored = true; row.classList.add('is-error'); row.title = err instanceof Error ? err.message : String(err); }
      host.onApplied();
      // Mirror applyAll: skip the rerender on error so the tinted row stays visible.
      if (!errored) rerender();
    });
    el.append(row);
  }
  el.append(flagSwitch('hide', 'Hidden'));
}

export function injectColumnPanelStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('cgext-col-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'cgext-col-styles';
    document.head.appendChild(style);
  }
  style.textContent = COL_CSS;
}

const COL_CSS = `
.cgext-menu.cgext-col { width: 300px; padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.cgext-col-caps {
  padding: 8px 2px 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.08em;
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-col-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 5px 4px; border-radius: var(--cg-radius, 6px);
}
.cgext-col-row:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.05)); }
.cgext-col-label { font-size: 12px; color: var(--cg-fg-color, #e5e9f0); }
.cgext-col-switch {
  appearance: none; width: 30px; height: 17px; border-radius: 9px; position: relative;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 28%, transparent);
  cursor: pointer; flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease;
}
.cgext-col-switch[aria-checked="true"] {
  background: var(--cg-accent-color, #4f9cf9);
  border-color: transparent;
}
.cgext-col-knob {
  position: absolute; top: 1px; left: 1px; width: 13px; height: 13px; border-radius: 50%;
  background: var(--cg-bg-color, #e5e9f0); transition: left 120ms ease;
}
.cgext-col-switch[aria-checked="true"] .cgext-col-knob { left: 14px; }
.cgext-col-switch.is-mixed { border: 1px dashed var(--cg-muted-fg-color, #9aa4b6); }
.cgext-col-switch.is-mixed .cgext-col-knob { left: 7.5px; opacity: 0.6; }
.cgext-col-switch:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-col-seg { display: inline-flex; gap: 2px; }
.cgext-col-seg > button {
  appearance: none; height: 22px; padding: 0 8px; border-radius: var(--cg-radius, 5px);
  border: 1px solid var(--cg-border-color, #2a3140); background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6); font: inherit; font-size: 11.5px; cursor: pointer;
}
.cgext-col-seg > button.is-on {
  color: var(--cg-accent-color, #4f9cf9); border-color: var(--cg-accent-color, #4f9cf9);
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent);
}
.cgext-col-row.is-error { box-shadow: inset 0 0 0 1px var(--cg-neg-color, #e2606c); }
.cgext-col-select {
  height: 24px; padding: 0 6px; border-radius: var(--cg-radius, 2px);
  border: 1px solid var(--cg-border-color, #2a3140);
  background: var(--cg-control-bg, rgba(0,0,0,0.25)); color: var(--cg-fg-color, #e5e9f0);
  font: inherit; font-size: 12px;
}
.cgext-col .cgext-fmt-empty { padding: 18px 10px; font-size: 12.5px; color: var(--cg-muted-fg-color, #9aa4b6); }
`;
