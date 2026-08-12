/**
 * Selection / clipboard / export facade.
 *
 * Owns focused-cell and cell-range state fan-out, the clipboard round trip
 * (copy, cut, paste, and the HTML + TSV serializers), and the CSV/Excel export
 * paths including the main-side callback route. Extracted from
 * `velocityGrid.ts` as part of splitting the god object (SPEC.md §3 module
 * boundaries — Selection/edit).
 *
 * A re-seaming, not a redesign: bodies are the legacy ones verbatim, so the
 * `rangeSelectionChanged` → `cellSelectionChanged` emission rule (the latter
 * only on `finished: true` and only when the range set actually changed, with
 * the deep-clone that stops a later in-place mutation from false-equalling the
 * snapshot) is preserved exactly, as is the worker-vs-main-side export split.
 *
 * The seam is the fat {@link SelectionHost} interface — the same `Deps`
 * pattern the ported coordinators already use.
 */

import type { VelocityGridOptions, VelocityGridEvent, SelectionRange } from '../types';
import type { ResolvedColDef } from '../core/propertyChain';
import type { Tx, TransactionResult } from '../types/api';
import type { TypedEventEmitter } from '../core/eventEmitter';
import type { ColumnTree } from '../core/columnTree';
import type { SelectionModel } from '../interaction/selectionModel';
import type { WorkerCoordinator } from '../core/workerCoordinator';
import type { PivotEngine } from '../core/pivotEngine';
import { serializeRanges as serializeRangesPure, mapPasteCells } from '../worker/passes/clipboardPass';
import { serializeToHtml, type RowExport } from '../interaction/features/clipboardSerializer';
import { buildFormatEvalCtx } from '../core/formatEvalMemo';

/** Host seam for the selection / clipboard / export cluster. */
export interface SelectionHost<TRow = any> {
  readonly destroyed: boolean;
  options: VelocityGridOptions<TRow>;
  events: TypedEventEmitter<VelocityGridEvent<TRow>>;
  selection: SelectionModel;
  workerCoord: WorkerCoordinator;
  pivotEngine: PivotEngine<TRow>;
  columnTree: ColumnTree;
  columnOrder: ResolvedColDef<TRow>[];
  columnDefsMap: Map<string, ResolvedColDef<TRow>>;

  /** Last `cellSelectionChanged` payload, for the change-suppression rule. */
  lastEmittedCellSelectionRanges: SelectionRange[];
  /** De-dupes the "clipboard paste suppressed" console warning per reason. */
  clipboardSuppressedWarned: Set<string>;

  rowIdAt(rowIndex: number): string | null;
  stringRowIdAt(rowIndex: number): string | null;
  cellAt(
    rowIndex: number,
    colId: string,
  ): { value: unknown; valueFormatted: string; flashAlpha?: number; flashColor?: string } | null;
  getSelectedRowIds(): string[];
  getThemeKind(): 'light' | 'dark';
  applyTransaction(t: Tx<TRow>): TransactionResult;
  ensureRowIndexVisible(rowIndex: number, position?: 'auto' | 'top' | 'middle' | 'bottom'): void;
  ensureColIdVisible(colId: string, position?: 'auto' | 'start' | 'middle' | 'end'): void;
}

export class SelectionFacade<TRow = any> {
  constructor(private readonly host: SelectionHost<TRow>) {}

  getFocusedCell(): { rowId: string; colId: string } | null {
    const { focusedRowIndex, focusedColId } = this.host.selection.state;
    if (focusedColId == null) return null;
    // Prefer the persistent rowId from an API-driven setFocusedCell. Falls
    // back to the synthetic id when focus came from a click — same caveat
    // as getSelectedRowIds.
    const persistent = this.host.selection.getPersistentFocusedRowId();
    if (persistent !== null) return { rowId: persistent, colId: focusedColId };
    if (focusedRowIndex == null) return null;
    const rowId = this.host.rowIdAt(focusedRowIndex);
    return rowId ? { rowId, colId: focusedColId } : null;
  }

  /** Focus the cell at (`rowId`, `colId`). Scrolls the row into view, then
   *  records both the persistent id and the paint index so subsequent re-sorts
   *  keep the focus on the same logical cell. No-op for unknown row / column.
   *  Observers see the change via `selectionChanged`. */
  setFocusedCell(rowId: string, colId: string): void {
    if (this.host.destroyed) return;
    if (!this.host.columnDefsMap.has(colId)) return;
    this.host.workerCoord.getRowIndicesForIds([rowId]).then((idx) => {
      if (this.host.destroyed) return;
      const resolved = idx.length > 0 ? idx[0]! : -1;
      if (resolved >= 0) this.host.ensureRowIndexVisible(resolved);
      this.host.ensureColIdVisible(colId);
      this.host.selection.setFocusByRowId(rowId, colId, resolved);
    }).catch((err) => { if (!this.host.destroyed) console.error('[velocity-grid] setFocusedCell:', err); });
  }

  /** Snapshot of the currently-selected cell ranges. Cycle 9 / Task 6. */
  getCellRanges(): SelectionRange[] {
    return this.host.selection.getRanges();
  }

  /** Append a range to the selection (disjoint-add). Cycle 9 / Task 6. */
  addCellRange(range: SelectionRange): void {
    if (this.host.destroyed) return;
    this.host.selection.addRange(range);
    // Programmatic mutation = instantaneous; both started + finished true.
    this.emitRangeSelectionChanged(true, true);
  }

  /** Drop every range. Row selection + focused cell unaffected.
   *  Cycle 9 / Task 6. */
  clearCellRanges(): void {
    if (this.host.destroyed) return;
    const hadRanges = this.host.selection.getRanges().length > 0;
    this.host.selection.clearRanges();
    // No emit when the call was a no-op (already empty). `started: false`
    // because a clear is the END of a selection, not the START — there's
    // no anchor to drag from.
    if (hadRanges) this.emitRangeSelectionChanged(false, true);
  }

  /** Cycle 10 / Task 3 — TSV / CSV encode the current cell-range
   *  selection on the worker and forward the result to
   *  `navigator.clipboard.writeText`. Honors the runtime-mutable
   *  `clipboardDelimiter` (default `'\t'`). Rejects with `'no-ranges'`
   *  when nothing is selected; the keyboard handler swallows that
   *  rejection so the user doesn't see a console error for a stray
   *  Ctrl+C on an empty selection.
   *
   *  Resolves AFTER `clipboard.writeText` completes (so apps that await
   *  this method can immediately read back via `clipboard.readText`).
   *  Splits the work three ways: worker does the per-cell value lookup
   *  + RFC-4180 quoting + buffer joins (off the main thread); main
   *  does the clipboard write inside the caller's user-gesture stack. */
  async copySelectedRangesToClipboard(opts?: { includeHeaders?: boolean }): Promise<void> {
    if (this.host.destroyed) return;
    // Cycle 10 / Task 6 — `suppressClipboardApi` rejects every clipboard
    // entry point before any work happens. Apps that ship their own
    // clipboard layer use this to take over without competing with the
    // worker round-trip + writeText path here. A one-time warn surfaces
    // the gate on first invocation (per method) so developers see the
    // wiring; subsequent rejections are silent.
    if (this.host.options.suppressClipboardApi === true) {
      this.warnClipboardSuppressed('copySelectedRangesToClipboard');
      throw new Error('clipboard-suppressed');
    }
    const ranges = this.getCellRanges();
    if (ranges.length === 0) throw new Error('no-ranges');
    const delimiter = this.host.options.clipboardDelimiter ?? '\t';
    // Cycle 10 / Task 5 — `processCellForClipboard` must run on the
    // main thread (apps reference DOM / domain state from the callback).
    // When the option is set, fetch the source rows here and run
    // `serializeRanges` main-side with the callback wired as
    // `transformCell`. Without the option, the worker still owns the
    // serialise hop (the perf-budgeted path).
    const transform = this.host.options.processCellForClipboard;
    // Cycle 21i / Phase 1 — under active pivot the visible cells are
    // cross-tab aggregates that live in the chunk (not in the leaf source
    // rows the worker/main-side leaf serializers read), so those paths
    // return blank cells. Serialize "what you see" via `cellAt`, which
    // resolves pivot result cells + the auto-group column + formatting.
    const body = this.host.pivotEngine.isPivotActive()
      ? this.serializeRangesViaCellAt(ranges, delimiter, transform)
      : transform
        ? await this.serializeRangesMainSide(ranges, delimiter, transform)
        : await this.host.workerCoord.clipboardSerialize(ranges, delimiter);
    // Cycle 21i / Phase 1 — "Copy with Headers" prepends a header row of
    // the selected columns' header names (in column order), delimiter- and
    // newline-joined to match the body TSV.
    const tsv = opts?.includeHeaders
      ? `${this.clipboardHeaderLine(ranges, delimiter)}\n${body}`
      : body;
    // `navigator.clipboard.writeText` requires a user gesture in every
    // mainstream browser; the keyboard / menu handlers already run
    // inside one. Apps that invoke this from a `setTimeout` get a
    // rejected promise back — that's the expected platform behavior.
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      throw new Error('clipboard-unavailable');
    }
    // Cycle 21c / Task 15 — multi-format write when the copied range
    // touches a composite column. text/plain stays byte-identical to
    // the plain path (the worker/main-side TSV above); text/html adds
    // styled <span> runs per composite fragment so Excel / Sheets
    // paste keeps the formatting. Feature-detected: environments
    // without ClipboardItem / clipboard.write fall back to writeText.
    const hasComposite = ranges.some((range) =>
      range.colIds.some((colId) => this.host.columnDefsMap.get(colId)?._compositeProgram !== undefined),
    );
    if (hasComposite) {
      const clip = navigator.clipboard as Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> };
      if (typeof ClipboardItem !== 'undefined' && typeof clip.write === 'function') {
        const html = await this.serializeRangesToHtml(ranges, opts?.includeHeaders === true);
        const item = new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        });
        await clip.write([item]);
        return;
      }
      console.debug('[cgrid.clipboard] rich copy unavailable, using plain text');
    }
    await navigator.clipboard.writeText(tsv);
  }

  /** Cycle 21i / Phase 1 — serialize ranges from the painter's own cell
   *  resolver (`cellAt`), so pivot cross-tab cells, group/auto-group
   *  cells, and totals serialize as their displayed value. Reuses the
   *  pure serializer by projecting each cell's value onto a per-row
   *  object keyed by colId (field === colId). Cells outside the loaded
   *  chunk resolve to '' (the pivot matrix is small and typically fully
   *  loaded). `transform` (processCellForClipboard) still applies. */
  serializeRangesViaCellAt(
    ranges: SelectionRange[],
    delimiter: string,
    transform: VelocityGridOptions<TRow>['processCellForClipboard'],
  ): string {
    const rows: Array<Record<string, unknown> | undefined> = [];
    const colIds = new Set<string>();
    for (const range of ranges) {
      for (const id of range.colIds) colIds.add(id);
      for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex++) {
        if (rows[rowIndex] !== undefined) continue;
        const obj: Record<string, unknown> = {};
        for (const id of range.colIds) {
          const cell = this.host.cellAt(rowIndex, id);
          // Primitive value (pivot aggregate number, plain text) copies
          // raw so it pastes as a number; the auto-group / group cells
          // carry an object value whose label lives in valueFormatted.
          obj[id] = cell == null
            ? ''
            : (cell.value !== null && typeof cell.value === 'object'
                ? cell.valueFormatted
                : cell.value);
        }
        rows[rowIndex] = obj;
      }
    }
    const columnsById = new Map<string, { field?: string }>();
    for (const id of colIds) columnsById.set(id, { field: id });
    return serializeRangesPure(rows, columnsById, ranges, delimiter, transform
      ? (params) => transform({
          value: params.value,
          node: { rowIndex: params.node.rowIndex, data: params.node.data as TRow },
          column: { colId: params.column.colId },
        })
      : undefined);
  }

  /** Cycle 21i / Phase 1 — the header row for "Copy with Headers": the
   *  distinct column headerNames touched by `ranges`, ordered by the
   *  grid's column order, joined by `delimiter`. */
  clipboardHeaderLine(ranges: SelectionRange[], delimiter: string): string {
    const orderIdx = new Map(this.host.columnOrder.map((c, i) => [c.colId, i]));
    const ids = [...new Set(ranges.flatMap((r) => r.colIds))].sort(
      (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
    );
    return ids
      .map((id) => this.host.columnDefsMap.get(id)?.headerName ?? id)
      .join(delimiter);
  }

  /** Cycle 21c / Task 15 — build the text/html clipboard flavor for
   *  ranges that include composite columns. Fetches the touched rows
   *  main-side (composite programs are main-thread closures — they
   *  don't cross postMessage), resolves fragments per composite cell,
   *  and falls back to formatted plain text for regular columns. */
  async serializeRangesToHtml(ranges: SelectionRange[], includeHeaders = false): Promise<string> {
    const rowIndexSet = new Set<number>();
    for (const range of ranges) {
      for (let i = range.rowStart; i <= range.rowEnd; i++) rowIndexSet.add(i);
    }
    const indexArr = Array.from(rowIndexSet);
    const fetched = await Promise.all(indexArr.map((rowIndex) =>
      this.host.workerCoord.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
    ));
    if (this.host.destroyed) return '';
    const rowsByIndex = new Map<number, Record<string, unknown>>();
    for (const r of fetched) {
      if (r.data != null) rowsByIndex.set(r.rowIndex, r.data as Record<string, unknown>);
    }

    const out: RowExport[] = [];
    for (const range of ranges) {
      for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex++) {
        const rowData = rowsByIndex.get(rowIndex) ?? {};
        const cells: RowExport['cells'] = [];
        for (const colId of range.colIds) {
          const def = this.host.columnDefsMap.get(colId);
          if (!def) {
            cells.push({ text: '' });
            continue;
          }
          const value = rowData[(def.field as string | undefined) ?? colId];
          const program = def._compositeProgram;
          if (program) {
            // Cycle 21e / final-review fix — rule-aware ctx so copied
            // composite fragments carry resolved rule:<ruleId> colors,
            // matching what the painter shows.
            const evalCtx = buildFormatEvalCtx({
              value,
              data: rowData,
              colId,
              rowId: this.host.stringRowIdAt(rowIndex) ?? undefined,
              themeKind: this.host.getThemeKind(),
            });
            const fragments = program.resolveFragments(evalCtx);
            cells.push({
              text: program.formatText(evalCtx),
              fragments: (fragments ?? []).map((f) => ({
                text: f.text,
                style: (f.style ?? {}) as Record<string, string | number | undefined>,
              })),
            });
            continue;
          }
          const text = def.valueFormatter
            ? def.valueFormatter({ value, data: rowData as TRow, colId })
            : value == null ? '' : String(value);
          cells.push({ text });
        }
        out.push({ cells });
      }
    }
    if (includeHeaders) {
      const orderIdx = new Map(this.host.columnOrder.map((c, i) => [c.colId, i]));
      const ids = [...new Set(ranges.flatMap((r) => r.colIds))].sort(
        (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
      );
      out.unshift({
        cells: ids.map((id) => ({ text: this.host.columnDefsMap.get(id)?.headerName ?? id })),
      });
    }
    return serializeToHtml(out);
  }

  // ─── Cycle 20 / Task 3 — public export API ────────────────────────────

  /** Build the per-column metadata maps the worker needs (header
   *  names + type hints by colId). The worker doesn't keep its own
   *  copy of headerName / type, so we resolve here and ship. */
  buildExportColumnMaps(): { headerNames: Record<string, string>; types: Record<string, 'text' | 'number'> } {
    const headerNames: Record<string, string> = {};
    const types: Record<string, 'text' | 'number'> = {};
    for (const leaf of this.host.columnTree.leaves) {
      headerNames[leaf.colId] = leaf.headerName ?? leaf.colId;
      // `cellDataType` is the canonical type hint on the resolved
      // column. Anything non-'number' falls back to 'text' in the
      // writer (numeric XLSX columns get `<c t="n">`).
      types[leaf.colId] = leaf.cellDataType === 'number' ? 'number' : 'text';
    }
    return { headerNames, types };
  }

  /** Resolve which export route to use. When any `process*Callback`
   *  is referenced, we fetch rows back to main and run the writer
   *  there so the callbacks (which can't postMessage to the worker)
   *  can fire. Otherwise we keep the worker-side fast path. */
  hasExportCallback(params: ExportCsvParams | ExportExcelParams): boolean {
    return Boolean(
      (params as ExportCsvParams).processCellCallback
      || (params as ExportCsvParams).processHeaderCallback,
    );
  }

  /** Apply the resolved cell/header callbacks main-side and serialise
   *  through the matching writer. Returns the bytes. */
  async exportViaMainSide(
    format: 'csv' | 'xlsx',
    params: ExportCsvParams | ExportExcelParams,
  ): Promise<Uint8Array> {
    const { headerNames, types } = this.buildExportColumnMaps();
    const callbacks = this.host.options.exportCallbacks ?? {};
    const cellCb = callbacks[(params as ExportCsvParams).processCellCallback ?? ''];
    const headerCb = callbacks[(params as ExportCsvParams).processHeaderCallback ?? ''];
    const rows = await this.host.workerCoord.getExportRows({
      selectedRowIds: params.onlySelected ? this.host.getSelectedRowIds() : undefined,
    });

    // Build column list, mapping each header through `headerCb` once.
    const cols = this.host.columnTree.leaves.map((leaf) => ({
      colId: leaf.colId,
      field: (leaf as { field?: string }).field ?? leaf.colId,
      headerName: headerCb
        ? String(headerCb({
            value: headerNames[leaf.colId] ?? leaf.colId,
            colId: leaf.colId,
            kind: 'header' as const,
          }))
        : (headerNames[leaf.colId] ?? leaf.colId),
      type: types[leaf.colId] ?? 'text' as const,
    }));

    // Transform per-cell when `cellCb` is configured. We mutate a
    // fresh copy per row so the worker's row store isn't disturbed.
    const transformedRows = cellCb
      ? rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const c of cols) {
            out[c.field] = cellCb({
              value: row[c.field],
              colId: c.colId,
              kind: 'cell',
              node: row,
            });
          }
          return out;
        })
      : rows;

    if (format === 'csv') {
      const { writeCsv } = await import('../worker/export/csv');
      return writeCsv(transformedRows, cols, params as ExportCsvParams);
    }
    const { writeXlsx } = await import('../worker/export/xlsx');
    return writeXlsx(transformedRows, cols, params as ExportExcelParams);
  }

  /** Return the current data as a CSV string. Worker-side serialization
   *  when no callback is set; main-side serialization when one is. */
  async getDataAsCsv(params: ExportCsvParams = {}): Promise<string> {
    if (this.host.destroyed) return '';
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('csv', params);
      return new TextDecoder('utf-8').decode(bytes);
    }
    const { headerNames, types } = this.buildExportColumnMaps();
    const buffer = await this.host.workerCoord.exportData({
      format: 'csv',
      headerNames,
      types,
      options: params as unknown as Record<string, unknown>,
      selectedRowIds: params.onlySelected ? this.host.getSelectedRowIds() : undefined,
    });
    return new TextDecoder('utf-8').decode(buffer);
  }

  /** Export the current data as CSV + trigger a browser download. */
  async exportDataAsCsv(params: ExportCsvParams = {}): Promise<void> {
    if (this.host.destroyed) return;
    let buffer: ArrayBuffer;
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('csv', params);
      // Copy out of the writer's possibly-shared scratch into an owned ArrayBuffer.
      buffer = bytes.slice().buffer as ArrayBuffer;
    } else {
      const { headerNames, types } = this.buildExportColumnMaps();
      buffer = await this.host.workerCoord.exportData({
        format: 'csv',
        headerNames,
        types,
        options: params as unknown as Record<string, unknown>,
      });
    }
    triggerDownload(buffer, params.fileName ?? 'export.csv', 'text/csv;charset=utf-8');
  }

  /** Return the current data as an XLSX `Blob`. */
  async getDataAsExcel(params: ExportExcelParams = {}): Promise<Blob> {
    if (this.host.destroyed) return new Blob([]);
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('xlsx', params);
      return new Blob([bytes.slice().buffer as ArrayBuffer], { type: XLSX_MIME });
    }
    const { headerNames, types } = this.buildExportColumnMaps();
    const buffer = await this.host.workerCoord.exportData({
      format: 'xlsx',
      headerNames,
      types,
      options: params as unknown as Record<string, unknown>,
      selectedRowIds: params.onlySelected ? this.host.getSelectedRowIds() : undefined,
    });
    return new Blob([buffer], { type: XLSX_MIME });
  }

  /** Export the current data as XLSX + trigger a browser download. */
  async exportDataAsExcel(params: ExportExcelParams = {}): Promise<void> {
    if (this.host.destroyed) return;
    let buffer: ArrayBuffer;
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('xlsx', params);
      buffer = bytes.slice().buffer as ArrayBuffer;
    } else {
      const { headerNames, types } = this.buildExportColumnMaps();
      buffer = await this.host.workerCoord.exportData({
        format: 'xlsx',
        headerNames,
        types,
        options: params as unknown as Record<string, unknown>,
      });
    }
    triggerDownload(buffer, params.fileName ?? 'export.xlsx', XLSX_MIME);
  }

  /** Cycle 10 / Task 5 — main-side serialise used when
   *  `processCellForClipboard` is configured. Batches `getRowByIndex`
   *  for every unique row in `ranges` so the callback sees the row's
   *  current `data` (matches ag-grid). Wraps the user callback in the
   *  `SerializeCellTransform` shape (`{ value, node, column }`) and
   *  hands off to the same pure `serializeRanges` the worker uses, so
   *  RFC-4180 quoting + delimiter + disjoint-range layout stay in
   *  exactly one place. */
  async serializeRangesMainSide(
    ranges: SelectionRange[],
    delimiter: string,
    transform: NonNullable<VelocityGridOptions<TRow>['processCellForClipboard']>,
  ): Promise<string> {
    // Collect every visible row index touched by any range; batch-fetch
    // the rows in one Promise.all to keep the worker round-trips parallel.
    const rowIndexSet = new Set<number>();
    for (const range of ranges) {
      for (let i = range.rowStart; i <= range.rowEnd; i++) rowIndexSet.add(i);
    }
    const indexArr = Array.from(rowIndexSet);
    const fetched = await Promise.all(indexArr.map((rowIndex) =>
      this.host.workerCoord.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
    ));
    if (this.host.destroyed) return '';
    // Build the sparse `rows` array `serializeRanges` consumes — keyed
    // by visible-row index, with `undefined` for rows past the bottom
    // (the pure function treats those as a row of blank cells).
    const rows: Array<Record<string, unknown> | undefined> = [];
    for (const r of fetched) {
      if (r.data != null) rows[r.rowIndex] = r.data as Record<string, unknown>;
    }
    const columnsById = new Map<string, { field?: string }>();
    for (const def of this.host.columnOrder) {
      columnsById.set(def.colId, { field: def.field as string | undefined });
    }
    return serializeRangesPure(rows, columnsById, ranges, delimiter, (params) =>
      transform({
        value: params.value,
        node: { rowIndex: params.node.rowIndex, data: params.node.data as TRow },
        column: { colId: params.column.colId },
      }),
    );
  }

  /** Cycle 10 / Task 4 — read the system clipboard, parse the payload on
   *  the worker, and apply via `applyTransaction({ update })` rooted at
   *  the focused cell. Resolves quietly (no throw) when the paste is a
   *  semantic no-op:
   *  - no cell is focused
   *  - clipboard is empty
   *  - parsed grid covers no rows / cells
   *
   *  Rejects when `navigator.clipboard.readText` rejects (no gesture,
   *  permission denied, insecure context without a polyfill).
   *
   *  Anchor algorithm: the parsed `string[][]` is positioned with its
   *  (0, 0) cell at the focused cell. For each parsed row `r` we
   *  resolve the target row at visible index `focusedRowIndex + r`
   *  (via `workerClient.getRowByIndex`, mirroring Cycle 9 / Task 5's
   *  fill handle); for each parsed cell `c` we write into the visible
   *  column at index `focusedColIndex + c` in `this.columnOrder`. Rows
   *  past the bottom or columns past the right edge are silently
   *  dropped — paste never inserts rows / columns. */
  async pasteFromClipboard(): Promise<void> {
    if (this.host.destroyed) return;
    // Cycle 10 / Task 6 — `suppressClipboardApi` rejects (apps own the
    // surface); `suppressClipboardPaste` silently no-ops (paste is
    // disabled but copy / cut still work). API wins over paste-only —
    // an app gating both still gets the clearer rejection.
    if (this.host.options.suppressClipboardApi === true) {
      this.warnClipboardSuppressed('pasteFromClipboard');
      throw new Error('clipboard-suppressed');
    }
    if (this.host.options.suppressClipboardPaste === true) return;
    const focusedRowIndex = this.host.selection.state.focusedRowIndex;
    const focusedColId = this.host.selection.state.focusedColId;
    if (focusedRowIndex === null || focusedColId === null) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      throw new Error('clipboard-unavailable');
    }
    const text = await navigator.clipboard.readText();
    if (text === '') return;
    const delimiter = this.host.options.clipboardDelimiter ?? '\t';
    const parsed = await this.host.workerCoord.clipboardDeserialize(text, delimiter);
    if (parsed.length === 0) return;
    // Resolve the focused column's render-order index. When the focused
    // column has been hidden between the focus event and the paste,
    // we drop back to "no anchor" → no-op.
    const focusedColIdx = this.host.columnOrder.findIndex((c) => c.colId === focusedColId);
    if (focusedColIdx === -1) return;
    // Fetch every target row via the worker so the update set ships full
    // TRow objects (RowStore.apply REPLACES rows by id; the unchanged
    // fields must be present on the update payload). Off-bottom rows
    // (rowIndex >= rowCount) skip — the worker returns rowId === null.
    const targetRowIndices: number[] = [];
    for (let r = 0; r < parsed.length; r++) targetRowIndices.push(focusedRowIndex + r);
    const fetches = targetRowIndices.map((rowIndex) =>
      this.host.workerCoord.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
    );
    const results = await Promise.all(fetches);
    if (this.host.destroyed) return;
    // Cycle 10 / Task 5 — `processCellFromClipboard` transforms each
    // parsed string AFTER worker parse + BEFORE the per-cell write. Runs
    // on the main thread for the same reason copy's transform does. We
    // pre-compute the transformed values via the pure `mapPasteCells`
    // helper so the loop below is a straight write per cell. Without the
    // option, `transformedRows` is `null` and we use the raw parsed
    // strings — keeps the no-callback path allocation-free.
    const transform = this.host.options.processCellFromClipboard;
    let transformedRows: Array<Array<unknown>> | null = null;
    if (transform) {
      const rowDataByIndex = new Map<number, unknown>();
      for (const r of results) {
        if (r.fetched.data != null) rowDataByIndex.set(r.rowIndex, r.fetched.data);
      }
      const visibleColIds = this.host.columnOrder.map((c) => c.colId);
      transformedRows = mapPasteCells(
        parsed,
        focusedRowIndex,
        focusedColIdx,
        visibleColIds,
        rowDataByIndex,
        (params) => transform({
          value: params.value,
          node: { rowIndex: params.node.rowIndex, data: params.node.data as TRow },
          column: { colId: params.column.colId },
        }),
      );
    }
    const updates: TRow[] = [];
    for (let i = 0; i < results.length; i++) {
      const fetched = results[i]!.fetched;
      if (!fetched.rowId || fetched.data == null) continue;
      const rowData = fetched.data as Record<string, unknown>;
      const parsedRow = parsed[i]!;
      const transformedRow = transformedRows?.[i];
      for (let c = 0; c < parsedRow.length; c++) {
        const targetColIdx = focusedColIdx + c;
        if (targetColIdx >= this.host.columnOrder.length) break;
        const def = this.host.columnOrder[targetColIdx]!;
        const newValue: unknown = transformedRow !== undefined
          ? transformedRow[c]
          : parsedRow[c]!;
        if (def.valueSetter) {
          const field = def.field as string | undefined;
          const oldValue = field !== undefined ? rowData[field] : undefined;
          def.valueSetter({
            data: rowData as TRow, newValue, oldValue, colDef: def as any,
          });
        } else if (def.field) {
          rowData[def.field as string] = newValue;
        }
      }
      updates.push(rowData as TRow);
    }
    if (updates.length === 0) return;
    this.host.applyTransaction({ update: updates });
  }

  /** Cycle 10 / Task 5 — copy the current ranges to the system clipboard
   *  and clear the source cells in a single follow-up transaction.
   *  Atomicity: the copy fires first; only when its `writeText` resolves
   *  does the clear `applyTransaction({ update })` follow. If copy
   *  rejects (no ranges, clipboard unavailable, permission denied), the
   *  source cells stay untouched — there is no partial-cut state.
   *
   *  Cleared cells go through `valueSetter` when the column defines one
   *  (so apps with rich coercion see the empty string), falling back to
   *  a direct field assignment of `''`. Rows touched by multiple ranges
   *  are merged into one update entry per rowId so `applyTransaction`
   *  sees each row at most once. */
  async cutSelectedRanges(): Promise<void> {
    if (this.host.destroyed) return;
    // Cycle 10 / Task 6 — gate FIRST so the rejection error message is
    // `clipboard-suppressed` (clearer than the downstream rejection
    // `copySelectedRangesToClipboard` would emit with the same flag).
    // The dedup logic on `warnClipboardSuppressed` keeps the console
    // quiet when both paths fire back-to-back from a Ctrl+X loop.
    if (this.host.options.suppressClipboardApi === true) {
      this.warnClipboardSuppressed('cutSelectedRanges');
      throw new Error('clipboard-suppressed');
    }
    const ranges = this.getCellRanges();
    if (ranges.length === 0) throw new Error('no-ranges');
    // Copy first — atomicity hinges on this resolving before we touch
    // the data. Any rejection (`no-ranges`, `clipboard-unavailable`,
    // browser permission denial) propagates and the clear never fires.
    await this.copySelectedRangesToClipboard();
    if (this.host.destroyed) return;
    // Build the union of (rowIndex) across every range, fetch each row
    // once, and apply the clear in a single transaction. Multiple
    // ranges hitting the same row + different cols share the same row
    // object so the column-iteration step accumulates cleared fields.
    const rowIndexSet = new Set<number>();
    for (const range of ranges) {
      for (let i = range.rowStart; i <= range.rowEnd; i++) rowIndexSet.add(i);
    }
    const indexArr = Array.from(rowIndexSet);
    const fetched = await Promise.all(indexArr.map((rowIndex) =>
      this.host.workerCoord.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
    ));
    if (this.host.destroyed) return;
    const byIndex = new Map<number, { rowId: string | null; data: unknown | null }>();
    for (const r of fetched) byIndex.set(r.rowIndex, { rowId: r.rowId, data: r.data });
    const updatesByRowId = new Map<string, TRow>();
    for (const range of ranges) {
      for (let ri = range.rowStart; ri <= range.rowEnd; ri++) {
        const entry = byIndex.get(ri);
        if (!entry || !entry.rowId || entry.data == null) continue;
        // Reuse the already-mutated rowData for ranges that touch the
        // same row — cleared fields accumulate across iterations.
        const existing = updatesByRowId.get(entry.rowId);
        const rowData = (existing ?? entry.data) as Record<string, unknown>;
        for (const colId of range.colIds) {
          const def = this.host.columnDefsMap.get(colId);
          if (!def) continue;
          if (def.valueSetter) {
            const field = def.field as string | undefined;
            const oldValue = field !== undefined ? rowData[field] : undefined;
            def.valueSetter({
              data: rowData as TRow, newValue: '', oldValue, colDef: def as any,
            });
          } else if (def.field) {
            rowData[def.field as string] = '';
          }
        }
        updatesByRowId.set(entry.rowId, rowData as TRow);
      }
    }
    if (updatesByRowId.size === 0) return;
    this.host.applyTransaction({ update: Array.from(updatesByRowId.values()) });
  }

  /** Cycle 10 / Task 6 — resolved `suppressClipboardPaste`. Reads the
   *  option live so a runtime `setGridOption('suppressClipboardPaste',
   *  true)` shows up immediately. Mirrors the boolean shape on
   *  `DefaultMenuGrid`. */
  isClipboardPasteSuppressed(): boolean {
    return this.host.options.suppressClipboardPaste === true;
  }

  /** Cycle 10 / Task 6 — emit a one-time `console.warn` per clipboard
   *  API method gated by `suppressClipboardApi`. Subsequent rejections
   *  from the same method stay silent so a Ctrl+C polling loop or a
   *  retry handler doesn't flood the console. */
  warnClipboardSuppressed(method: string): void {
    if (this.host.clipboardSuppressedWarned.has(method)) return;
    this.host.clipboardSuppressedWarned.add(method);
    console.warn(`[velocity-grid] ${method} suppressed by suppressClipboardApi`);
  }

  /** Cycle 9 / Task 7 — fan `rangeSelectionChanged` out to listeners and
   *  drive the `cellSelectionChanged` debounce. Called from feature code
   *  (RangeSelection / FillHandle) at gesture start / mid / end, and from
   *  the programmatic mutation paths (`addCellRange`, `clearCellRanges`,
   *  `selectColumn`). The ranges snapshot is fresh on every call so
   *  listeners that retain the payload don't see later mutations.
   *  `cellSelectionChanged` fires only when `finished: true` AND the
   *  range set is actually different from the last finished emission. */
  emitRangeSelectionChanged(started: boolean, finished: boolean): void {
    if (this.host.destroyed) return;
    const ranges = this.host.selection.getRanges();
    this.host.events.emit({ type: 'rangeSelectionChanged', ranges, started, finished });
    if (!finished) return;
    if (rangesEqual(ranges, this.host.lastEmittedCellSelectionRanges)) return;
    // Deep-clone so a later in-place mutation on the SelectionModel can't
    // false-equal the snapshot and silently suppress a future event.
    this.host.lastEmittedCellSelectionRanges = ranges.map((r) => ({
      rowStart: r.rowStart,
      rowEnd: r.rowEnd,
      colIds: r.colIds.slice(),
    }));
    this.host.events.emit({ type: 'cellSelectionChanged', ranges: this.host.selection.getRanges() });
  }
}

// ─── Cycle 20 / Task 3 — export support ─────────────────────────────────────

/** Caller-facing CSV export params. Mirrors AG-Grid's
 *  `CsvExportParams` for the subset the worker writer respects. */
export interface ExportCsvParams {
  fileName?: string;
  columnSeparator?: string;
  columnKeys?: string[];
  skipColumnHeaders?: boolean;
  suppressQuotes?: boolean;
  withBOM?: boolean;
  prependContent?: string;
  appendContent?: string;
  /** Name of an `exportCallbacks` entry to transform each cell. */
  processCellCallback?: string;
  /** Name of an `exportCallbacks` entry to transform each header. */
  processHeaderCallback?: string;
  /** Cycle 20 / Task 5 — limit the export to currently-selected rows. */
  onlySelected?: boolean;
}

/** Caller-facing XLSX export params. */
export interface ExportExcelParams {
  fileName?: string;
  sheetName?: string;
  columnKeys?: string[];
  skipColumnHeaders?: boolean;
  freezeRows?: number;
  freezeColumns?: number;
  author?: string;
  processCellCallback?: string;
  processHeaderCallback?: string;
  /** Cycle 20 / Task 5 — limit the export to currently-selected rows. */
  onlySelected?: boolean;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Trigger a browser download for an ArrayBuffer. Builds a Blob,
 *  creates an object-URL, dispatches an anchor click, then revokes
 *  the URL on a microtask so the browser has time to start the
 *  download before we drop the handle. */
function triggerDownload(buffer: ArrayBuffer, fileName: string, mime: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke once the browser has had a chance to fetch the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Structural compare for two range lists. Used by Cycle 9 / Task 7 to
 *  debounce `cellSelectionChanged` — a finished `rangeSelectionChanged`
 *  that lands on the same set as before skips the cell event. */
function rangesEqual(a: SelectionRange[], b: SelectionRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.rowStart !== y.rowStart || x.rowEnd !== y.rowEnd) return false;
    if (x.colIds.length !== y.colIds.length) return false;
    for (let j = 0; j < x.colIds.length; j++) {
      if (x.colIds[j] !== y.colIds[j]) return false;
    }
  }
  return true;
}
