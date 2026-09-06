/**
 * Column definitions for the blotter.
 *
 * Formatting is expressed as Excel format strings (`#,##0.000`,
 * `#,##0;[Red](#,##0)`) rather than JS `valueFormatter` functions wherever a
 * format string can do the job: the kernel compiles those in the worker, they
 * survive a profile round-trip as data, and they are what the Formatting tab
 * is teaching. Functions are reserved for genuinely derived values.
 */
import type { CColDef, CColGroupDef } from '@wellsfargo-starui/velocity-grid';
import type { BlotterRow } from './domain';

/** Excel format strings used across the lab, named so tabs can cite them. */
export const FORMATS = {
  price: '#,##0.000',
  price4: '#,##0.0000',
  pct: '#,##0.000"%"',
  pct2: '#,##0.00"%"',
  bps: '#,##0.00" bps"',
  money: '#,##0',
  /** Negative money in red parentheses — the blotter convention. */
  signedMoney: '#,##0;[Red](#,##0)',
  qty: '#,##0',
} as const;

export const COL_GROUPS = {
  /** Pinned. Kept separate from `instrument` on purpose: a header group that
   *  spans the pinned and scrolling sections renders as two headers with the
   *  same name, which reads as a bug. */
  identifier: 'Identifier',
  instrument: 'Instrument',
  reference: 'Reference',
  pricing: 'Pricing',
  yields: 'Yields & Spreads',
  risk: 'Risk',
  quantities: 'Quantities & Cost',
  pnl: 'P&L',
  status: 'Status & Book',
} as const;

/** Which semantic group each column belongs to — drives the Column Groups tab
 *  without a second hand-maintained list. */
export const GROUP_OF: Record<string, string> = {};
const g = (group: string, defs: CColDef<BlotterRow>[]): CColDef<BlotterRow>[] => {
  for (const d of defs) GROUP_OF[(d.colId ?? d.field) as string] = group;
  return defs;
};

export const baseColumns: CColDef<BlotterRow>[] = [
  ...g(COL_GROUPS.identifier, [
    { field: 'cusip', headerName: 'CUSIP', width: 116, pinned: 'left', filter: 'text', fontRole: 'mono' },
    { field: 'ticker', headerName: 'Tkr', width: 84, pinned: 'left', filter: 'set', fontRole: 'mono' },
  ]),

  ...g(COL_GROUPS.instrument, [
    { field: 'isin', headerName: 'ISIN', width: 140, hide: true, filter: 'text', fontRole: 'mono' },
    { field: 'instrumentDescription', headerName: 'Description', width: 250, filter: 'text' },
  ]),

  ...g(COL_GROUPS.reference, [
    { field: 'assetClass', headerName: 'Class', width: 116, filter: 'set' },
    { field: 'issuerSector', headerName: 'Sector', width: 130, filter: 'set' },
    { field: 'issuerSubSector', headerName: 'Sub-sector', width: 140, hide: true, filter: 'set' },
    { field: 'issuerCountryCode', headerName: 'Ctry', width: 74, filter: 'set' },
    { field: 'currency', headerName: 'Ccy', width: 70, filter: 'set' },
    { field: 'compositeRating', headerName: 'Rating', width: 92, filter: 'set' },
    { field: 'seniority', headerName: 'Seniority', width: 150, hide: true, filter: 'set' },
    { field: 'couponRate', headerName: 'Coupon', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.pct, filter: 'number' },
  ]),

  ...g(COL_GROUPS.pricing, [
    { field: 'bidPrice', headerName: 'Bid', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price, filter: 'number' },
    { field: 'midPrice', headerName: 'Mid', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price, filter: 'number' },
    { field: 'askPrice', headerName: 'Ask', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price, filter: 'number' },
    { field: 'lastPrice', headerName: 'Last', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price, filter: 'number' },
    { field: 'priceChange', headerName: 'Δ Px', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price4, filter: 'number' },
    { field: 'priceChangePct', headerName: 'Δ %', width: 86, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.pct, filter: 'number' },
    {
      colId: 'bidAskWidthBps', headerName: 'B/A (bps)', width: 104, cellDataType: 'number', align: 'right',
      valueGetter: ({ data }) => (data ? Math.round((data.askPrice - data.bidPrice) * 100 * 100) / 100 : undefined),
      valueFormatter: FORMATS.bps, filter: 'number',
    },
    { field: 'bidSize', headerName: 'Bid Sz', width: 110, hide: true, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.qty },
    { field: 'askSize', headerName: 'Ask Sz', width: 110, hide: true, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.qty },
  ]),

  ...g(COL_GROUPS.yields, [
    { field: 'yieldToMaturity', headerName: 'YTM', width: 96, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.pct, filter: 'number' },
    { field: 'yieldToWorst', headerName: 'YTW', width: 96, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.pct, filter: 'number' },
    { field: 'currentYield', headerName: 'Curr Yld', width: 100, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.pct, filter: 'number' },
    { field: 'benchmarkYield', headerName: 'Bmk Yld', width: 100, hide: true, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.pct },
    { field: 'oas', headerName: 'OAS', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.bps, filter: 'number' },
    { field: 'zSpread', headerName: 'Z-spr', width: 92, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.bps, filter: 'number' },
    { field: 'iSpread', headerName: 'I-spr', width: 92, hide: true, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.bps },
  ]),

  ...g(COL_GROUPS.risk, [
    { field: 'modifiedDuration', headerName: 'Dur', width: 82, cellDataType: 'number', align: 'right', valueFormatter: '#,##0.00', filter: 'number' },
    { field: 'dv01', headerName: 'DV01', width: 96, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price4, filter: 'number' },
    { field: 'convexity', headerName: 'Convex', width: 96, cellDataType: 'number', align: 'right', valueFormatter: '#,##0.00' },
    { field: 'cs01', headerName: 'CS01', width: 96, hide: true, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price4 },
  ]),

  ...g(COL_GROUPS.quantities, [
    { field: 'quantityFace', headerName: 'Qty (face)', width: 128, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.qty, filter: 'number', aggFunc: 'sum' },
    { field: 'marketValue', headerName: 'Mkt Value', width: 136, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.money, filter: 'number', aggFunc: 'sum' },
    { field: 'avgCost', headerName: 'Avg Cost', width: 108, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price, filter: 'number' },
    { field: 'accruedInterest', headerName: 'Accrued', width: 106, hide: true, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.price4 },
    { field: 'avgDailyVolume30d', headerName: 'ADV 30d', width: 116, hide: true, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.qty },
  ]),

  ...g(COL_GROUPS.pnl, [
    { field: 'unrealizedPnL', headerName: 'Unreal P&L', width: 128, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.signedMoney, filter: 'number', aggFunc: 'sum' },
    { field: 'dailyPnL', headerName: 'P&L (D)', width: 112, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.signedMoney, filter: 'number', aggFunc: 'sum' },
    { field: 'mtdPnL', headerName: 'P&L (MTD)', width: 124, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.signedMoney, filter: 'number', aggFunc: 'sum' },
    { field: 'ytdPnL', headerName: 'P&L (YTD)', width: 130, cellDataType: 'number', align: 'right', valueFormatter: FORMATS.signedMoney, filter: 'number', aggFunc: 'sum' },
  ]),

  ...g(COL_GROUPS.status, [
    { field: 'desk', headerName: 'Desk', width: 130, filter: 'set' },
    { field: 'region', headerName: 'Region', width: 110, filter: 'set' },
    { field: 'book', headerName: 'Book', width: 116, filter: 'set' },
    { field: 'trader', headerName: 'Trader', width: 132, filter: 'set' },
    { field: 'accountName', headerName: 'Account', width: 150, filter: 'set' },
    { field: 'analyst', headerName: 'Analyst', width: 130, hide: true, filter: 'set' },
    { field: 'maturityDate', headerName: 'Maturity', width: 112, filter: 'text' },
    { field: 'issueDate', headerName: 'Issued', width: 108, hide: true, filter: 'text' },
    {
      field: 'lastUpdate', headerName: 'Updated', width: 104, align: 'right', sortable: true, filter: undefined,
      valueFormatter: ({ value }) => (value == null ? '' : new Date(Number(value)).toLocaleTimeString()),
    },
  ]),
];

export const defaultColDef: CColDef<BlotterRow> = {
  resizable: true,
  sortable: true,
  filter: 'text',
  minWidth: 64,
};

/** Look a column up by `field` or `colId`. The returned object is shared —
 *  clone before mutating, which `pickColumns` does for you. */
export function findCol(key: string): CColDef<BlotterRow> | undefined {
  return baseColumns.find((c) => c.field === key || c.colId === key);
}

/** Build a visible column list in the given order. Anything picked is shown,
 *  so a tab never has to remember to clear `hide`. */
export function pickColumns(keys: string[]): CColDef<BlotterRow>[] {
  return keys
    .map((k) => findCol(k))
    .filter((c): c is CColDef<BlotterRow> => c !== undefined)
    .map((c) => ({ ...c, hide: false }));
}

/** Wrap a flat column list in its semantic header groups, preserving order. */
export function grouped(cols: CColDef<BlotterRow>[]): (CColDef<BlotterRow> | CColGroupDef<BlotterRow>)[] {
  const out: (CColDef<BlotterRow> | CColGroupDef<BlotterRow>)[] = [];
  let current: CColGroupDef<BlotterRow> | null = null;
  for (const col of cols) {
    const groupName = GROUP_OF[(col.colId ?? col.field) as string];
    if (!groupName) { out.push(col); current = null; continue; }
    if (!current || current.headerName !== groupName) {
      current = { headerName: groupName, groupId: groupName, children: [] };
      out.push(current);
    }
    (current.children as CColDef<BlotterRow>[]).push(col);
  }
  return out;
}
