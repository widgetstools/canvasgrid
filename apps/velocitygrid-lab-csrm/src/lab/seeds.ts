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

/**
 * A named layout. Anything it declares REPLACES the tab's own seed for as long
 * as it is active; anything it omits falls back to that seed.
 *
 * Every field here is backed by a registered state module (`rules`, `alerts`,
 * `calc`, `editSettings`, `saved-filters`), which is what lets `saveLayout`
 * capture a profile that differs by its rule set or its calculated columns and
 * not merely by a sort.
 */
export interface LabView {
  name: string;
  /** One line on what this profile isolates. */
  blurb: string;
  rules?: StyleRule[];
  alertRules?: AlertRule[];
  calculatedColumns?: CalculatedColumnDef[];
  nudges?: PlusMinusNudge[];
  shortcuts?: ShortcutDefinition[];
  savedFilters?: SavedFilter[];
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

// ── rule library ─────────────────────────────────────────────────────
//
// Individually named so a profile can compose a set that isolates ONE
// capability. That is the shape the reference lab's curriculum uses, and the
// reason it teaches: a profile showing eight things at once shows none of them.

/** Persistent cell paint, no motion. The plainest rule there is. */
export const PAINT_RULES: StyleRule[] = [
  {
    id: 'paint-winners', name: 'Winners', kind: 'style', enabled: true, priority: 10,
    condition: '[dailyPnL] > 0',
    scope: { kind: 'cell', columnIds: ['dailyPnL', 'unrealizedPnL'] },
    style: themed(C.gainFg, C.gainBg),
  },
  {
    id: 'paint-losers', name: 'Losers', kind: 'style', enabled: true, priority: 11,
    condition: '[dailyPnL] < 0',
    scope: { kind: 'cell', columnIds: ['dailyPnL', 'unrealizedPnL'] },
    style: themed(C.lossFg, C.lossBg),
  },
];

/** Row scope — the whole row carries the verdict, not one cell. */
export const ROW_RULES: StyleRule[] = [
  {
    id: 'row-junk', name: 'Sub-investment-grade row', kind: 'style', enabled: true, priority: 5,
    condition: '[compositeRating] == "BB+" || [compositeRating] == "BB" || [compositeRating] == "BB-" || [compositeRating] == "B+" || [compositeRating] == "B"',
    scope: { kind: 'row' },
    style: { light: { backgroundColor: '#fff8ec' }, dark: { backgroundColor: '#2a2416' } },
  },
  {
    id: 'row-over-limit', name: 'Above the single-name limit', kind: 'style', enabled: true, priority: 6,
    condition: '[marketValue] > 20000000',
    scope: { kind: 'row' },
    style: { light: { backgroundColor: '#eef2ff' }, dark: { backgroundColor: '#1b2030' } },
  },
];

/** Indicators in each placement the model offers, so the tour covers them. */
export const INDICATOR_RULES: StyleRule[] = [
  {
    id: 'ind-before', name: 'Inline prefix — thin pickup', kind: 'style', enabled: true, priority: 20,
    condition: '[yieldToMaturity] - [benchmarkYield] < 0.45',
    scope: { kind: 'cell', columnIds: ['yieldToMaturity'] },
    style: { base: {} },
    indicator: { iconName: 'trending-down', color: '#f0b429', target: 'cell', position: 'before' },
  },
  {
    id: 'ind-after', name: 'Inline suffix — rating disagreement', kind: 'style', enabled: true, priority: 21,
    condition: '[oas] > 250 && ([compositeRating] == "BBB" || [compositeRating] == "BBB-" || [compositeRating] == "BBB+")',
    scope: { kind: 'cell', columnIds: ['compositeRating'] },
    style: { base: {} },
    indicator: { iconName: 'triangle-alert', color: '#e63946', target: 'cell', position: 'after' },
  },
  {
    id: 'ind-corner', name: 'Corner overlay — long duration', kind: 'style', enabled: true, priority: 22,
    condition: '[modifiedDuration] > 12',
    scope: { kind: 'cell', columnIds: ['modifiedDuration'] },
    style: { base: {} },
    indicator: { iconName: 'clock', color: '#7fb2e5', target: 'cell', position: 'tr' },
  },
  {
    id: 'ind-row-start', name: 'Row marker — crossed quote', kind: 'style', enabled: true, priority: 23,
    condition: '[bidPrice] >= [askPrice]',
    scope: { kind: 'row' },
    style: themed(C.lossFg, C.lossBg, { fontWeight: 600 }),
    indicator: { iconName: 'triangle-alert', color: '#e63946', target: 'row-start', position: 'before' },
  },
];

/** Motion: the three flash modes, and a style window that closes itself. */
export const FLASH_RULES: StyleRule[] = [
  {
    id: 'flash-fade', name: 'Fade on any price move', kind: 'style', enabled: true, priority: 40,
    condition: '[midPrice.old] != null && [midPrice] != [midPrice.old]',
    scope: { kind: 'cell', columnIds: ['midPrice'] },
    style: { base: {} },
    flash: { enabled: true, target: 'cell', mode: 'fade', color: '#4f9dd9', durationMs: 500 },
    activeDurationMs: 700,
  },
  {
    id: 'flash-pulse', name: 'Pulse while yield is above 9%', kind: 'style', enabled: true, priority: 41,
    condition: '[yieldToMaturity] > 9',
    scope: { kind: 'cell', columnIds: ['yieldToMaturity'] },
    style: themed(C.warnFg, C.warnBg),
    flash: { enabled: true, target: 'cell', mode: 'pulse', color: '#f0b429', durationMs: 900 },
  },
  {
    id: 'flash-glow-row', name: 'Glow the row on a big move', kind: 'style', enabled: true, priority: 42,
    condition: 'ABS([priceChangePct]) > 1.2',
    scope: { kind: 'row' },
    style: { base: {} },
    flash: { enabled: true, target: 'row', mode: 'glow', color: '#e63946', durationMs: 800 },
    activeDurationMs: 1200,
  },
];

/** Change-driven rules: the `.old` vocabulary, in colour rather than arrows. */
export const DIFF_RULES: StyleRule[] = [
  {
    id: 'diff-up', name: 'Mid ticked higher', kind: 'style', enabled: true, priority: 50,
    condition: '[midPrice.old] != null && [midPrice] > [midPrice.old]',
    scope: { kind: 'cell', columnIds: ['bidPrice', 'midPrice', 'askPrice', 'lastPrice'] },
    style: themed(C.gainFg),
    flash: { enabled: true, target: 'cell', mode: 'fade', color: '#0a7d4f', durationMs: 550 },
    activeDurationMs: 900,
  },
  {
    id: 'diff-down', name: 'Mid ticked lower', kind: 'style', enabled: true, priority: 51,
    condition: '[midPrice.old] != null && [midPrice] < [midPrice.old]',
    scope: { kind: 'cell', columnIds: ['bidPrice', 'midPrice', 'askPrice', 'lastPrice'] },
    style: themed(C.lossFg),
    flash: { enabled: true, target: 'cell', mode: 'fade', color: '#b3261e', durationMs: 550 },
    activeDurationMs: 900,
  },
  {
    id: 'diff-big', name: 'Moved more than a quarter point', kind: 'style', enabled: true, priority: 52,
    condition: '[midPrice.old] != null && ABS([midPrice] - [midPrice.old]) > 0.25',
    scope: { kind: 'cell', columnIds: ['midPrice'] },
    style: themed(C.warnFg, C.warnBg, { fontWeight: 600 }),
    activeDurationMs: 2500,
  },
];

/** A rule may also replace the column's number format for matching cells. */
export const FORMAT_RULES: StyleRule[] = [
  {
    id: 'fmt-sub-par', name: 'Sub-par prices to four decimals', kind: 'style', enabled: true, priority: 30,
    condition: '[midPrice] < 98',
    scope: { kind: 'cell', columnIds: ['midPrice'] },
    style: { base: {} },
    valueFormatter: '#,##0.0000',
  },
  {
    id: 'fmt-big-money', name: 'Large positions in thousands', kind: 'style', enabled: true, priority: 31,
    condition: '[marketValue] > 15000000',
    scope: { kind: 'cell', columnIds: ['marketValue'] },
    style: { base: {} },
    valueFormatter: '#,##0,"k"',
  },
];

/** Everything, in priority order — the "00 · Full" set. */
export const ALL_STYLE_RULES: StyleRule[] = [
  ...ROW_RULES, ...PAINT_RULES, ...INDICATOR_RULES,
  ...FORMAT_RULES, ...FLASH_RULES, ...DIFF_RULES,
];


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
    rules: CONDITIONAL_RULES,
    sortModel: [{ colId: 'dailyPnL', direction: 'asc' }],
  },

  groups: { calculatedColumns: CALC_COLUMNS.slice(0, 2) },

  calc: {
    calculatedColumns: CALC_COLUMNS,
    rules: TICK_RULES,
    sortModel: [{ colId: 'marketValue', direction: 'desc' }],
  },

  expressions: {
    calculatedColumns: CALC_COLUMNS.slice(0, 3),
    rules: [byId('rating-disagreement'), byId('over-limit')],
  },

  filters: {
    savedFilters: SAVED_FILTERS,
    rules: [byId('thin-pickup')],
  },

  live: {
    rules: TICK_RULES,
    alertRules: ALERT_RULES.slice(0, 2),
    sortModel: [{ colId: 'priceChangePct', direction: 'desc' }],
  },

  grouping: {
    calculatedColumns: [CALC_COLUMNS[2]!],
    rules: [byId('away-from-cost')],
  },

  pivot: {},

  alerts: {
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

// ── profiles ─────────────────────────────────────────────────────────
//
// Ported from the MarketsGrid lab's profile catalogs, which are the reason
// that lab teaches anything: each tab opens with a "Full" profile, then a
// series that each isolate ONE capability, and usually a bare one at the end
// to author against. A profile showing eight things at once shows none of them.
//
// Anything a profile omits falls back to the tab's own seed, so these stay
// short and say only what makes them different.

const V = (name: string, blurb: string, rest: Partial<LabView> = {}): LabView =>
  ({ name, blurb, ...rest });

const HY = ['BB+', 'BB', 'BB-', 'B+', 'B'];
const IG = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-'];
const setFilter = (colId: string, values: string[]) => ({ [colId]: { filterType: 'set', values } });
const numFilter = (colId: string, type: string, filter: number) =>
  ({ [colId]: { filterType: 'number', type, filter } });

export const PROFILES: Record<string, LabView[]> = {
  overview: [
    V('Kitchen sink', 'Every module seeded at once — rules, calc columns, alerts, pills.', {
      rules: ALL_STYLE_RULES, calculatedColumns: CALC_COLUMNS,
      alertRules: ALERT_RULES, savedFilters: SAVED_FILTERS,
      nudges: NUDGES, shortcuts: SHORTCUTS,
    }),
    V('Trader P&L', 'Winners and losers painted, prices ticking, sorted by the day.', {
      rules: [...PAINT_RULES, ...DIFF_RULES],
      sortModel: [{ colId: 'dailyPnL', direction: 'desc' }],
    }),
    V('Risk desk', 'Duration and spread first, with the risk derivations.', {
      rules: [...ROW_RULES, ...INDICATOR_RULES],
      calculatedColumns: CALC_COLUMNS.filter((c) => c.colId !== 'pctOfBook'),
      sortModel: [{ colId: 'modifiedDuration', direction: 'desc' }],
    }),
    V('Grouped by desk', 'Desk then region, aggregating up the tree.', {
      rules: PAINT_RULES, rowGroupColumns: ['desk', 'region'],
    }),
    V('Minimal', 'No modules at all — the grid with these columns and nothing else.', {
      rules: [], calculatedColumns: [], alertRules: [], savedFilters: [],
      nudges: [], shortcuts: [],
    }),
  ],

  formatting: [
    V('Full showcase', 'Every format kind the DSL offers, across the blotter.', {
      rules: FORMAT_RULES,
    }),
    V('Pricing precision', 'Prices sorted low to high, sub-par ones to four decimals.', {
      rules: [FORMAT_RULES[0]!], sortModel: [{ colId: 'midPrice', direction: 'asc' }],
    }),
    V('Signed money', 'The P&L convention: negatives in red parentheses.', {
      rules: [], sortModel: [{ colId: 'dailyPnL', direction: 'asc' }],
    }),
    V('Rule-driven formats', 'A rule replacing the column format for the cells it matches.', {
      rules: FORMAT_RULES, sortModel: [{ colId: 'marketValue', direction: 'desc' }],
    }),
    V('Bare formats', 'Column format strings only — nothing conditional.', { rules: [] }),
  ],

  renderers: [
    V('Full showcase', 'Badges, bars, charts and tick-aware numerics together.', {}),
    V('Sorted by move', 'Biggest movers first, so the direction glyphs are doing work.', {
      sortModel: [{ colId: 'priceChangePct', direction: 'desc' }],
    }),
    V('High yield only', 'Rating badges concentrated in the bands that matter.', {
      filterModel: setFilter('compositeRating', HY),
    }),
    V('Large positions', 'Where the bars and heat renderers have range to show.', {
      filterModel: numFilter('marketValue', 'greaterThan', 12000000),
      sortModel: [{ colId: 'marketValue', direction: 'desc' }],
    }),
  ],

  toolbar: [
    V('Painted desk', 'Arrives pre-styled — start here and change things.', {
      rules: [...PAINT_RULES, ...INDICATOR_RULES], savedFilters: SAVED_FILTERS.slice(0, 3),
    }),
    V('P&L palette', 'Only the P&L columns painted, so the toolbar edits stand out.', {
      rules: PAINT_RULES,
    }),
    V('Blank canvas', 'Nothing styled. Select cells and paint with the ribbon.', {
      rules: [], savedFilters: [],
    }),
  ],

  conditional: [
    V('Full curriculum', 'All six families at once — paint, row, indicator, format, flash, diff.', {
      rules: ALL_STYLE_RULES,
    }),
    V('Cell paint only', 'The plainest rule there is: a condition and a colour.', {
      rules: PAINT_RULES,
    }),
    V('Row rules', 'The verdict belongs to the row, not one cell.', { rules: ROW_RULES }),
    V('Indicators', 'Every placement: inline prefix and suffix, a corner, a row marker.', {
      rules: INDICATOR_RULES,
    }),
    V('Flash and windows', 'Fade, pulse and glow, plus a style window that closes itself.', {
      rules: FLASH_RULES,
    }),
    V('Diff rules', 'Conditions over what a value just DID, using [col.old].', {
      rules: DIFF_RULES,
    }),
    V('Tick arrows', 'Direction arrows on the cell that moved, for 800ms.', {
      rules: TICK_ARROW_RULES,
    }),
    V('Rule-driven formats', 'A matching cell rendered through a different number format.', {
      rules: FORMAT_RULES,
    }),
    V('All off', 'Rules present but disabled — turn them on one at a time.', {
      rules: ALL_STYLE_RULES.map((r) => ({ ...r, enabled: false })),
    }),
  ],

  groups: [
    V('All groups', 'The blotter\'s eight semantic groups, all open.', {}),
    V('Pricing and P&L', 'Just the two-sided market and what it did to the book.', {
      sortModel: [{ colId: 'dailyPnL', direction: 'asc' }],
    }),
    V('Grouped as well', 'Header groups and row groups at the same time.', {
      rowGroupColumns: ['desk'],
    }),
  ],

  calc: [
    V('All derived', 'Five calculated columns, including one that sums the whole book.', {
      calculatedColumns: CALC_COLUMNS, rules: DIFF_RULES,
    }),
    V('Spread and liquidity', 'Pickup and bid/ask width — the two-column comparisons.', {
      calculatedColumns: CALC_COLUMNS.filter((c) => c.colId === 'spreadPickup' || c.colId === 'baWidthBps'),
      sortModel: [{ colId: 'spreadPickup', direction: 'desc' }],
    }),
    V('Risk ratios', 'P&L per basis point of risk, and yield per turn of duration.', {
      calculatedColumns: CALC_COLUMNS.filter((c) => c.colId === 'pnlPerDv01' || c.colId === 'yieldPerTurn'),
    }),
    V('Book weights', 'One column whose every value depends on every other row.', {
      calculatedColumns: CALC_COLUMNS.filter((c) => c.colId === 'pctOfBook'),
      sortModel: [{ colId: 'pctOfBook', direction: 'desc' }],
    }),
    V('None', 'No derived columns — author one in Customize.', { calculatedColumns: [] }),
  ],

  expressions: [
    V('Arithmetic', 'Expressions that combine columns.', {
      calculatedColumns: CALC_COLUMNS.slice(0, 2),
    }),
    V('Aggregates', 'SUM() over the book, inside a per-row expression.', {
      calculatedColumns: CALC_COLUMNS.filter((c) => c.colId === 'pctOfBook'),
    }),
    V('Conditions', 'The same language driving a rule instead of a column.', {
      rules: [...PAINT_RULES, ...INDICATOR_RULES], calculatedColumns: [],
    }),
  ],

  filters: [
    V('All pills', 'Five saved filters — click to toggle, + to capture a sixth.', {
      savedFilters: SAVED_FILTERS,
    }),
    V('High yield', 'One pill active: sub-investment grade, long end.', {
      savedFilters: SAVED_FILTERS, filterModel: setFilter('compositeRating', HY),
    }),
    V('Investment grade', 'The other side of the book.', {
      savedFilters: SAVED_FILTERS, filterModel: setFilter('compositeRating', IG),
    }),
    V('Losing today', 'A number filter rather than a set.', {
      savedFilters: SAVED_FILTERS, filterModel: numFilter('dailyPnL', 'lessThan', 0),
    }),
    V('Stacked', 'Two column filters at once — pills intersect, they do not replace.', {
      savedFilters: SAVED_FILTERS,
      filterModel: { ...setFilter('currency', ['USD']), ...setFilter('issuerSector', ['Financials']) },
    }),
    V('Capture workflow', 'No pills. Set a filter, then press + to save it as one.', {
      savedFilters: [],
    }),
  ],

  live: [
    V('Flash storm', 'Every motion rule at once against the fastest feed.', {
      rules: [...FLASH_RULES, ...DIFF_RULES],
    }),
    V('Tick arrows', 'Direction arrows on the cell that moved, for 800ms.', {
      rules: TICK_ARROW_RULES,
    }),
    V('Direction colour', 'The same information as colour instead of glyphs.', {
      rules: DIFF_RULES,
    }),
    V('Big moves only', 'A window that stays open 2.5s, so only real moves show.', {
      rules: [DIFF_RULES[2]!], sortModel: [{ colId: 'priceChangePct', direction: 'desc' }],
    }),
    V('Quiet', 'No rules — watch the raw repaint without decoration.', { rules: [] }),
  ],

  grouping: [
    V('Desk and region', 'Two levels, aggregating up.', { rowGroupColumns: ['desk', 'region'] }),
    V('Sector and rating', 'A credit lens on the same book.', {
      rowGroupColumns: ['issuerSector', 'compositeRating'],
    }),
    V('Three levels', 'Desk, region, then sector — totals at every level.', {
      rowGroupColumns: ['desk', 'region', 'issuerSector'],
    }),
    V('By trader', 'Who owns what.', { rowGroupColumns: ['trader'] }),
    V('Flat', 'Grouping off — the same aggregates as a pinned grand total only.', {
      rowGroupColumns: [],
    }),
  ],

  pivot: [
    V('Sector by rating', 'The default cross-tab.', {}),
    V('With row paint', 'Rules still apply to a pivoted view.', { rules: PAINT_RULES }),
  ],

  alerts: [
    V('Full demo', 'Both trigger families and both channels.', { alertRules: ALERT_RULES }),
    V('Threshold alerts', 'dataChange predicates over a value.', {
      alertRules: ALERT_RULES.filter((a) => a.trigger.kind === 'dataChange'),
    }),
    V('Relative change', 'Percent and absolute moves against the previous value.', {
      alertRules: ALERT_RULES.filter((a) => a.trigger.kind === 'relativeChange'),
    }),
    V('Badge only', 'No toasts — the bell count is the whole signal.', {
      alertRules: ALERT_RULES.map((a) => ({ ...a, channels: ['badge' as const] })),
    }),
    V('No debounce', 'The same rules with the rate limit removed. Watch it flood.', {
      alertRules: ALERT_RULES.map((a) => ({ ...a, debounceMs: 0 })),
    }),
    V('Off', 'Rules present, all disabled.', {
      alertRules: ALERT_RULES.map((a) => ({ ...a, enabled: false })),
    }),
  ],

  editing: [
    V('Everything on', 'Nudges, shortcuts and the full editing family.', {
      nudges: NUDGES, shortcuts: SHORTCUTS, rules: DIFF_RULES,
    }),
    V('Nudges only', 'Plus and minus, per-column steps. No letter keys.', {
      nudges: NUDGES, shortcuts: [],
    }),
    V('Shortcuts only', 'Letter-key magnitudes. No nudges.', { nudges: [], shortcuts: SHORTCUTS }),
    V('Plain editing', 'Type, paste and fill with no helpers at all.', {
      nudges: [], shortcuts: [], rules: [],
    }),
  ],

  bulk: [
    V('Curriculum', 'A selection, one value, one transaction.', { nudges: NUDGES, shortcuts: SHORTCUTS }),
    V('Sorted by size', 'Pick the top of the book and set it in one go.', {
      sortModel: [{ colId: 'quantityFace', direction: 'desc' }], nudges: NUDGES, shortcuts: SHORTCUTS,
    }),
    V('No helpers', 'Bulk update with nudges and shortcuts off.', { nudges: [], shortcuts: [] }),
  ],

  plusminus: [
    V('Per-column steps', 'Five rules: eighths, basis points, turns, lots.', { nudges: NUDGES }),
    V('Prices only', 'One rule, so the difference between columns is obvious.', {
      nudges: NUDGES.filter((n) => n.id === 'px'),
    }),
    V('Off', 'No nudge rules — plus and minus do nothing.', { nudges: [] }),
  ],

  shortcuts: [
    V('Curriculum', 'k, m, b and h bound on the quantity columns.', { shortcuts: SHORTCUTS }),
    V('Millions only', 'One key bound, so an unbound letter is visibly rejected.', {
      shortcuts: SHORTCUTS.filter((s) => s.shortcutKey === 'm'),
    }),
    V('Off', 'No keys bound.', { shortcuts: [] }),
  ],

  history: [
    V('Recording', 'Edits journaled; the feed is not.', {
      nudges: NUDGES, shortcuts: SHORTCUTS, rules: DIFF_RULES,
    }),
    V('Quiet feed', 'Slower ticks, so your own edits are easy to pick out.', {
      nudges: NUDGES, shortcuts: SHORTCUTS, rules: [],
    }),
  ],

  profiles: [
    V('Risk view', 'Duration first, risk columns derived.', {
      rules: [...ROW_RULES, ...INDICATOR_RULES], calculatedColumns: CALC_COLUMNS,
      sortModel: [{ colId: 'modifiedDuration', direction: 'desc' }],
    }),
    V('P&L view', 'The day, sorted, painted.', {
      rules: PAINT_RULES, sortModel: [{ colId: 'unrealizedPnL', direction: 'desc' }],
    }),
    V('Credit view', 'Grouped by rating with the disagreement markers on.', {
      rules: INDICATOR_RULES, rowGroupColumns: ['compositeRating'],
    }),
    V('Desk view', 'Who owns what, and how much of it.', {
      rules: ROW_RULES, rowGroupColumns: ['desk', 'trader'],
      calculatedColumns: CALC_COLUMNS.filter((c) => c.colId === 'pctOfBook'),
    }),
  ],

  export: [
    V('Everything', 'Grouping, formats and rule paint — all of it lands in the file.', {
      rules: ALL_STYLE_RULES, calculatedColumns: CALC_COLUMNS, rowGroupColumns: ['desk'],
    }),
    V('Formats only', 'Number formats without conditional paint.', { rules: [] }),
    V('Flat', 'No grouping — one sheet of rows.', { rules: PAINT_RULES, rowGroupColumns: [] }),
  ],
};

export const profilesFor = (tabId: string): LabView[] => PROFILES[tabId] ?? [];
