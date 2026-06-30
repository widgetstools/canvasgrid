import { CGrid } from 'cgrid';
import type { CColDef, GridState } from 'cgrid';
import type { Feature } from './index';
import type { ShowcaseRow } from '../seedData';
import { makeRows } from '../seedData';

/**
 * Cycle 23 / Tasks 1-7 — events + state-snapshot demo.
 *
 * Three demonstrations in one page:
 *
 *   • Save layout / Restore layout — round-trips the full grid state
 *     through localStorage. Sort, filter, column order/width, row
 *     group state, and scroll all come back as they were.
 *   • Reset state — clears every mutable model back to the
 *     construction-time defaults.
 *   • Live event log — shows the last 20 hover / scroll / keyboard /
 *     stateUpdated events with their payload essentials so visitors
 *     can see the new event surface fire in real time.
 *
 * The grid auto-restores any localStorage-stored snapshot via
 * `initialState` so reloading the page brings the user back to their
 * last layout.
 */

const STORAGE_KEY = 'cgrid:showcase:events-state:snapshot';

const COLUMNS: CColDef<ShowcaseRow>[] = [
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 110, filter: 'text' },
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 110, filter: 'text' },
  { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 110, filter: 'text' },
  { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text', width: 110, filter: 'text' },
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

function loadSnapshot(): GridState | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as GridState;
  } catch {
    return undefined;
  }
}

export const eventsState: Feature = {
  id: 'eventsState',
  label: 'Events + State',
  description:
    'Cycle 23 / Tasks 1-7 — hover / scroll / keyboard / stateUpdated ' +
    'events fan out live in the log on the right; Save/Restore round-' +
    'trips the full grid state through localStorage. Reload the page ' +
    'to see the auto-restore via the initialState constructor option.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: COLUMNS,
      theme,
      rowSelection: 'multiple',
      initialState: loadSnapshot(),
    });

    grid.setRowData(makeRows(80));

    // ─── Save / Restore / Reset ─────────────────────────────────────

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ctrl-btn primary';
    saveBtn.textContent = 'Save layout';
    saveBtn.setAttribute('data-testid', 'btn-save-state');
    saveBtn.addEventListener('click', () => {
      const state = grid.getState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveBtn.textContent = 'Saved ✓';
      setTimeout(() => { saveBtn.textContent = 'Save layout'; }, 1200);
    });

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'ctrl-btn';
    restoreBtn.textContent = 'Restore layout';
    restoreBtn.setAttribute('data-testid', 'btn-restore-state');
    restoreBtn.addEventListener('click', () => {
      const snapshot = loadSnapshot();
      if (snapshot) grid.setState(snapshot);
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'ctrl-btn';
    resetBtn.textContent = 'Reset state';
    resetBtn.setAttribute('data-testid', 'btn-reset-state');
    resetBtn.addEventListener('click', () => {
      grid.resetState();
      localStorage.removeItem(STORAGE_KEY);
    });

    const clearLogBtn = document.createElement('button');
    clearLogBtn.className = 'ctrl-btn';
    clearLogBtn.textContent = 'Clear log';
    clearLogBtn.setAttribute('data-testid', 'btn-clear-log');

    controls.appendChild(saveBtn);
    controls.appendChild(restoreBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(clearLogBtn);

    // ─── Live event log ─────────────────────────────────────────────

    const logHost = document.createElement('div');
    logHost.className = 'event-log';
    logHost.setAttribute('data-testid', 'event-log');
    logHost.style.cssText = [
      'position:absolute', 'top:8px', 'right:8px', 'width:280px',
      'max-height:50vh', 'overflow:auto', 'padding:8px 10px',
      'background:var(--cg-popup-bg, rgba(0,0,0,0.85))',
      'color:var(--cg-popup-fg, #f3f4f6)',
      'border:1px solid var(--cg-popup-border, rgba(255,255,255,0.1))',
      'border-radius:6px', 'font: 11px/1.45 ui-monospace, monospace',
      'pointer-events:none', 'z-index:50',
    ].join(';');
    gridHost.style.position = 'relative';
    gridHost.appendChild(logHost);

    const entries: string[] = [];
    const append = (line: string) => {
      entries.unshift(line);
      if (entries.length > 20) entries.length = 20;
      logHost.textContent = entries.join('\n');
    };
    clearLogBtn.addEventListener('click', () => { entries.length = 0; logHost.textContent = ''; });

    grid.on('cellMouseOver', (e: any) =>
      append(`cellMouseOver  ${e.rowId}/${e.colId}`));
    grid.on('cellMouseOut', (e: any) =>
      append(`cellMouseOut   ${e.rowId}/${e.colId}`));
    grid.on('rowMouseOver', (e: any) =>
      append(`rowMouseOver   ${e.rowId}`));
    grid.on('bodyScroll', (e: any) =>
      append(`bodyScroll     top=${e.top} left=${e.left} ${e.direction}`));
    grid.on('bodyScrollEnd', (e: any) =>
      append(`bodyScrollEnd  top=${e.top} left=${e.left}`));
    grid.on('cellKeyDown', (e: any) =>
      append(`cellKeyDown    ${e.event.key} on ${e.rowId}/${e.colId}`));
    grid.on('stateUpdated', (e: any) =>
      append(`stateUpdated   [${e.changedKeys.join(', ')}] src=${e.source}`));

    return grid;
  },
};
