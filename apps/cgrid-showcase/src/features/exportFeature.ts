import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

/**
 * Cycle 20 — Export demo (CSV / Excel / process-callbacks /
 * onlySelected / domLayout 'print').
 *
 * Walks the user through the full Cycle 20 surface:
 *  - Export CSV  → triggers a browser download.
 *  - Export Excel → triggers a browser download (PK\x03\x04 XLSX).
 *  - Preview CSV → fetches the bytes and shows them in a textarea
 *    so the user can see exactly what the worker produced.
 *  - Only selected → toggle that switches every export to
 *    `onlySelected: true` (must select rows first; row selection is
 *    enabled on the grid).
 *  - With callback → toggle that wires a paren-format processCellCallback
 *    (negatives in parens, no currency) so the user can see the
 *    callback registry firing through both formats.
 *  - Print preview → sets `domLayout: 'print'`, adds the
 *    `vg-theme-print` class, calls `window.print()`, then reverts.
 *    The print dialog shows the full grid (no virtualization).
 */
export const exportFeature: Feature = {
  id: 'export',
  label: 'Export (CSV / Excel / Print)',
  description:
    'Cycle 20 export demo: CSV + Excel download, preview, processCellCallback transform, onlySelected, and domLayout: print. Select rows in the grid before clicking "Only selected" to scope the export.',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker',   cellDataType: 'text',   flex: 1 },
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     cellDataType: 'text',   flex: 1 },
        { colId: 'region',   field: 'region',   headerName: 'Region',   cellDataType: 'text',   flex: 1 },
        { colId: 'sector',   field: 'sector',   headerName: 'Sector',   cellDataType: 'text',   flex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      cellDataType: 'number', flex: 1 },
        { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', flex: 1 },
      ],
      theme,
      rowSelection: 'multiple',
      // Callback registry — `parenFormat` writes negatives as (n) and
      // strips the currency prefix. Same shape as Excel pivot output.
      exportCallbacks: {
        parenFormat: ({ value, kind }) => {
          if (kind === 'header') return value; // headers untouched
          if (value === null || value === undefined || value === '') return '';
          const n = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(n)) return value;
          const abs = Math.abs(n).toLocaleString();
          return n < 0 ? `(${abs})` : abs;
        },
      },
    });

    grid.setRowData(makeRows(60));

    // ─── Controls ──────────────────────────────────────────────────────────

    let onlySelected = false;
    let withCallback = false;

    const params = () => ({
      onlySelected,
      processCellCallback: withCallback ? 'parenFormat' : undefined,
    });

    const csvBtn = document.createElement('button');
    csvBtn.className = 'ctrl-btn primary';
    csvBtn.textContent = 'Export CSV';
    csvBtn.setAttribute('data-testid', 'btn-export-csv');
    csvBtn.addEventListener('click', () => {
      void grid.exportDataAsCsv({ fileName: 'cgrid-export.csv', ...params() });
    });

    const xlsxBtn = document.createElement('button');
    xlsxBtn.className = 'ctrl-btn primary';
    xlsxBtn.textContent = 'Export Excel';
    xlsxBtn.setAttribute('data-testid', 'btn-export-xlsx');
    xlsxBtn.addEventListener('click', () => {
      void grid.exportDataAsExcel({ fileName: 'cgrid-export.xlsx', ...params() });
    });

    const previewBtn = document.createElement('button');
    previewBtn.className = 'ctrl-btn';
    previewBtn.textContent = 'Preview CSV';
    previewBtn.setAttribute('data-testid', 'btn-preview-csv');
    previewBtn.addEventListener('click', async () => {
      const text = await grid.getDataAsCsv(params());
      preview.value = text;
      preview.style.display = 'block';
    });

    const onlySelectedBtn = document.createElement('button');
    onlySelectedBtn.className = 'ctrl-btn';
    onlySelectedBtn.setAttribute('data-testid', 'btn-only-selected');
    const refreshOnlySelected = () => {
      onlySelectedBtn.textContent = `Only selected: ${onlySelected ? 'on' : 'off'}`;
    };
    refreshOnlySelected();
    onlySelectedBtn.addEventListener('click', () => {
      onlySelected = !onlySelected;
      refreshOnlySelected();
    });

    const callbackBtn = document.createElement('button');
    callbackBtn.className = 'ctrl-btn';
    callbackBtn.setAttribute('data-testid', 'btn-callback');
    const refreshCallback = () => {
      callbackBtn.textContent = `Callback: ${withCallback ? 'parenFormat' : 'none'}`;
    };
    refreshCallback();
    callbackBtn.addEventListener('click', () => {
      withCallback = !withCallback;
      refreshCallback();
    });

    const printBtn = document.createElement('button');
    printBtn.className = 'ctrl-btn';
    printBtn.textContent = 'Print preview';
    printBtn.setAttribute('data-testid', 'btn-print');
    printBtn.addEventListener('click', () => {
      const root = gridHost.querySelector('.vg-grid') as HTMLElement | null;
      grid.setGridOption('domLayout', 'print');
      root?.classList.add('vg-theme-print');
      // Give the canvas a frame to re-materialise every row before
      // the browser snapshots for print.
      requestAnimationFrame(() => {
        window.print();
        // Revert on the next tick so the print preview captures the
        // full layout but the user returns to the virtualised view.
        setTimeout(() => {
          grid.setGridOption('domLayout', 'normal');
          root?.classList.remove('vg-theme-print');
        }, 0);
      });
    });

    const preview = document.createElement('textarea');
    preview.style.cssText = 'display:none; width:100%; height:160px; margin-top:8px; padding:8px; font-family:monospace; font-size:12px; background:rgba(127,127,127,0.06); color:inherit; border:1px solid rgba(127,127,127,0.2); border-radius:4px;';
    preview.setAttribute('data-testid', 'preview-csv');
    preview.readOnly = true;

    controls.appendChild(csvBtn);
    controls.appendChild(xlsxBtn);
    controls.appendChild(previewBtn);
    controls.appendChild(onlySelectedBtn);
    controls.appendChild(callbackBtn);
    controls.appendChild(printBtn);

    // Mount the preview below the toolbar by appending into the
    // controls strip — the showcase shell lets it grow downward.
    controls.appendChild(preview);

    return grid;
  },
};
