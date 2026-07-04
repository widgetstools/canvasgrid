import type { ColDef, ColGroupDef } from 'ag-grid-community';
import type { PositionRow } from './data';
import { fmtBp, fmtCcy, fmtNum, fmtSignedCcy } from './data';

type Col = ColDef<PositionRow>;
type Group = ColGroupDef<PositionRow>;

export const defaultColDef: Col = {
  sortable: true,
  resizable: true,
  filter: true,
  minWidth: 90,
};

// Red/green P&L coloring for the dark grid.
const pnlCellStyle = (p: { value: number | null }) =>
  p.value == null
    ? null
    : { color: p.value >= 0 ? '#34d399' : '#f87171', fontWeight: 500 };

export const columnDefs: (Col | Group)[] = [
  // 1 — flat pinned column, no group
  { field: 'positionId', headerName: 'Position ID', pinned: 'left', width: 130 },

  // 2 — fields-only group, not expandable (no columnGroupShow, no openByDefault)
  {
    groupId: 'grp-instrument',
    headerName: 'Instrument',
    children: [
      { field: 'instrument', headerName: 'Name', width: 130 },
      { field: 'cusip', headerName: 'CUSIP', width: 120 },
      { field: 'assetClass', headerName: 'Asset Class', width: 120 },
    ],
  },

  // 3 — expandable, CLOSED by default; always / open / closed leaves
  {
    groupId: 'grp-coverage',
    headerName: 'Book & Coverage',
    openByDefault: false,
    children: [
      { field: 'book', headerName: 'Book', width: 110 },
      { field: 'desk', headerName: 'Desk', width: 120, columnGroupShow: 'open' },
      { field: 'trader', headerName: 'Trader', width: 110, columnGroupShow: 'open' },
      { field: 'region', headerName: 'Region', width: 100, columnGroupShow: 'closed' },
    ],
  },

  // 4 — expandable, OPEN by default
  {
    groupId: 'grp-valuation',
    headerName: 'Valuation',
    openByDefault: true,
    children: [
      { field: 'price', headerName: 'Price', width: 100, type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'mtm', headerName: 'MTM', width: 100, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'open' },
      { field: 'currency', headerName: 'Ccy', width: 80, columnGroupShow: 'open' },
      { field: 'prevClose', headerName: 'Prev Close', width: 110, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'closed' },
    ],
  },

  // 5 — reveals extra columns only when opened
  {
    groupId: 'grp-pnl',
    headerName: 'P&L',
    children: [
      { field: 'marketValue', headerName: 'Market Value', width: 140, type: 'numericColumn', valueFormatter: fmtCcy },
      { field: 'dayPnl', headerName: 'Day P&L', width: 120, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle, columnGroupShow: 'open' },
      { field: 'mtdPnl', headerName: 'MTD P&L', width: 120, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle, columnGroupShow: 'open' },
      { field: 'ytdPnl', headerName: 'YTD P&L', width: 120, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle, columnGroupShow: 'open' },
    ],
  },

  // 6 — CENTERPIECE: mixed leaf fields + nested sub-groups, each in its own state
  {
    groupId: 'grp-risk',
    headerName: 'Risk & Analytics',
    marryChildren: true,
    children: [
      // leaf fields — always / open / closed
      { field: 'dv01', headerName: 'DV01', width: 100, type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'cr01', headerName: 'CR01', width: 100, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'open' },
      { field: 'duration', headerName: 'Duration', width: 110, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'closed' },
      // nested sub-group — always visible
      {
        groupId: 'grp-exposure',
        headerName: 'Exposure',
        children: [
          { field: 'grossExp', headerName: 'Gross', width: 130, type: 'numericColumn', valueFormatter: fmtCcy },
          { field: 'netExp', headerName: 'Net', width: 130, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle },
        ],
      },
      // nested sub-group — only when parent OPEN
      {
        groupId: 'grp-greeks',
        headerName: 'Greeks',
        columnGroupShow: 'open',
        children: [
          { field: 'delta', headerName: 'Δ', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
          { field: 'gamma', headerName: 'Γ', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
          { field: 'vega', headerName: 'ν', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
          { field: 'theta', headerName: 'Θ', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
        ],
      },
      // nested sub-group — only when parent CLOSED
      {
        groupId: 'grp-scenario',
        headerName: 'Scenario',
        columnGroupShow: 'closed',
        children: [
          { field: 'up100bp', headerName: '+100bp', width: 100, type: 'numericColumn', valueFormatter: fmtBp },
          { field: 'down100bp', headerName: '-100bp', width: 100, type: 'numericColumn', valueFormatter: fmtBp },
        ],
      },
    ],
  },

  // 7 — fields-only group, married together
  {
    groupId: 'grp-metadata',
    headerName: 'Metadata',
    marryChildren: true,
    children: [
      { field: 'sector', headerName: 'Sector', width: 130 },
      { field: 'rating', headerName: 'Rating', width: 90 },
      { field: 'maturity', headerName: 'Maturity', width: 120 },
      { field: 'updatedAt', headerName: 'Updated', width: 140 },
    ],
  },
];

export const GROUP_IDS = [
  'grp-instrument',
  'grp-coverage',
  'grp-valuation',
  'grp-pnl',
  'grp-risk',
  'grp-metadata',
];
