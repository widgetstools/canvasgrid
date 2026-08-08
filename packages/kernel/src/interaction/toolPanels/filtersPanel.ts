/**
 * Cycle 11 / Task 4 — FiltersToolPanel (built-in `agFiltersToolPanel`).
 *
 * Mounted by the SideBarHost (Task 2). Renders one collapsible row per
 * FILTERABLE column with a chevron toggle + label. Clicking a row
 * mounts the column's filter editor inline — the SAME editor
 * `FilterPopupHost` mounts in popup mode, threaded through the new
 * `api.buildColumnFilterEditor(colId)` helper so a bug fixed in one
 * path is fixed in both.
 *
 * Layout (matches the user reference 2026-06-26 dark-theme target
 * encoded in the worklog Task 4 ASCII):
 *
 *   ┌──────────────────────────────────────┐
 *   │ 🔍  Search...                         │ ← suppressFilterSearch
 *   ├──────────────────────────────────────┤
 *   │ Expand All                            │ ← suppressExpandAll
 *   ├──────────────────────────────────────┤
 *   │ >  Athlete                            │
 *   │ v  Country                            │ ← expanded
 *   │     [inline filter editor]            │
 *   │ >  Year                               │
 *   │ …                                     │
 *   └──────────────────────────────────────┘
 *
 * Only one row may be expanded at a time — opening a second row
 * collapses the first so the panel doesn't end up taller than the
 * side-bar host with several editors stacked. The expand-all button
 * lifts that constraint for a single click; clicking it again
 * collapses every row back to the chevron-only state.
 *
 * The panel reads filterable columns through
 * `api.getColumnFilterType(colId)` and resolves the inline editor via
 * `api.buildColumnFilterEditor(colId)`. Subscribes to `columnMoved` +
 * `columnVisible` events so external state mutations (e.g. apps
 * applying column state) keep the row list in sync.
 * `suppressSyncLayoutWithGrid: true` opts out of this subscription for
 * apps that drive the panel imperatively via `refreshToolPanel`.
 *
 * `refresh()` walks the existing row list and adds new rows for
 * unseen colIds, drops rows whose colId no longer appears, and
 * reorders DOM nodes in place to match the new `getColumnState()`
 * order. The root container is never replaced, so scroll position
 * survives a refresh.
 */
import type { VelocityGridApi, CColumnState } from '../../types';
import type {
  IToolPanelFiltersCompParams,
  ToolPanel,
  ToolPanelParams,
} from './types';

/** Chevron glyphs. `›` collapsed, `⌄` expanded — chosen to match the
 *  user reference 2026-06-26 layout. */
const CHEVRON_COLLAPSED = '›'; // ›
const CHEVRON_EXPANDED = '⌄'; // ⌄

/** Per-row state — the DOM handles plus the mounted-editor destroy hook
 *  (null until the user expands the row). */
interface PanelRow {
  el: HTMLElement;
  header: HTMLElement;
  chevron: HTMLElement;
  label: HTMLElement;
  editorHost: HTMLElement;
  expanded: boolean;
  /** Generation counter — bumped on every expand. The async editor
   *  build checks this before mounting; a collapse + re-expand in
   *  flight forces the late-arriving editor to discard itself. */
  generation: number;
  editorDestroy: (() => void) | null;
}

export class FiltersToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private api!: VelocityGridApi;
  private params: IToolPanelFiltersCompParams = {};

  /** Search input (null when suppressFilterSearch). */
  private searchInput: HTMLInputElement | null = null;
  /** Expand-all button (null when suppressExpandAll). */
  private expandAllBtn: HTMLButtonElement | null = null;
  /** Container for the column rows. */
  private listEl!: HTMLElement;
  /** Empty-state placeholder shown when no column has a filter. Lives
   *  in `listEl`; toggled by `syncRows`. */
  private emptyEl: HTMLElement | null = null;
  /** Per-colId row cache so refresh + reorder don't blow away DOM nodes. */
  private rows = new Map<string, PanelRow>();
  /** Unsubscribe functions returned by `api.addEventListener`. */
  private unsubs: Array<() => void> = [];
  /** True once `destroy()` has run — guards async editor mounts that
   *  resolve after the panel has been torn down. */
  private destroyed = false;

  init(p: ToolPanelParams): void {
    this.api = p.api as VelocityGridApi;
    this.params = (p.toolPanelParams as IToolPanelFiltersCompParams | undefined) ?? {};

    this.root = document.createElement('div');
    this.root.className = 'vg-filters-panel';

    if (!this.params.suppressFilterSearch) {
      this.root.appendChild(this.buildSearchRow());
    }
    if (!this.params.suppressExpandAll) {
      this.root.appendChild(this.buildExpandAllRow());
    }

    this.listEl = document.createElement('div');
    this.listEl.className = 'vg-filters-panel-list vg-scrollbar';
    this.root.appendChild(this.listEl);
    this.buildRows();

    if (!this.params.suppressSyncLayoutWithGrid) {
      const offMoved = this.api.addEventListener('columnMoved', () => this.refresh());
      const offVisible = this.api.addEventListener('columnVisible', () => this.refresh());
      this.unsubs.push(offMoved, offVisible);
    }
  }

  getGui(): HTMLElement {
    return this.root;
  }

  refresh(): void {
    const state = this.api.getColumnState();
    this.syncRows(state);
    this.applySearchFilter(this.searchInput?.value ?? '');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    for (const row of this.rows.values()) {
      if (row.editorDestroy) {
        try { row.editorDestroy(); } catch { /* noop */ }
        row.editorDestroy = null;
      }
    }
    this.rows.clear();
    this.root.parentElement?.removeChild(this.root);
  }

  // ---- builders -----------------------------------------------------

  private buildSearchRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vg-filters-panel-search';

    const icon = document.createElement('span');
    icon.className = 'vg-filters-panel-search-icon';
    icon.textContent = '\u{1F50D}'; // 🔍
    icon.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search...';
    input.setAttribute('aria-label', 'Search filters');
    input.addEventListener('input', () => this.applySearchFilter(input.value));

    row.appendChild(icon);
    row.appendChild(input);
    this.searchInput = input;
    return row;
  }

  private buildExpandAllRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vg-filters-panel-expand-all';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vg-filters-panel-expand-all-btn';
    btn.textContent = 'Expand All';
    btn.setAttribute('aria-label', 'Expand or collapse all filters');
    btn.addEventListener('click', () => this.toggleExpandAll());

    row.appendChild(btn);
    this.expandAllBtn = btn;
    return row;
  }

  /** Build every row once from `getColumnState()`. Called from `init`. */
  private buildRows(): void {
    const state = this.api.getColumnState();
    for (const entry of state) {
      if (!this.api.getColumnFilterType(entry.colId)) continue;
      const row = this.buildRow(entry.colId);
      this.rows.set(entry.colId, row);
      this.listEl.appendChild(row.el);
    }
    this.updateEmptyState();
  }

  private buildRow(colId: string): PanelRow {
    const el = document.createElement('div');
    el.className = 'vg-filters-panel-row';
    el.dataset.colId = colId;
    el.dataset.expanded = 'false';

    const header = document.createElement('div');
    header.className = 'vg-filters-panel-row-header';
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'false');
    header.tabIndex = 0;

    const chevron = document.createElement('span');
    chevron.className = 'vg-filters-panel-row-chevron';
    chevron.textContent = CHEVRON_COLLAPSED;
    chevron.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'vg-filters-panel-row-label';
    label.textContent = this.resolveLabel(colId);

    header.appendChild(chevron);
    header.appendChild(label);
    header.addEventListener('click', () => this.toggleRow(colId));

    const editorHost = document.createElement('div');
    editorHost.className = 'vg-filters-panel-row-editor';
    editorHost.style.display = 'none';

    el.appendChild(header);
    el.appendChild(editorHost);

    return {
      el, header, chevron, label, editorHost,
      expanded: false,
      generation: 0,
      editorDestroy: null,
    };
  }

  private resolveLabel(colId: string): string {
    const name = this.api.getColumnHeaderName?.(colId);
    return name && name.length > 0 ? name : colId;
  }

  // ---- expand / collapse --------------------------------------------

  private toggleRow(colId: string): void {
    const row = this.rows.get(colId);
    if (!row) return;
    if (row.expanded) {
      this.collapseRow(colId);
    } else {
      this.expandRow(colId);
    }
  }

  /** Mount the inline editor for `colId`. Closes any other open row
   *  first (one-at-a-time policy). The async editor build is guarded
   *  by a per-row generation counter so a collapse + re-expand racing
   *  in front of an in-flight build discards the late-arriving editor. */
  private expandRow(colId: string): void {
    const row = this.rows.get(colId);
    if (!row || row.expanded) return;

    // Close any other open row first — keeps the panel from stacking
    // multiple inline editors and overflowing the side-bar host.
    for (const [otherId, other] of this.rows) {
      if (otherId !== colId && other.expanded) this.collapseRow(otherId);
    }

    row.expanded = true;
    row.generation++;
    const myGen = row.generation;
    row.el.dataset.expanded = 'true';
    row.header.setAttribute('aria-expanded', 'true');
    row.chevron.textContent = CHEVRON_EXPANDED;
    row.editorHost.style.display = '';

    void this.api.buildColumnFilterEditor(colId).then((handle) => {
      if (this.destroyed) {
        if (handle) try { handle.destroy(); } catch { /* noop */ }
        return;
      }
      // Race guard: the row may have collapsed (or re-expanded with a
      // newer generation) while the editor was building.
      if (row.generation !== myGen || !row.expanded) {
        if (handle) try { handle.destroy(); } catch { /* noop */ }
        return;
      }
      if (!handle) return;
      row.editorHost.appendChild(handle.gui);
      row.editorDestroy = () => handle.destroy();
    }).catch((err) => {
      if (!this.destroyed) console.error('[vg-filters-panel] buildColumnFilterEditor:', err);
    });
  }

  private collapseRow(colId: string): void {
    const row = this.rows.get(colId);
    if (!row || !row.expanded) return;
    row.expanded = false;
    row.generation++;
    row.el.dataset.expanded = 'false';
    row.header.setAttribute('aria-expanded', 'false');
    row.chevron.textContent = CHEVRON_COLLAPSED;
    row.editorHost.style.display = 'none';
    if (row.editorDestroy) {
      try { row.editorDestroy(); } catch { /* noop */ }
      row.editorDestroy = null;
    }
    row.editorHost.replaceChildren();
  }

  /** Expand every row when at least one is collapsed; otherwise
   *  collapse every row. Single-row policy is suspended during
   *  expand-all so the user can see every editor at once. */
  private toggleExpandAll(): void {
    const rows = Array.from(this.rows.values());
    if (rows.length === 0) return;
    const allExpanded = rows.every((r) => r.expanded);
    if (allExpanded) {
      for (const row of rows) {
        if (row.expanded) this.collapseRowDirect(row);
      }
    } else {
      for (const row of rows) {
        if (!row.expanded) this.expandRowDirect(row);
      }
    }
  }

  /** Expand-all variant: skips the "close any other open row first"
   *  policy so multiple rows can be open simultaneously. */
  private expandRowDirect(row: PanelRow): void {
    if (row.expanded) return;
    row.expanded = true;
    row.generation++;
    const myGen = row.generation;
    row.el.dataset.expanded = 'true';
    row.header.setAttribute('aria-expanded', 'true');
    row.chevron.textContent = CHEVRON_EXPANDED;
    row.editorHost.style.display = '';
    const colId = row.el.dataset.colId!;
    void this.api.buildColumnFilterEditor(colId).then((handle) => {
      if (this.destroyed) {
        if (handle) try { handle.destroy(); } catch { /* noop */ }
        return;
      }
      if (row.generation !== myGen || !row.expanded) {
        if (handle) try { handle.destroy(); } catch { /* noop */ }
        return;
      }
      if (!handle) return;
      row.editorHost.appendChild(handle.gui);
      row.editorDestroy = () => handle.destroy();
    }).catch((err) => {
      if (!this.destroyed) console.error('[vg-filters-panel] buildColumnFilterEditor:', err);
    });
  }

  private collapseRowDirect(row: PanelRow): void {
    row.expanded = false;
    row.generation++;
    row.el.dataset.expanded = 'false';
    row.header.setAttribute('aria-expanded', 'false');
    row.chevron.textContent = CHEVRON_COLLAPSED;
    row.editorHost.style.display = 'none';
    if (row.editorDestroy) {
      try { row.editorDestroy(); } catch { /* noop */ }
      row.editorDestroy = null;
    }
    row.editorHost.replaceChildren();
  }

  // ---- refresh ------------------------------------------------------

  /** Diff `state` against the current `rows` map: append new rows for
   *  unseen colIds (those that became filterable), drop rows whose
   *  colId no longer appears OR is no longer filterable, and reorder
   *  DOM children to match `state` order. */
  private syncRows(state: CColumnState[]): void {
    const seen = new Set<string>();
    for (const entry of state) {
      if (!this.api.getColumnFilterType(entry.colId)) continue;
      seen.add(entry.colId);
      let row = this.rows.get(entry.colId);
      if (!row) {
        row = this.buildRow(entry.colId);
        this.rows.set(entry.colId, row);
        this.listEl.appendChild(row.el);
      } else {
        const next = this.resolveLabel(entry.colId);
        if (row.label.textContent !== next) row.label.textContent = next;
      }
    }
    for (const [colId, row] of this.rows) {
      if (!seen.has(colId)) {
        if (row.editorDestroy) {
          try { row.editorDestroy(); } catch { /* noop */ }
        }
        row.el.remove();
        this.rows.delete(colId);
      }
    }
    // Reorder via appendChild — moves existing nodes without destroying
    // them so listeners + editor state survive.
    for (const entry of state) {
      const row = this.rows.get(entry.colId);
      if (row) this.listEl.appendChild(row.el);
    }
    this.updateEmptyState();
  }

  private updateEmptyState(): void {
    if (this.rows.size === 0) {
      if (!this.emptyEl) {
        this.emptyEl = document.createElement('div');
        this.emptyEl.className = 'vg-filters-panel-empty';
        this.emptyEl.textContent = 'No filterable columns';
      }
      if (!this.emptyEl.parentElement) this.listEl.appendChild(this.emptyEl);
    } else if (this.emptyEl?.parentElement) {
      this.emptyEl.parentElement.removeChild(this.emptyEl);
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
}
