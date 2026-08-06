/**
 * Column Settings — cockpit master-detail editor (same Save / Reset card
 * pattern as Styling Rules and Calculated Columns).
 *
 * Edits land in a local draft; Save commits to the grid + marks the
 * profile dirty. Reset discards the draft. Switches no longer live-apply
 * (the previous lit cgc-switch path never re-painted, so toggles looked
 * dead after the first click).
 */
import type { SettingsModule, CgExtContext, ModuleInstance } from '../extension/types';
import {
  aggFuncChoices,
  effectiveFlag,
  type ColumnConfigGrid,
  type FlagKey,
} from '../toolbar/columnPanel';
import {
  band, caps, chip, el, injectCockpitStyles, lucideSvg, row, select, switchToggle, textInput,
} from '../ui/cockpit';

interface ColItem {
  id: string;
  label: string;
}

interface ColumnDraft {
  colId: string;
  headerName: string;
  floatingFilter: boolean;
  filter: string; // 'auto' | text | number | date | set
  enableRowGroup: boolean;
  enablePivot: boolean;
  aggFunc: string; // 'none' | sum | …
  showAggInHeader: boolean;
  sortable: boolean;
  resizable: boolean;
  editable: boolean;
  pinned: 'left' | 'right' | '';
  hide: boolean;
}

/** Calc bridge marker — caption lives on the override assignment, not editColumn. */
interface CalcCaptionHost {
  __calcBridgeWired?: {
    calc: {
      getOverrides(): Array<{ colId: string; headerName?: string; templateIds?: string[]; [k: string]: unknown }>;
      applyOverrides(overrides: Array<Record<string, unknown>>): unknown;
    };
  };
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

/** Caption is column-unique — CalcEngine.editColumn strips headerName from
 *  templates. Write it on the per-column override assignment instead. */
function applyCaption(grid: ColumnConfigGrid, colId: string, headerName: string): void {
  const calc = (grid as unknown as CalcCaptionHost).__calcBridgeWired?.calc;
  if (!calc) return;
  const existing = calc.getOverrides().find((o) => o.colId === colId) ?? { colId };
  const next: Record<string, unknown> = { ...existing, colId };
  const trimmed = headerName.trim();
  if (trimmed) next.headerName = trimmed;
  else delete next.headerName;
  calc.applyOverrides([next]);
}

function readDraft(grid: ColumnConfigGrid, colId: string, label: string): ColumnDraft {
  const flag = (key: FlagKey) => !!effectiveFlag(grid, colId, key);
  const rawFilter = effectiveFlag(grid, colId, 'filter');
  const filter = rawFilter == null || rawFilter === undefined || rawFilter === true
    ? 'auto'
    : String(rawFilter);
  const aggOf = grid.getValueColumns().find((v) => v.colId === colId)?.aggFunc;
  const pinned = grid.getColumnState().find((s) => s.colId === colId)?.pinned ?? null;
  // Prefer live header (post-override), then override assignment, then rail label.
  let headerName = label;
  try {
    const live = (grid as unknown as { getColumnHeaderName?(id: string): string | undefined })
      .getColumnHeaderName?.(colId);
    if (live) headerName = live;
  } catch { /* */ }
  try {
    const ov = (grid as unknown as CalcCaptionHost).__calcBridgeWired?.calc
      .getOverrides()
      .find((o) => o.colId === colId);
    if (ov?.headerName) headerName = ov.headerName;
  } catch { /* */ }
  return {
    colId,
    headerName,
    floatingFilter: flag('floatingFilter'),
    filter,
    enableRowGroup: flag('enableRowGroup'),
    enablePivot: flag('enablePivot'),
    aggFunc: aggOf ?? 'none',
    showAggInHeader: !flag('suppressAggFuncInHeader'),
    sortable: flag('sortable'),
    resizable: flag('resizable'),
    editable: flag('editable'),
    pinned: pinned === 'left' || pinned === 'right' ? pinned : '',
    hide: flag('hide'),
  };
}

function applyDraft(grid: ColumnConfigGrid, draft: ColumnDraft): void {
  const id = draft.colId;
  const patch = (key: string, value: unknown): void => {
    grid.editColumn(id, { [key]: value });
  };
  // Def flags / agg / pin via editColumn (templatable set).
  patch('floatingFilter', draft.floatingFilter);
  patch('filter', draft.filter === 'auto' ? null : draft.filter);
  patch('enableRowGroup', draft.enableRowGroup);
  patch('enablePivot', draft.enablePivot);
  patch('sortable', draft.sortable);
  patch('resizable', draft.resizable);
  patch('editable', draft.editable);
  patch('hide', draft.hide);
  patch('suppressAggFuncInHeader', !draft.showAggInHeader);

  const has = grid.getValueColumns().some((x) => x.colId === id);
  if (draft.aggFunc === 'none') {
    if (has) grid.removeValueColumn(id);
  } else if (has) {
    grid.setValueColumnAggFunc(id, draft.aggFunc);
  } else {
    grid.addValueColumn(id, draft.aggFunc);
  }

  // Caption before pin — applyOverrides / editColumn rebuild column defs and
  // drop runtime pin state; pin must be the last write.
  applyCaption(grid, id, draft.headerName);
  grid.setColumnsPinned([id], draft.pinned === '' ? null : draft.pinned);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function columnSettingsModule(): SettingsModule {
  return {
    id: 'column-settings',
    kind: 'settings-module',
    title: 'Column Settings',
    icon: 'table-properties',
    category: 'layout',

    init(): void {
      injectCockpitStyles();
    },

    mount(host: HTMLElement, ctx: CgExtContext): ModuleInstance {
      const grid = asGrid(ctx.grid);

      let columns: ColItem[] = [];
      let selectedId: string | null = null;
      let committed: ColumnDraft | null = null;
      let draft: ColumnDraft | null = null;
      let filterQuery = '';

      const root = el('div', 'ckp');
      const rail = el('div', 'ckp-rail');
      const pane = el('div', 'ckp-pane');
      root.append(rail, pane);
      host.appendChild(root);

      const isDirty = (): boolean => {
        if (!draft || !committed) return false;
        return JSON.stringify(draft) !== JSON.stringify(committed);
      };

      const loadColumns = (): void => {
        columns = leafColumns(ctx.grid);
      };

      const selectColumn = (id: string | null, force = false): void => {
        if (!force && id !== selectedId && isDirty()) {
          const ok = window.confirm('Discard unsaved column changes?');
          if (!ok) return;
        }
        selectedId = id;
        if (!id) {
          committed = null;
          draft = null;
        } else {
          const label = columns.find((c) => c.id === id)?.label ?? id;
          committed = readDraft(grid, id, label);
          draft = clone(committed);
        }
        renderAll();
      };

      const save = (): void => {
        if (!draft) return;
        try {
          const savedCaption = draft.headerName.trim() || draft.colId;
          applyDraft(grid, draft);
          ctx.profiles.markDirty();
          loadColumns();
          // Prefer the caption we just wrote — getColumnHeaderName can lag a
          // frame behind the override fold, and must not wipe the editor.
          const col = columns.find((c) => c.id === draft!.colId);
          if (col) col.label = savedCaption;
          committed = readDraft(grid, draft.colId, savedCaption);
          committed.headerName = savedCaption;
          draft = clone(committed);
          renderAll();
        } catch {
          /* engine absent */
        }
      };

      const reset = (): void => {
        if (!committed) return;
        draft = clone(committed);
        renderAll();
      };

      const renderRail = (): void => {
        rail.replaceChildren();
        const head = el('div', 'ckp-rail-head');
        head.append(
          caps('Columns'),
          el('span', 'ckp-caps ckp-count', String(columns.length).padStart(2, '0')),
        );
        rail.appendChild(head);

        const search = el('input', 'ckp-input') as HTMLInputElement;
        search.type = 'search';
        search.placeholder = 'Filter columns…';
        search.value = filterQuery;
        search.setAttribute('aria-label', 'Filter columns');
        search.style.cssText = 'width:100%;margin:0 0 10px;box-sizing:border-box';
        search.addEventListener('input', () => {
          filterQuery = search.value;
          renderRail();
        });
        // Keep focus after re-render.
        rail.appendChild(search);
        if (document.activeElement === search || filterQuery) {
          requestAnimationFrame(() => {
            const again = rail.querySelector<HTMLInputElement>('input[type="search"]');
            if (again) {
              again.focus();
              again.setSelectionRange(again.value.length, again.value.length);
            }
          });
        }

        const q = filterQuery.trim().toLowerCase();
        const filtered = q
          ? columns.filter((c) => c.id.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
          : columns;

        if (filtered.length === 0) {
          rail.appendChild(el('div', 'ckp-empty', columns.length === 0 ? 'No columns.' : 'No matches.'));
          return;
        }

        for (const col of filtered) {
          const rowEl = el('div', `ckp-rail-row${col.id === selectedId ? ' active' : ''}`);
          rowEl.appendChild(el('span', 'ckp-rail-name', col.label));
          if (col.id === selectedId && isDirty()) {
            const led = el('span', 'ckp-caps ckp-count', '•');
            led.style.color = 'var(--ckp-accent)';
            led.title = 'Unsaved changes';
            rowEl.appendChild(led);
          }
          rowEl.addEventListener('click', () => selectColumn(col.id));
          rail.appendChild(rowEl);
        }
      };

      const renderPane = (): void => {
        pane.replaceChildren();
        if (!draft) {
          pane.appendChild(el('div', 'ckp-empty', 'Select a column to edit its settings'));
          return;
        }
        const d = draft;

        const head = el('div', 'ckp-pane-head');
        const dirtyChip = chip('Dirty', isDirty() ? 'YES' : '—', isDirty() ? 'warning' : 'neutral');
        const resetBtn = el('button', 'ckp-actbtn');
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
        const saveBtn = el('button', 'ckp-actbtn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        const syncDirty = (): void => {
          const dirty = isDirty();
          saveBtn.disabled = !dirty;
          resetBtn.disabled = !dirty;
          dirtyChip.set(dirty ? 'YES' : '—', dirty ? 'warning' : 'neutral');
        };
        let captionIn: HTMLInputElement | null = null;
        const nameIn = textInput(d.headerName, (v) => {
          d.headerName = v;
          if (captionIn) captionIn.value = v;
          syncDirty();
        }, { className: 'ckp-title', placeholder: 'Caption' });
        nameIn.setAttribute('aria-label', 'Column caption');
        head.append(nameIn, resetBtn, saveBtn);
        pane.appendChild(head);

        const chips = el('div', 'ckp-chips-strip');
        chips.append(
          chip('Col id', d.colId, 'info').root,
          dirtyChip.root,
          chip('Pinned', d.pinned ? d.pinned.toUpperCase() : 'OFF', d.pinned ? 'info' : 'neutral').root,
          chip('Hidden', d.hide ? 'YES' : 'NO', d.hide ? 'warning' : 'neutral').root,
        );
        pane.appendChild(chips);

        const sync = (): void => { renderRail(); renderPane(); };

        const headerBand = band('01', 'Header');
        const colIdIn = textInput(d.colId, () => {}, { mono: true });
        colIdIn.readOnly = true;
        colIdIn.setAttribute('aria-label', 'Column id');
        captionIn = textInput(d.headerName, (v) => {
          d.headerName = v;
          nameIn.value = v;
          syncDirty();
        }, { placeholder: 'Display name in the column header' });
        captionIn.setAttribute('aria-label', 'Caption');
        headerBand.body.append(
          row('Col id', colIdIn, 'Read-only · column identifier'),
          row('Caption', captionIn, 'Header label shown on the grid'),
        );
        pane.appendChild(headerBand.root);

        const filterBand = band('02', 'Filter');
        filterBand.body.append(
          row('Floating filter', switchToggle(d.floatingFilter, (v) => { d.floatingFilter = v; sync(); })),
          row('Filter type', select(
            [
              ['auto', 'Auto'],
              ['text', 'Text'],
              ['number', 'Number'],
              ['date', 'Date'],
              ['set', 'Set'],
            ],
            d.filter,
            (v) => { d.filter = v; sync(); },
          )),
        );
        pane.appendChild(filterBand.root);

        const groupBand = band('03', 'Grouping');
        groupBand.body.append(
          row('Groupable', switchToggle(d.enableRowGroup, (v) => { d.enableRowGroup = v; sync(); })),
          row('Pivotable', switchToggle(d.enablePivot, (v) => { d.enablePivot = v; sync(); })),
        );
        pane.appendChild(groupBand.root);

        const aggBand = band('04', 'Aggregation');
        const aggChoices: Array<[string, string]> = [
          ['none', 'None'],
          ...aggFuncChoices(grid).map((v): [string, string] => [v, v]),
        ];
        aggBand.body.append(
          row('Function', select(aggChoices, d.aggFunc, (v) => { d.aggFunc = v; sync(); })),
          row(
            'Show in header',
            switchToggle(d.showAggInHeader, (v) => { d.showAggInHeader = v; sync(); }),
            d.aggFunc === 'none' ? 'Requires an aggregation function' : undefined,
          ),
        );
        pane.appendChild(aggBand.root);

        const behBand = band('05', 'Behavior');
        behBand.body.append(
          row('Sortable', switchToggle(d.sortable, (v) => { d.sortable = v; sync(); })),
          row('Resizable', switchToggle(d.resizable, (v) => { d.resizable = v; sync(); })),
          row('Editable', switchToggle(d.editable, (v) => { d.editable = v; sync(); })),
          row('Pinned', select(
            [
              ['', 'None'],
              ['left', 'Left'],
              ['right', 'Right'],
            ],
            d.pinned,
            (v) => { d.pinned = v as ColumnDraft['pinned']; sync(); },
          )),
          row('Hidden', switchToggle(d.hide, (v) => { d.hide = v; sync(); }), 'Hide the column on the grid'),
        );
        pane.appendChild(behBand.root);
      };

      const renderAll = (): void => {
        renderRail();
        renderPane();
      };

      loadColumns();
      selectColumn(columns[0]?.id ?? null, true);

      return {
        destroy() {
          host.replaceChildren();
        },
        refresh() {
          loadColumns();
          if (selectedId && !columns.some((c) => c.id === selectedId)) {
            selectColumn(columns[0]?.id ?? null, true);
          } else if (selectedId && !isDirty()) {
            selectColumn(selectedId, true);
          } else {
            renderAll();
          }
        },
      };
    },
  };
}
