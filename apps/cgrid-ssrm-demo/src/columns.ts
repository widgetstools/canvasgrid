import type { CColDef } from '@cgrid/kernel';

import type { PositionRow } from './perspective/bootstrap';



export const GRAND_TOTAL_ROW_ID = '__grand_total__';



function isSyntheticId(id: unknown): boolean {

  return String(id ?? '') === GRAND_TOTAL_ROW_ID;

}



export const COLUMNS: CColDef<PositionRow>[] = [

  {

    colId: 'positionId',

    field: 'positionId',

    headerName: 'Position',

    cellDataType: 'text',

    width: 160,

    filter: 'text',

    pinned: 'left',

    // The grand-total pinned row's label must live on an always-visible
    // column — `desk: 'TOTAL'` disappears whenever Desk is grouped (the
    // grouped column hides and the auto-group column ignores pinned rows).
    valueFormatter: ({ value }) => (isSyntheticId(value) ? 'Grand Total' : String(value ?? '')),

  },

  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 110, filter: 'text', enableRowGroup: true },

  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 130, filter: 'text', enableRowGroup: true },

  { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 100, filter: 'text', enableRowGroup: true },

  { colId: 'instrumentType', field: 'instrumentType', headerName: 'Instrument', cellDataType: 'text', width: 140, filter: 'text', enableRowGroup: true },

  { colId: 'notionalAmount', field: 'notionalAmount', headerName: 'Notional', cellDataType: 'number', width: 140, filter: 'number', aggFunc: 'sum', enableValue: true },

  { colId: 'marketValue', field: 'marketValue', headerName: 'Mkt Value', cellDataType: 'number', width: 140, filter: 'number', aggFunc: 'sum', enableValue: true },

  { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 120, filter: 'number', aggFunc: 'sum', enableValue: true },

  { colId: 'dailyPnl', field: 'dailyPnl', headerName: 'Daily P&L', cellDataType: 'number', width: 120, filter: 'number', aggFunc: 'sum', enableValue: true },

];



export function emptyGrandTotalRow(): PositionRow {

  return {

    positionId: GRAND_TOTAL_ROW_ID,

    ticker: '',

    desk: 'TOTAL',

    region: '',

    instrumentType: '',

    notionalAmount: 0,

    marketValue: 0,

    pnl: 0,

    dailyPnl: 0,

  };

}


