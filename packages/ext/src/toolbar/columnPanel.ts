/**
 * Column configuration popover — the ribbon's quick per-column settings:
 * FILTER (floating filter, filter type incl. set), GROUPING (row group,
 * pivot), AGGREGATION (function + show-in-header), BEHAVIOR (sortable,
 * resizable, editable, pinned, hidden). Def-level flags write through the
 * calc own-template pipeline (persist via profiles/layouts); aggregation
 * and pinning use the kernel's runtime state APIs. Every edit applies to
 * ALL target columns immediately; the popover stays open for more edits.
 *
 * This module is the Task 3 skeleton: state resolution (`effectiveFlag`/
 * `mixedValue`), row factories (`switchRow`/`segRow`/`sectionCaps`), and the
 * panel shell. `renderSections` renders the four section headings plus a
 * single working GROUPING row (row-group toggle) to prove the factories are
 * wired end to end; Task 4 fills in the remaining FILTER/AGGREGATION/BEHAVIOR
 * rows (filter type, set-filter picker, agg-func picker, pin/hide, etc).
 */
import { menu, svg } from './ui';

export type AggFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';
export const AGG_FUNCS: readonly AggFunc[] = ['sum', 'avg', 'min', 'max', 'count', 'first', 'last'];

export interface ColumnConfigGrid {
  editColumn(colId: string, patch: Record<string, unknown>): unknown;
  getTemplates(): Array<{ id: string; overrides: Record<string, unknown> }>;
  getGridOption(key: string): unknown;
  getValueColumns(): Array<{ colId: string; aggFunc: string }>;
  addValueColumn(colId: string, aggFunc: string): void;
  setValueColumnAggFunc(colId: string, aggFunc: string): void;
  removeValueColumn(colId: string): void;
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
  getColumnState(): Array<{ colId: string; pinned?: 'left' | 'right' | null }>;
}
export interface ColumnPanelHost {
  targetCols(): string[];
  grid: ColumnConfigGrid;
  onApplied(): void;
}

export type FlagKey =
  | 'floatingFilter' | 'filter' | 'enableRowGroup' | 'enablePivot'
  | 'sortable' | 'resizable' | 'suppressAggFuncInHeader' | 'hide' | 'editable';

const FLAG_DEFAULTS: Partial<Record<FlagKey, unknown>> = {
  sortable: true, resizable: true,
  enableRowGroup: false, enablePivot: false, hide: false, suppressAggFuncInHeader: false,
};

function baseDefOf(grid: ColumnConfigGrid, colId: string): Record<string, unknown> | undefined {
  const walk = (defs: readonly unknown[]): Record<string, unknown> | undefined => {
    for (const d of defs) {
      const def = d as { colId?: string; children?: unknown[] };
      if (def.colId === colId) return def as Record<string, unknown>;
      if (def.children) { const hit = walk(def.children); if (hit) return hit; }
    }
    return undefined;
  };
  try { return walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { return undefined; }
}

/** Own template → base colDef → per-key default. */
export function effectiveFlag(grid: ColumnConfigGrid, colId: string, key: FlagKey): unknown {
  try {
    const own = grid.getTemplates().find((t) => t.id === `__cgridOwn:${colId}`);
    const v = own?.overrides?.[key];
    if (v !== undefined) return v;
  } catch { /* engine absent */ }
  const base = baseDefOf(grid, colId)?.[key];
  if (base !== undefined) return base;
  if (key === 'floatingFilter') { try { return !!grid.getGridOption('floatingFilter'); } catch { return false; } }
  if (key === 'editable') {
    try { return !!(grid.getGridOption('defaultColDef') as { editable?: boolean } | undefined)?.editable; }
    catch { return false; }
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
  return menu(anchor, (close) => buildPanel(host, close), undefined, { align: 'left' });
}

function buildPanel(host: ColumnPanelHost, close: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cgext-col';
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  if (host.targetCols().length === 0) {
    el.innerHTML = `<div class="cgext-fmt-empty">Select a cell or column first.</div>`;
    return el;
  }
  renderSections(el, host);
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

// Task 4 fills in the remaining FILTER/AGGREGATION/BEHAVIOR rows; the
// GROUPING row-group toggle below demonstrates the factories wired to
// effectiveFlag/mixedValue and the calc own-template apply path.
function renderSections(el: HTMLElement, host: ColumnPanelHost): void {
  const cols = host.targetCols();

  el.append(sectionCaps('FILTER'));
  // Task 4: floating-filter switch, filter-type segmented control, set-filter picker.

  el.append(sectionCaps('GROUPING'));
  const rowGroupState = mixedValue(host.grid, cols, 'enableRowGroup');
  el.append(switchRow('enableRowGroup', 'Row Group', rowGroupState, (next) => {
    for (const c of cols) host.grid.editColumn(c, { enableRowGroup: next });
    host.onApplied();
  }));
  // Task 4: enablePivot toggle.

  el.append(sectionCaps('AGGREGATION'));
  // Task 4: agg-func picker + suppressAggFuncInHeader toggle.

  el.append(sectionCaps('BEHAVIOR'));
  // Task 4: sortable/resizable/editable/hide toggles + pinned segmented control.

  void svg;
}

export function injectColumnPanelStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-col-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-col-styles';
  style.textContent = COL_CSS;
  document.head.appendChild(style);
}

const COL_CSS = `
.cgext-menu.cgext-col { width: 300px; padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.cgext-col-caps {
  padding: 8px 2px 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.08em;
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-col-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 5px 4px; border-radius: 6px;
}
.cgext-col-row:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.05)); }
.cgext-col-label { font-size: 12px; color: var(--cg-fg-color, #e5e9f0); }
.cgext-col-switch {
  appearance: none; width: 30px; height: 17px; border-radius: 9px; position: relative;
  border: 1px solid var(--cg-border-color, #2a3140);
  background: var(--cg-control-bg, rgba(255,255,255,0.06)); cursor: pointer; flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease;
}
.cgext-col-switch[aria-checked="true"] {
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 55%, transparent);
  border-color: var(--cg-accent-color, #4f9cf9);
}
.cgext-col-knob {
  position: absolute; top: 1px; left: 1px; width: 13px; height: 13px; border-radius: 50%;
  background: var(--cg-fg-color, #e5e9f0); transition: left 120ms ease;
}
.cgext-col-switch[aria-checked="true"] .cgext-col-knob { left: 14px; }
.cgext-col-switch.is-mixed { border-style: dashed; }
.cgext-col-switch.is-mixed .cgext-col-knob { left: 7.5px; opacity: 0.6; }
.cgext-col-switch:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-col-seg { display: inline-flex; gap: 2px; }
.cgext-col-seg > button {
  appearance: none; height: 22px; padding: 0 8px; border-radius: 5px;
  border: 1px solid var(--cg-border-color, #2a3140); background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6); font: inherit; font-size: 11.5px; cursor: pointer;
}
.cgext-col-seg > button.is-on {
  color: var(--cg-accent-color, #4f9cf9); border-color: var(--cg-accent-color, #4f9cf9);
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent);
}
.cgext-col-row.is-error { box-shadow: inset 0 0 0 1px var(--cg-neg-color, #e2606c); }
.cgext-col-select {
  height: 24px; padding: 0 6px; border-radius: 6px;
  border: 1px solid var(--cg-border-color, #2a3140);
  background: var(--cg-control-bg, rgba(0,0,0,0.25)); color: var(--cg-fg-color, #e5e9f0);
  font: inherit; font-size: 12px;
}
.cgext-col .cgext-fmt-empty { padding: 18px 10px; font-size: 12.5px; color: var(--cg-muted-fg-color, #9aa4b6); }
`;
