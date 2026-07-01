import {
  CGrid,
  type CGridOptions,
  type CellPainter,
  type MenuItem,
  type GetContextMenuItemsParams,
  type ToolPanel,
  type ToolPanelParams,
  type IStatusPanelComp,
  type StatusPanelParams,
} from 'cgrid';
import type { Position } from './stomp';

/**
 * Cycle 11 / Task 5 — demo custom tool panel. Registered via
 * `CGridOptions.components: { demoCustomPanel: DemoCustomPanel }` only
 * when the demo opts in (URL `?customPanel=1`), so the default demo's
 * side bar still ships exactly two tabs (Columns + Filters) and the
 * other Cycle 11 E2E specs remain untouched.
 *
 * The panel records every `init` / `refresh` / `destroy` call on its
 * root element as `data-init-count` / `data-refresh-count` /
 * `data-destroy-count`. The cycle11-customPanelApi spec reads those
 * attributes through the DOM to verify both API methods (`refreshToolPanel`,
 * `getToolPanelInstance`) drive the live instance.
 */
export class DemoCustomPanel implements ToolPanel {
  private gui = document.createElement('div');
  private initCount = 0;
  private refreshCount = 0;
  private destroyCount = 0;

  init(params: ToolPanelParams): void {
    this.initCount += 1;
    this.gui.className = 'cg-demo-custom-panel';
    this.gui.dataset.testid = 'demo-custom-panel';
    this.gui.dataset.initCount = String(this.initCount);
    this.gui.dataset.refreshCount = '0';
    this.gui.dataset.destroyCount = '0';
    // Surface the custom-panel id so the E2E can assert that
    // `getToolPanelInstance('demoCustomPanel')` returns this very
    // instance (the DOM node it exposes carries the matching marker).
    this.gui.dataset.panelId = 'demoCustomPanel';
    this.gui.textContent = `Cycle 11 / Task 5 — demo custom panel (api=${typeof params.api})`;
  }

  getGui(): HTMLElement {
    return this.gui;
  }

  refresh(): void {
    this.refreshCount += 1;
    this.gui.dataset.refreshCount = String(this.refreshCount);
  }

  destroy(): void {
    this.destroyCount += 1;
    this.gui.dataset.destroyCount = String(this.destroyCount);
  }
}

/**
 * Cycle 13 / Task 4 — demo custom status panel. Registered via
 * `CGridOptions.components: { demoCustomStatusPanel: DemoCustomStatusPanel }`
 * only when the demo opts into `?statusBar=customDemo`, so the default
 * demo's status bar still ships the canonical built-in panels (Cycle 13
 * / Tasks 2 + 3) and the other Cycle 13 visual cells stay untouched.
 *
 * The panel renders a small label-value pill matching the count-panel
 * vocabulary so the bar's typography stays consistent. It also stamps
 * `data-init-count` / `data-refresh-count` / `data-destroy-count` /
 * `data-panel-key` on its root element so E2E or downstream specs can
 * verify the custom-panel + getStatusPanel API surface end-to-end
 * (mirroring `DemoCustomPanel`'s test-attribute pattern for tool panels).
 */
export class DemoCustomStatusPanel implements IStatusPanelComp {
  private gui = document.createElement('span');
  private label = document.createElement('span');
  private value = document.createElement('strong');
  private initCount = 0;
  private refreshCount = 0;
  private destroyCount = 0;

  init(_params: StatusPanelParams): void {
    this.initCount += 1;
    this.gui.className = 'cg-status-panel-count cg-demo-custom-status-panel';
    this.gui.dataset.testid = 'demo-custom-status-panel';
    this.gui.dataset.panelKey = 'demoCustomStatusPanel';
    this.gui.dataset.initCount = String(this.initCount);
    this.gui.dataset.refreshCount = '0';
    this.gui.dataset.destroyCount = '0';
    this.label.className = 'cg-status-panel-count-label';
    this.label.textContent = 'Custom:';
    this.value.className = 'cg-status-panel-count-value';
    this.value.textContent = 'live';
    this.gui.appendChild(this.label);
    this.gui.appendChild(document.createTextNode(' '));
    this.gui.appendChild(this.value);
  }

  getGui(): HTMLElement {
    return this.gui;
  }

  refresh(): void {
    this.refreshCount += 1;
    this.gui.dataset.refreshCount = String(this.refreshCount);
  }

  destroy(): void {
    this.destroyCount += 1;
    this.gui.dataset.destroyCount = String(this.destroyCount);
  }

  /** Panel-specific method — apps narrow the `getStatusPanel<T>(key)`
   *  return to this class to call methods that aren't on
   *  `IStatusPanelComp`. Used by manual demo verification + a follow-up
   *  E2E to assert the generic narrowing works end-to-end. */
  getRefreshCount(): number {
    return this.refreshCount;
  }
}

/**
 * `pnlPill` — custom painter registered via `grid.registerCellRenderer`.
 * Paints a coloured rounded-rect pill behind the formatted value:
 * positive → green, negative → red, zero → neutral. Honors
 * `cellRendererParams.padX` so the demo can tune the pill inset.
 */
const pnlPill: CellPainter = {
  paint(gc, p) {
    const n = typeof p.value === 'number' ? p.value : Number(p.value);
    const params = (p.params ?? {}) as { padX?: number };
    const padX = params.padX ?? 6;
    const padY = 3;
    const x = p.bounds.x + padX;
    const y = p.bounds.y + padY;
    const w = Math.max(0, p.bounds.w - padX * 2);
    const h = Math.max(0, p.bounds.h - padY * 2);
    const fill = !Number.isFinite(n) || n === 0
      ? 'rgba(128,128,128,0.35)'
      : n > 0 ? 'rgba(46,160,67,0.45)' : 'rgba(220,70,70,0.45)';
    if (p.bg !== p.prefillColor) {
      gc.cache.fillStyle = p.bg;
      gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    }
    gc.cache.fillStyle = fill;
    gc.fillRect(x, y, w, h);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';
    gc.cache.textAlign = 'right';
    gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - padX - 2, p.bounds.y + p.bounds.h / 2);
  },
};

/** Demo bootstrap options. All flags default off so the demo opens
 *  clean (uniform rows, no decorative cell backgrounds). E2E specs
 *  that depend on the variant features opt in via the URL:
 *
 *   - `?editType=fullRow` — full-row edit mode (Cycle 5 / Task 10)
 *   - `?variableHeights=1` — `getRowHeight` returns 56px for ~25% of
 *     rows (Cycle 5 / Task 6's variableHeights.spec.ts)
 *   - `?autoHeight=1` — `notes` column flips to `autoHeight: true` +
 *     `wrapText: true` (Cycle 5 / Task 8 + 9's autoHeight.spec.ts +
 *     wrapText.spec.ts)
 *   - `?cellClassDemo=1` — re-enables the Cycle 6 / Task 7 demo
 *     surfaces: `cellClassRules` (positive/negative bg on Total) +
 *     `cellClass: 'warning'` (pale-yellow bg on Daily). Off by
 *     default so the default demo isn't visually busy. */
export interface PositionsGridOptions {
  editType?: 'fullRow';
  variableHeights?: boolean;
  autoHeight?: boolean;
  cellClassDemo?: boolean;
  /** Cycle 11 / Task 5 — opt the demo into registering a third tool
   *  panel (`DemoCustomPanel`) via `CGridOptions.components` plus an
   *  extra entry in `sideBar.toolPanels`. Off by default so the other
   *  Cycle 11 E2Es still see the canonical two-tab side bar; the
   *  cycle11-customPanelApi spec opts in via `?customPanel=1`. */
  customPanel?: boolean;
  /** Feature-toggle: opts the demo into pinning Position ID + CUSIP
   *  left and pnl + notionalAmount right. Off by default — a clean
   *  demo doesn't presume the user wants pinned columns. Driven by
   *  the toolbar "Pinned cols" checkbox AND `?pinning=on`. */
  pinning?: boolean;
  /** Feature-toggle: wraps the pnl / dailyPnl / unrealizedPnl cols in
   *  a `P&L` header group. Off by default. Driven by the toolbar
   *  "Column groups" checkbox AND `?columnGroups=on`. */
  columnGroups?: boolean;
  /** Cycle 11 / Task 9 — demo polish opt-in. Sets
   *  `sideBar.defaultToolPanel: 'agColumnsToolPanel'` so the Columns
   *  panel opens at mount. Off by default — every prior Cycle 11 E2E
   *  (cycle11-sideBar / sideBarEvents / sideBarCoexistence /
   *  customPanelApi / columnsPanel / filtersPanel) was written against
   *  the no-default-panel surface and asserts "no tab pressed at mount".
   *  Flipping the default would regress those specs, so the polished
   *  demo experience is gated behind `?openColumns=1`. */
  openColumns?: boolean;
  /** Cycle 13 / Task 1+2+3+4 — `?statusBar=<mode>` mounts the bottom
   *  status bar. Recognised modes:
   *    - `'mounted'`: empty bar (zero panels) — used by visual cell 14
   *      to assert the host chrome reads as intentional.
   *    - `'counts'`: four built-in count panels in the right zone
   *      (Total / Filtered / Selected / TotalAndFiltered) — Cycle 13 /
   *      Task 2, drives visual cell 15.
   *    - `'full'`: `agAggregationComponent` in the LEFT zone +
   *      `agTotalAndFilteredRowCountComponent` and
   *      `agSelectedRowCountComponent` in the RIGHT zone. Drives
   *      visual cell 16 once the spec stages a range selection.
   *      Cycle 13 / Task 3.
   *    - `'customDemo'`: a custom `DemoCustomStatusPanel` registered
   *      via `CGridOptions.components` mounted in the LEFT zone,
   *      alongside the built-in `agTotalAndFilteredRowCountComponent`
   *      in the RIGHT zone. Cycle 13 / Task 4 — exercises the custom
   *      panel registration + `getStatusPanel(key)` API surface in
   *      the live demo so manual checks (and any downstream E2E) hit
   *      the same code path the unit tests cover.
   *  Anything else (and null) leaves the bar disabled, preserving the
   *  default demo experience for the rest of the visual matrix. */
  statusBar?: string | null;
  /** Cycle 14 / Task 1 + 7 — controls the pinned grand-totals row. The
   *  demo default (when `main.ts` reads no `?totals=` query) is
   *  `'bottom'` — the totals row mounts at the bottom edge of the body
   *  so every matrix cell picks up the cycle's headline surface.
   *  Explicit values: `'top'` mounts at the top, `'bottom'` at the
   *  bottom, `null` (driven by `?totals=off`) turns the row off for
   *  layouts that need the prior body-only chrome. */
  totalsRowPosition?: 'top' | 'bottom' | null;
  /** Cycle 14 / Task 2 — opt the demo into mounting a sample pinned-
   *  top reference row (an "Index Benchmark" anchor). Drives visual
   *  cell 18-pinned-top-row via the `?pinned=top` query string. */
  pinnedTop?: boolean;
  /** Cycle 14 / Task 2 — opt the demo into mounting a sample pinned-
   *  bottom reference row. Off by default; available via `?pinned=bottom`
   *  or `?pinned=both` for manual smoke testing of the coexistence
   *  layout with the totals row. */
  pinnedBottom?: boolean;
  /** Cycle 14 / Task 4 — flip the grid-level
   *  `suppressAggFuncInHeader` toggle. Off by default (headers read
   *  as `sum(Notional)`); on flips every leaf column with an
   *  `aggFunc` back to its raw `headerName`. Drives the second
   *  snapshot in visual cell 19-aggfunc-in-header via
   *  `?totals=bottom&suppressAggHeader=1`. */
  suppressAggHeader?: boolean;
  /** Cycle 15 / Task 4 — opt the demo into mounting a one-level row
   *  group by `ticker`. Off by default so visual cells 01–19 stay
   *  byte-stable; visual cell 20-group-one-level opts in via
   *  `?grouping=ticker`. The demo calls `grid.setGroupModel({ rowGroupCols:
   *  ['ticker'] })` once the grid is ready so the worker's GroupPass
   *  produces the tree and the auto-group column synthesizes at index
   *  0 of the visible-leaf order. */
  groupByTicker?: boolean;
  /** Cycle 15 / Task 5 — opt the demo into a three-level multipleColumns
   *  group view (`ticker` → `sector` → `subSector`). Off by default;
   *  visual cell 21-group-three-level-multipleColumns opts in via
   *  `?grouping=multipleColumns`. Sets `groupDisplayType: 'multipleColumns'`
   *  AND `setGroupModel({ rowGroupCols: ['ticker', 'sector', 'subSector'] })`
   *  so three synthesized auto-group columns appear at the leftmost
   *  leaves, each showing chrome at its own group depth. */
  groupMultipleColumns?: boolean;
  /** Cycle 15 / Task 13 — cycle-exit showcase mode (`?grouping=demo`).
   *  Flips on one-level grouping by `ticker` AND `groupIncludeFooter:
   *  true` so a single query param surfaces the full grouped + aggregated
   *  reading (auto-group column, chevron + indent + `(count)`, per-group
   *  `Total ${ticker}` footer row, grand-total footer at the end). Off
   *  by default so visual cells 01–26 stay byte-stable; the README's
   *  grouping deep-link sets it. */
  groupingDemo?: boolean;
  /** Cycle 15 / Task 6 — `'always'` mounts the row group panel even
   *  when no chips are present so the empty-state placeholder
   *  ("Drag here to set row groups") is visible. Off by default;
   *  visual cell 22-rowGroupPanel-empty opts in via
   *  `?rowGroupPanel=empty`. Pairs with `enableRowGroup: true` on
   *  the `ticker` / `sector` / `subSector` / `desk` columns so the
   *  drop verdict reads `'accept'` if a column header is dragged
   *  in. */
  rowGroupPanelEmpty?: boolean;
  /** Cycle 15 / Task 6 — mounts the row group panel pre-populated
   *  with three chips (`desk` → `region` → `instrumentType`) matching
   *  the reference screenshot. Off by default; visual cell
   *  23-rowGroupPanel-three-chips opts in via
   *  `?rowGroupPanel=threeChips`. Sets the group model to the same
   *  three columns so the chips and the auto-group column agree on
   *  the active grouping. */
  rowGroupPanelThreeChips?: boolean;
  /** Cycle 15 / Task 6 — live-demo mode (`?rowGroupPanel=always`).
   *  Panel mounted with 1-level grouping by `ticker` seeded so the
   *  user can drag columns in / chips out and watch grouping update.
   *  Not used by any visual cell — exists for human exploration of
   *  the panel before Task 13 ships the cycle default. */
  rowGroupPanelAlways?: boolean;
  /** `?rowGroupPanel=marketsGrid` — MarketsGrid reference layout:
   *  desk → trader → region 3-level grouping with per-group and
   *  grand-total footer rows. Mounts desk/trader/region columns and
   *  seeds the group model. For human demo only; not a visual cell. */
  rowGroupPanelMarketsGrid?: boolean;
  /** Cycle 15 / Task 8 — opts the demo into tri-state cascading
   *  selection (`groupSelectsChildren: true`). The auto-group cells
   *  paint a tri-state checkbox between the chevron and the value.
   *  Visual cell 25-groupSelectsChildren-indeterminate sets this AND
   *  seeds a partial selection so the indeterminate dash paints on
   *  one group. */
  groupSelectsChildren?: boolean;
  /** Cycle 15 / Task 12 — opts the demo into per-group footer rows
   *  (`groupIncludeFooter: true`). Each expanded group gets one footer
   *  row at its bottom carrying the per-group aggregate. Drives visual
   *  cell 26-group-footer-rows. Off by default so visual cells 01–25
   *  stay byte-stable. */
  groupIncludeFooter?: boolean;
  /** Cycle 15 / Task 12 — opts the demo into the grand-total footer
   *  companion (`groupIncludeTotalFooter: true`). Only meaningful when
   *  `groupIncludeFooter` is on; appends a single grand-total row at
   *  the very end of the body using the same totals signature. */
  groupIncludeTotalFooter?: boolean;
  /** Cycle 15.5 / Task 4 — `?groupHideOpenParents=1` hides expanded
   *  parent group rows so only leaf rows are visible when the group is
   *  open. Collapsed groups still show the parent row. */
  groupHideOpenParents?: boolean;
  /** Cycle 15.5 / Task 6 — `?isGroupOpenByDefault=1` installs a
   *  callback that returns `true` for every group node, so all groups
   *  start expanded even when `groupDefaultExpanded` is set to 0.
   *  Used by the E2E to verify `resetRowGroupExpansion` re-applies the
   *  callback after a `collapseAll`. */
  isGroupOpenByDefault?: boolean;
  /** Cycle 15.5 / Task 7 — `?suppressCount=1` suppresses the `(N)`
   *  child-count badge from all group rows. */
  suppressCount?: boolean;
  /** Cycle 15.5 / Task 7 — `?suppressGroupChangesColVis=1` prevents
   *  the grid from auto-hiding a column when it is added to
   *  `rowGroupCols`. The original leaf column stays visible alongside
   *  the synthesized auto-group column. */
  suppressGroupChangesColumnVisibility?: boolean;
  /** Cycle 15.5 / Task 8 — `?groupTotalRow=bottom|top` renders a
   *  per-group total row at the specified edge of each expanded group. */
  groupTotalRow?: 'top' | 'bottom';
  /** Cycle 15.5 / Task 8 — `?grandTotalRow=bottom|top` renders a
   *  single grand-total row at the specified edge of the entire body. */
  grandTotalRow?: 'top' | 'bottom';
  /** Cycle 18 / Task 5 — `?pivotDemo=on` opts a handful of categorical
   *  columns (sector, region, currency) into `enablePivot: true` and
   *  numeric columns (notionalAmount, quantity) into `enableValue: true`
   *  so the columns tool panel's Column Labels + Values drop zones can
   *  accept drags. Side bar opens to the Columns panel so the
   *  affordances are visible on mount. */
  pivotDemo?: boolean;
  /** Cycle 18 / Task 6 — `?pivotPanel=always|onlyWhenPivoting` opts
   *  in the top-of-grid pivot panel (drop strip ABOVE the row group
   *  panel). Pairs with `?pivotDemo=on` so column-header drags from
   *  `enablePivot` columns land in the panel. */
  pivotPanelShow?: 'always' | 'onlyWhenPivoting';
  /** Cycle 18 / Task 8a — forces the worker pivot-result-column cap so
   *  the E2E can drive a breach + verify the public event fires.
   *  Negative / non-finite revert to the worker default (5000). */
  pivotMaxGeneratedColumns?: number;
}

/** Cycle 14 / Task 2 — deterministic seed for the demo pinned reference
 *  row. Returns a single Position-shaped row representing an "Index
 *  Benchmark" anchor. The numeric values are flat reference numbers a
 *  trader scans positions against (mid-of-book notional, neutral PnL).
 *  Strings on the row are blank so the painter just shows the warm tint
 *  + structural border across the non-numeric columns. */
function buildBenchmarkPinnedRows(): Position[] {
  return [{
    positionId: 'BENCHMARK',
    cusip: '',
    ticker: '',
    notionalAmount: 50_000,
    marketValue: 25_000_000,
    currentPrice: 500,
    pnl: 0,
    dailyPnl: 0,
    unrealizedPnl: 0,
    yield: 5,
    spread: 50,
    dv01: 50,
    pv01: 50,
  } as Position];
}

/** Cycle 7 / Task 8 — toolbar-driven external filter state. The
 *  `isExternalFilterPresent` / `doesExternalFilterPass` callbacks close
 *  over this module-level toggle so flipping it via
 *  `setPositiveOnlyFilter(true)` activates the worker round-trip on the
 *  next `grid.onFilterChanged('externalFilter')`. Module-scoped (rather
 *  than per-grid) because the demo only ever creates one grid; a more
 *  permissive shape lands when Cycle 22 introduces the option-bag
 *  builder. */
let positiveOnlyExternalFilter = false;

/** Cycle 7 / Task 8 — flip the demo's "show only positive P&L" filter
 *  and re-trigger the pipeline. Exposed so the toolbar checkbox in
 *  main.ts can drive the grid without reaching into private state. */
export function setPositiveOnlyFilter(grid: CGrid<Position>, value: boolean): void {
  positiveOnlyExternalFilter = value;
  grid.onFilterChanged('externalFilter');
}

/** Cycle 8 / Task 4 — module-level state for the "Pin selected to top"
 *  toolbar button. When `pinSelectedRowIds` is non-empty, the
 *  `postSortRows` callback moves those ids to the head of the post-sort
 *  order regardless of the active sort. The set is snapshotted from
 *  `grid.getSelectedRowIds()` on toggle-on so a later selection change
 *  doesn't shift the pin; toggle-off clears the set. */
let pinSelectedRowIds: Set<string> = new Set();

/** Cycle 8 / Task 4 — flip the demo's "Pin selected to top" mode and
 *  re-trigger the sort pipeline. `value: true` snapshots the current
 *  selection into `pinSelectedRowIds`; `value: false` clears it.
 *  Re-applying the current sort model is the cheapest way to re-fire
 *  `postSortRows` — `setSortModel` invalidates the worker's visible
 *  cache, which awaits the post-sort hook on the next build. */
export function setPinSelectedToTop(grid: CGrid<Position>, value: boolean): void {
  if (value) {
    pinSelectedRowIds = new Set(grid.getSelectedRowIds());
  } else {
    pinSelectedRowIds = new Set();
  }
  grid.setSortModel(grid.getSortModel());
}

export function createPositionsGrid(
  container: HTMLElement,
  opts: PositionsGridOptions = {},
): CGrid<Position> {
  // Cycle 6 / Task 6 — named column-type bundle. Columns referencing
  // `type: 'money'` pick up the numeric cellDataType (drives the default
  // right-aligned halign) plus a shared currency formatter so the two
  // dollar-valued columns render identically without each one repeating
  // the formatter on the column def.
  const moneyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const columnTypes: NonNullable<CGridOptions<Position>['columnTypes']> = {
    money: {
      cellDataType: 'number',
      valueFormatter: ({ value }) =>
        value == null || Number.isNaN(Number(value))
          ? ''
          : moneyFormatter.format(Number(value)),
    },
  };

  const options: CGridOptions<Position> = {
    columnTypes,
    // Cycle 7 / Task 1 — turn on the floating-filter row so the
    // cycle7-floatingFilter E2E has a typing target. Per-column
    // `floatingFilter: false` opts an individual column out of the row
    // without collapsing the row itself.
    defaultColDef: { floatingFilter: true },
    floatingFilter: true,
    columnDefs: [
      // Cycle 6 / Task 1: positionId opts out of drag-reorder. Pinned-left
      // is already a strong visual signal that this column shouldn't move;
      // suppressMovable enforces it for the UI without binding the
      // imperative moveColumnByIndex API.
      // Cycle 6 / Task 3: suppressSizeToFit holds positionId at its
      // declared width during a Fit-columns pass — the identifier column
      // shouldn't shrink to absorb container width.
      { field: 'positionId',     headerName: 'Position ID',  width: 150, ...(opts.pinning ? { pinned: 'left' as const } : {}), suppressMovable: true, suppressSizeToFit: true },
      // Cycle 5 Task 2: cusip carries the text-editor E2E coverage now that
      // ticker hosts the select editor.
      // Cycle 6 / Task 4: suppressAutoSize holds cusip at its declared
      // width during an Autosize-all pass — identifier columns shouldn't
      // grow/shrink based on the sampled rows' content.
      // Cycle 7 / Task 5 — text-filter popup demo target. caseSensitive
      // false so the popup checkbox defaults to off; trimInput true so
      // accidental whitespace around a typed CUSIP doesn't fail to match.
      // textFormatter unset — cusips already arrive case-stable from the
      // STOMP server, no normalisation needed.
      {
        field: 'cusip', headerName: 'CUSIP', width: 110, ...(opts.pinning ? { pinned: 'left' as const } : {}),
        editable: true, suppressAutoSize: true,
        filter: 'text' as const,
        filterParams: { caseSensitive: false, trimInput: true },
      },
      // Cycle 5 Task 2: ticker exercises the 'select' editor; the values list
      // is fixed for the demo so the E2E can pick a known entry.
      // Cycle 7 / Task 9 — ticker is the demo's only stable categorical
      // column (tradeDate / expiryDate / notes / confirmed are
      // user-edited synthetic fields; cusip uses filter: 'text'), so it
      // hosts the set-filter popup demo.
      {
        field: 'ticker', headerName: 'Ticker', width: 100, editable: true,
        cellEditor: 'select',
        cellEditorParams: { values: ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'TSLA', 'META'] },
        filter: 'set' as const,
        // Cycle 8 / Task 3 — natural-order sort: chunks of digits compare
        // numerically (so "TICK2" < "TICK10"), other runs lexicographically.
        // The comparator function is registered on the worker via
        // `grid.registerComparator('naturalOrder', fn)` below. Sorts via
        // the registered name string instead of an inline closure so the
        // function can round-trip postMessage to the worker.
        comparator: 'naturalOrder',
        // Cycle 15 / Task 6 — opt the ticker column INTO the row group
        // panel's drop-acceptance set when any rowGroupPanel demo is
        // on. The flag is column-local so visual cells without the row
        // group panel demo stay byte-stable; with the panel mounted, the
        // drop verdict for a ticker-header drag reads `'accept'`.
        ...(opts.rowGroupPanelEmpty || opts.rowGroupPanelThreeChips || opts.rowGroupPanelAlways
          ? { enableRowGroup: true as const }
          : {}),
      },
      // Cycle 15 / Task 5 — synthetic `sector` + `subSector` columns
      // for the three-level multipleColumns visual cell (cell 21). Only
      // added to the def list when `?grouping=multipleColumns` is set
      // so visual cells 01–20 (including the side-bar Columns / Filters
      // panel cells that list every column by name) stay byte-stable.
      // The seed in `e2e-visual/_setup.ts` derives the values from the
      // ticker via deterministic per-ticker maps, but the field
      // assignments are silently dropped at the worker boundary when
      // no column declares the field.
      //
      // Cycle 15 / Task 6 — `rowGroupPanelThreeChips` also pulls in the
      // sector + subSector columns so the panel chips
      // (`ticker` → `sector` → `subSector`) read against real header
      // names. The columns carry `enableRowGroup: true` so the panel's
      // drop verdict reads `'accept'` for these three (the rest stay
      // off — visual cell 22-empty exercises the rejection path
      // separately via the body painter).
      ...(opts.groupMultipleColumns || opts.rowGroupPanelThreeChips || opts.rowGroupPanelAlways || opts.pivotDemo
        ? [
            { field: 'sector' as const,    headerName: 'Sector',     width: 110, filter: 'set' as const, enableRowGroup: true as const },
            { field: 'subSector' as const, headerName: 'Sub Sector', width: 110, filter: 'set' as const, enableRowGroup: true as const },
          ]
        : []),
      // Cycle 15 / Task 6 — client-side categorical columns
      // synthesized by `decorateWithCategoricals` in main.ts. Mounted
      // only under `?rowGroupPanel=always` (or `=marketsGrid`) so
      // existing visual cells stay byte-stable.
      ...(opts.rowGroupPanelAlways || opts.rowGroupPanelMarketsGrid || opts.pivotDemo
        ? [
            { field: 'desk' as const,     headerName: 'Desk',     width: 130, filter: 'set' as const, enableRowGroup: true as const },
            { field: 'region' as const,   headerName: 'Region',   width: 110, filter: 'set' as const, enableRowGroup: true as const },
            { field: 'currency' as const, headerName: 'Currency', width: 90,  filter: 'set' as const, enableRowGroup: true as const },
            { field: 'trader' as const,   headerName: 'Trader',   width: 130, filter: 'set' as const, enableRowGroup: true as const },
          ]
        : []),
      // Cycle 5 Task 2: notionalAmount exercises the 'number' editor; min/precision
      // enforce non-negative two-decimal commits.
      // Cycle 6 / Task 1: lockPosition: 'right' pins notionalAmount to the
      // end of the flat visible-leaf order. A drag-attempt that would push
      // it earlier clamps to the last index instead of throwing.
      // Cycle 6 / Task 6 — shared `money` columnTypes bundle (declared
      // above) supplies cellDataType + valueFormatter, so both
      // dollar-valued columns format identically without repeating the
      // formatter per col-def.
      {
        // Cycle 7 / Task 3 — explicit `filter: 'number'` lights up the
        // number-filter popup behind the floating-filter expand button.
        // `filterParams.buttons` / `closeOnApply` keep the default surface
        // (Apply / Clear / Reset, close-on-apply: true).
        field: 'notionalAmount', headerName: 'Notional', type: 'money', width: 130, aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellEditorParams: { min: 0, precision: 2 },
        ...(opts.pinning ? { lockPosition: 'right' as const } : {}),
        filter: 'number' as const,
      },
      { field: 'marketValue',    headerName: 'Market Value',  type: 'money', width: 130, aggFunc: 'sum', filter: 'number' as const },
      { field: 'currentPrice',   headerName: 'Price',         type: 'number', width: 100, aggFunc: 'avg', filter: 'number' as const },
      // P&L children — wrapped in a header group when `opts.columnGroups`
      // is on (toolbar "Column groups" checkbox / `?columnGroups=on`),
      // otherwise flattened into the top-level list so the default demo
      // shows Total / Daily / Unrealized as plain sibling columns.
      ...(opts.columnGroups
        ? [{
            groupId: 'pnl', headerName: 'P&L',
            children: [
              {
                field: 'pnl' as const, headerName: 'Total', type: 'number', width: 110,
                ...(opts.pinning ? { pinned: 'right' as const } : {}),
                aggFunc: 'sum',
                cellRenderer: 'pnlPill',
                cellRendererParams: { padX: 4 },
                ...(opts.cellClassDemo ? {
                  cellClassRules: {
                    positive: (p: { value: unknown }) => typeof p.value === 'number' && p.value > 0,
                    negative: (p: { value: unknown }) => typeof p.value === 'number' && p.value < 0,
                  },
                } : {}),
                filter: 'number' as const,
                filterParams: { maxNumConditions: 2, defaultJoinOperator: 'AND' as const },
              },
              {
                field: 'dailyPnl' as const, headerName: 'Daily', type: 'number', width: 110,
                aggFunc: 'sum',
                ...(opts.cellClassDemo ? { cellClass: 'warning' } : {}),
                cellRendererSelector: (p: { value: unknown; colId: string }) => {
                  const n = typeof p.value === 'number' ? p.value : Number(p.value);
                  return Number.isFinite(n) && n > 0 ? { component: 'pnlPill' } : undefined;
                },
              },
              { field: 'unrealizedPnl' as const, headerName: 'Unrealized', type: 'number', width: 110, aggFunc: 'sum' },
            ],
          }]
        : [
            {
              field: 'pnl' as const, headerName: 'Total', type: 'number', width: 110,
              ...(opts.pinning ? { pinned: 'right' as const } : {}),
              aggFunc: 'sum',
              cellRenderer: 'pnlPill',
              cellRendererParams: { padX: 4 },
              ...(opts.cellClassDemo ? {
                cellClassRules: {
                  positive: (p: { value: unknown }) => typeof p.value === 'number' && p.value > 0,
                  negative: (p: { value: unknown }) => typeof p.value === 'number' && p.value < 0,
                },
              } : {}),
              filter: 'number' as const,
              filterParams: { maxNumConditions: 2, defaultJoinOperator: 'AND' as const },
            },
            {
              field: 'dailyPnl' as const, headerName: 'Daily', type: 'number', width: 110,
              aggFunc: 'sum',
              ...(opts.cellClassDemo ? { cellClass: 'warning' } : {}),
              cellRendererSelector: (p: { value: unknown; colId: string }) => {
                const n = typeof p.value === 'number' ? p.value : Number(p.value);
                return Number.isFinite(n) && n > 0 ? { component: 'pnlPill' } : undefined;
              },
            },
            { field: 'unrealizedPnl' as const, headerName: 'Unrealized', type: 'number', width: 110, aggFunc: 'sum' },
          ]),
      { field: 'yield',  headerName: 'Yield',  type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'spread', headerName: 'Spread', type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'dv01',   headerName: 'DV01',   type: 'number', width: 100, aggFunc: 'sum' },
      { field: 'pv01',   headerName: 'PV01',   type: 'number', width: 100, aggFunc: 'sum' },
      // Cycle 5 Task 2: synthetic columns so the remaining four built-in
      // editors (dateString, date, largeText, checkbox) have a click target
      // in the demo. The fields are not sent by STOMP — they start empty and
      // persist user edits via the default valueSetter path.
      {
        // Cycle 7 / Task 1 (parser enhancement) — `filter: 'date'` routes
        // the floating-filter input through the date-aware parser
        // (>YYYY-MM-DD, A..B, CSV, AND/OR).
        field: 'tradeDate', headerName: 'Trade Date', width: 120, editable: true,
        cellEditor: 'dateString',
        filter: 'date' as const,
      },
      {
        field: 'expiryDate', headerName: 'Expiry', width: 120, editable: true,
        cellEditor: 'date',
        filter: 'date' as const,
      },
      // Notes column — fixed-height by default; the autoHeight +
      // wrapText behaviors opt in via `?autoHeight=1` so the
      // autoHeight.spec.ts and wrapText.spec.ts E2Es still have a
      // target while the default demo stays uniform.
      {
        field: 'notes', headerName: 'Notes', width: 200, editable: true,
        cellEditor: 'largeText',
        cellEditorParams: { rows: 6, cols: 40, maxLength: 500 },
        ...(opts.autoHeight ? { autoHeight: true, wrapText: true } : {}),
      },
      {
        field: 'confirmed', headerName: 'Conf.', width: 70, editable: true,
        cellEditor: 'checkbox',
      },
    ],
    getRowId: (row) => row.positionId,
    rowSelection: 'multiple',
    enableCellChangeFlash: true,
    cellFlashDuration: 500,
    cellFadeDuration: 800,
    asyncTransactionWaitMillis: 50,
    theme: 'cg-theme-quartz-dark',
    // Cycle 5 / Task 4 — turn on the click + key edit-triggers so the
    // editing.triggers E2E can exercise singleClickEdit and
    // enterNavigatesVerticallyAfterEdit. stopEditingWhenCellsLoseFocus
    // is opted-out to keep the existing Esc-cancels-without-writing E2E
    // honest (clicking the input would otherwise commit on focusout).
    singleClickEdit: true,
    enterNavigatesVerticallyAfterEdit: true,
    // Cycle 5 / Task 5 — Excel-style arrow-commit. Type-to-edit starts in
    // 'enter' mode; ArrowDown/Up/Left/Right commit + move focus to the
    // adjacent cell. F2, dblclick, single-click and api.startEditingCell
    // start in 'edit' mode so arrows still move the input caret.
    enableExcelEditing: true,
    // Cycle 9 / Task 5 — fill handle. Drag the 6×6 square at the bottom-
    // right of the focused range to extend the selection downward and
    // commit a fill (linear extrapolation for numeric columns, repeat
    // for text). Default direction = 'y' (down only).
    enableFillHandle: true,
    fillHandleDirection: 'y',
    // Default: uniform rows. `?variableHeights=1` re-enables the
    // Cycle 5 / Task 6 `getRowHeight` rule (56px for positionIds
    // whose last char-code is divisible by 4) so the
    // variableHeights.spec.ts E2E still has a target.
    ...(opts.variableHeights ? {
      getRowHeight: ({ data }) => {
        const id = (data as { positionId?: string } | null)?.positionId;
        if (!id) return null;
        const last = id.charCodeAt(id.length - 1);
        return last % 4 === 0 ? 56 : null;
      },
    } : {}),
    // Cycle 5 / Task 10 — full-row edit. Opt-in via `?editType=fullRow`
    // (main.ts reads the URL). Triggering an edit on any editable cell
    // opens N editors at once; Tab cycles within the row, Enter commits
    // all, Esc cancels all.
    ...(opts.editType ? { editType: opts.editType } : {}),
    // Cycle 7 / Task 8 — external filter wiring. The "show only positive
    // P&L" toolbar checkbox flips the module-level `positiveOnlyExternalFilter`
    // toggle via `setPositiveOnlyFilter`; on the next
    // `onFilterChanged('externalFilter')` the worker pushes the candidate
    // rowIds back to main, where this predicate filters on the pnl field.
    // Always present even when the toggle is off — `isExternalFilterPresent`
    // returning false short-circuits the round-trip without re-registering.
    isExternalFilterPresent: () => positiveOnlyExternalFilter,
    doesExternalFilterPass: ({ data }) => typeof data.pnl === 'number' && data.pnl > 0,
    // Cycle 8 / Task 4 — postSortRows demo wiring. The "Pin selected to
    // top" toolbar button snapshots the current selection into
    // `pinSelectedRowIds` and re-triggers the sort; this callback then
    // moves those ids to the head of the post-sort order, preserving
    // the SortPass-resolved relative order within each bucket. When the
    // pin set is empty, the input array is returned unchanged so the
    // round-trip is a no-op.
    postSortRows: ({ rowIds }) => {
      if (pinSelectedRowIds.size === 0) return rowIds;
      const pinned: string[] = [];
      const rest: string[] = [];
      for (const id of rowIds) {
        if (pinSelectedRowIds.has(id)) pinned.push(id);
        else rest.push(id);
      }
      return [...pinned, ...rest];
    },
    // Cycle 11 / Task 2 — side bar mount. Tabs render on the right edge,
    // Columns + Filters tool panels available (stub UIs until Tasks 3 + 4
    // replace them with the real implementations). The default panel
    // stays closed at mount so the demo opens with the canvas at full
    // width; clicking a tab opens the matching panel.
    //
    // Cycle 11 / Task 5 — when `?customPanel=1` opts in, the demo also
    // registers a third panel (`demoCustomPanel`) via `components` and
    // appends it to the tab strip. The cycle11-customPanelApi E2E uses
    // this to exercise `refreshToolPanel` + `getToolPanelInstance` over
    // a custom (non-built-in) id.
    //
    // Cycle 11 / Task 9 — `?openColumns=1` opts the demo into
    // `defaultToolPanel: 'agColumnsToolPanel'` so the Columns panel
    // opens at mount, showcasing the polished out-of-the-box experience
    // an app would ship with. Existing Cycle 11 E2Es assert "no tab
    // pressed at mount" against the default URL, so this stays opt-in.
    sideBar: {
      toolPanels: opts.customPanel
        ? [
            'columns',
            'filters',
            { id: 'demoCustomPanel', labelDefault: 'Demo', toolPanel: 'demoCustomPanel' },
          ]
        : ['columns', 'filters'],
      ...(opts.openColumns ? { defaultToolPanel: 'agColumnsToolPanel' } : {}),
    },
    // The `components` channel feeds BOTH the tool-panel registry
    // (`demoCustomPanel`) AND the status-panel registry
    // (`demoCustomStatusPanel`) — Cycle 13 / Task 4 widened it so a
    // single map covers either surface. The status-panel ctor is only
    // included when the demo opts into `?statusBar=customDemo` so the
    // canonical built-in keys stay the default registry surface and
    // the existing visual matrix isn't perturbed.
    components: (opts.customPanel || opts.statusBar === 'customDemo')
      ? {
          ...(opts.customPanel ? { demoCustomPanel: DemoCustomPanel } : {}),
          ...(opts.statusBar === 'customDemo' ? { demoCustomStatusPanel: DemoCustomStatusPanel } : {}),
        }
      : undefined,
    // Cycle 13 / Task 1+2+3+4+6 — `?statusBar=<mode>`:
    //   - `'mounted'`    → empty bar (visual cell 14)
    //   - `'counts'`     → four built-in count panels in the right zone
    //                      (visual cell 15)
    //   - `'full'`       → agAggregationComponent on the left zone
    //                      (5 stats inline) + TotalAndFiltered + Selected
    //                      count panels on the right zone (visual cell 16
    //                      stages a 10-row range so the agg panel renders).
    //   - `'customDemo'` → `demoCustomStatusPanel` (registered via
    //                      `components` above) on the left zone +
    //                      `agTotalAndFilteredRowCountComponent` on the
    //                      right. Exercises the Task 4 custom-panel +
    //                      getStatusPanel(key) API surface end-to-end.
    //   - default (no query) → same shape as `'full'`: the polished
    //                      out-of-the-box experience that ships with the
    //                      demo. Cycle 13 / Task 6 promoted the bar to a
    //                      default-on surface so every existing visual
    //                      matrix cell (01–13) gets a status bar at the
    //                      bottom edge, mirroring the FM Area 18 exit. The
    //                      agg panel hides itself when there's no
    //                      selection (decision 4 in the design notes), so
    //                      the default render still reads as "right-loaded
    //                      glance" — only the two count panels are
    //                      visible. A new selection wakes the left zone.
    statusBar: opts.statusBar === 'mounted'
      ? { statusPanels: [] }
      : opts.statusBar === 'counts'
        ? {
            statusPanels: [
              { key: 'agTotalRowCountComponent', statusPanel: 'agTotalRowCountComponent' },
              { key: 'agFilteredRowCountComponent', statusPanel: 'agFilteredRowCountComponent' },
              { key: 'agSelectedRowCountComponent', statusPanel: 'agSelectedRowCountComponent' },
              { key: 'agTotalAndFilteredRowCountComponent', statusPanel: 'agTotalAndFilteredRowCountComponent' },
            ],
          }
        : opts.statusBar === 'customDemo'
          ? {
              statusPanels: [
                { key: 'demoCustomStatusPanel', statusPanel: 'demoCustomStatusPanel', align: 'left' },
                { key: 'agTotalAndFilteredRowCountComponent', statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'right' },
              ],
            }
          : {
              // `opts.statusBar === 'full'` and the default (no query) share
              // the same canonical shape — the demo always ships the agg +
              // counts layout unless the URL explicitly opts into an empty
              // / counts-only / custom variant.
              statusPanels: [
                { key: 'agAggregationComponent', statusPanel: 'agAggregationComponent', align: 'left' },
                { key: 'agTotalAndFilteredRowCountComponent', statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'right' },
                { key: 'agSelectedRowCountComponent', statusPanel: 'agSelectedRowCountComponent', align: 'right' },
              ],
            },
    // Cycle 14 / Task 1 + 7 — pinned grand-totals row. The Cycle 14 /
    // Task 7 exit ritual promoted the row to a default-on surface; the
    // demo entry (`main.ts`) defaults `totalsRowPosition` to `'bottom'`
    // unless the URL carries `?totals=off`. `null` here turns the row
    // off entirely for direct callers of `createPositionsGrid` that
    // need the prior body-only layout. The demo's `notionalAmount`,
    // `marketValue`, `currentPrice`, `pnl`, `dailyPnl`,
    // `unrealizedPnl`, `yield`, `spread`, `dv01`, `pv01` columns all
    // carry aggFuncs so the pinned row reads with values across the
    // visible width.
    totalsRowPosition: opts.totalsRowPosition ?? null,
    // Cycle 14 / Task 2 — sample pinned reference rows. The demo seeds
    // a single "Index Benchmark" row covering the numeric columns the
    // trader compares positions against; visual cell 18-pinned-top-row
    // uses this via `?pinned=top`. The string positionId / cusip /
    // ticker columns inherit empty values (the demo doesn't fabricate
    // labels for reference rows — only the numeric reference matters).
    pinnedTopRowData: opts.pinnedTop ? buildBenchmarkPinnedRows() : null,
    pinnedBottomRowData: opts.pinnedBottom ? buildBenchmarkPinnedRows() : null,
    // Cycle 14 / Task 4 — header decoration toggle. Default `false`
    // keeps the canonical `sum(Notional)` / `avg(Price)` decoration
    // on every aggFunc-declared column; `?suppressAggHeader=1`
    // collapses every header back to its raw `headerName`. Per the
    // design plan (decision 4), per-column `suppressAggFuncInHeader`
    // wins over this grid-level value; the demo doesn't set any
    // per-column overrides — that's exercised by the unit test
    // suite (`suppressAggFuncInHeader.test.ts` cases 3 + 4).
    suppressAggFuncInHeader: opts.suppressAggHeader === true,
    // Cycle 10 / Task 1 — sample `getContextMenuItems`. Keeps every
    // built-in default item (Copy / Paste / Cut / Export / Autosize /
    // Pin / Reset) AND appends one custom "Clear filters" entry so the
    // demo round-trips both the default-list mix-in pattern and a
    // bespoke action. `params.defaultItems` is the registry list
    // (`buildDefaultMenuItems` output); appending after it preserves
    // separator placement.
    getContextMenuItems: (params: GetContextMenuItemsParams): MenuItem[] => [
      ...params.defaultItems,
      { name: '---' },
      {
        name: 'Clear filters',
        icon: '\u{1F9F9}', // 🧹 broom
        action: () => {
          const api = grid as unknown as {
            setFilterModel: (model: unknown) => void;
          };
          api.setFilterModel(null);
        },
      },
    ],
    // Cycle 15 / Task 5 — opt the demo into `'multipleColumns'` grouping
    // display when `?grouping=multipleColumns` is set. Drives visual
    // cell 21-group-three-level-multipleColumns. `setGroupModel` lands
    // post-construction below so the worker pipeline picks up the
    // three-level model AFTER the columns are wired.
    ...(opts.groupMultipleColumns ? { groupDisplayType: 'multipleColumns' as const } : {}),
    // Cycle 15 / Task 6 — mount the row group panel when any
    // rowGroupPanel demo is on. `'always'` keeps the panel visible
    // even with no chips so the empty-state placeholder paints in
    // visual cell 22; the threeChips demo opts in the same way and
    // calls `setGroupModel` post-construction to populate the chip
    // strip with `ticker` → `sector` → `subSector`. The `always`
    // demo also opts in here AND seeds 1-level grouping by `ticker`
    // post-construction below so a single chip is visible and the
    // grid is grouped (live-demo mode).
    ...(opts.rowGroupPanelEmpty || opts.rowGroupPanelThreeChips || opts.rowGroupPanelAlways || opts.rowGroupPanelMarketsGrid
      ? { rowGroupPanelShow: 'always' as const }
      : {}),
    // Cycle 15 / Task 8 — opt into tri-state cascading selection
    // when `?groupSelectsChildren=1` is set. The auto-group cells
    // paint a tri-state checkbox alongside the chevron. Used by
    // visual cell 25 to show the indeterminate state.
    ...(opts.groupSelectsChildren ? { groupSelectsChildren: true as const } : {}),
    // Cycle 15 / Task 12 — opt into per-group footer rows when
    // `?groupIncludeFooter=1` is set. Each expanded group's children
    // get a `Total ${groupValue}` row at the bottom carrying the
    // per-group aggregations. The grand-total companion lights up via
    // `?groupIncludeTotalFooter=1` on top. Used by visual cell 26 to
    // baseline the synthesis stripe vocabulary.
    ...(opts.groupIncludeFooter ? { groupIncludeFooter: true as const } : {}),
    ...(opts.groupIncludeTotalFooter ? { groupIncludeTotalFooter: true as const } : {}),
    // Cycle 15 / Task 13 — cycle-exit showcase mode. `?grouping=demo`
    // composes the per-group footer signature with the 1-level ticker
    // group below, surfacing the full grouped + aggregated reading from
    // a single query param. Default off so visual cells 01–26 stay
    // byte-stable.
    ...(opts.groupingDemo ? { groupIncludeFooter: true as const, groupIncludeTotalFooter: true as const } : {}),
    // Live "Row group panel" toolbar toggle (`?rowGroupPanel=always`)
    // is the user-facing grouping experience. Surface every Cycle 15
    // feature by default so the toggle reveals — not hides — what the
    // cycle shipped: groups start COLLAPSED so the user drives expansion,
    // each expanded group gets a `Total ${groupValue}` footer row, and a
    // grand-total footer caps the body. Explicit URL flags above still
    // win for byte-stable visual baselines.
    ...(opts.rowGroupPanelAlways
      ? {
          groupDefaultExpanded: 0 as const,
          groupIncludeFooter: true as const,
          groupIncludeTotalFooter: true as const,
        }
      : {}),
    // MarketsGrid reference layout — desk → trader → region 3-level
    // grouping, footers at every level + grand total.
    ...(opts.rowGroupPanelMarketsGrid
      ? {
          groupDefaultExpanded: 0 as const,
          groupIncludeFooter: true as const,
          groupIncludeTotalFooter: true as const,
        }
      : {}),
    // Cycle 15.5 / Task 4 — `?groupHideOpenParents=1` hides expanded
    // parent rows so only leaves are visible when a group is open.
    ...(opts.groupHideOpenParents ? { groupHideOpenParents: true as const } : {}),
    // Cycle 15.5 / Task 6 — install a callback that always returns true
    // so every group starts open regardless of groupDefaultExpanded.
    // `resetRowGroupExpansion()` re-runs the callback after a collapseAll.
    ...(opts.isGroupOpenByDefault ? { isGroupOpenByDefault: () => true } : {}),
    // Cycle 15.5 / Task 7 — suppress the "(N)" child-count badge.
    ...(opts.suppressCount ? { suppressCount: true as const } : {}),
    // Cycle 15.5 / Task 7 — keep the leaf column visible when it is
    // added to rowGroupCols (don't auto-hide it).
    ...(opts.suppressGroupChangesColumnVisibility
      ? { suppressGroupChangesColumnVisibility: true as const }
      : {}),
    // Cycle 15.5 / Task 8 — per-group total row position.
    ...(opts.groupTotalRow ? { groupTotalRow: opts.groupTotalRow } : {}),
    // Cycle 15.5 / Task 8 — grand-total row position.
    ...(opts.grandTotalRow ? { grandTotalRow: opts.grandTotalRow } : {}),
    // Cycle 18 / Task 6 — pivot panel (top-of-grid drop strip ABOVE
    // the row group panel). `?pivotPanel=always|onlyWhenPivoting`.
    ...(opts.pivotPanelShow ? { pivotPanelShow: opts.pivotPanelShow } : {}),
    // Cycle 18 / Task 8a — `?pivotMaxGeneratedColumns=N` forces the cap.
    ...(opts.pivotMaxGeneratedColumns !== undefined
      ? { pivotMaxGeneratedColumns: opts.pivotMaxGeneratedColumns }
      : {}),
  };

  // Cycle 18 / Task 5 — `?pivotDemo=on`: stamp `enablePivot` on a few
  // categorical columns and `enableValue` on a few numeric measures so
  // the Columns tool panel's Column Labels + Values zones have something
  // to accept. Categorical columns also need `enableRowGroup` so the
  // pivotMode-ON checkbox semantics light up (checkbox-add-as-row-group).
  // Walk recursively so children inside a header group (e.g. P&L children
  // under `?columnGroups=on`) also get the flags.
  if (opts.pivotDemo) {
    const PIVOT_FIELDS = new Set(['sector', 'region', 'currency', 'desk']);
    const VALUE_FIELDS = new Set(['notionalAmount', 'marketValue', 'pnl', 'quantity']);
    const stamp = (defs: Array<Record<string, unknown>>): void => {
      for (const def of defs) {
        const field = typeof def.field === 'string' ? def.field : undefined;
        if (field && PIVOT_FIELDS.has(field)) {
          def.enablePivot = true;
          def.enableRowGroup = true;
        }
        if (field && VALUE_FIELDS.has(field)) {
          def.enableValue = true;
        }
        const children = (def as { children?: unknown }).children;
        if (Array.isArray(children)) {
          stamp(children as Array<Record<string, unknown>>);
        }
      }
    };
    stamp(options.columnDefs as Array<Record<string, unknown>>);
    // Open the side bar to Columns so the pivot affordances are visible.
    if (options.sideBar && typeof options.sideBar === 'object') {
      (options.sideBar as { defaultToolPanel?: string }).defaultToolPanel = 'agColumnsToolPanel';
    }
  }

  const grid = new CGrid<Position>(container, options);
  grid.registerCellRenderer('pnlPill', pnlPill);
  // Cycle 8 / Task 3 — register a natural-order comparator so the ticker
  // column sorts "TICK2" before "TICK10" instead of "TICK10" before
  // "TICK2". The function string-serialises to the worker via
  // `Function.prototype.toString()` and reconstructs through
  // `new Function`, so it MUST be pure + may not close over external scope.
  // For the demo's all-letter tickers (AAPL, MSFT, …) the result matches
  // a lexicographic sort; the comparator is wired so apps that swap in
  // numeric ticker IDs get the natural ordering for free.
  grid.registerComparator('naturalOrder', (a, b) => {
    const as = String(a ?? '');
    const bs = String(b ?? '');
    // Walk both strings in matched digit/non-digit chunks; numeric chunks
    // compare numerically, alphabetic chunks compare via localeCompare.
    const tokenize = (s: string) =>
      s.match(/\d+|\D+/g) ?? [];
    const at = tokenize(as);
    const bt = tokenize(bs);
    const n = Math.min(at.length, bt.length);
    for (let i = 0; i < n; i++) {
      const ai = at[i]!;
      const bi = bt[i]!;
      const an = Number(ai);
      const bn = Number(bi);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        if (an !== bn) return an < bn ? -1 : 1;
      } else if (ai !== bi) {
        return ai < bi ? -1 : 1;
      }
    }
    return at.length - bt.length;
  }).catch(() => { /* worker terminated mid-init; harmless */ });
  // Cycle 15 / Task 4 — opt the demo into a one-level row group by
  // `ticker` when the URL carries `?grouping=ticker`. The auto-group
  // column synthesizes at index 0 of the visible-leaf order and
  // paints chevron + indent + value + (count) per group row. Fired
  // post-construction (the worker accepts setGroupModel before init
  // completes via its request queue, but the auto-group column
  // synthesis runs on the main thread immediately).
  if (opts.groupByTicker) {
    grid.setGroupModel({ rowGroupCols: ['ticker'] });
  }
  // Cycle 15 / Task 5 — three-level multipleColumns row group. Fired
  // post-construction once the worker has the visible columns wired so
  // GroupPass validates `['ticker', 'sector', 'subSector']` against the
  // live column set. The auto-group columns synthesize at the start of
  // the visible-leaf order; the painter routes each chevron + value +
  // (count) to the column whose `cellRendererParams.groupColumnDepth`
  // matches the row's depth.
  if (opts.groupMultipleColumns) {
    grid.setGroupModel({ rowGroupCols: ['ticker', 'sector', 'subSector'] });
  }
  // Cycle 15 / Task 6 — populate the row group panel's chip strip
  // with `ticker` → `sector` → `subSector` for visual cell 23. The
  // chips read in nesting order; the auto-group column synthesizes
  // alongside since `setGroupModel` activates the standard grouping
  // pipeline.
  if (opts.rowGroupPanelThreeChips) {
    grid.setGroupModel({ rowGroupCols: ['ticker', 'sector', 'subSector'] });
  }
  // Cycle 15 / Task 6 — live-demo mode: 1-level grouping by ticker so
  // the panel shows a single chip the user can remove + drop more
  // columns into.
  if (opts.rowGroupPanelAlways) {
    grid.setGroupModel({ rowGroupCols: ['ticker'] });
  }
  if (opts.rowGroupPanelMarketsGrid) {
    grid.setGroupModel({ rowGroupCols: ['desk', 'trader', 'region'] });
  }
  // Cycle 15 / Task 13 — cycle-exit showcase: seed the 1-level ticker
  // grouping post-construction so the per-group footer flag (set above
  // in the options object) finds rows to total. Composed alongside
  // groupIncludeFooter + groupIncludeTotalFooter for the polished
  // grouped reading.
  if (opts.groupingDemo) {
    grid.setGroupModel({ rowGroupCols: ['ticker'] });
  }
  return grid;
}
