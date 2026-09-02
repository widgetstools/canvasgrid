/**
 * Master / detail — expansion state and the detail-band DOM.
 *
 * The canvas paints the master grid. A detail row is a gap in that paint: the
 * body painter fills the band and stops, and this controller parks a real DOM
 * element over it holding an embedded grid. That division is deliberate — a
 * detail grid is a full grid (its own columns, sort, filter, selection,
 * scrollbars, and its own detail rows if you nest them), and re-implementing
 * one inside a parent's canvas would be a second grid with none of the first
 * one's features.
 *
 * What lives here:
 *   - which master rows are expanded (`expanded`), and the `isRowMaster` gate
 *   - the pane per visible detail band, created on demand and positioned from
 *     the viewport's row geometry every frame
 *   - `keepDetailRows` / `keepDetailRowsCount`: the LRU that lets a collapsed
 *     or scrolled-away detail grid keep its scroll, sort and selection
 *   - `getDetailGridInfo` / `forEachDetailGridInfo` registration, keyed
 *     `detail_{ROW-ID}` exactly as ag-grid keys them
 *
 * What does NOT live here: the display↔base index arithmetic (that is
 * `masterDetailIndex.ts`) and the chevron paint / hit-test (the master row's
 * own cell, in the `'group'` renderer and `VelocityGrid`).
 *
 * The grid is injected as a factory rather than imported, so this module
 * stays free of a cycle back into `velocityGrid.ts`.
 */

import type {
  DetailGridInfo,
  DetailRefreshStrategy,
  IDetailCellRendererParams,
  IsMasterOpenByDefaultParams,
  MasterDetailRowNode,
} from '../types/masterDetail';

/** Default detail-row height when `detailRowHeight` is unset, matching
 *  ag-grid's own default. */
export const DEFAULT_DETAIL_ROW_HEIGHT = 300;
/** Default cap on retained detail grids under `keepDetailRows`. */
export const DEFAULT_KEEP_DETAIL_ROWS_COUNT = 10;

/** One embedded detail grid, as the host sees it. */
export interface DetailGridHandle {
  /** The detail grid's public api — surfaced through `getDetailGridInfo`. */
  api: unknown;
  /** Replace the detail grid's rows. */
  setRowData(rows: unknown[]): void;
  /** Number of rows currently loaded — drives `detailRowAutoHeight`. */
  rowCount(): number;
  /** Height one row + the header occupy, for the auto-height estimate. */
  metrics(): { rowHeight: number; headerHeight: number };
  destroy(): void;
}

/** The slice of grid options this controller reads. Declared structurally so
 *  the module does not have to import the full options surface. */
export interface MasterDetailOptions<TRow = any> {
  masterDetail?: boolean;
  isRowMaster?: (data: TRow) => boolean;
  detailRowHeight?: number;
  detailRowAutoHeight?: boolean;
  keepDetailRows?: boolean;
  keepDetailRowsCount?: number;
  detailCellRenderer?: (params: {
    node: MasterDetailRowNode<TRow>;
    data: TRow;
    eGridDiv: HTMLElement;
  }) => HTMLElement | string | void;
  detailCellRendererParams?:
    | IDetailCellRendererParams<TRow>
    | ((params: { node: MasterDetailRowNode<TRow>; data: TRow }) => IDetailCellRendererParams<TRow>);
  isMasterOpenByDefault?: (params: IsMasterOpenByDefaultParams<TRow>) => boolean;
}

export interface MasterDetailDeps<TRow = any> {
  /** Overlay the panes mount into. Shares the canvas region's insets and
   *  carries `pointer-events: none`; panes opt back in. */
  container: HTMLElement;
  getOptions: () => MasterDetailOptions<TRow>;
  /** Main-thread row mirror lookup. */
  getRowData: (rowId: string) => TRow | undefined;
  /** Build an embedded grid inside `host`. Injected by `VelocityGrid`. */
  createDetailGrid: (host: HTMLElement, options: Record<string, unknown>) => DetailGridHandle;
  /** Expansion changed — the grid re-resolves detail positions, rebuilds the
   *  height index and repaints. */
  onExpandedChanged: (rowId: string, expanded: boolean, source: 'ui' | 'api') => void;
  /** A detail band's measured height changed under `detailRowAutoHeight`. */
  onDetailHeightChanged: () => void;
}

/** Geometry for one detail band this frame, in overlay coordinates. */
export interface DetailBand {
  rowId: string;
  top: number;
  height: number;
  left: number;
  width: number;
  /** Clip bounds of the grid body — a band scrolled under the header is
   *  trimmed rather than allowed to paint over it. */
  clipTop: number;
  clipBottom: number;
}

interface Pane {
  rowId: string;
  el: HTMLDivElement;
  /** The element the embedded grid mounts into — the wrapper itself unless a
   *  `template` put one further down. */
  mount: HTMLElement;
  grid: DetailGridHandle | null;
  /** Detail rows delivered by `getDetailRowData`, retained so a refresh can
   *  diff without re-running the callback. */
  rows: unknown[];
  /** Bumped per load so a late `successCallback` from a superseded load is
   *  dropped instead of overwriting a newer one. */
  loadSeq: number;
}

export class MasterDetailController<TRow = any> {
  /** Master row ids currently expanded. */
  private expanded = new Set<string>();
  /** Live panes, keyed by master row id. Includes parked ones. */
  private panes = new Map<string, Pane>();
  /** Parked pane ids under `keepDetailRows`, least-recently-shown first. */
  private parked: string[] = [];
  /** Measured heights under `detailRowAutoHeight`, keyed by master row id. */
  private autoHeights = new Map<string, number>();
  /** `detail_{ROW-ID}` → info, for `getDetailGridInfo`. Custom renderers can
   *  register their own via `addDetailGridInfo`. */
  private registry = new Map<string, DetailGridInfo>();

  constructor(private deps: MasterDetailDeps<TRow>) {}

  // ── State ────────────────────────────────────────────────────────────────

  get enabled(): boolean { return this.deps.getOptions().masterDetail === true; }

  /** True when `rowId`'s row can be expanded. `isRowMaster` is consulted with
   *  the raw row data, matching ag-grid; a row we have no data for is treated
   *  as a master so a chevron still appears while the mirror catches up. */
  isRowMaster(rowId: string): boolean {
    if (!this.enabled || rowId === '') return false;
    const cb = this.deps.getOptions().isRowMaster;
    if (!cb) return true;
    const data = this.deps.getRowData(rowId);
    if (data === undefined) return true;
    try { return cb(data) !== false; } catch { return true; }
  }

  isExpanded(rowId: string): boolean { return this.expanded.has(rowId); }

  /** Master row ids currently expanded. */
  expandedRowIds(): string[] { return Array.from(this.expanded); }

  setExpanded(rowId: string, expanded: boolean, source: 'ui' | 'api' = 'api'): void {
    if (!this.enabled || rowId === '') return;
    if (expanded && !this.isRowMaster(rowId)) return;
    if (this.expanded.has(rowId) === expanded) return;
    if (expanded) this.expanded.add(rowId);
    else {
      this.expanded.delete(rowId);
      this.releasePane(rowId);
    }
    this.deps.onExpandedChanged(rowId, expanded, source);
  }

  toggle(rowId: string, source: 'ui' | 'api' = 'ui'): void {
    this.setExpanded(rowId, !this.expanded.has(rowId), source);
  }

  /** Collapse everything and drop every pane. */
  collapseAll(source: 'ui' | 'api' = 'api'): void {
    const ids = Array.from(this.expanded);
    if (ids.length === 0) return;
    this.expanded.clear();
    for (const id of ids) this.releasePane(id);
    for (const id of ids) this.deps.onExpandedChanged(id, false, source);
  }

  /** Seed expansion from `isMasterOpenByDefault` for freshly-loaded rows.
   *  Returns `true` when anything changed. */
  applyOpenByDefault(rowIds: readonly string[]): boolean {
    const cb = this.deps.getOptions().isMasterOpenByDefault;
    if (!this.enabled || !cb) return false;
    let changed = false;
    for (const rowId of rowIds) {
      if (this.expanded.has(rowId)) continue;
      const data = this.deps.getRowData(rowId);
      if (data === undefined) continue;
      if (!this.isRowMaster(rowId)) continue;
      let open = false;
      try {
        // AG's `IsMasterOpenByDefaultParams`: `{ rowNode, data, level }`.
        // A master row is always a leaf of the master grid, so `level` is 0.
        open = cb({ rowNode: { id: rowId, data }, data, level: 0 }) === true;
      } catch { open = false; }
      if (!open) continue;
      this.expanded.add(rowId);
      changed = true;
    }
    return changed;
  }

  /** Forget an expanded row whose data no longer exists (a `remove`
   *  transaction, or a filter that excluded it permanently). */
  dropRows(rowIds: readonly string[]): boolean {
    let changed = false;
    for (const rowId of rowIds) {
      if (!this.expanded.delete(rowId)) continue;
      this.releasePane(rowId);
      this.autoHeights.delete(rowId);
      changed = true;
    }
    return changed;
  }

  // ── Heights ──────────────────────────────────────────────────────────────

  /** Height of the detail band for `rowId`. Under `detailRowAutoHeight` this
   *  is the measured content height once the rows have loaded; otherwise the
   *  configured `detailRowHeight`. */
  detailHeight(rowId?: string): number {
    const opts = this.deps.getOptions();
    if (rowId !== undefined && opts.detailRowAutoHeight) {
      const measured = this.autoHeights.get(rowId);
      if (measured !== undefined) return measured;
    }
    const h = opts.detailRowHeight;
    return typeof h === 'number' && h > 0 ? h : DEFAULT_DETAIL_ROW_HEIGHT;
  }

  // ── Detail grid registry (ag-grid parity) ───────────────────────────────

  static detailIdFor(rowId: string): string { return `detail_${rowId}`; }

  getDetailGridInfo(id: string): DetailGridInfo | undefined { return this.registry.get(id); }

  forEachDetailGridInfo(cb: (info: DetailGridInfo, index: number) => void): void {
    let i = 0;
    for (const info of this.registry.values()) cb(info, i++);
  }

  addDetailGridInfo(id: string, info: DetailGridInfo): void { this.registry.set(id, info); }

  removeDetailGridInfo(id: string): void { this.registry.delete(id); }

  // ── Layout ───────────────────────────────────────────────────────────────

  /**
   * Reconcile the panes against the bands the viewport says are on screen.
   *
   * Called once per paint. Bands present here get a live, positioned pane;
   * everything else is released (destroyed, or parked when `keepDetailRows`
   * is on). That is the same virtualisation ag-grid applies — a detail grid
   * exists while its row is in view, and `keepDetailRows` is what buys it a
   * life beyond that.
   */
  syncBands(bands: readonly DetailBand[]): void {
    if (!this.enabled) {
      if (this.panes.size > 0) this.destroyAllPanes();
      return;
    }
    const live = new Set<string>();
    for (const band of bands) {
      const top = Math.max(band.top, band.clipTop);
      const bottom = Math.min(band.top + band.height, band.clipBottom);
      if (bottom <= top) continue;
      live.add(band.rowId);
      const pane = this.ensurePane(band.rowId);
      if (!pane) continue;
      const el = pane.el;
      el.style.display = '';
      el.style.left = `${band.left}px`;
      el.style.width = `${Math.max(0, band.width)}px`;
      // The wrapper is placed at the band's true top and clipped by an
      // inset, so a band scrolling under the header trims from the top
      // without the embedded grid re-laying out on every scroll tick.
      el.style.top = `${band.top}px`;
      el.style.height = `${band.height}px`;
      const clipTopPx = Math.max(0, band.clipTop - band.top);
      const clipBottomPx = Math.max(0, (band.top + band.height) - band.clipBottom);
      el.style.clipPath = clipTopPx > 0 || clipBottomPx > 0
        ? `inset(${clipTopPx}px 0px ${clipBottomPx}px 0px)`
        : '';
    }
    for (const [rowId, pane] of this.panes) {
      if (live.has(rowId)) continue;
      if (this.parked.includes(rowId)) { pane.el.style.display = 'none'; continue; }
      this.releasePane(rowId);
    }
  }

  /** Tear down every pane and clear the registry. */
  destroy(): void {
    this.destroyAllPanes();
    this.expanded.clear();
    this.autoHeights.clear();
    this.registry.clear();
  }

  // ── Data refresh ─────────────────────────────────────────────────────────

  /**
   * Push a master-row data change into any open detail grid, per
   * `refreshStrategy` (default `'rows'`).
   *
   *   'rows'       re-run `getDetailRowData` and replace the detail rows.
   *   'everything' rebuild the pane from scratch.
   *   'nothing'    leave it alone until the user re-expands.
   */
  refreshMasterRows(rowIds: readonly string[]): void {
    if (!this.enabled) return;
    for (const rowId of rowIds) {
      const pane = this.panes.get(rowId);
      if (!pane) continue;
      const strategy = this.resolveRefreshStrategy(rowId);
      if (strategy === 'nothing') continue;
      if (strategy === 'everything') {
        this.releasePane(rowId, true);
        continue;
      }
      this.loadRows(pane);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private resolveParams(rowId: string): IDetailCellRendererParams<TRow> {
    const raw = this.deps.getOptions().detailCellRendererParams;
    if (typeof raw !== 'function') return raw ?? {};
    const data = this.deps.getRowData(rowId);
    if (data === undefined) return {};
    try { return raw({ node: { id: rowId, data }, data }) ?? {}; } catch { return {}; }
  }

  private resolveRefreshStrategy(rowId: string): DetailRefreshStrategy {
    return this.resolveParams(rowId).refreshStrategy ?? 'rows';
  }

  private ensurePane(rowId: string): Pane | null {
    const existing = this.panes.get(rowId);
    if (existing) {
      // Un-park: it was retained by `keepDetailRows` and is wanted again.
      const at = this.parked.indexOf(rowId);
      if (at >= 0) this.parked.splice(at, 1);
      return existing;
    }
    const data = this.deps.getRowData(rowId);
    if (data === undefined) return null;

    const el = document.createElement('div');
    el.className = 'vg-detail-row';
    el.setAttribute('data-vg-detail-row', rowId);
    // The overlay suppresses pointer events so the canvas under it stays
    // interactive; a detail grid has to opt back in to be usable at all.
    el.style.cssText = 'position:absolute; pointer-events:auto; box-sizing:border-box; overflow:hidden;';

    const node: MasterDetailRowNode<TRow> = { id: rowId, data };
    const params = this.resolveParams(rowId);
    let mount: HTMLElement = el;

    // `template` wraps the grid in app HTML — a title bar, a toolbar. The
    // element carrying `data-ref="eDetailGrid"` is where the grid goes.
    // ag-grid renamed that attribute from `ref` to `data-ref`; both are
    // accepted here because templates written against either generation of
    // the docs are out there, and silently ignoring one would put the grid
    // in the wrong place rather than fail loudly. Without either, the
    // template is treated as decoration and the grid fills the wrapper.
    const template = typeof params.template === 'function'
      ? safeCall(() => (params.template as (p: never) => string)({ node, data } as never))
      : params.template;
    if (typeof template === 'string' && template.trim() !== '') {
      el.innerHTML = template;
      const slot = el.querySelector('[data-ref="eDetailGrid"]')
        ?? el.querySelector('[ref="eDetailGrid"]');
      if (slot instanceof HTMLElement) mount = slot;
    }

    const pane: Pane = { rowId, el, mount, grid: null, rows: [], loadSeq: 0 };
    this.panes.set(rowId, pane);
    this.deps.container.appendChild(el);

    const custom = this.deps.getOptions().detailCellRenderer;
    if (custom) {
      // Fully custom detail body — the app owns the DOM. No embedded grid,
      // so no registry entry unless the app adds one itself.
      const produced = safeCall(() => custom({ node, data, eGridDiv: mount }));
      if (typeof produced === 'string') mount.innerHTML = produced;
      else if (produced instanceof HTMLElement) mount.appendChild(produced);
      return pane;
    }

    const gridOptions: Record<string, unknown> = { ...(params.detailGridOptions ?? {}) };
    // A detail grid that fails to construct must not take the master down
    // with it — the band stays empty and the console says why.
    pane.grid = safeCall(() => this.deps.createDetailGrid(mount, gridOptions)) ?? null;
    if (pane.grid === null) return pane;
    this.registry.set(
      MasterDetailController.detailIdFor(rowId),
      { id: MasterDetailController.detailIdFor(rowId), api: pane.grid.api },
    );
    this.loadRows(pane);
    return pane;
  }

  /** Run `getDetailRowData` for a pane and hand the result to its grid. */
  private loadRows(pane: Pane): void {
    const data = this.deps.getRowData(pane.rowId);
    if (data === undefined) return;
    const params = this.resolveParams(pane.rowId);
    const seq = ++pane.loadSeq;
    const deliver = (rows: unknown[]): void => {
      // Dropped when a newer load started, or the pane went away while the
      // callback was in flight (an async fetch outliving a collapse).
      if (pane.loadSeq !== seq) return;
      if (this.panes.get(pane.rowId) !== pane) return;
      pane.rows = Array.isArray(rows) ? rows : [];
      pane.grid?.setRowData(pane.rows);
      this.measureAutoHeight(pane);
    };
    if (params.getDetailRowData) {
      safeCall(() => params.getDetailRowData!({
        node: { id: pane.rowId, data },
        data,
        successCallback: deliver,
      }));
      return;
    }
    // No callback — `detailGridOptions.rowData` is the other supported
    // source, and the embedded grid already picked it up at construction.
    const seeded = (params.detailGridOptions?.rowData as unknown[] | undefined) ?? [];
    deliver(seeded);
  }

  /**
   * `detailRowAutoHeight` — size the band to its content.
   *
   * The detail grid is a canvas, so there is no DOM to measure; the height is
   * computed from what the grid will lay out (header + n rows + a hairline of
   * padding), which is exact for a flat detail grid and the right estimate
   * for anything else.
   */
  private measureAutoHeight(pane: Pane): void {
    if (!this.deps.getOptions().detailRowAutoHeight) return;
    const grid = pane.grid;
    if (!grid) return;
    const { rowHeight, headerHeight } = grid.metrics();
    // AG parity: the floor applies to the ROWS SECTION, not the whole band —
    // an auto-height detail grid keeps at least 150px of row area, and the
    // header sits above that. Flooring the total instead would let a
    // one-row detail collapse until its header ate the whole band.
    const rowsHeight = Math.max(MIN_AUTO_DETAIL_ROWS_HEIGHT, grid.rowCount() * rowHeight);
    const wanted = headerHeight + rowsHeight + DETAIL_PADDING * 2;
    if (this.autoHeights.get(pane.rowId) === wanted) return;
    this.autoHeights.set(pane.rowId, wanted);
    this.deps.onDetailHeightChanged();
  }

  /**
   * Retire a pane: parked under `keepDetailRows` (so its scroll / sort /
   * selection survive), destroyed otherwise.
   *
   * `force` destroys regardless — used by `refreshStrategy: 'everything'`,
   * where the point is to rebuild.
   */
  private releasePane(rowId: string, force = false): void {
    const pane = this.panes.get(rowId);
    if (!pane) return;
    const opts = this.deps.getOptions();
    if (!force && opts.keepDetailRows) {
      if (!this.parked.includes(rowId)) this.parked.push(rowId);
      pane.el.style.display = 'none';
      const cap = Math.max(0, opts.keepDetailRowsCount ?? DEFAULT_KEEP_DETAIL_ROWS_COUNT);
      while (this.parked.length > cap) {
        const evicted = this.parked.shift();
        if (evicted !== undefined) this.destroyPane(evicted);
      }
      return;
    }
    const at = this.parked.indexOf(rowId);
    if (at >= 0) this.parked.splice(at, 1);
    this.destroyPane(rowId);
  }

  private destroyPane(rowId: string): void {
    const pane = this.panes.get(rowId);
    if (!pane) return;
    this.panes.delete(rowId);
    pane.loadSeq++;   // invalidate any in-flight getDetailRowData callback
    safeCall(() => pane.grid?.destroy());
    pane.el.remove();
    this.registry.delete(MasterDetailController.detailIdFor(rowId));
  }

  private destroyAllPanes(): void {
    for (const rowId of Array.from(this.panes.keys())) this.destroyPane(rowId);
    this.parked.length = 0;
  }
}

/** Minimum height the ROWS SECTION of an auto-sized detail grid may collapse
 *  to, matching ag-grid's own 150px floor. The header rides on top of it. */
const MIN_AUTO_DETAIL_ROWS_HEIGHT = 150;
/** Inner padding the detail band reserves around its embedded grid. */
const DETAIL_PADDING = 1;

/** Run an app-supplied callback without letting it take the grid down. */
function safeCall<T>(fn: () => T): T | undefined {
  try { return fn(); } catch (err) {
    console.error('[velocity-grid] master/detail callback threw:', err);
    return undefined;
  }
}
