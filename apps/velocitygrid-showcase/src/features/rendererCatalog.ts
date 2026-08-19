import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import { RENDERER_NAMES, type RendererName } from '@wellsfargo-starui/velocity-grid-renderers';
import type { RenderersColDefBuilders } from '@wellsfargo-starui/velocity-grid-renderers';
import type { Feature } from './index';
import { wireShowcaseRenderers } from './renderersWire';

/**
 * Cycle 21f — full renderer catalog: one column per registered painter (51).
 */

interface CatalogRow {
  id: string;
  numberVal: number;
  price: number;
  prevPrice: number;
  pnl: number;
  chg: number;
  chgPct: number;
  bps: number;
  benchmark: number;
  pctChange: number;
  fracPrice: number;
  abbrevNum: number;
  symbol: string;
  cusip: string;
  pair: string;
  rate: number;
  timestamp: number;
  sinceMs: number;
  staleMs: number;
  fresh: boolean;
  tight: boolean;
  deep: boolean;
  stale: boolean;
  oneSided: boolean;
  direction: 'up' | 'down' | 'flat';
  risk: 'green' | 'amber' | 'red';
  structureFlags: { callable?: boolean; puttable?: boolean };
  status: string;
  rating: string;
  spRating: string;
  moodysRating: string;
  fitchRating: string;
  tag: string;
  venue: string;
  side: 'long' | 'short';
  tif: string;
  fillPct: number;
  rangeMin: number;
  rangeMax: number;
  rangeVal: number;
  bidirectionalVal: number;
  heatVal: number;
  gaugeVal: number;
  qty: number;
  spread: number;
  bid: number;
  ask: number;
  mid: number;
  mat01: number;
  mat13: number;
  mat35: number;
  mat510: number;
  mat10p: number;
  history: number[];
  colSpark: number[];
  areaSpark: number[];
  barSpark: number[];
  pieSpark: number[];
  dailyPnl: number[];
  yields: number[];
  krds: number[];
  bidPx: number[];
  bidSz: number[];
  askPx: number[];
  askSz: number[];
  bench: string;
  bidSize: number;
  askSize: number;
  bidVenue: string;
  askVenue: string;
  prevClose: number;
  stackedNote: string;
}

const SPARK = [12, 14, 13, 16, 15, 18, 17, 19];

// V1 — a module-level clock captured ONCE at import time, mirroring
// rendererBlotter.ts's D1 fix, so the age/relative-time/stale-flag columns
// below render deterministic text for visual-regression snapshots (only the
// relative deltas baked into `catalogRow()` matter for painted output).
const FROZEN_NOW = Date.now();

function catalogRow(): CatalogRow {
  const now = FROZEN_NOW;
  return {
    id: 'cat1',
    numberVal: 1_234_567.89,
    price: 98.125,
    prevPrice: 98.0,
    pnl: 12_500,
    chg: 0.125,
    chgPct: 0.13,
    bps: 185,
    benchmark: 100,
    pctChange: 1.02,
    fracPrice: 99.515625,
    abbrevNum: 45_000_000,
    symbol: 'AAPL 4.5 05/30',
    cusip: '037833100',
    pair: 'EUR/USD',
    rate: 1.0834,
    timestamp: now - 3_600_000,
    sinceMs: now - 45_000,
    staleMs: now - 800,
    fresh: true,
    tight: true,
    deep: true,
    stale: false,
    oneSided: false,
    direction: 'up',
    risk: 'green',
    structureFlags: { callable: true, puttable: true },
    status: 'WORKING',
    rating: 'A',
    spRating: 'AA',
    moodysRating: 'Aa2',
    fitchRating: 'AA-',
    tag: '144A',
    venue: 'XNAS',
    side: 'long',
    tif: 'DAY',
    fillPct: 0.72,
    rangeMin: 90,
    rangeMax: 110,
    rangeVal: 98.12,
    bidirectionalVal: -4200,
    heatVal: 8500,
    gaugeVal: 8,
    qty: 500_000,
    spread: 0.04,
    bid: 98.10,
    ask: 98.14,
    mid: 98.12,
    mat01: 30,
    mat13: 25,
    mat35: 20,
    mat510: 15,
    mat10p: 10,
    history: SPARK,
    colSpark: SPARK,
    areaSpark: SPARK,
    barSpark: SPARK,
    pieSpark: [25, 35, 20, 20],
    dailyPnl: [1, -1, 1, 1, -1, 1, 0, 1],
    yields: [4.2, 4.5, 4.8, 5.0],
    krds: [2.1, -0.8, 3.2, -1.5],
    bidPx: [100.0, 99.95, 99.90],
    bidSz: [500, 300, 200],
    askPx: [100.05, 100.10, 100.15],
    askSz: [400, 350, 250],
    bench: 'T 4.25 05/34',
    bidSize: 500,
    askSize: 400,
    bidVenue: 'XNAS',
    askVenue: 'ARCX',
    prevClose: 96.0,
    stackedNote: '5Y',
  };
}

function col(
  colDef: RenderersColDefBuilders,
  name: RendererName,
  field: string,
  params?: unknown,
  width = 110,
): CColDef<CatalogRow> {
  return {
    ...(colDef.renderer(name, field, params, { colId: name }) as CColDef<CatalogRow>),
    headerName: name,
    width,
    sortable: name.includes('sparkline') || name.includes('chart') || name === 'depth-ladder'
      ? false
      : undefined,
  };
}

function buildCatalogColumns(
  colDef: RenderersColDefBuilders,
  actionLog: string[],
): CColDef<CatalogRow>[] {
  const cols: CColDef<CatalogRow>[] = [];

  for (const name of RENDERER_NAMES) {
    switch (name) {
      case 'number':
        cols.push(col(colDef, name, 'numberVal', { format: '#,##0.00' }));
        break;
      case 'price':
        cols.push(col(colDef, name, 'price', { prevField: 'prevPrice' }));
        break;
      case 'price-direction':
        cols.push(col(colDef, name, 'price', { prevField: 'prevPrice' }));
        break;
      case 'pnl':
        cols.push(col(colDef, name, 'pnl', { format: '#,##0', currencySymbol: '$' }));
        break;
      case 'delta':
        cols.push(col(colDef, name, 'chg', { absoluteField: 'chg', percentField: 'chgPct' }));
        break;
      case 'bps':
        cols.push(col(colDef, name, 'bps', { benchmarkField: 'benchmark' }));
        break;
      case 'pct-change':
        cols.push(col(colDef, name, 'pctChange', { precision: 2 }));
        break;
      case 'fractional-price':
        cols.push(col(colDef, name, 'fracPrice', { denominator: 32 }));
        break;
      case 'abbreviated-number':
        cols.push(col(colDef, name, 'abbrevNum', { precision: 1, currencyPrefix: '$' }));
        break;
      case 'ticker':
        // D3 — secondary line binds to an actual identifier value, not a
        // bare type-label ('CUSIP'); catalogRow() carries a real CUSIP.
        cols.push(col(colDef, name, 'symbol', { secondaryField: 'cusip' }, 130));
        break;
      case 'currency-pair':
        cols.push(col(colDef, name, 'pair', { pairField: 'pair', rateField: 'rate' }, 120));
        break;
      case 'timestamp':
        cols.push(col(colDef, name, 'timestamp', { showMillis: true }, 120));
        break;
      case 'age':
        cols.push(col(colDef, name, 'sinceMs', { sinceField: 'sinceMs' }, 90));
        break;
      case 'relative-time':
        cols.push(col(colDef, name, 'sinceMs', { sinceField: 'sinceMs' }, 100));
        break;
      case 'status-dot':
        cols.push(col(colDef, name, 'status', { label: 'Live', color: '#0aa063' }, 90));
        break;
      case 'quote-quality-dot':
        cols.push(col(colDef, name, 'fresh', {
          freshField: 'fresh', tightField: 'tight', deepField: 'deep',
          staleField: 'stale', oneSidedField: 'oneSided',
        }, 80));
        break;
      case 'stale-flag':
        // D1 — bind the displayed value to a real numeric field (`price`);
        // `staleMs` stays the age-check field via `lastTickField`, never the
        // primary bound value (that was the raw-epoch-number bug).
        cols.push({
          ...col(colDef, name, 'price', { lastTickField: 'staleMs', staleAfterMs: 8_000 }, 90),
          valueFormatter: '#,##0.00',
        });
        break;
      case 'direction-arrow':
        cols.push(col(colDef, name, 'direction', { directionField: 'direction' }, 80));
        break;
      case 'structure-icon-strip':
        cols.push(col(colDef, name, 'structureFlags', { flagsField: 'structureFlags' }, 120));
        break;
      case 'traffic-light':
        cols.push(col(colDef, name, 'risk', { stateField: 'risk' }, 80));
        break;
      case 'status-pill':
        cols.push(col(colDef, name, 'status', { statusField: 'status' }, 100));
        break;
      case 'rating-badge':
        cols.push(col(colDef, name, 'rating', {}, 80));
        break;
      case 'rating-cluster':
        cols.push(col(colDef, name, 'spRating', {
          spField: 'spRating', moodysField: 'moodysRating', fitchField: 'fitchRating',
        }, 140));
        break;
      case 'tag':
        cols.push(col(colDef, name, 'tag', { textField: 'tag' }, 80));
        break;
      case 'venue-chip':
        cols.push(col(colDef, name, 'venue', { micField: 'venue' }, 90));
        break;
      case 'side-chip':
        cols.push(col(colDef, name, 'side', { sideField: 'side' }, 70));
        break;
      case 'tif-pill':
        cols.push(col(colDef, name, 'tif', { tifField: 'tif' }, 80));
        break;
      case 'progress-bar':
        cols.push(col(colDef, name, 'fillPct', { fractionField: 'fillPct' }, 100));
        break;
      case 'range-bar':
        cols.push(col(colDef, name, 'rangeVal', {
          minField: 'rangeMin', maxField: 'rangeMax', valueField: 'rangeVal',
        }, 110));
        break;
      case 'bidirectional-bar':
        // Static stats stand in for ColumnStats (catalog colIds don't match row fields).
        cols.push(col(colDef, name, 'bidirectionalVal', {
          valueField: 'bidirectionalVal',
          stats: { min: -10_000, max: 10_000, maxAbs: 10_000, sum: 0, count: 5 },
        }, 110));
        break;
      case 'heat':
        cols.push(col(colDef, name, 'heatVal', {
          stats: { min: -10_000, max: 10_000, maxAbs: 10_000, sum: 8500, count: 5 },
        }, 100));
        break;
      case 'gauge':
        cols.push(col(colDef, name, 'gaugeVal', { min: -20, max: 20, zones: [-20, 0, 20] }, 110));
        break;
      case 'spread-bar':
        cols.push(col(colDef, name, 'spread', {
          bidField: 'bid', askField: 'ask',
          history: { values: [0.03, 0.04, 0.05, 0.04, 0.03, 0.04], window: 30 },
        }, 120));
        break;
      case 'volume-bar':
        cols.push(col(colDef, name, 'qty', {
          valueField: 'qty',
          stats: { min: 0, max: 1_000_000, maxAbs: 1_000_000, sum: 2_800_000, count: 5 },
        }, 100));
        break;
      case 'maturity-ladder':
        cols.push(col(colDef, name, 'mat01', {
          bucketFields: {
            '0-1y': 'mat01', '1-3y': 'mat13', '3-5y': 'mat35', '5-10y': 'mat510', '10y+': 'mat10p',
          },
        }, 130));
        break;
      case 'win-loss-sparkline':
        cols.push(col(colDef, name, 'dailyPnl', { valuesField: 'dailyPnl' }, 120));
        break;
      case 'yield-curve-sparkline':
        cols.push(col(colDef, name, 'yields', {
          tenors: ['2y', '5y', '10y', '30y'], valuesField: 'yields', markerTenor: '10y',
        }, 140));
        break;
      case 'krd-bar-chart':
        cols.push(col(colDef, name, 'krds', {
          tenors: ['2y', '5y', '10y', '30y'], valuesField: 'krds',
        }, 130));
        break;
      case 'depth-ladder':
        cols.push(col(colDef, name, 'bidPx', {
          bidPricesField: 'bidPx', bidSizesField: 'bidSz',
          askPricesField: 'askPx', askSizesField: 'askSz', levels: 3,
        }, 150));
        break;
      case 'stacked-value':
        cols.push(col(colDef, name, 'price', { primaryField: 'price', secondaryField: 'stackedNote' }, 110));
        break;
      case 'price-quote':
        cols.push(col(colDef, name, 'mid', { bidField: 'bid', askField: 'ask', midField: 'mid' }, 150));
        break;
      case 'nbbo':
        cols.push(col(colDef, name, 'bid', {
          bidField: 'bid', bidSizeField: 'bidSize', bidVenueField: 'bidVenue',
          askField: 'ask', askSizeField: 'askSize', askVenueField: 'askVenue',
        }, 180));
        break;
      case 'benchmark-spread':
        cols.push(col(colDef, name, 'bps', { bpsField: 'bps', benchmarkLabelField: 'bench' }, 150));
        break;
      case 'price-change-composite':
        cols.push(col(colDef, name, 'price', {
          priceField: 'price', changeField: 'chg', prevCloseField: 'prevClose',
        }, 150));
        break;
      case 'icon-action-cluster':
        cols.push({
          ...(colDef.iconActionCluster(name, {
            actions: [{ icon: 'x', label: 'Act', onAction: (rowId) => { actionLog.push(String(rowId)); } }],
          }) as CColDef<CatalogRow>),
          headerName: name,
          width: 90,
        });
        break;
      case 'row-menu':
        cols.push({
          ...(colDef.rowMenu(name, {
            onOpen: (rowId) => { actionLog.push(`menu:${rowId}`); },
          }) as CColDef<CatalogRow>),
          headerName: name,
          width: 70,
        });
        break;
      case 'line-sparkline':
        cols.push(col(colDef, name, 'history', {}, 120));
        break;
      case 'column-sparkline':
        cols.push(col(colDef, name, 'colSpark', {}, 120));
        break;
      case 'area-sparkline':
        cols.push(col(colDef, name, 'areaSpark', {}, 120));
        break;
      case 'bar-sparkline':
        cols.push(col(colDef, name, 'barSpark', {}, 120));
        break;
      case 'pie-sparkline':
        cols.push(col(colDef, name, 'pieSpark', {}, 100));
        break;
      default:
        break;
    }
  }

  return cols;
}

export const rendererCatalog: Feature = {
  id: 'renderer-catalog',
  label: 'Renderer Catalog',
  description:
    'Cycle 21f — all 51 @wellsfargo-starui/velocity-grid-renderers painters in one horizontally scrollable ' +
    'catalog row (one column per canonical name).',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<CatalogRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [],
      theme,
      rowHeight: 40,
      headerHeight: 36,
    });

    grid.setRowData([catalogRow()]);

    const actionLog: string[] = [];
    const { colDef } = wireShowcaseRenderers(grid, gridHost, { now: () => FROZEN_NOW });

    const columns = buildCatalogColumns(colDef, actionLog);
    grid.updateGridOptions({ columnDefs: columns });

    (window as unknown as { __cgridRendererCatalogCount?: number }).__cgridRendererCatalogCount =
      columns.length;

    const countBtn = document.createElement('button');
    countBtn.className = 'ctrl-btn';
    countBtn.setAttribute('data-testid', 'btn-renderer-catalog-count');
    countBtn.textContent = `${columns.length} renderers`;
    countBtn.disabled = true;
    controls.append(countBtn);

    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      delete window.__cgridRenderers;
      delete (window as unknown as { __cgridRendererCatalogCount?: number }).__cgridRendererCatalogCount;
      origDestroy();
    };

    return grid;
  },
};
