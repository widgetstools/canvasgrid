/**
 * Column Settings — settings-sheet module. Column picker is a dropdown
 * with an embedded search bar; the form uses @cgrid/customizer chrome
 * (same look as the Grid Options sidebar).
 */
import { defineChromeComponents } from '@cgrid/customizer';
import type { SettingsModule, CgExtContext, ModuleInstance } from '../extension/types';
import {
  aggFuncChoices,
  effectiveFlag,
  type ColumnConfigGrid,
  type FlagKey,
} from '../toolbar/columnPanel';
import { mirrorThemeClass } from '../toolbar/ui';

interface ColItem {
  id: string;
  label: string;
}

function leafColumns(grid: CgExtContext['grid']): ColItem[] {
  const out: ColItem[] = [];
  const walk = (defs: readonly unknown[]): void => {
    for (const d of defs) {
      const def = d as {
        colId?: string; field?: string; headerName?: string; children?: unknown[];
      };
      if (def.children?.length) walk(def.children);
      else {
        const id = def.colId ?? def.field;
        if (!id) continue;
        const named = grid.getColumnHeaderName?.(id);
        out.push({ id, label: named || def.headerName || id });
      }
    }
  };
  try { walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { /* */ }
  return out;
}

function asGrid(grid: CgExtContext['grid']): ColumnConfigGrid {
  return grid as unknown as ColumnConfigGrid;
}

function fieldOf(label: string, control: HTMLElement): HTMLElement {
  const field = document.createElement('cgc-field');
  field.setAttribute('label', label);
  field.appendChild(control);
  return field;
}

function switchOf(
  label: string,
  checked: boolean,
  onChange: (next: boolean) => void,
  opts?: { disabled?: boolean },
): HTMLElement {
  const sw = document.createElement('cgc-switch');
  sw.setAttribute('aria-label', label);
  (sw as unknown as { checked: boolean }).checked = checked;
  if (opts?.disabled) sw.classList.add('is-disabled');
  sw.addEventListener('cgc-change', (ev) => {
    onChange(!!(ev as CustomEvent).detail?.value);
  });
  return fieldOf(label, sw);
}

function selectOf(
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (next: string) => void,
): HTMLElement {
  const sel = document.createElement('cgc-select');
  sel.setAttribute('aria-label', label);
  (sel as unknown as { options: typeof options; value: string }).options = options;
  (sel as unknown as { value: string }).value = value;
  sel.addEventListener('cgc-change', (ev) => {
    onChange(String((ev as CustomEvent).detail?.value ?? ''));
  });
  return fieldOf(label, sel);
}

/** Searchable column dropdown — trigger shows selection; panel has search + list. */
function createColumnDropdown(opts: {
  getColumns: () => ColItem[];
  getSelectedId: () => string;
  onSelect: (id: string) => void;
}): { root: HTMLElement; setLabel: (text: string) => void; destroy: () => void } {
  const root = document.createElement('div');
  root.className = 'cgext-col-dd';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cgext-col-dd-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Column');
  const triggerText = document.createElement('span');
  triggerText.className = 'cgext-col-dd-trigger-text';
  const caret = document.createElement('span');
  caret.className = 'cgext-col-dd-caret';
  caret.setAttribute('aria-hidden', 'true');
  trigger.append(triggerText, caret);
  root.append(trigger);

  let panel: HTMLElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let query = '';

  const close = () => {
    if (!panel) return;
    panel.remove();
    panel = null;
    searchInput = null;
    query = '';
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  };

  const onDoc = (e: PointerEvent) => {
    if (!panel) return;
    const t = e.target as Node;
    if (panel.contains(t) || root.contains(t)) return;
    close();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      trigger.focus();
    }
  };

  const paintOptions = () => {
    if (!panel) return;
    const list = panel.querySelector('.cgext-col-dd-list') as HTMLElement;
    const cols = opts.getColumns();
    const q = query.trim().toLowerCase();
    const filtered = q
      ? cols.filter((c) => c.id.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      : cols;
    const selected = opts.getSelectedId();
    list.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cgext-col-dd-empty';
      empty.textContent = cols.length === 0 ? 'No columns.' : 'No matches.';
      list.append(empty);
      return;
    }
    for (const col of filtered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cgext-col-dd-option' + (col.id === selected ? ' is-selected' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(col.id === selected));
      const name = document.createElement('span');
      name.className = 'cgext-col-dd-option-label';
      name.textContent = col.label;
      btn.append(name);
      if (col.label !== col.id) {
        const id = document.createElement('span');
        id.className = 'cgext-col-dd-option-id';
        id.textContent = col.id;
        btn.append(id);
      }
      btn.addEventListener('click', () => {
        opts.onSelect(col.id);
        close();
      });
      list.append(btn);
    }
  };

  const open = () => {
    if (panel) { close(); return; }
    panel = document.createElement('div');
    panel.className = 'cgext-col-dd-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Columns');
    mirrorThemeClass(trigger, panel);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'cgext-col-dd-search-wrap';
    const searchIcon = document.createElement('span');
    searchIcon.className = 'cgext-col-dd-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'cgext-col-dd-search';
    searchInput.placeholder = 'Search columns…';
    searchInput.setAttribute('aria-label', 'Search columns');
    searchInput.autocomplete = 'off';
    searchInput.addEventListener('input', () => {
      query = searchInput?.value ?? '';
      paintOptions();
    });
    // Keep typing from closing via document key handlers elsewhere.
    searchInput.addEventListener('keydown', (e) => e.stopPropagation());
    searchWrap.append(searchIcon, searchInput);

    const list = document.createElement('div');
    list.className = 'cgext-col-dd-list cg-scrollbar';

    panel.append(searchWrap, list);
    document.body.appendChild(panel);
    trigger.setAttribute('aria-expanded', 'true');

    const r = trigger.getBoundingClientRect();
    const width = Math.max(r.width, 220);
    panel.style.setProperty('--cgext-col-dd-top', `${Math.round(r.bottom + 4)}px`);
    panel.style.setProperty('--cgext-col-dd-left', `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)))}px`);
    panel.style.setProperty('--cgext-col-dd-width', `${Math.round(width)}px`);

    paintOptions();
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => searchInput?.focus());
  };

  trigger.addEventListener('click', open);

  return {
    root,
    setLabel(text: string) { triggerText.textContent = text || 'Select column'; },
    destroy() { close(); },
  };
}

export function columnSettingsModule(): SettingsModule {
  return {
    id: 'column-settings',
    kind: 'settings-module',
    title: 'Column Settings',
    icon: 'columns',
    category: 'layout',

    init(): void {
      defineChromeComponents();
    },

    mount(host: HTMLElement, ctx: CgExtContext): ModuleInstance {
      host.classList.add('cgext-col-settings');
      injectColSettingsStyles();

      const grid = asGrid(ctx.grid);
      let selectedId = '';
      let columns: ColItem[] = [];

      const form = document.createElement('div');
      form.className = 'cgext-col-settings-form';

      const markDirty = () => ctx.profiles.markDirty();

      const applyFlag = (colId: string, key: FlagKey | string, value: unknown) => {
        try {
          grid.editColumn(colId, { [key]: value });
          markDirty();
        } catch { /* */ }
      };

      const paintForm = () => {
        form.replaceChildren();
        const colId = selectedId;
        if (!colId) {
          const empty = document.createElement('div');
          empty.className = 'cgext-col-settings-empty';
          empty.textContent = 'No columns.';
          form.append(empty);
          return;
        }

        const flag = (key: FlagKey) => !!effectiveFlag(grid, colId, key);

        const filterBand = document.createElement('cgc-band');
        filterBand.setAttribute('band-title', 'Filter');
        filterBand.append(
          switchOf('Floating filter', flag('floatingFilter'), (next) => {
            applyFlag(colId, 'floatingFilter', next);
          }),
        );
        {
          const raw = effectiveFlag(grid, colId, 'filter');
          const current = (raw as string | undefined) ?? 'auto';
          filterBand.append(selectOf(
            'Filter type',
            [
              { value: 'auto', label: 'Auto' },
              { value: 'text', label: 'Text' },
              { value: 'number', label: 'Number' },
              { value: 'date', label: 'Date' },
              { value: 'set', label: 'Set' },
            ],
            current === null || current === undefined ? 'auto' : String(current),
            (v) => {
              applyFlag(colId, 'filter', v === 'auto' ? null : v);
              paintForm();
            },
          ));
        }
        form.append(filterBand);

        const groupBand = document.createElement('cgc-band');
        groupBand.setAttribute('band-title', 'Grouping');
        groupBand.append(
          switchOf('Groupable', flag('enableRowGroup'), (next) => {
            applyFlag(colId, 'enableRowGroup', next);
          }),
          switchOf('Pivotable', flag('enablePivot'), (next) => {
            applyFlag(colId, 'enablePivot', next);
          }),
        );
        form.append(groupBand);

        const aggBand = document.createElement('cgc-band');
        aggBand.setAttribute('band-title', 'Aggregation');
        {
          const valueCols = grid.getValueColumns();
          const aggOf = valueCols.find((v) => v.colId === colId)?.aggFunc;
          const current = aggOf ?? 'none';
          aggBand.append(selectOf(
            'Function',
            [
              { value: 'none', label: 'None' },
              ...aggFuncChoices(grid).map((v) => ({ value: v, label: v })),
            ],
            current,
            (v) => {
              try {
                const has = grid.getValueColumns().some((x) => x.colId === colId);
                if (v === 'none') { if (has) grid.removeValueColumn(colId); }
                else if (has) grid.setValueColumnAggFunc(colId, v);
                else grid.addValueColumn(colId, v);
                markDirty();
              } catch { /* */ }
              paintForm();
            },
          ));
          const anyAgg = aggOf !== undefined;
          const showInHeader = !effectiveFlag(grid, colId, 'suppressAggFuncInHeader');
          aggBand.append(switchOf(
            'Show in header',
            showInHeader,
            (next) => applyFlag(colId, 'suppressAggFuncInHeader', !next),
            { disabled: !anyAgg },
          ));
        }
        form.append(aggBand);

        const behBand = document.createElement('cgc-band');
        behBand.setAttribute('band-title', 'Behavior');
        behBand.append(
          switchOf('Sortable', flag('sortable'), (next) => applyFlag(colId, 'sortable', next)),
          switchOf('Resizable', flag('resizable'), (next) => applyFlag(colId, 'resizable', next)),
          switchOf('Editable', flag('editable'), (next) => applyFlag(colId, 'editable', next)),
        );
        {
          const pinned = grid.getColumnState().find((s) => s.colId === colId)?.pinned ?? null;
          const current = pinned === 'left' || pinned === 'right' ? pinned : 'none';
          behBand.append(selectOf(
            'Pinned',
            [
              { value: 'left', label: 'Left' },
              { value: 'none', label: 'None' },
              { value: 'right', label: 'Right' },
            ],
            current,
            (v) => {
              try {
                grid.setColumnsPinned([colId], v === 'none' ? null : (v as 'left' | 'right'));
                markDirty();
              } catch { /* */ }
              paintForm();
            },
          ));
        }
        behBand.append(
          switchOf('Hidden', flag('hide'), (next) => applyFlag(colId, 'hide', next)),
        );
        form.append(behBand);
      };

      const dd = createColumnDropdown({
        getColumns: () => columns,
        getSelectedId: () => selectedId,
        onSelect: (id) => {
          selectedId = id;
          const col = columns.find((c) => c.id === id);
          dd.setLabel(col?.label ?? id);
          paintForm();
        },
      });

      const pickerField = fieldOf('Column', dd.root);

      const refresh = () => {
        columns = leafColumns(ctx.grid);
        if (!selectedId || !columns.some((c) => c.id === selectedId)) {
          selectedId = columns[0]?.id ?? '';
        }
        const col = columns.find((c) => c.id === selectedId);
        dd.setLabel(col?.label ?? (selectedId || 'Select column'));
        paintForm();
      };

      refresh();
      host.append(pickerField, form);

      return {
        destroy() {
          dd.destroy();
          host.replaceChildren();
        },
        refresh,
      };
    },
  };
}

function injectColSettingsStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('cgext-col-settings-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'cgext-col-settings-styles';
    document.head.appendChild(style);
  }
  style.textContent = `
.cgext-col-settings {
  display: flex;
  flex-direction: column;
  gap: 0;
  box-sizing: border-box;
  --cg-settings-accent: var(--cg-focus-ring-color);
}

.cgext-col-settings-empty {
  padding: 12px;
  font-size: var(--cg-font-size-sm, 12px);
  color: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 55%, transparent);
}

.cgext-col-settings-form cgc-switch.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

/* Column dropdown trigger (sits in cgc-field control slot). */
.cgext-col-dd { display: inline-flex; max-width: 100%; }
.cgext-col-dd-trigger {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  min-width: 120px;
  height: 26px;
  padding: 0 8px;
  font: inherit;
  font-size: var(--cg-font-size-sm, 12px);
  color: var(--cg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 5%, transparent);
  border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 2px;
  cursor: pointer;
  outline: none;
}
.cgext-col-dd-trigger:focus-visible,
.cgext-col-dd-trigger[aria-expanded="true"] {
  border-color: var(--cg-settings-accent, var(--cg-focus-ring-color, #4f9cf9));
}
.cgext-col-dd-trigger-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: left;
}
.cgext-col-dd-caret {
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 55%, transparent);
}

/* Body-mounted dropdown panel with search. */
.cgext-col-dd-panel {
  position: fixed;
  top: var(--cgext-col-dd-top, 0);
  left: var(--cgext-col-dd-left, 0);
  width: var(--cgext-col-dd-width, 220px);
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  max-height: min(320px, 50vh);
  background: var(--cg-bg-color, #1a222d);
  color: var(--cg-fg-color, #e5e9f0);
  border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 2px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-family: var(--cg-font-family);
  font-size: var(--cg-font-size-sm, 12px);
}
.cgext-col-dd-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--cg-border-color, #2a3140);
  flex: 0 0 auto;
}
.cgext-col-dd-search-icon {
  position: absolute;
  left: 16px;
  width: 14px;
  height: 14px;
  pointer-events: none;
  opacity: 0.5;
  background-color: var(--cg-fg-color, #e5e9f0);
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='16.5' y1='16.5' x2='22' y2='22'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='16.5' y1='16.5' x2='22' y2='22'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.cgext-col-dd-search {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  min-width: 0;
  padding: 4px 8px 4px 26px;
  font: inherit;
  color: var(--cg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 5%, transparent);
  border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 2px;
  outline: none;
  box-sizing: border-box;
}
.cgext-col-dd-search:focus {
  border-color: var(--cg-settings-accent, var(--cg-focus-ring-color, #4f9cf9));
}
.cgext-col-dd-search::placeholder { opacity: 0.5; }

.cgext-col-dd-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.cgext-col-dd-empty {
  padding: 12px;
  color: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 55%, transparent);
}
.cgext-col-dd-option {
  appearance: none;
  -webkit-appearance: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--cg-fg-color, #e5e9f0);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.cgext-col-dd-option:hover {
  background: var(--cg-row-hover-bg, rgba(255,255,255,0.05));
}
.cgext-col-dd-option.is-selected {
  background: color-mix(in srgb, var(--cg-settings-accent, var(--cg-focus-ring-color, #4f9cf9)) 14%, transparent);
}
.cgext-col-dd-option.is-selected .cgext-col-dd-option-label {
  color: var(--cg-settings-accent, var(--cg-focus-ring-color, #4f9cf9));
  font-weight: 600;
}
.cgext-col-dd-option-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cgext-col-dd-option-id {
  flex: 0 1 auto;
  max-width: 40%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10px;
  color: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 45%, transparent);
}
`;
}
