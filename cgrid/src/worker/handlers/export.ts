// Cycle 19 / Task 6 — export handler.
//
// Owns the export slice of the worker protocol:
//   exportData, getExportRows.

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest } from '../protocol';

export type ExportRequest = Extract<WorkerRequest, {
  type: 'exportData' | 'getExportRows';
}>;

export async function handleExport(
  ctx: HandlerCtx,
  req: ExportRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
  switch (req.type) {
    case 'exportData': {
      // Cycle 20 / Task 3 — walk all visible rows + serialize to the
      // requested format off the main thread.
      const { format, headerNames, types, options, selectedRowIds } = req.payload;
      const visIds = await helpers.visibleAsync();
      // Cycle 20 / Task 5 — `onlySelected: true` filters by the
      // selection set main passed in.
      const onlySelected = options.onlySelected === true;
      const selectionSet = onlySelected && selectedRowIds
        ? new Set(selectedRowIds)
        : null;
      const exportRows: Array<Record<string, unknown>> = [];
      for (const rowId of visIds) {
        if (selectionSet && !selectionSet.has(rowId)) continue;
        const data = state.store.getById(rowId);
        if (data !== undefined) exportRows.push(data as Record<string, unknown>);
      }
      const cols = state.columns.map((c) => ({
        colId: c.colId,
        field: c.field,
        headerName: headerNames[c.colId] ?? c.colId,
        type: types[c.colId] ?? 'text',
      }));
      const { writeCsv } = await import('../export/csv');
      const { writeXlsx } = await import('../export/xlsx');
      const bytes = format === 'csv'
        ? writeCsv(exportRows, cols, options as Parameters<typeof writeCsv>[2])
        : writeXlsx(exportRows, cols as Parameters<typeof writeXlsx>[1], options as Parameters<typeof writeXlsx>[2]);
      // Transfer the underlying ArrayBuffer so the post is zero-copy.
      const fits = bytes.byteOffset === 0
        && bytes.byteLength === bytes.buffer.byteLength
        && bytes.buffer instanceof ArrayBuffer;
      const buffer: ArrayBuffer = fits
        ? bytes.buffer as ArrayBuffer
        : bytes.slice().buffer as ArrayBuffer;
      post({ id: req.id, type: 'exportDataResult', format, buffer }, [buffer]);
      return;
    }

    case 'getExportRows': {
      // Cycle 20 / Task 4 — materialised visible rows for the
      // main-side serialization path.
      const { selectedRowIds: sel } = req.payload;
      const visIds = await helpers.visibleAsync();
      const selectionSet = sel ? new Set(sel) : null;
      const rows: Array<Record<string, unknown>> = [];
      for (const rowId of visIds) {
        if (selectionSet && !selectionSet.has(rowId)) continue;
        const data = state.store.getById(rowId);
        if (data !== undefined) rows.push(data as Record<string, unknown>);
      }
      post({ id: req.id, type: 'getExportRowsResult', rows });
      return;
    }
  }
}
