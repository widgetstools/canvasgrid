# 08 — general-settings

> ~80 grid-level options surfaced through a settings panel. Mostly a config carrier — minimal runtime behavior.

## Purpose

Give users one place to tune the grid's global behavior: row height, pagination, selection mode, sort/filter defaults, edit triggers, virtualization, tooltips, etc. Most settings map 1:1 to AG-Grid `GridOptions` or `defaultColDef` fields.

## Config schema (abbreviated — full type is large)

Organized in tiers for UI layout:

```ts
interface GeneralSettingsState {
  // Tier 1: Essentials
  gridDensity: 'ultra' | 'compact' | 'comfort';   // drives spacing + font-size via DS adapter
  rowHeight: number;
  headerHeight: number;
  pagination: boolean;
  paginationPageSize: number;
  paginationAutoPageSize: boolean;
  rowSelection: 'singleRow' | 'multiRow' | undefined;
  checkboxSelection: boolean;
  cellSelection: boolean;
  rowDragging: boolean;
  animateRows: boolean;
  cellFlashDuration: number;
  cellFadeDuration: number;
  cellChangeFlashColor: FlashColor;                // imported from conditional-styling
  quickFilterText: string;

  // Tier 2: Grouping & Pivoting
  groupDisplayType: 'singleColumn' | 'multipleColumns' | 'groupRows' | 'custom';
  rowGroupPanelShow: 'always' | 'onlyWhenGrouping' | 'never';
  pivotPanelShow: 'always' | 'onlyWhenPivoting' | 'never';
  grandTotalRow: 'top' | 'bottom' | undefined;
  groupTotalRow: 'top' | 'bottom' | undefined;
  groupHideOpenParents: boolean;
  showOpenedGroup: boolean;
  groupHideColumnsUntilExpanded: boolean;
  groupMaintainOrder: boolean;
  suppressGroupRowsSticky: boolean;
  refreshAfterGroupEdit: boolean;

  // Tier 3: Filtering & Sorting
  enableAdvancedFilter: boolean;
  accentedSort: boolean;
  multiSortMode: 'replace' | 'shift' | 'ctrl' | 'always';  // surfaces 3 AG flags as one radio

  // Tier 4: Editing & Interaction
  singleClickEdit: boolean;
  undoRedoCellEditing: boolean;
  enterNavigation: 'default' | 'always' | 'afterEdit' | 'both';  // combines 2 flags into 1 radio
  tooltipShowDelay: number;
  tooltipShowMode: 'standard' | 'whenTruncated';

  // Tier 5: Styling
  suppressRowHoverHighlight: boolean;
  columnHoverHighlight: boolean;
  headerCaseUppercase: boolean;
  showCellTooltips: boolean;

  // DefaultColDef — merged into gridOptions.defaultColDef
  defaultResizable: boolean;
  defaultSortable: boolean;
  defaultFilterable: boolean;
  floatingFilter: boolean;
  defaultMinWidth: number;
  defaultWidth: number;
  defaultFlex: number | undefined;
  wrapHeaderText: boolean;
  autoHeaderHeight: boolean;
  suppressHeaderMenuButton: boolean;
  suppressMovable: boolean;
  lockPosition: boolean;
  lockVisible: boolean;
  lockPinned: boolean;
  wrapText: boolean;
  autoHeight: boolean;
  enableCellChangeFlash: boolean;
  enableRowGroup: boolean;
  enablePivot: boolean;
  enableValue: boolean;
  defaultAggFunc: string | undefined;

  // Side Bar & Status Bar
  sideBar: boolean;
  sideBarShowColumns: boolean;
  sideBarShowFilters: boolean;
  sideBarDefaultPanel: 'columns' | 'filters' | undefined;
  statusBar: boolean;
  statusBarShowTotalAndFilteredCount: boolean;
  // ...

  // Performance (many initial-only)
  rowBuffer: number;
  suppressScrollOnNewData: boolean;
  pauseUpdatesWhenHidden: boolean;
  suppressColumnVirtualisation: boolean;
  suppressRowVirtualisation: boolean;
  suppressMaxRenderedRowRestriction: boolean;
}
```

## Runtime behavior

- Most fields are read at grid init and spread into `GridOptions` + `defaultColDef`.
- Live-edit paths: row buffer, pause on hidden, scroll debounce, quick filter text update without grid recreate.
- A few derived mappings:
  - `multiSortMode` → 3 underlying AG flags: `suppressMultiSort` / `alwaysMultiSort` / `multiSortKey`
  - `enterNavigation` → 2 underlying flags: `enterNavigatesVertically` + `enterNavigatesVerticallyAfterEdit`
  - `gridDensity` → spacing + row-heights + font-sizes via design-system adapter

## Schema migration

Loading old snapshots (schemaVersion 1 → 2): missing fields filled from `INITIAL_GENERAL_SETTINGS`. New fields default to safe values. No destructive migrations.

## UI surface

Host renders:
- Settings panel with nested tabs per tier (Essential, Grouping, Filtering, Editing, Styling, DefaultColDef, Sidebar, Performance)
- Quick toggles in formatter toolbar (pagination, cell selection, row dragging)
- Density picker affects whole-grid feel
- Live preview where possible (most settings hot-reload without grid recreate; some require restart — flag those)

## Persistence

Whole state per-profile. Migration logic auto-fills new fields.

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/general-settings/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/general-settings/state.ts)

## Design decisions worth copying

- **Tier-based organization.** 80 fields are unusable as a flat list. Group by concern; UI lays them out with visual hierarchy. Don't expose every flag — pick the ~20 that matter and hide the rest behind "Advanced".
- **Composite radios over flag combinations.** `multiSortMode` and `enterNavigation` collapse cross-products of underlying flags into single-choice radios. Way less confusing.
- **Density preset.** Single user choice (`ultra`/`compact`/`comfort`) drives heights + spacing + fonts. Override individual settings after.
- **DefaultColDef as config.** Most settings apply per-grid; per-column tweaks happen in column-customization. Don't expose every default to per-column override; let the global setting be authoritative.

## cgrid translation

The 80-field schema is AG-Grid–shaped. For cgrid we should:

1. **Audit cgrid's runtime options.** Most fields here have a cgrid equivalent in [runtimeOptions.ts](../../cgrid/src/core/runtimeOptions.ts). Map them.
2. **Drop AG-only fields.** `enableAdvancedFilter`, `pauseUpdatesWhenHidden` (worker-handled in cgrid), etc.
3. **Add cgrid-specific fields.** Worker-buffer size, paint-loop throttle, canvas resolution — these are unique to cgrid.
4. **Keep the tier organization.** The mental model carries over.
5. **Keep the composite-radio approach.** When a config maps to multiple flags, surface one choice.

This is one of the lighter ports — mostly a UI panel that mutates `gridOptions`. The real work is curating which ~30 fields actually matter.
