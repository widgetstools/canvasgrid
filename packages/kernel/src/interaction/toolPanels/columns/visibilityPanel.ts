// Cycle 19 / Task 7 — column visibility sub-panel.
//
// Owns the top of the columns tool panel: Search input + Select All
// checkbox + the scrollable Column Rows list. Each row is one column
// OR group (T2 — hierarchical rendering), each with a drag handle. The
// row-drag orchestrator routes into (LEAF drags only for steps 1-4):
//   1. The row group panel top strip (external router).
//   2. The pivot panel top strip (external router).
//   3. The column-header band (external router).
//   4. The three in-panel drop zones (pivot → values → row groups).
//   5. Fallback (leaf OR group drags) → group-aware reorder/re-parent
//      via `resolveDrop()` + `commitDrop()` (T3), calling
//      `api.moveColumnToGroup` / `api.moveColumnGroup`.

import type { CColDef, CColGroupDef, VelocityGridApi, CColumnState } from '../../../types';
import type {
  IToolPanelColumnCompParams,
} from '../types';
import {
  routeExternalDragHover,
  clearExternalDragHover,
  routePivotPanelDragHover,
  clearPivotPanelDragHover,
} from '../../features/columnDrag';
import {
  DRAG_THRESHOLD_PX,
  getZoneRect,
  isPointInRect,
  makeDragGhost,
  setZoneDropState,
  type DropZoneSpec,
} from './shared';
import { resolveDefaultAggFunc } from './valuesZonePanel';
import { ensureGroupIds, isColGroupDef } from '../../../core/columnTree';
import {
  moveColumnToGroup as moveColumnToGroupPure,
  moveColumnGroup as moveColumnGroupPure,
} from '../../../core/columnGroupMutation';

/** Per-row DOM handles cached for in-place refresh. Leaves are keyed by
 *  `colId` in `this.rows`; groups are namespaced `grp:${groupId}` so a
 *  group id can never collide with a leaf colId. */
interface LeafPanelRow {
  kind: 'leaf';
  el: HTMLElement;
  colId: string;
  checkbox: HTMLInputElement;
  label: HTMLElement;
}
interface GroupPanelRow {
  kind: 'group';
  el: HTMLElement;
  groupId: string;
  caret: HTMLElement;
  checkbox: HTMLInputElement;
  label: HTMLElement;
  /** Every leaf colId nested under this group, direct + transitive. */
  descendantLeafIds: string[];
}
type PanelRow = LeafPanelRow | GroupPanelRow;

/** T3 — the result of hit-testing a drag's pointer position against the
 *  rendered row list. `kind` is what's being DRAGGED (a leaf column or a
 *  whole group); `targetGroupId` is the destination group (`null` = top
 *  level); `beforeId` (a colId or groupId) is the sibling `movingId`
 *  should land before within the target's children — `undefined` means
 *  append at the end. */
export interface ColumnsPanelResolvedDrop {
  kind: 'col' | 'group';
  movingId: string;
  targetGroupId: string | null;
  beforeId?: string;
}

/** Deps threaded into `ColumnVisibilityPanel`. The zone-spec provider
 *  lets the row-drag orchestrator route into whatever zones the shell
 *  currently has mounted (row groups / column labels / values). */
export interface ColumnVisibilityPanelDeps {
  api: VelocityGridApi;
  params: IToolPanelColumnCompParams;
  resolveLabel(colId: string): string;
  rootHost: HTMLElement;
  isColumnRowGroupable(colId: string): boolean;
  isColumnPivotable(colId: string): boolean;
  isColumnValueable(colId: string): boolean;
  /** Return the current zone specs — the shell rebuilds this list from
   *  whichever zone panels are mounted. Order matters (pivot → values
   *  → row groups per the AG-Grid hit-test priority). */
  getDropZoneSpecs(): DropZoneSpec[];
}

export class ColumnVisibilityPanel {
  private readonly deps: ColumnVisibilityPanelDeps;
  private readonly searchRow: HTMLElement | null;
  private searchInput: HTMLInputElement | null = null;
  private selectAllCb: HTMLInputElement | null = null;
  private readonly listEl: HTMLElement;
  private readonly rows = new Map<string, PanelRow>();
  private readonly unsubs: Array<() => void> = [];
  /** Panel-local expand state (T2 ambiguity ruling: this does NOT call
   *  `setColumnGroupState` — that's the grid header's separate
   *  open/closed concept). Empty set = every group expanded. Keyed by
   *  the SAME `groupId` used for `data-group-id` (not the `grp:`-prefixed
   *  `this.rows` key). */
  private readonly collapsed = new Set<string>();
  /** Ancestor group-id chain (root→parent, EXCLUDING the row's own id)
   *  for every row key in `this.rows` — lets `applyCollapseVisibility`
   *  recompute display for the whole tree in one pass without a DOM
   *  rebuild whenever a caret toggles. Rebuilt alongside `this.rows` on
   *  every `buildRows()` pass. */
  private readonly ancestorGroupIds = new Map<string, string[]>();

  constructor(deps: ColumnVisibilityPanelDeps) {
    this.deps = deps;
    // The shell appends the search row + list DIRECTLY to
    // `.vg-columns-panel` so the CSS flex layout — `.vg-columns-panel`
    // is column-flex; `.vg-columns-panel-list` claims the remaining
    // vertical space via `flex: 2 1 0` so the zone sections pin to the
    // bottom — works unchanged. Wrapping search + list in an extra
    // container breaks that flex chain (the wrapper would default to
    // `flex: 0 0 auto` and collapse the list).
    this.searchRow = deps.params.suppressColumnFilter ? null : this.buildSearchRow();
    this.listEl = document.createElement('div');
    this.listEl.className = 'vg-columns-panel-list vg-scrollbar';
    this.buildRows();
    this.syncSelectAll();

    // Structural changes to the columnDefs tree — a column reparented
    // into/out of a group, a group created/renamed/deleted — invalidate
    // the whole rendered tree (row identities, indent depths,
    // descendantLeafIds). Unconditional (not gated by
    // `suppressSyncLayoutWithGrid`, which is about column LAYOUT sync,
    // not tree STRUCTURE) and IN ADDITION to the existing subscriptions
    // below.
    this.unsubs.push(
      deps.api.addEventListener('columnDefsChanged', () => this.rebuildRows()),
    );

    if (!deps.params.suppressSyncLayoutWithGrid) {
      this.unsubs.push(
        deps.api.addEventListener('columnVisible', () => this.refresh()),
        deps.api.addEventListener('columnMoved', () => this.refresh()),
      );
    }
    // Row-group subscription — pre-refactor semantic: gated by
    // `!suppressRowGroups` since the pivot-mode-strict row-checks
    // refresh is a downstream effect of the row-groups feature. Apps
    // that suppress rowGroups pay zero subscription overhead here.
    if (!deps.params.suppressRowGroups) {
      this.unsubs.push(
        deps.api.addEventListener('columnRowGroupChanged', () => {
          // pivotMode-OFF→ON checkbox semantics need the row-checks to
          // recompute when grouping changes.
          if (deps.api.isPivotMode?.() === true) this.refreshRowChecks();
        }),
      );
    }
    // Pivot-state subscription — keep the row checkboxes in sync with
    // role changes (pivot mode ON reads role membership). Cheap:
    // `refreshRowChecks` only re-reads checkbox state.
    const subscribesToPivot = !deps.params.suppressPivotMode
      || !deps.params.suppressPivots
      || !deps.params.suppressValues;
    if (subscribesToPivot) {
      this.unsubs.push(
        deps.api.addEventListener('pivotStateChanged', () => {
          this.refreshRowChecks();
        }),
      );
    }
  }

  /** Append the panel's DOM (search row + list) directly to the shell's
   *  `.vg-columns-panel` root so the CSS flex chain reaches the list. */
  appendTo(root: HTMLElement): void {
    if (this.searchRow) root.appendChild(this.searchRow);
    root.appendChild(this.listEl);
  }
  getListEl(): HTMLElement { return this.listEl; }
  getSearchInput(): HTMLInputElement | null { return this.searchInput; }

  refresh(): void {
    const state = this.deps.api.getColumnState();
    this.syncRows(state);
    this.applyVisibility();
    this.syncSelectAll();
    this.refreshRowChecks();
  }

  destroy(): void {
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.rows.clear();
    this.ancestorGroupIds.clear();
  }

  // ── Search + Select-All ────────────────────────────────────────────

  private buildSearchRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vg-columns-panel-search';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'vg-checkbox vg-columns-panel-select-all';
    cb.setAttribute('aria-label', 'Select all columns');
    cb.addEventListener('change', () => {
      const makeVisible = cb.checked;
      const state = this.deps.api.getColumnState();
      this.deps.api.applyColumnState({
        state: state.map(s => ({ ...s, hide: !makeVisible })),
        applyOrder: false,
      });
      this.refresh();
    });
    this.selectAllCb = cb;
    row.appendChild(cb);
    const wrap = document.createElement('div');
    wrap.className = 'vg-columns-panel-search-wrap';
    const icon = document.createElement('span');
    icon.className = 'vg-columns-panel-search-icon';
    icon.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search...';
    input.setAttribute('aria-label', 'Search columns');
    input.addEventListener('input', () => this.applySearchFilter(input.value));
    wrap.appendChild(icon);
    wrap.appendChild(input);
    row.appendChild(wrap);
    this.searchInput = input;
    return row;
  }

  /** Update the "Select All" checkbox to reflect current column
   *  visibility. Reads directly from the row checkbox DOM so it's
   *  always consistent with what the list rows show. LEAF rows only —
   *  group rows are tri-state summaries of their own descendants, not
   *  independent columns, so they must never count toward the total. */
  private syncSelectAll(): void {
    const cb = this.selectAllCb;
    if (!cb) return;
    const rows = Array.from(this.rows.values()).filter((r): r is LeafPanelRow => r.kind === 'leaf');
    const total = rows.length;
    if (total === 0) {
      cb.checked = false;
      cb.indeterminate = false;
      return;
    }
    const visible = rows.filter(r => r.checkbox.checked).length;
    if (visible === total) {
      cb.checked = true;
      cb.indeterminate = false;
    } else if (visible === 0) {
      cb.checked = false;
      cb.indeterminate = false;
    } else {
      cb.checked = false;
      cb.indeterminate = true;
    }
  }

  // ── Column rows ──────────────────────────────────────────────────────
  // T2 — hierarchical rendering. `buildRows()` walks the AUTHORED
  // columnDefs tree (`api.getColumnGroupDefs()`, groups + leaves,
  // depth-first) rather than the flat `getColumnState()` list, appending
  // ONE row per node — group or leaf — directly to `this.listEl` in
  // visitation order. There is no nested DOM container per group; every
  // row is a flat sibling and indentation is purely a `--vg-indent` CSS
  // custom property, exactly like the pre-existing colgroups authoring
  // panel's row family.

  private buildRows(): void {
    const state = this.deps.api.getColumnState();
    const stateById = new Map(state.map((s) => [s.colId, s]));
    // Normalize BEFORE rendering — `ensureGroupIds` synthesizes the SAME
    // `vg-grp-N` ids the mutation core (`columnGroupMutation.ts`)
    // synthesizes internally, so a `data-group-id` rendered here is always
    // a valid `moveColumnToGroup`/`moveColumnGroup` target, even for a
    // group authored without an explicit `groupId`.
    const defs = ensureGroupIds(this.deps.api.getColumnGroupDefs());
    this.walkDefs(defs, 0, [], stateById);
  }

  private walkDefs(
    nodes: (CColDef | CColGroupDef)[],
    depth: number,
    ancestors: string[],
    stateById: Map<string, CColumnState>,
  ): void {
    for (const node of nodes) {
      if (isColGroupDef(node)) {
        // `node.groupId` is always defined post-`ensureGroupIds`.
        const groupId = node.groupId!;
        const descendantLeafIds = this.collectLeafIds(node.children);
        const row = this.buildGroupRow(node, groupId, depth, descendantLeafIds, stateById);
        const key = `grp:${groupId}`;
        this.rows.set(key, row);
        this.ancestorGroupIds.set(key, ancestors);
        this.listEl.appendChild(row.el);
        this.walkDefs(node.children, depth + 1, [...ancestors, groupId], stateById);
      } else {
        const colId = node.colId ?? node.field;
        if (!colId) continue; // malformed leaf (neither colId nor field) — nothing to render.
        const entry = stateById.get(colId) ?? { colId, hide: false };
        const row = this.buildRow(entry, depth);
        this.rows.set(colId, row);
        this.ancestorGroupIds.set(colId, ancestors);
        this.listEl.appendChild(row.el);
      }
    }
  }

  /** Every leaf colId nested under `nodes`, direct + transitive,
   *  depth-first in declaration order. */
  private collectLeafIds(nodes: (CColDef | CColGroupDef)[]): string[] {
    const out: string[] = [];
    for (const node of nodes) {
      if (isColGroupDef(node)) {
        out.push(...this.collectLeafIds(node.children));
      } else {
        const colId = node.colId ?? node.field;
        if (colId) out.push(colId);
      }
    }
    return out;
  }

  /** Full rebuild — structural columnDefs changes (a leaf re-parented, a
   *  group created/deleted/renamed) invalidate every cached row + the
   *  ancestor-chain map, so there's no safe incremental diff. Panel-local
   *  `collapsed` state survives (a rebuild after a sibling edit
   *  shouldn't silently re-expand every other group). */
  private rebuildRows(): void {
    this.listEl.replaceChildren();
    this.rows.clear();
    this.ancestorGroupIds.clear();
    this.buildRows();
    this.applyVisibility();
    this.syncSelectAll();
  }

  private buildRow(entry: CColumnState, depth: number): LeafPanelRow {
    const el = document.createElement('div');
    el.className = 'vg-columns-panel-row';
    el.dataset.colId = entry.colId;
    el.style.setProperty('--vg-indent', String(depth));

    // Cycle 21i / Phase 1 — row layout is grip → label → checkbox (right),
    // moving away from the AG-style checkbox-left row. The checkbox stays a
    // native <input> (restyled via appearance:none) so the refresh /
    // select-all logic that reads `.checked` is unchanged.
    if (!this.deps.params.suppressColumnMove) {
      const handle = document.createElement('span');
      handle.className = 'vg-columns-panel-row-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('mousedown', (e) => this.beginRowDrag(e, entry.colId, 'col'));
      el.appendChild(handle);
    }

    const label = document.createElement('span');
    label.className = 'vg-columns-panel-row-label';
    label.textContent = this.deps.resolveLabel(entry.colId);
    el.appendChild(label);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'vg-checkbox vg-columns-panel-row-checkbox';
    checkbox.checked = this.computeRowChecked(entry);
    checkbox.setAttribute('aria-label', this.deps.resolveLabel(entry.colId));
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleRowCheckboxClick(entry.colId, checkbox);
    });
    el.appendChild(checkbox);

    // Whole-row click toggles visibility (except on the grip, which drags).
    // Modern column-selector affordance — the entire row is the hit target,
    // not just the checkbox.
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === checkbox || target.classList.contains('vg-columns-panel-row-handle')) return;
      checkbox.checked = !checkbox.checked;
      this.handleRowCheckboxClick(entry.colId, checkbox);
    });

    return { kind: 'leaf', el, colId: entry.colId, checkbox, label };
  }

  /** Build one group row: drag handle (T3) → label → caret (expand/collapse,
   *  panel-local, trailing the caption) → tri-state checkbox (checks/unchecks
   *  every descendant leaf). The handle starts a GROUP drag (`kind: 'group'`)
   *  that moves the whole group via `api.moveColumnGroup`. */
  private buildGroupRow(
    node: CColGroupDef,
    groupId: string,
    depth: number,
    descendantLeafIds: string[],
    stateById: Map<string, CColumnState>,
  ): GroupPanelRow {
    const el = document.createElement('div');
    el.className = 'vg-columns-panel-row vg-columns-panel-row--group';
    el.dataset.groupId = groupId;
    el.style.setProperty('--vg-indent', String(depth));

    if (!this.deps.params.suppressColumnMove) {
      const handle = document.createElement('span');
      handle.className = 'vg-columns-panel-row-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('mousedown', (e) => this.beginRowDrag(e, groupId, 'group'));
      el.appendChild(handle);
    }

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'vg-columns-panel-row-caret';
    // Horizontal disclosure caret, one vocabulary with the grid's
    // column-group header band: chevron-left when open (click collapses);
    // the stylesheet rotates it 180° into chevron-right when collapsed.
    caret.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    caret.setAttribute('aria-label', 'Toggle group');
    caret.setAttribute('aria-expanded', String(!this.collapsed.has(groupId)));
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.collapsed.has(groupId)) this.collapsed.delete(groupId);
      else this.collapsed.add(groupId);
      caret.setAttribute('aria-expanded', String(!this.collapsed.has(groupId)));
      this.applyVisibility();
    });

    const label = document.createElement('span');
    label.className = 'vg-columns-panel-row-label';
    label.textContent = node.headerName && node.headerName.length > 0 ? node.headerName : groupId;
    // Caption first, caret trailing it (grid header-band order).
    el.appendChild(label);
    el.appendChild(caret);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'vg-checkbox vg-columns-panel-row-checkbox';
    checkbox.setAttribute('aria-label', `Toggle all columns in ${label.textContent}`);
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deps.api.setColumnsVisible(descendantLeafIds, checkbox.checked);
    });
    el.appendChild(checkbox);

    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === checkbox || target === caret) return;
      checkbox.checked = !checkbox.checked;
      this.deps.api.setColumnsVisible(descendantLeafIds, checkbox.checked);
    });

    const row: GroupPanelRow = { kind: 'group', el, groupId, caret, checkbox, label, descendantLeafIds };
    this.applyGroupTriState(row, stateById);
    return row;
  }

  /** Tri-state: 'all' when every descendant leaf is checked (visible, or
   *  role-holding under pivot mode — see `computeRowChecked`), 'none'
   *  when every descendant is unchecked, 'mixed' otherwise. An empty
   *  `descendantLeafIds` (shouldn't happen — `resolveColumnTree` rejects
   *  empty `children`) degrades to 'none'. */
  private computeGroupChecked(
    descendantLeafIds: string[],
    stateById: Map<string, CColumnState>,
  ): 'all' | 'none' | 'mixed' {
    if (descendantLeafIds.length === 0) return 'none';
    let checkedCount = 0;
    for (const colId of descendantLeafIds) {
      const entry = stateById.get(colId) ?? { colId, hide: false };
      if (this.computeRowChecked(entry)) checkedCount++;
    }
    if (checkedCount === 0) return 'none';
    if (checkedCount === descendantLeafIds.length) return 'all';
    return 'mixed';
  }

  private applyGroupTriState(row: GroupPanelRow, stateById: Map<string, CColumnState>): void {
    const state = this.computeGroupChecked(row.descendantLeafIds, stateById);
    if (state === 'all') {
      row.checkbox.checked = true;
      row.checkbox.indeterminate = false;
    } else if (state === 'none') {
      row.checkbox.checked = false;
      row.checkbox.indeterminate = false;
    } else {
      // Mirrors the "Select all" mixed convention (`syncSelectAll`):
      // `checked = false` + `indeterminate = true`. A native click from
      // this state flips `checked` to `true`, so clicking a mixed group
      // checkbox always resolves to "show everything" first.
      row.checkbox.checked = false;
      row.checkbox.indeterminate = true;
    }
  }

  /** Checked state: a row is checked when the column is VISIBLE OR (in
   *  pivot mode) participates in a pivot ROLE. See Cycle 19 / Task 5b
   *  for the strict AG-v36 semantics. */
  private computeRowChecked(entry: CColumnState): boolean {
    if (this.deps.api.isPivotMode?.() === true) return this.hasPivotRole(entry.colId);
    return entry.hide !== true;
  }

  private hasPivotRole(colId: string): boolean {
    const groups = this.deps.api.getRowGroupColumns?.() ?? [];
    if (groups.includes(colId)) return true;
    const values = this.deps.api.getValueColumns?.() ?? [];
    if (values.some((v) => v.colId === colId)) return true;
    const pivots = this.deps.api.getPivotColumns?.() ?? [];
    return pivots.includes(colId);
  }

  /** Checkbox click router — Cycle 19 / Task 5b AG-v36 strict
   *  semantics. Under pivot mode the checkbox represents ROLE
   *  membership; out of pivot mode it toggles visibility. */
  private handleRowCheckboxClick(colId: string, checkbox: HTMLInputElement): void {
    const checked = checkbox.checked;
    if (this.deps.api.isPivotMode?.() === true) {
      const groups = this.deps.api.getRowGroupColumns?.() ?? [];
      const values = this.deps.api.getValueColumns?.() ?? [];
      const pivots = this.deps.api.getPivotColumns?.() ?? [];
      const isGrouped = groups.includes(colId);
      const isValued = values.some((v) => v.colId === colId);
      const isPivoted = pivots.includes(colId);
      if (!checked) {
        if (isGrouped) this.deps.api.removeRowGroupColumn?.(colId);
        else if (isValued) this.deps.api.removeValueColumn?.(colId);
        else if (isPivoted) this.deps.api.removePivotColumn?.(colId);
      } else {
        if (this.deps.isColumnRowGroupable(colId)) {
          this.deps.api.addRowGroupColumn?.(colId);
        } else if (this.deps.isColumnValueable(colId)) {
          this.deps.api.addValueColumn?.(colId, resolveDefaultAggFunc(this.deps.api, colId));
        }
      }
      return;
    }
    this.deps.api.setColumnsVisible([colId], checked);
  }

  /** Reflect the current grouping / value state in EVERY row's
   *  checkbox — leaves via `computeRowChecked`, groups via their
   *  descendants' tri-state. Called when pivotMode flips or any role
   *  assignment changes. */
  private refreshRowChecks(): void {
    const state = this.deps.api.getColumnState();
    const byId = new Map(state.map((s) => [s.colId, s]));
    for (const row of this.rows.values()) {
      if (row.kind === 'leaf') {
        const entry = byId.get(row.colId);
        if (!entry) continue;
        const next = this.computeRowChecked(entry);
        if (row.checkbox.checked !== next) row.checkbox.checked = next;
      } else {
        this.applyGroupTriState(row, byId);
      }
    }
    this.syncSelectAll();
  }

  /** Sync existing rows against a fresh `getColumnState()` snapshot.
   *
   *  Flat trees (no groups) keep the EXACT pre-hierarchy behaviour: add
   *  rows for newly-seen colIds, drop rows for vanished ones, and
   *  reorder the DOM to match `state`'s order — this is what
   *  `columnsToolPanel.test.ts`'s "refresh() ... row order update"
   *  case exercises.
   *
   *  Hierarchical trees (≥1 group) only refresh existing LEAF rows'
   *  checked/label state in place. `columnVisible`/`columnMoved` never
   *  add, remove, or re-parent a column — those are `columnDefsChanged`
   *  events routed to `rebuildRows()` — so there is nothing to add/
   *  remove/reorder here, and reordering by flat `state` order would
   *  scatter leaves out of their group's contiguous DOM block. */
  private syncRows(state: CColumnState[]): void {
    const hasGroups = Array.from(this.rows.values()).some((r) => r.kind === 'group');
    if (hasGroups) {
      const byId = new Map(state.map((s) => [s.colId, s]));
      for (const row of this.rows.values()) {
        if (row.kind !== 'leaf') continue;
        const entry = byId.get(row.colId);
        if (!entry) continue;
        row.checkbox.checked = this.computeRowChecked(entry);
        const next = this.deps.resolveLabel(row.colId);
        if (row.label.textContent !== next) row.label.textContent = next;
      }
      return;
    }

    const seen = new Set<string>();
    for (const entry of state) {
      seen.add(entry.colId);
      let row = this.rows.get(entry.colId);
      if (!row) {
        row = this.buildRow(entry, 0);
        this.rows.set(entry.colId, row);
        this.ancestorGroupIds.set(entry.colId, []);
      } else {
        row.checkbox.checked = this.computeRowChecked(entry);
        const next = this.deps.resolveLabel(entry.colId);
        if (row.label.textContent !== next) row.label.textContent = next;
      }
    }
    for (const [colId, row] of this.rows) {
      if (!seen.has(colId)) {
        row.el.remove();
        this.rows.delete(colId);
        this.ancestorGroupIds.delete(colId);
      }
    }
    // Reorder: appendChild moves existing nodes without destroying them,
    // so listeners + checkbox state survive.
    for (const entry of state) {
      const row = this.rows.get(entry.colId);
      if (row) this.listEl.appendChild(row.el);
    }
  }

  // ── Row visibility: search filter ∪ panel-local collapse state ─────

  /** Recompute every row's `display` from whichever visibility mode is
   *  live right now: a non-empty search term force-expands (matches
   *  show regardless of collapse); an empty term falls back to the
   *  collapse-based display. Called after every collapse toggle AND
   *  every `refresh()`/rebuild so the two visibility sources never
   *  fight each other. */
  private applyVisibility(): void {
    this.applySearchFilter(this.searchInput?.value ?? '');
  }

  /** Show every row whose ancestor chain (`this.ancestorGroupIds`) has
   *  no collapsed group; hide the rest. A pure "recompute from current
   *  state" pass — safe to call after any collapse toggle without a DOM
   *  rebuild, since row identities + the ancestor map are untouched. */
  private applyCollapseVisibility(): void {
    for (const [key, row] of this.rows) {
      const ancestors = this.ancestorGroupIds.get(key) ?? [];
      const hidden = ancestors.some((id) => this.collapsed.has(id));
      row.el.style.display = hidden ? 'none' : '';
    }
  }

  private applySearchFilter(raw: string): void {
    const term = raw.trim().toLowerCase();
    if (term.length === 0) {
      this.applyCollapseVisibility();
      return;
    }
    // Force-expand while searching: `this.collapsed` itself is left
    // untouched (clearing the search restores the prior expand state) —
    // only the DISPLAY ignores it for the duration of the search.
    const matchedLeafIds = new Set<string>();
    for (const row of this.rows.values()) {
      if (row.kind !== 'leaf') continue;
      const label = (row.label.textContent ?? '').toLowerCase();
      if (label.includes(term) || row.colId.toLowerCase().includes(term)) matchedLeafIds.add(row.colId);
    }
    for (const row of this.rows.values()) {
      if (row.kind === 'leaf') {
        row.el.style.display = matchedLeafIds.has(row.colId) ? '' : 'none';
      } else {
        const selfMatch = (row.label.textContent ?? '').toLowerCase().includes(term);
        const descendantMatch = row.descendantLeafIds.some((id) => matchedLeafIds.has(id));
        row.el.style.display = (selfMatch || descendantMatch) ? '' : 'none';
      }
    }
  }

  // ── Row drag orchestrator ──────────────────────────────────────────

  /** Drag-within-the-panel reorder/re-parent with ag-grid–style drag UX,
   *  AND drag-INTO any of the three drop zones (Column Labels / Values /
   *  Row Groups) OR the external header strips/band — LEAF drags only
   *  (`kind === 'col'`). A GROUP drag (`kind === 'group'`) never routes
   *  to those role-based surfaces (a group id can't be a pivot/row-group/
   *  value role member); it only ever reorders/re-parents within the
   *  panel via `resolveDrop` + `commitDrop` (T3). */
  private beginRowDrag(e: MouseEvent, id: string, kind: 'col' | 'group'): void {
    e.preventDefault();
    const key = kind === 'group' ? `grp:${id}` : id;
    const row = this.rows.get(key);
    if (!row) return;

    const label = kind === 'group' && row.kind === 'group'
      ? `${row.label.textContent ?? id} (${row.descendantLeafIds.length})`
      : this.deps.resolveLabel(id);
    const startX = e.clientX;
    const startY = e.clientY;
    const api = this.deps.api;
    const listEl = this.listEl;

    const allowDragOut = api.getGridOption?.('allowDragFromColumnsToolPanel') !== false;
    // Header-strip / band / zone routing only makes sense for a single
    // LEAF column drag — never a whole group.
    const isGroupable = kind === 'col' && (api.isColumnRowGroupEnabled?.(id) ?? false);
    const alreadyGrouped = kind === 'col' && (api.getRowGroupColumns?.() ?? []).includes(id);
    const isPivotable = kind === 'col' && (api.isColumnPivotEnabled?.(id) ?? false);
    const alreadyPivoted = kind === 'col' && (api.getPivotColumns?.() ?? []).includes(id);

    const zoneSpecs = (kind === 'col' && allowDragOut) ? this.deps.getDropZoneSpecs() : [];

    let dragStarted = false;
    let overZoneIdx = -1;
    let overHeaderStrip = false;
    let overPivotStrip = false;
    // FIX 2 (review) — `isRejectedDrop` re-clones + re-resolves the whole
    // tree (`cloneDefsTree` + `resolveColumnTree`); `renderDropIndicators`
    // called it on every branch-4 `onMove` even when the resolved drop
    // hadn't changed since the last mousemove. Memoize on a cheap string
    // key of the resolved drop and skip the re-run + re-render when it's
    // unchanged. Reset to `null` at every OTHER indicator-clearing site so
    // a later return to the same key still re-renders (the DOM indicator
    // was actually removed in between).
    let lastDropKey: string | null = null;
    let overColumnHeaderBand = false;
    let lastResolved: ColumnsPanelResolvedDrop | null = null;

    // Column-header drop router — parallel to the row-group-panel router.
    const hasColHeaderDropRouter = kind === 'col'
      && typeof (api as any).isPointInColumnHeaderBand === 'function'
      && typeof (api as any).setColumnHeaderDragHover === 'function'
      && typeof (api as any).commitColumnHeaderDrop === 'function';

    const ghost = makeDragGhost(this.deps.rootHost, label);

    // ---- Shared row-group-panel router ----
    const router = api as unknown as import('../../features/columnDrag').RowGroupPanelDragRouter;
    const hasRouter = kind === 'col'
      && typeof (api as any).isPointInRowGroupPanel === 'function'
      && typeof (api as any).setRowGroupPanelDragHover === 'function'
      && typeof (api as any).commitRowGroupPanelDrop === 'function';

    // ---- Shared pivot-panel router (Column Labels top strip) ----
    const pivotRouter = api as unknown as import('../../features/columnDrag').PivotPanelDragRouter;
    const hasPivotRouter = kind === 'col'
      && typeof (api as any).isPointInPivotPanel === 'function'
      && typeof (api as any).setPivotPanelDragHover === 'function'
      && typeof (api as any).commitPivotPanelDrop === 'function';

    const clearAllZoneOutlines = (): void => {
      for (let i = 0; i < zoneSpecs.length; i++) {
        setZoneDropState(zoneSpecs[i]!.dropZone, null);
      }
    };

    // T3 — in-panel drop indicators: an insertion line + a highlight on
    // the target group row (reject-tinted when the dry-run predicts the
    // move will be rejected, e.g. a `marryChildren` guard).
    let dropLine: HTMLDivElement | null = null;
    let dropTargetEl: HTMLElement | null = null;
    const clearDropIndicators = (): void => {
      dropLine?.remove();
      dropLine = null;
      if (dropTargetEl) {
        dropTargetEl.classList.remove(
          'vg-columns-panel-row--drop-target',
          'vg-columns-panel-row--drop-reject',
        );
        dropTargetEl = null;
      }
    };
    const renderDropIndicators = (resolved: ColumnsPanelResolvedDrop): void => {
      clearDropIndicators();
      const listRect = listEl.getBoundingClientRect();
      const beforeRow = resolved.beforeId !== undefined
        ? (this.rows.get(resolved.beforeId) ?? this.rows.get(`grp:${resolved.beforeId}`))
        : undefined;
      let lineTop: number;
      if (beforeRow) {
        lineTop = beforeRow.el.getBoundingClientRect().top;
      } else if (resolved.targetGroupId !== null) {
        const groupRow = this.rows.get(`grp:${resolved.targetGroupId}`);
        lineTop = groupRow ? groupRow.el.getBoundingClientRect().bottom : listRect.bottom;
      } else {
        const visible = Array.from(listEl.children)
          .filter((c) => (c as HTMLElement).style.display !== 'none') as HTMLElement[];
        const last = visible[visible.length - 1];
        lineTop = last ? last.getBoundingClientRect().bottom : listRect.top;
      }
      const line = document.createElement('div');
      line.className = 'vg-columns-panel-drop-line';
      line.style.left = `${listRect.left}px`;
      line.style.width = `${listRect.width}px`;
      line.style.top = `${Math.round(lineTop)}px`;
      const themeHost = this.deps.rootHost.closest<HTMLElement>('[class*="vg-theme"]') ?? document.body;
      themeHost.appendChild(line);
      dropLine = line;

      if (resolved.targetGroupId !== null) {
        const groupRow = this.rows.get(`grp:${resolved.targetGroupId}`);
        if (groupRow) {
          const rejected = this.isRejectedDrop(resolved);
          groupRow.el.classList.add(
            rejected ? 'vg-columns-panel-row--drop-reject' : 'vg-columns-panel-row--drop-target',
          );
          dropTargetEl = groupRow.el;
        }
      }
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragStarted) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragStarted = true;
        row.el.classList.add('vg-columns-panel-row--lifted');
        ghost.mount(ev.clientX, ev.clientY);
      }

      ghost.position(ev.clientX, ev.clientY);

      // 1. Row group HEADER STRIP — outside the sidebar.
      if (hasRouter && allowDragOut && isGroupable && !alreadyGrouped) {
        const inStrip = routeExternalDragHover(router, id, ev.clientX, ev.clientY);
        if (inStrip !== overHeaderStrip) {
          overHeaderStrip = inStrip;
          if (inStrip) {
            clearAllZoneOutlines();
            overZoneIdx = -1;
            clearDropIndicators();
            lastDropKey = null;
            if (overColumnHeaderBand) {
              (api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
              overColumnHeaderBand = false;
            }
            if (overPivotStrip && hasPivotRouter) {
              clearPivotPanelDragHover(pivotRouter);
              overPivotStrip = false;
            }
          }
        }
        if (overHeaderStrip) return;
      }

      // 1b. Pivot HEADER STRIP (Column Labels) — outside the sidebar.
      if (hasPivotRouter && allowDragOut && isPivotable && !alreadyPivoted) {
        const inStrip = routePivotPanelDragHover(pivotRouter, id, ev.clientX, ev.clientY);
        if (inStrip !== overPivotStrip) {
          overPivotStrip = inStrip;
          if (inStrip) {
            clearAllZoneOutlines();
            overZoneIdx = -1;
            clearDropIndicators();
            lastDropKey = null;
            if (overColumnHeaderBand) {
              (api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
              overColumnHeaderBand = false;
            }
          }
        }
        if (overPivotStrip) return;
      }

      // 2. Column header band.
      if (hasColHeaderDropRouter && allowDragOut && !overHeaderStrip) {
        const inHeaderBand = (api as any).isPointInColumnHeaderBand(ev.clientX, ev.clientY) as boolean;
        if (inHeaderBand !== overColumnHeaderBand) {
          overColumnHeaderBand = inHeaderBand;
          if (!inHeaderBand) {
            (api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
          } else {
            clearAllZoneOutlines();
            overZoneIdx = -1;
            clearDropIndicators();
            lastDropKey = null;
          }
        }
        if (inHeaderBand) {
          (api as any).setColumnHeaderDragHover(id, ev.clientX, ev.clientY);
          return;
        }
      }

      // 3. In-panel drop zones (pivot, values, row groups in that order).
      if (allowDragOut && zoneSpecs.length > 0) {
        let nextZoneIdx = -1;
        for (let i = 0; i < zoneSpecs.length; i++) {
          const spec = zoneSpecs[i]!;
          if (isPointInRect(getZoneRect(spec.dropZone), ev.clientX, ev.clientY)) {
            nextZoneIdx = i;
            break;
          }
        }
        if (nextZoneIdx !== overZoneIdx) {
          if (overZoneIdx >= 0) {
            setZoneDropState(zoneSpecs[overZoneIdx]!.dropZone, null);
          }
          overZoneIdx = nextZoneIdx;
          if (overZoneIdx >= 0) {
            const spec = zoneSpecs[overZoneIdx]!;
            setZoneDropState(spec.dropZone, spec.accepts(id) ? 'accept' : 'reject');
            clearDropIndicators();
            lastDropKey = null;
          }
        }
      }

      if (overZoneIdx >= 0) return;

      // 4. Otherwise — group-aware reorder/re-parent (T3): resolve the
      // pointer to a target group + insertion point and render the
      // insertion-line/highlight indicators. The actual mutation only
      // happens on mouseup (`commitDrop`) — this panel never splices
      // DOM rows live during the drag; the T2 `columnDefsChanged`
      // subscription rebuilds the whole list after a successful commit.
      const resolved = this.resolveDrop(ev.clientY, id, kind);
      lastResolved = resolved;
      // Memoize on the resolved drop's identity — skip the dry-run
      // (`isRejectedDrop`, inside `renderDropIndicators`) and the DOM
      // re-render entirely when the pointer moved but resolved to the
      // SAME target/position as last frame (the common case while
      // hovering steadily over one row).
      const dropKey = `${resolved.kind}:${resolved.movingId}->${resolved.targetGroupId}:${resolved.beforeId}`;
      if (dropKey !== lastDropKey) {
        lastDropKey = dropKey;
        renderDropIndicators(resolved);
      }
    };

    const onUp = (ev: MouseEvent) => {
      row.el.classList.remove('vg-columns-panel-row--lifted');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      ghost.remove();
      clearDropIndicators();
      if (hasRouter) clearExternalDragHover(router);
      if (hasPivotRouter) clearPivotPanelDragHover(pivotRouter);
      if (hasColHeaderDropRouter) {
        (api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
      }
      if (!dragStarted) return;

      if (overHeaderStrip) {
        (api as any).commitRowGroupPanelDrop?.(id);
        clearAllZoneOutlines();
        return;
      }
      if (overPivotStrip) {
        (api as any).commitPivotPanelDrop?.(id);
        clearAllZoneOutlines();
        return;
      }
      if (overColumnHeaderBand) {
        (api as any).commitColumnHeaderDrop(id, ev.clientX);
        clearAllZoneOutlines();
        return;
      }

      // In-panel zone release.
      clearAllZoneOutlines();
      if (allowDragOut && zoneSpecs.length > 0) {
        for (const spec of zoneSpecs) {
          if (isPointInRect(getZoneRect(spec.dropZone), ev.clientX, ev.clientY)) {
            if (spec.accepts(id)) spec.commit(id);
            return;
          }
        }
      }

      // Otherwise — group-aware reorder/re-parent.
      const resolved = lastResolved ?? this.resolveDrop(ev.clientY, id, kind);
      try {
        this.commitDrop(resolved);
      } catch (err) {
        console.error('[vg-columns-panel] group-aware drop commit failed', err);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** T3 — hit-test `clientY` against the rendered row list to resolve a
   *  target group + insertion point for the item currently being
   *  dragged (`movingId`/`kind`, closed over by `beginRowDrag`).
   *
   *  Every row (leaf + group) is a flat sibling in `listEl` (T2), so
   *  "insert before row X" always resolves cleanly to X's own immediate
   *  parent (from `ancestorGroupIds`) — nesting falls out of the walk
   *  order, no recursive tree-splicing needed:
   *   - hovering a GROUP row UPPER third → insert BEFORE that group as a
   *     sibling (under the group's parent / top level).
   *   - hovering a GROUP row MIDDLE third → drop INTO that group (before
   *     its first immediate child, or append if empty).
   *   - hovering a GROUP row LOWER third → insert AFTER that group as a
   *     sibling (skips the group's descendants in the flat list).
   *   - hovering a LEAF row's upper half → insert before it, within its
   *     current parent (or top level).
   *   - hovering a LEAF row's lower half, or past every row → insert
   *     after it (before its next same-parent sibling, or append when
   *     it's the last one / nothing is hovered at all). */
  private resolveDrop(clientY: number, movingId: string, kind: 'col' | 'group'): ColumnsPanelResolvedDrop {
    const movingKey = kind === 'group' ? `grp:${movingId}` : movingId;
    const isExcluded = (key: string): boolean => {
      if (key === movingKey) return true;
      // A group drag also excludes every descendant row — you can't
      // drop a group into (or before/after a member of) its own subtree.
      if (kind !== 'group') return false;
      return (this.ancestorGroupIds.get(key) ?? []).includes(movingId);
    };

    const candidates: Array<{ key: string; row: PanelRow }> = [];
    for (const [key, row] of this.rows) {
      if (isExcluded(key)) continue;
      if (row.el.style.display === 'none') continue;
      candidates.push({ key, row });
    }
    if (candidates.length === 0) {
      return { kind, movingId, targetGroupId: null, beforeId: undefined };
    }

    let hoveredIdx = -1;
    for (let i = 0; i < candidates.length; i++) {
      const rect = candidates[i]!.row.el.getBoundingClientRect();
      if (clientY < rect.bottom) { hoveredIdx = i; break; }
    }
    if (hoveredIdx === -1) {
      // Below every row — top-level append (the "gap at the bottom").
      return { kind, movingId, targetGroupId: null, beforeId: undefined };
    }

    const idOf = (row: PanelRow): string => (row.kind === 'leaf' ? row.colId : row.groupId);
    const parentOf = (key: string): string | null => {
      const ancestors = this.ancestorGroupIds.get(key) ?? [];
      return ancestors.length > 0 ? ancestors[ancestors.length - 1]! : null;
    };
    const findNextWithParent = (fromIdx: number, parentId: string | null): string | undefined => {
      for (let i = fromIdx; i < candidates.length; i++) {
        const cand = candidates[i]!;
        if (parentOf(cand.key) === parentId) return idOf(cand.row);
      }
      return undefined;
    };

    const hovered = candidates[hoveredIdx]!;
    if (hovered.row.kind === 'group') {
      const groupId = hovered.row.groupId;
      const groupParent = parentOf(hovered.key);
      const rect = hovered.row.el.getBoundingClientRect();
      const y = clientY - rect.top;
      const third = rect.height / 3;
      if (y < third) {
        // Sibling before this group (ungroup / reorder out of a nest).
        return { kind, movingId, targetGroupId: groupParent, beforeId: groupId };
      }
      if (y > rect.height - third) {
        // Sibling after this group — skip descendants via parent match.
        const beforeId = findNextWithParent(hoveredIdx + 1, groupParent);
        return { kind, movingId, targetGroupId: groupParent, beforeId };
      }
      // Middle — nest into this group.
      const beforeId = findNextWithParent(hoveredIdx + 1, groupId);
      return { kind, movingId, targetGroupId: groupId, beforeId };
    }

    // Leaf row hovered — reorder within (or re-parent into) ITS parent.
    const targetGroupId = parentOf(hovered.key);
    const rect = hovered.row.el.getBoundingClientRect();
    const upperHalf = clientY < rect.top + rect.height / 2;
    if (upperHalf) {
      return { kind, movingId, targetGroupId, beforeId: hovered.row.colId };
    }
    const beforeId = findNextWithParent(hoveredIdx + 1, targetGroupId);
    return { kind, movingId, targetGroupId, beforeId };
  }

  /** T3 — dry-run `resolved` through the SAME pure mutation core the
   *  commit uses (never mutates anything) to predict whether the move
   *  will be rejected (unknown ids, a `marryChildren` guard, or a
   *  would-be no-op). Drives the reject-tinted drop-target highlight. */
  private isRejectedDrop(resolved: ColumnsPanelResolvedDrop): boolean {
    const defs = this.deps.api.getColumnGroupDefs();
    const result = resolved.kind === 'group'
      ? moveColumnGroupPure(defs, resolved.movingId, resolved.targetGroupId, resolved.beforeId)
      : moveColumnToGroupPure(defs, resolved.movingId, resolved.targetGroupId, resolved.beforeId);
    return result === null;
  }

  /** T3 — commit a resolved drop via the T1 group-membership mutation
   *  API. Public (not just test-only) so `beginRowDrag`'s `onUp` and
   *  direct callers (tests) share one commit path. A no-op resolution
   *  (unknown ids / `marryChildren` guard / already-there) is silently
   *  absorbed by the underlying API (see `VelocityGridApi.moveColumnToGroup` /
   *  `moveColumnGroup`) — nothing to catch here. */
  commitDrop(resolved: ColumnsPanelResolvedDrop): void {
    if (resolved.kind === 'group') {
      this.deps.api.moveColumnGroup(resolved.movingId, resolved.targetGroupId, resolved.beforeId);
    } else {
      this.deps.api.moveColumnToGroup(resolved.movingId, resolved.targetGroupId, resolved.beforeId);
    }
  }

  /** Test-only escape hatch (T3) — exposes the drag-internal geometry
   *  resolver so `columnsPanelDrag.integration.test.ts` can exercise
   *  `resolveDrop` directly against real DOM geometry (via stubbed
   *  `getBoundingClientRect`) without simulating a full mouse gesture.
   *  Never called by production code. */
  __forTests(): { resolveDrop: (clientY: number, movingId: string, kind: 'col' | 'group') => ColumnsPanelResolvedDrop } {
    return { resolveDrop: (clientY, movingId, kind) => this.resolveDrop(clientY, movingId, kind) };
  }
}
