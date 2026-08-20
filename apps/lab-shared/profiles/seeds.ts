import type { ColumnOverride } from '@wellsfargo-starui/velocity-grid/calc';
import type { StyleRule, AlertRule } from '@wellsfargo-starui/velocity-grid/rules';
import type { CalculatedColumnDef } from '@wellsfargo-starui/velocity-grid/calc';
import type { PlusMinusNudge, ShortcutDefinition } from '@wellsfargo-starui/velocity-grid-ext/edit';
import type { LabModuleSeed } from './kit';

/** Column paint / format helpers (VelocityGrid columnOverrides module). */
export function ov(
  colId: string,
  patch: Omit<ColumnOverride, 'colId'>,
): ColumnOverride {
  return { colId, ...patch };
}

export const CSRM_PNL_OVERRIDES: ColumnOverride[] = [
  ov('dailyPnL', {
    format: '[Green]#,##0;[Red](#,##0)',
    cellStyle: { fontWeight: 600 },
  }),
  ov('unrealizedPnL', {
    format: '[Green]#,##0;[Red](#,##0)',
    cellStyle: { fontWeight: 600 },
  }),
  ov('mtdPnL', { format: '[Green]#,##0;[Red](#,##0)' }),
  ov('ytdPnL', { format: '[Green]#,##0;[Red](#,##0)' }),
  ov('priceChangePct', {
    format: '[>0][Green]▲0.000%;[<0][Red]▼0.000%;0.000%',
  }),
];

export const CSRM_PRICE_OVERRIDES: ColumnOverride[] = [
  ov('bidPrice', {
    format: '#,##0.000',
    cellStyle: { backgroundColor: 'rgba(60,100,160,0.35)', fontWeight: 600 },
  }),
  ov('midPrice', {
    format: '#,##0.000',
    cellStyle: { backgroundColor: 'rgba(50,120,100,0.3)' },
  }),
  ov('askPrice', {
    format: '#,##0.0000',
    cellStyle: { backgroundColor: 'rgba(140,80,40,0.35)', fontWeight: 600 },
  }),
  ov('lastPrice', { format: '#,##0.000' }),
];

export const CSRM_YIELD_OVERRIDES: ColumnOverride[] = [
  ov('yieldToMaturity', {
    format: '0.000"%"',
    cellStyle: { color: '#9ad0ff' },
  }),
  ov('oas', {
    format: '0.00" bp"',
    cellStyle: { color: '#ffc978' },
  }),
  ov('modifiedDuration', { format: '0.00' }),
  ov('dv01', { format: '#,##0' }),
];

export const CSRM_THEME_OVERRIDES: ColumnOverride[] = [
  ov('compositeRating', {
    cellStyle: { backgroundColor: 'rgba(80,60,140,0.4)', fontWeight: 600 },
    headerStyle: { backgroundColor: 'rgba(80,60,140,0.55)' },
  }),
  ov('issuerSector', {
    cellStyle: { backgroundColor: 'rgba(40,90,110,0.35)' },
  }),
  ov('currency', {
    cellStyle: { backgroundColor: 'rgba(100,80,40,0.35)', textAlign: 'center' },
  }),
];

export const SSRM_PNL_OVERRIDES: ColumnOverride[] = [
  ov('pnl', {
    format: '[Green]#,##0;[Red](#,##0)',
    cellStyle: { fontWeight: 600 },
  }),
  ov('dailyPnl', {
    format: '[Green]#,##0;[Red](#,##0)',
    cellStyle: { fontWeight: 600 },
  }),
];

export const SSRM_PRICE_OVERRIDES: ColumnOverride[] = [
  ov('price', {
    format: '#,##0.0000',
    cellStyle: { backgroundColor: 'rgba(50,120,100,0.35)', fontWeight: 600 },
  }),
  ov('notional', {
    format: '#,##0',
    cellStyle: { backgroundColor: 'rgba(60,100,160,0.3)' },
  }),
  ov('marketValue', { format: '#,##0' }),
];

export const CSRM_STYLE_RULES: StyleRule[] = [
  {
    id: 'cs-loss-row',
    name: 'Loss day (row)',
    kind: 'style',
    enabled: true,
    priority: 10,
    condition: '[dailyPnL] < 0',
    scope: { kind: 'row' },
    style: { base: { backgroundColor: 'rgba(160,40,40,0.22)' } },
  },
  {
    id: 'cs-gain-cell',
    name: 'Gain daily PnL',
    kind: 'style',
    enabled: true,
    priority: 20,
    condition: '[dailyPnL] > 0',
    scope: { kind: 'cell', columnIds: ['dailyPnL', 'unrealizedPnL'] },
    style: { base: { color: '#7dffa8', fontWeight: 'bold' } },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'fade',
      color: '#3dffa0',
      durationMs: 600,
    },
  },
  {
    id: 'cs-big-move',
    name: 'Big % move',
    kind: 'style',
    enabled: true,
    priority: 30,
    condition: 'ABS([priceChangePct]) > 0.5',
    scope: { kind: 'cell', columnIds: ['priceChangePct'] },
    style: { base: { backgroundColor: 'rgba(180,120,20,0.45)', fontWeight: 'bold' } },
  },
  {
    id: 'cs-junk',
    name: 'Junk rating tint',
    kind: 'style',
    enabled: true,
    priority: 15,
    condition: '[compositeRating] == "BB" || [compositeRating] == "B" || [compositeRating] == "CCC"',
    scope: { kind: 'row' },
    style: { base: { backgroundColor: 'rgba(120,80,20,0.18)' } },
  },
  {
    id: 'cs-flash-mid',
    name: 'Mid tick flash',
    kind: 'style',
    enabled: true,
    priority: 40,
    condition: 'true',
    scope: { kind: 'cell', columnIds: ['midPrice', 'lastPrice'] },
    style: { base: {} },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'pulse',
      color: '#6ec8ff',
      durationMs: 400,
    },
  },
  // Diff-aware (.old / .new) — Markets Lab conditional curriculum
  {
    id: 'cs-diff-up',
    name: 'Diff up — midPrice ticked higher',
    kind: 'style',
    enabled: true,
    priority: 6,
    condition: '[midPrice.old] != null && [midPrice.new] > [midPrice.old]',
    scope: { kind: 'cell', columnIds: ['midPrice'] },
    style: {
      base: { backgroundColor: '#0f2b1c', color: '#7fdf9b', fontWeight: 600 },
    },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'fade',
      color: '#3dffa0',
      durationMs: 500,
    },
    indicator: {
      iconName: 'arrow-up',
      color: '#7fdf9b',
      target: 'cell',
      position: 'before',
    },
    activeDurationMs: 1500,
  },
  {
    id: 'cs-diff-down',
    name: 'Diff down — midPrice ticked lower',
    kind: 'style',
    enabled: true,
    priority: 6,
    condition: '[midPrice.old] != null && [midPrice.new] < [midPrice.old]',
    scope: { kind: 'cell', columnIds: ['midPrice'] },
    style: {
      base: { backgroundColor: '#3a1818', color: '#ee8e8e', fontWeight: 600 },
    },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'fade',
      color: '#fb7185',
      durationMs: 500,
    },
    indicator: {
      iconName: 'arrow-down',
      color: '#ee8e8e',
      target: 'cell',
      position: 'before',
    },
    activeDurationMs: 1500,
  },
  {
    id: 'cs-diff-big',
    name: 'Big tick — |Δ mid| > 0.05',
    kind: 'style',
    enabled: true,
    priority: 7,
    condition: '[midPrice.old] != null && ABS([midPrice.new] - [midPrice.old]) > 0.05',
    scope: { kind: 'cell', columnIds: ['midPrice', 'bidPrice', 'askPrice'] },
    style: {
      base: { backgroundColor: '#3a3010', color: '#f0d878', fontWeight: 700 },
    },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'glow',
      color: '#f0b429',
      durationMs: 800,
    },
    activeDurationMs: 2500,
  },
  {
    id: 'cs-diff-yield',
    name: 'Yield tick — .old != .new',
    kind: 'style',
    enabled: true,
    priority: 7,
    condition: '[yieldToMaturity.old] != null && [yieldToMaturity.new] != [yieldToMaturity.old]',
    scope: { kind: 'cell', columnIds: ['yieldToMaturity'] },
    style: { base: {} },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'fade',
      color: '#6ec8ff',
      durationMs: 600,
    },
    activeDurationMs: 600,
  },
];

export const SSRM_STYLE_RULES: StyleRule[] = [
  {
    id: 'ssrm-loss-row',
    name: 'Loss day (row)',
    kind: 'style',
    enabled: true,
    priority: 10,
    condition: '[dailyPnl] < 0',
    scope: { kind: 'row' },
    style: { base: { backgroundColor: 'rgba(160,40,40,0.22)' } },
  },
  {
    id: 'ssrm-gain-cell',
    name: 'Gain daily PnL',
    kind: 'style',
    enabled: true,
    priority: 20,
    condition: '[dailyPnl] > 0',
    scope: { kind: 'cell', columnIds: ['dailyPnl', 'pnl'] },
    style: { base: { color: '#7dffa8', fontWeight: 'bold' } },
  },
  {
    id: 'ssrm-big-notional',
    name: 'Large notional',
    kind: 'style',
    enabled: true,
    priority: 30,
    condition: '[notional] > 5000000',
    scope: { kind: 'cell', columnIds: ['notional'] },
    style: { base: { backgroundColor: 'rgba(60,100,160,0.4)', fontWeight: 'bold' } },
  },
  {
    id: 'ssrm-diff-up',
    name: 'Diff up — price ticked higher',
    kind: 'style',
    enabled: true,
    priority: 6,
    condition: '[price.old] != null && [price.new] > [price.old]',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: {
      base: { backgroundColor: '#0f2b1c', color: '#7fdf9b', fontWeight: 600 },
    },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'fade',
      color: '#3dffa0',
      durationMs: 500,
    },
    activeDurationMs: 1500,
  },
  {
    id: 'ssrm-diff-down',
    name: 'Diff down — price ticked lower',
    kind: 'style',
    enabled: true,
    priority: 6,
    condition: '[price.old] != null && [price.new] < [price.old]',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: {
      base: { backgroundColor: '#3a1818', color: '#ee8e8e', fontWeight: 600 },
    },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'fade',
      color: '#fb7185',
      durationMs: 500,
    },
    activeDurationMs: 1500,
  },
  {
    id: 'ssrm-diff-big',
    name: 'Big tick — |Δ price| > 0.08',
    kind: 'style',
    enabled: true,
    priority: 7,
    condition: '[price.old] != null && ABS([price.new] - [price.old]) > 0.08',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: {
      base: { backgroundColor: '#3a3010', color: '#f0d878', fontWeight: 700 },
    },
    flash: {
      enabled: true,
      target: 'cell',
      mode: 'glow',
      color: '#f0b429',
      durationMs: 800,
    },
    activeDurationMs: 2500,
  },
];

export const CSRM_CALC_COLS: CalculatedColumnDef[] = [
  {
    colId: 'bidAskSpread',
    headerName: 'Bid/Ask Spr',
    expression: '[askPrice] - [bidPrice]',
    cellDataType: 'number',
    format: '0.0000',
    initialWidth: 110,
  },
  {
    colId: 'pnlPerFace',
    headerName: 'PnL / Face',
    expression: '[dailyPnL] / [quantityFace]',
    cellDataType: 'number',
    format: '0.0000',
    initialWidth: 110,
  },
  {
    colId: 'pnlPctMkt',
    headerName: 'PnL % Mkt',
    expression: '[dailyPnL] / [marketValue] * 100',
    cellDataType: 'number',
    format: '0.00"%"',
    initialWidth: 110,
  },
  {
    colId: 'carryRisk',
    headerName: 'Carry/Risk',
    expression: '[dailyPnL] / MAX([dv01], 1)',
    cellDataType: 'number',
    format: '0.00',
    initialWidth: 110,
  },
];

export const SSRM_CALC_COLS: CalculatedColumnDef[] = [
  {
    colId: 'pnlPctMkt',
    headerName: 'PnL % Mkt',
    expression: '[dailyPnl] / MAX([marketValue], 1) * 100',
    cellDataType: 'number',
    format: '0.00"%"',
    initialWidth: 110,
  },
  {
    colId: 'mvNotional',
    headerName: 'MV / Notional',
    expression: '[marketValue] / MAX([notional], 1)',
    cellDataType: 'number',
    format: '0.0000',
    initialWidth: 120,
  },
];

export const CSRM_ALERT_RULES: AlertRule[] = [
  {
    id: 'alert-big-move',
    name: 'Price move',
    enabled: true,
    priority: 10,
    severity: 'warning',
    trigger: {
      kind: 'relativeChange',
      colId: 'lastPrice',
      mode: 'ABSOLUTE_CHANGE',
      threshold: 0.15,
      direction: 'both',
    },
    message: '{rule}: {rowId} lastPrice {prev} → {value}',
    channels: ['toast', 'badge'],
    debounceMs: 1500,
  },
  {
    id: 'alert-loss',
    name: 'Daily loss',
    enabled: true,
    priority: 20,
    severity: 'critical',
    trigger: {
      kind: 'dataChange',
      expression: '[dailyPnL] < -20000',
      columnIds: ['dailyPnL'],
    },
    message: 'Loss spike on {rowId}: {value}',
    channels: ['toast', 'badge'],
    debounceMs: 2000,
  },
  {
    id: 'alert-bid-spike',
    name: 'Bid spike',
    enabled: true,
    priority: 15,
    severity: 'info',
    trigger: {
      kind: 'dataChange',
      expression: '[bidPrice] > [askPrice]',
      columnIds: ['bidPrice', 'askPrice'],
    },
    message: 'Crossed market on {rowId}',
    channels: ['badge'],
    debounceMs: 2500,
  },
];

export const SSRM_ALERT_RULES: AlertRule[] = [
  {
    id: 'ssrm-alert-loss',
    name: 'Daily loss',
    enabled: true,
    priority: 10,
    severity: 'critical',
    trigger: {
      kind: 'dataChange',
      expression: '[dailyPnl] < -50000',
      columnIds: ['dailyPnl'],
    },
    message: 'SSRM loss on {rowId}: {value}',
    channels: ['toast', 'badge'],
    debounceMs: 2000,
  },
  {
    id: 'ssrm-alert-price',
    name: 'Price move',
    enabled: true,
    priority: 20,
    severity: 'warning',
    trigger: {
      kind: 'relativeChange',
      colId: 'price',
      mode: 'ABSOLUTE_CHANGE',
      threshold: 0.25,
      direction: 'both',
    },
    message: '{rule}: {rowId} price {prev} → {value}',
    channels: ['toast', 'badge'],
    debounceMs: 1500,
  },
];

export function pickRules(all: StyleRule[], ...ids: string[]): StyleRule[] {
  return all.filter((r) => ids.includes(r.id));
}

export function pickCalc(all: CalculatedColumnDef[], ...ids: string[]): CalculatedColumnDef[] {
  return all.filter((c) => ids.includes(c.colId));
}

export function pickAlerts(all: AlertRule[], ...ids: string[]): AlertRule[] {
  return all.filter((r) => ids.includes(r.id));
}

export function alertsSlice(rules: AlertRule[]): LabModuleSeed['alerts'] {
  return {
    rules,
    settings: {
      enabled: true,
      defaultDebounceMs: 1500,
      maxNotificationsPerSecond: 5,
      historyLimit: 200,
      enabledChannels: { toast: true, badge: true, openfin: false },
      evaluationMode: 'realtime',
    },
    history: [],
  };
}

export function savedFilters(pills: Array<{
  id: string;
  label: string;
  active?: boolean;
  filterModel: Record<string, unknown>;
}>): LabModuleSeed['saved-filters'] {
  return pills.map((p) => ({
    id: p.id,
    label: p.label,
    active: p.active ?? false,
    filterModel: p.filterModel,
  }));
}

export function editWithNudges(
  nudges: PlusMinusNudge[],
  shortcutDefs: ShortcutDefinition[] = [],
): LabModuleSeed['editSettings'] {
  return {
    history: { enabled: true, maxEntries: 50, suspended: false, unifyUndo: true,
      recordSources: {
        smartEdit: true, bulkUpdate: true, plusMinus: true,
        shortcuts: true, cellEditor: true, stream: false,
      } },
    smartEdit: {
      enabled: true, incrementStep: 1, magnitudeShortcutsEnabled: true,
      enabledOps: ['multiply', 'divide', 'add', 'subtract', 'set'],
      confirmThreshold: 0, enforceSingleColumn: true,
      previewBeforeApply: false, recordHistory: true,
    },
    bulkUpdate: {
      enabled: true, confirmThreshold: 0, showDistinctValues: true,
      maxDropdownValues: 20, enforceSingleColumn: true, recordHistory: true,
    },
    plusMinus: { enabled: true, recordHistory: true },
    shortcuts: { enabled: true, recordHistory: true },
    nudges,
    shortcutDefs,
  };
}

export const CSRM_QTY_NUDGE: PlusMinusNudge = {
  id: 'nudge-qty-100',
  name: 'Qty ±100',
  enabled: true,
  scope: { columnIds: ['quantityFace'] },
  incrementStep: 100,
  decrementStep: 100,
};

export const CSRM_BID_NUDGE: PlusMinusNudge = {
  id: 'nudge-bid-01',
  name: 'Bid ±0.01',
  enabled: true,
  scope: { columnIds: ['bidPrice'] },
  incrementStep: 0.01,
  decrementStep: 0.01,
};

export const CSRM_QTY_SHORTCUT: ShortcutDefinition = {
  id: 'sc-h-qty',
  name: 'H ×100 qty',
  enabled: true,
  shortcutKey: 'h',
  operation: 'multiply',
  shortcutValue: 100,
  scope: { columnIds: ['quantityFace'] },
};

export const SSRM_NOTIONAL_NUDGE: PlusMinusNudge = {
  id: 'nudge-notional',
  name: 'Notional ±100k',
  enabled: true,
  scope: { columnIds: ['notional'] },
  incrementStep: 100_000,
  decrementStep: 100_000,
};

export const SSRM_PRICE_NUDGE: PlusMinusNudge = {
  id: 'nudge-price',
  name: 'Price ±0.01',
  enabled: true,
  scope: { columnIds: ['price'] },
  incrementStep: 0.01,
  decrementStep: 0.01,
};

export const SSRM_NOTIONAL_SHORTCUT: ShortcutDefinition = {
  id: 'sc-h-notional',
  name: 'H ×10 notional',
  enabled: true,
  shortcutKey: 'h',
  operation: 'multiply',
  shortcutValue: 10,
  scope: { columnIds: ['notional'] },
};
