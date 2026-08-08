// Cycle 19 / Task 2 — owns the scroll/viewport subsystem extracted from
// VelocityGrid: scroll-state fields, the native `'scroll'` listener (routed through
// the host's DisposableRegistry), `computeCurrentViewport` + `syncSizer`,
// the velocity sampler used by the prefetch-range expansion, the
// request-coalescing flags around the worker viewport fetch, and the
// `setScroll` / `ensure*Visible` scroll-imperative helpers.
//
// VelocityGrid is the thin delegator: `this.viewport` (the ViewportState) is still
// VelocityGrid's read-only field — `recompute()` returns the new state which VelocityGrid
// assigns back so the 100+ readers of `viewport.visibleColumns` etc. don't
// have to change. The seam pulls the chunk-processing tail of `requestViewport`
// out as the `dispatchViewportRequest` dep: ViewportManager owns coalescing,
// prefetch-range math, and the `request` entry point; VelocityGrid (until cycle 19 /
// task 3 lands `WorkerCoordinator`) owns the worker call + chunk plumbing.
// The split was deliberately chosen so this extraction stays pure-viewport
// and surfaces the worker-pipeline coupling instead of dragging half the
// grid into the viewport module.

import type { TypedEventEmitter } from './eventEmitter';
import type { DisposableRegistry } from './disposable';
import type { ColumnLayout } from './layout';
import type { Subgrid } from './subgrid';
import type { RowHeightIndex } from './rowHeightIndex';
import type { AggregationChangedSource, VelocityGridEvent } from '../types';
import { computeViewport, type ViewportState } from './viewport';
import { expandRangeForScrollDelta, expandRangeForVelocity } from './prefetchRange';

/** Subset of VelocityGridOptions the viewport math reads. Passed through a
 *  closure so per-tick `setGridOption` flips light up on the next
 *  recompute without re-wiring the manager. */
export interface ViewportComputeOptions {
  rowBuffer?: number;
  suppressColumnVirtualisation?: boolean;
  suppressRowVirtualisation?: boolean;
  domLayout?: 'normal' | 'autoHeight' | 'print';
  rowHeight?: number;
  /** Paint-cache layer (Task 3 / spec §1 "Fetch window coupling") — when
   *  not explicitly `false` (the default), the row overscan that feeds
   *  `computeViewport`'s `firstRow`/`lastRow` widens so the worker fetch
   *  window covers the retained layer's coverage, not just the on-screen
   *  rows. `false` reproduces today's overscan exactly. */
  paintCache?: boolean;
  /** Coverage margin (× bodyHeight) the paint-cache layer banks on each
   *  side of the visible body. Defaults to `1` (Deephaven
   *  `ROW_BUFFER_PAGES = 1` — one viewport page above AND below); clamped
   *  to `[0, 2]`. */
  paintCacheOverscan?: number;
}

export interface ViewportManagerDeps {
  disposables: DisposableRegistry;
  events: TypedEventEmitter<VelocityGridEvent>;
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
   *  VelocityGrid uses this to `requestRepaint()` and re-anchor any open
   *  inline editor. Separate from `afterRecompute` so non-scroll
   *  recomputes (resize, column mutation, group toggle) don't repaint
   *  out of band. */
  afterScrollTick(): void;
  isDestroyed(): boolean;

  // --- Worker-pipeline seam. ---
  /** Fire the actual worker fetch for the velocity-expanded range and
   *  process the response (chunk → state mutations + events). Owned by
   *  VelocityGrid until cycle 19 / task 3 extracts `WorkerCoordinator`. */
  dispatchViewportRequest(opts: {
    rowStart: number;
    rowEnd: number;
    columns: string[];
    /** Task 5 (paint-cache layer) fix — the true on-screen first-visible
     *  row (unpadded by row overscan), so the worker's sticky-ancestor
     *  computation tracks the real scroll position rather than the
     *  (now overscan-widened) fetch window. See `ViewportState.
     *  firstVisibleDataRow`'s doc for the full regression story. */
    stickyBoundaryRow: number;
    /** Monotonic request id — chunk handler ignores replies whose seq is
     *  older than `ViewportManager.viewportReqSeq` (Deephaven latest-wins
     *  `subscription.setViewport` while a prior fetch is in flight). */
    seq: number;
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
  /** Row delta of the most recent vertical scroll tick (signed). Used to
   *  prefetch on idle PageDown / keyboard jumps when velocity samples as 0. */
  private _lastScrollDeltaRows = 0;
  private lastScrollSampleTop = 0;
  private lastScrollSampleTime = 0;
  /** Last range posted to the worker (after prefetch expansion). Scroll
   *  throttle is bypassed when the live viewport leaves this window so
   *  key-repeat / PageDown cannot paint past the in-flight chunk. */
  private lastDispatchedRange: { rowStart: number; rowEnd: number } | null = null;
  /** Cycle 26 (W3) — column ids of the last dispatched fetch (buffered
   *  window, see `columnFetchWindow`). The throttle bypass consults this
   *  so horizontal scroll into an unfetched column fetches immediately. */
  private lastDispatchedCols: Set<string> | null = null;
  /** Cycle 26 (scroll-coalescing) — bodyHeight committed by the last
   *  viewport compute. The widened-overscan rowBuffer derives from it, so
   *  caching it collapses the old base+widened double `computeViewport`
   *  into a single pass on every steady scroll tick (bodyHeight is
   *  scroll-invariant; a resize mismatch self-corrects with one extra
   *  pass). `null` until the first compute. */
  private lastBufferBodyHeight: number | null = null;
  /** Cycle 26 (scroll-coalescing) — inputs of the last applied sizer
   *  update. Scroll changes neither the content extent (`maxScroll*`) nor
   *  the canvas bounds, so `syncSizer` skips its DOM reads + style writes
   *  entirely while these match. `null` forces the first application. */
  private lastSizerKey: { msl: number; mst: number; bw: number; bh: number } | null = null;

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
  /** Deephaven `SET_VIEWPORT_THROTTLE` (150ms) — scroll-driven fetches are
   *  leading+trailing throttled so the first scroll tick fetches immediately
   *  while continuous thumb-drag collapses to ~one fetch / 150ms at the
   *  latest window. Data-affecting requests bypass this. */
  private static readonly SCROLL_VIEWPORT_THROTTLE_MS = 150;
  private scrollRequestTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollRequestWanted = false;
  private lastScrollDispatchAt = 0;
  /** Latest-wins sequence — bumped on every dispatched fetch. */
  private _viewportReqSeq = 0;

  /** Current viewport request sequence (for stale-chunk rejection). */
  get viewportReqSeq(): number { return this._viewportReqSeq; }

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
      if (this.scrollRequestTimer !== null) {
        clearTimeout(this.scrollRequestTimer);
        this.scrollRequestTimer = null;
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
  recompute(afterScroll: boolean = false, skipColumnDetection = false): ViewportState {
    this.currentState = this.computeCurrentViewport();
    this.syncSizer();
    // Cycle 26 (scroll-coalescing) — a vertical-only scroll tick cannot
    // move the horizontal virtualization window, so its caller passes
    // `skipColumnDetection` and the first/last-center-column scan is
    // skipped. Every other caller (resize, column mutation, horizontal
    // scroll) still detects.
    if (!skipColumnDetection) this.detectVirtualColumnsChanged(afterScroll);
    this.deps.afterRecompute(this.currentState);
    return this.currentState;
  }

  private computeCurrentViewport(): ViewportState {
    // Use the canvas drawable width (which subtracts the scrollbar gutter on
    // overlay-scrollbar platforms — see VelocityGridCanvas.measureSize). Falling back
    // to scroller.clientWidth would leave the rightmost right-pinned column
    // extending into the gutter, clipped by the canvas right edge.
    const { scroller, root } = this.deps;
    const bounds = this.deps.getCanvasBounds();
    const w = bounds.width || scroller.clientWidth || root.clientWidth || 800;
    const h = bounds.height || scroller.clientHeight || root.clientHeight || 600;
    const opts = this.deps.getOptions();
    const baseArgs = {
      columnLayout: this.deps.getColumnLayout(),
      subgrids: this.deps.getSubgrids(),
      containerWidth: w,
      containerHeight: h,
      scrollLeft: this._scrollLeft,
      scrollTop: this._scrollTop,
      // Cycle 20 / Task 6 — `domLayout: 'print'` forces every row + every
      // column to materialise so the browser print path captures the
      // entire grid.
      suppressColumnVirtualisation:
        opts.suppressColumnVirtualisation || opts.domLayout === 'print',
      suppressRowVirtualisation:
        opts.suppressRowVirtualisation || opts.domLayout === 'print',
      dataRowHeightIndex: this.deps.getRowHeightIndex() ?? undefined,
    };
    // Task 3 (paint-cache layer, spec §1 "Fetch window coupling") — widen
    // the row overscan that feeds `firstRow`/`lastRow` (and therefore the
    // worker fetch window, see `request()` below) so it spans the retained
    // layer's coverage, not just the on-screen rows. `paintCache: false` is
    // the field escape hatch with its own Deephaven ROW_BUFFER_PAGES=1
    // lean-path buffer; an explicit `rowBuffer` reproduces the exact
    // overscan on either path.
    //
    // Cycle 26 (scroll-coalescing) — the widened buffer derives from
    // `bodyHeight`, which is SCROLL-INVARIANT (container height + subgrid
    // chrome; only resize / theme / subgrid changes move it). The previous
    // shape computed a throwaway base viewport every call just to read
    // `bodyHeight` off it — doubling `computeViewport`'s work + row/column
    // array allocations on EVERY scroll event. Instead, predict the buffer
    // from the last committed `bodyHeight` and verify after the single
    // pass; a mismatch (resize landing this exact tick) self-corrects with
    // one extra pass, exactly the old cost.
    const rowHeightFallback = this.deps.getRowHeightFallback() || 1;
    const widenedBufferFor = (bodyHeight: number): number | undefined => {
      if (opts.paintCache === false) {
        // Deephaven ROW_BUFFER_PAGES=1 on the lean path when the app did
        // not set an explicit rowBuffer — buffer ~one viewport each side.
        if (opts.rowBuffer !== undefined) return opts.rowBuffer;
        const pageRows = Math.max(1, Math.ceil(bodyHeight / rowHeightFallback));
        return pageRows <= 3 ? opts.rowBuffer : pageRows;
      }
      // Deephaven ROW_BUFFER_PAGES=1 → default overscan of one bodyHeight
      // each side (was 0.5). Explicit paintCacheOverscan still wins.
      const paintCacheOverscan = Math.max(0, Math.min(2, opts.paintCacheOverscan ?? 1));
      const overscanPx = paintCacheOverscan * bodyHeight;
      const widenedRows = Math.ceil(overscanPx / rowHeightFallback);
      const baseOverscan = opts.rowBuffer ?? 3;
      const widened = Math.max(baseOverscan, widenedRows);
      return widened <= baseOverscan ? opts.rowBuffer : widened;
    };
    const predictedBodyH = this.lastBufferBodyHeight;
    if (predictedBodyH !== null) {
      const state = computeViewport({
        ...baseArgs,
        rowBuffer: widenedBufferFor(predictedBodyH),
      });
      if (state.bodyHeight === predictedBodyH) return state;
      // bodyHeight moved under us (resize this tick) — re-derive from the
      // actual value and take the corrective second pass.
      this.lastBufferBodyHeight = state.bodyHeight;
      const corrected = widenedBufferFor(state.bodyHeight);
      if (corrected === widenedBufferFor(predictedBodyH)) return state;
      return computeViewport({ ...baseArgs, rowBuffer: corrected });
    }
    // First compute (no committed bodyHeight yet) — the original two-pass
    // shape: base pass to learn bodyHeight, widened pass if it differs.
    const state = computeViewport({ ...baseArgs, rowBuffer: opts.rowBuffer });
    this.lastBufferBodyHeight = state.bodyHeight;
    const buffer = widenedBufferFor(state.bodyHeight);
    if (buffer === opts.rowBuffer) return state;
    return computeViewport({ ...baseArgs, rowBuffer: buffer });
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
    // Cycle 26 (scroll-coalescing) — the sizer's extent depends on the
    // content overflow (`maxScroll*`) and the client box, neither of which
    // a scroll-position change can move. Skipping the no-op refresh keeps
    // the per-scroll-event path free of `clientWidth`/`clientHeight` reads
    // (forced-layout hazards) and style writes. Canvas bounds stand in for
    // the client box in the key: every path that resizes the scroller also
    // re-measures the canvas (`VelocityGridCanvas.resize` → recompute), so a
    // client-box change always lands here with fresh bounds.
    const bounds = this.deps.getCanvasBounds();
    const key = {
      msl: this.currentState.maxScrollLeft,
      mst: this.currentState.maxScrollTop,
      bw: bounds.width,
      bh: bounds.height,
    };
    const last = this.lastSizerKey;
    if (last !== null
      && last.msl === key.msl && last.mst === key.mst
      && last.bw === key.bw && last.bh === key.bh) return;
    this.lastSizerKey = key;
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
   *  VelocityGrid's back-compat `onScrollerScroll` shim (and the existing E2E /
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
      const idx = this.deps.getRowHeightIndex();
      const fallback = this.deps.getRowHeightFallback();
      const yRow = idx ? idx.rowAt(y) : Math.floor(y / fallback);
      const prevYRow = idx
        ? idx.rowAt(this.lastScrollSampleTop)
        : Math.floor(this.lastScrollSampleTop / fallback);
      const deltaRows = yRow - prevYRow;
      this._lastScrollDeltaRows = deltaRows;
      if (dt > 0 && this.lastScrollSampleTime > 0 && dt < 200) {
        this._scrollVelocityRows = deltaRows / dt;
      } else if (Math.abs(deltaRows) >= 8) {
        // Idle keyboard Page*/Ctrl+jump — velocity would otherwise stay 0
        // (sample gap ≥ 200ms) and skip directional prefetch. Use a short
        // synthetic dt so a 500ms idle gap doesn't crush 10 rows into
        // 0.02 rows/ms (below the prefetch threshold).
        this._scrollVelocityRows = deltaRows / 16;
      } else {
        this._scrollVelocityRows = 0;
      }
      this.lastScrollSampleTop = y;
      this.lastScrollSampleTime = now;
    } else {
      this._lastScrollDeltaRows = 0;
    }
    this._scrollLeft = x;
    this._scrollTop = y;
    this.recompute(/* afterScroll */ horizontal, /* skipColumnDetection */ !horizontal);
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
    this.request(null, 'scroll');
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
   *  a single in-flight fetch; null calls preserve any pending source.
   *
   *  Scroll-driven calls (`kind === 'scroll'` — the `onScrollerScroll`
   *  tick is the only such site) are leading+trailing throttled at 150ms
   *  (Deephaven `SET_VIEWPORT_THROTTLE`) so continuous thumb-drag paints
   *  every frame while the worker only sees the latest window.
   *
   *  Every OTHER caller is model/layout-driven (pivot flip, sort, filter,
   *  group model, column virtualization change, …) and dispatches
   *  IMMEDIATELY regardless of `aggSource` — `aggSource === null` must
   *  never be read as "scroll-driven": cosmetic refetches (e.g. a pivot
   *  mode flip) pass null yet the user is waiting on the result. Routing
   *  those through the scroll throttle added up to 150ms of latency to
   *  every data operation that followed a recent fetch (and broke the
   *  pivot integration suite, which observes results ~50ms after the
   *  flip). */
  request(
    aggSource: AggregationChangedSource | null = null,
    kind: 'scroll' | 'data' = 'data',
  ): void {
    if (aggSource !== null) this.pendingAggSource = aggSource;
    if (kind !== 'scroll') {
      // Model/layout-driven: flush any pending scroll throttle and
      // dispatch now.
      this.flushScrollThrottleAndDispatch();
      return;
    }
    const now = performance.now();
    const elapsed = now - this.lastScrollDispatchAt;
    const throttle = ViewportManager.SCROLL_VIEWPORT_THROTTLE_MS;
    // Viewport left the last posted window (key-repeat / PageDown past the
    // buffer) — fetch immediately so live paint does not sit on empty cells
    // for a full throttle period.
    if (this.viewportUncoveredByLastDispatch()) {
      this.flushScrollThrottleAndDispatch();
      return;
    }
    // Leading edge — first scroll (or >throttle since last) dispatches now.
    if (this.lastScrollDispatchAt === 0 || elapsed >= throttle) {
      this.scrollRequestWanted = false;
      this.lastScrollDispatchAt = now;
      this.dispatchRequest();
      return;
    }
    // Trailing edge — schedule one follow-up at the latest window.
    this.scrollRequestWanted = true;
    if (this.scrollRequestTimer !== null) return;
    this.scrollRequestTimer = setTimeout(() => {
      this.scrollRequestTimer = null;
      if (!this.scrollRequestWanted) return;
      this.scrollRequestWanted = false;
      this.lastScrollDispatchAt = performance.now();
      this.dispatchRequest();
    }, throttle - elapsed);
  }

  private flushScrollThrottleAndDispatch(): void {
    if (this.scrollRequestTimer !== null) {
      clearTimeout(this.scrollRequestTimer);
      this.scrollRequestTimer = null;
    }
    this.scrollRequestWanted = false;
    this.lastScrollDispatchAt = performance.now();
    this.dispatchRequest();
  }

  /** True when the live overscan window is not fully inside the last
   *  dispatched fetch range (or nothing has been dispatched yet).
   *
   *  Cycle 26 (W3) — columns count too: a horizontal scroll that brings a
   *  column OUTSIDE the last dispatched column set into view must fetch
   *  immediately, not sit out the scroll throttle painting blank cells —
   *  the exact horizontal twin of the key-repeat/PageDown row bypass. */
  private viewportUncoveredByLastDispatch(): boolean {
    const needStart = this.currentState.firstRow;
    const needEnd = this.currentState.lastRow + 1;
    const last = this.lastDispatchedRange;
    if (last === null) return true;
    if (needStart < last.rowStart || needEnd > last.rowEnd) return true;
    const lastCols = this.lastDispatchedCols;
    if (lastCols === null) return true;
    for (const c of this.currentState.visibleColumns) {
      if (!lastCols.has(c.colId)) return true;
    }
    return false;
  }

  /** Cycle 26 (W3) — the COLUMN fetch window: visible columns plus one
   *  bodyWidth of buffered center columns on EACH side (Deephaven
   *  `COLUMN_BUFFER_PAGES = 1` — the row half of that contract was ported
   *  long ago; the column half was not, so every horizontally-entering
   *  column painted BLANK for a throttle period + worker round-trip while
   *  its data was fetched). Built as a UNION with the live visible set so
   *  it can never be narrower than today's behavior
   *  (`suppressColumnVirtualisation` keeps its all-columns fetch, pinned
   *  columns stay included, zero-width edge cases degrade to visible). */
  private columnFetchWindow(): string[] {
    const vs = this.currentState;
    const visible = vs.visibleColumns.map((c) => c.colId);
    const bodyW = vs.bodyWidth;
    if (bodyW <= 0) return visible;
    const layout = this.deps.getColumnLayout();
    if (layout.length === 0) return visible;
    let pinnedLeftWidth = 0;
    for (const c of layout) {
      if (c.pinned === 'left') pinnedLeftWidth += c.width;
    }
    // Center content-space window: visible span ± one bodyWidth per side.
    const winStart = this._scrollLeft - bodyW;
    const winEnd = this._scrollLeft + 2 * bodyW;
    const set = new Set(visible);
    const out = visible.slice();
    for (const c of layout) {
      if (set.has(c.colId)) continue;
      if (c.pinned) { set.add(c.colId); out.push(c.colId); continue; }
      const left = c.left - pinnedLeftWidth;
      if (left < winEnd && left + c.width > winStart) {
        set.add(c.colId);
        out.push(c.colId);
      }
    }
    return out;
  }

  private dispatchRequest(): void {
    if (this.requestPending) {
      this.requestQueued = true;
      return;
    }
    this.requestPending = true;
    const seq = ++this._viewportReqSeq;
    // Cycle 26 (W3) — fetch a buffered column window, not just the visible
    // columns (see `columnFetchWindow`). Painting still iterates only the
    // visible set; the buffer exists so horizontally-entering columns have
    // data the instant they appear.
    const cols = this.columnFetchWindow();
    this.lastDispatchedCols = new Set(cols);
    // Cycle 25 / Task 8 — widen the row range when scrolling fast so the
    // next chunk already covers the about-to-be-visible rows.
    // expandRangeForVelocity is a no-op when velocity is below the threshold
    // (most scroll ticks), so the request stays at the tight visible range
    // under normal interaction. Idle Page*/keyboard jumps also widen via
    // expandRangeForScrollDelta (velocity often samples as 0).
    const baseStart = this.currentState.firstRow;
    const baseEnd = this.currentState.lastRow + 1;
    const velocityExpanded = expandRangeForVelocity(
      baseStart,
      baseEnd,
      this._scrollVelocityRows,
    );
    const { rowStart, rowEnd } = expandRangeForScrollDelta(
      velocityExpanded.rowStart,
      velocityExpanded.rowEnd,
      this._lastScrollDeltaRows,
    );
    this.lastDispatchedRange = { rowStart, rowEnd };
    const stickyBoundaryRow = this.currentState.firstVisibleDataRow ?? this.currentState.firstRow;
    this.deps.dispatchViewportRequest({
      rowStart, rowEnd, columns: cols, stickyBoundaryRow, seq,
    })
      .then(() => {
        this.requestPending = false;
        if (this.requestQueued) {
          this.requestQueued = false;
          this.dispatchRequest();
        }
      })
      .catch((err) => {
        this.requestPending = false;
        this.requestQueued = false;
        if (!this.deps.isDestroyed()) console.error('[velocity-grid] viewport request:', err);
      });
  }

  /** Read + clear the pending aggregation source. Called from the chunk-arrival
   *  handler in VelocityGrid so the right `aggregationChanged` source bubbles up even
   *  after coalesced requests overwrite the field mid-flight. Returns `null`
   *  when nothing is pending (cosmetic re-fetch path). */
  consumePendingAggSource(): AggregationChangedSource | null {
    const s = this.pendingAggSource;
    this.pendingAggSource = null;
    return s;
  }
}
