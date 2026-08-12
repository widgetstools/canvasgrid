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
 * Cycle 19 / Task 7 — the panel is now a thin shell that composes 4
 * sub-panels + a small Pivot Mode toggle:
 *
 *   ┌──────────────────────────────────────┐
 *   │ ⬤━━━━  Pivot Mode                     │  ← suppressPivotMode
 *   ├──────────────────────────────────────┤
 *   │ ColumnVisibilityPanel                 │  Search + Select All +
 *   │  🔍  Search...                        │  column rows + row drag
 *   │  ☑  ⋮⋮⋮  Athlete                      │
 *   │  ☑  ⋮⋮⋮  Age                          │
 *   │  …                                    │
 *   ├──────────────────────────────────────┤
 *   │ RowGroupsZonePanel                    │  ← suppressRowGroups
 *   │  ☰  Row Groups                        │
 *   │  ┌─ Country ✕ ────────────────────┐  │
 *   │  └─ Drag here to set row groups ──┘  │
 *   ├──────────────────────────────────────┤
 *   │ ValuesZonePanel                       │  ← suppressValues
 *   │  Σ  Values                            │
 *   │  ┌─ sum(Gold) ✕ ───────────────────┐  │
 *   │  └─ Drag here to aggregate ───────┘  │
 *   ├──────────────────────────────────────┤
 *   │ PivotColumnsZonePanel                 │  ← suppressPivots
 *   │  ▥  Column Labels                     │    (hidden when
 *   │  ┌─ Sport   ✕ ───────────────────┐   │     pivotMode is OFF)
 *   │  └─ Drag here to set column labels ┘  │
 *   └──────────────────────────────────────┘
 *
 * Each sub-panel owns its own DOM + event subscription (see
 * `./columns/*.ts`); the shell just wires them together. `refresh()` +
 * `destroy()` fan out to every mounted sub-panel.
 *
 * Section order (top → bottom, AG-Grid parity — rows → values → columns):
 *   Row Groups → Values → Column Labels
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-18-pivoting-design.md
 *   § Task 7 — Pivot panel in side bar (Cycle 11 tool panel extension).
 */
import type { VelocityGridApi } from '../../types';
import type {
  IToolPanelColumnCompParams,
  ToolPanel,
  ToolPanelParams,
} from './types';
import { ColumnVisibilityPanel } from './columns/visibilityPanel';
import { RowGroupsZonePanel } from './columns/rowGroupsZonePanel';
import { PivotColumnsZonePanel } from './columns/pivotColumnsZonePanel';
import { ValuesZonePanel } from './columns/valuesZonePanel';
import type { DropZoneSpec } from './columns/shared';

export class ColumnsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private api!: VelocityGridApi;
  private params: IToolPanelColumnCompParams = {};
  private pivotModeBtn: HTMLButtonElement | null = null;
  private visibilityPanel: ColumnVisibilityPanel | null = null;
  private rowGroupsPanel: RowGroupsZonePanel | null = null;
  private pivotColumnsPanel: PivotColumnsZonePanel | null = null;
  private valuesPanel: ValuesZonePanel | null = null;
  private readonly unsubs: Array<() => void> = [];

  init(p: ToolPanelParams): void {
    this.api = p.api as VelocityGridApi;
    this.params = (p.toolPanelParams as IToolPanelColumnCompParams | undefined) ?? {};

    this.root = document.createElement('div');
    this.root.className = 'vg-columns-panel';

    if (!this.params.suppressPivotMode) {
      this.root.appendChild(this.buildPivotModeRow());
    }

    // Visibility panel (search + select-all + column rows + row drag).
    // The row-drag orchestrator needs zone specs from the 3 zone panels
    // — we pass a live accessor so whichever zones the shell mounts
    // participate in the drag hit-test.
    this.visibilityPanel = new ColumnVisibilityPanel({
      api: this.api,
      params: this.params,
      resolveLabel: (colId) => this.resolveLabel(colId),
      rootHost: this.root,
      isColumnRowGroupable: (colId) => this.api.isColumnRowGroupEnabled?.(colId) === true,
      isColumnPivotable: (colId) => this.api.isColumnPivotEnabled?.(colId) === true,
      isColumnValueable: (colId) => this.api.isColumnValueEnabled?.(colId) === true,
      getDropZoneSpecs: () => this.currentDropZoneSpecs(),
    });
    // Append the search row + list DIRECTLY to `.vg-columns-panel` so
    // the CSS flex chain (`.vg-columns-panel-list` claims the remaining
    // vertical space) works unchanged. Wrapping in an intermediary
    // container would collapse the list.
    this.visibilityPanel.appendTo(this.root);

    // Zone panels — order (Cycle 18 / Task 9 follow-up, AG-Grid parity):
    //   Row Groups → Values → Column Labels
    if (!this.params.suppressRowGroups) {
      this.rowGroupsPanel = new RowGroupsZonePanel({
        api: this.api,
        resolveLabel: (colId) => this.resolveLabel(colId),
        rootHost: this.root,
        isColumnRowGroupable: (colId) => this.api.isColumnRowGroupEnabled?.(colId) === true,
      });
      this.root.appendChild(this.rowGroupsPanel.getGui());
    }
    if (!this.params.suppressValues) {
      this.valuesPanel = new ValuesZonePanel({
        api: this.api,
        resolveLabel: (colId) => this.resolveLabel(colId),
        rootHost: this.root,
        isColumnValueable: (colId) => this.api.isColumnValueEnabled?.(colId) === true,
      });
      this.root.appendChild(this.valuesPanel.getGui());
    }
    // Cycle 21i / Phase 1 (user directive, revised) — the Column Labels
    // zone lives in the side panel (below Values) AND in the top pivot
    // strip's split-right half. Both surfaces accept column-label drags.
    if (!this.params.suppressPivots) {
      this.pivotColumnsPanel = new PivotColumnsZonePanel({
        api: this.api,
        resolveLabel: (colId) => this.resolveLabel(colId),
        rootHost: this.root,
        isColumnPivotable: (colId) => this.api.isColumnPivotEnabled?.(colId) === true,
      });
      this.root.appendChild(this.pivotColumnsPanel.getGui());
    }

    // Pivot state subscription: keep the Pivot Mode toggle's aria state
    // in sync with any external mutation. Every zone panel already
    // subscribes on its own; this listener only touches the button.
    if (this.pivotModeBtn) {
      this.unsubs.push(
        this.api.addEventListener('pivotStateChanged', (e) => {
          if (this.pivotModeBtn) {
            this.pivotModeBtn.setAttribute('aria-pressed', String(e.pivotMode));
          }
        }),
      );
    }
  }

  getGui(): HTMLElement {
    return this.root;
  }

  refresh(): void {
    this.visibilityPanel?.refresh();
    this.rowGroupsPanel?.refresh();
    this.pivotColumnsPanel?.refresh();
    this.valuesPanel?.refresh();
  }

  destroy(): void {
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.visibilityPanel?.destroy();
    this.rowGroupsPanel?.destroy();
    this.pivotColumnsPanel?.destroy();
    this.valuesPanel?.destroy();
    this.visibilityPanel = null;
    this.rowGroupsPanel = null;
    this.pivotColumnsPanel = null;
    this.valuesPanel = null;
    this.pivotModeBtn = null;
    this.root.parentElement?.removeChild(this.root);
  }

  // ── Shell helpers ──────────────────────────────────────────────────

  private buildPivotModeRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vg-columns-panel-pivot-mode';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vg-columns-panel-toggle';
    const initial = this.api.isPivotMode?.() === true;
    btn.setAttribute('aria-pressed', String(initial));
    btn.setAttribute('aria-label', 'Pivot Mode');
    const knob = document.createElement('span');
    knob.className = 'vg-columns-panel-toggle-knob';
    btn.appendChild(knob);
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      // Optimistic flip — the pivotStateChanged subscription confirms
      // the aria state on the next tick, which is a no-op when the api
      // accepted the mutation.
      btn.setAttribute('aria-pressed', String(next));
      // Cycle 21i — a user-driven mode switch discards the current
      // grouping / pivot / sort / filter and resets column selection for
      // the target mode (clean slate). Programmatic setPivotMode keeps its
      // config.
      this.api.setPivotMode?.(next, { discardSettings: true });
    });
    this.pivotModeBtn = btn;
    const label = document.createElement('span');
    label.className = 'vg-columns-panel-pivot-mode-label';
    label.textContent = 'Pivot Mode';
    row.appendChild(btn);
    row.appendChild(label);
    return row;
  }

  private resolveLabel(colId: string): string {
    const headerName = this.api.getColumnHeaderName?.(colId);
    return (headerName && headerName.length > 0) ? headerName : colId;
  }

  /** Snapshot of the currently-mounted drop-zone specs, in the AG-Grid
   *  hit-test priority order (pivot → values → row groups). Rebuilt on
   *  every row-drag so a suppress-flag flip between drags participates
   *  cleanly. */
  private currentDropZoneSpecs(): DropZoneSpec[] {
    const specs: DropZoneSpec[] = [];
    if (this.pivotColumnsPanel) specs.push(this.pivotColumnsPanel.getDropZoneSpec());
    if (this.valuesPanel) specs.push(this.valuesPanel.getDropZoneSpec());
    if (this.rowGroupsPanel) specs.push(this.rowGroupsPanel.getDropZoneSpec());
    return specs;
  }
}
