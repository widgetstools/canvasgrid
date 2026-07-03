// Cycle 19 / Task 7 — column visibility sub-panel.
//
// Owns the top of the columns tool panel: Search input + Select All
// checkbox + the scrollable Column Rows list. Each row is one column
// with a checkbox (visibility OFF pivot mode, role membership under
// pivot mode) + drag handle. The row-drag orchestrator routes into:
//   1. The row group panel top strip (external router).
//   2. The pivot panel top strip (external router).
//   3. The column-header band (external router).
//   4. The three in-panel drop zones (pivot → values → row groups).
//   5. Fallback → in-list reorder via `api.moveColumns`.

import type { CGridApi, CColumnState } from '../../../types';
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

/** Per-row DOM handles cached for in-place refresh. */
interface PanelRow {
  el: HTMLElement;
  checkbox: HTMLInputElement;
  label: HTMLElement;
}

/** Deps threaded into `ColumnVisibilityPanel`. The zone-spec provider
 *  lets the row-drag orchestrator route into whatever zones the shell
 *  currently has mounted (row groups / column labels / values). */
export interface ColumnVisibilityPanelDeps {
  api: CGridApi;
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

  constructor(deps: ColumnVisibilityPanelDeps) {
    this.deps = deps;
    // The shell appends the search row + list DIRECTLY to
    // `.cg-columns-panel` so the CSS flex layout — `.cg-columns-panel`
    // is column-flex; `.cg-columns-panel-list` claims the remaining
    // vertical space via `flex: 2 1 0` so the zone sections pin to the
    // bottom — works unchanged. Wrapping search + list in an extra
    // container breaks that flex chain (the wrapper would default to
    // `flex: 0 0 auto` and collapse the list).
    this.searchRow = deps.params.suppressColumnFilter ? null : this.buildSearchRow();
    this.listEl = document.createElement('div');
    this.listEl.className = 'cg-columns-panel-list';
    this.buildRows();
    this.syncSelectAll();

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
   *  `.cg-columns-panel` root so the CSS flex chain reaches the list. */
  appendTo(root: HTMLElement): void {
    if (this.searchRow) root.appendChild(this.searchRow);
    root.appendChild(this.listEl);
  }
  getListEl(): HTMLElement { return this.listEl; }
  getSearchInput(): HTMLInputElement | null { return this.searchInput; }

  refresh(): void {
    const state = this.deps.api.getColumnState();
    this.syncRows(state);
    this.applySearchFilter(this.searchInput?.value ?? '');
    this.syncSelectAll();
    this.refreshRowChecks();
  }

  destroy(): void {
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.rows.clear();
  }

  // ── Search + Select-All ────────────────────────────────────────────

  private buildSearchRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cg-columns-panel-search';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'cg-columns-panel-select-all';
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

  /** Update the "Select All" checkbox to reflect current column
   *  visibility. Reads directly from the row checkbox DOM so it's
   *  always consistent with what the list rows show. */
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

  // ── Column rows ────────────────────────────────────────────────────

  private buildRows(): void {
    const state = this.deps.api.getColumnState();
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

    // Cycle 21i / Phase 1 — row layout is grip → label → checkbox (right),
    // moving away from the AG-style checkbox-left row. The checkbox stays a
    // native <input> (restyled via appearance:none) so the refresh /
    // select-all logic that reads `.checked` is unchanged.
    if (!this.deps.params.suppressColumnMove) {
      const handle = document.createElement('span');
      handle.className = 'cg-columns-panel-row-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('mousedown', (e) => this.beginRowDrag(e, entry.colId));
      el.appendChild(handle);
    }

    const label = document.createElement('span');
    label.className = 'cg-columns-panel-row-label';
    label.textContent = this.deps.resolveLabel(entry.colId);
    el.appendChild(label);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cg-columns-panel-row-checkbox';
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
      if (target === checkbox || target.classList.contains('cg-columns-panel-row-handle')) return;
      checkbox.checked = !checkbox.checked;
      this.handleRowCheckboxClick(entry.colId, checkbox);
    });

    return { el, checkbox, label };
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
   *  checkbox. Called when pivotMode flips or any role assignment
   *  changes. */
  private refreshRowChecks(): void {
    const state = this.deps.api.getColumnState();
    const byId = new Map(state.map((s) => [s.colId, s]));
    for (const [colId, row] of this.rows) {
      const entry = byId.get(colId);
      if (!entry) continue;
      const next = this.computeRowChecked(entry);
      if (row.checkbox.checked !== next) row.checkbox.checked = next;
    }
    this.syncSelectAll();
  }

  /** Diff `state` against the current `rows` map: update existing rows
   *  in place, append new rows for unseen colIds, drop rows whose colId
   *  no longer appears, and reorder DOM children to match `state`. */
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
        const next = this.deps.resolveLabel(entry.colId);
        if (row.label.textContent !== next) row.label.textContent = next;
      }
    }
    for (const [colId, row] of this.rows) {
      if (!seen.has(colId)) {
        row.el.remove();
        this.rows.delete(colId);
      }
    }
    // Reorder: appendChild moves existing nodes without destroying them,
    // so listeners + checkbox state survive.
    for (const entry of state) {
      const row = this.rows.get(entry.colId);
      if (row) this.listEl.appendChild(row.el);
    }
  }

  // ── Search filter ──────────────────────────────────────────────────

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

  // ── Row drag orchestrator ──────────────────────────────────────────

  /** Drag-within-the-panel reorder with ag-grid–style drag UX, AND
   *  drag-INTO any of the three drop zones (Column Labels / Values /
   *  Row Groups). Cycle 18 / Task 5 generalises the routing across all
   *  three; the row group panel + pivot panel top strips are also
   *  valid drop targets when the app carries the router methods. */
  private beginRowDrag(e: MouseEvent, colId: string): void {
    e.preventDefault();
    const row = this.rows.get(colId);
    if (!row) return;

    const label = this.deps.resolveLabel(colId);
    const startX = e.clientX;
    const startY = e.clientY;
    const api = this.deps.api;
    const listEl = this.listEl;

    const allowDragOut = api.getGridOption?.('allowDragFromColumnsToolPanel') !== false;
    // Header-strip routing only makes sense for role-eligible columns.
    const isGroupable = api.isColumnRowGroupEnabled?.(colId) ?? false;
    const alreadyGrouped = (api.getRowGroupColumns?.() ?? []).includes(colId);
    const isPivotable = api.isColumnPivotEnabled?.(colId) ?? false;
    const alreadyPivoted = (api.getPivotColumns?.() ?? []).includes(colId);

    const orderedColIds = (): string[] => Array.from(listEl.children)
      .map((c) => (c as HTMLElement).dataset.colId)
      .filter((id): id is string => typeof id === 'string');

    const zoneSpecs = allowDragOut ? this.deps.getDropZoneSpecs() : [];

    let dragStarted = false;
    let overZoneIdx = -1;
    let overHeaderStrip = false;
    let overPivotStrip = false;
    let overColumnHeaderBand = false;

    // Column-header drop router — parallel to the row-group-panel router.
    const hasColHeaderDropRouter =
      typeof (api as any).isPointInColumnHeaderBand === 'function'
      && typeof (api as any).setColumnHeaderDragHover === 'function'
      && typeof (api as any).commitColumnHeaderDrop === 'function';

    const ghost = makeDragGhost(this.deps.rootHost, label);

    // ---- Shared row-group-panel router ----
    const router = api as unknown as import('../../features/columnDrag').RowGroupPanelDragRouter;
    const hasRouter =
      typeof (api as any).isPointInRowGroupPanel === 'function'
      && typeof (api as any).setRowGroupPanelDragHover === 'function'
      && typeof (api as any).commitRowGroupPanelDrop === 'function';

    // ---- Shared pivot-panel router (Column Labels top strip) ----
    const pivotRouter = api as unknown as import('../../features/columnDrag').PivotPanelDragRouter;
    const hasPivotRouter =
      typeof (api as any).isPointInPivotPanel === 'function'
      && typeof (api as any).setPivotPanelDragHover === 'function'
      && typeof (api as any).commitPivotPanelDrop === 'function';

    const clearAllZoneOutlines = (): void => {
      for (let i = 0; i < zoneSpecs.length; i++) {
        setZoneDropState(zoneSpecs[i]!.dropZone, null);
      }
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragStarted) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragStarted = true;
        row.el.classList.add('cg-columns-panel-row--lifted');
        ghost.mount(ev.clientX, ev.clientY);
      }

      ghost.position(ev.clientX, ev.clientY);

      // 1. Row group HEADER STRIP — outside the sidebar.
      if (hasRouter && allowDragOut && isGroupable && !alreadyGrouped) {
        const inStrip = routeExternalDragHover(router, colId, ev.clientX, ev.clientY);
        if (inStrip !== overHeaderStrip) {
          overHeaderStrip = inStrip;
          if (inStrip) {
            clearAllZoneOutlines();
            overZoneIdx = -1;
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
        const inStrip = routePivotPanelDragHover(pivotRouter, colId, ev.clientX, ev.clientY);
        if (inStrip !== overPivotStrip) {
          overPivotStrip = inStrip;
          if (inStrip) {
            clearAllZoneOutlines();
            overZoneIdx = -1;
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
          }
        }
        if (inHeaderBand) {
          (api as any).setColumnHeaderDragHover(colId, ev.clientX, ev.clientY);
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
            setZoneDropState(spec.dropZone, spec.accepts(colId) ? 'accept' : 'reject');
          }
        }
      }

      if (overZoneIdx >= 0) return;

      // 4. Otherwise — optimistic list reorder.
      const rect = listEl.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const children = Array.from(listEl.children) as HTMLElement[];
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
      ghost.remove();
      if (hasRouter) clearExternalDragHover(router);
      if (hasPivotRouter) clearPivotPanelDragHover(pivotRouter);
      if (hasColHeaderDropRouter) {
        (api as any).setColumnHeaderDragHover(null, ev.clientX, ev.clientY);
      }
      if (!dragStarted) return;

      if (overHeaderStrip) {
        (api as any).commitRowGroupPanelDrop?.(colId);
        clearAllZoneOutlines();
        return;
      }
      if (overPivotStrip) {
        (api as any).commitPivotPanelDrop?.(colId);
        clearAllZoneOutlines();
        return;
      }
      if (overColumnHeaderBand) {
        (api as any).commitColumnHeaderDrop(colId, ev.clientX);
        clearAllZoneOutlines();
        return;
      }

      // In-panel zone release.
      clearAllZoneOutlines();
      if (allowDragOut && zoneSpecs.length > 0) {
        for (const spec of zoneSpecs) {
          if (isPointInRect(getZoneRect(spec.dropZone), ev.clientX, ev.clientY)) {
            if (spec.accepts(colId)) spec.commit(colId);
            return;
          }
        }
      }

      // Otherwise it's a list reorder.
      const finalIdx = orderedColIds().indexOf(colId);
      if (finalIdx >= 0) {
        try {
          api.moveColumns([colId], finalIdx);
        } catch (err) {
          console.error('[cg-columns-panel] moveColumns failed', err);
        }
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
}
