/**
 * Cycle 11 / Task 1 — tool-panel interface + side-bar type surface.
 *
 * The `ToolPanel` interface mirrors ag-grid's `IToolPanelComp` lifecycle:
 * `init(params)` once at mount, `getGui()` returns the root DOM element
 * (stable for the lifetime of the instance), `refresh()` re-renders from
 * current grid state, `destroy()` tears down listeners + DOM.
 *
 * Built-in IDs `'agColumnsToolPanel'` (Task 3) and `'agFiltersToolPanel'`
 * (Task 4) are pre-registered with stub implementations in Task 1; apps
 * register custom panels via `VelocityGridOptions.components`.
 *
 * The `SideBarDef` / `ToolPanelDef` shapes mirror the catalog
 * (`docs/catalog/17-side-bar-and-tool-panels.md`). Param shapes
 * `IToolPanelColumnCompParams` + `IToolPanelFiltersCompParams` carry
 * the `suppress*` flags consumed by the built-in panels.
 */

/** Params handed to every `ToolPanel.init`. `api` is typed `unknown` here
 *  to avoid a circular dep with `VelocityGridApi`; panels cast to `VelocityGridApi`
 *  inside their own implementation. `toolPanelParams` carries the
 *  app-supplied `ToolPanelDef.toolPanelParams` verbatim. */
export interface ToolPanelParams<TGrid = unknown> {
  api: TGrid;
  toolPanelParams?: Record<string, unknown>;
}

/** Minimal lifecycle a tool-panel component must implement. */
export interface ToolPanel {
  /** One-shot setup. Receives params; SHOULD NOT yet append to the DOM —
   *  `getGui()` returns the root for the host to mount. */
  init(params: ToolPanelParams): void;
  /** The panel's root element. Stable for the lifetime of the instance;
   *  the host mounts it once and never re-queries. */
  getGui(): HTMLElement;
  /** Re-render from current grid state. Called when the host fires
   *  `refreshToolPanel(id)` or when underlying state changes
   *  (column model, filter model). */
  refresh(): void;
  /** Tear down listeners + DOM. */
  destroy(): void;
}

/** Zero-arg constructor — the host calls `new Ctor()` then `init(params)`.
 *  Matches ag-grid's component-registry shape (params arrive via `init`,
 *  not the constructor). */
export type ToolPanelComponent = new () => ToolPanel;

/** Single tool-panel definition inside `SideBarDef.toolPanels`. Mirrors
 *  the catalog `ToolPanelDef` table (17-side-bar-and-tool-panels.md). */
export interface ToolPanelDef {
  /** Unique identifier used by API methods + events. */
  id: string;
  /** Default label shown on the side-bar tab. */
  labelDefault: string;
  /** Locale key for a translated label. Optional — Task 1 ships
   *  English-only; localisation is a follow-up cycle. */
  labelKey?: string;
  /** Icon identifier for the tab button (e.g. `'columns'`, `'filter'`). */
  iconKey?: string;
  /** Component string name. Built-ins: `'agColumnsToolPanel'`,
   *  `'agFiltersToolPanel'`. Custom panels resolve via
   *  `VelocityGridOptions.components`. */
  toolPanel: string;
  /** Forwarded verbatim to the tool panel's `init({ toolPanelParams })`. */
  toolPanelParams?: Record<string, unknown>;
  minWidth?: number;
  maxWidth?: number;
  width?: number;
}

/** Side bar configuration. Apps pass this via `VelocityGridOptions.sideBar`
 *  starting in Task 2; Task 1 only ships the type. */
export interface SideBarDef {
  toolPanels: (ToolPanelDef | string)[];
  defaultToolPanel?: string;
  hiddenByDefault?: boolean;
  position?: 'left' | 'right';
  hideButtons?: boolean;
}

/** Params for the built-in Columns tool panel (Task 3). The seven
 *  `suppress*` flags + `contractColumnSelection` mirror the catalog's
 *  `IToolPanelColumnCompParams` table verbatim. */
export interface IToolPanelColumnCompParams {
  suppressColumnMove?: boolean;
  suppressRowGroups?: boolean;
  suppressValues?: boolean;
  suppressPivots?: boolean;
  suppressPivotMode?: boolean;
  suppressColumnFilter?: boolean;
  suppressColumnSelectAll?: boolean;
  suppressColumnExpandAll?: boolean;
  contractColumnSelection?: boolean;
  suppressSyncLayoutWithGrid?: boolean;
  buttons?: ('apply' | 'cancel')[];
}

/** Params for the built-in Filters tool panel (Task 4). Mirrors the
 *  catalog's `IToolPanelFiltersCompParams` table. */
export interface IToolPanelFiltersCompParams {
  suppressExpandAll?: boolean;
  suppressFilterSearch?: boolean;
  suppressSyncLayoutWithGrid?: boolean;
}
