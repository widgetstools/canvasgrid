import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

/**
 * Cycle 18 / Task 9 — comprehensive pivot showcase.
 *
 * Demonstrates the FULL Cycle 18 surface — what the cycle ships and how
 * apps wire it. This feature is the "canonical pivot demo" referenced by
 * the cycle exit gate (Prompt 9 / AG-parity spec). The narrower
 * `pivotToolPanel` showcase focuses on the tool panel drop-zones; this
 * one walks the user through every Task 8 toggle.
 *
 * Wired:
 *  - Tasks 1+2+3   — PivotState, PivotPass, end-to-end synthesis.
 *  - Task 4        — pivot column-group expand/collapse, pivotDefaultExpanded.
 *  - Task 5        — columns tool panel pivot zones + checkbox semantics.
 *  - Task 6        — top-of-grid pivot panel (drag strip above the row
 *                    group panel).
 *  - Task 7        — column header context menu pivot items
 *                    (Add to Labels / Value: Aggregate / Scroll to col).
 *  - Task 8a       — pivotMaxGeneratedColumns cap + pivotMaxColumnsReached event.
 *  - Task 8c       — `Strict order` toggle button (enableStrictPivotColumnOrder).
 *  - Task 8d       — sort secondary col → sort row groups by aggregate
 *                    (click a `desk × sum(pnl)` header).
 *  - Task 8e       — `Row totals` + `Col-group totals` toggle buttons.
 *  - Task 8f       — processPivotResultColDef customisation (every
 *                    pivot result column gets a £-prefixed formatter
 *                    so the demo proves the hook actually fires).
 *  - Task 8b       — Save / Restore buttons round-trip the full pivot
 *                    config through getColumnState + serialize.
 */
export const pivot: Feature = {
  id: 'pivot',
  label: 'Pivot (full surface)',
  description:
    'Comprehensive Cycle 18 pivot demo: column tool panel, top-of-grid pivot panel, context menu, row + column-group totals, processPivotResultColDef formatter, sort-by-pivot-value, save/restore. Right-click any header for the pivot menu.',

  mount(gridHost, controls, theme) {
    let activeRowTotals: 'before' | 'after' | null = null;
    // AG-Grid parity default: pivot column-group totals visible
    // alongside the expanded children. See construction options below.
    let activeColGroupTotals: 'before' | 'after' | null = 'after';

    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'region',   field: 'region',   headerName: 'Region',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'sector',   field: 'sector',   headerName: 'Sector',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      cellDataType: 'number', enableValue: true,    aggFunc: 'sum',    flex: 1 },
        { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', enableValue: true,    aggFunc: 'sum',    flex: 1 },
      ],
      theme,
      rowGroupPanelShow: 'always',
      pivotPanelShow: 'always',
      pivotDefaultExpanded: 1,
      // AG-Grid parity: when a pivot column group is expanded, the
      // per-group rollup leaf is ALWAYS visible alongside the children
      // (e.g. Alpine Skiing → 2002 / 2006 / 2010 / sum(Gold) total).
      // Default our showcase to that behaviour so the matrix matches
      // the AG-Grid pivot reference; users can toggle off via the
      // Col-group totals button if they want the closed-only behavior.
      pivotColumnGroupTotals: 'after',
      // No `grandTotalRow` / `groupIncludeFooter` by default — AG-Grid
      // pivot screenshots show a clean per-row-group matrix without a
      // bottom Total row or per-group footer rows. Apps that want the
      // Excel-style bottom totals can re-enable both via the Cycle 14
      // construction options.
      sideBar: {
        toolPanels: ['columns', 'filters'],
        defaultToolPanel: 'agColumnsToolPanel',
      },
      // Cycle 18 / Task 8f — every synthesized pivot result column
      // gets a £-prefix valueFormatter. This proves the hook actually
      // fires on the synthesis path — without it, the totals + body
      // cells paint as raw numbers; with it they paint £-prefixed.
      processPivotResultColDef: (def) => {
        def.valueFormatter = (params) => {
          const v = params.value;
          if (v === null || v === undefined || v === '') return '';
          const n = typeof v === 'number' ? v : Number(v);
          return Number.isFinite(n) ? `£${n.toLocaleString()}` : String(v);
        };
      },
    });

    grid.setRowData(makeRows(120));
    grid.setRowGroupColumns(['desk']);
    // Two pivot levels so the `Col-group totals` toggle has a parent to
    // subtotal under (AG semantics: a 1-level pivot has no parent group
    // to total). With region × sector, toggling col-group totals adds a
    // visible "Total" sub-group inside each region; without that, the
    // toggle is a no-op.
    grid.setPivotColumns(['region', 'sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.addValueColumn('notional', 'sum');
    grid.setPivotMode(true);

    // ─── Controls ──────────────────────────────────────────────────────────

    const rowTotalsBtn = document.createElement('button');
    rowTotalsBtn.className = 'ctrl-btn';
    rowTotalsBtn.setAttribute('data-testid', 'btn-row-totals');
    const refreshRowTotals = () => {
      rowTotalsBtn.textContent = `Row totals: ${activeRowTotals ?? 'off'}`;
    };
    refreshRowTotals();
    rowTotalsBtn.addEventListener('click', () => {
      activeRowTotals = activeRowTotals === null ? 'after'
        : activeRowTotals === 'after' ? 'before'
          : null;
      grid.setGridOption('pivotRowTotals', activeRowTotals);
      refreshRowTotals();
    });

    const colGroupTotalsBtn = document.createElement('button');
    colGroupTotalsBtn.className = 'ctrl-btn';
    colGroupTotalsBtn.setAttribute('data-testid', 'btn-col-group-totals');
    const refreshColGroupTotals = () => {
      colGroupTotalsBtn.textContent = `Col-group totals: ${activeColGroupTotals ?? 'off'}`;
    };
    refreshColGroupTotals();
    colGroupTotalsBtn.addEventListener('click', () => {
      activeColGroupTotals = activeColGroupTotals === null ? 'after'
        : activeColGroupTotals === 'after' ? 'before'
          : null;
      grid.setGridOption('pivotColumnGroupTotals', activeColGroupTotals);
      refreshColGroupTotals();
    });

    // Excel-style grand totals toggle (cgrid superpower; AG-Grid has nothing
    // like this). Flip on → "Grand Total" row appears at the bottom (sticky
    // vertical), right-pinned Total column appears (sticky horizontal),
    // corner cell shows the grand-of-grands per value column.
    let grandTotals = false;
    const grandTotalsBtn = document.createElement('button');
    grandTotalsBtn.className = 'ctrl-btn';
    grandTotalsBtn.setAttribute('data-testid', 'btn-grand-totals');
    const refreshGrandTotals = () => {
      grandTotalsBtn.textContent = `Grand totals: ${grandTotals ? 'on' : 'off'}`;
    };
    refreshGrandTotals();
    grandTotalsBtn.addEventListener('click', () => {
      grandTotals = !grandTotals;
      grid.setGridOption('pivotGrandTotals', grandTotals);
      refreshGrandTotals();
    });

    let strict = false;
    const strictBtn = document.createElement('button');
    strictBtn.className = 'ctrl-btn';
    strictBtn.setAttribute('data-testid', 'btn-strict-order');
    const refreshStrict = () => {
      strictBtn.textContent = `Strict order: ${strict ? 'on' : 'off'}`;
    };
    refreshStrict();
    strictBtn.addEventListener('click', () => {
      strict = !strict;
      grid.setGridOption('enableStrictPivotColumnOrder', strict);
      refreshStrict();
    });

    const pivotBtn = document.createElement('button');
    pivotBtn.className = 'ctrl-btn primary';
    pivotBtn.setAttribute('data-testid', 'btn-pivot-toggle');
    const refreshPivot = () => {
      pivotBtn.textContent = grid.isPivotMode() ? 'Pivot: On' : 'Pivot: Off';
    };
    refreshPivot();
    pivotBtn.addEventListener('click', () => {
      grid.setPivotMode(!grid.isPivotMode());
      refreshPivot();
    });
    grid.addEventListener('pivotStateChanged', refreshPivot);

    // Cycle 18 / Task 8b — Save / Restore round-trip the full pivot
    // config (mode + columns + valueCols) through columnState +
    // PivotState. The Save button stashes a snapshot; Restore replays
    // it. Useful to demo that a Cycle 8b consumer sees the full
    // pivot state survive a round-trip.
    let savedState: { col: unknown; pivot: { pivotMode: boolean; pivotColumns: string[]; valueColumns: Array<{ colId: string; aggFunc: string }> } } | null = null;
    const saveBtn = document.createElement('button');
    saveBtn.className = 'ctrl-btn';
    saveBtn.textContent = 'Save state';
    saveBtn.setAttribute('data-testid', 'btn-save-state');
    saveBtn.addEventListener('click', () => {
      savedState = {
        col: JSON.parse(JSON.stringify(grid.getColumnState())),
        pivot: {
          pivotMode: grid.isPivotMode(),
          pivotColumns: grid.getPivotColumns(),
          valueColumns: grid.getValueColumns(),
        },
      };
    });

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'ctrl-btn';
    restoreBtn.textContent = 'Restore state';
    restoreBtn.setAttribute('data-testid', 'btn-restore-state');
    restoreBtn.addEventListener('click', () => {
      if (!savedState) return;
      grid.setPivotMode(savedState.pivot.pivotMode);
      grid.applyColumnState({ state: savedState.col as never, applyOrder: true });
    });

    // Cycle 18 / Task 8a — listen for the cap-breach event and surface
    // a small status banner above the grid so the demo demonstrates
    // the public event firing.
    const banner = document.createElement('div');
    banner.style.cssText = 'padding:4px 8px; font-size:12px; color:#a55; display:none;';
    banner.setAttribute('data-testid', 'banner-cap');
    grid.addEventListener('pivotMaxColumnsReached', (e) => {
      banner.textContent = `pivotMaxColumnsReached: ${e.generatedColumns} > cap ${e.cap}`;
      banner.style.display = 'block';
    });

    controls.appendChild(pivotBtn);
    controls.appendChild(strictBtn);
    controls.appendChild(rowTotalsBtn);
    controls.appendChild(colGroupTotalsBtn);
    controls.appendChild(grandTotalsBtn);
    controls.appendChild(saveBtn);
    controls.appendChild(restoreBtn);
    controls.appendChild(banner);

    return grid;
  },
};
