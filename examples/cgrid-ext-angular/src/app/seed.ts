import type { CColDef } from '@wellsfargo-starui/velocity-grid';

export type PositionRow = {
  id: string;
  ticker: string;
  desk: string;
  region: string;
  notional: number;
  pnl: number;
  price: number;
};

export const COLUMN_DEFS: CColDef<PositionRow>[] = [
  { field: 'id', headerName: 'Id', pinned: 'left', width: 90 },
  { field: 'ticker', headerName: 'Ticker', enableRowGroup: true, width: 110 },
  { field: 'desk', headerName: 'Desk', enableRowGroup: true, width: 110 },
  { field: 'region', headerName: 'Region', enableRowGroup: true, width: 110 },
  {
    field: 'notional',
    headerName: 'Notional',
    cellDataType: 'number',
    aggFunc: 'sum',
    valueFormatter: '#,##0',
    width: 130,
  },
  {
    field: 'pnl',
    headerName: 'P&L',
    cellDataType: 'number',
    aggFunc: 'sum',
    valueFormatter: '#,##0;[Red](#,##0)',
    width: 120,
  },
  {
    field: 'price',
    headerName: 'Price',
    cellDataType: 'number',
    valueFormatter: '#,##0.00',
    width: 100,
  },
];

const DESKS = ['RATES', 'CREDIT', 'FX'] as const;
const REGIONS = ['AMER', 'EMEA', 'APAC'] as const;
const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA'] as const;

export function seedRows(count = 80): PositionRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `P${String(i + 1).padStart(3, '0')}`,
    ticker: TICKERS[i % TICKERS.length]!,
    desk: DESKS[i % DESKS.length]!,
    region: REGIONS[i % REGIONS.length]!,
    notional: 1_000_000 + i * 25_000,
    pnl: (i % 7) * 1200 - 3000,
    price: 100 + (i % 20) * 0.25,
  }));
}
