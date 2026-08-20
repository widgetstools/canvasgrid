import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import type { Feature } from './index';
import { wireShowcaseRenderers } from './renderersWire';

/**
 * Cycle 21f / Task 14 — Rich blotter renderer demo.
 *
 * Numeric, text, indicator, badge, and action painters over a ticking
 * positions blotter. Column defs come from @wellsfargo-starui/velocity-grid-ext/renderers colDef
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
  /** Last-traded price, bound to the `last` column (D1) — the stale-flag
   *  glyph reads `staleMs` (below) for its age check, NOT this value. */
  lastPx: number;
  /** Epoch-ms of the last tick; drives stale-flag's clock overlay. Never
   *  bound directly to a column's displayed value (that was the D1 bug —
   *  the raw epoch number painted where a price belonged). */
  staleMs: number;
  cusip: string;
  createdAt: number;
  structureFlags: { callable?: boolean; puttable?: boolean };
}

// D1 — a module-level clock captured ONCE at import time (not per-mount),
// so repeated mounts within a session stay stable. Only the relative deltas
// baked into `staleMs` below matter for rendering (stale-flag compares
// `nowMs - lastTick`), so the wall-clock value FROZEN_NOW happens to hold at
// import time is irrelevant to the painted output — needed for deterministic
// visual-regression snapshots (V1). Advanced only by the tick controls, not
// by real wall-clock drift.
let frozenNow = Date.now();
const now = (): number => frozenNow;

const START_ROWS: BlotterRow[] = [
  {
    id: 'r1', symbol: 'AAPL 4.5 05/30', side: 'long', price: 98.125, prevPrice: 98.0,
    qty: 500_000, pnl: 12_500, chg: 0.125, chgPct: 0.13, status: 'WORKING',
    venue: 'XNAS', tif: 'DAY', rating: 'A', risk: 'green',
    lastPx: 98.13, staleMs: frozenNow - 500,
    cusip: '037833100', createdAt: frozenNow - 86_400_000,
    structureFlags: { callable: true },
  },
  {
    id: 'r2', symbol: 'MSFT 3.2 06/28', side: 'short', price: 101.5, prevPrice: 102.0,
    qty: 250_000, pnl: -4200, chg: -0.5, chgPct: -0.49, status: 'PART_FILL',
    venue: 'ARCX', tif: 'IOC', rating: 'BBB', risk: 'amber',
    // Deliberately stale (>8s) so the demo always shows the clock overlay.
    lastPx: 101.50, staleMs: frozenNow - 12_000,
    cusip: '594918104', createdAt: frozenNow - 172_800_000,
    structureFlags: { puttable: true },
  },
  {
    id: 'r3', symbol: 'XOM 5.0 04/35', side: 'long', price: 112.25, prevPrice: 112.0,
    qty: 1_000_000, pnl: 8500, chg: 0.25, chgPct: 0.22, status: 'FILLED',
    venue: 'BATS', tif: 'GTC', rating: 'AA', risk: 'green',
    lastPx: 112.25, staleMs: frozenNow - 2000,
    cusip: '30231G102', createdAt: frozenNow - 3_600_000,
    structureFlags: { callable: true, puttable: true },
  },
  {
    id: 'r4', symbol: 'JPM 4.0 01/32', side: 'short', price: 95.875, prevPrice: 96.0,
    qty: 750_000, pnl: -1800, chg: -0.125, chgPct: -0.13, status: 'WORKING',
    venue: 'EDGX', tif: 'DAY', rating: 'BB', risk: 'red',
    lastPx: 95.88, staleMs: frozenNow - 800,
    cusip: '46625H100', createdAt: frozenNow - 7200_000,
    structureFlags: {},
  },
  {
    id: 'r5', symbol: 'T 6.0 11/40', side: 'long', price: 108.0, prevPrice: 107.75,
    qty: 300_000, pnl: 3200, chg: 0.25, chgPct: 0.23, status: 'WORKING',
    venue: 'XNAS', tif: 'FOK', rating: 'BBB+', risk: 'green',
    lastPx: 108.00, staleMs: frozenNow - 1200,
    cusip: '00206R102', createdAt: frozenNow - 600_000,
    structureFlags: { callable: true },
  },
];

export const rendererBlotter: Feature = {
  id: 'renderer-blotter',
  label: 'Renderer Blotter',
  description:
    'Cycle 21f — @wellsfargo-starui/velocity-grid-ext/renderers numeric/text/indicator/badge/action painters ' +
    'on a ticking fixed-income blotter. Resolved renderer names are probeable ' +
    'via columnDefsMap; canvas cells paint via the wired bridge.',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<BlotterRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [],
      theme,
      rowHeight: 34,
      headerHeight: 36,
    });

    const data = new Map(START_ROWS.map((r) => [r.id, { ...r }]));
    grid.setRowData([...data.values()]);

    const { colDef } = wireShowcaseRenderers(grid, gridHost, { now });

    const actionLog: string[] = [];
    const columns: CColDef<BlotterRow>[] = [
      colDef.renderer('ticker', 'symbol', { secondaryField: 'cusip' }) as CColDef<BlotterRow>,
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
      // D1 — bound to the numeric `lastPx` field (a real last-traded price,
      // formatted 2dp), NOT the raw `staleMs` epoch — the stale-flag glyph
      // still reads `staleMs` via `lastTickField` for its age check.
      {
        ...(colDef.renderer('stale-flag', 'lastPx', {
          lastTickField: 'staleMs', staleAfterMs: 8_000,
        }, { colId: 'stale' }) as CColDef<BlotterRow>),
        headerName: 'last',
        valueFormatter: '#,##0.00',
      } as CColDef<BlotterRow>,
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
      // D1 — the frozen clock only advances here, in lockstep with the tick
      // controls, never on its own (no setInterval reading wall-clock time).
      frozenNow += 800;
      const row = data.get('r1')!;
      row.price = round3(row.price + 0.0625);
      row.lastPx = row.price;
      row.chg = round3(row.price - row.prevPrice);
      row.chgPct = round3((row.chg / row.prevPrice) * 100);
      row.pnl = Math.round(row.pnl + row.chg * row.qty / 100);
      row.staleMs = frozenNow;
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
