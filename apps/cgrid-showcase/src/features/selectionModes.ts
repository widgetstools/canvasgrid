import { CGrid } from 'cgrid';
import type { CColDef, SelectionConfig } from 'cgrid';
import type { Feature } from './index';
import type { ShowcaseRow } from '../seedData';
import { makeRows } from '../seedData';

/**
 * Unified `selection` config demo (ag-grid v33+ parity).
 *
 * Four toolbar pills let visitors pick a selection mode and see the
 * grid reconfigure on-the-fly:
 *
 *   • Single row    — `selection: { mode: 'singleRow' }`
 *   • Multi row     — `selection: { mode: 'multiRow' }`
 *   • Checkbox-only — `selection: { mode: 'multiRow', checkboxes: true,
 *                                   headerCheckbox: true,
 *                                   enableClickSelection: false }`
 *   • Cell range    — `selection: { mode: 'cell' }`
 *
 * Each pill swaps the entire selection surface — including
 * auto-injecting a pinned-left checkbox column when configured —
 * via grid.destroy() + reconstruction. The legacy per-column knobs
 * still work; this page shows the unified API for new apps.
 */

const COLUMNS: CColDef<ShowcaseRow>[] = [
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 120 },
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 110 },
  { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 110 },
  { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text', width: 110 },
  {
    colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 130,
    valueFormatter: ({ value }) => (typeof value === 'number'
      ? `${value >= 0 ? '+' : '−'}$${Math.abs(value).toLocaleString()}` : ''),
    cellStyle: ({ value }) =>
      typeof value === 'number' && value >= 0 ? { fg: '#16a34a' } : { fg: '#dc2626' },
  },
  {
    colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', width: 140,
    valueFormatter: ({ value }) => (typeof value === 'number' ? `$${value.toLocaleString()}` : ''),
  },
];

type ModeKey = 'singleRow' | 'multiRow' | 'checkboxOnly' | 'cell';

const CONFIGS: Record<ModeKey, SelectionConfig<ShowcaseRow>> = {
  singleRow: { mode: 'singleRow' },
  multiRow: { mode: 'multiRow' },
  checkboxOnly: {
    mode: 'multiRow',
    checkboxes: true,
    headerCheckbox: true,
    enableClickSelection: false,
  },
  cell: { mode: 'cell' },
};

const LABELS: Record<ModeKey, string> = {
  singleRow: 'Single row',
  multiRow: 'Multi row',
  checkboxOnly: 'Checkbox only',
  cell: 'Cell range',
};

export const selectionModes: Feature = {
  id: 'selectionModes',
  label: 'Selection Modes',
  description:
    'Unified `selection: { mode, ... }` config — ag-grid v33+ parity. ' +
    'Pills swap between singleRow / multiRow / checkbox-only / cell modes; ' +
    'each click reconstructs the grid with the new config so visitors see ' +
    'the auto-injected checkbox column appear and disappear as the mode ' +
    'changes.',

  mount(gridHost, controls, theme) {
    let activeMode: ModeKey = 'multiRow';
    let grid: CGrid<ShowcaseRow>;

    const construct = () => {
      gridHost.innerHTML = '';
      const g = new CGrid<ShowcaseRow>(gridHost, {
        getRowId: (r) => r.id,
        columnDefs: COLUMNS,
        theme,
        ariaLabel: `Trading positions — ${LABELS[activeMode]} selection mode`,
        selection: CONFIGS[activeMode],
      });
      g.setRowData(makeRows(40));
      // Re-publish the window handle so E2E + DevTools see the
      // active instance after each mode swap (the showcase shell
      // only assigns `__cgrid` once per feature mount).
      (window as any).__cgrid = g;
      return g;
    };
    grid = construct();

    const label = document.createElement('span');
    label.className = 'ctrl-label';
    label.textContent = 'Selection mode';
    controls.appendChild(label);

    const buttons: Record<ModeKey, HTMLButtonElement> = {} as any;
    const refresh = () => {
      for (const k of Object.keys(buttons) as ModeKey[]) {
        buttons[k].classList.toggle('primary', k === activeMode);
      }
    };
    for (const k of Object.keys(LABELS) as ModeKey[]) {
      const btn = document.createElement('button');
      btn.className = 'ctrl-btn' + (k === activeMode ? ' primary' : '');
      btn.textContent = LABELS[k];
      btn.setAttribute('data-testid', `btn-selection-${k}`);
      btn.addEventListener('click', () => {
        if (activeMode === k) return;
        activeMode = k;
        grid.destroy();
        grid = construct();
        refresh();
      });
      controls.appendChild(btn);
      buttons[k] = btn;
    }

    return grid;
  },
};
