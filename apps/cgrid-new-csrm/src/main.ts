import { injectVgNewStyles } from '@wellsfargo-starui/vg-new-ui';
import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';

injectVgNewStyles();

type Row = { id: string; desk: string; ticker: string; pnl: number; dailyPnl: number };

const rows: Row[] = Array.from({ length: 2000 }, (_, i) => ({
  id: `R${i}`,
  desk: i % 3 === 0 ? 'EQ' : i % 3 === 1 ? 'FX' : 'CREDIT',
  ticker: `T${i % 80}`,
  pnl: Math.round((Math.random() - 0.5) * 100000) / 100,
  dailyPnl: Math.round((Math.random() - 0.5) * 8000) / 100,
}));

const host = document.getElementById('root')!;
const grid = new VelocityGrid<Row>(host, {
  columnDefs: [
    { field: 'id', headerName: 'Id', width: 90 },
    { field: 'desk', headerName: 'Desk', width: 100 },
    { field: 'ticker', headerName: 'Ticker', width: 100 },
    { field: 'pnl', headerName: 'PnL', width: 110 },
    { field: 'dailyPnl', headerName: 'Daily', width: 110 },
  ],
  rowData: rows,
  getRowId: (r) => r.id,
  rowSelection: 'multiple',
  onGridReady: (api) => {
    (window as unknown as { __grid: typeof api }).__grid = api;
  },
});

void grid;
