/**
 * Lab demo layout catalogs (one per feature tab).
 * Each entry is a named layout seed; install folds them into one grid config
 * (`buildLabGridConfig` → view + nested layouts registry).
 */
import type { LabDemoProfileEntry, LabProfileCatalog } from './kit';
import {
  CSRM_RENDERER_FULL_OVERRIDES,
  CSRM_RENDERER_OVERRIDES,
  SSRM_RENDERER_FULL_OVERRIDES,
  SSRM_RENDERER_OVERRIDES,
} from '../rendererColumns';
import {
  CSRM_ALERT_RULES,
  CSRM_BID_NUDGE,
  CSRM_CALC_COLS,
  CSRM_PNL_OVERRIDES,
  CSRM_PRICE_OVERRIDES,
  CSRM_QTY_NUDGE,
  CSRM_QTY_SHORTCUT,
  CSRM_STYLE_RULES,
  CSRM_THEME_OVERRIDES,
  CSRM_YIELD_OVERRIDES,
  SSRM_ALERT_RULES,
  SSRM_CALC_COLS,
  SSRM_NOTIONAL_NUDGE,
  SSRM_NOTIONAL_SHORTCUT,
  SSRM_PNL_OVERRIDES,
  SSRM_PRICE_NUDGE,
  SSRM_PRICE_OVERRIDES,
  SSRM_STYLE_RULES,
  alertsSlice,
  editWithNudges,
  pickAlerts,
  pickCalc,
  pickRules,
  savedFilters,
} from './seeds';

function catalog(
  gridId: string,
  activeProfileId: string,
  profiles: LabDemoProfileEntry[],
): LabProfileCatalog {
  return { gridId, activeProfileId, profiles };
}

// ─── CSRM catalogs ───────────────────────────────────────────────────────────

export const CSRM_OVERVIEW = catalog('lab-overview-v3', 'ov-00-kitchen-sink', [
  {
    id: 'ov-00-kitchen-sink',
    name: '00 · Kitchen sink',
    blurb: 'Rules + P&L formats + calc cols + assetClass group.',
    seed: {
      rules: CSRM_STYLE_RULES,
      columnOverrides: [...CSRM_PNL_OVERRIDES, ...CSRM_PRICE_OVERRIDES.slice(0, 3)],
      calc: pickCalc(CSRM_CALC_COLS, 'bidAskSpread', 'pnlPctMkt'),
      rowGroupColumns: ['assetClass'],
    },
  },
  {
    id: 'ov-01-trader-pnl',
    name: '01 · Trader P&L',
    blurb: 'Winners/losers rules + green/red PnL formats only.',
    seed: {
      rules: pickRules(CSRM_STYLE_RULES, 'cs-loss-row', 'cs-gain-cell'),
      columnOverrides: CSRM_PNL_OVERRIDES,
    },
  },
  {
    id: 'ov-02-risk-desk',
    name: '02 · Risk desk',
    blurb: 'Yield/OAS paints + carry/risk calc + junk-row rule.',
    seed: {
      rules: pickRules(CSRM_STYLE_RULES, 'cs-junk', 'cs-big-move'),
      columnOverrides: CSRM_YIELD_OVERRIDES,
      calc: pickCalc(CSRM_CALC_COLS, 'carryRisk', 'pnlPerFace'),
    },
  },
  {
    id: 'ov-03-grouped',
    name: '03 · Grouped book',
    blurb: 'Class → Sector hierarchy; light PnL formats.',
    seed: {
      columnOverrides: CSRM_PNL_OVERRIDES.slice(0, 2),
      rowGroupColumns: ['assetClass', 'issuerSector'],
    },
  },
  {
    id: 'ov-04-bare',
    name: '04 · Bare board',
    blurb: 'Empty modules — configure from chrome.',
    seed: {},
  },
]);

export const CSRM_FORMATTING = catalog('lab-formatting-v3', 'fmt-00-full-showcase', [
  {
    id: 'fmt-00-full-showcase',
    name: '00 · Full showcase',
    blurb: 'PnL + pricing + yields + themed rating/sector paints.',
    seed: {
      columnOverrides: [
        ...CSRM_PNL_OVERRIDES,
        ...CSRM_PRICE_OVERRIDES,
        ...CSRM_YIELD_OVERRIDES,
        ...CSRM_THEME_OVERRIDES,
      ],
    },
  },
  {
    id: 'fmt-01-excel-pnl',
    name: '01 · Excel P&L',
    blurb: 'Green/red check-style PnL formats only.',
    seed: { columnOverrides: CSRM_PNL_OVERRIDES },
  },
  {
    id: 'fmt-02-yields-spreads',
    name: '02 · Yields & spreads',
    blurb: 'YTM / OAS / duration / DV01 paints.',
    seed: { columnOverrides: CSRM_YIELD_OVERRIDES },
  },
  {
    id: 'fmt-03-pricing-precision',
    name: '03 · Pricing precision',
    blurb: '3dp bid/mid, 4dp ask, themed price cells.',
    seed: { columnOverrides: CSRM_PRICE_OVERRIDES },
  },
  {
    id: 'fmt-04-themed-overrides',
    name: '04 · Themed overrides',
    blurb: 'Rating / sector / currency cell + header paints.',
    seed: { columnOverrides: CSRM_THEME_OVERRIDES },
  },
  {
    id: 'fmt-05-global-defaults',
    name: '05 · Bare columns',
    blurb: 'No overrides — use ribbon format pickers.',
    seed: { columnOverrides: [] },
  },
]);

export const CSRM_VISUAL_EXCEL = catalog('lab-visual-excel-v3', 've-00-styled', [
  {
    id: 've-00-styled',
    name: '00 · Styled export',
    blurb: 'PnL + price paints ready for WYSIWYG export.',
    seed: { columnOverrides: [...CSRM_PNL_OVERRIDES, ...CSRM_PRICE_OVERRIDES] },
  },
  {
    id: 've-01-pnl-only',
    name: '01 · P&L focus',
    blurb: 'Export-friendly green/red PnL only.',
    seed: { columnOverrides: CSRM_PNL_OVERRIDES },
  },
  {
    id: 've-02-pricing',
    name: '02 · Pricing blotter',
    blurb: 'Bid/mid/ask paint for price sheets.',
    seed: { columnOverrides: CSRM_PRICE_OVERRIDES },
  },
  {
    id: 've-03-bare',
    name: '03 · Bare then paint',
    blurb: 'Start clean; paint from ribbon, then export.',
    seed: {},
  },
]);

export const CSRM_RENDERERS = catalog('lab-renderers-v4', 'render-00-full-showcase', [
  {
    id: 'render-00-full-showcase',
    name: '00 · Full showcase',
    blurb: 'Pills · heat · bars · PnL · tags.',
    seed: { columnOverrides: [...CSRM_RENDERER_FULL_OVERRIDES] },
  },
  {
    id: 'render-01-pills',
    name: '01 · Pills',
    blurb: 'Rating badge + sector/class status pills.',
    seed: { columnOverrides: [...CSRM_RENDERER_OVERRIDES.pills] },
  },
  {
    id: 'render-02-charts',
    name: '02 · Charts & bars',
    blurb: 'OAS heat · duration progress · volume bar.',
    seed: { columnOverrides: [...CSRM_RENDERER_OVERRIDES.charts] },
  },
  {
    id: 'render-03-pnl-motion',
    name: '03 · P&L & motion',
    blurb: 'pct-change + pnl painters on P&L stack.',
    seed: { columnOverrides: [...CSRM_RENDERER_OVERRIDES.pnl] },
  },
  {
    id: 'render-04-tags',
    name: '04 · Tags',
    blurb: 'Currency tag chips.',
    seed: { columnOverrides: [...CSRM_RENDERER_OVERRIDES.tags] },
  },
  {
    id: 'render-05-plain-text',
    name: '05 · Plain text',
    blurb: 'No renderers — baseline ColDefs only.',
    seed: { columnOverrides: [] },
  },
]);

export const CSRM_TOOLBAR = catalog('lab-toolbar-v3', 'tb-00-preselected', [
  {
    id: 'tb-00-preselected',
    name: '00 · Yield paints',
    blurb: 'Yield/OAS already styled — ribbon edits stack on top.',
    seed: { columnOverrides: CSRM_YIELD_OVERRIDES },
  },
  {
    id: 'tb-01-pricing',
    name: '01 · Pricing paints',
    blurb: 'Bid/mid/ask themed for toolbar practice.',
    seed: { columnOverrides: CSRM_PRICE_OVERRIDES },
  },
  {
    id: 'tb-02-blank',
    name: '02 · Blank canvas',
    blurb: 'No overrides — select cells and format from ribbon.',
    seed: {},
  },
]);

export const CSRM_GROUPS = catalog('lab-groups-v3', 'grp-00-class-sector', [
  {
    id: 'grp-00-class-sector',
    name: '00 · Class → Sector',
    blurb: 'Two-level row groups with light PnL formats.',
    seed: {
      rowGroupColumns: ['assetClass', 'issuerSector'],
      columnOverrides: CSRM_PNL_OVERRIDES.slice(0, 2),
    },
  },
  {
    id: 'grp-01-book-trader',
    name: '01 · Book → Trader',
    blurb: 'Desk-style hierarchy.',
    seed: { rowGroupColumns: ['book', 'trader'] },
  },
  {
    id: 'grp-02-currency',
    name: '02 · Currency',
    blurb: 'Single-level CCY groups.',
    seed: { rowGroupColumns: ['currency'] },
  },
  {
    id: 'grp-03-flat',
    name: '03 · Flat (drag to group)',
    blurb: 'No groups — use the group panel.',
    seed: { rowGroupColumns: [] },
  },
]);

export const CSRM_CALC = catalog('lab-calc-v3', 'calc-00-all-virtual', [
  {
    id: 'calc-00-all-virtual',
    name: '00 · All virtual (4)',
    blurb: 'Spread, PnL/Face, PnL% Mkt, Carry/Risk.',
    seed: { calc: CSRM_CALC_COLS },
  },
  {
    id: 'calc-01-pnl-stack',
    name: '01 · P&L stack',
    blurb: 'PnL / Face + PnL % market value.',
    seed: { calc: pickCalc(CSRM_CALC_COLS, 'pnlPerFace', 'pnlPctMkt') },
  },
  {
    id: 'calc-02-risk-ratios',
    name: '02 · Risk ratios',
    blurb: 'Carry/Risk only.',
    seed: { calc: pickCalc(CSRM_CALC_COLS, 'carryRisk') },
  },
  {
    id: 'calc-03-spreads',
    name: '03 · Spreads',
    blurb: 'Bid/Ask spread virtual column.',
    seed: { calc: pickCalc(CSRM_CALC_COLS, 'bidAskSpread') },
  },
  {
    id: 'calc-04-empty',
    name: '04 · Empty — add yours',
    blurb: 'No calc cols — create from Expression Lab.',
    seed: { calc: [] },
  },
]);

export const CSRM_CONDITIONAL = catalog('lab-conditional-v5', 'cs-00-full-curriculum', [
  {
    id: 'cs-00-full-curriculum',
    name: '00 · Full curriculum',
    blurb: 'Row, cell, flash, junk + .old/.new diff rules.',
    seed: { rules: CSRM_STYLE_RULES },
  },
  {
    id: 'cs-01-flash-lab',
    name: '01 · Flash lab',
    blurb: 'Pulse mid + big-move amber + yield tick flash.',
    seed: {
      rules: pickRules(CSRM_STYLE_RULES, 'cs-flash-mid', 'cs-big-move', 'cs-diff-yield'),
    },
  },
  {
    id: 'cs-02-diff-old-new',
    name: '02 · Diff (.old/.new)',
    blurb: 'midPrice up/down + |Δ| > 0.05 — watch live ticks.',
    seed: {
      rules: pickRules(CSRM_STYLE_RULES, 'cs-diff-up', 'cs-diff-down', 'cs-diff-big'),
    },
  },
  {
    id: 'cs-03-row-indicators',
    name: '03 · Row paints',
    blurb: 'Loss row + junk rating tint.',
    seed: { rules: pickRules(CSRM_STYLE_RULES, 'cs-loss-row', 'cs-junk') },
  },
  {
    id: 'cs-04-cell-paint',
    name: '04 · Cell paint only',
    blurb: 'Gain cell style — no flash.',
    seed: { rules: pickRules(CSRM_STYLE_RULES, 'cs-gain-cell') },
  },
  {
    id: 'cs-05-all-disabled',
    name: '05 · Rules present (off)',
    blurb: 'Full list disabled — toggle on in Style Rules.',
    seed: {
      rules: CSRM_STYLE_RULES.map((r) => ({ ...r, enabled: false })),
    },
  },
]);

export const CSRM_FILTERS = catalog('lab-filters-v3', 'qf-00-curriculum', [
  {
    id: 'qf-00-curriculum',
    name: '00 · Filter pills',
    blurb: 'IG / USD / Financials saved filters; IG active.',
    seed: {
      'saved-filters': savedFilters([
        {
          id: 'sf-ig',
          label: 'IG (A+)',
          active: true,
          filterModel: {
            compositeRating: { filterType: 'set', values: ['AAA', 'AA', 'A'] },
          },
        },
        {
          id: 'sf-usd',
          label: 'USD only',
          filterModel: { currency: { filterType: 'set', values: ['USD'] } },
        },
        {
          id: 'sf-fin',
          label: 'Financials',
          filterModel: {
            issuerSector: { filterType: 'text', type: 'equals', filter: 'Financials' },
          },
        },
        {
          id: 'sf-losers',
          label: 'P&L losers',
          filterModel: {
            dailyPnL: { filterType: 'number', type: 'lessThan', filter: 0 },
          },
        },
      ]),
      filterModel: {
        compositeRating: { filterType: 'set', values: ['AAA', 'AA', 'A'] },
      },
    },
  },
  {
    id: 'qf-01-rates',
    name: '01 · Rates class',
    blurb: 'Asset class = Rates.',
    seed: {
      'saved-filters': savedFilters([
        {
          id: 'sf-rates',
          label: 'Rates',
          active: true,
          filterModel: {
            assetClass: { filterType: 'text', type: 'equals', filter: 'Rates' },
          },
        },
      ]),
      filterModel: {
        assetClass: { filterType: 'text', type: 'equals', filter: 'Rates' },
      },
    },
  },
  {
    id: 'qf-02-hy',
    name: '02 · High yield ratings',
    blurb: 'BB / B / CCC set filter.',
    seed: {
      'saved-filters': savedFilters([
        {
          id: 'sf-hy',
          label: 'HY ratings',
          active: true,
          filterModel: {
            compositeRating: { filterType: 'set', values: ['BB', 'B', 'CCC'] },
          },
        },
      ]),
      filterModel: {
        compositeRating: { filterType: 'set', values: ['BB', 'B', 'CCC'] },
      },
    },
  },
  {
    id: 'qf-03-and-stack',
    name: '03 · AND stack',
    blurb: 'USD + Financials both active.',
    seed: {
      'saved-filters': savedFilters([
        {
          id: 'sf-usd',
          label: 'USD',
          active: true,
          filterModel: { currency: { filterType: 'set', values: ['USD'] } },
        },
        {
          id: 'sf-fin',
          label: 'Financials',
          active: true,
          filterModel: {
            issuerSector: { filterType: 'text', type: 'equals', filter: 'Financials' },
          },
        },
      ]),
    },
  },
  {
    id: 'qf-04-capture',
    name: '04 · Capture workflow',
    blurb: 'Empty pills — set a filter, then Funnel+.',
    seed: { 'saved-filters': [] },
  },
]);

export const CSRM_LIVE = catalog('lab-live-v3', 'live-00-heat', [
  {
    id: 'live-00-heat',
    name: '00 · Heat + flash',
    blurb: 'PnL formats + mid pulse while ticks fly.',
    seed: {
      columnOverrides: CSRM_PNL_OVERRIDES,
      rules: pickRules(CSRM_STYLE_RULES, 'cs-flash-mid', 'cs-gain-cell'),
    },
  },
  {
    id: 'live-01-rules-only',
    name: '01 · Rules only',
    blurb: 'Loss row + big move; no format overrides.',
    seed: { rules: pickRules(CSRM_STYLE_RULES, 'cs-loss-row', 'cs-big-move') },
  },
  {
    id: 'live-02-raw',
    name: '02 · Raw stream',
    blurb: 'Bare columns — feel native cell flash.',
    seed: {},
  },
]);

export const CSRM_ALERTS = catalog('lab-alerts-v3', 'alert-00-full-demo', [
  {
    id: 'alert-00-full-demo',
    name: '00 · Full demo',
    blurb: 'Relative-change + data-change + badge-only rules.',
    seed: { alerts: alertsSlice(CSRM_ALERT_RULES) },
  },
  {
    id: 'alert-01-data-change',
    name: '01 · Data-change',
    blurb: 'Daily loss + crossed market expressions.',
    seed: {
      alerts: alertsSlice(pickAlerts(CSRM_ALERT_RULES, 'alert-loss', 'alert-bid-spike')),
    },
  },
  {
    id: 'alert-02-relative-change',
    name: '02 · Relative-change',
    blurb: 'lastPrice absolute-change threshold.',
    seed: {
      alerts: alertsSlice(pickAlerts(CSRM_ALERT_RULES, 'alert-big-move')),
    },
  },
  {
    id: 'alert-03-quiet',
    name: '03 · Quiet (disabled)',
    blurb: 'Rules present but off — enable in Alerts UI.',
    seed: {
      alerts: alertsSlice(CSRM_ALERT_RULES.map((r) => ({ ...r, enabled: false }))),
    },
  },
]);

export const CSRM_EDITING = catalog('lab-editing-v3', 'ed-00-full-family', [
  {
    id: 'ed-00-full-family',
    name: '00 · Full family',
    blurb: 'Smart edit + bulk + qty/bid nudges + H shortcut.',
    seed: {
      editSettings: editWithNudges(
        [CSRM_QTY_NUDGE, CSRM_BID_NUDGE],
        [CSRM_QTY_SHORTCUT],
      ),
    },
  },
  {
    id: 'ed-01-smart-bulk',
    name: '01 · Smart + Bulk',
    blurb: 'Editing chrome on; no nudges/shortcuts seeded.',
    seed: { editSettings: editWithNudges([]) },
  },
  {
    id: 'ed-02-nudges',
    name: '02 · Plus/Minus focus',
    blurb: 'Qty ±100 and Bid ±0.01 only.',
    seed: { editSettings: editWithNudges([CSRM_QTY_NUDGE, CSRM_BID_NUDGE]) },
  },
  {
    id: 'ed-03-shortcuts',
    name: '03 · Shortcuts focus',
    blurb: 'H ×100 on Face.',
    seed: { editSettings: editWithNudges([], [CSRM_QTY_SHORTCUT]) },
  },
]);

export const CSRM_BULK = catalog('lab-bulk-update-v3', 'bu-00-ready', [
  {
    id: 'bu-00-ready',
    name: '00 · Bulk ready',
    blurb: 'Bulk Update enabled; edit trader / face ranges.',
    seed: { editSettings: editWithNudges([]) },
  },
  {
    id: 'bu-01-with-history',
    name: '01 · With undo depth',
    blurb: 'Same as 00 — practice undo after bulk set.',
    seed: { editSettings: editWithNudges([]) },
  },
]);

export const CSRM_PLUS_MINUS = catalog('lab-plus-minus-v3', 'pm-00-qty-bid', [
  {
    id: 'pm-00-qty-bid',
    name: '00 · Qty + Bid nudges',
    blurb: 'Face ±100 and Bid ±0.01.',
    seed: { editSettings: editWithNudges([CSRM_QTY_NUDGE, CSRM_BID_NUDGE]) },
  },
  {
    id: 'pm-01-qty-only',
    name: '01 · Qty only',
    blurb: 'Face ±100.',
    seed: { editSettings: editWithNudges([CSRM_QTY_NUDGE]) },
  },
  {
    id: 'pm-02-bid-only',
    name: '02 · Bid only',
    blurb: 'Bid ±0.01 — focus Bid and press +/−.',
    seed: { editSettings: editWithNudges([CSRM_BID_NUDGE]) },
  },
]);

export const CSRM_SHORTCUTS = catalog('lab-shortcuts-v3', 'sc-00-h-qty', [
  {
    id: 'sc-00-h-qty',
    name: '00 · H ×100 Face',
    blurb: 'Select Face cells, press H.',
    seed: { editSettings: editWithNudges([], [CSRM_QTY_SHORTCUT]) },
  },
  {
    id: 'sc-01-empty',
    name: '01 · Define your own',
    blurb: 'No shortcuts — add from editing chrome.',
    seed: { editSettings: editWithNudges([]) },
  },
]);

export const CSRM_PROFILES = catalog('lab-profiles-v3', 'pr-00-compact', [
  {
    id: 'pr-00-compact',
    name: '00 · Compact trader',
    blurb: 'Hidden risk cols; PnL formats; save & switch.',
    seed: {
      columnOverrides: [
        ...CSRM_PNL_OVERRIDES,
        ovHide('oas'),
        ovHide('modifiedDuration'),
        ovHide('dv01'),
      ],
    },
  },
  {
    id: 'pr-01-risk-view',
    name: '01 · Risk view',
    blurb: 'Yields + carry calc; no PnL paints.',
    seed: {
      columnOverrides: CSRM_YIELD_OVERRIDES,
      calc: pickCalc(CSRM_CALC_COLS, 'carryRisk'),
    },
  },
  {
    id: 'pr-02-blank',
    name: '02 · Blank workspace',
    blurb: 'Empty — rearrange, Save As, reload tab.',
    seed: {},
  },
]);

function ovHide(colId: string) {
  return { colId, hide: true };
}

const CSRM_BY_FEATURE: Record<string, LabProfileCatalog> = {
  overview: CSRM_OVERVIEW,
  formatting: CSRM_FORMATTING,
  'visual-excel': CSRM_VISUAL_EXCEL,
  renderers: CSRM_RENDERERS,
  toolbar: CSRM_TOOLBAR,
  groups: CSRM_GROUPS,
  calc: CSRM_CALC,
  conditional: CSRM_CONDITIONAL,
  filters: CSRM_FILTERS,
  live: CSRM_LIVE,
  alerts: CSRM_ALERTS,
  editing: CSRM_EDITING,
  'bulk-update': CSRM_BULK,
  'plus-minus': CSRM_PLUS_MINUS,
  shortcuts: CSRM_SHORTCUTS,
  profiles: CSRM_PROFILES,
};

// ─── SSRM catalogs (MockPosition schema) ─────────────────────────────────────

export const SSRM_OVERVIEW = catalog('ssrm-lab-overview-v3', 'ov-00-kitchen-sink', [
  {
    id: 'ov-00-kitchen-sink',
    name: '00 · Kitchen sink',
    blurb: 'Desk group + PnL heat + calc + style rules.',
    seed: {
      rules: SSRM_STYLE_RULES,
      columnOverrides: SSRM_PNL_OVERRIDES,
      calc: SSRM_CALC_COLS,
      rowGroupColumns: ['desk'],
    },
  },
  {
    id: 'ov-01-trader-pnl',
    name: '01 · Trader P&L',
    blurb: 'Loss/gain rules + green/red PnL.',
    seed: {
      rules: pickRules(SSRM_STYLE_RULES, 'ssrm-loss-row', 'ssrm-gain-cell'),
      columnOverrides: SSRM_PNL_OVERRIDES,
    },
  },
  {
    id: 'ov-02-desk-region',
    name: '02 · Desk → Region',
    blurb: 'Two-level SSRM groups.',
    seed: { rowGroupColumns: ['desk', 'region'] },
  },
  {
    id: 'ov-03-bare',
    name: '03 · Bare board',
    blurb: 'Empty modules.',
    seed: {},
  },
]);

export const SSRM_FORMATTING = catalog('ssrm-lab-formatting-v3', 'fmt-00-full', [
  {
    id: 'fmt-00-full',
    name: '00 · Full showcase',
    blurb: 'PnL + price/notional paints.',
    seed: { columnOverrides: [...SSRM_PNL_OVERRIDES, ...SSRM_PRICE_OVERRIDES] },
  },
  {
    id: 'fmt-01-pnl',
    name: '01 · Excel P&L',
    blurb: 'Green/red PnL only.',
    seed: { columnOverrides: SSRM_PNL_OVERRIDES },
  },
  {
    id: 'fmt-02-pricing',
    name: '02 · Pricing / size',
    blurb: 'Price + notional + MV formats.',
    seed: { columnOverrides: SSRM_PRICE_OVERRIDES },
  },
  {
    id: 'fmt-03-bare',
    name: '03 · Bare columns',
    blurb: 'Use ribbon format pickers.',
    seed: {},
  },
]);

export const SSRM_VISUAL_EXCEL = catalog('ssrm-lab-visual-excel-v3', 've-00-styled', [
  {
    id: 've-00-styled',
    name: '00 · Styled export',
    blurb: 'PnL + price paints for export.',
    seed: { columnOverrides: [...SSRM_PNL_OVERRIDES, ...SSRM_PRICE_OVERRIDES] },
  },
  {
    id: 've-01-pnl',
    name: '01 · P&L focus',
    blurb: 'PnL formats only.',
    seed: { columnOverrides: SSRM_PNL_OVERRIDES },
  },
  {
    id: 've-02-bare',
    name: '02 · Bare then paint',
    blurb: 'Start clean.',
    seed: {},
  },
]);

export const SSRM_RENDERERS = catalog('ssrm-lab-renderers-v4', 'render-00-full-showcase', [
  {
    id: 'render-00-full-showcase',
    name: '00 · Full showcase',
    blurb: 'Desk/region pills · bars · PnL painters.',
    seed: { columnOverrides: [...SSRM_RENDERER_FULL_OVERRIDES] },
  },
  {
    id: 'render-01-pills',
    name: '01 · Pills',
    blurb: 'Desk + region status pills + currency tag.',
    seed: { columnOverrides: [...SSRM_RENDERER_OVERRIDES.pills] },
  },
  {
    id: 'render-02-charts',
    name: '02 · Charts & bars',
    blurb: 'Volume bars + price heat.',
    seed: { columnOverrides: [...SSRM_RENDERER_OVERRIDES.charts] },
  },
  {
    id: 'render-03-pnl-motion',
    name: '03 · P&L painters',
    blurb: 'pnl renderer on PnL / Daily PnL.',
    seed: { columnOverrides: [...SSRM_RENDERER_OVERRIDES.pnl] },
  },
  {
    id: 'render-04-plain-text',
    name: '04 · Plain text',
    blurb: 'No renderers — baseline columns.',
    seed: { columnOverrides: [] },
  },
]);

export const SSRM_TOOLBAR = catalog('ssrm-lab-toolbar-v3', 'tb-00-price', [
  {
    id: 'tb-00-price',
    name: '00 · Price paints',
    blurb: 'Pre-styled price/notional for ribbon practice.',
    seed: { columnOverrides: SSRM_PRICE_OVERRIDES },
  },
  {
    id: 'tb-01-blank',
    name: '01 · Blank canvas',
    blurb: 'Select cells → format from ribbon.',
    seed: {},
  },
]);

export const SSRM_GROUPS = catalog('ssrm-lab-groups-v3', 'grp-00-desk-region', [
  {
    id: 'grp-00-desk-region',
    name: '00 · Desk → Region',
    blurb: 'Two-level SSRM groups.',
    seed: {
      rowGroupColumns: ['desk', 'region'],
      columnOverrides: SSRM_PNL_OVERRIDES,
    },
  },
  {
    id: 'grp-01-desk',
    name: '01 · Desk only',
    blurb: 'Single-level desk groups.',
    seed: { rowGroupColumns: ['desk'] },
  },
  {
    id: 'grp-02-currency',
    name: '02 · Currency',
    blurb: 'Group by CCY.',
    seed: { rowGroupColumns: ['currency'] },
  },
  {
    id: 'grp-03-flat',
    name: '03 · Flat',
    blurb: 'No groups — drag into panel.',
    seed: { rowGroupColumns: [] },
  },
]);

export const SSRM_CALC = catalog('ssrm-lab-calc-v3', 'calc-00-all', [
  {
    id: 'calc-00-all',
    name: '00 · All virtual',
    blurb: 'PnL % Mkt + MV/Notional.',
    seed: { calc: SSRM_CALC_COLS },
  },
  {
    id: 'calc-01-pnl-pct',
    name: '01 · PnL % Mkt',
    blurb: 'One derived column.',
    seed: { calc: pickCalc(SSRM_CALC_COLS, 'pnlPctMkt') },
  },
  {
    id: 'calc-02-empty',
    name: '02 · Empty — add yours',
    blurb: 'Create expressions from chrome.',
    seed: { calc: [] },
  },
]);

export const SSRM_CONDITIONAL = catalog('ssrm-lab-conditional-v5', 'cs-00-full', [
  {
    id: 'cs-00-full',
    name: '00 · Full curriculum',
    blurb: 'Row/cell paints + price .old/.new diffs.',
    seed: { rules: SSRM_STYLE_RULES },
  },
  {
    id: 'cs-01-flash',
    name: '01 · Flash / paint',
    blurb: 'Gain cells + large notional.',
    seed: {
      rules: pickRules(SSRM_STYLE_RULES, 'ssrm-gain-cell', 'ssrm-big-notional'),
    },
  },
  {
    id: 'cs-02-diff-old-new',
    name: '02 · Diff (.old/.new)',
    blurb: 'price up/down + |Δ| > 0.08 on live SSRM ticks.',
    seed: {
      rules: pickRules(SSRM_STYLE_RULES, 'ssrm-diff-up', 'ssrm-diff-down', 'ssrm-diff-big'),
    },
  },
  {
    id: 'cs-03-row',
    name: '03 · Row paints',
    blurb: 'Loss-day row tint.',
    seed: { rules: pickRules(SSRM_STYLE_RULES, 'ssrm-loss-row') },
  },
  {
    id: 'cs-04-off',
    name: '04 · Rules present (off)',
    blurb: 'Disabled — toggle in Style Rules.',
    seed: { rules: SSRM_STYLE_RULES.map((r) => ({ ...r, enabled: false })) },
  },
]);

export const SSRM_FILTERS = catalog('ssrm-lab-filters-v3', 'qf-00-curriculum', [
  {
    id: 'qf-00-curriculum',
    name: '00 · Filter pills',
    blurb: 'Rates+Credit / AMER / large notional.',
    seed: {
      'saved-filters': savedFilters([
        {
          id: 'sf-rates',
          label: 'Rates+Credit',
          active: true,
          filterModel: { desk: { filterType: 'set', values: ['Rates', 'Credit'] } },
        },
        {
          id: 'sf-amer',
          label: 'AMER',
          filterModel: { region: { filterType: 'set', values: ['AMER'] } },
        },
        {
          id: 'sf-big',
          label: 'Notional > 5M',
          filterModel: {
            notional: { filterType: 'number', type: 'greaterThan', filter: 5_000_000 },
          },
        },
      ]),
      filterModel: { desk: { filterType: 'set', values: ['Rates', 'Credit'] } },
    },
  },
  {
    id: 'qf-01-amer',
    name: '01 · AMER only',
    blurb: 'Region set filter.',
    seed: {
      'saved-filters': savedFilters([
        {
          id: 'sf-amer',
          label: 'AMER',
          active: true,
          filterModel: { region: { filterType: 'set', values: ['AMER'] } },
        },
      ]),
      filterModel: { region: { filterType: 'set', values: ['AMER'] } },
    },
  },
  {
    id: 'qf-02-capture',
    name: '02 · Capture workflow',
    blurb: 'Empty pills — Funnel+ after filtering.',
    seed: { 'saved-filters': [] },
  },
]);

export const SSRM_LIVE = catalog('ssrm-lab-live-v3', 'live-00-heat', [
  {
    id: 'live-00-heat',
    name: '00 · Heat stream',
    blurb: 'PnL formats while SSRM ticks.',
    seed: { columnOverrides: SSRM_PNL_OVERRIDES },
  },
  {
    id: 'live-01-rules',
    name: '01 · Rules stream',
    blurb: 'Loss/gain rules on live book.',
    seed: { rules: pickRules(SSRM_STYLE_RULES, 'ssrm-loss-row', 'ssrm-gain-cell') },
  },
  {
    id: 'live-02-raw',
    name: '02 · Raw stream',
    blurb: 'Bare columns.',
    seed: {},
  },
]);

export const SSRM_ALERTS = catalog('ssrm-lab-alerts-v3', 'alert-00-full', [
  {
    id: 'alert-00-full',
    name: '00 · Full demo',
    blurb: 'Loss + price-move alerts.',
    seed: { alerts: alertsSlice(SSRM_ALERT_RULES) },
  },
  {
    id: 'alert-01-loss',
    name: '01 · Loss only',
    blurb: 'dailyPnl data-change alert.',
    seed: {
      alerts: alertsSlice(pickAlerts(SSRM_ALERT_RULES, 'ssrm-alert-loss')),
    },
  },
  {
    id: 'alert-02-quiet',
    name: '02 · Quiet (disabled)',
    blurb: 'Rules off — enable in Alerts UI.',
    seed: {
      alerts: alertsSlice(SSRM_ALERT_RULES.map((r) => ({ ...r, enabled: false }))),
    },
  },
]);

export const SSRM_EDITING = catalog('ssrm-lab-editing-v3', 'ed-00-full', [
  {
    id: 'ed-00-full',
    name: '00 · Full family',
    blurb: 'Nudges + H shortcut on notional.',
    seed: {
      editSettings: editWithNudges(
        [SSRM_NOTIONAL_NUDGE, SSRM_PRICE_NUDGE],
        [SSRM_NOTIONAL_SHORTCUT],
      ),
    },
  },
  {
    id: 'ed-01-smart-bulk',
    name: '01 · Smart + Bulk',
    blurb: 'Chrome on; no nudges seeded.',
    seed: { editSettings: editWithNudges([]) },
  },
  {
    id: 'ed-02-nudges',
    name: '02 · Plus/Minus',
    blurb: 'Notional ±100k and Price ±0.01.',
    seed: {
      editSettings: editWithNudges([SSRM_NOTIONAL_NUDGE, SSRM_PRICE_NUDGE]),
    },
  },
]);

export const SSRM_BULK = catalog('ssrm-lab-bulk-update-v3', 'bu-00-ready', [
  {
    id: 'bu-00-ready',
    name: '00 · Bulk ready',
    blurb: 'Edit trader ranges via Bulk Update.',
    seed: { editSettings: editWithNudges([]) },
  },
]);

export const SSRM_PLUS_MINUS = catalog('ssrm-lab-plus-minus-v3', 'pm-00-both', [
  {
    id: 'pm-00-both',
    name: '00 · Notional + Price',
    blurb: '± nudges on both columns.',
    seed: {
      editSettings: editWithNudges([SSRM_NOTIONAL_NUDGE, SSRM_PRICE_NUDGE]),
    },
  },
  {
    id: 'pm-01-price',
    name: '01 · Price only',
    blurb: 'Focus Price and press +/−.',
    seed: { editSettings: editWithNudges([SSRM_PRICE_NUDGE]) },
  },
]);

export const SSRM_SHORTCUTS = catalog('ssrm-lab-shortcuts-v3', 'sc-00-h', [
  {
    id: 'sc-00-h',
    name: '00 · H ×10 Notional',
    blurb: 'Select Notional, press H.',
    seed: { editSettings: editWithNudges([], [SSRM_NOTIONAL_SHORTCUT]) },
  },
  {
    id: 'sc-01-empty',
    name: '01 · Define your own',
    blurb: 'No shortcuts seeded.',
    seed: { editSettings: editWithNudges([]) },
  },
]);

export const SSRM_PROFILES = catalog('ssrm-lab-profiles-v3', 'pr-00-compact', [
  {
    id: 'pr-00-compact',
    name: '00 · Compact desk',
    blurb: 'PnL heat + desk group — save & switch.',
    seed: {
      columnOverrides: SSRM_PNL_OVERRIDES,
      rowGroupColumns: ['desk'],
    },
  },
  {
    id: 'pr-01-flat-paint',
    name: '01 · Flat + price paint',
    blurb: 'No groups; price/notional styles.',
    seed: { columnOverrides: SSRM_PRICE_OVERRIDES, rowGroupColumns: [] },
  },
  {
    id: 'pr-02-blank',
    name: '02 · Blank workspace',
    blurb: 'Empty — Save As your own.',
    seed: {},
  },
]);

const SSRM_BY_FEATURE: Record<string, LabProfileCatalog> = {
  overview: SSRM_OVERVIEW,
  formatting: SSRM_FORMATTING,
  'visual-excel': SSRM_VISUAL_EXCEL,
  renderers: SSRM_RENDERERS,
  toolbar: SSRM_TOOLBAR,
  groups: SSRM_GROUPS,
  calc: SSRM_CALC,
  conditional: SSRM_CONDITIONAL,
  filters: SSRM_FILTERS,
  live: SSRM_LIVE,
  alerts: SSRM_ALERTS,
  editing: SSRM_EDITING,
  'bulk-update': SSRM_BULK,
  'plus-minus': SSRM_PLUS_MINUS,
  shortcuts: SSRM_SHORTCUTS,
  profiles: SSRM_PROFILES,
};

export type LabMode = 'csrm' | 'ssrm';

export function getLabCatalog(featureId: string, mode: LabMode): LabProfileCatalog | undefined {
  return (mode === 'ssrm' ? SSRM_BY_FEATURE : CSRM_BY_FEATURE)[featureId];
}
