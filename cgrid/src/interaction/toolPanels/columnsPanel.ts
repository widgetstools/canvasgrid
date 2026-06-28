/**
 * Cycle 11 / Task 3 + Cycle 15.5 / Task 2 — ColumnsToolPanel
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
 * Cycle 15.5 / Task 2 upgrades the Row Groups SECTION from an inert
 * stub to a LIVE drop zone — the third view over the same
 * `rowGroupColumns` list (along with the row group panel from Cycle
 * 15 / Task 6 + Cycle 15.5 / Task 1 + the header context menu items
 * from Cycle 15.5 / Task 2). The drop zone:
 *
 *   - Renders one COMPACT pill per `api.getRowGroupColumns()` entry
 *     in nesting order (vertically stacked — design plan picks
 *     vertical because the sidebar is narrow).
 *   - Each pill carries the column's headerName + an `✕` remove
 *     button that routes through `api.removeRowGroupColumn(colId)`.
 *   - Accepts drag drops from the column list: if `enableRowGroup`
 *     is true on the dragged column AND the column isn't already
 *     grouped, `api.addRowGroupColumn(colId)` is called on release.
 *   - Accepts pill drag-out: dragging a pill OUT of the zone on
 *     release calls `api.removeRowGroupColumn(colId)`.
 *   - Subscribes to `columnRowGroupChanged` so a mutation from the
 *     row group panel OR the header context menu re-renders the
 *     pills here live (the three-views-one-list invariant the
 *     Cycle 15.5 worklog calls load-bearing).
 *
 * Layout (matches the user reference 2026-06-26 dark-theme target
 * encoded in the worklog Task 3 ASCII, extended by Task 2's live zone):
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
 *   │ ☰  Row Groups                         │  ← suppressRowGroups
 *   │ ┌─ Country ✕ ──────────────────────┐  │  ← pill (live)
 *   │ ├─ Year    ✕ ──────────────────────┤  │
 *   │ └─ Drag here to set row groups ───┘  │  ← empty-state placeholder
 *   ├──────────────────────────────────────┤
 *   │ Σ  Values                             │  ← suppressValues
 *   │ ┌─ Drag here to aggregate ──────┐    │
 *   │ └──────────────────────────────┘     │
 *   └──────────────────────────────────────┘
 *
 * The Pivot Mode toggle ships as a visual stub in Cycle 11 — clicking
 * flips `aria-pressed` but does NOT call any grid API. The real
 * `api.setPivotMode` wiring lands in Cycle 16; for now we log a debug
 * breadcrumb so the path is greppable. The Values drop zone is
 * similarly inert — aggregation drag-and-drop lands in Cycle 16.
 *
 * Subscribes to `columnVisible` + `columnMoved` events so external
 * state mutations (e.g. an app calling `applyColumnState`) keep the
 * panel in sync. `suppressSyncLayoutWithGrid: true` opts out of this
 * subscription for apps that drive the panel imperatively via
 * `refreshToolPanel`. The Row Groups zone separately subscribes to
 * `columnRowGroupChanged` (always on — there's no parallel suppress
 * flag because the zone's whole point is to mirror state).
 *
 * `refresh()` walks the existing row list and updates checkbox state +
 * reorders DOM nodes in place to match the new `getColumnState()`
 * order. The root container is never replaced, so scroll position
 * survives a refresh. `refresh()` also re-renders the Row Groups zone
 * pills (a programmatic `refreshToolPanel` call should make the zone
 * pick up any new state).
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md
 *   § Cycle 15.5 / Task 2 — pill style + drop zone position + tokens.
 */
import type { CGridApi, CColumnState } from '../../types';
import { iconSvg } from '../../renderer/icons';
import {
  routeExternalDragHover,
  clearExternalDragHover,
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

/** Verbatim from the Cycle 15 / Task 6 row group panel. ONE drop-zone
 *  empty-state string across the grid. */
const ROW_GROUPS_PLACEHOLDER = 'Drag here to set row groups';
const VALUES_PLACEHOLDER = 'Drag here to aggregate';

/** Threshold (CSS px) the pointer must move from the down-event before
 *  a press is treated as a drag. Matches Cycle 6's column-drag
 *  threshold + Cycle 15.5 / Task 1's pill-reorder threshold; one drag
 *  budget across the grid. */
const DRAG_THRESHOLD_PX = 4;

export class ColumnsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private api!: CGridApi;
  private params: IToolPanelColumnCompParams = {};

  /** Search input (null when suppressColumnFilter). */
  private searchInput: HTMLInputElement | null = null;
  /** "Select All / Deselect All" checkbox (null when suppressColumnFilter). */
  private selectAllCb: HTMLInputElement | null = null;
  /** Container for the column rows. */
  private listEl!: HTMLElement;
  /** Per-colId row cache so refresh + reorder don't blow away DOM nodes. */
  private rows = new Map<string, PanelRow>();
  /** Current pivot-mode toggle state (visual stub — flipped on click). */
  private pivotModeActive = false;
  /** Unsubscribe functions returned by `api.addEventListener`. */
  private unsubs: Array<() => void> = [];

  /** Cycle 15.5 / Task 2 — DOM handles for the Row Groups zone. `null`
   *  when `suppressRowGroups` is set. */
  private rowGroupsSection: {
    section: HTMLElement;
    /** The dashed-outline container that doubles as the drop target.
     *  Houses the pill list AND the empty-state placeholder. */
    dropZone: HTMLElement;
    /** Holds the pill stack OR the empty-state placeholder. Rebuilt
     *  wholesale on every `columnRowGroupChanged`. */
    content: HTMLElement;
    /** Per-pill cache (size = current `rowGroupColumns.length`). */
    pills: RowGroupPill[];
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

    if (!this.params.suppressRowGroups) {
      this.root.appendChild(this.buildRowGroupsSection());
      this.refreshRowGroupPills();
    }
    if (!this.params.suppressValues) {
      this.root.appendChild(this.buildValuesSection());
    }

    if (!this.params.suppressSyncLayoutWithGrid) {
      const offVisible = this.api.addEventListener('columnVisible', () => this.refresh());
      const offMoved = this.api.addEventListener('columnMoved', () => this.refresh());
      this.unsubs.push(offVisible, offMoved);
    }
    // Cycle 15.5 / Task 2 — the Row Groups zone ALWAYS subscribes
    // (independent of `suppressSyncLayoutWithGrid` — the zone IS a
    // mirror by design; suppressing the sync would defeat the purpose).
    // When suppressRowGroups is set, there's nothing to refresh, so
    // skip the subscription too.
    if (!this.params.suppressRowGroups) {
      const offGroup = this.api.addEventListener('columnRowGroupChanged', () => {
        this.refreshRowGroupPills();
      });
      this.unsubs.push(offGroup);
    }
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
  }

  destroy(): void {
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.rows.clear();
    this.rowGroupsSection = null;
    this.root.parentElement?.removeChild(this.root);
  }

  // ---- builders -----------------------------------------------------

  private buildPivotModeRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cg-columns-panel-pivot-mode';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cg-columns-panel-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Pivot Mode');
    const knob = document.createElement('span');
    knob.className = 'cg-columns-panel-toggle-knob';
    btn.appendChild(knob);
    btn.addEventListener('click', () => {
      this.pivotModeActive = !this.pivotModeActive;
      btn.setAttribute('aria-pressed', String(this.pivotModeActive));
      console.debug('[pivot] mode toggle (stub — wired in Cycle 16)');
    });

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

  /** Cycle 15.5 / Task 2 — Row Groups SECTION builder. Replaces the
   *  Cycle 11 inert stub with the live drop zone. Returns the section
   *  element; pills are rendered lazily by `refreshRowGroupPills`. */
  private buildRowGroupsSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'cg-columns-panel-section';
    section.dataset.kind = 'groups';

    const header = document.createElement('div');
    header.className = 'cg-columns-panel-section-header cg-columns-panel-section-header--groups';
    const groupsIcon = document.createElement('span');
    groupsIcon.className = 'cg-columns-panel-section-header-icon';
    groupsIcon.appendChild(iconSvg('menu', 13));
    header.appendChild(groupsIcon);
    header.appendChild(document.createTextNode('Row Groups'));

    const dropZone = document.createElement('div');
    dropZone.className = 'cg-columns-panel-drop-zone cg-columns-panel-rgz';
    dropZone.setAttribute('role', 'list');
    dropZone.setAttribute('aria-label', 'Row group columns');

    const content = document.createElement('div');
    content.className = 'cg-columns-panel-rgz-content';
    dropZone.appendChild(content);

    section.appendChild(header);
    section.appendChild(dropZone);

    this.rowGroupsSection = { section, dropZone, content, pills: [] };
    return section;
  }

  /** Build the Values section (still an inert stub in Cycle 15.5 —
   *  aggregation drag-and-drop lands in Cycle 16). */
  private buildValuesSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'cg-columns-panel-section';
    section.dataset.kind = 'values';

    const header = document.createElement('div');
    header.className = 'cg-columns-panel-section-header cg-columns-panel-section-header--values';
    const valuesIcon = document.createElement('span');
    valuesIcon.className = 'cg-columns-panel-section-header-icon';
    valuesIcon.appendChild(iconSvg('sigma', 13));
    header.appendChild(valuesIcon);
    header.appendChild(document.createTextNode('Values'));

    const dropZone = document.createElement('div');
    dropZone.className = 'cg-columns-panel-drop-zone cg-columns-panel-valz';
    dropZone.setAttribute('role', 'list');
    dropZone.setAttribute('aria-label', 'Aggregate value columns');
    const valContent = document.createElement('div');
    valContent.className = 'cg-columns-panel-valz-content';
    const valEmpty = document.createElement('div');
    valEmpty.className = 'cg-columns-panel-valz-empty';
    valEmpty.textContent = VALUES_PLACEHOLDER;
    valContent.appendChild(valEmpty);
    dropZone.appendChild(valContent);
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      console.debug('[values] drop (stub — wired in Cycle 16)');
    });

    section.appendChild(header);
    section.appendChild(dropZone);
    return section;
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
    checkbox.checked = entry.hide !== true;
    checkbox.setAttribute('aria-label', this.resolveLabel(entry.colId));
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = checkbox.checked;
      this.api.setColumnsVisible([entry.colId], next);
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

  private resolveLabel(colId: string): string {
    const headerName = this.api.getColumnHeaderName?.(colId);
    return (headerName && headerName.length > 0) ? headerName : colId;
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
        row.checkbox.checked = entry.hide !== true;
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

  /** Cycle 15.5 / Task 2 — rebuild the pill stack from the current
   *  `rowGroupColumns`. Wholesale rebuild — the list is small (≤ a
   *  handful) so the cost is trivial and we avoid the bookkeeping a
   *  diff-render would need. */
  private refreshRowGroupPills(): void {
    const section = this.rowGroupsSection;
    if (!section) return;
    const cols = this.api.getRowGroupColumns?.() ?? [];

    section.pills = [];
    section.content.replaceChildren();

    if (cols.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cg-columns-panel-rgz-empty';
      empty.textContent = ROW_GROUPS_PLACEHOLDER;
      section.content.appendChild(empty);
      return;
    }

    for (const colId of cols) {
      const pillEl = this.buildRowGroupPill(colId);
      section.content.appendChild(pillEl);
      section.pills.push({ el: pillEl, colId });
    }
  }

  /** Build one pill: label + `✕` remove. The pill body itself is the
   *  drag-out source — pointer-down + drag past the threshold + release
   *  outside the drop zone removes the column from the row-group list.
   *  Release inside the zone is a no-op (within-zone reorder is
   *  deferred to a follow-up cycle; the row group panel from Task 1
   *  is the canonical reorder surface). */
  private buildRowGroupPill(colId: string): HTMLElement {
    const pill = document.createElement('div');
    pill.className = 'cg-columns-panel-rgz-pill';
    pill.setAttribute('role', 'listitem');
    pill.dataset.colId = colId;

    const handle = document.createElement('span');
    handle.className = 'cg-columns-panel-rgz-pill-handle';
    handle.setAttribute('aria-hidden', 'true');
    pill.appendChild(handle);

    const label = document.createElement('span');
    label.className = 'cg-columns-panel-rgz-pill-label';
    label.textContent = this.resolveLabel(colId);
    pill.appendChild(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cg-columns-panel-rgz-pill-remove';
    remove.setAttribute('aria-label', `Remove ${this.resolveLabel(colId)} from row groups`);
    remove.textContent = '✕'; // ✕
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      this.api.removeRowGroupColumn?.(colId);
    });
    pill.appendChild(remove);

    pill.addEventListener('mousedown', (e) => {
      // `×` button has its own click handler; don't intercept clicks
      // landing on it (pointer-down on the button still bubbles here).
      if (e.target instanceof Element && e.target.closest('.cg-columns-panel-rgz-pill-remove')) {
        return;
      }
      this.beginPillDrag(e, colId);
    });

    return pill;
  }

  /** True when the cursor (`clientX`, `clientY`) falls inside the
   *  Row Groups drop zone's bounding rect. The zone IS the drop
   *  target — releasing a column-list drag inside this rect adds the
   *  column to the row-group list (when `enableRowGroup`); releasing
   *  a pill drag OUTSIDE this rect removes the pill. */
  private isPointInRowGroupsZone(clientX: number, clientY: number): boolean {
    const section = this.rowGroupsSection;
    if (!section) return false;
    const rect = section.dropZone.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  /** Paint / clear the drop-target outline on the zone. `'accept'` lights
   *  it up in the focus-ring color (one drop-color across all drop
   *  zones); `'reject'` paints the amber rejected variant; `null`
   *  clears it. */
  private setRowGroupsZoneDropState(state: 'accept' | 'reject' | null): void {
    const section = this.rowGroupsSection;
    if (!section) return;
    if (state === null) {
      delete section.dropZone.dataset.drop;
    } else {
      section.dropZone.dataset.drop = state;
    }
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

  // ---- drag-within-list reorder + drag-into-row-groups-zone ---------

  /** Drag-within-the-panel reorder with ag-grid–style drag UX.
   *
   *  Gesture state machine:
   *    idle → pressed (mousedown on handle)
   *    pressed → dragging (movement past DRAG_THRESHOLD_PX)
   *    dragging → idle (mouseup)
   *
   *  While DRAGGING:
   *  - The source row becomes invisible (`--lifted`) so its DOM slot is
   *    preserved for the optimistic reorder but the row isn't shown twice.
   *  - A floating ghost card (`cg-col-drag-ghost`) mounts on document.body
   *    and follows the cursor at (+12, +8) offset — same pattern as the
   *    row group panel chip ghost from Task 1.
   *  - Drop targets (tool-panel zone + row group header strip) light up
   *    with accept/reject outlines as the cursor crosses their rects.
   *
   *  A mouseup before the threshold is treated as a click: no ghost,
   *  no state mutation, no `moveColumns` call. */
  private beginRowDrag(e: MouseEvent, colId: string): void {
    e.preventDefault();
    const row = this.rows.get(colId);
    if (!row) return;

    const label = this.resolveLabel(colId);
    const startX = e.clientX;
    const startY = e.clientY;

    const allowDragOut = this.api.getGridOption?.('allowDragFromColumnsToolPanel') !== false;
    const isGroupable = this.api.isColumnRowGroupEnabled?.(colId) ?? false;
    const alreadyGrouped = (this.api.getRowGroupColumns?.() ?? []).includes(colId);

    const orderedColIds = (): string[] => Array.from(this.listEl.children)
      .map((c) => (c as HTMLElement).dataset.colId)
      .filter((id): id is string => typeof id === 'string');

    let dragStarted = false;
    let overZone = false;
    let overHeaderStrip = false;
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
      // No textContent — the dot-grid is drawn via CSS background-image.
      const lbl = document.createElement('span');
      lbl.className = 'cg-col-drag-ghost-label';
      lbl.textContent = label;
      el.appendChild(icon);
      el.appendChild(lbl);
      ghost = el;
      // Position before appending so the first frame is already correct
      // (avoids a flash at 0,0 before the rAF fires).
      el.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
      // Mount inside the themed ancestor so CSS variables resolve.  The
      // ghost uses `position:fixed` which stays viewport-relative as long
      // as no ancestor introduces a `transform` / `filter` stacking
      // context — grid containers don't, so this is safe.
      const themeHost = this.root.closest<HTMLElement>('[class*="cg-theme"]') ?? document.body;
      themeHost.appendChild(el);
      requestAnimationFrame(() => el.classList.add('cg-col-drag-ghost--visible'));
    };

    const positionGhost = (clientX: number, clientY: number): void => {
      if (!ghost) return;
      ghost.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
    };

    const removeGhost = (): void => {
      ghost?.remove();
      ghost = null;
    };

    // ---- Shared row-group-panel router ----------------------------
    const router = this.api as unknown as import('../features/columnDrag').RowGroupPanelDragRouter;
    const hasRouter =
      typeof (this.api as any).isPointInRowGroupPanel === 'function'
      && typeof (this.api as any).setRowGroupPanelDragHover === 'function'
      && typeof (this.api as any).commitRowGroupPanelDrop === 'function';

    // ---- Handlers -------------------------------------------------
    const onMove = (ev: MouseEvent) => {
      // Gate ALL drag behavior behind the threshold — clicks must not
      // trigger zone highlights, list reorders, or ghost rendering.
      if (!dragStarted) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragStarted = true;
        // Visually "lift" the row out of the list without removing its
        // DOM slot (so the optimistic reorder doesn't change list height).
        row.el.classList.add('cg-columns-panel-row--lifted');
        mountGhost(ev.clientX, ev.clientY);
      }

      positionGhost(ev.clientX, ev.clientY);

      // Check the row group HEADER STRIP first — it's outside the sidebar
      // so it has higher visual priority than the in-panel zone.
      if (hasRouter && allowDragOut && isGroupable && !alreadyGrouped) {
        const inStrip = routeExternalDragHover(router, colId, ev.clientX, ev.clientY);
        if (inStrip !== overHeaderStrip) {
          overHeaderStrip = inStrip;
          if (inStrip) {
            this.setRowGroupsZoneDropState(null);
            if (overColumnHeaderBand) {
              (this.api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
              overColumnHeaderBand = false;
            }
          }
        }
        if (overHeaderStrip) return;
      }

      // Check the column header band — allows dragging a column from the
      // columns panel into the grid header to reorder it.
      if (hasColHeaderDropRouter && allowDragOut && !overHeaderStrip) {
        const inHeaderBand = (this.api as any).isPointInColumnHeaderBand(ev.clientX, ev.clientY) as boolean;
        if (inHeaderBand !== overColumnHeaderBand) {
          overColumnHeaderBand = inHeaderBand;
          if (!inHeaderBand) {
            (this.api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
          } else {
            this.setRowGroupsZoneDropState(null);
          }
        }
        if (inHeaderBand) {
          (this.api as any).setColumnHeaderDragHover(colId, ev.clientX, ev.clientY);
          return;
        }
      }

      // Paint the tool-panel drop-zone outline.
      if (allowDragOut && this.rowGroupsSection !== null) {
        const insideNow = this.isPointInRowGroupsZone(ev.clientX, ev.clientY);
        if (insideNow !== overZone) {
          overZone = insideNow;
          this.setRowGroupsZoneDropState(
            insideNow
              ? (isGroupable && !alreadyGrouped ? 'accept' : 'reject')
              : null,
          );
        }
      }

      if (overZone) return;

      // Optimistic list reorder.
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
      if (hasColHeaderDropRouter) {
        (this.api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
      }

      // A click that never crossed the threshold — nothing to commit.
      if (!dragStarted) return;

      if (overHeaderStrip) {
        (this.api as any).commitRowGroupPanelDrop?.(colId);
        return;
      }

      if (overColumnHeaderBand) {
        (this.api as any).commitColumnHeaderDrop(colId, ev.clientX);
        return;
      }

      this.setRowGroupsZoneDropState(null);
      if (allowDragOut && this.rowGroupsSection !== null
          && this.isPointInRowGroupsZone(ev.clientX, ev.clientY)) {
        if (isGroupable && !alreadyGrouped) this.api.addRowGroupColumn?.(colId);
        return;
      }

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

  /** Cycle 15.5 / Task 2 — pill drag-out. Mouse-down on a pill body
   *  begins a candidate drag; once the pointer moves past
   *  `DRAG_THRESHOLD_PX`, a `--dragging` class lights up. Release
   *  INSIDE the zone is a no-op (within-zone reorder is intentionally
   *  out of scope for Task 2 — the row group panel is the canonical
   *  reorder surface). Release OUTSIDE the zone removes the column
   *  from the row-group list. */
  private beginPillDrag(e: MouseEvent, colId: string): void {
    e.preventDefault();
    const section = this.rowGroupsSection;
    if (!section) return;
    const pill = section.pills.find((p) => p.colId === colId);
    if (!pill) return;

    const label = this.resolveLabel(colId);
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
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

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        pill.el.classList.add('cg-columns-panel-rgz-pill--lifted');
        mountGhost(ev.clientX, ev.clientY);
      }
      positionGhost(ev.clientX, ev.clientY);
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      pill.el.classList.remove('cg-columns-panel-rgz-pill--lifted');
      removeGhost();
      if (!dragging) return;
      if (!this.isPointInRowGroupsZone(ev.clientX, ev.clientY)) {
        this.api.removeRowGroupColumn?.(colId);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
}
