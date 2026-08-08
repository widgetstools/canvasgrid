import type { CColDef, CColGroupDef } from '@wellsfargo-starui/velocity-grid';

/** Compact positions blotter row inspired by Markets Grid Lab (not the full FI universe). */
export interface LabRow {
  id: string;
  cusip: string;
  ticker: string;
  instrumentDescription: string;
  assetClass: string;
  issuerSector: string;
  currency: string;
  compositeRating: string;
  book: string;
  trader: string;
  bidPrice: number;
  midPrice: number;
  askPrice: number;
  lastPrice: number;
  priceChangePct: number;
  yieldToMaturity: number;
  oas: number;
  modifiedDuration: number;
  dv01: number;
  quantityFace: number;
  marketValue: number;
  avgCost: number;
  unrealizedPnL: number;
  dailyPnL: number;
  mtdPnL: number;
  ytdPnL: number;
  maturityDate: string;
  lastUpdate: number;
  [key: string]: unknown;
}

const num0 = new Intl.NumberFormat('en-US');
const num2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num3 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const money = ({ value }: { value: unknown }) =>
  typeof value === 'number' && Number.isFinite(value) ? num0.format(Math.round(value)) : '';
const price = ({ value }: { value: unknown }) =>
  typeof value === 'number' && Number.isFinite(value) ? num3.format(value) : '';
const pct = ({ value }: { value: unknown }) =>
  typeof value === 'number' && Number.isFinite(value) ? `${num3.format(value)}%` : '';
const num2f = ({ value }: { value: unknown }) =>
  typeof value === 'number' && Number.isFinite(value) ? num2.format(value) : '';

export const defaultColDef: CColDef<LabRow> = {
  resizable: true,
  sortable: true,
  minWidth: 80,
};

const leaf = ({ data }: { data?: LabRow }) => !!data && !('__ssrm' in data);

/** Full kitchen-sink column set (overview / groups). */
export const baseColumns: Array<CColDef<LabRow> | CColGroupDef<LabRow>> = [
  { colId: 'cusip', field: 'cusip', headerName: 'CUSIP', width: 110, pinned: 'left', filter: 'text' },
  { colId: 'ticker', field: 'ticker', headerName: 'Tkr', width: 80, pinned: 'left', filter: 'text', enableRowGroup: true },
  { colId: 'instrumentDescription', field: 'instrumentDescription', headerName: 'Description', width: 220, filter: 'text' },
  { colId: 'assetClass', field: 'assetClass', headerName: 'Class', width: 110, filter: 'text', enableRowGroup: true },
  { colId: 'issuerSector', field: 'issuerSector', headerName: 'Sector', width: 120, filter: 'text', enableRowGroup: true },
  { colId: 'currency', field: 'currency', headerName: 'Ccy', width: 70, filter: 'text', enableRowGroup: true },
  { colId: 'compositeRating', field: 'compositeRating', headerName: 'Rating', width: 90, filter: 'text', enableRowGroup: true },
  { colId: 'book', field: 'book', headerName: 'Book', width: 100, filter: 'text', enableRowGroup: true },
  { colId: 'trader', field: 'trader', headerName: 'Trader', width: 100, filter: 'text', enableRowGroup: true, editable: leaf },
  { colId: 'bidPrice', field: 'bidPrice', headerName: 'Bid', width: 90, cellDataType: 'number', valueFormatter: price, editable: leaf },
  { colId: 'midPrice', field: 'midPrice', headerName: 'Mid', width: 90, cellDataType: 'number', valueFormatter: price },
  { colId: 'askPrice', field: 'askPrice', headerName: 'Ask', width: 90, cellDataType: 'number', valueFormatter: price },
  { colId: 'lastPrice', field: 'lastPrice', headerName: 'Last', width: 90, cellDataType: 'number', valueFormatter: price },
  { colId: 'priceChangePct', field: 'priceChangePct', headerName: 'Chg %', width: 90, cellDataType: 'number', valueFormatter: pct },
  { colId: 'yieldToMaturity', field: 'yieldToMaturity', headerName: 'YTM', width: 90, cellDataType: 'number', valueFormatter: pct },
  { colId: 'oas', field: 'oas', headerName: 'OAS', width: 90, cellDataType: 'number', valueFormatter: num2f },
  { colId: 'modifiedDuration', field: 'modifiedDuration', headerName: 'Mod Dur', width: 95, cellDataType: 'number', valueFormatter: num2f },
  { colId: 'dv01', field: 'dv01', headerName: 'DV01', width: 90, cellDataType: 'number', valueFormatter: money, aggFunc: 'sum' },
  { colId: 'quantityFace', field: 'quantityFace', headerName: 'Face', width: 110, cellDataType: 'number', valueFormatter: money, aggFunc: 'sum', editable: leaf },
  { colId: 'marketValue', field: 'marketValue', headerName: 'Mkt Value', width: 120, cellDataType: 'number', valueFormatter: money, aggFunc: 'sum' },
  { colId: 'avgCost', field: 'avgCost', headerName: 'Avg Cost', width: 100, cellDataType: 'number', valueFormatter: price },
  { colId: 'unrealizedPnL', field: 'unrealizedPnL', headerName: 'UPnL', width: 110, cellDataType: 'number', valueFormatter: money, aggFunc: 'sum' },
  { colId: 'dailyPnL', field: 'dailyPnL', headerName: 'Daily PnL', width: 110, cellDataType: 'number', valueFormatter: money, aggFunc: 'sum' },
  { colId: 'mtdPnL', field: 'mtdPnL', headerName: 'MTD PnL', width: 110, cellDataType: 'number', valueFormatter: money, aggFunc: 'sum' },
  { colId: 'ytdPnL', field: 'ytdPnL', headerName: 'YTD PnL', width: 110, cellDataType: 'number', valueFormatter: money, aggFunc: 'sum' },
  { colId: 'maturityDate', field: 'maturityDate', headerName: 'Maturity', width: 110, filter: 'text' },
];

export function pickColumns(fields: string[]): CColDef<LabRow>[] {
  const byField = new Map(
    baseColumns
      .filter((c): c is CColDef<LabRow> => 'field' in c && typeof (c as CColDef).field === 'string')
      .map((c) => [c.field as string, c]),
  );
  return fields.map((f) => {
    const col = byField.get(f);
    if (!col) throw new Error(`Unknown lab column: ${f}`);
    return { ...col };
  });
}

export const PRICING_COLUMNS = pickColumns([
  'cusip', 'ticker', 'instrumentDescription', 'currency', 'compositeRating', 'issuerSector',
  'bidPrice', 'midPrice', 'askPrice', 'lastPrice', 'priceChangePct',
  'yieldToMaturity', 'oas', 'modifiedDuration', 'dv01',
  'quantityFace', 'marketValue', 'avgCost',
  'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL', 'maturityDate',
]);

export const LIVE_COLUMNS = pickColumns([
  'cusip', 'ticker', 'instrumentDescription', 'assetClass', 'currency', 'compositeRating',
  'bidPrice', 'midPrice', 'askPrice', 'lastPrice', 'priceChangePct',
  'yieldToMaturity', 'oas', 'modifiedDuration', 'dv01',
  'quantityFace', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL',
]);

export const EDIT_COLUMNS = pickColumns([
  'cusip', 'ticker', 'instrumentDescription', 'book', 'trader',
  'bidPrice', 'midPrice', 'askPrice', 'quantityFace', 'marketValue',
  'unrealizedPnL', 'dailyPnL',
]);
