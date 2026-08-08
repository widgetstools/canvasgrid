import type { CColDef } from '@wellsfargo-starui/velocity-grid';

/** In-memory mock blotter row (distinct from Perspective WASM `PositionRow`). */
export interface MockPositionRow {
  positionId: string;
  desk: string;
  region: string;
  currency: string;
  trader: string;
  ticker: string;
  notional: number;
  marketValue: number;
  price: number;
  pnl: number;
  dailyPnl: number;
  [key: string]: unknown;
}

/** Kernel-synthesized pinned grand-total row id (grandTotalRow: 'pinnedBottom'). */
export const MOCK_GRAND_TOTAL_ROW_ID = '__grand_total__';

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const px2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? int.format(value) : '';
}

/** Leaf rows only — sparse SSRM synthetic group / footer / grand-total
 *  rows carry `__ssrm` meta and must never enter edit mode. */
function leafEditable({ data }: { data: MockPositionRow | undefined }): boolean {
  return !!data && !('__ssrm' in data);
}

/** Column defs for the in-memory mock blotter schema (`MockPositionRow`). */
export const MOCK_POSITION_COLUMNS: CColDef<MockPositionRow>[] = [
  {
    colId: 'positionId',
    field: 'positionId',
    headerName: 'Position',
    cellDataType: 'text',
    width: 150,
    pinned: 'left',
    filter: 'text',
    valueFormatter: ({ value }) =>
      String(value ?? '') === MOCK_GRAND_TOTAL_ROW_ID ? 'Grand Total' : String(value ?? ''),
  },
  // `rowGroup`/`rowGroupIndex` are construction-time seeds the kernel reads
  // off the RAW defs (they are not part of the CColDef type).
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 130, filter: 'text', enableRowGroup: true, rowGroup: true, rowGroupIndex: 0 } as CColDef<MockPositionRow>,
  { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 110, filter: 'text', enableRowGroup: true, rowGroup: true, rowGroupIndex: 1 } as CColDef<MockPositionRow>,
  { colId: 'currency', field: 'currency', headerName: 'CCY', cellDataType: 'text', width: 90, filter: 'text', enableRowGroup: true },
  { colId: 'trader', field: 'trader', headerName: 'Trader', cellDataType: 'text', width: 120, filter: 'text', enableRowGroup: true, editable: leafEditable },
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 110, filter: 'text', enableRowGroup: true, editable: leafEditable },
  { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', width: 130, aggFunc: 'sum', editable: leafEditable, valueFormatter: ({ value }) => money(value) },
  { colId: 'marketValue', field: 'marketValue', headerName: 'Mkt Value', cellDataType: 'number', width: 130, aggFunc: 'sum', valueFormatter: ({ value }) => money(value) },
  {
    colId: 'price',
    field: 'price',
    headerName: 'Price',
    cellDataType: 'number',
    width: 100,
    valueFormatter: ({ value }) =>
      typeof value === 'number' && Number.isFinite(value) ? px2.format(value) : '',
  },
  { colId: 'pnl', field: 'pnl', headerName: 'PnL', cellDataType: 'number', width: 120, aggFunc: 'sum', valueFormatter: ({ value }) => money(value) },
  { colId: 'dailyPnl', field: 'dailyPnl', headerName: 'Daily PnL', cellDataType: 'number', width: 120, aggFunc: 'sum', valueFormatter: ({ value }) => money(value) },
];
