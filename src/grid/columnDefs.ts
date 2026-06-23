import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import type { PositionRow } from '../types';

const currencyFmt = (digits: number) => (p: ValueFormatterParams<PositionRow>) => {
  if (p.value == null || Number.isNaN(Number(p.value))) return '';
  return Number(p.value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const compactNum = (digits: number) => (p: ValueFormatterParams<PositionRow>) => {
  if (p.value == null || Number.isNaN(Number(p.value))) return '';
  return Number(p.value).toFixed(digits);
};

function multiFilter(kind: 'text' | 'number'): Pick<ColDef<PositionRow>, 'filter' | 'filterParams'> {
  const primary = kind === 'number' ? 'agNumberColumnFilter' : 'agTextColumnFilter';
  return {
    filter: 'agMultiColumnFilter',
    filterParams: {
      filters: [{ filter: primary }, { filter: 'agSetColumnFilter' }],
    },
  };
}

function setFilter(): Pick<ColDef<PositionRow>, 'filter'> {
  return { filter: 'agSetColumnFilter' };
}

function textFilter(): Pick<ColDef<PositionRow>, 'filter'> {
  return { filter: 'agTextColumnFilter' };
}

function numberFilter(): Pick<ColDef<PositionRow>, 'filter'> {
  return { filter: 'agNumberColumnFilter' };
}

export const columnDefs: ColDef<PositionRow>[] = [
  {
    field: 'positionId',
    headerName: 'Position ID',
    pinned: 'left',
    width: 150,
    ...multiFilter('text'),
  },
  {
    field: 'cusip',
    headerName: 'CUSIP',
    pinned: 'left',
    width: 110,
    ...multiFilter('text'),
  },
  {
    field: 'desk',
    headerName: 'Desk',
    rowGroup: true,
    hide: true,
    ...setFilter(),
  },
  {
    field: 'region',
    headerName: 'Region',
    rowGroup: true,
    hide: true,
    pivot: true,
    ...setFilter(),
  },
  {
    field: 'instrumentType',
    headerName: 'Instrument Type',
    rowGroup: true,
    hide: true,
    ...setFilter(),
  },
  {
    field: 'ticker',
    headerName: 'Ticker',
    width: 100,
    ...textFilter(),
  },
  {
    field: 'instrumentName',
    headerName: 'Instrument',
    minWidth: 180,
    flex: 1,
    ...textFilter(),
  },
  {
    field: 'productFamily',
    headerName: 'Product Family',
    width: 130,
    ...setFilter(),
  },
  {
    field: 'bookName',
    headerName: 'Book',
    width: 100,
    ...setFilter(),
  },
  {
    field: 'portfolio',
    headerName: 'Portfolio',
    width: 100,
    ...setFilter(),
  },
  {
    field: 'trader',
    headerName: 'Trader',
    width: 130,
    ...textFilter(),
  },
  {
    field: 'country',
    headerName: 'Country',
    width: 90,
    ...setFilter(),
  },
  {
    field: 'currency',
    headerName: 'CCY',
    width: 70,
    ...setFilter(),
  },
  {
    field: 'priceHistory',
    headerName: 'Price Trend',
    cellRenderer: 'agSparklineCellRenderer',
    cellRendererParams: {
      sparklineOptions: {
        type: 'line',
        line: { stroke: '#0d9488', strokeWidth: 1 },
        padding: { top: 4, bottom: 4 },
      },
    },
    width: 120,
    sortable: false,
    filter: false,
  },
  {
    field: 'notionalAmount',
    headerName: 'Notional',
    type: 'numericColumn',
    aggFunc: 'sum',
    width: 130,
    valueFormatter: currencyFmt(0),
    enableCellChangeFlash: true,
    cellEditor: 'agNumberCellEditor',
    cellEditorPopup: true,
    cellEditorParams: { precision: 0 },
    ...numberFilter(),
  },
  {
    field: 'marketValue',
    headerName: 'Market Value',
    type: 'numericColumn',
    aggFunc: 'sum',
    width: 130,
    valueFormatter: currencyFmt(0),
    enableCellChangeFlash: true,
    cellEditor: 'agNumberCellEditor',
    ...multiFilter('number'),
  },
  {
    field: 'currentPrice',
    headerName: 'Price',
    type: 'numericColumn',
    aggFunc: 'avg',
    width: 100,
    valueFormatter: compactNum(4),
    enableCellChangeFlash: true,
    ...multiFilter('number'),
  },
  {
    field: 'pnl',
    headerName: 'P&L',
    type: 'numericColumn',
    aggFunc: 'sum',
    width: 110,
    pinned: 'right',
    valueFormatter: currencyFmt(0),
    enableCellChangeFlash: true,
    cellEditor: 'agNumberCellEditor',
    cellStyle: (p) => {
      const v = Number(p.value ?? 0);
      if (v > 0) return { color: '#0d9488', fontWeight: 600 };
      if (v < 0) return { color: '#dc2626', fontWeight: 600 };
      return undefined;
    },
    ...numberFilter(),
  },
  {
    field: 'dailyPnl',
    headerName: 'Daily P&L',
    type: 'numericColumn',
    aggFunc: 'sum',
    width: 110,
    valueFormatter: currencyFmt(0),
    enableCellChangeFlash: true,
    ...multiFilter('number'),
  },
  {
    field: 'unrealizedPnl',
    headerName: 'Unrealized',
    type: 'numericColumn',
    aggFunc: 'sum',
    width: 110,
    valueFormatter: currencyFmt(0),
    ...multiFilter('number'),
  },
  {
    field: 'yield',
    headerName: 'Yield',
    type: 'numericColumn',
    aggFunc: 'avg',
    width: 90,
    valueFormatter: compactNum(3),
    enableCellChangeFlash: true,
    cellEditor: 'agNumberCellEditor',
    ...multiFilter('number'),
  },
  {
    field: 'spread',
    headerName: 'Spread',
    type: 'numericColumn',
    aggFunc: 'avg',
    width: 90,
    valueFormatter: compactNum(0),
    enableCellChangeFlash: true,
    ...multiFilter('number'),
  },
  {
    field: 'dv01',
    headerName: 'DV01',
    type: 'numericColumn',
    aggFunc: 'sum',
    width: 100,
    valueFormatter: compactNum(2),
    enableCellChangeFlash: true,
    ...multiFilter('number'),
  },
  {
    field: 'pv01',
    headerName: 'PV01',
    type: 'numericColumn',
    aggFunc: 'sum',
    width: 100,
    valueFormatter: compactNum(2),
    enableCellChangeFlash: true,
    ...multiFilter('number'),
  },
  {
    colId: 'ratingComposite',
    headerName: 'Rating',
    width: 90,
    valueGetter: (p) => p.data?.rating?.composite ?? p.data?.rating?.sp ?? '',
    ...textFilter(),
  },
];

export const defaultColDef: ColDef<PositionRow> = {
  sortable: true,
  resizable: true,
  filter: true,
  floatingFilter: true,
  enableRowGroup: true,
  enablePivot: true,
  enableValue: true,
  enableCellChangeFlash: true,
  minWidth: 80,
};

export const autoGroupColumnDef: ColDef<PositionRow> = {
  headerName: 'Desk / Region / Type',
  minWidth: 280,
  pinned: 'left',
  cellRendererParams: {
    suppressCount: false,
  },
};
