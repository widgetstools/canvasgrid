/**
 * Cycle 11 / Task 3 — ColumnsToolPanel (built-in `agColumnsToolPanel`).
 *
 * Mounted by the SideBarHost (Task 2). Reads from `api.getColumnState()`
 * and writes via `api.setColumnsVisible` / `api.moveColumns` so visibility
 * + reorder changes round-trip through the existing column-state surface
 * (Cycle 6). Header names resolve through `api.getColumnHeaderName(colId)`
 * since the public `CColumnState` shape only carries colIds + width / hide /
 * pinned / sort flags.
 *
 * Layout (matches the user reference 2026-06-26 dark-theme target encoded
 * in the worklog Task 3 ASCII):
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
 *   │ ≡  Row Groups                         │  ← suppressRowGroups
 *   │ ┌─ Drag here to set row groups ─┐    │
 *   │ └──────────────────────────────┘     │
 *   ├──────────────────────────────────────┤
 *   │ Σ  Values                             │  ← suppressValues
 *   │ ┌─ Drag here to aggregate ──────┐    │
 *   │ └──────────────────────────────┘     │
 *   └──────────────────────────────────────┘
 *
 * The Pivot Mode toggle ships as a visual stub in Cycle 11 — clicking
 * flips `aria-pressed` but does NOT call any grid API. The real
 * `api.setPivotMode` wiring lands in Cycle 16; for now we log a debug
 * breadcrumb so the path is greppable. The Row Groups + Values drop
 * zones are similarly inert — the data-pipeline wiring for grouping +
 * aggregation lands in Cycle 13.
 *
 * Subscribes to `columnVisible` + `columnMoved` events so external state
 * mutations (e.g. an app calling `applyColumnState`) keep the panel in
 * sync. `suppressSyncLayoutWithGrid: true` opts out of this subscription
 * for apps that drive the panel imperatively via `refreshToolPanel`.
 *
 * `refresh()` walks the existing row list and updates checkbox state +
 * reorders DOM nodes in place to match the new `getColumnState()` order.
 * The root container is never replaced, so scroll position survives a
 * refresh.
 */
import type { CGridApi, CColumnState } from '../../types';
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

export class ColumnsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private api!: CGridApi;
  private params: IToolPanelColumnCompParams = {};

  /** Search input (null when suppressColumnFilter). */
  private searchInput: HTMLInputElement | null = null;
  /** Container for the column rows. */
  private listEl!: HTMLElement;
  /** Per-colId row cache so refresh + reorder don't blow away DOM nodes. */
  private rows = new Map<string, PanelRow>();
  /** Current pivot-mode toggle state (visual stub — flipped on click). */
  private pivotModeActive = false;
  /** Unsubscribe functions returned by `api.addEventListener`. */
  private unsubs: Array<() => void> = [];

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

    if (!this.params.suppressRowGroups) {
      this.root.appendChild(this.buildSection('Row Groups', '☰', 'Drag here to set row groups', 'groups'));
    }
    if (!this.params.suppressValues) {
      this.root.appendChild(this.buildSection('Values', 'Σ', 'Drag here to aggregate', 'values'));
    }

    if (!this.params.suppressSyncLayoutWithGrid) {
      const offVisible = this.api.addEventListener('columnVisible', () => this.refresh());
      const offMoved = this.api.addEventListener('columnMoved', () => this.refresh());
      this.unsubs.push(offVisible, offMoved);
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
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.rows.clear();
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

    const icon = document.createElement('span');
    icon.className = 'cg-columns-panel-search-icon';
    icon.textContent = '\u{1F50D}'; // 🔍
    icon.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search...';
    input.setAttribute('aria-label', 'Search columns');
    input.addEventListener('input', () => this.applySearchFilter(input.value));

    row.appendChild(icon);
    row.appendChild(input);
    this.searchInput = input;
    return row;
  }

  private buildSection(title: string, icon: string, placeholder: string, dataKind: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'cg-columns-panel-section';
    section.dataset.kind = dataKind;

    const header = document.createElement('div');
    header.className = `cg-columns-panel-section-header cg-columns-panel-section-header--${dataKind}`;
    // The section icon ships via a CSS `::before` rule reading
    // `data-icon` so the header's `textContent` returns just the title
    // (tests trim + compare against e.g. 'Row Groups' without having to
    // strip the leading glyph).
    header.dataset.icon = icon;
    header.textContent = title;

    const dropZone = document.createElement('div');
    dropZone.className = 'cg-columns-panel-drop-zone';
    dropZone.textContent = placeholder;
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const tag = dataKind === 'groups' ? '[groups] drop' : '[values] drop';
      const cycle = dataKind === 'groups' ? '13' : '13';
      console.debug(`${tag} (stub — wired in Cycle ${cycle})`);
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

  // ---- drag-within-list reorder -------------------------------------

  /** Drag-within-the-panel reorder. The drag-INTO-grid behaviour from
   *  `allowDragFromColumnsToolPanel` (ag-grid Enterprise) lands in
   *  Cycle 13 once the rowgroup data path is wired. */
  private beginRowDrag(e: MouseEvent, colId: string): void {
    e.preventDefault();
    const row = this.rows.get(colId);
    if (!row) return;
    row.el.classList.add('cg-columns-panel-row--dragging');

    const orderedColIds = (): string[] => Array.from(this.listEl.children)
      .map((c) => (c as HTMLElement).dataset.colId)
      .filter((id): id is string => typeof id === 'string');

    const onMove = (ev: MouseEvent) => {
      const list = orderedColIds();
      const fromIdx = list.indexOf(colId);
      const rect = this.listEl.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      // Compute the target index by walking siblings and finding the first
      // one whose midpoint is below the pointer.
      const children = Array.from(this.listEl.children) as HTMLElement[];
      if (children.length === 0) return;
      let toIdx = children.length - 1;
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        const r = child.getBoundingClientRect();
        const mid = r.top + r.height / 2 - rect.top;
        if (y < mid) {
          toIdx = i;
          break;
        }
      }
      if (toIdx === fromIdx) return;
      // Move the DOM node optimistically; final commit on mouseup.
      const moving = row.el;
      const ref = children[toIdx]!;
      if (toIdx > fromIdx) {
        // Inserting after `ref` because the moving node currently occupies
        // an earlier slot — DOM convention: insert before ref.nextSibling.
        ref.parentElement?.insertBefore(moving, ref.nextSibling);
      } else {
        ref.parentElement?.insertBefore(moving, ref);
      }
    };

    const onUp = () => {
      row.el.classList.remove('cg-columns-panel-row--dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const list = orderedColIds();
      const finalIdx = list.indexOf(colId);
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
}
