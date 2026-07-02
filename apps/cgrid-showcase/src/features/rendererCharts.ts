import { CGrid } from '@cgrid/kernel';
import type { CColDef } from '@cgrid/kernel';
import type { Feature } from './index';
import { wireShowcaseRenderers } from './renderersWire';

/**
 * Cycle 21f / Task 14 — Bars, charts, and composite renderer demo.
 *
 * Heat/volume/progress bars, sparklines, and multi-field composites over
 * ticking market data with ColumnStats + TickHistory wired through the
 * renderers bridge.
 */

interface ChartRow {
  id: string;
  symbol: string;
  pnl: number;
  qty: number;
  fillPct: number;
  history: number[];
  dailyPnl: number[];
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  bench: string;
  bps: number;
  price: number;
  chg: number;
  prev: number;
  note: string;
}

function makeHistory(base: number, seed: number): number[] {
  const out: number[] = [];
  let v = base;
  let s = seed;
  for (let i = 0; i < 40; i++) {
    s = (s * 9301 + 49297) % 233280;
    v = Math.max(1, v + (s / 233280 - 0.5) * 0.8);
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

const START_ROWS: ChartRow[] = [
  {
    id: 'c1', symbol: 'AAPL', pnl: 12500, qty: 500_000, fillPct: 0.72,
    history: makeHistory(98, 11), dailyPnl: [1, -1, 1, 1, -1, 1, 0, 1],
    bid: 98.10, ask: 98.14, mid: 98.12, spread: 0.04, bench: 'T 4.25 05/34',
    bps: 185, price: 98.12, chg: 0.12, prev: 98.0, note: '5Y',
  },
  {
    id: 'c2', symbol: 'MSFT', pnl: -4200, qty: 250_000, fillPct: 0.35,
    history: makeHistory(101, 23), dailyPnl: [-1, -1, 1, -1, 1, -1, -1, 1],
    bid: 101.48, ask: 101.52, mid: 101.50, spread: 0.04, bench: 'T 3.5 04/32',
    bps: -42, price: 101.50, chg: -0.5, prev: 102.0, note: '7Y',
  },
  {
    id: 'c3', symbol: 'XOM', pnl: 8500, qty: 1_000_000, fillPct: 0.91,
    history: makeHistory(112, 37), dailyPnl: [1, 1, 1, -1, 1, 1, 1, 1],
    bid: 112.20, ask: 112.30, mid: 112.25, spread: 0.10, bench: 'T 5.0 05/38',
    bps: 96, price: 112.25, chg: 0.25, prev: 112.0, note: '10Y',
  },
  {
    id: 'c4', symbol: 'JPM', pnl: -1800, qty: 750_000, fillPct: 0.48,
    history: makeHistory(95, 51), dailyPnl: [0, -1, 0, 1, -1, 0, -1, 0],
    bid: 95.86, ask: 95.90, mid: 95.88, spread: 0.04, bench: 'T 4.0 01/32',
    bps: -15, price: 95.88, chg: -0.12, prev: 96.0, note: '3Y',
  },
  {
    id: 'c5', symbol: 'T', pnl: 3200, qty: 300_000, fillPct: 0.63,
    history: makeHistory(108, 67), dailyPnl: [1, 0, 1, 1, 0, -1, 1, 1],
    bid: 107.98, ask: 108.02, mid: 108.0, spread: 0.04, bench: 'T 6.0 11/40',
    bps: 210, price: 108.0, chg: 0.25, prev: 107.75, note: '30Y',
  },
];

export const rendererCharts: Feature = {
  id: 'renderer-charts',
  label: 'Renderer Charts',
  description:
    'Cycle 21f — @cgrid/renderers bar/chart/composite painters with ' +
    'ColumnStats heat scaling and TickHistory spread bands over ticking data.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ChartRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [],
      theme,
      rowHeight: 38,
      headerHeight: 36,
    });

    const data = new Map(START_ROWS.map((r) => [r.id, { ...r }]));
    grid.setRowData([...data.values()]);

    const { colDef } = wireShowcaseRenderers(grid, gridHost, {
      statsColumns: ['pnl', 'qty'],
      historyColumns: { spread: { window: 30 } },
    });

    const columns: CColDef<ChartRow>[] = [
      { colId: 'symbol', field: 'symbol', headerName: 'Symbol', width: 90 },
      { ...colDef.heat('pnl'), headerName: 'Heat P&L', width: 110 } as CColDef<ChartRow>,
      { ...colDef.renderer('volume-bar', 'qty'), headerName: 'Volume', width: 110 } as CColDef<ChartRow>,
      { ...colDef.renderer('progress-bar', 'fillPct', { fractionField: 'fillPct' }), headerName: 'Fill', width: 100 } as CColDef<ChartRow>,
      { ...colDef.renderer('line-sparkline', 'history'), headerName: 'History', width: 140, sortable: false } as CColDef<ChartRow>,
      { ...colDef.renderer('win-loss-sparkline', 'dailyPnl', { valuesField: 'dailyPnl' }), headerName: 'W/L', width: 120, sortable: false } as CColDef<ChartRow>,
      { ...colDef.priceQuote('mid', { bidField: 'bid', askField: 'ask', midField: 'mid' }), headerName: 'Quote', width: 160 } as CColDef<ChartRow>,
      { ...colDef.renderer('benchmark-spread', 'bps', { bpsField: 'bps', benchmarkLabelField: 'bench' }), headerName: 'Sprd', width: 150 } as CColDef<ChartRow>,
      { ...colDef.renderer('stacked-value', 'price', { primaryField: 'price', secondaryField: 'note' }), headerName: 'Stacked', width: 110 } as CColDef<ChartRow>,
      { ...colDef.renderer('spread-bar', 'spread', { bidField: 'bid', askField: 'ask' }), headerName: 'Spread σ', width: 130 } as CColDef<ChartRow>,
    ];

    grid.updateGridOptions({ columnDefs: columns });

    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const tickOnce = (): void => {
      const row = data.get('c1')!;
      row.bid = round2(row.bid + 0.01);
      row.ask = round2(row.ask + 0.02);
      row.mid = round2((row.bid + row.ask) / 2);
      row.spread = round2(row.ask - row.bid);
      row.pnl = Math.round(row.pnl + 250);
      grid.applyTransaction({ update: [{ ...row }] });
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const tickBtn = document.createElement('button');
    tickBtn.className = 'ctrl-btn primary';
    tickBtn.setAttribute('data-testid', 'btn-renderer-charts-tick');
    tickBtn.textContent = 'Start ticking';
    tickBtn.addEventListener('click', () => {
      if (timer === null) {
        timer = setInterval(tickOnce, 700);
        tickBtn.textContent = 'Pause ticking';
        tickBtn.classList.remove('primary');
      } else {
        clearInterval(timer);
        timer = null;
        tickBtn.textContent = 'Start ticking';
        tickBtn.classList.add('primary');
      }
    });

    const tickOnceBtn = document.createElement('button');
    tickOnceBtn.className = 'ctrl-btn';
    tickOnceBtn.setAttribute('data-testid', 'btn-renderer-charts-tick-once');
    tickOnceBtn.textContent = 'Tick once';
    tickOnceBtn.addEventListener('click', tickOnce);

    controls.append(tickBtn, tickOnceBtn);

    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      if (timer !== null) clearInterval(timer);
      delete window.__cgridRenderers;
      origDestroy();
    };

    return grid;
  },
};
