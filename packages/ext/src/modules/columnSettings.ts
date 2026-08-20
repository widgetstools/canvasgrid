/**
 * Column Settings — cockpit master-detail editor (same Save / Reset card
 * pattern as Styling Rules and Calculated Columns).
 *
 * Edits land in a local draft; Save commits to the grid + marks the
 * profile dirty. Reset discards the draft. Switches no longer live-apply
 * (the previous lit cgc-switch path never re-painted, so toggles looked
 * dead after the first click).
 */
import type { ColumnOverride } from '@wellsfargo-starui/velocity-grid/calc';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import {
  aggFuncChoices,
  effectiveFlag,
  type ColumnConfigGrid,
  type FlagKey,
} from '../toolbar/columnPanel';
import {
  band,
  caps,
  chip,
  el,
  injectCockpitStyles,
  lucideSvg,
  row,
  select,
  switchToggle,
  textInput,
  appendPaneChrome,
  takePaneScroll,
  restorePaneScroll,
  emptyState,
  engineMissingNotice,
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
  valueGetter: string;
}

/** The slice of the calc engine the caption path needs — caption lives on the
 *  per-column override assignment, not on `editColumn` (which strips
 *  headerName). D-F8: resolved through `ctx.engines`, never off a grid
 *  expando. */
interface CalcCaptionEngine {
  getOverrides(): ColumnOverride[];
  applyOverrides(overrides: ColumnOverride[]): unknown;
}

function leafColumns(grid: VelocityGridExtContext['grid']): ColItem[] {
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

function asGrid(grid: VelocityGridExtContext['grid']): ColumnConfigGrid {
  return grid as unknown as ColumnConfigGrid;
}

interface ValueGetterApi {
  getColumnDefsSnapshot?: () => Array<Record<string, unknown>>;
  updateGridOptions?: (partial: { columnDefs: unknown[] }) => void;
  getGridOption(key: string): unknown;
}

function valueGetterSrcFromDef(def: Record<string, unknown> | undefined): string {
  if (!def) return '';
  if (typeof def.valueGetter === 'string') return def.valueGetter.trim();
  if (typeof def._valueGetterSrc === 'string') return def._valueGetterSrc.trim();
  return '';
}

function findAuthoredLeaf(
  grid: ValueGetterApi,
  colId: string,
): Record<string, unknown> | undefined {
  const walk = (defs: readonly unknown[]): Record<string, unknown> | undefined => {
    for (const d of defs) {
      const def = d as { colId?: string; field?: string; children?: unknown[] };
      if (def.children?.length) {
        const hit = walk(def.children);
        if (hit) return hit;
      } else if (def.colId === colId || def.field === colId) {
        return def as Record<string, unknown>;
      }
    }
    return undefined;
  };
  try { return walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { return undefined; }
}

function readValueGetterSrc(grid: ValueGetterApi, colId: string): string {
  const snap = grid.getColumnDefsSnapshot?.() ?? [];
  const fromSnap = snap.find((d) => String(d.colId ?? d.field) === colId);
  const src = valueGetterSrcFromDef(fromSnap);
  if (src) return src;
  return valueGetterSrcFromDef(findAuthoredLeaf(grid, colId));
}

function applyValueGetter(grid: ValueGetterApi, colId: string, expr: string): void {
  if (typeof grid.getColumnDefsSnapshot !== 'function' || typeof grid.updateGridOptions !== 'function') {
    return;
  }
  const snap = grid.getColumnDefsSnapshot();
  const i = snap.findIndex((d) => String(d.colId ?? d.field) === colId);
  if (i < 0) return;
  const cur = snap[i]!;
  const nextExpr = expr.trim();
  const prev = valueGetterSrcFromDef(cur);
  if (prev === nextExpr) return;
  const next: Record<string, unknown> = { ...cur };
  if (nextExpr) next.valueGetter = nextExpr;
  else delete next.valueGetter;
  delete next._valueGetterSrc;
  snap[i] = next;
  grid.updateGridOptions({ columnDefs: snap });
}

/** Caption is column-unique — CalcEngine.editColumn strips headerName from
 *  templates. Write it on the per-column override assignment instead.
 *
 *  D-F8 — returns whether the write actually happened. It used to return
 *  `undefined` either way, so with no calc engine wired the Save button
 *  reported success, marked the profile dirty and re-rendered the editor with
 *  the new caption while the grid header never changed. `save()` now surfaces
 *  a visible notice on `false`. */
function applyCaption(calc: CalcCaptionEngine | null, colId: string, headerName: string): boolean {
  if (!calc) return false;
  const existing = calc.getOverrides().find((o) => o.colId === colId) ?? { colId };
  const next: ColumnOverride = { ...existing, colId };
  const trimmed = headerName.trim();
  if (trimmed) next.headerName = trimmed;
  else delete next.headerName;
  calc.applyOverrides([next]);
  return true;
}

function readDraft(
  grid: ColumnConfigGrid,
  calc: CalcCaptionEngine | null,
  colId: string,
  label: string,
): ColumnDraft {
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
    const ov = calc?.getOverrides().find((o) => o.colId === colId);
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
    valueGetter: readValueGetterSrc(grid as unknown as ValueGetterApi, colId),
  };
}

/** Returns whether the CAPTION half of the draft landed — the flags/agg/pin
 *  half rides kernel APIs and always applies, but the caption needs the calc
 *  engine's override layer (D-F8). */
function applyDraft(
  grid: ColumnConfigGrid,
  calc: CalcCaptionEngine | null,
  draft: ColumnDraft,
): boolean {
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
  const captionApplied = applyCaption(calc, id, draft.headerName);
  grid.setColumnsPinned([id], draft.pinned === '' ? null : draft.pinned);
  applyValueGetter(grid as unknown as ValueGetterApi, id, draft.valueGetter);
  return captionApplied;
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

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      const grid = asGrid(ctx.grid);
      // D-F8 — resolved on EVERY call, never hoisted: this pane is typically
      // mounted before the host (or the Calculated Columns module) has wired
      // calc, and a mount-time snapshot would pin `null` for the pane's whole
      // life.
      const calcEngine = (): CalcCaptionEngine | null => ctx.engines.get('calc');

      let columns: ColItem[] = [];
      let selectedId: string | null = null;
      let committed: ColumnDraft | null = null;
      let draft: ColumnDraft | null = null;
      let filterQuery = '';
      /** Set when the last Save could not write the caption because no calc
       *  engine is wired. Rendered as a banner above the pane body; cleared
       *  on the next Save or column switch. */
      let captionBlocked = false;

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
        captionBlocked = false;
        if (!id) {
          committed = null;
          draft = null;
        } else {
          const label = columns.find((c) => c.id === id)?.label ?? id;
          committed = readDraft(grid, calcEngine(), id, label);
          draft = clone(committed);
        }
        renderAll();
      };

      const save = (): void => {
        if (!draft) return;
        try {
          const savedCaption = draft.headerName.trim() || draft.colId;
          const captionChanged = savedCaption !== (committed?.headerName ?? '');
          const captionApplied = applyDraft(grid, calcEngine(), draft);
          // D-F8 — the flags/agg/pin half always lands (kernel APIs); only the
          // caption needs calc. Claim success for the caption ONLY when it
          // actually got written, otherwise raise the shared notice and leave
          // the pane dirty so the unsaved caption stays visible.
          captionBlocked = captionChanged && !captionApplied;
          ctx.profiles.markDirty();
          loadColumns();
          // Prefer the caption we just wrote — getColumnHeaderName can lag a
          // frame behind the override fold, and must not wipe the editor.
          const col = columns.find((c) => c.id === draft!.colId);
          if (col && !captionBlocked) col.label = savedCaption;
          const nextCommitted = readDraft(grid, calcEngine(), draft.colId, savedCaption);
          if (!captionBlocked) nextCommitted.headerName = savedCaption;
          committed = nextCommitted;
          draft = captionBlocked
            ? { ...clone(nextCommitted), headerName: draft.headerName }
            : clone(nextCommitted);
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
          rail.appendChild(emptyState({
            title: columns.length === 0 ? 'No columns' : 'No matches',
            description: columns.length === 0
              ? 'This grid has no leaf columns to configure.'
              : 'Try a different filter.',
            icon: 'columns-3',
          }));
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
        const scrollTop = takePaneScroll(pane);
        pane.replaceChildren();
        if (!draft) {
          pane.appendChild(emptyState({
            title: 'No column selected',
            description: 'Select a column to edit its settings.',
            icon: 'columns-3',
          }));
          return;
        }
        const d = draft;

        const head = el('div', 'ckp-pane-head');
        const dirtyChip = chip('Dirty', isDirty() ? 'YES' : '—', isDirty() ? 'warning' : 'neutral');
        const saveBtn = el('button', 'ckp-actbtn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        const resetBtn = el('button', 'ckp-actbtn ckp-btn-secondary');
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
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
        head.append(nameIn, saveBtn, resetBtn);
        const body = appendPaneChrome(pane, head);

        // D-F8 — the caption Save that just failed, made visible. Above the
        // chips so it is the first thing in the pane body.
        if (captionBlocked) {
          body.appendChild(engineMissingNotice('calc', {
            feature: 'Editing a column caption',
            variant: 'banner',
            detail: 'The caption was NOT saved — column captions ride the calc '
              + 'engine’s override layer. Every other setting on this pane was applied.',
          }));
        }

        const chips = el('div', 'ckp-chips-strip');
        chips.append(
          chip('Col id', d.colId, 'info').root,
          dirtyChip.root,
          chip('Pinned', d.pinned ? d.pinned.toUpperCase() : 'OFF', d.pinned ? 'info' : 'neutral').root,
          chip('Hidden', d.hide ? 'YES' : 'NO', d.hide ? 'warning' : 'neutral').root,
          chip('fx', d.valueGetter ? 'SET' : 'OFF', d.valueGetter ? 'info' : 'neutral').root,
        );
        body.appendChild(chips);

        const sync = (): void => { renderRail(); renderPane(); };

        const headerBand = band('Header');
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
        body.appendChild(headerBand.root);

        const filterBand = band('Filter');
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
        body.appendChild(filterBand.root);

        const groupBand = band('Grouping');
        groupBand.body.append(
          row('Groupable', switchToggle(d.enableRowGroup, (v) => { d.enableRowGroup = v; sync(); })),
          row('Pivotable', switchToggle(d.enablePivot, (v) => { d.enablePivot = v; sync(); })),
        );
        body.appendChild(groupBand.root);

        const aggBand = band('Aggregation');
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
        body.appendChild(aggBand.root);

        const behBand = band('Behavior');
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
        body.appendChild(behBand.root);

        const getterBand = band('Value getter');
        const ta = el('textarea', 'ckp-input mono');
        ta.rows = 4;
        ta.value = d.valueGetter;
        ta.placeholder = '[ask] - [bid]';
        ta.setAttribute('aria-label', 'Value getter expression');
        ta.style.cssText = 'width:100%;min-height:72px;resize:vertical;padding:8px 10px;line-height:1.45';
        ta.addEventListener('input', () => {
          d.valueGetter = ta.value;
          syncDirty();
        });
        const getterHelp = el(
          'p',
          'ckp-help',
          'Expression for this column’s cell value (AG Grid valueGetter). '
            + 'Use [field] references, IF(cond, a, b), or cond ? a : b. '
            + 'Leave empty to use the raw field. Function-form getters cannot be edited here.',
        );
        getterHelp.style.margin = '0 0 8px';
        getterBand.body.append(getterHelp, ta);
        body.appendChild(getterBand.root);

        restorePaneScroll(pane, scrollTop);
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
        commit() { if (isDirty()) save(); },
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
