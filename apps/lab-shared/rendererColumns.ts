/**
 * Cell Renderers tab ColDefs — Markets Lab parity.
 * Params (statusField / statusColors / …) live on the ColDef; profiles set
 * `columnOverrides[].cellRenderer` to turn painters on/off per curriculum.
 */
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import { THREADING_PROGRAM } from '@wellsfargo-starui/velocity-grid-renderers';
import { pickColumns, type LabRow } from './columns';

/** Sector → status-pill colors (keys uppercased — status-pill uppercases values). */
export const SECTOR_PILL_COLORS: Record<string, { bg: string; fg: string }> = {
  FINANCIALS: { bg: '#0f2b3f', fg: '#7fc1ef' },
  UTILITIES: { bg: '#102e22', fg: '#79d3a3' },
  ENERGY: { bg: '#3a2310', fg: '#f0a576' },
  INDUSTRIALS: { bg: '#1f2733', fg: '#9aa6b2' },
  TECHNOLOGY: { bg: '#102e3a', fg: '#7ec4d8' },
  HEALTHCARE: { bg: '#23123a', fg: '#b88bf0' },
};

export const ASSET_CLASS_PILL_COLORS: Record<string, { bg: string; fg: string }> = {
  'IG CREDIT': { bg: '#103418', fg: '#7fdf9b' },
  'HY CREDIT': { bg: '#3a1818', fg: '#ee8e8e' },
  RATES: { bg: '#0e3046', fg: '#7cc7f9' },
  EM: { bg: '#3a2614', fg: '#f0a576' },
  MUNI: { bg: '#23123a', fg: '#b88bf0' },
};

export const DESK_PILL_COLORS: Record<string, { bg: string; fg: string }> = {
  RATES: { bg: '#0e3046', fg: '#7cc7f9' },
  CREDIT: { bg: '#103418', fg: '#7fdf9b' },
  EQUITIES: { bg: '#23123a', fg: '#b88bf0' },
  FX: { bg: '#3a2310', fg: '#f0a576' },
  COMMODITIES: { bg: '#33310c', fg: '#e5dd6f' },
};

function withParams(
  col: CColDef<LabRow>,
  cellRendererParams: Record<string, unknown>,
): CColDef<LabRow> {
  return {
    ...col,
    cellRendererParams,
    // Bridge threading for statusField / row lookups (Markets pill parity).
    _compositeProgram: THREADING_PROGRAM,
  } as CColDef<LabRow>;
}

/** CSRM columns for the Cell Renderers tab (params ready; painters via profiles). */
export function buildCsrmRendererColumns(): CColDef<LabRow>[] {
  const cols = pickColumns([
    'cusip', 'ticker', 'instrumentDescription',
    'compositeRating', 'issuerSector', 'assetClass', 'currency',
    'bidPrice', 'midPrice', 'askPrice', 'lastPrice', 'priceChangePct',
    'oas', 'modifiedDuration', 'marketValue',
    'unrealizedPnL', 'dailyPnL', 'ytdPnL',
  ]);

  return cols.map((c) => {
    switch (c.field) {
      case 'compositeRating':
        return {
          ...withParams(c, {}),
          headerName: 'Rating',
          width: 100,
        };
      case 'issuerSector':
        return {
          ...withParams(c, {
            statusField: 'issuerSector',
            statusColors: SECTOR_PILL_COLORS,
          }),
          headerName: 'Sector',
          width: 120,
        };
      case 'assetClass':
        return {
          ...withParams(c, {
            statusField: 'assetClass',
            statusColors: ASSET_CLASS_PILL_COLORS,
          }),
          headerName: 'Class',
          width: 110,
        };
      case 'currency':
        return {
          ...withParams(c, { textField: 'currency' }),
          headerName: 'Ccy',
          width: 70,
        };
      case 'priceChangePct':
        return { ...withParams(c, { precision: 3 }), headerName: 'Chg %', width: 90 };
      case 'oas':
        return { ...withParams(c, {}), headerName: 'OAS', width: 90 };
      case 'modifiedDuration':
        return {
          ...withParams(c, { min: 0, max: 30, valueField: 'modifiedDuration' }),
          headerName: 'Dur',
          width: 90,
        };
      case 'marketValue':
        return { ...withParams(c, {}), headerName: 'Mkt Value', width: 120 };
      case 'unrealizedPnL':
      case 'dailyPnL':
      case 'ytdPnL':
        return {
          ...withParams(c, { currencySymbol: '', format: '#,##0' }),
          width: 110,
        };
      default:
        return { ...c };
    }
  });
}

/** Override seeds — cellRenderer names only (params stay on ColDef). */
export const CSRM_RENDERER_OVERRIDES = {
  pills: [
    { colId: 'compositeRating', cellRenderer: 'rating-badge', headerName: 'Rating (pill)' },
    { colId: 'issuerSector', cellRenderer: 'status-pill', headerName: 'Sector (pill)' },
    { colId: 'assetClass', cellRenderer: 'status-pill', headerName: 'Class (pill)' },
  ],
  charts: [
    { colId: 'oas', cellRenderer: 'heat', headerName: 'OAS (heat)' },
    { colId: 'modifiedDuration', cellRenderer: 'gauge', headerName: 'Dur (gauge)' },
    { colId: 'marketValue', cellRenderer: 'volume-bar', headerName: 'Mkt (bar)' },
  ],
  pnl: [
    { colId: 'priceChangePct', cellRenderer: 'pct-change', headerName: 'Δ %' },
    { colId: 'unrealizedPnL', cellRenderer: 'pnl', headerName: 'Unreal (PnL)' },
    { colId: 'dailyPnL', cellRenderer: 'pnl', headerName: 'Daily (PnL)' },
    { colId: 'ytdPnL', cellRenderer: 'pnl', headerName: 'YTD (PnL)' },
  ],
  tags: [
    { colId: 'currency', cellRenderer: 'tag', headerName: 'Ccy (tag)' },
  ],
} as const;

export const CSRM_RENDERER_FULL_OVERRIDES = [
  ...CSRM_RENDERER_OVERRIDES.pills,
  ...CSRM_RENDERER_OVERRIDES.charts,
  ...CSRM_RENDERER_OVERRIDES.pnl,
  ...CSRM_RENDERER_OVERRIDES.tags,
];

export const SSRM_RENDERER_OVERRIDES = {
  pills: [
    { colId: 'desk', cellRenderer: 'status-pill', headerName: 'Desk (pill)' },
    { colId: 'region', cellRenderer: 'status-pill', headerName: 'Region (pill)' },
    { colId: 'currency', cellRenderer: 'tag', headerName: 'Ccy (tag)' },
  ],
  charts: [
    { colId: 'notional', cellRenderer: 'volume-bar', headerName: 'Notional (bar)' },
    { colId: 'marketValue', cellRenderer: 'volume-bar', headerName: 'Mkt (bar)' },
    { colId: 'price', cellRenderer: 'heat', headerName: 'Price (heat)' },
  ],
  pnl: [
    { colId: 'pnl', cellRenderer: 'pnl', headerName: 'PnL' },
    { colId: 'dailyPnl', cellRenderer: 'pnl', headerName: 'Daily (PnL)' },
  ],
} as const;

export const SSRM_RENDERER_FULL_OVERRIDES = [
  ...SSRM_RENDERER_OVERRIDES.pills,
  ...SSRM_RENDERER_OVERRIDES.charts,
  ...SSRM_RENDERER_OVERRIDES.pnl,
];

/** Patch MOCK_POSITION_COLUMNS with statusField params for SSRM pills. */
export function withSsrmRendererParams<T extends { colId?: string; field?: string }>(
  cols: T[],
): T[] {
  return cols.map((c) => {
    const id = c.colId ?? c.field;
    if (id === 'desk') {
      return {
        ...c,
        cellRendererParams: { statusField: 'desk', statusColors: DESK_PILL_COLORS },
        _compositeProgram: THREADING_PROGRAM,
      };
    }
    if (id === 'region') {
      return {
        ...c,
        cellRendererParams: {
          statusField: 'region',
          statusColors: {
            AMER: { bg: '#0e3046', fg: '#7cc7f9' },
            EMEA: { bg: '#103418', fg: '#7fdf9b' },
            APAC: { bg: '#3a2310', fg: '#f0a576' },
          },
        },
        _compositeProgram: THREADING_PROGRAM,
      };
    }
    if (id === 'currency') {
      return {
        ...c,
        cellRendererParams: { textField: 'currency' },
        _compositeProgram: THREADING_PROGRAM,
      };
    }
    if (id === 'pnl' || id === 'dailyPnl') {
      return {
        ...c,
        cellRendererParams: { currencySymbol: '', format: '#,##0' },
        _compositeProgram: THREADING_PROGRAM,
      };
    }
    if (id === 'notional' || id === 'marketValue' || id === 'price') {
      return {
        ...c,
        cellRendererParams: {},
        _compositeProgram: THREADING_PROGRAM,
      };
    }
    return c;
  });
}
