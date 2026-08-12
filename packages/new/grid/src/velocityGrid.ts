import { ClientSideRowModel } from './csrm/clientSideRowModel';
import { AsyncTransactionQueue } from './csrm/asyncTransactions';
import { ColumnModel } from './columns/columnModel';
import { GroupPivotCoordinator } from './groupPivot/coordinator';
import { CanvasPainter } from './paint/canvasPainter';
import { buildSsrmColumnKeys } from './ssrm/columnKeys';
import { ServerSideRowModel } from './ssrm/serverSideRowModel';
import type { VelocityGridApi } from './api/facade';
import type {
  SortModel,
  VelocityGridOptions,
} from './types/options';
import type { IServerSideDatasourceV2 } from './ssrm/types';

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
  private readonly selected = new Set<string>();
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
  private readonly options: VelocityGridOptions<T>;
  private readonly asyncTx: AsyncTransactionQueue<T>;
  private raf = 0;
  private readonly api: VelocityGridApi<T>;

  constructor(host: HTMLElement, options: VelocityGridOptions<T>) {
    this.options = options;
    this.rowModelType = options.rowModelType ?? 'clientSide';
    this.clientPipeline = options.serverSideEnableClientSidePipeline === true;
    this.getRowId = options.getRowId
      ?? ((r: T) => String((r as { id?: string }).id ?? JSON.stringify(r)));

    this.root = document.createElement('div');
    this.root.className = 'vg-new-grid';
    this.root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;font-family:"IBM Plex Sans",system-ui,sans-serif;background:var(--vgn-bg,#fff);';
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

    this.columns.setColumnDefs(options.columnDefs ?? []);
    this.csrm = new ClientSideRowModel(this.getRowId, () => options.columnDefs ?? []);
    this.groupPivot = new GroupPivotCoordinator({
      isSparseSsrm: () => this.isSparseSsrm(),
      onStructureChanged: () => {
        if (this.rowModelType === 'serverSide') void this.ssrm.refresh({ purge: true });
        else this.schedulePaint();
        this.options.onModelUpdated?.();
      },
      onExpansionChanged: () => {
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
      setExpanded: (key, open) => { this.groupPivot.setExpanded(key, open); },
      expandAll: () => { this.groupPivot.expandAll(); },
      collapseAll: () => { this.groupPivot.collapseAll(); },
      setPivotMode: (on) => { this.groupPivot.setPivotMode(on); },
      isPivotMode: () => this.groupPivot.isPivotMode(),
      ensureFullyHydrated: () => this.ssrm.ensureFullyHydrated(),
      refillServerSideColumnKeys: () => { void this.ssrm.refillColumnKeys(); },
      getSelectedRows: () => {
        const rows = this.visibleRows();
        return rows.filter((r) => this.selected.has(this.getRowId(r)));
      },
      deselectAll: () => {
        this.selected.clear();
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
    return this.csrm.getRows();
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
        this.selected.clear();
      }
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
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
    this.painter.paint({
      columns: this.columns.getVisible(),
      rows: this.visibleRows() as Record<string, unknown>[],
      scrollTop: this.scrollTop,
      scrollLeft: this.scrollLeft,
      selected: this.selected,
      sortColId: sort?.colId,
    });
  }

  setSsrmExpressionHost(_host: unknown | null): void { /* Phase 6 */ }
  setSsrmExpressionOutputs(_ids: readonly string[]): void { /* Phase 6 */ }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.scrollEndTimer != null) clearTimeout(this.scrollEndTimer);
    this.asyncTx.destroy();
    this.ssrm.destroy();
    this.root.remove();
  }
}

export type { ColDef, FilterModel, SortModel, VelocityGridOptions } from './types/options';
