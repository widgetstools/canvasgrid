import { CGrid, type CGridOptions } from 'cgrid';
import type { Position } from './stomp';

export function createPositionsGrid(container: HTMLElement): CGrid<Position> {
  const options: CGridOptions<Position> = {
    columnDefs: [
      { field: 'positionId',     headerName: 'Position ID',  width: 150, pinned: 'left' },
      { field: 'cusip',          headerName: 'CUSIP',         width: 110, pinned: 'left' },
      { field: 'ticker',         headerName: 'Ticker',        width: 100 },
      { field: 'notionalAmount', headerName: 'Notional',      type: 'number', width: 130, aggFunc: 'sum' },
      { field: 'marketValue',    headerName: 'Market Value',  type: 'number', width: 130, aggFunc: 'sum' },
      { field: 'currentPrice',   headerName: 'Price',         type: 'number', width: 100, aggFunc: 'avg' },
      {
        groupId: 'pnl', headerName: 'P&L',
        children: [
          { field: 'pnl',           headerName: 'Total',     type: 'number', width: 110, pinned: 'right', aggFunc: 'sum' },
          { field: 'dailyPnl',      headerName: 'Daily',     type: 'number', width: 110, aggFunc: 'sum' },
          { field: 'unrealizedPnl', headerName: 'Unrealized', type: 'number', width: 110, aggFunc: 'sum' },
        ],
      },
      { field: 'yield',  headerName: 'Yield',  type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'spread', headerName: 'Spread', type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'dv01',   headerName: 'DV01',   type: 'number', width: 100, aggFunc: 'sum' },
      { field: 'pv01',   headerName: 'PV01',   type: 'number', width: 100, aggFunc: 'sum' },
    ],
    getRowId: (row) => row.positionId,
    rowSelection: 'multiple',
    enableCellChangeFlash: true,
    cellFlashDuration: 500,
    cellFadeDuration: 800,
    asyncTransactionWaitMillis: 50,
    theme: 'cg-theme-quartz-dark',
  };
  return new CGrid<Position>(container, options);
}
