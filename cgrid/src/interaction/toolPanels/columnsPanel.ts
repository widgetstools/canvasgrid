/**
 * Cycle 11 / Task 3 + Cycle 15.5 / Task 2 + Cycle 18 / Task 5 — ColumnsToolPanel
 * (built-in `agColumnsToolPanel`).
 *
 * Mounted by the SideBarHost (Cycle 11 / Task 2). Reads from
 * `api.getColumnState()` and writes via `api.setColumnsVisible` /
 * `api.moveColumns` so visibility + reorder changes round-trip through
 * the existing column-state surface (Cycle 6). Header names resolve
 * through `api.getColumnHeaderName(colId)` since the public
 * `CColumnState` shape only carries colIds + width / hide / pinned /
 * sort flags.
 *
 * Cycle 15.5 / Task 2 upgraded the Row Groups SECTION from an inert
 * stub to a LIVE drop zone — the third view over the same
 * `rowGroupColumns` list (along with the row group panel from Cycle
 * 15 / Task 6 + Cycle 15.5 / Task 1 + the header context menu items
 * from Cycle 15.5 / Task 2).
 *
 * Cycle 18 / Task 5 closes out the pivot wiring:
 *
 *   1. Pivot Mode toggle now drives `api.setPivotMode` and subscribes to
 *      `pivotStateChanged` so external setPivotMode calls (the imperative
 *      API or — later — the context menu) keep the toggle in sync.
 *      Initial aria-pressed reads `api.isPivotMode()`.
 *   2. NEW Column Labels drop zone (`.cg-columns-panel-plz`) — the third
 *      view over PivotState's ordered `pivotColumns` list (the future
 *      pivot panel + header context menu items will be views 1 + 2).
 *      Same pill chrome + drop-state outline as the Row Groups zone
 *      (Cycle 15.5 vocabulary — ONE drop-zone idiom across all three).
 *      Drag from columns list → `addPivotColumn` (gated by `enablePivot`);
 *      pill drag-out → `removePivotColumn`. Section gated by
 *      `suppressPivots`.
 *   3. Values drop zone was a stub in Cycle 15.5; this task activates the
 *      drag/drop — drag from columns list → `addValueColumn(colId,
 *      defaultAggFunc)`. Default agg is the column's declared `aggFunc`
 *      when present, else `'sum'`. Pill chrome shows `aggFunc(headerName)`
 *      (e.g. `sum(Gold)`) — same label convention the agg-decorated
 *      column header uses elsewhere.
 *   4. **pivotMode-dependent checkbox semantics** (THE AG-parity bug —
 *      Prompt 9 item 4 in `pivot-behaviors-prompts.md`). When pivotMode
 *      is OFF the checkbox toggles VISIBILITY (existing Cycle 11 behavior
 *      preserved). When pivotMode is ON the checkbox toggles ROLE
 *      MEMBERSHIP — checking adds the column as a row-group OR value
 *      (whichever it's eligible for; `enableRowGroup` wins over
 *      `enableValue` per AG parity), unchecking removes the role.
 *      Setting visibility has no effect in pivot mode. A column with
 *      neither `enableRowGroup` nor `enableValue` is a no-op (a true
 *      AG-parity sidebar would render it disabled; the checkbox stays
 *      live but does nothing — the columns list still doubles as a
 *      column-reorder drag source). To add a column SPECIFICALLY as a
 *      pivot (Column Label) the user must DRAG to the Column Labels
 *      zone — checking does not assign the pivot role.
 *
 * Section layout (top → bottom, after Cycle 18 / Task 5 reordering):
 *
 *   ┌──────────────────────────────────────┐
 *   │ ⬤━━━━  Pivot Mode                     │  ← suppressPivotMode
 *   ├──────────────────────────────────────┤
 *   │ 🔍  Search...                         │  ← suppressColumnFilter
 *   ├──────────────────────────────────────┤
 *   │ ☑  ⋮⋮⋮  Athlete                       │
 *   │ ☑  ⋮⋮⋮  Age                           │  drag handles hidden when
 *   │ …                                     │  suppressColumnMove
 *   ├──────────────────────────────────────┤
 *   │ ▥  Column Labels                      │  ← suppressPivots  (NEW)
 *   │ ┌─ Sport   ✕ ──────────────────────┐  │
 *   │ └─ Drag here to set column labels ─┘  │
 *   ├──────────────────────────────────────┤
 *   │ Σ  Values                             │  ← suppressValues
 *   │ ┌─ sum(Gold) ✕ ────────────────────┐  │
 *   │ └─ Drag here to aggregate ────────┘  │
 *   ├──────────────────────────────────────┤
 *   │ ☰  Row Groups                         │  ← suppressRowGroups
 *   │ ┌─ Country ✕ ─────────────────────┐  │
 *   │ └─ Drag here to set row groups ───┘  │
 *   └──────────────────────────────────────┘
 *
 * Subscribes to `columnVisible` + `columnMoved` events so external
 * state mutations (e.g. an app calling `applyColumnState`) keep the
 * panel in sync. `suppressSyncLayoutWithGrid: true` opts out of this
 * subscription for apps that drive the panel imperatively via
 * `refreshToolPanel`. The Row Groups + Column Labels + Values zones
 * separately subscribe to `columnRowGroupChanged` / `pivotStateChanged`
 * (always on — the zones ARE mirrors by design; suppressing the sync
 * would defeat the purpose).
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-18-pivoting-design.md
 *   § Task 7 — Pivot panel in side bar (Cycle 11 tool panel extension).
 */
import type { CGridApi, CColumnState } from '../../types';
import { iconSvg } from '../../renderer/icons';
import {
  routeExternalDragHover,
  clearExternalDragHover,
  routePivotPanelDragHover,
  clearPivotPanelDragHover,
} from '../features/columnDrag';
import type {
  IToolPanelColumnCompParams,
  ToolPanel,
  ToolPanelParams,
} from './types';

/** Per-row DOM handles cached for in-place refresh. */
interface PanelRow {
  el: HTMLElement;
  checkbox: HTMLInputElement;
  label: HTMLElement;
}

/** Per-pill DOM handles for the Row Groups drop zone. The pill list is
 *  rebuilt wholesale on every `columnRowGroupChanged` (the list is
 *  small — typically ≤ 5 entries — and a wholesale rebuild dodges any
 *  in-place reorder bookkeeping). */
interface RowGroupPill {
  el: HTMLElement;
  colId: string;
}

/** Per-pill DOM handles for the Column Labels drop zone (Cycle 18 / Task 5).
 *  Same wholesale-rebuild contract as the Row Groups pills. */
interface PivotPill {
  el: HTMLElement;
  colId: string;
}

/** Per-pill DOM handles for the Values drop zone. Carries the bound
 *  `aggFunc` so the pill label can repaint without re-querying state. */
interface ValuePill {
  el: HTMLElement;
  colId: string;
  aggFunc: string;
}

/** Verbatim from the Cycle 15 / Task 6 row group panel. ONE drop-zone
 *  empty-state string across the grid. */
const ROW_GROUPS_PLACEHOLDER = 'Drag here to set row groups';
const VALUES_PLACEHOLDER = 'Drag here to aggregate';
const PIVOT_PLACEHOLDER = 'Drag here to set column labels';

/** Default aggregation when a column gets dropped on the Values zone
 *  and its colDef declares no `aggFunc`. Mirrors AG-Grid's default. */
const DEFAULT_VALUE_AGG_FUNC = 'sum';

/** Threshold (CSS px) the pointer must move from the down-event before
 *  a press is treated as a drag. Matches Cycle 6's column-drag
 *  threshold + Cycle 15.5 / Task 1's pill-reorder threshold; one drag
 *  budget across the grid. */
const DRAG_THRESHOLD_PX = 4;

/** A drop-zone hosts pills of one logical kind (row-group / pivot /
 *  value). The shared shape lets `beginRowDrag` route through ANY of
 *  the three with the same hit-test + accept/reject paint logic. */
interface DropZoneSpec {
  /** The dashed-outline container that doubles as the drop target. */
  dropZone: HTMLElement;
  /** True when `colId` is eligible to land in this zone (i.e. the
   *  column's resolved colDef carries the right `enableX` flag AND the
   *  column isn't already assigned to this zone). */
  accepts(colId: string): boolean;
  /** Commit the drop — add `colId` to this zone's underlying list. */
  commit(colId: string): void;
}

export class ColumnsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private api!: CGridApi;
  private params: IToolPanelColumnCompParams = {};

  /** Search input (null when suppressColumnFilter). */
  private searchInput: HTMLInputElement | null = null;
  /** "Select All / Deselect All" checkbox (null when suppressColumnFilter). */
  private selectAllCb: HTMLInputElement | null = null;
  /** Pivot mode toggle button (null when suppressPivotMode). */
  private pivotModeBtn: HTMLButtonElement | null = null;
  /** Container for the column rows. */
  private listEl!: HTMLElement;
  /** Per-colId row cache so refresh + reorder don't blow away DOM nodes. */
  private rows = new Map<string, PanelRow>();
  /** Unsubscribe functions returned by `api.addEventListener`. */
  private unsubs: Array<() => void> = [];

  /** Cycle 15.5 / Task 2 — DOM handles for the Row Groups zone. `null`
   *  when `suppressRowGroups` is set. */
  private rowGroupsSection: {
    section: HTMLElement;
    dropZone: HTMLElement;
    content: HTMLElement;
    pills: RowGroupPill[];
  } | null = null;

  /** Cycle 18 / Task 5 — DOM handles for the Column Labels zone. `null`
   *  when `suppressPivots` is set. */
  private pivotsSection: {
    section: HTMLElement;
    dropZone: HTMLElement;
    content: HTMLElement;
    pills: PivotPill[];
  } | null = null;

  /** Cycle 18 / Task 5 — DOM handles for the Values zone. `null` when
   *  `suppressValues` is set. */
  private valuesSection: {
    section: HTMLElement;
    dropZone: HTMLElement;
    content: HTMLElement;
    pills: ValuePill[];
  } | null = null;

  init(p: ToolPanelParams): void {
    this.api = p.api as CGridApi;
    this.params = (p.toolPanelParams as IToolPanelColumnCompParams | undefined) ?? {};

    this.root = document.createElement('div');
    this.root.className = 'cg-columns-panel';

    if (!this.params.suppressPivotMode) {
      this.root.appendChild(this.buildPivotModeRow());
    }
    if (!this.params.suppressColumnFilter) {
      this.root.appendChild(this.buildSearchRow());
    }

    this.listEl = document.createElement('div');
    this.listEl.className = 'cg-columns-panel-list';
    this.root.appendChild(this.listEl);
    this.buildRows();
    this.syncSelectAll();

    // Order (Cycle 18 / Task 9 follow-up — AG-Grid parity):
    //   Row Groups → Values → Column Labels
    // AG-Grid orders the drop zones so the row dimension is listed
    // first (matching how users read a pivot table: rows → values →
    // columns). Cycle 18 / Task 5 originally clustered the pivot-
    // related zones nearer the column list; AG parity overrides that
    // with the conventional row-first sequencing.
    if (!this.params.suppressRowGroups) {
      this.root.appendChild(this.buildRowGroupsSection());
      this.refreshRowGroupPills();
    }
    if (!this.params.suppressValues) {
      this.root.appendChild(this.buildValuesSection());
      this.refreshValuePills();
    }
    if (!this.params.suppressPivots) {
      this.root.appendChild(this.buildPivotsSection());
      this.refreshPivotPills();
      // Column Labels only makes sense in pivot mode — hide the entire
      // section when pivot mode is off so the tool panel doesn't show
      // an empty drop zone for a feature the user isn't using.
      this.syncPivotsSectionVisibility();
    }

    if (!this.params.suppressSyncLayoutWithGrid) {
      const offVisible = this.api.addEventListener('columnVisible', () => this.refresh());
      const offMoved = this.api.addEventListener('columnMoved', () => this.refresh());
      this.unsubs.push(offVisible, offMoved);
    }
    // The Row Groups zone ALWAYS subscribes (independent of
    // `suppressSyncLayoutWithGrid` — the zone IS a mirror by design).
    if (!this.params.suppressRowGroups) {
      const offGroup = this.api.addEventListener('columnRowGroupChanged', () => {
        this.refreshRowGroupPills();
        // pivotMode-OFF→ON checkbox semantics need the row-checks to
        // recompute when grouping changes (a column becoming grouped
        // flips its checkbox from "visible" → "checked because grouped").
        if (this.api.isPivotMode?.() === true) this.refreshRowChecks();
      });
      this.unsubs.push(offGroup);
    }

    // Pivot state subscription: keep the pivot mode toggle aria-pressed,
    // the Column Labels pills, the Values pills, and (when pivot mode is
    // on) the row checkboxes in sync with any external mutation.
    const subscribesPivot = !this.params.suppressPivotMode
      || !this.params.suppressPivots
      || !this.params.suppressValues;
    if (subscribesPivot) {
      const offPivot = this.api.addEventListener('pivotStateChanged', (e) => {
        if (this.pivotModeBtn) {
          this.pivotModeBtn.setAttribute('aria-pressed', String(e.pivotMode));
        }
        if (this.pivotsSection) this.refreshPivotPills();
        if (this.valuesSection) this.refreshValuePills();
        // Mode flip OR any role change while in pivot mode requires
        // re-syncing the row checkboxes (semantics depend on pivotMode +
        // role membership).
        this.refreshRowChecks();
        // Show/hide the Column Labels section to track pivot mode.
        this.syncPivotsSectionVisibility();
      });
      this.unsubs.push(offPivot);
    }
  }

  /** Hide the Column Labels section when pivot mode is OFF. The
   *  section exists in the DOM (so refs / refreshPivotPills stay
   *  valid) but its `display` is toggled. */
  private syncPivotsSectionVisibility(): void {
    if (!this.pivotsSection) return;
    const pivotOn = this.api.isPivotMode?.() === true;
    this.pivotsSection.section.style.display = pivotOn ? '' : 'none';
  }

  getGui(): HTMLElement {
    return this.root;
  }

  refresh(): void {
    const state = this.api.getColumnState();
    this.syncRows(state);
    this.applySearchFilter(this.searchInput?.value ?? '');
    this.syncSelectAll();
    this.refreshRowGroupPills();
    this.refreshPivotPills();
    this.refreshValuePills();
    this.refreshRowChecks();
  }

  destroy(): void {
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.rows.clear();
    this.rowGroupsSection = null;
    this.pivotsSection = null;
    this.valuesSection = null;
    this.pivotModeBtn = null;
    this.root.parentElement?.removeChild(this.root);
  }

  // ---- builders -----------------------------------------------------

  private buildPivotModeRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cg-columns-panel-pivot-mode';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cg-columns-panel-toggle';
    const initial = this.api.isPivotMode?.() === true;
    btn.setAttribute('aria-pressed', String(initial));
    btn.setAttribute('aria-label', 'Pivot Mode');
    const knob = document.createElement('span');
    knob.className = 'cg-columns-panel-toggle-knob';
    btn.appendChild(knob);
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      // Optimistic flip — the pivotStateChanged subscription confirms
      // the aria state on the next tick, which is a no-op when the
      // api accepted the mutation.
      btn.setAttribute('aria-pressed', String(next));
      this.api.setPivotMode?.(next);
    });
    this.pivotModeBtn = btn;

    const label = document.createElement('span');
    label.className = 'cg-columns-panel-pivot-mode-label';
    label.textContent = 'Pivot Mode';

    row.appendChild(btn);
    row.appendChild(label);
    return row;
  }

  private buildSearchRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cg-columns-panel-search';

    // "Select All / Deselect All" checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'cg-columns-panel-select-all';
    cb.setAttribute('aria-label', 'Select all columns');
    cb.addEventListener('change', () => {
      const makeVisible = cb.checked;
      const state = this.api.getColumnState();
      this.api.applyColumnState({
        state: state.map(s => ({ ...s, hide: !makeVisible })),
        applyOrder: false,
      });
      this.refresh();
    });
    this.selectAllCb = cb;
    row.appendChild(cb);

    // Wrapper so the magnifying glass icon lives inside the input visually
    const wrap = document.createElement('div');
    wrap.className = 'cg-columns-panel-search-wrap';

    const icon = document.createElement('span');
    icon.className = 'cg-columns-panel-search-icon';
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

  /** Update the "Select All" checkbox to reflect current column visibility.
   *  Reads directly from the row checkbox DOM so it's always consistent with
   *  what the list rows show (avoids a second getColumnState() call). */
  private syncSelectAll(): void {
    const cb = this.selectAllCb;
    if (!cb) return;
    const rows = Array.from(this.rows.values());
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

  /** Cycle 15.5 / Task 2 — Row Groups SECTION builder. */
  private buildRowGroupsSection(): HTMLElement {
    const { section, dropZone, content } = this.buildDropZoneSection({
      kind: 'groups',
      iconName: 'menu',
      headerText: 'Row Groups',
      ariaLabel: 'Row group columns',
      zoneClass: 'cg-columns-panel-rgz',
      contentClass: 'cg-columns-panel-rgz-content',
    });
    dropZone.setAttribute('data-cg-pill-role', 'rowGroup');
    this.rowGroupsSection = { section, dropZone, content, pills: [] };
    return section;
  }

  /** Cycle 18 / Task 5 — Column Labels SECTION builder. */
  private buildPivotsSection(): HTMLElement {
    const { section, dropZone, content } = this.buildDropZoneSection({
      kind: 'pivots',
      iconName: 'columns-3',
      headerText: 'Column Labels',
      ariaLabel: 'Pivot column labels',
      zoneClass: 'cg-columns-panel-plz',
      contentClass: 'cg-columns-panel-plz-content',
    });
    dropZone.setAttribute('data-cg-pill-role', 'pivot');
    this.pivotsSection = { section, dropZone, content, pills: [] };
    return section;
  }

  /** Cycle 18 / Task 5 — Values SECTION builder (was inert stub in
   *  Cycle 15.5 — pills + drag/drop are live in this task). */
  private buildValuesSection(): HTMLElement {
    const { section, dropZone, content } = this.buildDropZoneSection({
      kind: 'values',
      iconName: 'sigma',
      headerText: 'Values',
      ariaLabel: 'Aggregate value columns',
      zoneClass: 'cg-columns-panel-valz',
      contentClass: 'cg-columns-panel-valz-content',
    });
    dropZone.setAttribute('data-cg-pill-role', 'value');
    this.valuesSection = { section, dropZone, content, pills: [] };
    return section;
  }

  /** Shared drop-zone section scaffold — header (icon + label) + zone
   *  container + content. Returns the section element and the inner
   *  handles each section type caches. */
  private buildDropZoneSection(opts: {
    kind: 'groups' | 'pivots' | 'values';
    iconName: Parameters<typeof iconSvg>[0];
    headerText: string;
    ariaLabel: string;
    zoneClass: string;
    contentClass: string;
  }): { section: HTMLElement; dropZone: HTMLElement; content: HTMLElement } {
    const section = document.createElement('div');
    section.className = 'cg-columns-panel-section';
    section.dataset.kind = opts.kind;

    const header = document.createElement('div');
    header.className = `cg-columns-panel-section-header cg-columns-panel-section-header--${opts.kind}`;
    const iconWrap = document.createElement('span');
    iconWrap.className = 'cg-columns-panel-section-header-icon';
    iconWrap.appendChild(iconSvg(opts.iconName, 13));
    header.appendChild(iconWrap);
    header.appendChild(document.createTextNode(opts.headerText));

    const dropZone = document.createElement('div');
    dropZone.className = `cg-columns-panel-drop-zone ${opts.zoneClass}`;
    dropZone.setAttribute('role', 'list');
    dropZone.setAttribute('aria-label', opts.ariaLabel);

    const content = document.createElement('div');
    content.className = opts.contentClass;
    dropZone.appendChild(content);

    section.appendChild(header);
    section.appendChild(dropZone);
    return { section, dropZone, content };
  }

  /** Build every row once from `getColumnState()`. Called from `init`. */
  private buildRows(): void {
    const state = this.api.getColumnState();
    for (const entry of state) {
      const row = this.buildRow(entry);
      this.rows.set(entry.colId, row);
      this.listEl.appendChild(row.el);
    }
  }

  private buildRow(entry: CColumnState): PanelRow {
    const el = document.createElement('div');
    el.className = 'cg-columns-panel-row';
    el.dataset.colId = entry.colId;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cg-columns-panel-row-checkbox';
    checkbox.checked = this.computeRowChecked(entry);
    checkbox.setAttribute('aria-label', this.resolveLabel(entry.colId));
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleRowCheckboxClick(entry.colId, checkbox);
    });
    el.appendChild(checkbox);

    if (!this.params.suppressColumnMove) {
      const handle = document.createElement('span');
      handle.className = 'cg-columns-panel-row-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('mousedown', (e) => this.beginRowDrag(e, entry.colId));
      el.appendChild(handle);
    }

    const label = document.createElement('span');
    label.className = 'cg-columns-panel-row-label';
    label.textContent = this.resolveLabel(entry.colId);
    el.appendChild(label);

    return { el, checkbox, label };
  }

  /** Checked state: a row is checked when the column is VISIBLE
   *  OR (in pivot mode) participates in a pivot ROLE — even when
   *  the source column is hidden because the role auto-hid it.
   *  Two combined truths:
   *    • visibility — pivot OFF the panel is purely a visibility
   *      lens; pivot ON visible non-role columns still read as
   *      "checked" because they're on the grid.
   *    • role membership — under pivot, adding a column to Row
   *      Groups / Values / Column Labels makes it CHECKED in the
   *      list even when the source col auto-hides (rowGroup
   *      autoshow is the canonical example). That way the panel
   *      reflects "this column is in the pivot" rather than only
   *      "this column paints in the body". */
  private computeRowChecked(entry: CColumnState): boolean {
    if (entry.hide !== true) return true;
    if (this.api.isPivotMode?.() === true && this.hasPivotRole(entry.colId)) return true;
    return false;
  }

  /** True when the column is currently assigned ANY pivot-mode role
   *  (row-group, value, OR pivot/Column-Label). */
  private hasPivotRole(colId: string): boolean {
    const groups = this.api.getRowGroupColumns?.() ?? [];
    if (groups.includes(colId)) return true;
    const values = this.api.getValueColumns?.() ?? [];
    if (values.some((v) => v.colId === colId)) return true;
    const pivots = this.api.getPivotColumns?.() ?? [];
    return pivots.includes(colId);
  }

  /** Checkbox click router.
   *
   *  Cardinal principle: the columns side panel's checkbox is the
   *  single source of truth for whether a column paints. Unchecking
   *  ALWAYS hides the column in the grid; checking ALWAYS shows it.
   *  Visibility tracks the checkbox deterministically — no
   *  conditional bailouts that leave a column visible with an
   *  unchecked box (or vice versa).
   *
   *  Under pivot mode, role membership rides alongside visibility:
   *  unchecking a role-bearing column also removes the role;
   *  checking a role-eligible column also assigns it (rowGroup
   *  wins over value; pivot role is reserved for drag, per AG
   *  parity). The visibility toggle still fires unconditionally so
   *  the user's panel state and what's on screen always match. */
  private handleRowCheckboxClick(colId: string, checkbox: HTMLInputElement): void {
    const checked = checkbox.checked;

    if (this.api.isPivotMode?.() === true) {
      // Pivot mode: manage role assignment FIRST. Removing a
      // row-group role would otherwise auto-restore the column's
      // visibility (via `setGroupModel`'s show-removed-cols path)
      // and stomp the hide flag the click is about to set. We do
      // the role mutation first, then re-apply the user's
      // visibility intent.
      const groups = this.api.getRowGroupColumns?.() ?? [];
      const values = this.api.getValueColumns?.() ?? [];
      const pivots = this.api.getPivotColumns?.() ?? [];
      const isGrouped = groups.includes(colId);
      const isValued = values.some((v) => v.colId === colId);
      const isPivoted = pivots.includes(colId);

      if (!checked) {
        if (isGrouped) this.api.removeRowGroupColumn?.(colId);
        else if (isValued) this.api.removeValueColumn?.(colId);
        else if (isPivoted) this.api.removePivotColumn?.(colId);
      } else {
        if (this.isColumnRowGroupable(colId)) {
          this.api.addRowGroupColumn?.(colId);
        } else if (this.isColumnValueable(colId)) {
          const aggFunc = this.resolveDefaultAggFunc(colId);
          this.api.addValueColumn?.(colId, aggFunc);
        }
      }
    }

    // Visibility ALWAYS tracks the checkbox — pivot mode or not.
    // Called LAST so it wins over the role-driven auto-show/auto-hide
    // that `setGroupModel` runs as a side effect.
    this.api.setColumnsVisible([colId], checked);
  }

  /** Reflect the current grouping / value state in EVERY row's checkbox.
   *  Called when pivotMode flips or any role assignment changes — every
   *  row's checked state may change without the underlying column state
   *  visibility changing. */
  private refreshRowChecks(): void {
    const state = this.api.getColumnState();
    const byId = new Map(state.map((s) => [s.colId, s]));
    for (const [colId, row] of this.rows) {
      const entry = byId.get(colId);
      if (!entry) continue;
      const next = this.computeRowChecked(entry);
      if (row.checkbox.checked !== next) row.checkbox.checked = next;
    }
    this.syncSelectAll();
  }

  private resolveLabel(colId: string): string {
    const headerName = this.api.getColumnHeaderName?.(colId);
    return (headerName && headerName.length > 0) ? headerName : colId;
  }

  private isColumnRowGroupable(colId: string): boolean {
    return this.api.isColumnRowGroupEnabled?.(colId) === true;
  }

  private isColumnPivotable(colId: string): boolean {
    return this.api.isColumnPivotEnabled?.(colId) === true;
  }

  private isColumnValueable(colId: string): boolean {
    return this.api.isColumnValueEnabled?.(colId) === true;
  }

  /** Resolve the default aggregation func for a column when it's dropped
   *  on the Values zone. Prefers the colDef's declared `aggFunc`, falls
   *  back to `'sum'`. The api method is optional on the mock surface;
   *  tests stub it via `getColumnDefaultAggFunc`. */
  private resolveDefaultAggFunc(colId: string): string {
    const apiAny = this.api as unknown as { getColumnDefaultAggFunc?: (colId: string) => string | undefined };
    const declared = apiAny.getColumnDefaultAggFunc?.(colId);
    return (typeof declared === 'string' && declared.length > 0) ? declared : DEFAULT_VALUE_AGG_FUNC;
  }

  // ---- refresh ------------------------------------------------------

  /** Diff `state` against the current `rows` map: update existing rows in
   *  place, append new rows for unseen colIds, drop rows whose colId no
   *  longer appears, and reorder DOM children so they match `state` order. */
  private syncRows(state: CColumnState[]): void {
    const seen = new Set<string>();
    for (const entry of state) {
      seen.add(entry.colId);
      let row = this.rows.get(entry.colId);
      if (!row) {
        row = this.buildRow(entry);
        this.rows.set(entry.colId, row);
      } else {
        row.checkbox.checked = this.computeRowChecked(entry);
        const next = this.resolveLabel(entry.colId);
        if (row.label.textContent !== next) row.label.textContent = next;
      }
    }
    // Drop rows no longer in state.
    for (const [colId, row] of this.rows) {
      if (!seen.has(colId)) {
        row.el.remove();
        this.rows.delete(colId);
      }
    }
    // Reorder: appendChild moves existing nodes without destroying them, so
    // listeners + checkbox state survive. Scroll position is preserved.
    for (const entry of state) {
      const row = this.rows.get(entry.colId);
      if (row) this.listEl.appendChild(row.el);
    }
  }

  // ---- Row Groups drop zone -----------------------------------------

  private refreshRowGroupPills(): void {
    const section = this.rowGroupsSection;
    if (!section) return;
    const cols = this.api.getRowGroupColumns?.() ?? [];

    section.pills = [];
    section.content.replaceChildren();

    if (cols.length === 0) {
      section.content.appendChild(this.buildEmpty('rgz', ROW_GROUPS_PLACEHOLDER));
      return;
    }

    for (const colId of cols) {
      const pillEl = this.buildPill({
        zone: 'rgz',
        colId,
        label: this.resolveLabel(colId),
        removeAriaLabel: `Remove ${this.resolveLabel(colId)} from row groups`,
        onRemove: () => this.api.removeRowGroupColumn?.(colId),
        onDragOut: () => this.api.removeRowGroupColumn?.(colId),
        onReorder: (toIndex) => {
          const ordered = this.api.getRowGroupColumns?.() ?? [];
          const fromIndex = ordered.indexOf(colId);
          if (fromIndex < 0) return;
          this.api.moveRowGroupColumn?.(fromIndex, toIndex);
        },
        getZoneRect: () => this.getZoneRect(this.rowGroupsSection?.dropZone),
        getZoneContent: () => this.rowGroupsSection?.content ?? null,
      });
      section.content.appendChild(pillEl);
      section.pills.push({ el: pillEl, colId });
    }
  }

  // ---- Column Labels (pivot) drop zone -------------------------------

  private refreshPivotPills(): void {
    const section = this.pivotsSection;
    if (!section) return;
    const cols = this.api.getPivotColumns?.() ?? [];

    section.pills = [];
    section.content.replaceChildren();

    if (cols.length === 0) {
      section.content.appendChild(this.buildEmpty('plz', PIVOT_PLACEHOLDER));
      return;
    }

    for (const colId of cols) {
      const pillEl = this.buildPill({
        zone: 'plz',
        colId,
        label: this.resolveLabel(colId),
        removeAriaLabel: `Remove ${this.resolveLabel(colId)} from column labels`,
        onRemove: () => this.api.removePivotColumn?.(colId),
        onDragOut: () => this.api.removePivotColumn?.(colId),
        onReorder: (toIndex) => {
          const ordered = this.api.getPivotColumns?.() ?? [];
          const fromIndex = ordered.indexOf(colId);
          if (fromIndex < 0) return;
          this.api.movePivotColumn?.(fromIndex, toIndex);
        },
        getZoneRect: () => this.getZoneRect(this.pivotsSection?.dropZone),
        getZoneContent: () => this.pivotsSection?.content ?? null,
      });
      section.content.appendChild(pillEl);
      section.pills.push({ el: pillEl, colId });
    }
  }

  // ---- Values drop zone --------------------------------------------

  private refreshValuePills(): void {
    const section = this.valuesSection;
    if (!section) return;
    const valueCols = this.api.getValueColumns?.() ?? [];

    section.pills = [];
    section.content.replaceChildren();

    if (valueCols.length === 0) {
      section.content.appendChild(this.buildEmpty('valz', VALUES_PLACEHOLDER));
      return;
    }

    for (const v of valueCols) {
      const label = `${v.aggFunc}(${this.resolveLabel(v.colId)})`;
      const pillEl = this.buildPill({
        zone: 'valz',
        colId: v.colId,
        label,
        removeAriaLabel: `Remove ${label} from values`,
        onRemove: () => this.api.removeValueColumn?.(v.colId),
        onDragOut: () => this.api.removeValueColumn?.(v.colId),
        onReorder: (toIndex) => {
          const ordered = (this.api.getValueColumns?.() ?? []).map((vc) => vc.colId);
          const fromIndex = ordered.indexOf(v.colId);
          if (fromIndex < 0) return;
          this.api.moveValueColumn?.(fromIndex, toIndex);
        },
        getZoneRect: () => this.getZoneRect(this.valuesSection?.dropZone),
        getZoneContent: () => this.valuesSection?.content ?? null,
      });
      section.content.appendChild(pillEl);
      section.pills.push({ el: pillEl, colId: v.colId, aggFunc: v.aggFunc });
    }
  }

  // ---- shared pill / drop-zone helpers ------------------------------

  private buildEmpty(zone: 'rgz' | 'plz' | 'valz', placeholder: string): HTMLElement {
    const empty = document.createElement('div');
    empty.className = `cg-columns-panel-${zone}-empty`;
    empty.textContent = placeholder;
    return empty;
  }

  /** Build one pill: drag-handle + label + ✕ remove. `zone` is the
   *  CSS prefix that scopes the pill's classes so per-zone selectors
   *  in tests (e.g. `.cg-columns-panel-plz-pill`) still uniquely
   *  identify the right pill kind. */
  private buildPill(opts: {
    zone: 'rgz' | 'plz' | 'valz';
    colId: string;
    label: string;
    removeAriaLabel: string;
    onRemove: () => void;
    onDragOut: () => void;
    onReorder: (toIndex: number) => void;
    getZoneRect: () => DOMRect | null;
    getZoneContent: () => HTMLElement | null;
  }): HTMLElement {
    const pill = document.createElement('div');
    pill.className = `cg-columns-panel-${opts.zone}-pill cg-columns-panel-pill`;
    pill.setAttribute('role', 'listitem');
    pill.dataset.colId = opts.colId;

    const handle = document.createElement('span');
    handle.className = `cg-columns-panel-${opts.zone}-pill-handle cg-columns-panel-pill-handle`;
    handle.setAttribute('aria-hidden', 'true');
    pill.appendChild(handle);

    const label = document.createElement('span');
    label.className = `cg-columns-panel-${opts.zone}-pill-label cg-columns-panel-pill-label`;
    label.textContent = opts.label;
    pill.appendChild(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = `cg-columns-panel-${opts.zone}-pill-remove cg-columns-panel-pill-remove`;
    remove.setAttribute('aria-label', opts.removeAriaLabel);
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRemove();
    });
    pill.appendChild(remove);

    pill.addEventListener('mousedown', (e) => {
      if (e.target instanceof Element && e.target.closest(`.cg-columns-panel-${opts.zone}-pill-remove`)) {
        return;
      }
      this.beginPillDrag(e, {
        pillEl: pill,
        zone: opts.zone,
        colId: opts.colId,
        label: opts.label,
        onDragOut: opts.onDragOut,
        onReorder: opts.onReorder,
        getZoneRect: opts.getZoneRect,
        getZoneContent: opts.getZoneContent,
      });
    });

    return pill;
  }

  private getZoneRect(zone: HTMLElement | undefined): DOMRect | null {
    if (!zone) return null;
    const rect = zone.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  private isPointInRect(rect: DOMRect | null, clientX: number, clientY: number): boolean {
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.right
      && clientY >= rect.top  && clientY <= rect.bottom;
  }

  /** Paint / clear the drop-target outline on a zone. */
  private setZoneDropState(zone: HTMLElement | null, state: 'accept' | 'reject' | null): void {
    if (!zone) return;
    if (state === null) delete zone.dataset.drop;
    else zone.dataset.drop = state;
  }

  /** Resolve the three drop-zone specs in priority order — pivot first
   *  (top of the panel), then values, then row groups. Skips zones that
   *  are suppressed (their handle is `null`). */
  private dropZoneSpecs(colId: string): DropZoneSpec[] {
    const specs: DropZoneSpec[] = [];
    const pivot = this.pivotsSection;
    if (pivot) {
      specs.push({
        dropZone: pivot.dropZone,
        accepts: (id) => this.isColumnPivotable(id)
          && !(this.api.getPivotColumns?.() ?? []).includes(id),
        commit: (id) => this.api.addPivotColumn?.(id),
      });
    }
    const values = this.valuesSection;
    if (values) {
      specs.push({
        dropZone: values.dropZone,
        accepts: (id) => this.isColumnValueable(id)
          && !(this.api.getValueColumns?.() ?? []).some((v) => v.colId === id),
        commit: (id) => this.api.addValueColumn?.(id, this.resolveDefaultAggFunc(id)),
      });
    }
    const groups = this.rowGroupsSection;
    if (groups) {
      specs.push({
        dropZone: groups.dropZone,
        accepts: (id) => this.isColumnRowGroupable(id)
          && !(this.api.getRowGroupColumns?.() ?? []).includes(id),
        commit: (id) => this.api.addRowGroupColumn?.(id),
      });
    }
    // colId is unused at spec-build time but kept in the signature for
    // future per-column gating (e.g. lockPosition columns).
    void colId;
    return specs;
  }

  // ---- search -------------------------------------------------------

  private applySearchFilter(raw: string): void {
    const term = raw.trim().toLowerCase();
    for (const [colId, row] of this.rows) {
      if (term.length === 0) {
        row.el.style.display = '';
        continue;
      }
      const label = (row.label.textContent ?? '').toLowerCase();
      const match = label.includes(term) || colId.toLowerCase().includes(term);
      row.el.style.display = match ? '' : 'none';
    }
  }

  // ---- drag-within-list reorder + drag-into-{plz|valz|rgz} -----------

  /** Drag-within-the-panel reorder with ag-grid–style drag UX, AND
   *  drag-INTO any of the three drop zones (Column Labels / Values /
   *  Row Groups) — Cycle 18 / Task 5 generalises the routing across
   *  all three. */
  private beginRowDrag(e: MouseEvent, colId: string): void {
    e.preventDefault();
    const row = this.rows.get(colId);
    if (!row) return;

    const label = this.resolveLabel(colId);
    const startX = e.clientX;
    const startY = e.clientY;

    const allowDragOut = this.api.getGridOption?.('allowDragFromColumnsToolPanel') !== false;
    // Header-strip routing only makes sense for role-eligible columns
    // (the strips are role-axis surfaces).
    const isGroupable = this.api.isColumnRowGroupEnabled?.(colId) ?? false;
    const alreadyGrouped = (this.api.getRowGroupColumns?.() ?? []).includes(colId);
    const isPivotable = this.api.isColumnPivotEnabled?.(colId) ?? false;
    const alreadyPivoted = (this.api.getPivotColumns?.() ?? []).includes(colId);

    const orderedColIds = (): string[] => Array.from(this.listEl.children)
      .map((c) => (c as HTMLElement).dataset.colId)
      .filter((id): id is string => typeof id === 'string');

    const zoneSpecs = allowDragOut ? this.dropZoneSpecs(colId) : [];

    let dragStarted = false;
    let overZoneIdx = -1; // index into zoneSpecs of the zone the cursor is over
    let overHeaderStrip = false;
    let overPivotStrip = false;
    let overColumnHeaderBand = false;

    // Column-header drop router — parallel to the row-group-panel router.
    const hasColHeaderDropRouter =
      typeof (this.api as any).isPointInColumnHeaderBand === 'function'
      && typeof (this.api as any).setColumnHeaderDragHover === 'function'
      && typeof (this.api as any).commitColumnHeaderDrop === 'function';

    // ---- Floating ghost -------------------------------------------
    let ghost: HTMLDivElement | null = null;

    const mountGhost = (clientX: number, clientY: number): void => {
      if (typeof document === 'undefined') return;
      const el = document.createElement('div');
      el.className = 'cg-col-drag-ghost';
      const icon = document.createElement('span');
      icon.className = 'cg-col-drag-ghost-icon';
      icon.setAttribute('aria-hidden', 'true');
      const lbl = document.createElement('span');
      lbl.className = 'cg-col-drag-ghost-label';
      lbl.textContent = label;
      el.appendChild(icon);
      el.appendChild(lbl);
      ghost = el;
      el.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
      const themeHost = this.root.closest<HTMLElement>('[class*="cg-theme"]') ?? document.body;
      themeHost.appendChild(el);
      requestAnimationFrame(() => el.classList.add('cg-col-drag-ghost--visible'));
    };

    const positionGhost = (clientX: number, clientY: number): void => {
      if (!ghost) return;
      ghost.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
    };

    const removeGhost = (): void => { ghost?.remove(); ghost = null; };

    // ---- Shared row-group-panel router ----------------------------
    const router = this.api as unknown as import('../features/columnDrag').RowGroupPanelDragRouter;
    const hasRouter =
      typeof (this.api as any).isPointInRowGroupPanel === 'function'
      && typeof (this.api as any).setRowGroupPanelDragHover === 'function'
      && typeof (this.api as any).commitRowGroupPanelDrop === 'function';

    // ---- Shared pivot-panel router (Column Labels top strip) -------
    const pivotRouter = this.api as unknown as import('../features/columnDrag').PivotPanelDragRouter;
    const hasPivotRouter =
      typeof (this.api as any).isPointInPivotPanel === 'function'
      && typeof (this.api as any).setPivotPanelDragHover === 'function'
      && typeof (this.api as any).commitPivotPanelDrop === 'function';

    /** Clear any drop-state outline this drag has painted (zone-specific
     *  or header-strip). Called before painting a new state OR on
     *  release. */
    const clearAllZoneOutlines = (): void => {
      for (let i = 0; i < zoneSpecs.length; i++) {
        this.setZoneDropState(zoneSpecs[i]!.dropZone, null);
      }
    };

    // ---- Handlers -------------------------------------------------
    const onMove = (ev: MouseEvent) => {
      // Gate ALL drag behavior behind the threshold.
      if (!dragStarted) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragStarted = true;
        row.el.classList.add('cg-columns-panel-row--lifted');
        mountGhost(ev.clientX, ev.clientY);
      }

      positionGhost(ev.clientX, ev.clientY);

      // 1. Row group HEADER STRIP — outside the sidebar, highest priority.
      if (hasRouter && allowDragOut && isGroupable && !alreadyGrouped) {
        const inStrip = routeExternalDragHover(router, colId, ev.clientX, ev.clientY);
        if (inStrip !== overHeaderStrip) {
          overHeaderStrip = inStrip;
          if (inStrip) {
            clearAllZoneOutlines();
            overZoneIdx = -1;
            if (overColumnHeaderBand) {
              (this.api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
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
        const inStrip = routePivotPanelDragHover(pivotRouter, colId, ev.clientX, ev.clientY);
        if (inStrip !== overPivotStrip) {
          overPivotStrip = inStrip;
          if (inStrip) {
            clearAllZoneOutlines();
            overZoneIdx = -1;
            if (overColumnHeaderBand) {
              (this.api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
              overColumnHeaderBand = false;
            }
          }
        }
        if (overPivotStrip) return;
      }

      // 2. Column header band.
      if (hasColHeaderDropRouter && allowDragOut && !overHeaderStrip) {
        const inHeaderBand = (this.api as any).isPointInColumnHeaderBand(ev.clientX, ev.clientY) as boolean;
        if (inHeaderBand !== overColumnHeaderBand) {
          overColumnHeaderBand = inHeaderBand;
          if (!inHeaderBand) {
            (this.api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
          } else {
            clearAllZoneOutlines();
            overZoneIdx = -1;
          }
        }
        if (inHeaderBand) {
          (this.api as any).setColumnHeaderDragHover(colId, ev.clientX, ev.clientY);
          return;
        }
      }

      // 3. In-panel drop zones (pivot, values, row groups in that order).
      if (allowDragOut && zoneSpecs.length > 0) {
        let nextZoneIdx = -1;
        for (let i = 0; i < zoneSpecs.length; i++) {
          const spec = zoneSpecs[i]!;
          if (this.isPointInRect(this.getZoneRect(spec.dropZone), ev.clientX, ev.clientY)) {
            nextZoneIdx = i;
            break;
          }
        }
        if (nextZoneIdx !== overZoneIdx) {
          // Clear the prior zone's outline.
          if (overZoneIdx >= 0) {
            this.setZoneDropState(zoneSpecs[overZoneIdx]!.dropZone, null);
          }
          overZoneIdx = nextZoneIdx;
          if (overZoneIdx >= 0) {
            const spec = zoneSpecs[overZoneIdx]!;
            this.setZoneDropState(spec.dropZone, spec.accepts(colId) ? 'accept' : 'reject');
          }
        }
      }

      if (overZoneIdx >= 0) return;

      // 4. Otherwise — optimistic list reorder.
      const rect = this.listEl.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const children = Array.from(this.listEl.children) as HTMLElement[];
      if (children.length === 0) return;
      const list = orderedColIds();
      const fromIdx = list.indexOf(colId);
      let toIdx = children.length - 1;
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        const r = child.getBoundingClientRect();
        if (y < r.top + r.height / 2 - rect.top) { toIdx = i; break; }
      }
      if (toIdx === fromIdx) return;
      const ref = children[toIdx]!;
      ref.parentElement?.insertBefore(
        row.el,
        toIdx > fromIdx ? ref.nextSibling : ref,
      );
    };

    const onUp = (ev: MouseEvent) => {
      row.el.classList.remove('cg-columns-panel-row--lifted');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      removeGhost();
      if (hasRouter) clearExternalDragHover(router);
      if (hasPivotRouter) clearPivotPanelDragHover(pivotRouter);
      if (hasColHeaderDropRouter) {
        (this.api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
      }

      // A click that never crossed the threshold — nothing to commit.
      if (!dragStarted) return;

      if (overHeaderStrip) {
        (this.api as any).commitRowGroupPanelDrop?.(colId);
        clearAllZoneOutlines();
        return;
      }

      if (overPivotStrip) {
        (this.api as any).commitPivotPanelDrop?.(colId);
        clearAllZoneOutlines();
        return;
      }

      if (overColumnHeaderBand) {
        (this.api as any).commitColumnHeaderDrop(colId, ev.clientX);
        clearAllZoneOutlines();
        return;
      }

      // In-panel zone release.
      clearAllZoneOutlines();
      if (allowDragOut && zoneSpecs.length > 0) {
        // Re-resolve which zone the cursor lands in (independent of the
        // last-painted state — clears stale hover when the pointer left
        // mid-drag).
        for (const spec of zoneSpecs) {
          if (this.isPointInRect(this.getZoneRect(spec.dropZone), ev.clientX, ev.clientY)) {
            if (spec.accepts(colId)) spec.commit(colId);
            return;
          }
        }
      }

      // Otherwise it's a list reorder.
      const finalIdx = orderedColIds().indexOf(colId);
      if (finalIdx >= 0) {
        try {
          this.api.moveColumns([colId], finalIdx);
        } catch (err) {
          console.error('[cg-columns-panel] moveColumns failed', err);
        }
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** Pill drag — generalised across rgz / plz / valz. On release:
   *   • If the drop lands inside the originating zone → reorder the
   *     pill to the slot under the cursor via `onReorder`.
   *   • Else if the drop lands on a DIFFERENT pill panel that accepts
   *     the column → atomic cross-panel move via
   *     `api.commitPanelMove`. The role-change events drive the panel
   *     rebuild — `onDragOut` is NOT called (the column is now in
   *     the new role, not gone).
   *   • Else → `onDragOut` fires, which removes the column from this
   *     zone's role (existing behaviour).
   */
  private beginPillDrag(
    e: MouseEvent,
    opts: {
      pillEl: HTMLElement;
      zone: 'rgz' | 'plz' | 'valz';
      colId: string;
      label: string;
      onDragOut: () => void;
      onReorder: (toIndex: number) => void;
      getZoneRect: () => DOMRect | null;
      getZoneContent: () => HTMLElement | null;
    },
  ): void {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost: HTMLDivElement | null = null;
    let insertionLine: HTMLDivElement | null = null;

    const mountGhost = (clientX: number, clientY: number): void => {
      if (typeof document === 'undefined') return;
      const el = document.createElement('div');
      el.className = 'cg-col-drag-ghost';
      const icon = document.createElement('span');
      icon.className = 'cg-col-drag-ghost-icon';
      icon.setAttribute('aria-hidden', 'true');
      const lbl = document.createElement('span');
      lbl.className = 'cg-col-drag-ghost-label';
      lbl.textContent = opts.label;
      el.appendChild(icon);
      el.appendChild(lbl);
      ghost = el;
      el.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
      const themeHost = this.root.closest<HTMLElement>('[class*="cg-theme"]') ?? document.body;
      themeHost.appendChild(el);
      requestAnimationFrame(() => el.classList.add('cg-col-drag-ghost--visible'));
    };

    const positionGhost = (clientX: number, clientY: number): void => {
      if (!ghost) return;
      ghost.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
    };
    const removeGhost = (): void => { ghost?.remove(); ghost = null; };

    const liftedClass = `cg-columns-panel-${opts.zone}-pill--lifted`;

    /** Resolve the slot index (0..pills.length) the cursor is hovering
     *  over inside the zone's content container. The slot matches the
     *  AG-Grid `moveInArray` semantics — it indexes into the FULL
     *  pill list (including the dragged pill, which sits at its
     *  original position with `visibility:hidden`). */
    const computeSlotIndex = (clientY: number): { slot: number; gapY: number } | null => {
      const content = opts.getZoneContent();
      if (!content) return null;
      const pills = Array.from(content.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement
          && el.classList.contains('cg-columns-panel-pill'),
      );
      if (pills.length === 0) {
        const rect = content.getBoundingClientRect();
        return { slot: 0, gapY: rect.top + 4 };
      }
      // Compare against each pill's vertical midpoint.
      let slot = pills.length;
      let gapY = pills[pills.length - 1]!.getBoundingClientRect().bottom + 1;
      for (let i = 0; i < pills.length; i++) {
        const r = pills[i]!.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (clientY < mid) { slot = i; gapY = r.top - 1; break; }
      }
      return { slot, gapY };
    };

    const mountInsertionLine = (clientY: number): void => {
      const content = opts.getZoneContent();
      if (!content) return;
      const target = computeSlotIndex(clientY);
      if (!target) return;
      if (!insertionLine) {
        insertionLine = document.createElement('div');
        insertionLine.className = 'cg-columns-panel-insertion-line';
        // Inline a minimum-viable visual so themes that haven't
        // styled the class still see the indicator.
        insertionLine.style.cssText =
          'position:absolute; left:0; right:0; height:2px; background:var(--cg-color-accent, #4aa3ff); pointer-events:none; z-index:5; border-radius:1px;';
      }
      const zoneRect = content.getBoundingClientRect();
      // Position the line relative to the content container.
      if (insertionLine.parentElement !== content) content.style.position = 'relative';
      if (insertionLine.parentElement !== content) content.appendChild(insertionLine);
      insertionLine.style.top = `${target.gapY - zoneRect.top}px`;
    };

    const removeInsertionLine = (): void => {
      insertionLine?.remove();
      insertionLine = null;
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        opts.pillEl.classList.add(liftedClass);
        mountGhost(ev.clientX, ev.clientY);
      }
      positionGhost(ev.clientX, ev.clientY);
      // Paint the insertion line while the cursor is inside the
      // source zone (within-zone reorder feedback). Clear it
      // otherwise so a cross-panel drag doesn't leave a stale
      // marker behind.
      if (this.isPointInRect(opts.getZoneRect(), ev.clientX, ev.clientY)) {
        mountInsertionLine(ev.clientY);
      } else {
        removeInsertionLine();
      }
    };

    const sourceRole: 'rowGroup' | 'pivot' | 'value' =
      opts.zone === 'rgz' ? 'rowGroup' :
      opts.zone === 'plz' ? 'pivot' :
      'value';

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      opts.pillEl.classList.remove(liftedClass);
      removeGhost();
      removeInsertionLine();
      if (!dragging) return;
      // Drop landed inside the source zone → within-zone reorder.
      if (this.isPointInRect(opts.getZoneRect(), ev.clientX, ev.clientY)) {
        const target = computeSlotIndex(ev.clientY);
        if (target) opts.onReorder(target.slot);
        return;
      }
      // Try routing to a foreign pill panel first. If the target
      // accepts, the column moves to the new role; the panel rebuild
      // happens through the role-change event. Only fall back to
      // remove-from-current-role when no foreign panel accepted.
      const target = this.api.resolveDragTargetRole?.(ev.clientX, ev.clientY) ?? null;
      if (target && target !== sourceRole) {
        const moved = this.api.commitPanelMove?.(sourceRole, target, opts.colId) ?? false;
        if (moved) return;
      }
      opts.onDragOut();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
}
