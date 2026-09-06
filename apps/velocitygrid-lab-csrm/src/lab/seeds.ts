/**
 * Pre-authored feature configuration, per tab.
 *
 * This is the substance of the lab. A tab that mounts a grid with the right
 * columns and no configuration demonstrates nothing — it is the same grid as
 * every other tab. So each feature tab arrives with real, working content:
 * conditional rules that already paint, calculated columns that already
 * compute, filter pills that already exist, alerts that already fire.
 *
 * Everything here is data. That is the claim the lab is making — that these
 * features are configuration rather than code — so the seeds are also the
 * proof of it, and the Inspector's Config panel shows the same objects.
 *
 * Colours are literal hex rather than theme tokens on purpose: rules are
 * persisted profile data, they carry `{light, dark}` slices so both themes
 * render, and a CSS variable would not survive the round trip.
 */
import type { AlertRule, StyleRule } from '@wellsfargo-starui/velocity-grid/rules';
import type { CalculatedColumnDef } from '@wellsfargo-starui/velocity-grid/calc';
import type { PlusMinusNudge, ShortcutDefinition } from '@wellsfargo-starui/velocity-grid-ext/edit';
import type { SavedFilter } from '@wellsfargo-starui/velocity-grid-ext';

export interface LabSeed {
  /** Conditional styling rules, seeded into the rule engine at wire time. */
  rules?: StyleRule[];
  alertRules?: AlertRule[];
  calculatedColumns?: CalculatedColumnDef[];
  nudges?: PlusMinusNudge[];
  shortcuts?: ShortcutDefinition[];
  savedFilters?: SavedFilter[];
  /** Applied through `setState` once the grid is up. */
  sortModel?: { colId: string; direction: 'asc' | 'desc' }[];
  filterModel?: Record<string, unknown>;
  /**
   * Named layouts the tab arrives with, beyond "Default". Each is captured by
   * applying its state and calling `saveLayout`, so the layouts menu opens
   * with real alternatives rather than one entry — switching between them is
   * the fastest way to see what a saved view actually carries.
   */
  views?: LabView[];
}

export interface LabView {
  name: string;
  /** Replaces the tab's rules while this layout is active. */
  rules?: StyleRule[];
  sortModel?: { colId: string; direction: 'asc' | 'desc' }[];
  filterModel?: Record<string, unknown>;
  rowGroupColumns?: string[];
}

// ── palette ──────────────────────────────────────────────────────────
// One semantic set, used by every rule so the tabs read as one product.
const C = {
  lossFg: { light: '#b3261e', dark: '#ff8a80' },
  lossBg: { light: '#fdecea', dark: '#3a1c1a' },
  gainFg: { light: '#0a7d4f', dark: '#6ee7b7' },
  gainBg: { light: '#e6f6ee', dark: '#14332a' },
  warnFg: { light: '#8a5a00', dark: '#f0b429' },
  warnBg: { light: '#fdf3e0', dark: '#33290f' },
  infoFg: { light: '#1b5e9e', dark: '#7fb2e5' },
} as const;

const themed = (
  fg: { light: string; dark: string },
  bg?: { light: string; dark: string },
  extra: Record<string, unknown> = {},
) => ({
  light: { color: fg.light, ...(bg ? { backgroundColor: bg.light } : {}), ...extra },
  dark: { color: fg.dark, ...(bg ? { backgroundColor: bg.dark } : {}), ...extra },
});

const PNL_COLS = ['unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL'];

// ── conditional styling ──────────────────────────────────────────────

/**
 * Six rules, each saying something the cell alone cannot.
 *
 * The first version of this set did the opposite and was fairly called
 * useless: it painted negative P&L red next to a format string that already
 * prints negatives in red parentheses, tinted a BB rating amber in a cell that
 * says "BB", and italicised a duration over 12 in the column showing the
 * duration. Restating a value in colour is not conditional styling, it is
 * decoration — and it teaches a reader nothing about why the feature exists.
 *
 * A rule earns its place when it surfaces something invisible: a comparison
 * ACROSS columns, or a desk policy the data does not carry. Each of these also
 * exercises a different part of the rule model — row scope, cell scope,
 * indicators, arithmetic, string sets — so the tab is a tour as well as a
 * demonstration.
 *
 * Thresholds are tuned against the generated book so every rule actually
 * fires on some rows and not most of them; `seeds.test.ts` asserts that, since
 * a rule matching nothing or everything is noise either way.
 */
export const CONDITIONAL_RULES: StyleRule[] = [
  {
    id: 'crossed-market',
    name: 'Crossed market — bid above ask',
    kind: 'style',
    enabled: true,
    priority: 90,
    // Never true in clean data. When it is, the quote is broken and the whole
    // row is suspect — which is why this one is scoped to the row.
    condition: '[bidPrice] >= [askPrice]',
    scope: { kind: 'row' },
    style: themed(C.lossFg, C.lossBg, { fontWeight: 600 }),
    indicator: { iconName: 'triangle-alert', color: '#e63946', target: 'row-start', position: 'before' },
  },
  {
    id: 'thin-pickup',
    name: 'Barely paid for the credit risk',
    kind: 'style',
    enabled: true,
    priority: 30,
    // Two columns compared. The yield alone looks fine; what matters is how
    // little of it is compensation for holding credit rather than governments.
    condition: '[yieldToMaturity] - [benchmarkYield] < 0.45',
    scope: { kind: 'cell', columnIds: ['yieldToMaturity', 'oas'] },
    style: themed(C.warnFg, C.warnBg),
    indicator: { iconName: 'trending-down', color: '#f0b429', target: 'cell', position: 'before' },
  },
  {
    id: 'rating-disagreement',
    name: 'Trading like high yield, rated investment grade',
    kind: 'style',
    enabled: true,
    priority: 31,
    // The interesting rows on a credit desk: the market and the agencies do
    // not agree. Neither column says this on its own.
    condition: '[oas] > 250 && ([compositeRating] == "BBB" || [compositeRating] == "BBB-" || [compositeRating] == "BBB+")',
    scope: { kind: 'cell', columnIds: ['compositeRating', 'oas', 'zSpread'] },
    style: themed(C.lossFg, C.lossBg, { fontWeight: 600 }),
    indicator: { iconName: 'triangle-alert', color: '#e63946', target: 'cell', position: 'after' },
  },
  {
    id: 'away-from-cost',
    name: 'More than 3% from where it was bought',
    kind: 'style',
    enabled: true,
    priority: 20,
    // Uses ABS over two columns. The price is on screen and the cost is on
    // screen; the distance between them is not.
    condition: 'ABS([midPrice] - [avgCost]) / [avgCost] > 0.03',
    scope: { kind: 'cell', columnIds: ['midPrice', 'avgCost'] },
    style: themed(C.infoFg, undefined, { fontWeight: 600 }),
  },
  {
    id: 'costly-to-trade',
    name: 'Bid/ask eats a third of the spread',
    kind: 'style',
    enabled: true,
    priority: 21,
    // Liquidity measured against what you are being paid, not in absolute
    // terms: 20bps wide is cheap on a 400bps bond and ruinous on a 40bps one.
    condition: '([askPrice] - [bidPrice]) * 100 > [oas] * 0.35',
    scope: { kind: 'cell', columnIds: ['bidPrice', 'askPrice'] },
    style: themed(C.warnFg, C.warnBg),
  },
  {
    id: 'over-limit',
    name: 'Above the single-name limit',
    kind: 'style',
    enabled: true,
    priority: 10,
    // Desk policy, which lives nowhere in the data. Row scope, and quiet: it
    // marks the row without shouting over the rules above it.
    condition: '[marketValue] > 20000000',
    scope: { kind: 'row' },
    style: {
      light: { backgroundColor: '#eef2ff' },
      dark: { backgroundColor: '#1b2030' },
    },
  },
];

// A lighter set for tabs whose subject is not styling: the tick rules only,
// so prices move visibly without a wall of colour competing for attention.
export const TICK_RULES: StyleRule[] = ['midPrice'].flatMap((colId) => ([
  {
    id: 'tick-up',
    name: 'Price ticked up',
    kind: 'style' as const,
    enabled: true,
    priority: 40,
    condition: `[${colId}.old] != null && [${colId}] > [${colId}.old]`,
    scope: { kind: 'cell' as const, columnIds: ['bidPrice', 'midPrice', 'askPrice', 'lastPrice'] },
    style: themed(C.gainFg),
    flash: { enabled: true, target: 'cell' as const, mode: 'fade' as const, color: '#0a7d4f', durationMs: 550 },
    activeDurationMs: 900,
  },
  {
    id: 'tick-down',
    name: 'Price ticked down',
    kind: 'style' as const,
    enabled: true,
    priority: 41,
    condition: `[${colId}.old] != null && [${colId}] < [${colId}.old]`,
    scope: { kind: 'cell' as const, columnIds: ['bidPrice', 'midPrice', 'askPrice', 'lastPrice'] },
    style: themed(C.lossFg),
    flash: { enabled: true, target: 'cell' as const, mode: 'fade' as const, color: '#b3261e', durationMs: 550 },
    activeDurationMs: 900,
  },
]));

/** Pick one seeded rule by id — index-based picks silently pointed at the
 *  wrong rule the moment the set was reordered. */
function byId(id: string): StyleRule {
  const hit = CONDITIONAL_RULES.find((r) => r.id === id);
  if (!hit) throw new Error(`no conditional rule '${id}'`);
  return hit;
}

// ── tick arrows ──────────────────────────────────────────────────────

/** Columns whose values actually move on a tick — see `tickRow` in domain.ts.
 *  An arrow rule on a static column would never fire. */
const TICKING_COLS = [
  'bidPrice', 'midPrice', 'askPrice', 'lastPrice',
  'yieldToMaturity', 'oas', 'zSpread',
  'marketValue', 'unrealizedPnL', 'dailyPnL',
] as const;

/** Single colours rather than {light, dark} pairs: `RuleIndicator.color` is one
 *  string, so these have to read on both grounds. Same two the renderer
 *  catalog uses for positive / negative. */
const ARROW_UP_COLOR = '#0aa063';
const ARROW_DOWN_COLOR = '#e63946';

/** How long an arrow stays up after the tick that raised it. */
export const TICK_ARROW_MS = 800;

/**
 * Up/down arrows on every cell whose value just moved, for 800ms.
 *
 * One rule PAIR PER COLUMN, not one pair scoped to many columns: the condition
 * names a field, so a rule scoped across ten columns and conditioned on
 * `[midPrice]` would raise arrows on all ten whenever mid alone moved. The
 * arrow has to mean "this cell changed".
 *
 * They are `kind: 'style'` rules carrying an indicator rather than
 * `kind: 'indicator'` ones, because `activeDurationMs` — the thing that makes
 * the arrow disappear again — exists only on style rules. The style slice is
 * deliberately empty: the brief was arrows, so the number keeps its own colour.
 *
 * `activeDurationMs` is what makes this a TICK arrow. Activation is the
 * condition going false→true for a (rowId, colId) on a change record; the
 * match then expires on its own. Without it an arrow would latch on until the
 * value happened to move the other way, which on a one-way move is never.
 */
export const TICK_ARROW_RULES: StyleRule[] = TICKING_COLS.flatMap((colId, i) => ([
  {
    id: `tick-arrow-up-${colId}`,
    name: `${colId} ticked up`,
    kind: 'style' as const,
    enabled: true,
    priority: 100 + i * 2,
    condition: `[${colId}.old] != null && [${colId}] > [${colId}.old]`,
    scope: { kind: 'cell' as const, columnIds: [colId] },
    style: { base: {} },
    indicator: {
      iconName: 'arrow-up',
      color: ARROW_UP_COLOR,
      target: 'cell' as const,
      position: 'before' as const,
    },
    activeDurationMs: TICK_ARROW_MS,
  },
  {
    id: `tick-arrow-down-${colId}`,
    name: `${colId} ticked down`,
    kind: 'style' as const,
    enabled: true,
    priority: 101 + i * 2,
    condition: `[${colId}.old] != null && [${colId}] < [${colId}.old]`,
    scope: { kind: 'cell' as const, columnIds: [colId] },
    style: { base: {} },
    indicator: {
      iconName: 'arrow-down',
      color: ARROW_DOWN_COLOR,
      target: 'cell' as const,
      position: 'before' as const,
    },
    activeDurationMs: TICK_ARROW_MS,
  },
]));


// ── calculated columns ───────────────────────────────────────────────

export const CALC_COLUMNS: CalculatedColumnDef[] = [
  {
    colId: 'spreadPickup',
    position: 8,
    headerName: 'Pickup',
    expression: '[yieldToMaturity] - [benchmarkYield]',
    format: '#,##0.000"%"',
    initialWidth: 96,
  },
  {
    colId: 'baWidthBps',
    position: 9,
    headerName: 'B/A width',
    expression: '([askPrice] - [bidPrice]) * 100',
    format: '#,##0.00" bps"',
    initialWidth: 108,
  },
  {
    colId: 'pctOfBook',
    position: 10,
    // SUM() over the book is the interesting case: the value of every row
    // depends on every other row, so it re-derives when the book changes.
    headerName: '% of book',
    expression: '[marketValue] / SUM([marketValue]) * 100',
    format: '#,##0.00"%"',
    initialWidth: 100,
  },
  {
    colId: 'pnlPerDv01',
    position: 11,
    headerName: 'P&L / DV01',
    expression: '[dailyPnL] / [dv01]',
    format: '#,##0;[Red](#,##0)',
    initialWidth: 116,
  },
  {
    colId: 'yieldPerTurn',
    position: 12,
    headerName: 'Yield / turn',
    expression: '[yieldToMaturity] / [modifiedDuration]',
    format: '#,##0.000',
    initialWidth: 108,
  },
];

// ── saved filters ────────────────────────────────────────────────────

export const SAVED_FILTERS: SavedFilter[] = [
  {
    id: 'hy-long-end',
    label: 'HY long end',
    active: false,
    filterModel: {
      compositeRating: { filterType: 'set', values: ['BB+', 'BB', 'BB-', 'B+', 'B'] },
      modifiedDuration: { filterType: 'number', type: 'greaterThan', filter: 8 },
    },
  },
  {
    id: 'losers',
    label: 'Losing today',
    active: false,
    filterModel: {
      dailyPnL: { filterType: 'number', type: 'lessThan', filter: 0 },
    },
  },
  {
    id: 'wide-markets',
    label: 'Wide markets',
    active: false,
    filterModel: {
      bidAskWidthBps: { filterType: 'number', type: 'greaterThan', filter: 40 },
    },
  },
  {
    id: 'usd-financials',
    label: 'USD financials',
    active: false,
    filterModel: {
      currency: { filterType: 'set', values: ['USD'] },
      issuerSector: { filterType: 'set', values: ['Financials'] },
    },
  },
  {
    id: 'ig-short',
    label: 'IG under 5y',
    active: false,
    filterModel: {
      compositeRating: { filterType: 'set', values: ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-'] },
      modifiedDuration: { filterType: 'number', type: 'lessThan', filter: 5 },
    },
  },
];

// ── alerts ───────────────────────────────────────────────────────────

export const ALERT_RULES: AlertRule[] = [
  {
    id: 'big-loss',
    name: 'Position down more than 250k',
    enabled: true,
    priority: 10,
    severity: 'critical',
    trigger: { kind: 'dataChange', expression: '[dailyPnL] < -250000', columnIds: ['dailyPnL'] },
    message: '{rowId} is down {value} on the day',
    channels: ['toast', 'badge'],
    debounceMs: 8_000,
  },
  {
    id: 'price-jump',
    name: 'Price moved more than 1%',
    enabled: true,
    priority: 20,
    severity: 'warning',
    trigger: { kind: 'relativeChange', colId: 'midPrice', mode: 'PERCENT_CHANGE', threshold: 1, direction: 'both' },
    message: '{rowId} {column} moved to {value} from {prev}',
    channels: ['toast', 'badge'],
    debounceMs: 5_000,
  },
  {
    id: 'spread-widening',
    name: 'OAS widened 25 bps',
    enabled: true,
    priority: 30,
    severity: 'warning',
    trigger: { kind: 'relativeChange', colId: 'oas', mode: 'ABSOLUTE_CHANGE', threshold: 25, direction: 'up' },
    message: '{rowId} OAS widened to {value}',
    channels: ['badge'],
    debounceMs: 10_000,
  },
  {
    id: 'hy-rally',
    name: 'High yield rallying',
    enabled: true,
    priority: 40,
    severity: 'info',
    trigger: { kind: 'dataChange', expression: '[compositeRating] == "BB" && [priceChangePct] > 1', columnIds: ['priceChangePct'] },
    message: '{rowId} up {value}%',
    channels: ['badge'],
    debounceMs: 15_000,
  },
];

// ── editing ──────────────────────────────────────────────────────────

/**
 * A price moves in eighths, a spread in basis points, a quantity in lots.
 * One global step would be wrong for all three, which is the whole reason
 * nudges are per column.
 */
export const NUDGES: PlusMinusNudge[] = [
  { id: 'px', name: 'Prices — eighths', enabled: true, scope: { columnIds: ['bidPrice', 'midPrice', 'askPrice', 'lastPrice', 'avgCost'] }, incrementStep: 0.125 },
  { id: 'spread', name: 'Spreads — 1 bp', enabled: true, scope: { columnIds: ['oas', 'zSpread', 'iSpread'] }, incrementStep: 1 },
  { id: 'yield', name: 'Yields — 1/100th', enabled: true, scope: { columnIds: ['yieldToMaturity', 'yieldToWorst', 'currentYield'] }, incrementStep: 0.01 },
  { id: 'duration', name: 'Duration — quarter turn', enabled: true, scope: { columnIds: ['modifiedDuration'] }, incrementStep: 0.25 },
  { id: 'qty', name: 'Quantity — 100k lots', enabled: true, scope: { columnIds: ['quantityFace', 'bidSize', 'askSize'] }, incrementStep: 100_000 },
];

/** Traders type in the units of the desk: 5m is five million, not "5m". */
export const SHORTCUTS: ShortcutDefinition[] = [
  { id: 'k', name: 'Thousands', enabled: true, shortcutKey: 'k', operation: 'multiply', shortcutValue: 1_000, scope: { columnIds: ['quantityFace', 'bidSize', 'askSize', 'marketValue', 'avgDailyVolume30d'] } },
  { id: 'm', name: 'Millions', enabled: true, shortcutKey: 'm', operation: 'multiply', shortcutValue: 1_000_000, scope: { columnIds: ['quantityFace', 'bidSize', 'askSize', 'marketValue', 'avgDailyVolume30d'] } },
  { id: 'b', name: 'Billions', enabled: true, shortcutKey: 'b', operation: 'multiply', shortcutValue: 1_000_000_000, scope: { columnIds: ['quantityFace', 'marketValue'] } },
  { id: 'h', name: 'Halve', enabled: true, shortcutKey: 'h', operation: 'divide', shortcutValue: 2, scope: { columnIds: ['quantityFace', 'bidSize', 'askSize'] } },
];

// ── per-tab seeds ────────────────────────────────────────────────────

/**
 * What each tab arrives with. A tab absent from this map gets nothing, which
 * should be true of very few of them — an empty tab is the failure mode this
 * file exists to prevent.
 */
export const SEEDS: Record<string, LabSeed> = {
  overview: {
    views: [
      { name: 'Biggest positions', sortModel: [{ colId: 'marketValue', direction: 'desc' }] },
      { name: 'Today\'s losers', sortModel: [{ colId: 'dailyPnL', direction: 'asc' }], filterModel: { dailyPnL: { filterType: 'number', type: 'lessThan', filter: 0 } } },
      { name: 'By desk and region', rowGroupColumns: ['desk', 'region'] },
    ],
    rules: TICK_RULES,
    calculatedColumns: CALC_COLUMNS.slice(0, 2),
    savedFilters: SAVED_FILTERS,
    alertRules: ALERT_RULES,
    nudges: NUDGES,
    shortcuts: SHORTCUTS,
    sortModel: [{ colId: 'marketValue', direction: 'desc' }],
  },

  formatting: {
    rules: [
      ...TICK_RULES,
      {
        id: 'fmt-tiny',
        name: 'Sub-par prices to 4 decimals',
        kind: 'style',
        enabled: true,
        priority: 30,
        condition: '[midPrice] < 90',
        scope: { kind: 'cell', columnIds: ['midPrice'] },
        style: { base: {} },
        // A rule can replace the column's number format, not only its colour.
        valueFormatter: '#,##0.0000',
      },
    ],
    sortModel: [{ colId: 'midPrice', direction: 'asc' }],
  },

  renderers: { sortModel: [{ colId: 'dailyPnL', direction: 'desc' }] },

  toolbar: { rules: TICK_RULES, savedFilters: SAVED_FILTERS.slice(0, 3) },

  conditional: {
    views: [
      { name: 'Tick arrows', rules: TICK_ARROW_RULES },
      { name: 'Worst first', sortModel: [{ colId: 'dailyPnL', direction: 'asc' }] },
      { name: 'High yield only', filterModel: { compositeRating: { filterType: 'set', values: ['BB+', 'BB', 'BB-', 'B+', 'B'] } } },
      { name: 'Long duration', filterModel: { modifiedDuration: { filterType: 'number', type: 'greaterThan', filter: 12 } } },
    ],
    rules: CONDITIONAL_RULES,
    sortModel: [{ colId: 'dailyPnL', direction: 'asc' }],
  },

  groups: { calculatedColumns: CALC_COLUMNS.slice(0, 2) },

  calc: {
    views: [
      { name: 'Best pickup', sortModel: [{ colId: 'spreadPickup', direction: 'desc' }] },
      { name: 'Largest weights', sortModel: [{ colId: 'pctOfBook', direction: 'desc' }] },
    ],
    calculatedColumns: CALC_COLUMNS,
    rules: TICK_RULES,
    sortModel: [{ colId: 'marketValue', direction: 'desc' }],
  },

  expressions: {
    calculatedColumns: CALC_COLUMNS.slice(0, 3),
    rules: [byId('rating-disagreement'), byId('over-limit')],
  },

  filters: {
    views: [
      { name: 'Everything', sortModel: [] },
      { name: 'USD only', filterModel: { currency: { filterType: 'set', values: ['USD'] } } },
    ],
    savedFilters: SAVED_FILTERS,
    rules: [byId('thin-pickup')],
  },

  live: {
    views: [
      { name: 'Tick arrows', rules: TICK_ARROW_RULES },
      { name: 'Biggest movers', sortModel: [{ colId: 'priceChangePct', direction: 'desc' }] },
      { name: 'Falling hardest', sortModel: [{ colId: 'priceChangePct', direction: 'asc' }] },
    ],
    rules: TICK_RULES,
    alertRules: ALERT_RULES.slice(0, 2),
    sortModel: [{ colId: 'priceChangePct', direction: 'desc' }],
  },

  grouping: {
    views: [
      { name: 'Desk / region', rowGroupColumns: ['desk', 'region'] },
      { name: 'Sector / rating', rowGroupColumns: ['issuerSector', 'compositeRating'] },
      { name: 'Trader book', rowGroupColumns: ['trader', 'book'] },
    ],
    calculatedColumns: [CALC_COLUMNS[2]!],
    rules: [byId('away-from-cost')],
  },

  pivot: {},

  alerts: {
    views: [
      { name: 'Worst first', sortModel: [{ colId: 'dailyPnL', direction: 'asc' }] },
      { name: 'Widest spreads', sortModel: [{ colId: 'oas', direction: 'desc' }] },
    ],
    alertRules: ALERT_RULES,
    rules: [byId('crossed-market'), byId('rating-disagreement')],
    sortModel: [{ colId: 'dailyPnL', direction: 'asc' }],
  },

  editing: { nudges: NUDGES, shortcuts: SHORTCUTS, rules: TICK_RULES },
  bulk: { nudges: NUDGES, shortcuts: SHORTCUTS },
  plusminus: { nudges: NUDGES },
  shortcuts: { shortcuts: SHORTCUTS },
  history: { nudges: NUDGES, shortcuts: SHORTCUTS, rules: TICK_RULES },

  profiles: {
    views: [
      { name: 'Risk view', sortModel: [{ colId: 'modifiedDuration', direction: 'desc' }] },
      { name: 'P&L view', sortModel: [{ colId: 'unrealizedPnL', direction: 'desc' }] },
      { name: 'Credit view', rowGroupColumns: ['compositeRating'] },
      { name: 'Desk view', rowGroupColumns: ['desk', 'trader'] },
    ],
    rules: CONDITIONAL_RULES,
    calculatedColumns: CALC_COLUMNS,
    savedFilters: SAVED_FILTERS,
    nudges: NUDGES,
    shortcuts: SHORTCUTS,
    sortModel: [{ colId: 'unrealizedPnL', direction: 'desc' }],
  },

  export: {
    calculatedColumns: CALC_COLUMNS.slice(0, 3),
    rules: [byId('away-from-cost')],
  },
};

export const seedFor = (tabId: string): LabSeed => SEEDS[tabId] ?? {};
