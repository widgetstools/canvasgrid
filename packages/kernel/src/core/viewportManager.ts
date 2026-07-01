// Cycle 19 / Task 2 — owns the scroll/viewport subsystem extracted from
// CGrid: scroll-state fields, the native `'scroll'` listener (routed through
// the host's DisposableRegistry), `computeCurrentViewport` + `syncSizer`,
// the velocity sampler used by the prefetch-range expansion, the
// request-coalescing flags around the worker viewport fetch, and the
// `setScroll` / `ensure*Visible` scroll-imperative helpers.
//
// CGrid is the thin delegator: `this.viewport` (the ViewportState) is still
// CGrid's read-only field — `recompute()` returns the new state which CGrid
// assigns back so the 100+ readers of `viewport.visibleColumns` etc. don't
// have to change. The seam pulls the chunk-processing tail of `requestViewport`
// out as the `dispatchViewportRequest` dep: ViewportManager owns coalescing,
// prefetch-range math, and the `request` entry point; CGrid (until cycle 19 /
// task 3 lands `WorkerCoordinator`) owns the worker call + chunk plumbing.
// The split was deliberately chosen so this extraction stays pure-viewport
// and surfaces the worker-pipeline coupling instead of dragging half the
// grid into the viewport module.

import type { TypedEventEmitter } from './eventEmitter';
import type { DisposableRegistry } from './disposable';
import type { ColumnLayout } from './layout';
import type { Subgrid } from './subgrid';
import type { RowHeightIndex } from './rowHeightIndex';
import type { AggregationChangedSource, CGridEvent } from '../types';
import { computeViewport, type ViewportState } from './viewport';
import { expandRangeForVelocity } from './prefetchRange';

/** Subset of CGridOptions the viewport math reads. Passed through a
 *  closure so per-tick `setGridOption` flips light up on the next
 *  recompute without re-wiring the manager. */
export interface ViewportComputeOptions {
  rowBuffer?: number;
  suppressColumnVirtualisation?: boolean;
  suppressRowVirtualisation?: boolean;
  domLayout?: 'normal' | 'autoHeight' | 'print';
  rowHeight?: number;
}

export interface ViewportManagerDeps {
  disposables: DisposableRegistry;
  events: TypedEventEmitter<CGridEvent>;
  scroller: HTMLDivElement;
  sizer: HTMLDivElement;
  root: HTMLDivElement;

  // --- Read accessors used by computeCurrentViewport on every recompute. --
  getColumnLayout(): ColumnLayout[];
  getSubgrids(): Subgrid[];
  getCanvasBounds(): { width: number; height: number };
  getOptions(): ViewportComputeOptions;
  /** Effective row-height fallback (options.rowHeight ?? theme.rowHeight). */
  getRowHeightFallback(): number;
  getRowHeightIndex(): RowHeightIndex | null;

  // --- Side effects fired by the manager. ---
  /** Called after every successful recompute. Used by the floating-filter
   *  overlay to re-pin its pooled `<input>` elements; safe to no-op. */
  afterRecompute(viewport: ViewportState): void;
  /** Called once per scroll tick after viewport state has been updated.
   *  CGrid uses this to `requestRepaint()` and re-anchor any open
   *  inline editor. Separate from `afterRecompute` so non-scroll
   *  recomputes (resize, column mutation, group toggle) don't repaint
   *  out of band. */
  afterScrollTick(): void;
  isDestroyed(): boolean;

  // --- Worker-pipeline seam. ---
  /** Fire the actual worker fetch for the velocity-expanded range and
   *  process the response (chunk → state mutations + events). Owned by
   *  CGrid until cycle 19 / task 3 extracts `WorkerCoordinator`. */
  dispatchViewportRequest(opts: {
    rowStart: number;
    rowEnd: number;
    columns: string[];
  }): Promise<void>;
}

export class ViewportManager {
  private currentState!: ViewportState;
  private _scrollLeft = 0;
  private _scrollTop = 0;
  /** Cycle 23 / Task 3 — debounce handle for `bodyScrollEnd`. Cleared on
   *  every scroll tick and re-armed for 200ms; null when no scroll has
   *  happened in the last window. */
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cycle 25 / Task 8 — scroll velocity in rows per ms (positive = scrolling
   *  down). Updated from `onScrollerScroll` deltas; consumed by `request` to
   *  widen the requested range pre-emptively on a fast fling. */
  private _scrollVelocityRows = 0;
  private lastScrollSampleTop = 0;
  private lastScrollSampleTime = 0;

  /** First / last colId of the materialised center-column slice — the
   *  identity of the virtualisation window. `null` for "no center columns
   *  visible". The outer ref is `null` until the first `recompute()` captures
   *  the baseline, so the construction-time recompute does NOT emit
   *  `virtualColumnsChanged` and external listeners only see real post-mount
   *  shifts. Cycle 6 / Task 8. */
  private prevVirtualColRange: { first: string | null; last: string | null } | null = null;

  // Request coalescing — while one fetch is in-flight, additional calls
  // flip a queued flag so a single follow-up runs after the current
  // completes. Without this, rapid resizes drop all but the first request.
  private requestPending = false;
  private requestQueued = false;
  /** Cycle 14 / Task 6 — what triggered the in-flight aggregation recompute.
   *  Set by `request(source)`; read + cleared by the chunk handler via
   *  `consumePendingAggSource()`. Most-recent-source wins when multiple
   *  data-affecting calls coalesce on a single in-flight fetch. */
  private pendingAggSource: AggregationChangedSource | null = null;

  constructor(private deps: ViewportManagerDeps) {
    deps.disposables.addListener(deps.scroller, 'scroll', () => {
      this.onScrollerScroll(deps.scroller.scrollLeft, deps.scroller.scrollTop);
    });
    // Clear the bodyScrollEnd debounce on destroy so a late tick can't emit
    // on a torn-down grid. The DisposableRegistry runs disposers in LIFO so
    // this gets cancelled before the scroll listener is removed.
    deps.disposables.add(() => {
      if (this.scrollEndTimer !== null) {
        clearTimeout(this.scrollEndTimer);
        this.scrollEndTimer = null;
      }
    });
  }

  // --- Public read surface ---------------------------------------------------

  get state(): ViewportState { return this.currentState; }
  get scrollLeft(): number { return this._scrollLeft; }
  get scrollTop(): number { return this._scrollTop; }
  get scrollVelocityRows(): number { return this._scrollVelocityRows; }
  getScrollPosition(): { top: number; left: number } {
    return { top: this._scrollTop, left: this._scrollLeft };
  }

  // --- Recompute ------------------------------------------------------------

  /** Reassign viewport AND re-sync the sizer so native scrollbars stay
   *  accurate. `afterScroll` flags scroll-driven recomputes so the
   *  `virtualColumnsChanged` emission can report `afterScroll: true` in
   *  that case (every other caller — resize, column mutation, group toggle
   *  — passes `false`). Cycle 6 / Task 8. */
  recompute(afterScroll: boolean = false): ViewportState {
    this.currentState = this.computeCurrentViewport();
    this.syncSizer();
    this.detectVirtualColumnsChanged(afterScroll);
    this.deps.afterRecompute(this.currentState);
    return this.currentState;
  }

  private computeCurrentViewport(): ViewportState {
    // Use the canvas drawable width (which subtracts the scrollbar gutter on
    // overlay-scrollbar platforms — see CGridCanvas.measureSize). Falling back
    // to scroller.clientWidth would leave the rightmost right-pinned column
    // extending into the gutter, clipped by the canvas right edge.
    const { scroller, root } = this.deps;
    const bounds = this.deps.getCanvasBounds();
    const w = bounds.width || scroller.clientWidth || root.clientWidth || 800;
    const h = bounds.height || scroller.clientHeight || root.clientHeight || 600;
    const opts = this.deps.getOptions();
    return computeViewport({
      columnLayout: this.deps.getColumnLayout(),
      subgrids: this.deps.getSubgrids(),
      containerWidth: w,
      containerHeight: h,
      scrollLeft: this._scrollLeft,
      scrollTop: this._scrollTop,
      rowBuffer: opts.rowBuffer,
      // Cycle 20 / Task 6 — `domLayout: 'print'` forces every row + every
      // column to materialise so the browser print path captures the
      // entire grid.
      suppressColumnVirtualisation:
        opts.suppressColumnVirtualisation || opts.domLayout === 'print',
      suppressRowVirtualisation:
        opts.suppressRowVirtualisation || opts.domLayout === 'print',
      dataRowHeightIndex: this.deps.getRowHeightIndex() ?? undefined,
    });
  }

  /** Size the invisible sizer to match the viewport's scrollable extent so the
   *  native scrollbars track the right range. When an axis has no overflow
   *  (`maxScroll{Left,Top} === 0`) the sizer collapses to 1 px on that axis
   *  — NOT `clientArea + 0`. Reason: clientWidth/Height already excludes any
   *  existing scrollbar gutter, so setting the sizer equal to the current
   *  client extent puts scrollHeight right at the threshold. If the OTHER
   *  axis then needs a scrollbar (e.g. wide columns force horizontal
   *  scrolling), Chrome shrinks the cross-axis client extent by the gutter
   *  width, and `scrollHeight > new clientHeight` triggers a phantom
   *  vertical scrollbar even with zero rows. */
  private syncSizer(): void {
    const { sizer, scroller, root } = this.deps;
    if (!sizer) return; // happy-dom guard during early construction
    const baseW = scroller.clientWidth || root.clientWidth;
    const baseH = scroller.clientHeight || root.clientHeight;
    const w = this.currentState.maxScrollLeft > 0 ? baseW + this.currentState.maxScrollLeft : 1;
    const h = this.currentState.maxScrollTop > 0 ? baseH + this.currentState.maxScrollTop : 1;
    sizer.style.width = `${Math.max(1, w)}px`;
    sizer.style.height = `${Math.max(1, h)}px`;
  }

  /** Compare the materialised center-column range against the previous
   *  recompute and emit `virtualColumnsChanged` if it shifted. Identifies the
   *  range by the first / last center colId since `ViewportColumn.index` is a
   *  0..N position within `visibleColumns` — not a layout index — so it doesn't
   *  move when columns slide off-screen. The first call after construction
   *  captures the baseline silently so external listeners only see real
   *  post-mount changes. Cycle 6 / Task 8. */
  private detectVirtualColumnsChanged(afterScroll: boolean): void {
    let first: string | null = null;
    let last: string | null = null;
    for (const c of this.currentState.visibleColumns) {
      if (c.pinned) continue;
      if (first === null) first = c.colId;
      last = c.colId;
    }
    const prev = this.prevVirtualColRange;
    if (prev === null) {
      this.prevVirtualColRange = { first, last };
      return;
    }
    if (prev.first === first && prev.last === last) return;
    this.prevVirtualColRange = { first, last };
    this.deps.events.emit({ type: 'virtualColumnsChanged', afterScroll });
  }

  // --- Scroll listener ------------------------------------------------------

  /** Called by the scroller's native 'scroll' event. Idempotent — if internal
   *  state already matches (e.g., because we just set scrollLeft
   *  programmatically), it's a no-op so there's no feedback loop. Public so
   *  CGrid's back-compat `onScrollerScroll` shim (and the existing E2E /
   *  integration tests that reach in via `(grid as any).onScrollerScroll`)
   *  can drive scroll events directly. */
  onScrollerScroll(x: number, y: number): void {
    if (x === this._scrollLeft && y === this._scrollTop) return;
    const horizontal = x !== this._scrollLeft;
    const verticalChanged = y !== this._scrollTop;
    // Cycle 25 / Task 8 — sample scroll velocity (rows/ms) before we mutate
    // scrollTop. `request` reads this to widen the fetched range on a fast
    // fling. We use the row-height index when present (variable heights) and
    // fall back to the theme's uniform row height otherwise.
    if (verticalChanged) {
      const now = performance.now();
      const dt = now - this.lastScrollSampleTime;
      if (dt > 0 && this.lastScrollSampleTime > 0 && dt < 200) {
        const idx = this.deps.getRowHeightIndex();
        const fallback = this.deps.getRowHeightFallback();
        const yRow = idx ? idx.rowAt(y) : Math.floor(y / fallback);
        const prevYRow = idx
          ? idx.rowAt(this.lastScrollSampleTop)
          : Math.floor(this.lastScrollSampleTop / fallback);
        this._scrollVelocityRows = (yRow - prevYRow) / dt;
      } else {
        this._scrollVelocityRows = 0;
      }
      this.lastScrollSampleTop = y;
      this.lastScrollSampleTime = now;
    }
    this._scrollLeft = x;
    this._scrollTop = y;
    this.recompute(/* afterScroll */ horizontal);
    this.deps.events.emit({
      type: 'viewportChanged',
      firstRow: this.currentState.firstRow,
      lastRow: this.currentState.lastRow,
    });
    // Cycle 23 / Task 3 — bodyScroll fires every tick. `direction` reports the
    // dominant axis change for THIS tick; ties (both axes moved) report
    // `'vertical'` so listeners get a stable signal for the more common case.
    this.deps.events.emit({
      type: 'bodyScroll', top: y, left: x,
      direction: verticalChanged ? 'vertical' : 'horizontal',
    });
    // Cycle 23 / Task 3 — bodyScrollEnd is debounced 200ms after the last
    // scroll tick. Subsequent scrolls reset the timer so apps that persist on
    // the END event save once per gesture instead of once per pixel.
    if (this.scrollEndTimer !== null) clearTimeout(this.scrollEndTimer);
    this.scrollEndTimer = setTimeout(() => {
      this.scrollEndTimer = null;
      if (this.deps.isDestroyed()) return;
      this.deps.events.emit({
        type: 'bodyScrollEnd', top: this._scrollTop, left: this._scrollLeft,
      });
    }, 200);
    this.deps.afterScrollTick();
    this.request();
  }

  // --- Scroll imperatives ---------------------------------------------------

  setScroll(x: number, y: number): void {
    const clampedX = Math.max(0, Math.min(this.currentState.maxScrollLeft, x));
    const clampedY = Math.max(0, Math.min(this.currentState.maxScrollTop, y));
    if (clampedX === this._scrollLeft && clampedY === this._scrollTop) return;
    // Drive the scroller; its scroll event will call onScrollerScroll which
    // updates internal state and repaints. Setting these properties also
    // visually moves the native scrollbar thumb.
    this.deps.scroller.scrollLeft = clampedX;
    this.deps.scroller.scrollTop = clampedY;
    // Belt-and-suspenders: if the scroll event hasn't fired yet (e.g., in
    // happy-dom tests), update synchronously so callers see the new state.
    if (this._scrollLeft !== clampedX || this._scrollTop !== clampedY) {
      this.onScrollerScroll(clampedX, clampedY);
    }
  }

  /** Bring the row at `rowIndex` into the visible body.
   *  `'auto'` scrolls just enough to expose the row (no-op if already in
   *  view); the named positions force `top` / `middle` / `bottom` alignment
   *  inside the body area. Clamping is delegated to `setScroll`.
   *
   *  Row top / height are read from the Fenwick tree when available so
   *  variable-height rows scroll to the right pixel (Cycle 5 / Task 7).
   *  Without an index — e.g. before the first chunk lands — we fall back to
   *  uniform-height arithmetic. */
  ensureRowIndexVisible(
    rowIndex: number,
    position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto',
  ): void {
    const fallback = this.deps.getRowHeightFallback();
    const idx = this.deps.getRowHeightIndex();
    const useIdx = idx !== null && rowIndex < idx.length();
    const top = useIdx ? idx!.topOf(rowIndex) : rowIndex * fallback;
    const rh = useIdx ? idx!.heightAt(rowIndex) : fallback;
    const bottom = top + rh;
    const bodyH = this.currentState.bodyHeight;
    if (position === 'top') {
      this.setScroll(this._scrollLeft, top);
      return;
    }
    if (position === 'middle') {
      this.setScroll(this._scrollLeft, top - Math.max(0, (bodyH - rh) / 2));
      return;
    }
    if (position === 'bottom') {
      this.setScroll(this._scrollLeft, bottom - bodyH);
      return;
    }
    if (top < this._scrollTop) {
      this.setScroll(this._scrollLeft, top);
    } else if (bottom > this._scrollTop + bodyH) {
      this.setScroll(this._scrollLeft, bottom - bodyH);
    }
  }

  /** Bring the column with `colId` into the visible body. Pinned columns are
   *  always visible. `'auto'` scrolls just enough; the named positions force
   *  `start` / `middle` / `end` alignment inside the body area. */
  ensureColIdVisible(
    colId: string,
    position: 'auto' | 'start' | 'middle' | 'end' = 'auto',
  ): void {
    const columnLayout = this.deps.getColumnLayout();
    const layoutCol = columnLayout.find((c) => c.colId === colId);
    if (!layoutCol || layoutCol.pinned) return;
    // Convert content-space left (relative to layout) into body-content space.
    const pinnedLeftWidth = columnLayout
      .filter((c) => c.pinned === 'left')
      .reduce((s, c) => s + c.width, 0);
    const left = layoutCol.left - pinnedLeftWidth;
    const right = left + layoutCol.width;
    const bodyW = this.currentState.bodyWidth;
    if (position === 'start') {
      this.setScroll(left, this._scrollTop);
      return;
    }
    if (position === 'middle') {
      this.setScroll(left - Math.max(0, (bodyW - layoutCol.width) / 2), this._scrollTop);
      return;
    }
    if (position === 'end') {
      this.setScroll(right - bodyW, this._scrollTop);
      return;
    }
    if (left < this._scrollLeft) {
      this.setScroll(left, this._scrollTop);
    } else if (right > this._scrollLeft + bodyW) {
      this.setScroll(right - bodyW, this._scrollTop);
    }
  }

  // --- Worker request entry point ------------------------------------------

  /** Coalesce a viewport fetch. `aggSource` tags the triggering mutation so
   *  the `aggregationChanged` event the response handler emits carries the
   *  correct cause. Pass `null` (default) for cosmetic re-fetches that don't
   *  recompute totals — scroll, sort, theme, column move / visible / pin /
   *  resize — so the response handler can tell "the totals are the same;
   *  suppress the event" apart from "data / filter / aggFuncs changed; emit".
   *  Most-recent-source wins when multiple data-affecting calls coalesce on
   *  a single in-flight fetch; null calls preserve any pending source. */
  request(aggSource: AggregationChangedSource | null = null): void {
    if (aggSource !== null) this.pendingAggSource = aggSource;
    if (this.requestPending) {
      this.requestQueued = true;
      return;
    }
    this.requestPending = true;
    const cols = this.currentState.visibleColumns.map((c) => c.colId);
    // Cycle 25 / Task 8 — widen the row range when scrolling fast so the
    // next chunk already covers the about-to-be-visible rows.
    // expandRangeForVelocity is a no-op when velocity is below the threshold
    // (most scroll ticks), so the request stays at the tight visible range
    // under normal interaction.
    const { rowStart, rowEnd } = expandRangeForVelocity(
      this.currentState.firstRow,
      this.currentState.lastRow + 1,
      this._scrollVelocityRows,
    );
    this.deps.dispatchViewportRequest({ rowStart, rowEnd, columns: cols })
      .then(() => {
        this.requestPending = false;
        if (this.requestQueued) {
          this.requestQueued = false;
          this.request(null);
        }
      })
      .catch((err) => {
        this.requestPending = false;
        this.requestQueued = false;
        if (!this.deps.isDestroyed()) console.error('[cgrid] viewport request:', err);
      });
  }

  /** Read + clear the pending aggregation source. Called from the chunk-arrival
   *  handler in CGrid so the right `aggregationChanged` source bubbles up even
   *  after coalesced requests overwrite the field mid-flight. Returns `null`
   *  when nothing is pending (cosmetic re-fetch path). */
  consumePendingAggSource(): AggregationChangedSource | null {
    const s = this.pendingAggSource;
    this.pendingAggSource = null;
    return s;
  }
}
