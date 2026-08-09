import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import {
  baseColumns,
  EDIT_COLUMNS,
  LIVE_COLUMNS,
  PRICING_COLUMNS,
  type LabRow,
} from './columns';
import { buildCsrmRendererColumns } from './rendererColumns';

export interface LabChrome {
  /**
   * Classic multi-row formatting ribbon. Default off — use selection
   * mini-bar + settings drawer instead. Set true for ribbon teaching tabs.
   */
  showFormattingToolbar?: boolean;
  /** Classic editing strip (History / Smart edit / Bulk). Default off. */
  showEditingToolbar?: boolean;
  enableUpdates?: boolean;
  rowCount?: number;
  updateIntervalMs?: number;
  sideBar?: boolean | { toolPanels: string[] };
}

export interface LabFeature {
  id: string;
  label: string;
  hint: string;
  title: string;
  subtitle: string;
  /** Inspector copy: What / Why / Try */
  what: string;
  why: string;
  tryIt: string;
  /** Matches the CSRM profile catalog gridId (SSRM catalogs use ssrm- prefix). */
  gridId: string;
  getColumnDefs: () => Array<CColDef<LabRow>>;
  defaultColDef?: CColDef<LabRow>;
  chrome?: LabChrome;
}

/** Compact default: title bar + selection mini-bar (no classic ribbon). */
const fullChrome: LabChrome = {
  showFormattingToolbar: false,
  showEditingToolbar: false,
  enableUpdates: true,
  rowCount: 500,
  updateIntervalMs: 500,
  sideBar: { toolPanels: ['columns', 'filters'] },
};

/** Classic Excel-style ribbon for formatter / editing teaching tabs. */
const classicRibbonChrome: LabChrome = {
  ...fullChrome,
  showFormattingToolbar: true,
  showEditingToolbar: true,
};

export const LAB_FEATURES: LabFeature[] = [
  {
    id: 'overview',
    label: 'Overview',
    hint: 'Full feature kitchen-sink',
    title: 'Overview — kitchen-sink',
    subtitle: 'Multi-profile gallery · chrome · live mock stream',
    what: 'Full VelocityGridExt surface with several named demo layouts (kitchen sink, trader P&L, risk desk, grouped, bare). Switch layouts from the title-bar Layouts picker.',
    why: 'Same teaching thesis as MarketsGrid Feature Lab — one grid, many pre-baked layouts per tab.',
    tryIt: 'Layouts → 00 Kitchen sink → 01 Trader P&L. Select cells for the compact format bar; More opens the settings drawer (no permanent ribbon).',
    gridId: 'lab-overview-v3',
    getColumnDefs: () => baseColumns.map((c) => ({ ...c })) as CColDef<LabRow>[],
    chrome: fullChrome,
  },
  {
    id: 'formatting',
    label: 'Formatting',
    hint: 'Value formatters & types',
    title: 'Formatting',
    subtitle: '6 demo profiles · ribbon format pickers',
    what: 'Pricing + yield columns. Profiles seed distinct columnOverrides (full showcase, Excel P&L, yields, pricing precision, themed, bare).',
    why: 'Markets Lab Formatting tab — each profile is a different formatter curriculum slice.',
    tryIt: 'Layouts → 00 Full showcase, then 01 Excel P&L, then 05 Bare and paint from the ribbon.',
    gridId: 'lab-formatting-v3',
    getColumnDefs: () => PRICING_COLUMNS,
    chrome: { ...classicRibbonChrome, updateIntervalMs: 600 },
  },
  {
    id: 'visual-excel',
    label: 'Visual Excel',
    hint: 'WYSIWYG styled .xlsx export',
    title: 'Visual Excel',
    subtitle: 'Styled export · multi-profile paints',
    what: 'Pricing book with profiles for styled export (full paint, P&L-only, pricing, bare).',
    why: 'Parity tab with Markets Lab Visual Excel.',
    tryIt: 'Switch profiles, then export — paints should follow the active profile.',
    gridId: 'lab-visual-excel-v3',
    getColumnDefs: () => PRICING_COLUMNS,
    chrome: { ...classicRibbonChrome, updateIntervalMs: 600 },
  },
  {
    id: 'renderers',
    label: 'Cell Renderers',
    hint: 'Pills · heat · bars · PnL painters',
    title: 'Cell Renderers',
    subtitle: 'Multi-profile painters · pills / charts / PnL',
    what: 'Wires @velocity-grid-renderers. Profiles assign cellRenderer painters: rating-badge + status-pill (Rating/Sector/Class), heat/bars, pnl/pct-change, tags — or plain text.',
    why: 'Markets Lab Renderers tab — each profile is a painter curriculum (pills first).',
    tryIt: 'Layouts → 00 Full showcase, then 01 Pills. Rating and Sector should paint as colored pills.',
    gridId: 'lab-renderers-v4',
    getColumnDefs: () => buildCsrmRendererColumns(),
    chrome: { showFormattingToolbar: false, showEditingToolbar: false, enableUpdates: true, rowCount: 500, updateIntervalMs: 600, sideBar: { toolPanels: ['columns'] } },
  },
  {
    id: 'toolbar',
    label: 'Formatter Toolbar',
    hint: 'Live cell-style toolbar',
    title: 'Formatter Toolbar',
    subtitle: 'Ribbon practice · seeded paints optional',
    what: 'Ribbon-first tab. Profiles pre-paint yields or prices, or leave a blank canvas.',
    why: 'Markets Lab Formatter Toolbar.',
    tryIt: 'Layouts → 02 Blank canvas → select cells → Bold / Fill / Format.',
    gridId: 'lab-toolbar-v3',
    getColumnDefs: () => PRICING_COLUMNS,
    chrome: { ...classicRibbonChrome, updateIntervalMs: 600 },
  },
  {
    id: 'groups',
    label: 'Column Groups',
    hint: 'Nested header groups',
    title: 'Column Groups',
    subtitle: 'Row-group profiles · Class/Sector/Book',
    what: 'Profiles install different rowGroupColumns (Class→Sector, Book→Trader, Currency, flat).',
    why: 'Markets Lab Column Groups — hierarchy via profile switch, not one fixed layout.',
    tryIt: 'Layouts → 00 Class→Sector, then 03 Flat and drag into the group panel.',
    gridId: 'lab-groups-v3',
    getColumnDefs: () => baseColumns.map((c) => ({ ...c })) as CColDef<LabRow>[],
    chrome: { ...fullChrome, showEditingToolbar: false },
  },
  {
    id: 'calc',
    label: 'Calculated',
    hint: 'Derived virtual columns',
    title: 'Calculated Columns',
    subtitle: '5 calc profiles · virtual column sets',
    what: 'Profiles seed different calculated column sets (all 4, P&L stack, risk, spreads, empty).',
    why: 'Markets Lab Calculated Columns — switch curricula instead of one seed.',
    tryIt: 'Layouts → 00 All virtual, then 04 Empty and add your own expression.',
    gridId: 'lab-calc-v3',
    getColumnDefs: () => PRICING_COLUMNS,
    chrome: { ...fullChrome, enableUpdates: true, updateIntervalMs: 500 },
  },
  {
    id: 'conditional',
    label: 'Conditional Style',
    hint: 'Expression-driven styling · .old/.new',
    title: 'Conditional Styling',
    subtitle: 'Rule layouts · flash / row / cell / .old/.new diffs',
    what: 'Layouts install StyleRule sets including diff-aware `[midPrice.old]` / `[midPrice.new]` tick rules (up, down, |Δ| > 0.05).',
    why: 'Markets Lab Conditional Styling — each layout is a tutorial chapter; Diff (.old/.new) is the tick curriculum.',
    tryIt: 'Layouts → 02 · Diff (.old/.new). Watch Mid flash on ticks. Select cells for the format mini-bar; More → Conditional styling… for rules.',
    gridId: 'lab-conditional-v5',
    getColumnDefs: () => LIVE_COLUMNS,
    chrome: { ...fullChrome, updateIntervalMs: 500 },
  },
  {
    id: 'filters',
    label: 'Quick Filters',
    hint: 'Saved filter pill buttons',
    title: 'Quick Filters',
    subtitle: 'Saved-filter pill profiles',
    what: 'Profiles install different saved-filter pill sets (curriculum, Rates, HY, AND stack, empty capture).',
    why: 'Markets Lab Quick Filters — pills come from profile state.',
    tryIt: 'Layouts → 00 Filter pills, click USD / Financials, then 04 Capture and Funnel+ your own.',
    gridId: 'lab-filters-v3',
    getColumnDefs: () => PRICING_COLUMNS,
    chrome: { ...fullChrome, enableUpdates: false },
  },
  {
    id: 'live',
    label: 'Live Updates',
    hint: 'High-frequency stream',
    title: 'Live Updates',
    subtitle: 'Stream profiles · heat / rules / raw',
    what: 'Faster ticks with profiles for heat+flash, rules-only, or raw stream.',
    why: 'Markets Lab Live Updates — same stream, different visual overlays via profiles.',
    tryIt: 'Layouts → 00 Heat + flash, pause/resume ticks, then 02 Raw stream.',
    gridId: 'lab-live-v3',
    getColumnDefs: () => LIVE_COLUMNS,
    chrome: { showFormattingToolbar: false, showEditingToolbar: false, enableUpdates: true, rowCount: 500, updateIntervalMs: 400, sideBar: false },
  },
  {
    id: 'alerts',
    label: 'Alerts',
    hint: 'Triggers, toasts, bell',
    title: 'Alerts',
    subtitle: 'Alert-rule profiles · toast / badge',
    what: 'Profiles seed alert rule families (full, data-change, relative-change, quiet/disabled).',
    why: 'Markets Lab Alerts — switch trigger curricula from the Layouts picker.',
    tryIt: 'Layouts → 00 Full demo and wait for ticks; then 03 Quiet and enable one rule.',
    gridId: 'lab-alerts-v3',
    getColumnDefs: () => LIVE_COLUMNS,
    chrome: { ...fullChrome, rowCount: 250, updateIntervalMs: 600 },
  },
  {
    id: 'editing',
    label: 'Editing',
    hint: 'Full editing family demo',
    title: 'Editing',
    subtitle: 'Editing-family profiles · ticks paused',
    what: 'Profiles seed editSettings slices (full family, smart+bulk, nudges, shortcuts).',
    why: 'Markets Lab Editing family — one tab, many editing curricula.',
    tryIt: 'Layouts → 00 Full family, then 02 Plus/Minus and nudge Bid with +/−. Or More → Smart edit…',
    gridId: 'lab-editing-v3',
    getColumnDefs: () => EDIT_COLUMNS,
    chrome: { ...classicRibbonChrome, enableUpdates: false, rowCount: 200, sideBar: { toolPanels: ['columns'] } },
  },
  {
    id: 'bulk-update',
    label: 'Bulk Update',
    hint: 'Replace selection with one value',
    title: 'Bulk Update',
    subtitle: 'Bulk Update profiles · stable book',
    what: 'Editing chrome focused on Bulk Update with ready / undo-practice profiles.',
    why: 'Markets Lab Bulk Update.',
    tryIt: 'Select the pre-highlighted Trader range → More → Smart edit… / Bulk, or use classic Editing ribbon from More.',
    gridId: 'lab-bulk-update-v3',
    getColumnDefs: () => EDIT_COLUMNS,
    chrome: { showFormattingToolbar: false, showEditingToolbar: false, enableUpdates: false, rowCount: 200 },
  },
  {
    id: 'plus-minus',
    label: 'Plus / Minus',
    hint: 'Keyboard nudge rules',
    title: 'Plus / Minus',
    subtitle: 'Nudge-rule profiles · ± on selection',
    what: 'Profiles install different PlusMinusNudge sets (qty+bid, qty only, bid only).',
    why: 'Markets Lab Plus / Minus.',
    tryIt: 'Layouts → 02 Bid only → focus Bid → press + / −.',
    gridId: 'lab-plus-minus-v3',
    getColumnDefs: () => EDIT_COLUMNS,
    chrome: { showFormattingToolbar: false, showEditingToolbar: false, enableUpdates: false, rowCount: 200 },
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    hint: 'Letter-key arithmetic',
    title: 'Shortcuts',
    subtitle: 'Letter-key profiles · H ×100 Face',
    what: 'Profiles seed ShortcutDefinitions (H×100 Face, or empty to define your own).',
    why: 'Markets Lab Shortcuts.',
    tryIt: 'Layouts → 00 H ×100 Face → select Face → press H.',
    gridId: 'lab-shortcuts-v3',
    getColumnDefs: () => EDIT_COLUMNS,
    chrome: { showFormattingToolbar: false, showEditingToolbar: false, enableUpdates: false, rowCount: 200 },
  },
  {
    id: 'profiles',
    label: 'Profiles',
    hint: 'Pre-baked configurations',
    title: 'Profiles & Persistence',
    subtitle: 'Profile gallery · Save As · localStorage',
    what: 'Demo profiles (compact trader, risk view, blank) plus Save As for your own workspace.',
    why: 'Markets Lab Profiles thesis — configure once, reuse via the title-bar picker.',
    tryIt: 'Switch 00 ↔ 01, then 02 Blank → rearrange → Profile Save As → reload tab.',
    gridId: 'lab-profiles-v3',
    getColumnDefs: () => PRICING_COLUMNS,
    chrome: { ...fullChrome, enableUpdates: false },
  },
];

export const LAB_NAV_ITEMS = [
  { id: 'home', label: 'Home' },
  ...LAB_FEATURES.map((f) => ({ id: f.id, label: f.label })),
];

export const HINT_BY_ID: Record<string, string> = {
  home: 'Start here — what VelocityGrid Lab is',
  ...Object.fromEntries(LAB_FEATURES.map((f) => [f.id, f.hint])),
};

export function getFeature(id: string): LabFeature | undefined {
  return LAB_FEATURES.find((f) => f.id === id);
}
