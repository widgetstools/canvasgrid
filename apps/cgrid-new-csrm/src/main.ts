import { injectVgNewStyles } from '@wellsfargo-starui/vg-new-ui';
import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';

injectVgNewStyles();

type Row = { id: string; desk: string; ticker: string; pnl: number; dailyPnl: number };

const params = new URLSearchParams(location.search);
const paintHarness = params.has('paintHarness');
const n = paintHarness ? 500 : 2000;

const rows: Row[] = Array.from({ length: n }, (_, i) => ({
  id: `R${i}`,
  desk: i % 3 === 0 ? 'EQ' : i % 3 === 1 ? 'FX' : 'CREDIT',
  ticker: `T${i % 80}`,
  pnl: Math.round((Math.random() - 0.5) * 100000) / 100,
  dailyPnl: Math.round((Math.random() - 0.5) * 8000) / 100,
}));

const host = document.getElementById('root')!;
const grid = new VelocityGrid<Row>(host, {
  columnDefs: [
    { field: 'id', headerName: 'Id', width: 90, pinned: 'left' },
    { field: 'desk', headerName: 'Desk', width: 100 },
    { field: 'ticker', headerName: 'Ticker', width: 100 },
    { field: 'pnl', headerName: 'PnL', width: 110 },
    { field: 'dailyPnl', headerName: 'Daily', width: 110 },
  ],
  rowData: rows,
  getRowId: (r) => r.id,
  rowSelection: 'multiple',
  deferAsyncTransactionsWhileScrolling: true,
  asyncTransactionConflate: true,
  asyncTransactionWaitMillis: 40,
  onGridReady: (api) => {
    (window as unknown as { __grid: typeof api }).__grid = api;
    if (paintHarness) {
      // Live tick simulation for scroll-defer / flash smoke
      let i = 0;
      setInterval(() => {
        const id = `R${i % n}`;
        api.applyTransactionAsync({
          update: [{ id, desk: rows[i % n]!.desk, ticker: rows[i % n]!.ticker, pnl: Math.random() * 1000, dailyPnl: 1 }],
        });
        i++;
      }, 30);
    }
  },
});

void grid;
