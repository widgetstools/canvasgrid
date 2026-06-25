/**
 * Cycle 7 / Task 9 — VirtualList<T>.
 *
 * Generic windowed-list primitive. Renders only the rows in the visible
 * viewport; off-window rows are unmounted (not just hidden) so a 50k-item
 * list costs the same DOM as a 50-item list. First consumer is the set
 * filter; Cycles 9+ reuse for the column chooser, advanced-filter side
 * panel, and tool panels.
 *
 * Performance contract:
 *   - Scroll → recompute slice → mount/unmount rows: zero
 *     `getBoundingClientRect` reads on the scroll path (cached
 *     `scrollTop` + fixed row height).
 *   - 50k items, 24px rows, 400px popup → renders ~17 rows per frame.
 *   - `setItems(newItems)` is O(visible), not O(items) — drops the
 *     cached slice + re-renders the visible window only.
 *
 * Inner DOM:
 *
 *   host (overflow: auto; the caller sets its own height/width)
 *     ├── sizer  (data-cg-vlist-sizer; absolute, height = items.length * rowHeight)
 *     └── window (data-cg-vlist-window; relative, holds the mounted rows)
 *           └── row[i] (data-cg-vlist-row, data-cg-vlist-index="<i>"; absolute, top: i * rowHeight)
 *
 * Rows are pooled by their item index (a `Map<number, HTMLElement>`).
 * Scrolling by one row reuses every previously-mounted DOM node whose
 * index is still within the window — only the rows that entered / left
 * the window churn.
 */

export interface VirtualListDeps<T> {
  /** Fixed row height in CSS px. Constant per VirtualList instance. */
  rowHeight: number;
  /** Builds the row DOM for `item`. Called once per mount; the returned
   *  element is reused across scrolls by index slot — NOT by item
   *  identity — so the renderer must overwrite all dynamic content. Return
   *  `null` to render an empty slot at that index. */
  renderRow: (item: T, index: number) => HTMLElement | null;
  /** Rows beyond the visible window to pre-mount. Defaults to 3. */
  overscan?: number;
}

export class VirtualList<T> {
  private destroyed = false;
  private items: T[] = [];
  private readonly rowHeight: number;
  private readonly overscan: number;
  private readonly renderRow: (item: T, index: number) => HTMLElement | null;
  private readonly host: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly window: HTMLElement;
  /** Currently-mounted rows keyed by item index. */
  private mounted = new Map<number, HTMLElement>();
  private firstMounted = 0;
  private lastMounted = -1;
  private prevOverflow: string;
  private prevPosition: string;
  private readonly onScroll = (): void => this.recompute();

  constructor(host: HTMLElement, deps: VirtualListDeps<T>) {
    this.host = host;
    this.rowHeight = deps.rowHeight;
    this.overscan = deps.overscan ?? 3;
    this.renderRow = deps.renderRow;
    this.prevOverflow = host.style.overflow;
    this.prevPosition = host.style.position;
    // The caller sets the host's outer height; we just guarantee it's a
    // scroll container with a positioned origin for the absolute children.
    if (host.style.overflow === '' || host.style.overflow === 'visible') {
      host.style.overflow = 'auto';
    }
    if (host.style.position === '' || host.style.position === 'static') {
      host.style.position = 'relative';
    }
    this.sizer = document.createElement('div');
    this.sizer.setAttribute('data-cg-vlist-sizer', '');
    this.sizer.style.cssText = 'position:absolute; left:0; top:0; width:1px; pointer-events:none;';
    this.window = document.createElement('div');
    this.window.setAttribute('data-cg-vlist-window', '');
    this.window.style.cssText = 'position:absolute; left:0; top:0; right:0;';
    host.appendChild(this.sizer);
    host.appendChild(this.window);
    host.addEventListener('scroll', this.onScroll);
  }

  /** Replace the item set. Resets scroll to top by default; pass
   *  `{ preserveScroll: true }` to keep `scrollTop` (the mini-search in
   *  the set filter relies on this so typing doesn't yank the user
   *  back to row 0). When `preserveScroll` is set but the new content
   *  is too short to support the previous scrollTop, the browser
   *  natively clamps to `maxScrollTop` after the sizer resizes. */
  setItems(items: T[], opts?: { preserveScroll?: boolean }): void {
    if (this.destroyed) return;
    this.items = items;
    this.sizer.style.height = `${items.length * this.rowHeight}px`;
    // Wipe the pool — index N in the old list usually does not point
    // at the same item in the new list (a mini-search filters the
    // distinct values, so previously-mounted indices are pointing at
    // values that may no longer exist). The next recompute repopulates
    // the visible window from scratch.
    for (const el of this.mounted.values()) el.remove();
    this.mounted.clear();
    this.firstMounted = 0;
    this.lastMounted = -1;
    if (opts?.preserveScroll !== true) {
      // Assign scrollTop directly so the browser does not fire a scroll
      // event during the assignment loop — we'll recompute manually.
      this.host.scrollTop = 0;
    } else {
      // Clamp to the new content extent so a shrink (mini-search
      // narrows from 10k → 5 distinct values) doesn't leave the
      // scroller parked past the new max. Real browsers clamp natively
      // on layout; we do it explicitly so the same code path works in
      // happy-dom and so the post-clamp recompute sees the right
      // scrollTop.
      const maxScroll = Math.max(0, items.length * this.rowHeight - this.host.clientHeight);
      if (this.host.scrollTop > maxScroll) {
        this.host.scrollTop = maxScroll;
      }
    }
    this.recompute();
  }

  /** Bring the row at `index` into view. No-op for out-of-range. */
  scrollToIndex(index: number): void {
    if (this.destroyed) return;
    if (index < 0 || index >= this.items.length) return;
    this.host.scrollTop = index * this.rowHeight;
    this.recompute();
  }

  /** Returns the inclusive [first, last] mounted index range — includes
   *  overscan. Used by tests + scroll-driven a11y announcements. */
  visibleRange(): { first: number; last: number } {
    return { first: this.firstMounted, last: this.lastMounted };
  }

  /** Re-invoke `renderRow` for every mounted index — used when an
   *  external mutation (a checkbox toggle in the set filter) flips a
   *  row's `checked` state and the visible window needs to repaint. */
  refresh(): void {
    if (this.destroyed) return;
    const first = this.firstMounted;
    const last = this.lastMounted;
    for (const el of this.mounted.values()) el.remove();
    this.mounted.clear();
    this.firstMounted = 0;
    this.lastMounted = -1;
    if (last < first) return;
    this.mountRange(first, last);
  }

  /** Tear down — removes the inner DOM scaffold and the scroll listener.
   *  Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.host.removeEventListener('scroll', this.onScroll);
    for (const el of this.mounted.values()) el.remove();
    this.mounted.clear();
    this.sizer.remove();
    this.window.remove();
    this.host.style.overflow = this.prevOverflow;
    this.host.style.position = this.prevPosition;
  }

  /** Single-pass diff between the previous mounted range and the new one
   *  derived from `scrollTop` + `clientHeight`. Removes rows that left
   *  the window, mounts rows that entered. Reuses every row in the
   *  intersection. */
  private recompute(): void {
    if (this.destroyed) return;
    const count = this.items.length;
    if (count === 0) {
      for (const el of this.mounted.values()) el.remove();
      this.mounted.clear();
      this.firstMounted = 0;
      this.lastMounted = -1;
      return;
    }
    const scrollTop = this.host.scrollTop;
    // clientHeight is one layout read per scroll event — unavoidable
    // because the host can resize between scrolls and we can't cache.
    // It does NOT trigger a forced reflow because we never wrote DOM in
    // this turn before the read.
    const clientHeight = this.host.clientHeight;
    const rh = this.rowHeight;
    const firstVisible = Math.max(0, Math.floor(scrollTop / rh));
    // `clientHeight - 1` keeps the last fully-rendered index in-range
    // when `(scrollTop + clientHeight)` lands exactly on a row boundary
    // (otherwise `ceil` over-counts by one).
    const lastVisible = Math.max(
      firstVisible,
      Math.floor((scrollTop + Math.max(0, clientHeight - 1)) / rh),
    );
    const firstMount = Math.max(0, firstVisible - this.overscan);
    const lastMount = Math.min(count - 1, lastVisible + this.overscan);

    // Drop rows that left the window.
    if (this.lastMounted >= this.firstMounted) {
      for (let i = this.firstMounted; i <= this.lastMounted; i++) {
        if (i < firstMount || i > lastMount) {
          const el = this.mounted.get(i);
          if (el) {
            el.remove();
            this.mounted.delete(i);
          }
        }
      }
    }

    // Mount rows that entered.
    this.mountRange(firstMount, lastMount);

    this.firstMounted = firstMount;
    this.lastMounted = lastMount;
  }

  /** Mount every index in `[first, last]` that isn't already mounted. */
  private mountRange(first: number, last: number): void {
    for (let i = first; i <= last; i++) {
      if (this.mounted.has(i)) continue;
      const item = this.items[i];
      if (item === undefined) continue;
      const el = this.renderRow(item, i);
      if (!el) continue;
      el.setAttribute('data-cg-vlist-row', '');
      el.setAttribute('data-cg-vlist-index', String(i));
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.right = '0';
      el.style.top = `${i * this.rowHeight}px`;
      el.style.height = `${this.rowHeight}px`;
      this.window.appendChild(el);
      this.mounted.set(i, el);
    }
  }
}
