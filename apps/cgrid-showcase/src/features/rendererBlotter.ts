import { CGrid } from '@cgrid/kernel';
import type { CColDef } from '@cgrid/kernel';
import type { Feature } from './index';
import { wireShowcaseRenderers } from './renderersWire';

/**
 * Cycle 21f / Task 14 — Rich blotter renderer demo.
 *
 * Numeric, text, indicator, badge, and action painters over a ticking
 * positions blotter. Column defs come from @cgrid/renderers colDef
 * builders; the bridge registers all 51 painters and exposes
 * window.__cgridRenderers for E2E probes.
 */

interface BlotterRow {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  price: number;
  prevPrice: number;
  qty: number;
  pnl: number;
  chg: number;
  chgPct: number;
  status: 'WORKING' | 'FILLED' | 'PART_FILL';
  venue: string;
  tif: string;
  rating: string;
  risk: 'green' | 'amber' | 'red';
  staleMs: number;
  note: string;
  createdAt: number;
  structureFlags: { callable?: boolean; puttable?: boolean };
}

const START_ROWS: BlotterRow[] = [
  {
    id: 'r1', symbol: 'AAPL 4.5 05/30', side: 'long', price: 98.125, prevPrice: 98.0,
    qty: 500_000, pnl: 12_500, chg: 0.125, chgPct: 0.13, status: 'WORKING',
    venue: 'XNAS', tif: 'DAY', rating: 'A', risk: 'green', staleMs: Date.now() - 500,
    note: 'CUSIP', createdAt: Date.now() - 86_400_000,
    structureFlags: { callable: true },
  },
  {
    id: 'r2', symbol: 'MSFT 3.2 06/28', side: 'short', price: 101.5, prevPrice: 102.0,
    qty: 250_000, pnl: -4200, chg: -0.5, chgPct: -0.49, status: 'PART_FILL',
    venue: 'ARCX', tif: 'IOC', rating: 'BBB', risk: 'amber', staleMs: Date.now() - 45_000,
    note: 'ISIN', createdAt: Date.now() - 172_800_000,
    structureFlags: { puttable: true },
  },
  {
    id: 'r3', symbol: 'XOM 5.0 04/35', side: 'long', price: 112.25, prevPrice: 112.0,
    qty: 1_000_000, pnl: 8500, chg: 0.25, chgPct: 0.22, status: 'FILLED',
    venue: 'BATS', tif: 'GTC', rating: 'AA', risk: 'green', staleMs: Date.now() - 2000,
    note: 'FIGI', createdAt: Date.now() - 3_600_000,
    structureFlags: { callable: true, puttable: true },
  },
  {
    id: 'r4', symbol: 'JPM 4.0 01/32', side: 'short', price: 95.875, prevPrice: 96.0,
    qty: 750_000, pnl: -1800, chg: -0.125, chgPct: -0.13, status: 'WORKING',
    venue: 'EDGX', tif: 'DAY', rating: 'BB', risk: 'red', staleMs: Date.now() - 800,
    note: 'CUSIP', createdAt: Date.now() - 7200_000,
    structureFlags: {},
  },
  {
    id: 'r5', symbol: 'T 6.0 11/40', side: 'long', price: 108.0, prevPrice: 107.75,
    qty: 300_000, pnl: 3200, chg: 0.25, chgPct: 0.23, status: 'WORKING',
    venue: 'XNAS', tif: 'FOK', rating: 'BBB+', risk: 'green', staleMs: Date.now() - 1200,
    note: 'TICKER', createdAt: Date.now() - 600_000,
    structureFlags: { callable: true },
  },
];

export const rendererBlotter: Feature = {
  id: 'renderer-blotter',
  label: 'Renderer Blotter',
  description:
    'Cycle 21f — @cgrid/renderers numeric/text/indicator/badge/action painters ' +
    'on a ticking fixed-income blotter. Resolved renderer names are probeable ' +
    'via columnDefsMap; canvas cells paint via the wired bridge.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<BlotterRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [],
      theme,
      rowHeight: 34,
      headerHeight: 36,
    });

    const data = new Map(START_ROWS.map((r) => [r.id, { ...r }]));
    grid.setRowData([...data.values()]);

    const { colDef } = wireShowcaseRenderers(grid, gridHost);

    const actionLog: string[] = [];
    const columns: CColDef<BlotterRow>[] = [
      colDef.renderer('ticker', 'symbol', { secondaryField: 'note' }) as CColDef<BlotterRow>,
      colDef.price('price', { prevField: 'prevPrice' }) as CColDef<BlotterRow>,
      colDef.renderer('pnl', 'pnl', { format: '#,##0', currencySymbol: '$' }) as CColDef<BlotterRow>,
      colDef.renderer('delta', 'chg', {
        absoluteField: 'chg', percentField: 'chgPct',
      }, { colId: 'delta' }) as CColDef<BlotterRow>,
      colDef.renderer('status-pill', 'status', { statusField: 'status' }) as CColDef<BlotterRow>,
      colDef.renderer('venue-chip', 'venue', { micField: 'venue' }) as CColDef<BlotterRow>,
      colDef.renderer('side-chip', 'side', { sideField: 'side' }) as CColDef<BlotterRow>,
      colDef.renderer('traffic-light', 'risk', { stateField: 'risk' }) as CColDef<BlotterRow>,
      colDef.renderer('rating-badge', 'rating', {}) as CColDef<BlotterRow>,
      colDef.renderer('stale-flag', 'staleMs', { lastTickField: 'staleMs', staleAfterMs: 30_000 }, { colId: 'stale' }) as CColDef<BlotterRow>,
      colDef.renderer('structure-icon-strip', 'structureFlags', { flagsField: 'structureFlags' }) as CColDef<BlotterRow>,
      colDef.iconActionCluster('actions', {
        actions: [{
          icon: 'x',
          label: 'Cancel',
          onAction: (rowId) => { actionLog.push(String(rowId)); },
        }],
      }) as CColDef<BlotterRow>,
      colDef.rowMenu('rowMenu', {
        onOpen: (rowId) => { actionLog.push(`menu:${rowId}`); },
      }) as CColDef<BlotterRow>,
    ];

    grid.updateGridOptions({ columnDefs: columns });

    (window as unknown as { __cgridRendererActionLog?: string[] }).__cgridRendererActionLog = actionLog;

    const round3 = (n: number): number => Math.round(n * 1000) / 1000;
    const tickOnce = (): void => {
      const row = data.get('r1')!;
      row.price = round3(row.price + 0.0625);
      row.chg = round3(row.price - row.prevPrice);
      row.chgPct = round3((row.chg / row.prevPrice) * 100);
      row.pnl = Math.round(row.pnl + row.chg * row.qty / 100);
      grid.applyTransaction({ update: [{ ...row }] });
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const tickBtn = document.createElement('button');
    tickBtn.className = 'ctrl-btn primary';
    tickBtn.setAttribute('data-testid', 'btn-renderer-blotter-tick');
    tickBtn.textContent = 'Start ticking';
    tickBtn.addEventListener('click', () => {
      if (timer === null) {
        timer = setInterval(tickOnce, 800);
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
    tickOnceBtn.setAttribute('data-testid', 'btn-renderer-blotter-tick-once');
    tickOnceBtn.textContent = 'Tick once';
    tickOnceBtn.addEventListener('click', tickOnce);

    controls.append(tickBtn, tickOnceBtn);

    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      if (timer !== null) clearInterval(timer);
      delete window.__cgridRenderers;
      delete (window as unknown as { __cgridRendererActionLog?: string[] }).__cgridRendererActionLog;
      origDestroy();
    };

    return grid;
  },
};
