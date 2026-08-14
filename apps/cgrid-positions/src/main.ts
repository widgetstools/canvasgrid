import '@wellsfargo-starui/velocity-grid/style.css';
import { createPositionsGrid, setPositiveOnlyFilter, setPinSelectedToTop } from './positionsGrid';
import { connectStomp, STOMP_PUBLISH_RATE_PER_SEC } from './stomp';

const host = document.getElementById('grid');
if (!host) throw new Error('grid host not found');

// Cycle 5 / Task 10 — `?editType=fullRow` flips the demo into full-row
// edit mode without changing the default single-cell flow. The E2E
// targeting full-row navigates with this query param; other E2Es keep
// the default.
//
// `?variableHeights=1` / `?autoHeight=1` re-enable the Cycle 5 / Task 6
// + Task 8 variant features the variableHeights / autoHeight / wrapText
// E2E specs need. Default demo is uniform-height, no per-row variance.
const search = new URLSearchParams(window.location.search);
const editTypeParam = search.get('editType');
const editType = editTypeParam === 'fullRow' ? 'fullRow' as const : undefined;
const variableHeights = search.get('variableHeights') === '1';
const autoHeight = search.get('autoHeight') === '1';
const cellClassDemo = search.get('cellClassDemo') === '1';
// Cycle 11 / Task 5 — `?customPanel=1` registers the demo `DemoCustomPanel`
// via `VelocityGridOptions.components` and adds a third tab to the side bar so the
// cycle11-customPanelApi E2E can exercise refreshToolPanel +
// getToolPanelInstance against a custom id.
const customPanel = search.get('customPanel') === '1';
// Cycle 11 / Task 9 — `?openColumns=1` sets
// `sideBar.defaultToolPanel: 'agColumnsToolPanel'` so the Columns panel
// opens at mount. The polished default-panel experience is opt-in to
// keep the prior Cycle 11 E2Es (which assert "no tab pressed at mount")
// green against the default URL.
const openColumns = search.get('openColumns') === '1';
// Cycle 13 / Task 1+2+3+4 — `?statusBar=<mode>` opts the demo into
// mounting the bottom status bar:
//   - `mounted`    → empty bar (visual cell 14)
//   - `counts`     → four built-in count panels (visual cell 15)
//   - `full`       → aggregation + count panels (visual cell 16)
//   - `customDemo` → a custom `DemoCustomStatusPanel` registered via
//                    `VelocityGridOptions.components` (Cycle 13 / Task 4) +
//                    the TotalAndFiltered count panel, so the live
//                    demo exercises the custom-panel + getStatusPanel
//                    API surface.
const statusBar = search.get('statusBar');
// Cycle 14 / Task 1 + 7 — `?totals=top|bottom|off` flips the pinned
// grand-totals row. Cycle 14 / Task 7 promoted the row to a default-on
// surface: with no query string, the demo mounts the totals row at the
// BOTTOM of the body, mirroring the FM Area 10 exit. The existing
// `?totals=bottom` opt-in (visual cell 17) keeps the same shape; the
// new `?totals=off` opt-OUT lets specs that need the prior body-only
// layout (none in cells 01–16 — those got re-baselined in this PR) opt
// out without removing the query channel.
const totalsRaw = search.get('totals');
const totalsRowPosition: 'top' | 'bottom' | null =
  totalsRaw === 'off' ? null
  : totalsRaw === 'top' || totalsRaw === 'bottom' ? totalsRaw
  : 'bottom';
// Cycle 14 / Task 2 — `?pinned=top|bottom|both` opts the demo into
// mounting a sample static pinned row (a "Benchmark" reference row) at
// the matching edge. Off by default so visual cells 01–17 stay byte-
// stable; visual cell 18-pinned-top-row opts in via `?pinned=top`.
const pinnedRaw = search.get('pinned');
const pinnedTop = pinnedRaw === 'top' || pinnedRaw === 'both';
const pinnedBottom = pinnedRaw === 'bottom' || pinnedRaw === 'both';
// Cycle 14 / Task 4 — `?suppressAggHeader=1` flips the grid-level
// `suppressAggFuncInHeader` flag. Off by default (header reads as
// `sum(Notional)`) so visual cells 01–18 stay byte-stable; visual
// cell 19-aggfunc-in-header opens BOTH snapshots — default-off
// (`?totals=bottom`) and toggled-on (`?totals=bottom&suppressAggHeader=1`)
// — through this single switch.
const suppressAggHeader = search.get('suppressAggHeader') === '1';
// Cycle 15 / Task 4 — `?grouping=ticker` opts the demo into a one-level
// row group so the auto-group column + 'group' cell renderer light up in
// the live demo. Off by default so visual cells 01–19 stay byte-stable.
const groupByTicker = search.get('grouping') === 'ticker';
// Cycle 15 / Task 5 — `?grouping=multipleColumns` opts the demo into a
// three-level (`ticker` → `sector` → `subSector`)
// `groupDisplayType: 'multipleColumns'` view. Off by default; drives
// visual cell 21-group-three-level-multipleColumns. Mutually exclusive
// with `?grouping=ticker` — the same query param selects ONE grouping
// demo.
const groupMultipleColumns = search.get('grouping') === 'multipleColumns';
// Cycle 15 / Task 13 — `?grouping=demo` is the cycle-exit showcase: one-
// level grouping by `ticker` AND per-group footer rows on, so a single
// query param surfaces the full grouped + aggregated reading (auto-group
// column, chevron + indent + (count), Total ${ticker} footer per group,
// grand-total footer at the end). Off by default so visual cells 01–26
// stay byte-stable; users land here from the README's grouping deep-link.
const groupingDemo = search.get('grouping') === 'demo';
// Cycle 15 / Task 6 — `?rowGroupPanel=empty` mounts the row group
// panel with no chips so the dashed empty-state placeholder paints
// (visual cell 22). `?rowGroupPanel=threeChips` mounts it
// pre-populated with `ticker` → `sector` → `subSector` chips
// matching the reference screenshot (visual cell 23). `?rowGroupPanel=always`
// is the live-demo mode: panel mounted + 1-level grouping by ticker
// seeded so the user can drag columns in / chips out and see the
// effect immediately (not used by any visual cell — exists only as a
// quick-look during cycle development before Task 13's demo default).
// Off by default so visual cells 01–21 stay byte-stable.
const rowGroupPanelMode = search.get('rowGroupPanel');
const rowGroupPanelEmpty = rowGroupPanelMode === 'empty';
const rowGroupPanelThreeChips = rowGroupPanelMode === 'threeChips';
const rowGroupPanelAlways = rowGroupPanelMode === 'always';
const rowGroupPanelMarketsGrid = rowGroupPanelMode === 'marketsGrid';
// Cycle 15 / Task 8 — `?groupSelectsChildren=1` opts the demo into
// tri-state cascading selection. Off by default so visual cells
// 01–24 stay byte-stable; visual cell 25 turns it on AND seeds a
// partial selection so the indeterminate dash paints on one group.
const groupSelectsChildren = search.get('groupSelectsChildren') === '1';
// Cycle 15 / Task 12 — `?groupIncludeFooter=1` opts the demo into
// per-group footer rows. Off by default so visual cells 01–25 stay
// byte-stable; visual cell 26-group-footer-rows turns it on AND
// pairs with `?grouping=ticker` so each ticker group's expanded
// children get a `Total ${ticker}` footer row at the bottom. The
// grand-total companion (`groupIncludeTotalFooter`) opts in via
// `?groupIncludeTotalFooter=1` — typically toggled together.
const groupIncludeFooter = search.get('groupIncludeFooter') === '1';
const groupIncludeTotalFooter = search.get('groupIncludeTotalFooter') === '1';
// Cycle 15.5 / Task 4 — `?groupHideOpenParents=1` hides expanded parent rows.
const groupHideOpenParents = search.get('groupHideOpenParents') === '1';
// Cycle 15.5 / Task 6 — `?isGroupOpenByDefault=1` installs a callback that
// opens every group by default; used with `resetRowGroupExpansion` in the E2E.
const isGroupOpenByDefault = search.get('isGroupOpenByDefault') === '1';
// Cycle 15.5 / Task 7 — `?suppressCount=1` suppresses the "(N)" child badge.
const suppressCount = search.get('suppressCount') === '1';
// Cycle 15.5 / Task 7 — `?suppressGroupChangesColVis=1` keeps leaf columns
// visible when they are added to rowGroupCols.
const suppressGroupChangesColumnVisibility = search.get('suppressGroupChangesColVis') === '1';
// Cycle 15.5 / Task 8 — `?groupTotalRow=top|bottom` per-group footer position.
const groupTotalRowRaw = search.get('groupTotalRow');
const groupTotalRow: 'top' | 'bottom' | undefined =
  groupTotalRowRaw === 'top' || groupTotalRowRaw === 'bottom' ? groupTotalRowRaw : undefined;
// Cycle 15.5 / Task 8 — `?grandTotalRow=top|bottom` grand-total row position.
const grandTotalRowRaw = search.get('grandTotalRow');
const grandTotalRow: 'top' | 'bottom' | 'pinnedTop' | 'pinnedBottom' | undefined =
  grandTotalRowRaw === 'top' || grandTotalRowRaw === 'bottom'
  || grandTotalRowRaw === 'pinnedTop' || grandTotalRowRaw === 'pinnedBottom'
    ? grandTotalRowRaw
    : undefined;
// AG parity 2026-07-21 — group order lock + expansion depth.
const groupMaintainOrder = search.get('groupMaintainOrder') === '1';
// AG parity 2026-07-21 second wave.
const groupAggFiltering = search.get('groupAggFiltering') === '1';
const groupColumnFilter = search.get('groupColumnFilter') === '1';
const keyCreatorDemo = search.get('keyCreatorDemo') === '1';
const groupDefaultExpandedRaw = search.get('groupDefaultExpanded');
const groupDefaultExpanded = groupDefaultExpandedRaw !== null
  && Number.isFinite(Number(groupDefaultExpandedRaw))
  ? Number(groupDefaultExpandedRaw)
  : undefined;
// Feature toggles wired to the toolbar checkboxes. Default OFF so the
// demo opens with a CLEAN grid (no pinned columns, no header groups).
// User opts each surface in via the header checkbox; the URL flag
// (`?pinning=on` / `?columnGroups=on`) keeps the choice across reloads
// + lets deep-links pin a feature combo.
const pinning      = search.get('pinning')      === 'on';
const columnGroups = search.get('columnGroups') === 'on';
// Cycle 18 / Task 5 — `?pivotDemo=on` opts a handful of categorical
// columns into `enablePivot: true` and a handful of numeric columns
// into `enableValue: true` so the columns tool panel's Column Labels
// + Values drop zones have something to accept. Side bar opens with
// the Columns panel active so the pivot affordances are visible on
// mount. Off by default so visual cells stay byte-stable.
const pivotDemo = search.get('pivotDemo') === 'on';
// Cycle 18 / Task 6 — `?pivotPanel=always|onlyWhenPivoting` mounts the
// top-of-grid pivot panel (drop strip ABOVE the row group panel). Pairs
// with `?pivotDemo=on` so categorical columns carry `enablePivot` and
// can land in the panel via drag.
const pivotPanelShowRaw = search.get('pivotPanel');
const pivotPanelShow: 'always' | 'onlyWhenPivoting' | undefined =
  pivotPanelShowRaw === 'always' || pivotPanelShowRaw === 'onlyWhenPivoting'
    ? pivotPanelShowRaw
    : undefined;
// Cycle 18 / Task 8a — `?pivotMaxGeneratedColumns=N` forces the cap so
// the E2E can drive a breach without first stamping `enablePivot` on a
// high-cardinality column. Parsed lazily; non-numeric values are
// ignored and the worker default (5000) is used.
const pivotMaxRaw = search.get('pivotMaxGeneratedColumns');
const pivotMaxGeneratedColumns: number | undefined = pivotMaxRaw !== null
  && Number.isFinite(Number(pivotMaxRaw))
    ? Number(pivotMaxRaw)
    : undefined;
// Cycle 21c / Task 18 — `?formatDsl=1` wires @wellsfargo-starui/velocity-grid-format and upgrades
// the Price column to a Tier 1 DSL string formatter. Opt-in so the
// existing functional + visual baselines stay byte-stable.
const formatDsl = search.get('formatDsl') === '1';
const grid = createPositionsGrid(host, { editType, variableHeights, autoHeight, cellClassDemo, customPanel, openColumns, statusBar, totalsRowPosition, pinnedTop, pinnedBottom, suppressAggHeader, groupByTicker, groupMultipleColumns, groupingDemo, rowGroupPanelEmpty, rowGroupPanelThreeChips, rowGroupPanelAlways, rowGroupPanelMarketsGrid, groupSelectsChildren, groupIncludeFooter, groupIncludeTotalFooter, pinning, columnGroups, groupHideOpenParents, isGroupOpenByDefault, suppressCount, suppressGroupChangesColumnVisibility, groupTotalRow, grandTotalRow, groupMaintainOrder, groupDefaultExpanded, groupAggFiltering, groupColumnFilter, keyCreatorDemo, pivotDemo, pivotPanelShow, pivotMaxGeneratedColumns, formatDsl });

// Toolbar feature-toggle checkboxes. Toggling reloads the page with
// the matching URL flag set / unset because the structural changes
// (column defs differ when pinning / groups flip; rowGroupCols seeds
// at construction) re-apply cleanly on a fresh mount. Pre-check
// reflects the current URL state.
function wireFeatureToggle(id: string, flagName: string, flagOnValue: string, isOn: boolean): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  el.checked = isOn;
  el.addEventListener('change', () => {
    const url = new URL(location.href);
    if (el.checked) url.searchParams.set(flagName, flagOnValue);
    else url.searchParams.delete(flagName);
    location.href = url.toString();
  });
}
wireFeatureToggle('toggle-pinning',         'pinning',       'on',     pinning);
wireFeatureToggle('toggle-column-groups',   'columnGroups',  'on',     columnGroups);
wireFeatureToggle('toggle-row-group-panel', 'rowGroupPanel', 'always', rowGroupPanelAlways);
wireFeatureToggle('toggle-open-columns',    'openColumns',   '1',      openColumns);

// E2E hooks: expose the grid + a readiness flag so Playwright tests can wait
// for first-data-rendered and call api helpers (`getCellBoundsAt`,
// `getCellValue`) instead of guessing pixel coordinates.
(window as unknown as { __velocity-grid: typeof grid }).__cgrid = grid;
(window as unknown as { __cgridReady: boolean }).__cgridReady = false;
grid.on('firstDataRendered', () => {
  (window as unknown as { __cgridReady: boolean }).__cgridReady = true;
});

// Cycle 15.5 / Task 1 — Playwright harness for the row group panel's
// pill reorder. Drives a pointerdown + pointermove sequence directly
// at the DOM level so the screenshot can capture the panel mid-drag.
// `pillReorderMidDrag` parks the pointer in the gap between pills 1
// and 2; the insertion line + drag ghost mount as side effects. The
// caller does NOT release the pointer — the test snapshots the panel
// while the drag is still in flight, so the gesture is intentionally
// "stuck" mid-flight.
(window as unknown as {
  __cgridPlaywright?: { pillReorderMidDrag: () => void };
}).__cgridPlaywright = {
  pillReorderMidDrag: () => {
    const chips = document.querySelectorAll('.vg-row-group-panel-chip');
    if (chips.length < 3) return;
    const sourceChip = chips[chips.length - 1] as HTMLElement;
    const target = chips[1] as HTMLElement;
    const sourceRect = sourceChip.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const downX = sourceRect.left + sourceRect.width / 2;
    const downY = sourceRect.top + sourceRect.height / 2;
    const overX = targetRect.left - 4;
    const overY = targetRect.top + targetRect.height / 2;
    class HarnessPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(t: string, i: MouseEventInit) {
        super(t, i);
        this.pointerId = 1;
        this.pointerType = 'mouse';
      }
    }
    const dispatch = (
      target: EventTarget,
      type: 'pointerdown' | 'pointermove',
      clientX: number,
      clientY: number,
    ): void => {
      target.dispatchEvent(
        new HarnessPointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
        }),
      );
    };
    dispatch(sourceChip, 'pointerdown', downX, downY);
    // Two pointermoves: the first crosses the 4 px threshold, the
    // second parks at the target gap.
    dispatch(window, 'pointermove', downX - 8, downY);
    dispatch(window, 'pointermove', overX, overY);
    // Deliberately NO pointerup — the test captures the panel mid-drag.
  },
};

/** Synthetic multi-line description for the `notes` column so Cycle 5 /
 *  Task 8's autoHeight has real text to wrap + measure. Deterministic per
 *  positionId so the E2E can predict which rows go tall. ~1 in 3 rows
 *  carries a string sized to wrap to ~2-3 lines at the notes column width;
 *  the rest stay empty (no autoHeight contribution → fallback row height).
 *  Kept short so the viewport still fits ≥ 10 rows for the Cycle 5 / Task
 *  6 variable-heights spec to scan a meaningful window. */
function autoHeightDescription(positionId: string): string {
  const last = positionId.charCodeAt(positionId.length - 1);
  // Disjoint from Cycle 5 / Task 6's `last % 4 === 0` rule so the two demos
  // never apply to the same row — keeps each spec's assertions clean.
  if (last % 3 !== 0 || last % 4 === 0) return '';
  return `autoHeight wrap demo ${positionId}`;
}

// Cycle 15 / Task 6 — deterministic client-side decorator that adds
// desk / region / currency / trader to STOMP-arriving rows. STOMP
// doesn't carry these fields; values derive from a positionId hash so
// they're stable across snapshots + updates (so grouping never sees a
// row "move" between desks just because an update arrived). Unknown
// fields are silently dropped at the worker boundary when no column
// declares them, so the decorator is on by default — visual cells
// without these columns stay byte-stable.
const DESKS = ['Equities', 'Fixed Income', 'FX', 'Commodities'];
const REGIONS = ['Americas', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF'];
const TRADERS = ['A. Smith', 'B. Patel', 'C. Wong', 'D. Garcia', 'E. Rossi', 'F. Müller', 'G. Khan', 'H. Lopez'];
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function decorateWithCategoricals<T extends { positionId: string; desk?: string; region?: string; currency?: string; trader?: string }>(row: T): T {
  const id = row.positionId;
  if (row.desk == null)     row.desk     = DESKS[hash32(id + 'd') % DESKS.length];
  if (row.region == null)   row.region   = REGIONS[hash32(id + 'r') % REGIONS.length];
  if (row.currency == null) row.currency = CURRENCIES[hash32(id + 'c') % CURRENCIES.length];
  if (row.trader == null)   row.trader   = TRADERS[hash32(id + 't') % TRADERS.length];
  return row;
}

grid.on('gridReady', () => {
  console.log('[velocity-grid] ready');
  connectStomp({
    onSnapshot: (rows) => {
      // Only seed synthetic descriptions when the autoHeight demo is
      // opted in (otherwise the default uniform-row demo would render
      // "autoHeight wrap demo ..." in 1-of-3 notes cells for no
      // visible reason).
      if (autoHeight) {
        for (const r of rows) {
          if (r.notes == null || r.notes === '') r.notes = autoHeightDescription(r.positionId);
        }
      }
      for (const r of rows) decorateWithCategoricals(r);
      grid.setRowData(rows);
    },
    onLiveUpdate: (updates) => {
      for (const u of updates) decorateWithCategoricals(u);
      grid.applyTransactionAsync({ update: updates });
      recordUpdates(updates.length);
    },
    onPhase: (phase) => console.log('[stomp] phase:', phase),
  });
});

grid.on('modelUpdated', (e) => console.log('[velocity-grid] modelUpdated, visible:', e.visibleRowCount));

// ───────────────────────────────────────────────────────────────────
// Status pill — row count + updates/sec. The row count reflects the
// grid's current displayed-row count (post-filter); updates/sec is a
// 1-second sliding window over the STOMP onLiveUpdate batches that
// arrive via `recordUpdates(n)`.
// ───────────────────────────────────────────────────────────────────
const rowsEl = document.querySelector('[data-testid="status-rows"]');
const upsProcessedEl = document.querySelector('[data-testid="status-ups-processed"]');
const upsPublishedEl = document.querySelector('[data-testid="status-ups-published"]');
type UpdateSample = { t: number; n: number };
const updateSamples: UpdateSample[] = [];
function recordUpdates(n: number): void {
  if (n <= 0) return;
  updateSamples.push({ t: performance.now(), n });
}
const liveDotEl = document.querySelector<HTMLElement>('.live-dot');
function refreshStatus(): void {
  if (rowsEl) {
    const api = grid as unknown as { getDisplayedRowCount?: () => number };
    const count = api.getDisplayedRowCount?.() ?? 0;
    rowsEl.textContent = count.toLocaleString();
  }
  // Drop samples older than 1 second so the rate is a rolling 1s window.
  const cutoff = performance.now() - 1000;
  while (updateSamples.length > 0 && updateSamples[0]!.t < cutoff) {
    updateSamples.shift();
  }
  const sum = updateSamples.reduce((s, x) => s + x.n, 0);
  if (upsProcessedEl) upsProcessedEl.textContent = sum.toLocaleString();
  if (upsPublishedEl) upsPublishedEl.textContent = STOMP_PUBLISH_RATE_PER_SEC.toLocaleString();
  // Live-dot pulses green while data is flowing (any sample in the last
  // second), otherwise it sits idle grey. Single accent surface — every
  // other control stays neutral.
  if (liveDotEl) liveDotEl.dataset.state = sum > 0 ? 'live' : 'idle';
}
setInterval(refreshStatus, 250);
refreshStatus();

let darkTheme = true;
const appShell = document.querySelector<HTMLElement>('.app');
document.getElementById('theme')?.addEventListener('click', () => {
  darkTheme = !darkTheme;
  grid.setTheme(darkTheme ? 'vg-theme-cursor-dark' : 'vg-theme-cursor');
  host.classList.toggle('vg-theme-cursor', !darkTheme);
  host.classList.toggle('vg-theme-cursor-dark', darkTheme);
  // Flip the page-chrome theme alongside the grid so the wordmark,
  // toolbar, and inputs read the matching token set.
  if (appShell) appShell.dataset.theme = darkTheme ? 'dark' : 'light';
});

// Cycle 6 / Task 2 — Save / Restore / Reset column-layout buttons. The
// state round-trips through localStorage so a page reload exercises the
// real persistence path. Reset replays the construction-time snapshot.
const LAYOUT_KEY = 'vg-layout';
document.getElementById('save-layout')?.addEventListener('click', () => {
  const api = grid as unknown as { getColumnState: () => unknown };
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.getColumnState()));
});
document.getElementById('restore-layout')?.addEventListener('click', () => {
  const raw = localStorage.getItem(LAYOUT_KEY);
  if (!raw) return;
  const api = grid as unknown as { applyColumnState: (p: unknown) => boolean };
  api.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
});
document.getElementById('reset-layout')?.addEventListener('click', () => {
  const api = grid as unknown as { resetColumnState: () => void };
  api.resetColumnState();
});

// Cycle 6 / Task 3 — distribute the canvas drawable width across the
// visible non-`suppressSizeToFit` leaves. Clicking the button forces a
// fit even after the user has manually resized columns.
document.getElementById('fit-columns')?.addEventListener('click', () => {
  const api = grid as unknown as { sizeColumnsToFit: (p?: unknown) => void };
  api.sizeColumnsToFit();
});

// Cycle 6 / Task 4 — autosize every visible non-`suppressAutoSize` leaf
// to its widest visible content. Awaits the worker measure pass; the
// fire-and-forget Promise lets the button stay responsive.
document.getElementById('autosize-all')?.addEventListener('click', () => {
  const api = grid as unknown as { autoSizeAllColumns: (skipHeader?: boolean) => Promise<void> };
  void api.autoSizeAllColumns();
});

// Cycle 6 / Task 5 — imperative column API. Three buttons exercise the
// batch mutation surface against the live demo grid.
document.getElementById('imp-hide-pnl')?.addEventListener('click', () => {
  const api = grid as unknown as { setColumnsVisible: (keys: string[], visible: boolean) => void };
  api.setColumnsVisible(['pnl', 'dailyPnl', 'unrealizedPnl'], false);
});
document.getElementById('imp-pin-spread')?.addEventListener('click', () => {
  const api = grid as unknown as { setColumnsPinned: (keys: string[], pinned: 'left' | 'right' | null) => void };
  api.setColumnsPinned(['spread'], 'left');
});
document.getElementById('imp-reset-widths')?.addEventListener('click', () => {
  const api = grid as unknown as {
    setColumnWidths: (widths: Array<{ key: string; newWidth: number }>, finished?: boolean) => void;
  };
  api.setColumnWidths([
    { key: 'ticker', newWidth: 100 },
    { key: 'cusip', newWidth: 110 },
    { key: 'notionalAmount', newWidth: 130 },
    { key: 'marketValue', newWidth: 130 },
  ]);
});

// Cycle 7 / Task 8 — toolbar "Positive P&L only" checkbox toggles the
// demo's external filter. The grid's `isExternalFilterPresent` reads
// the module-level flag inside positionsGrid; flipping it triggers
// `onFilterChanged('externalFilter')` which fires the worker round-trip.
// `change` event (not `click`) so keyboard activations also fire.
const positivePnlCheckbox = document.getElementById('ext-positive-pnl') as HTMLInputElement | null;
if (positivePnlCheckbox) {
  positivePnlCheckbox.addEventListener('change', () => {
    setPositiveOnlyFilter(grid, positivePnlCheckbox.checked);
  });
}

// Cycle 8 / Task 4 — toolbar "Pin selected to top" checkbox. Toggling on
// snapshots the current selection into the demo's pin set; the
// `postSortRows` callback then moves those rows to the top regardless
// of the active sort. Toggling off clears the pin set. The toggle
// re-applies the current sort model to fire the post-sort hook.
const pinSelectedCheckbox = document.getElementById('pin-selected-top') as HTMLInputElement | null;
if (pinSelectedCheckbox) {
  pinSelectedCheckbox.addEventListener('change', () => {
    setPinSelectedToTop(grid, pinSelectedCheckbox.checked);
  });
}

// Cycle 10 / Task 3 — clipboard delimiter selector. Picking a value drives
// `setGridOption('clipboardDelimiter', value)` so Ctrl+C / Ctrl+X land in
// the chosen format on the next copy. `'tab'` maps to the default `'\t'`
// (TSV — what Excel / Sheets paste as a grid); the others switch to CSV,
// SSV (semicolon — common in European locales where `,` is decimal), or
// pipe-separated for log-style consumers.
const clipboardDelimiterSelect = document.getElementById('clipboard-delimiter') as HTMLSelectElement | null;
if (clipboardDelimiterSelect) {
  clipboardDelimiterSelect.addEventListener('change', () => {
    const v = clipboardDelimiterSelect.value;
    const delim = v === 'tab' ? '\t' : v;
    const api = grid as unknown as {
      setGridOption: (key: 'clipboardDelimiter', value: string) => void;
    };
    api.setGridOption('clipboardDelimiter', delim);
  });
}

// Cycle 7 / Task 7 — cross-column quick filter. Input drives
// `setGridOption('quickFilterText', value)` after a short trailing
// debounce. Without it, a 5-char string would fire 5 worker round-trips
// and 5 repaints; with 200ms the user types the query and only the
// final value reaches the worker. cgrid's applyQuickFilter also drops
// stale replies via its own request-id guard, so this debounce is
// purely about saving wire traffic + paint cost in the demo.
const quickInput = document.getElementById('quick-filter') as HTMLInputElement | null;
if (quickInput) {
  let debounceHandle: number | null = null;
  const QUICK_FILTER_DEBOUNCE_MS = 200;
  quickInput.addEventListener('input', () => {
    if (debounceHandle !== null) window.clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(() => {
      debounceHandle = null;
      const api = grid as unknown as {
        setGridOption: (key: 'quickFilterText', value: string) => void;
      };
      api.setGridOption('quickFilterText', quickInput.value);
    }, QUICK_FILTER_DEBOUNCE_MS);
  });
}

