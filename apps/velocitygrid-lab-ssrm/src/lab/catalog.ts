/**
 * Every tab in the lab, as data.
 *
 * One object per feature: the columns it shows, the grid options that make it
 * that feature, and the guidance the Inspector renders. Adding a tab is adding
 * an entry here — there is no per-tab React to write, which is the whole point
 * of the shape (and the reason the reference lab's tab modules are six lines).
 */
import { baseColumns, defaultColDef, grouped, pickColumns, FORMATS } from '../data/columns';
import type { LabTab } from './types';

const GROUPS = {
  start: 'Getting started',
  format: 'Formatting & paint',
  columns: 'Columns',
  data: 'Data',
  editing: 'Editing',
  state: 'State',
} as const;

export const LAB_TABS: LabTab[] = [
  // ── Getting started ───────────────────────────────────────────────
  {
    id: 'overview',
    group: GROUPS.start,
    label: 'Overview',
    hint: 'Everything on at once',
    title: 'Overview',
    subtitle: 'The whole blotter: 44 columns in semantic header groups, grouped by desk and region, with the side bar, status bar and ext ribbon all live.',
    // The two grouped-by columns are appended OUTSIDE `grouped()`: a hidden
    // row-group column has no place in a visible header group, and wrapping it
    // in one leaves an empty group header behind.
    columns: () => [
      ...grouped(
        baseColumns
          .filter((c) => c.field !== 'desk' && c.field !== 'region')
          .map((c) => ({ ...c, hide: false })),
      ),
      { field: 'desk' as const, headerName: 'Desk', rowGroup: true, hide: true },
      { field: 'region' as const, headerName: 'Region', rowGroup: true, hide: true },
    ],
    options: {
      sideBar: { toolPanels: ['columns', 'filters'] },
      statusBar: true,
      rowGroupPanelShow: 'always',
      grandTotalRow: 'pinnedBottom',
      groupDefaultExpanded: 1,
      enableCellChangeFlash: true,
    },
    stream: { rowCount: 5_000, tickMs: 400 },
    guide: {
      what: 'The kitchen sink, so the first thing you see is the grid doing real work rather than a five-row toy. Every column carries a real format string, the four P&L columns aggregate up the group tree, and the pinned bottom row is a live grand total that re-derives on every tick.',
      try: [
        'Drag Sector into the row-group panel above the header — a third level appears without a refetch.',
        'Open the side bar (right edge) and hide a column; the header groups reflow around the gap.',
        'Watch the pinned Total row while the feed ticks: it recomputes with the book, not on a timer.',
        'Sort by P&L (D) and hold — the sort survives every incoming transaction.',
      ],
      config: `sideBar: { toolPanels: ['columns', 'filters'] },
statusBar: true,
rowGroupPanelShow: 'always',
grandTotalRow: 'pinnedBottom',
groupDefaultExpanded: 1,
enableCellChangeFlash: true`,
    },
  },

  // ── Formatting & paint ────────────────────────────────────────────
  {
    id: 'formatting',
    group: GROUPS.format,
    label: 'Formatting',
    hint: 'Excel format strings',
    title: 'Formatting',
    subtitle: 'Numbers are formatted with Excel format strings, compiled in the worker. No JavaScript formatter runs per cell per paint.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'currency', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'priceChangePct', 'bidAskWidthBps',
      'yieldToMaturity', 'currentYield', 'oas', 'zSpread',
      'modifiedDuration', 'dv01',
      'quantityFace', 'marketValue', 'avgCost',
      'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL', 'maturityDate',
    ]),
    options: { enableCellChangeFlash: true },
    stream: { rowCount: 2_000, tickMs: 500 },
    guide: {
      what: 'A format string is data, not code. It survives a profile round-trip, it can be edited by a user in the format picker, and it compiles once in the worker rather than running a closure for every cell on every frame. The P&L columns use the desk convention: negatives in red parentheses.',
      try: [
        'Right-click a numeric header and open the format picker; change Mid to 4 decimals.',
        'Compare Δ % (a percent format) with OAS (a bps suffix) — both are one string.',
        'Run the Credit selloff scenario and watch P&L flip into red parentheses.',
      ],
      config: `{ field: 'midPrice', valueFormatter: '${FORMATS.price}' }
{ field: 'oas',      valueFormatter: '${FORMATS.bps}' }
{ field: 'dailyPnL', valueFormatter: '${FORMATS.signedMoney}' }`,
    },
  },
  {
    id: 'renderers',
    group: GROUPS.format,
    label: 'Cell renderers',
    hint: '51 canvas renderers',
    title: 'Cell renderers',
    subtitle: 'Pills, bars, sparklines and composites — all painted straight onto the canvas, so a renderer costs a draw call rather than a DOM node.',
    columns: () => [
      ...pickColumns(['cusip', 'ticker', 'instrumentDescription']),
      { field: 'compositeRating', headerName: 'Rating', width: 96, cellRenderer: 'rating-badge' },
      { field: 'assetClass', headerName: 'Class', width: 128, cellRenderer: 'tag' },
      { field: 'midPrice', headerName: 'Mid', width: 104, cellDataType: 'number', align: 'right', cellRenderer: 'price-direction', valueFormatter: FORMATS.price },
      { field: 'priceChangePct', headerName: 'Δ %', width: 104, cellDataType: 'number', align: 'right', cellRenderer: 'pct-change' },
      { colId: 'spreadBar', field: 'oas', headerName: 'OAS', width: 132, cellRenderer: 'spread-bar' },
      { field: 'modifiedDuration', headerName: 'Duration', width: 128, cellRenderer: 'heat' },
      { colId: 'krd', headerName: 'KRD curve', width: 132, sortable: false, cellRenderer: 'krd-bar-chart',
        valueGetter: ({ data }) => (data ? [data.krd1Y, data.krd2Y, data.krd5Y, data.krd10Y, data.krd30Y] : undefined) },
      { field: 'unrealizedPnL', headerName: 'Unreal P&L', width: 140, cellDataType: 'number', align: 'right', cellRenderer: 'pnl', valueFormatter: FORMATS.signedMoney },
      { field: 'dailyPnL', headerName: 'P&L (D)', width: 132, cellRenderer: 'bidirectional-bar' },
      { field: 'lastUpdate', headerName: 'Age', width: 96, cellRenderer: 'age' },
    ],
    options: { rowHeight: 26, enableCellChangeFlash: true },
    stream: { rowCount: 1_200, tickMs: 400 },
    guide: {
      what: 'The renderer catalog is built for blotters: tick-aware numerics that know which way the last change went, rating badges that band by credit quality, bars that scale to the column, and in-cell charts. Because they paint on canvas there is no per-cell DOM, so a thousand visible renderers cost the same as a thousand visible numbers.',
      try: [
        'Watch Mid — the direction glyph follows the last tick, not the sign of the value.',
        'Run Curve steepener and watch the KRD chart change shape as the long end sells off.',
        'Scroll fast: the renderers are cached as bitmaps and blitted, so scrolling stays smooth.',
      ],
      config: `{ field: 'compositeRating', cellRenderer: 'rating-badge' }
{ field: 'midPrice',        cellRenderer: 'price-direction' }
{ field: 'dailyPnL',        cellRenderer: 'bidirectional-bar' }
{ colId: 'krd',             cellRenderer: 'krd-bar-chart',
  valueGetter: ({ data }) => [data.krd1Y, …, data.krd30Y] }`,
    },
  },
  {
    id: 'toolbar',
    group: GROUPS.format,
    label: 'Format toolbar',
    hint: 'Live cell styling',
    title: 'Format toolbar',
    subtitle: 'Select cells and restyle them from the ribbon — colours, weights, number formats — with every change landing as profile data.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'assetClass', 'currency', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'priceChangePct',
      'yieldToMaturity', 'oas', 'zSpread', 'modifiedDuration', 'dv01',
      'quantityFace', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'book', 'trader',
    ]),
    options: { cellSelection: { suppressHeader: false }, enableCellChangeFlash: true },
    stream: { rowCount: 1_500, tickMs: 600 },
    guide: {
      what: 'The ribbon\'s Format group operates on the current selection the way a spreadsheet does. What it produces is not inline style but column and cell-range configuration, which means it is saveable, shareable and survives a reload.',
      try: [
        'Drag-select a block of P&L cells, then set a background colour from the ribbon.',
        'Select a whole column by its header and change its number format.',
        'Reload the page — the styling is still there, because it was saved as configuration.',
      ],
      config: `cellSelection: { suppressHeader: false }
// ribbon Format group comes from ribbonExtensions()`,
    },
  },
  {
    id: 'conditional',
    group: GROUPS.format,
    label: 'Conditional styling',
    hint: 'Rules that paint',
    title: 'Conditional styling',
    subtitle: 'Expression rules evaluated per cell, per paint, in the worker — so a rule over a ticking column keeps up with the ticks.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'compositeRating', 'issuerSector',
      'bidPrice', 'midPrice', 'askPrice', 'priceChangePct', 'bidAskWidthBps',
      'yieldToMaturity', 'oas', 'zSpread', 'modifiedDuration',
      'marketValue', 'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL', 'lastUpdate',
    ]),
    options: { enableCellChangeFlash: true },
    stream: { rowCount: 2_000, tickMs: 400 },
    guide: {
      what: 'Rules are conditions plus a paint: background, text colour, weight, an indicator glyph, even a replacement number format. They live in the grid\'s configuration rather than in your component, so a trader can add one without a deploy.',
      try: [
        'Open Customize → Conditional styling and add a rule: dailyPnL < 0 paints the cell red.',
        'Add a second rule on compositeRating for high yield and give it an indicator icon.',
        'Run Sector downgrade — the rating rule fires on a text change, with no numeric move.',
      ],
      config: `import { wireIntoKernel as wireRules }
  from '@wellsfargo-starui/velocity-grid/rules';
wireRules(grid);
// rules are then authored in Customize → Conditional styling`,
    },
  },

  // ── Columns ───────────────────────────────────────────────────────
  {
    id: 'groups',
    group: GROUPS.columns,
    label: 'Column groups',
    hint: 'Nested headers',
    title: 'Column groups',
    subtitle: 'The blotter\'s eight semantic groups, with collapsible headers that keep a representative column visible when closed.',
    columns: () => grouped(pickColumns([
      'cusip', 'ticker', 'instrumentDescription',
      'assetClass', 'issuerSector', 'currency', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'priceChangePct',
      'yieldToMaturity', 'yieldToWorst', 'oas', 'zSpread',
      'modifiedDuration', 'dv01', 'convexity',
      'quantityFace', 'marketValue', 'avgCost',
      'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL',
      'desk', 'book', 'trader',
    ])),
    stream: { rowCount: 2_000, tickMs: 600 },
    guide: {
      what: 'Groups are structure, not decoration: they encode which columns belong to the same idea. On a 44-column blotter that is the difference between a wall of numbers and something a trader can read.',
      try: [
        'Collapse the Risk group — the columns fold away and the header spans the gap.',
        'Drag a column out of one group and into another; the tree reflows.',
        'Group by Sector as well and note the header groups survive row grouping.',
      ],
      config: `columnDefs: [
  { headerName: 'Pricing', groupId: 'Pricing', children: [
    { field: 'bidPrice' }, { field: 'midPrice' }, { field: 'askPrice' },
  ]},
  …
]`,
    },
  },
  {
    id: 'calc',
    group: GROUPS.columns,
    label: 'Calculated columns',
    hint: 'Derived, no round trip',
    title: 'Calculated columns',
    subtitle: 'Columns that are expressions over other columns, recomputed in the worker as the inputs tick.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'bidAskWidthBps',
      'yieldToMaturity', 'benchmarkYield', 'oas',
      'modifiedDuration', 'dv01', 'convexity',
      'quantityFace', 'marketValue', 'avgCost', 'unrealizedPnL', 'dailyPnL',
    ]),
    options: { enableCellChangeFlash: true },
    stream: { rowCount: 1_500, tickMs: 500 },
    guide: {
      what: 'A calculated column is a formula the grid owns. The B/A width column on this tab is one: it has no field behind it, it is derived from bid and ask, and it re-derives on every tick without a server round trip or a React render.',
      try: [
        'Open Customize → Calculated columns and add: yieldToMaturity - benchmarkYield.',
        'Name it "Pickup" and give it a bps format — it appears with the others.',
        'Run Liquidity gap and watch B/A (bps) widen eightfold while nothing else moves.',
      ],
      config: `{ colId: 'bidAskWidthBps',
  valueGetter: ({ data }) => (data.askPrice - data.bidPrice) * 100,
  valueFormatter: '${FORMATS.bps}' }
// or author one at runtime in Customize → Calculated columns`,
    },
  },
  {
    id: 'expressions',
    group: GROUPS.columns,
    label: 'Expression lab',
    hint: 'Try expressions live',
    title: 'Expression lab',
    subtitle: 'The expression engine behind calculated columns, filters and rules, with a scratchpad to try syntax against real rows.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'compositeRating', 'issuerSector',
      'midPrice', 'yieldToMaturity', 'benchmarkYield', 'oas', 'zSpread',
      'modifiedDuration', 'dv01', 'marketValue', 'unrealizedPnL', 'dailyPnL',
    ]),
    stream: { rowCount: 1_000, tickMs: 700 },
    guide: {
      what: 'One expression language serves calculated columns, conditional rules and saved filters, so a formula you work out in one place is portable to the others. Expressions are compiled and evaluated in the worker, never eval\'d on the main thread.',
      try: [
        'Open Customize → Expression lab and evaluate: oas - zSpread.',
        'Try a boolean: modifiedDuration > 8 && compositeRating == "BBB".',
        'Take a working expression and paste it into a conditional rule.',
      ],
      config: `import { wireIntoKernel as wireCalc }
  from '@wellsfargo-starui/velocity-grid/calc';
wireCalc(grid);`,
    },
  },
  {
    id: 'filters',
    group: GROUPS.columns,
    label: 'Saved filters',
    hint: 'Filter pills',
    title: 'Saved filters',
    subtitle: 'Name a filter combination once and it becomes a pill in the title bar — the desk\'s standing views, one click away.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'assetClass', 'issuerSector',
      'compositeRating', 'currency', 'desk', 'book', 'trader',
      'bidPrice', 'midPrice', 'askPrice', 'yieldToMaturity', 'oas',
      'modifiedDuration', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'mtdPnL',
    ]),
    options: { sideBar: { toolPanels: ['filters', 'columns'] } },
    stream: { rowCount: 3_000, tickMs: 600 },
    guide: {
      what: 'Set filters over a live book have a subtlety worth seeing: the value list has to track the data as it ticks. Saved filters wrap a whole filter model — several columns at once — behind a single named pill.',
      try: [
        'Filter Rating to the high-yield values and Duration to greater than 8.',
        'Save it from the title bar as "HY long end"; it becomes a pill.',
        'Clear the filters, then click the pill — the whole model comes back.',
      ],
      config: `sideBar: { toolPanels: ['filters', 'columns'] }
// pills come from titleBarExtensions() → savedFiltersItem()`,
    },
  },

  // ── Data ──────────────────────────────────────────────────────────
  {
    id: 'live',
    group: GROUPS.data,
    label: 'Live updates',
    hint: 'Ticks, flash, damage',
    title: 'Live updates',
    subtitle: 'A high-frequency stream behind the datasource. The grid is told its blocks are stale and re-reads the window in view, never the book.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'lastPrice', 'priceChange', 'priceChangePct',
      'yieldToMaturity', 'oas', 'zSpread', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'lastUpdate',
    ]),
    options: { enableCellChangeFlash: true },
    stream: { rowCount: 10_000, tickMs: 250 },
    guide: {
      what: 'Ten thousand rows behind the datasource, ticking at a quarter-second. Because the grid holds a window rather than a book, a tick is not a transaction it applies — it is a soft refresh that re-reads the blocks in view and leaves the rest of the cache alone.',
      try: [
        'Drop the tick interval to 100 ms in the demo console and watch the tape.',
        'Pause the feed — the tape drains to grey, which is the point of showing a rate.',
        'Sort by Δ % while it ticks; the sort holds and rows reorder as values cross.',
      ],
      config: `enableCellChangeFlash: true
// snapshot → grid.refreshServerSide({ purge: true })
// ticks    → grid.refreshServerSide({ purge: false })`,
    },
  },
  {
    id: 'grouping',
    group: GROUPS.data,
    label: 'Grouping & totals',
    hint: 'Aggregate up the tree',
    title: 'Grouping and aggregation',
    subtitle: 'Group by desk, region and sector; sum notional and P&L up every level, with group totals that keep ticking.',
    columns: () => [
      { field: 'desk' as const, headerName: 'Desk', width: 140, rowGroup: true, hide: true },
      { field: 'region' as const, headerName: 'Region', width: 120, rowGroup: true, hide: true },
      ...pickColumns([
        'cusip', 'ticker', 'instrumentDescription', 'compositeRating', 'issuerSector',
        'midPrice', 'yieldToMaturity', 'oas', 'modifiedDuration',
        'quantityFace', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL',
      ]),
    ],
    options: {
      rowGroupPanelShow: 'always',
      groupDefaultExpanded: 1,
      grandTotalRow: 'pinnedBottom',
      suppressAggFuncInHeader: false,
      statusBar: true,
    },
    stream: { rowCount: 6_000, tickMs: 400 },
    guide: {
      what: 'The datasource returns pre-aggregated totals on the skeleton, so a collapsed group shows the true sum of everything under it without the grid ever seeing those rows. The `path: []` entry carries the grand total, which is what feeds the pinned bottom row.',
      try: [
        'Drag Sector into the group panel for a third level.',
        'Collapse everything and confirm the totals are still whole-book sums.',
        'Turn on the status bar aggregation and select a range of P&L cells.',
      ],
      config: `// the datasource replies with one entry per group, at every depth
{ path: ['Credit', 'EMEA'], leafCount: 812,
  aggregates: { marketValue: 4_120_338, dailyPnL: -92_004 } }
// plus one for the grand total
{ path: [], leafCount: 6000, aggregates: { … } }`,
    },
  },
  {
    id: 'pivot',
    group: GROUPS.data,
    label: 'Pivot',
    hint: 'Cross-tab the book',
    title: 'Pivot',
    subtitle: 'Sector down the side, rating across the top, market value in the cells — a cross-tab built in the worker.',
    columns: () => [
      { field: 'issuerSector' as const, headerName: 'Sector', width: 150, rowGroup: true, hide: true },
      { field: 'compositeRating' as const, headerName: 'Rating', width: 100, pivot: true, hide: true },
      { field: 'marketValue' as const, headerName: 'Mkt Value', width: 140, aggFunc: 'sum', cellDataType: 'number', align: 'right', valueFormatter: FORMATS.money },
      { field: 'unrealizedPnL' as const, headerName: 'Unreal P&L', width: 140, aggFunc: 'sum', cellDataType: 'number', align: 'right', valueFormatter: FORMATS.signedMoney },
    ],
    options: { pivotMode: true, sideBar: { toolPanels: ['columns'] }, groupDefaultExpanded: 1 },
    stream: { rowCount: 6_000, tickMs: 800 },
    guide: {
      what: 'Pivot columns are generated from the data, so the column set changes when the data does. Turning pivot mode off returns you to the flat book with the same grouping intact.',
      try: [
        'Open the side bar and drag Currency into Column labels for a second pivot dimension.',
        'Switch the value column to sum of Qty (face).',
        'Turn Pivot Mode off in the side bar — the grouping survives the switch.',
      ],
      config: `pivotMode: true,
{ field: 'issuerSector',    rowGroup: true, hide: true }
{ field: 'compositeRating', pivot: true,    hide: true }
{ field: 'marketValue',     aggFunc: 'sum' }`,
    },
  },
  {
    id: 'alerts',
    group: GROUPS.data,
    label: 'Alerts',
    hint: 'Triggers on the stream',
    title: 'Alerts',
    subtitle: 'Conditions watched against the live stream, raising a toast and a bell count when a row crosses the line.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'compositeRating',
      'midPrice', 'priceChangePct', 'yieldToMaturity', 'oas', 'zSpread',
      'modifiedDuration', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'lastUpdate',
    ]),
    options: { enableCellChangeFlash: true },
    stream: { rowCount: 2_500, tickMs: 350 },
    guide: {
      what: 'An alert is a rule with a delivery channel. It evaluates where the data already is — in the worker, against the whole book — so it fires on rows that are scrolled out of view, which is exactly when you need it.',
      try: [
        'Open Customize → Alerts and add: dailyPnL < -250000, channel toast.',
        'Run Credit selloff and watch the bell count climb.',
        'Add a rate limit so a fast-moving row cannot spam you.',
      ],
      config: `// Customize → Alerts
{ when: 'dailyPnL < -250000',
  channels: ['toast', 'bell'],
  rateLimitMs: 5000 }`,
    },
  },

  // ── Editing ───────────────────────────────────────────────────────
  {
    id: 'editing',
    group: GROUPS.editing,
    label: 'Editing',
    hint: 'The editing family',
    title: 'Editing',
    subtitle: 'Type over a cell, paste a block, fill down from a handle — with edits landing as transactions against the same book the feed is writing.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'compositeRating', 'issuerSector',
      'bidPrice', 'midPrice', 'askPrice', 'avgCost', 'quantityFace',
      'marketValue', 'unrealizedPnL', 'dailyPnL', 'book', 'trader', 'accountName',
    ]),
    options: {
      defaultColDef: { ...defaultColDef, editable: true },
      cellSelection: { suppressHeader: true },
    },
    stream: { rowCount: 1_200, tickMs: 900 },
    guide: {
      what: 'On the server-side path an edit cannot be a local mutation — the grid does not own the row. Edits go out as server-side transactions, and what comes back on the next refresh is whatever the book now says. That round trip is the honest model for a shared book.',
      try: [
        'Edit Avg Cost on a row and watch Unreal P&L follow on the next tick.',
        'Select a range and paste a column of values from a spreadsheet.',
        'Drag the fill handle down from a cell to repeat it.',
      ],
      config: `defaultColDef: { editable: true },
cellSelection: { suppressHeader: true }
// wireEditIntoKernel(grid) enables the editing family`,
    },
  },
  {
    id: 'bulk',
    group: GROUPS.editing,
    label: 'Bulk update',
    hint: 'Set a selection at once',
    title: 'Bulk update',
    subtitle: 'Replace every cell in a selection with one value, or nudge them all by an amount, in a single transaction.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'avgCost',
      'quantityFace', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'book', 'trader',
    ]),
    options: { defaultColDef: { ...defaultColDef, editable: true }, cellSelection: { suppressHeader: true } },
    stream: { rowCount: 1_200, tickMs: 900 },
    guide: {
      what: 'One transaction, not one per cell. That matters at blotter scale: setting a thousand cells as a thousand transactions would repaint a thousand times, and the undo stack would need a thousand steps to walk back.',
      try: [
        'Select a block of Avg Cost cells and set them all to 99.5 from the ribbon.',
        'Undo — the whole block comes back in one step.',
        'Try a relative change instead of an absolute one.',
      ],
      config: `// ribbon → Bulk update, over the current cell selection
cellSelection: { suppressHeader: true }`,
    },
  },
  {
    id: 'plusminus',
    group: GROUPS.editing,
    label: 'Plus / minus',
    hint: 'Keyboard nudge',
    title: 'Plus / minus',
    subtitle: 'Nudge a numeric cell with + and −, by a step that depends on the column.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'avgCost',
      'yieldToMaturity', 'oas', 'zSpread', 'modifiedDuration', 'quantityFace',
    ]),
    options: { defaultColDef: { ...defaultColDef, editable: true } },
    stream: { rowCount: 800, tickMs: 1_000 },
    guide: {
      what: 'A price moves in ticks, a spread moves in basis points, a quantity moves in lots. One global step size would be wrong for all three, so the step is per column — which is what makes keyboard nudging usable on a real blotter.',
      try: [
        'Focus a Mid cell and press + a few times — it moves by an eighth.',
        'Move to OAS and press + — a different step, because it is a spread.',
        'Hold shift for the coarse step.',
      ],
      config: `// Customize → Plus/Minus
{ colId: 'midPrice', step: 0.125, shiftStep: 1 }
{ colId: 'oas',      step: 1,     shiftStep: 10 }`,
    },
  },
  {
    id: 'shortcuts',
    group: GROUPS.editing,
    label: 'Shortcuts',
    hint: 'Letter-key arithmetic',
    title: 'Shortcuts',
    subtitle: 'Single letters that mean an operation: type k on a quantity for thousands, m for millions.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription',
      'quantityFace', 'bidSize', 'askSize', 'marketValue', 'avgDailyVolume30d', 'avgCost', 'midPrice',
    ]),
    options: { defaultColDef: { ...defaultColDef, editable: true } },
    stream: { rowCount: 800, tickMs: 1_000 },
    guide: {
      what: 'Traders type in the units of the desk. "5m" is five million, not the string 5m, and making the grid understand that removes a whole category of fat-finger error at the point where it would otherwise be introduced.',
      try: [
        'Type 5m into a Qty (face) cell and press Enter.',
        'Try 250k, then 1.5b.',
        'Try a letter with no rule — the edit is rejected rather than silently mangled.',
      ],
      config: `// Customize → Shortcuts
{ key: 'k', multiply: 1_000 }
{ key: 'm', multiply: 1_000_000 }`,
    },
  },
  {
    id: 'history',
    group: GROUPS.editing,
    label: 'Change history',
    hint: 'What changed, and who',
    title: 'Change history',
    subtitle: 'Every edit recorded with its before value, its after value and its origin — separable from what the feed did.',
    columns: () => pickColumns([
      'cusip', 'ticker', 'instrumentDescription',
      'bidPrice', 'midPrice', 'askPrice', 'avgCost', 'quantityFace',
      'marketValue', 'unrealizedPnL', 'book', 'trader',
    ]),
    options: { defaultColDef: { ...defaultColDef, editable: true }, enableCellChangeFlash: true },
    stream: { rowCount: 1_000, tickMs: 800 },
    guide: {
      what: 'On a live blotter "what changed?" is ambiguous — the feed changes things constantly. History records user edits specifically, which is the set anyone auditing actually cares about.',
      try: [
        'Edit three cells, then open the history panel from the ribbon.',
        'Note that the ticking columns are absent — only your edits are recorded.',
        'Revert one entry from the panel.',
      ],
      config: `// ribbon → History, backed by the dataChangeHistory module`,
    },
  },

  // ── State ─────────────────────────────────────────────────────────
  {
    id: 'profiles',
    group: GROUPS.state,
    label: 'Profiles & layouts',
    hint: 'Save the whole view',
    title: 'Profiles and layouts',
    subtitle: 'Columns, widths, sorts, filters, groups, formats and rules — saved as one named view and restored whole.',
    columns: () => grouped(pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'assetClass', 'issuerSector', 'compositeRating',
      'bidPrice', 'midPrice', 'askPrice', 'priceChangePct',
      'yieldToMaturity', 'oas', 'modifiedDuration', 'dv01',
      'quantityFace', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'mtdPnL',
      'desk', 'book', 'trader',
    ])),
    options: { sideBar: { toolPanels: ['columns', 'filters'] }, rowGroupPanelShow: 'always' },
    stream: { rowCount: 2_000, tickMs: 700 },
    guide: {
      what: 'A profile is the whole configured view as JSON. That is what makes the rest of this lab shippable: the formats, rules and calculated columns you author in the UI are data, so they can be saved, shared with a desk, and version-controlled.',
      try: [
        'Rearrange columns, add a filter and a sort, then save a profile from the title bar.',
        'Change the view again, then switch back to the saved profile.',
        'Reload the page — the active profile is restored.',
      ],
      config: `new VelocityGridExt(host, {
  gridId: 'lab-profiles',
  ext: { profiles: { store: new LocalStorageConfigSession('lab-profiles') } },
})`,
    },
  },
  {
    id: 'export',
    group: GROUPS.state,
    label: 'Export',
    hint: 'CSV and Excel',
    title: 'Export',
    subtitle: 'Write the current view — grouping, formats and all — to .csv or .xlsx from the worker.',
    columns: () => grouped(pickColumns([
      'cusip', 'ticker', 'instrumentDescription', 'compositeRating', 'issuerSector',
      'bidPrice', 'midPrice', 'askPrice', 'yieldToMaturity', 'oas',
      'modifiedDuration', 'dv01', 'quantityFace', 'marketValue',
      'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL', 'desk', 'book',
    ])),
    options: { rowGroupPanelShow: 'always', grandTotalRow: 'pinnedBottom' },
    stream: { rowCount: 3_000, tickMs: 800 },
    guide: {
      what: 'Export runs in the worker over the model, not over the DOM, so what you get is the whole filtered and grouped view rather than the rows that happened to be rendered. Number formats carry across to Excel as Excel formats.',
      try: [
        'Group by Desk, filter to one sector, then export to Excel from the ribbon.',
        'Open the file — the group structure and the formats came with it.',
        'Export to CSV and compare: same rows, no styling.',
      ],
      config: `await grid.exportDataAsExcel({ fileName: 'blotter.xlsx' });
await grid.exportDataAsCsv({ fileName: 'blotter.csv' });`,
    },
  },
];

export const TAB_GROUPS = [GROUPS.start, GROUPS.format, GROUPS.columns, GROUPS.data, GROUPS.editing, GROUPS.state];
export const tabById = (id: string) => LAB_TABS.find((t) => t.id === id);
