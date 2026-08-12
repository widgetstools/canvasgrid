import { ClientSideRowModel } from './csrm/clientSideRowModel';
import { AsyncTransactionQueue } from './csrm/asyncTransactions';
import { ColumnModel } from './columns/columnModel';
import { GroupPivotCoordinator } from './groupPivot/coordinator';
import { CanvasPainter } from './paint/canvasPainter';
import { EnginesController } from './engines/enginesController';
import { SelectionModel } from './selection/selectionModel';
import { buildSsrmColumnKeys } from './ssrm/columnKeys';
import { ServerSideRowModel } from './ssrm/serverSideRowModel';
import type { VelocityGridApi } from './api/facade';
import type {
  SortModel,
  VelocityGridOptions,
} from './types/options';
import type { IServerSideDatasourceV2 } from './ssrm/types';
import type {
  AlertRule,
  CalcColumn,
  EditOp,
  FormatPatch,
  StyleRule,
} from '@wellsfargo-starui/vg-new-engines';

/**
 * VelocityGrid (greenfield) — ApiFacade over CSRM / SSRM + canvas paint.
 */
export class VelocityGrid<T extends Record<string, unknown> = Record<string, unknown>> {
  private destroyed = false;
  private readonly root: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLElement;
  private readonly columns = new ColumnModel<T>();
  private colDefs: import('./types/options').ColDef<T>[] = [];
  private readonly selection: SelectionModel;
  private scrollTop = 0;
  private scrollLeft = 0;
  private scrolling = false;
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
  private quickFilterText = '';
  private rowModelType: 'clientSide' | 'serverSide';
  private clientPipeline: boolean;
  private ssrmRows: T[] = [];
  private ssrmRowCount = 0;
  private readonly getRowId: (row: T) => string;
  private readonly csrm: ClientSideRowModel<T>;
  private readonly ssrm: ServerSideRowModel<T>;
  private readonly groupPivot: GroupPivotCoordinator;
  private readonly painter: CanvasPainter;
  private readonly engines: EnginesController;
  private readonly options: VelocityGridOptions<T>;
  private readonly asyncTx: AsyncTransactionQueue<T>;
  private raf = 0;
  private readonly api: VelocityGridApi<T>;
  private editorEl: HTMLInputElement | null = null;

  constructor(host: HTMLElement, options: VelocityGridOptions<T>) {
    this.options = options;
    this.rowModelType = options.rowModelType ?? 'clientSide';
    this.clientPipeline = options.serverSideEnableClientSidePipeline === true;
    this.getRowId = options.getRowId
      ?? ((r: T) => String((r as { id?: string }).id ?? JSON.stringify(r)));

    this.root = document.createElement('div');
    this.root.className = 'vg-new-grid';
    this.root.style.cssText = 'position:relative;width:100%;height:100%;min-height:0;flex:1;overflow:hidden;font-family:"IBM Plex Sans",system-ui,sans-serif;background:var(--vgn-bg,#fff);';
    // Ensure flex hosts (Ext shell grid slot) actually size the grid.
    if (getComputedStyle(host).display.includes('flex') || host.dataset.slot === 'grid') {
      host.style.minHeight = host.style.minHeight || '0';
      host.style.height = host.style.height || '100%';
    }
    host.appendChild(this.root);

    this.wrap = document.createElement('div');
    this.wrap.style.cssText = 'position:absolute;inset:0;overflow:auto;';
    this.root.appendChild(this.wrap);

    this.scroller = document.createElement('div');
    this.wrap.appendChild(this.scroller);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:sticky;top:0;left:0;width:100%;height:100%;display:block;pointer-events:none;';
    this.wrap.appendChild(this.canvas);

    const rowHeight = options.rowHeight ?? 28;
    const headerHeight = options.headerHeight ?? 32;
    this.painter = new CanvasPainter(this.canvas, {
      rowHeight,
      headerHeight,
      theme: options.theme ?? 'light',
      getRowId: (r) => this.getRowId(r as T),
    });

    this.colDefs = [...(options.columnDefs ?? [])];
    this.columns.setColumnDefs(this.colDefs);
    this.csrm = new ClientSideRowModel(this.getRowId, () => this.colDefs);
    this.engines = new EnginesController({
      onAlert: (ev) => {
        this.options.onAlert?.(ev);
      },
    });
    this.selection = new SelectionModel((groupKey) => {
      if (this.rowModelType === 'serverSide') {
        // Sparse path — async getGroupLeafIds; sync cascade uses CSRM helper when available.
        return this.csrm.getDescendantRowIds(groupKey);
      }
      return this.csrm.getDescendantRowIds(groupKey);
    });

    this.groupPivot = new GroupPivotCoordinator({
      isSparseSsrm: () => this.isSparseSsrm(),
      onStructureChanged: () => {
        if (this.rowModelType === 'serverSide') void this.ssrm.refresh({ purge: true });
        else {
          this.csrm.setRowGroupColumns(this.groupPivot.getRowGroupColumns());
          this.schedulePaint();
        }
        this.options.onModelUpdated?.();
      },
      onExpansionChanged: () => {
        // CSRM owns expansion locally; coordinator drives sparse SSRM only.
        if (this.rowModelType === 'serverSide') void this.ssrm.refreshExpansion();
        else this.schedulePaint();
        this.options.onModelUpdated?.();
      },
    });

    this.ssrm = new ServerSideRowModel<T>({
      getRowId: this.getRowId,
      isDestroyed: () => this.destroyed,
      getRowGroupCols: () => this.groupPivot.getRowGroupColumns(),
      getExpandedGroupKeys: () => this.groupPivot.getExpandedGroupKeys(),
      getSortModel: () => this.csrm.getSortModel(),
      getFilterModel: () => this.csrm.getFilterModel() as Record<string, unknown>,
      getQuickFilterText: () => this.quickFilterText,
      getColumnKeys: () => {
        const vis = this.columns.getVisible().map((c) => c.colId);
        return buildSsrmColumnKeys({
          visibleColIds: vis,
          rowIdField: options.rowIdField ?? 'id',
          sortColIds: this.csrm.getSortModel().map((s) => s.colId),
          rowGroupColIds: this.groupPivot.getRowGroupColumns(),
          expressionOutputIds: this.engines.getSsrmExpressionOutputs(),
        });
      },
      getRefreshRange: () => {
        const rh = this.options.rowHeight ?? 28;
        const start = Math.floor(this.scrollTop / rh);
        const end = start + Math.ceil(this.wrap.clientHeight / rh) + 5;
        return { rowStart: start, rowEnd: Math.max(start + 1, end) };
      },
      setRowCount: (count) => {
        this.ssrmRowCount = count;
        this.schedulePaint();
      },
      setGroupKeys: (keys) => {
        this.groupPivot.setKnownGroupKeys(keys);
      },
      requestViewport: () => this.schedulePaint(),
      isSparse: () => this.isSparseSsrm(),
      wantsClientPipeline: () => this.clientPipeline,
      hydrateWindow: (start, rows, rowCount, replace) => {
        if (replace) {
          this.ssrmRows = rows.slice();
        } else {
          const next = this.ssrmRows.slice();
          // Grow sparse array to cover hydrate window.
          if (next.length < start + rows.length) next.length = start + rows.length;
          for (let i = 0; i < rows.length; i++) next[start + i] = rows[i]!;
          this.ssrmRows = next;
        }
        this.ssrmRowCount = rowCount;
        this.schedulePaint();
      },
    }, {
      cacheBlockSize: options.cacheBlockSize,
      rowIdField: options.rowIdField ?? 'id',
    });

    this.asyncTx = new AsyncTransactionQueue<T>({
      conflate: options.asyncTransactionConflate !== false,
      deferWhileScrolling: options.deferAsyncTransactionsWhileScrolling === true,
      waitMillis: options.asyncTransactionWaitMillis ?? 50,
      getRowId: this.getRowId,
      isScrolling: () => this.scrolling,
      apply: (tx) => {
        this.csrm.applyTransaction(tx);
        const ids = (tx.update ?? []).map((r) => this.getRowId(r));
        if (ids.length) this.painter.flashCells(ids);
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
    });

    if (options.rowData) this.csrm.setRowData(options.rowData);
    if (options.serverSideDatasource) {
      this.ssrm.setDatasource(options.serverSideDatasource as IServerSideDatasourceV2<T>);
    }

    this.api = this.buildApi();
    this.wireEvents(rowHeight, headerHeight);
    this.schedulePaint();
    queueMicrotask(() => options.onGridReady?.(this.api));
  }

  getApi(): VelocityGridApi<T> {
    return this.api;
  }

  private isSparseSsrm(): boolean {
    return this.rowModelType === 'serverSide' && !this.clientPipeline;
  }

  private buildApi(): VelocityGridApi<T> {
    return {
      setColumnDefs: (defs) => {
        this.colDefs = [...defs] as import('./types/options').ColDef<T>[];
        this.columns.setColumnDefs(this.colDefs);
        this.schedulePaint();
      },
      getColumnState: () => this.columns.getAll().map((c) => ({
        colId: c.colId,
        hide: c.hide,
        width: c.width,
        pinned: c.pinned,
        headerName: c.headerName,
      })),
      applyColumnState: (state) => {
        this.columns.applyState(state);
        this.schedulePaint();
      },
      setRowData: (rows) => {
        this.csrm.setRowData(rows as T[]);
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      applyTransaction: (tx) => {
        this.csrm.applyTransaction(tx as { add?: T[]; update?: T[]; remove?: Array<string | T> });
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      applyTransactionAsync: (tx) => {
        this.asyncTx.enqueue(tx as { add?: T[]; update?: T[]; remove?: Array<string | T> });
      },
      flushAsyncTransactions: () => this.asyncTx.flush(),
      applyServerSideTransaction: (tx) => {
        this.ssrm.applyTransaction(tx as { update?: T[] });
        if (tx.update?.length) {
          this.painter.flashCells(tx.update.map((r) => this.getRowId(r as T)));
        }
        this.schedulePaint();
      },
      refreshServerSide: (params) => { void this.ssrm.refresh(params); },
      setSortModel: (model) => {
        this.csrm.setSortModel(model);
        if (this.rowModelType === 'serverSide') void this.ssrm.refresh({ purge: true });
        this.schedulePaint();
        this.options.onSortChanged?.();
      },
      getSortModel: () => this.csrm.getSortModel(),
      setFilterModel: (model) => {
        this.csrm.setFilterModel(model);
        if (this.rowModelType === 'serverSide') void this.ssrm.refresh({ purge: true });
        this.schedulePaint();
        this.options.onFilterChanged?.();
      },
      getFilterModel: () => this.csrm.getFilterModel(),
      setQuickFilterText: (text) => {
        this.quickFilterText = text;
        this.csrm.setQuickFilterText(text);
        if (this.rowModelType === 'serverSide') void this.ssrm.refresh({ purge: true });
        this.schedulePaint();
      },
      getQuickFilterText: () => this.quickFilterText,
      setRowGroupColumns: (cols) => {
        this.groupPivot.setRowGroupColumns(cols);
        this.csrm.setRowGroupColumns(cols);
      },
      getRowGroupColumns: () => this.groupPivot.getRowGroupColumns(),
      setExpanded: (key, open) => {
        if (this.rowModelType === 'clientSide') this.csrm.setExpanded(key, open);
        else this.groupPivot.setExpanded(key, open);
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      expandAll: () => {
        if (this.rowModelType === 'clientSide') this.csrm.expandAll();
        else this.groupPivot.expandAll();
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      collapseAll: () => {
        if (this.rowModelType === 'clientSide') this.csrm.collapseAll();
        else this.groupPivot.collapseAll();
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      setGroupSelected: (key, on) => {
        this.selection.setGroupSelected(key, on);
        this.schedulePaint();
        this.options.onSelectionChanged?.();
      },
      getGroupSelectionState: (key) => this.selection.getGroupSelectionState(key),
      getStickyAncestors: (rowStart) => this.csrm.getStickyAncestors(rowStart),
      setPivotMode: (on) => { this.groupPivot.setPivotMode(on); },
      isPivotMode: () => this.groupPivot.isPivotMode(),
      ensureFullyHydrated: () => this.ssrm.ensureFullyHydrated(),
      refillServerSideColumnKeys: () => { void this.ssrm.refillColumnKeys(); },
      applyFormatPatch: (patch) => {
        this.engines.applyFormat(patch as FormatPatch);
        this.schedulePaint();
      },
      undoFormat: () => {
        const ok = this.engines.undoFormat();
        this.schedulePaint();
        return ok;
      },
      redoFormat: () => {
        const ok = this.engines.redoFormat();
        this.schedulePaint();
        return ok;
      },
      clearFormat: () => {
        this.engines.clearFormat();
        this.schedulePaint();
      },
      setStyleRules: (rules) => {
        this.engines.setStyleRules(rules as StyleRule[]);
        this.schedulePaint();
      },
      setCalcColumns: (cols) => {
        this.engines.setCalcColumns(cols as CalcColumn[]);
        // Ensure calc aliases appear as visible columns.
        const base = this.colDefs.filter((d) => !(d as { __calc?: boolean }).__calc);
        this.colDefs = [
          ...base,
          ...(cols as CalcColumn[]).map((c) => ({
            field: c.alias as keyof T & string,
            colId: c.alias,
            headerName: c.headerName ?? c.alias,
            width: 110,
            __calc: true,
          } as import('./types/options').ColDef<T> & { __calc?: boolean })),
        ];
        this.columns.setColumnDefs(this.colDefs);
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      setAlertRules: (rules) => {
        this.engines.setAlertRules(rules as AlertRule[]);
      },
      applyEditOp: (colId, rowIds, op) => {
        if (this.rowModelType !== 'clientSide') return;
        const raw = this.csrm.getRawRows() as Array<Record<string, unknown>>;
        const next = this.engines.applyEdit(
          raw,
          (r) => this.getRowId(r as T),
          colId,
          rowIds,
          op as EditOp,
        );
        this.csrm.setRowData(next as T[]);
        this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      undoEdit: () => {
        if (this.rowModelType !== 'clientSide') return false;
        const raw = this.csrm.getRawRows() as Array<Record<string, unknown>>;
        const next = this.engines.undoEdit(raw, (r) => this.getRowId(r as T));
        this.csrm.setRowData(next as T[]);
        this.schedulePaint();
        return true;
      },
      redoEdit: () => {
        if (this.rowModelType !== 'clientSide') return false;
        const raw = this.csrm.getRawRows() as Array<Record<string, unknown>>;
        const next = this.engines.redoEdit(raw, (r) => this.getRowId(r as T));
        this.csrm.setRowData(next as T[]);
        this.schedulePaint();
        return true;
      },
      getUnreadAlertCount: () => this.engines.unreadAlertCount(),
      getEngines: () => this.engines,
      getSelectedRows: () => {
        const rows = this.visibleRows();
        return rows.filter((r) => this.selection.isSelected(this.getRowId(r)));
      },
      deselectAll: () => {
        this.selection.clear();
        this.schedulePaint();
        this.options.onSelectionChanged?.();
      },
      sizeColumnsToFit: () => {
        const vis = this.columns.getVisible();
        if (!vis.length) return;
        const w = Math.max(40, Math.floor(this.wrap.clientWidth / vis.length));
        this.columns.applyState(vis.map((c) => ({ colId: c.colId, width: w })));
        this.schedulePaint();
      },
      getRowCount: () => this.rowCount(),
      destroy: () => this.destroy(),
    };
  }

  private visibleRows(): T[] {
    if (this.rowModelType === 'serverSide') return this.ssrmRows;
    return this.csrm.getRows().map((r) => this.engines.enrichRow(r) as T);
  }

  private rowCount(): number {
    if (this.rowModelType === 'serverSide') return this.ssrmRowCount || this.ssrm.getRowCount();
    return this.csrm.getRowCount();
  }

  private wireEvents(rowHeight: number, headerHeight: number): void {
    this.wrap.addEventListener('scroll', () => {
      this.scrollTop = this.wrap.scrollTop;
      this.scrollLeft = this.wrap.scrollLeft;
      this.scrolling = true;
      this.options.onBodyScroll?.();
      if (this.scrollEndTimer != null) clearTimeout(this.scrollEndTimer);
      this.scrollEndTimer = setTimeout(() => {
        this.scrolling = false;
        this.scrollEndTimer = null;
        this.asyncTx.onScrollEnd();
        this.options.onBodyScrollEnd?.();
      }, 120);
      if (this.rowModelType === 'serverSide') {
        const start = Math.floor(this.scrollTop / rowHeight);
        const end = start + Math.ceil(this.wrap.clientHeight / rowHeight) + 5;
        void this.ssrm.ensureRange(start, end);
      }
      this.schedulePaint();
    });

    this.wrap.addEventListener('dblclick', (ev) => {
      if (this.rowModelType !== 'clientSide') return;
      const rect = this.wrap.getBoundingClientRect();
      const y = ev.clientY - rect.top + this.wrap.scrollTop;
      if (y < headerHeight) return;
      const rowIndex = Math.floor((y - headerHeight) / rowHeight);
      const row = this.visibleRows()[rowIndex];
      if (!row || (row as { __isGroup?: boolean }).__isGroup) return;
      const x = ev.clientX - rect.left + this.wrap.scrollLeft;
      let acc = 0;
      for (const col of this.columns.getVisible()) {
        if (x >= acc && x < acc + col.width) {
          this.openCellEditor(row, col.colId, acc, rowIndex, rowHeight, headerHeight);
          return;
        }
        acc += col.width;
      }
    });

    this.wrap.addEventListener('click', (ev) => {
      const rect = this.wrap.getBoundingClientRect();
      const y = ev.clientY - rect.top + this.wrap.scrollTop;
      if (y < headerHeight) {
        const x = ev.clientX - rect.left + this.wrap.scrollLeft;
        let acc = 0;
        for (const col of this.columns.getVisible()) {
          if (x >= acc && x < acc + col.width && col.sortable) {
            const cur = this.csrm.getSortModel()[0];
            const next: SortModel = cur?.colId === col.colId && cur.direction === 'asc'
              ? [{ colId: col.colId, direction: 'desc' }]
              : [{ colId: col.colId, direction: 'asc' }];
            this.api.setSortModel(next);
            return;
          }
          acc += col.width;
        }
        return;
      }
      const rowIndex = Math.floor((y - headerHeight) / rowHeight);
      const row = this.visibleRows()[rowIndex];
      if (!row) return;
      const id = this.getRowId(row);
      if (!ev.metaKey && !ev.ctrlKey && this.options.rowSelection !== 'multiple') {
        this.selection.clear();
      }
      // Group row click cascades when the row carries __groupKey.
      const groupKey = (row as { __groupKey?: string; __isGroup?: boolean }).__isGroup
        ? String((row as { __groupKey?: string }).__groupKey ?? '')
        : '';
      if (groupKey) {
        const state = this.selection.getGroupSelectionState(groupKey);
        this.selection.setGroupSelected(groupKey, state !== 'all');
      } else {
        this.selection.toggle(id);
      }
      this.schedulePaint();
      this.options.onSelectionChanged?.();
    });

    const ro = new ResizeObserver(() => this.schedulePaint());
    ro.observe(this.wrap);
  }

  private schedulePaint(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paintNow();
    });
  }

  private paintNow(): void {
    if (this.destroyed) return;
    const rowHeight = this.options.rowHeight ?? 28;
    const headerHeight = this.options.headerHeight ?? 32;
    const count = this.rowCount();
    const totalW = Math.max(this.columns.totalWidth(), this.wrap.clientWidth);
    const totalH = headerHeight + count * rowHeight;
    this.scroller.style.width = `${totalW}px`;
    this.scroller.style.height = `${totalH}px`;
    this.canvas.style.width = `${this.wrap.clientWidth}px`;
    this.canvas.style.height = `${this.wrap.clientHeight}px`;

    const sort = this.csrm.getSortModel()[0];
    const first = Math.max(0, Math.floor(this.scrollTop / rowHeight));
    this.painter.paint({
      columns: this.columns.getVisible(),
      rows: this.visibleRows() as Record<string, unknown>[],
      scrollTop: this.scrollTop,
      scrollLeft: this.scrollLeft,
      selected: new Set(this.selection.getSelectedIds()),
      sortColId: sort?.colId,
      stickyAncestors: this.rowModelType === 'clientSide'
        ? this.csrm.getStickyAncestors(first)
        : [],
      formatValue: (colId, value) => this.engines.formatCell(colId, value),
      cellStyle: (row, colId) => this.engines.styleCell(row, colId),
      colFormat: (colId) => this.engines.resolveColFormat(colId),
    });
  }

  setSsrmExpressionHost(host: unknown | null): void {
    this.engines.setSsrmExpressionHost(host);
  }

  setSsrmExpressionOutputs(ids: readonly string[]): void {
    this.engines.setSsrmExpressionOutputs(ids);
  }

  private openCellEditor(
    row: T,
    colId: string,
    colLeft: number,
    rowIndex: number,
    rowHeight: number,
    headerHeight: number,
  ): void {
    this.closeCellEditor();
    const field = colId;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = String((row as Record<string, unknown>)[field] ?? '');
    input.style.cssText = [
      'position:absolute',
      `left:${colLeft - this.scrollLeft}px`,
      `top:${headerHeight + rowIndex * rowHeight - this.scrollTop}px`,
      `height:${rowHeight}px`,
      'min-width:80px',
      'z-index:5',
      'border:1px solid #1f6feb',
      'font:12px "IBM Plex Sans",system-ui,sans-serif',
      'padding:0 6px',
    ].join(';');
    const commit = (): void => {
      const id = this.getRowId(row);
      const rawVal = input.value;
      const num = Number(rawVal);
      const value = rawVal.trim() === '' || Number.isNaN(num) ? rawVal : num;
      this.api.applyEditOp(colId, [id], { type: 'set', value });
      this.closeCellEditor();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') this.closeCellEditor();
    });
    input.addEventListener('blur', () => commit());
    this.root.appendChild(input);
    this.editorEl = input;
    input.focus();
    input.select();
  }

  private closeCellEditor(): void {
    this.editorEl?.remove();
    this.editorEl = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeCellEditor();
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.scrollEndTimer != null) clearTimeout(this.scrollEndTimer);
    this.asyncTx.destroy();
    this.ssrm.destroy();
    this.root.remove();
  }
}

export type { ColDef, FilterModel, SortModel, VelocityGridOptions } from './types/options';
