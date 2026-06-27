/**
 * Cycle 13 / Task 1 — status-bar surface types.
 *
 * The status bar is a horizontal strip pinned to the bottom (or top) edge of
 * the grid that hosts one or more status panels in three zones (left /
 * center / right). It mirrors ag-grid's `IStatusPanelComp` lifecycle so
 * panels written against ag-grid's contract port unchanged: `init(params)`
 * once at mount, `getGui()` returns the panel root, `refresh()` re-renders
 * from current state, `destroy()` tears down listeners + DOM.
 *
 * Built-in panel keys (`agTotalRowCountComponent`,
 * `agFilteredRowCountComponent`, `agSelectedRowCountComponent`,
 * `agTotalAndFilteredRowCountComponent`, `agAggregationComponent`) land in
 * Tasks 2 + 3; Task 1 ships the host scaffold + the type surface so apps
 * can stub out custom panels against the same contract.
 */

/** Params handed to every `IStatusPanelComp.init`. `api` is typed `unknown`
 *  here to avoid a circular dep with `CGridApi`; panels cast to `CGridApi`
 *  inside their own implementation. `statusPanelParams` carries the
 *  app-supplied `StatusPanelDef.statusPanelParams` verbatim. */
export interface StatusPanelParams<TGrid = unknown> {
  api: TGrid;
  statusPanelParams?: Record<string, unknown>;
}

/** Minimal lifecycle a status-panel component must implement. Mirrors
 *  ag-grid's `IStatusPanelComp` contract verbatim. */
export interface IStatusPanelComp {
  /** One-shot setup. Receives params; SHOULD NOT yet append to the DOM —
   *  `getGui()` returns the root for the host to mount. */
  init(params: StatusPanelParams): void;
  /** The panel's root element. Stable for the lifetime of the instance;
   *  the host mounts it once and never re-queries. */
  getGui(): HTMLElement;
  /** Re-render from current grid state. Called when the host fans out a
   *  batched refresh (Task 5) or when a panel-internal subscription
   *  triggers it. */
  refresh(): void;
  /** Tear down listeners + DOM. */
  destroy(): void;
}

/** Alias kept for ag-grid parity — apps may import either name. */
export type IStatusPanel = IStatusPanelComp;

/** Zero-arg constructor — the host calls `new Ctor()` then `init(params)`.
 *  Matches the ToolPanelComponent shape so panels register through the same
 *  `CGridOptions.components` channel. */
export type StatusPanelComponent = new () => IStatusPanelComp;

/** Where to mount a status panel inside the bar. Defaults to `'right'` when
 *  unset on the def, matching the screenshot's right-loaded layout. */
export type StatusPanelAlign = 'left' | 'center' | 'right';

/** Which edge of the grid the bar mounts on. `'bottom'` is the canonical
 *  position; `'top'` exists so an app that already owns a chrome bar above
 *  the grid can re-home the status strip without forking the host. */
export type StatusBarPosition = 'top' | 'bottom';

/** Single status-panel definition inside `StatusBarDef.statusPanels`.
 *  Mirrors the catalog `StatusPanelDef` table
 *  (`docs/catalog/18-status-bar.md`). */
export interface StatusPanelDef {
  /** Unique identifier used by API methods (`getStatusPanel(key)`). Apps
   *  pick this; the built-ins use the ag-grid-compatible component string
   *  as their key by default. */
  key: string;
  /** Component string name. Built-ins:
   *  `'agTotalRowCountComponent'`, `'agFilteredRowCountComponent'`,
   *  `'agSelectedRowCountComponent'`,
   *  `'agTotalAndFilteredRowCountComponent'`, `'agAggregationComponent'`
   *  (Tasks 2 + 3). Custom panels resolve via `CGridOptions.components`. */
  statusPanel: string;
  /** Which zone this panel mounts into. Default `'right'`. */
  align?: StatusPanelAlign;
  /** Forwarded verbatim to the panel's `init({ statusPanelParams })`. */
  statusPanelParams?: Record<string, unknown>;
}

/** Status bar configuration. Apps pass this via `CGridOptions.statusBar`. */
export interface StatusBarDef {
  /** Panel definitions in declaration order. Multiple panels in the same
   *  zone stack horizontally in this order. */
  statusPanels: StatusPanelDef[];
  /** Edge to mount on. Defaults to `'bottom'`. */
  position?: StatusBarPosition;
  /** When `true`, the bar mounts hidden (`display: none`) and reserves
   *  zero canvas inset. `setStatusBarVisible(true)` shows it later. */
  hiddenByDefault?: boolean;
}
