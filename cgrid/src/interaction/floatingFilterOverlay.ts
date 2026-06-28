import type { ViewportState } from '../core/viewport';
import type { CFilterModelEntry } from '../types';
import { parseFloatingFilterInput, type FilterColumnType } from './floatingFilterParser';

/**
 * Resolved per-column metadata the overlay reads to decide whether to mount
 * an input for `colId`. Mirrors the relevant slots from `ResolvedColDef`
 * without forcing the overlay to import the resolver.
 *
 * Cycle 7 / Task 1.
 */
export interface FloatingFilterColDef {
  /** Per-column resolution of grid-level `CGridOptions.floatingFilter`. When
   *  `false` (explicit), the overlay skips the column entirely. */
  floatingFilter?: boolean;
  /** Resolved filter type. Currently used only as metadata in `data-*`
   *  attributes; popup wiring lands in Tasks 3-6 + 9. */
  filter?: 'text' | 'number' | 'date' | 'set';
  /** Resolved cell data type (`'text'` / `'number'`). Used as a fallback
   *  signal for "this is a numeric column" when `filter` is unset — drives
   *  the operator-hint placeholder. Cycle 7 / Task 1. */
  cellDataType?: 'text' | 'number';
  /** When true, the floating cell renders the input without the expand
   *  button (popup entry-point). Task 1 has no expand button yet; this
   *  field reserves the contract so the deps interface is stable. */
  suppressFloatingFilterButton?: boolean;
}

export interface FloatingFilterOverlayDeps {
  /** Current filter model entry for `colId`, or null when the column is
   *  unfiltered. Drives `<input>.value` on mount and after a programmatic
   *  `setFilterModel` round-trip. */
  getColumnFilterModel: (colId: string) => CFilterModelEntry | null;
  /** Apply a filter mutation. Called by the overlay after the typing
   *  debounce; `model: null` clears the column's filter. Cycle 7 /
   *  Task 9 widened the return type to `Promise<void> | void` so cgrid
   *  can await the worker round-trip from `CGridApi.setColumnFilterModel`
   *  callers while the overlay continues to fire-and-forget. */
  setColumnFilterModel: (colId: string, model: CFilterModelEntry | null) => Promise<void> | void;
  /** Resolved per-column floating-filter metadata. Returning `undefined`
   *  collapses to "no input" for that column. */
  getColDef: (colId: string) => FloatingFilterColDef | undefined;
  /** Open the column's full filter popup. Wired by Tasks 3-6 + 9; Task 1
   *  reserves the hook so the deps interface is stable. */
  openColumnFilter: (colId: string) => void;
  /** Y-coordinate (in container CSS px) of the floating-filter row's top
   *  edge. Read on every `repositionAll`; the overlay applies it via
   *  `transform: translate(x, y)`. */
  getRowTop: () => number;
  /** Pixel height of the floating-filter row. Drives `<input>.style.height`. */
  getRowHeight: () => number;
  /** Optional override of the per-input typing debounce. Defaults to 500ms
   *  to match the catalog's text/number filter `debounceMs` default. */
  debounceMs?: number;
}

/** A pool entry — one per column that's ever been mounted. Each entry
 *  groups the wrapper cell (positioned via transform on every
 *  `repositionAll`), the input, the clear button, and (for columns
 *  that have a resolved popup-capable filter and aren't opted out via
 *  `suppressFloatingFilterButton`) the expand button that opens the
 *  full filter popup. Cycle 7 / Task 1 + Task 3. */
interface PoolEntry {
  wrapper: HTMLDivElement;
  input: HTMLInputElement;
  clearBtn: HTMLButtonElement;
  expandBtn: HTMLButtonElement | null;
}

/**
 * DOM overlay that pools input cells for the floating-filter row.
 *
 * Each cell is an absolutely-positioned wrapper holding the column's
 * `<input>` plus a clear `×` button. Wrappers are mounted once and
 * re-positioned via `transform: translate(x, y)` on every
 * `repositionAll` — never destroyed and never positioned via
 * `left`/`top`, so horizontal scroll incurs zero layout reads. Cells
 * whose column scrolls out of the visible set become `display:none`
 * instead of being removed; this preserves IME, autocomplete, and
 * selection state across scroll-out / scroll-in cycles.
 *
 * Cycle 7 / Task 1.
 */
export class FloatingFilterOverlay {
  private pool = new Map<string, PoolEntry>();
  private debouncers = new Map<string, ReturnType<typeof setTimeout>>();
  private destroyed = false;

  constructor(
    private host: HTMLElement,
    private deps: FloatingFilterOverlayDeps,
  ) {}

  /** Reposition every pooled cell against `viewport`. Walks the visible
   *  column set, creates cells lazily for newly-visible columns, and
   *  hides (does not destroy) cells whose columns left the visible set.
   *
   *  Cycle 7 / Task 1.
   */
  repositionAll(viewport: ViewportState): void {
    if (this.destroyed) return;
    // When floatingFilterRowTop is undefined, the FloatingFilterSubgrid
    // contributed 0 rows (isFloatingFilterEnabled() returned false).
    // Hide every pooled input and bail — nothing should overlay the header.
    if (viewport.floatingFilterRowTop === undefined) {
      for (const [, entry] of this.pool) {
        entry.wrapper.style.display = 'none';
      }
      return;
    }
    const rowTop = this.deps.getRowTop();
    const rowHeight = this.deps.getRowHeight();
    // Inset the cell inside its column rect so the input border + padding
    // land visually between the cell edges. Matched in `tokens.css`.
    const INSET_X = 6;
    const INSET_Y = 4;
    const seen = new Set<string>();
    for (const col of viewport.visibleColumns) {
      const def = this.deps.getColDef(col.colId);
      if (!def || def.floatingFilter === false) continue;
      seen.add(col.colId);
      const entry = this.acquireCell(col.colId, def);
      // Hide cells whose column has scrolled out of its own band.
      // Center cells must sit fully inside `[bodyLeft, bodyRight]` —
      // a center column that has scrolled into the pinned-left zone
      // (or past the right pinned edge) otherwise renders its input
      // *over* the pinned columns' filter cells. Pinned cells always
      // pass: their `col.left` / `col.right` are anchored to their
      // band by definition.
      //
      // Cycle 12 / Task 3 — the data-subgrid overlays (focus ring,
      // range, DOM editor) delegate this to CGrid.getVisibleCellBounds.
      // The floating-filter row lives on the floating-filter subgrid,
      // not the data subgrid, so `getVisibleCellBounds` (whose row arg
      // resolves against data rows) can't represent it. The vertical
      // band check the helper does is also unnecessary here — the
      // floating-filter row sits at a fixed top supplied by
      // `getRowTop`; it doesn't move with scroll. We keep the inline
      // column-band check and accept the local `bodyLeft` /
      // `bodyRight` reads. Pragmatism over ideology — the plan
      // explicitly carves this case out.
      const inBand = col.pinned === 'left' || col.pinned === 'right'
        ? true
        : col.left >= viewport.bodyLeft && col.right <= viewport.bodyRight;
      if (!inBand) {
        entry.wrapper.style.display = 'none';
        continue;
      }
      entry.wrapper.style.transform = `translate(${col.left + INSET_X}px, ${rowTop + INSET_Y}px)`;
      entry.wrapper.style.width = `${Math.max(0, col.width - INSET_X * 2)}px`;
      entry.wrapper.style.height = `${Math.max(0, rowHeight - INSET_Y * 2)}px`;
      entry.wrapper.style.display = '';
    }
    for (const [colId, entry] of this.pool) {
      if (!seen.has(colId)) entry.wrapper.style.display = 'none';
    }
  }

  /** Reflect `model` into the pooled input for `colId`. Used by
   *  programmatic `setColumnFilterModel` callers so the visible input
   *  tracks the active filter. No-op when the column has no input yet —
   *  `repositionAll` will pick up the latest filter model when the
   *  column next enters the visible set.
   *
   *  Behaviour by entry shape:
   *  - simple v2 entry with a `.filter` field → show that value as a string
   *  - `null` / multi-condition / set / complex entries → leave the
   *    input alone. Null in particular preserves the user's in-flight
   *    typing when the parser couldn't make sense of it — the row set
   *    returns to its unfiltered state but the user keeps the text
   *    they were composing so they can correct it.
   *
   *  Cycle 7 / Task 1.
   */
  syncInputValue(colId: string, model: CFilterModelEntry | null): void {
    const entry = this.pool.get(colId);
    if (!entry) return;
    if (model === null) return;
    if (model.filterType === 'text' || model.filterType === 'number' || model.filterType === 'date') {
      const v = model.filter;
      if (v != null) {
        entry.input.value = String(v);
        this.updateHasValueClass(entry);
      }
    }
    // multi-condition / set: leave input.value untouched.
  }

  /** Tear down — remove every pooled cell from the DOM and cancel any
   *  outstanding debounce timers. Idempotent.
   *
   *  Cycle 7 / Task 1.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const timer of this.debouncers.values()) clearTimeout(timer);
    this.debouncers.clear();
    for (const entry of this.pool.values()) entry.wrapper.remove();
    this.pool.clear();
  }

  private acquireCell(colId: string, def: FloatingFilterColDef): PoolEntry {
    const existing = this.pool.get(colId);
    if (existing) return existing;

    const wrapper = document.createElement('div');
    wrapper.className = 'cg-floating-filter-cell';
    wrapper.setAttribute('data-cg-floating-filter-cell', '');
    wrapper.setAttribute('data-cg-col-id', colId);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cg-floating-filter-input';
    input.setAttribute('data-cg-floating-filter', '');
    input.setAttribute('data-cg-col-id', colId);
    // Resolved filter type: explicit `filter:` wins, else fall back to
    // `cellDataType` (every column has one). The overlay's inline
    // parser uses this to route the user's typed expression to the
    // right grammar (text-contains for text columns, comparison +
    // range + CSV + AND/OR for number / date columns).
    const resolvedFilter = resolveFilterType(def);
    if (resolvedFilter) input.setAttribute('data-cg-filter-type', resolvedFilter);
    input.placeholder = placeholderFor(resolvedFilter);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cg-floating-filter-clear';
    clearBtn.setAttribute('data-cg-floating-filter-clear', '');
    clearBtn.setAttribute('data-cg-col-id', colId);
    clearBtn.setAttribute('aria-label', 'Clear filter');
    clearBtn.tabIndex = -1;
    clearBtn.textContent = '×';

    // Cycle 7 / Task 3 — popup-expand button. Only mounted for columns
    // whose resolved filter type maps to a popup (text/number/date/set)
    // AND that don't opt out via `suppressFloatingFilterButton`. The
    // overlay doesn't know how to open the popup — it forwards the
    // click to `deps.openColumnFilter(colId)` which cgrid wires to
    // `showColumnFilter(colId)`.
    let expandBtn: HTMLButtonElement | null = null;
    if (!def.suppressFloatingFilterButton && hasPopupFilter(def)) {
      expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'cg-floating-filter-expand';
      expandBtn.setAttribute('data-cg-floating-filter-expand', '');
      expandBtn.setAttribute('data-cg-col-id', colId);
      expandBtn.setAttribute('aria-label', 'Open filter');
      expandBtn.tabIndex = -1;
      // Three-line hamburger icon — keeps the popup-entry visually
      // distinct from the clear `×` even at narrow column widths.
      expandBtn.textContent = '☰';
      expandBtn.addEventListener('mousedown', (e) => {
        // Same rationale as clearBtn — don't blur the input on mousedown.
        e.preventDefault();
      });
      expandBtn.addEventListener('click', () => this.deps.openColumnFilter(colId));
    }

    const entry: PoolEntry = { wrapper, input, clearBtn, expandBtn };

    input.addEventListener('input', () => {
      this.updateHasValueClass(entry);
      this.onInputChanged(colId, input);
    });
    clearBtn.addEventListener('mousedown', (e) => {
      // Use mousedown so the click doesn't first focus the button and
      // blur the input — keeping focus on the input lets the user keep
      // typing after a clear without an extra click.
      e.preventDefault();
    });
    clearBtn.addEventListener('click', () => this.onClearClicked(colId, entry));

    const initial = this.deps.getColumnFilterModel(colId);
    if (initial
        && (initial.filterType === 'text' || initial.filterType === 'number' || initial.filterType === 'date')
        && initial.filter != null) {
      input.value = String(initial.filter);
    }
    this.updateHasValueClass(entry);

    wrapper.appendChild(input);
    wrapper.appendChild(clearBtn);
    if (expandBtn) wrapper.appendChild(expandBtn);
    this.host.appendChild(wrapper);
    this.pool.set(colId, entry);
    return entry;
  }

  private onInputChanged(colId: string, input: HTMLInputElement): void {
    const debounceMs = this.deps.debounceMs ?? 500;
    const existing = this.debouncers.get(colId);
    if (existing) clearTimeout(existing);
    const apply = () => {
      this.debouncers.delete(colId);
      if (this.destroyed) return;
      const raw = input.value;
      const def = this.deps.getColDef(colId);
      const columnType = resolveFilterType(def) ?? 'text';
      // Parser returns null for empty / unparseable input — both clear
      // the column filter. The input text itself is preserved (the
      // overlay never mutates `input.value` here) so the user sees what
      // they typed and can correct it without losing their edit.
      const model = parseFloatingFilterInput(raw, columnType);
      this.deps.setColumnFilterModel(colId, model);
    };
    if (debounceMs <= 0) {
      apply();
      return;
    }
    this.debouncers.set(colId, setTimeout(apply, debounceMs));
  }

  /** Clear-button click — wipes the input, cancels any pending debounce
   *  (the user's intent is explicit, no need to wait), fires
   *  `setColumnFilterModel(null)` immediately so the row count snaps
   *  back, and refocuses the input so typing can resume.
   *  Cycle 7 / Task 1. */
  private onClearClicked(colId: string, entry: PoolEntry): void {
    const existing = this.debouncers.get(colId);
    if (existing) {
      clearTimeout(existing);
      this.debouncers.delete(colId);
    }
    entry.input.value = '';
    this.updateHasValueClass(entry);
    this.deps.setColumnFilterModel(colId, null);
    entry.input.focus();
  }

  /** Toggle the `.has-value` class on the wrapper so the CSS rule
   *  showing the clear button activates only when the input has text.
   *  Called from every input event + clear + sync. Cycle 7 / Task 1. */
  private updateHasValueClass(entry: PoolEntry): void {
    entry.wrapper.classList.toggle('has-value', entry.input.value !== '');
  }
}

/** Resolved filter column type — `filter:` wins, else `cellDataType`,
 *  else `undefined`. The parser defaults to `'text'` when this returns
 *  undefined so an unannotated column still gets contains semantics. */
function resolveFilterType(def: FloatingFilterColDef | undefined): FilterColumnType | undefined {
  if (!def) return undefined;
  // `filter` may be a popup name ('set') that has no parser column type
  // — fall back to cellDataType for those. Only the three parser types
  // (text/number/date) are valid here.
  if (def.filter === 'text' || def.filter === 'number' || def.filter === 'date') {
    return def.filter;
  }
  if (def.cellDataType === 'text' || def.cellDataType === 'number') {
    return def.cellDataType;
  }
  return undefined;
}

/** Per-type placeholder hint. Each line previews the syntax the parser
 *  accepts for that column type. Kept short so it fits inside narrow
 *  columns (truncates gracefully when the column is < ~150 px). */
function placeholderFor(type: FilterColumnType | undefined): string {
  if (type === 'number') return '>100, 1,2,3, 100..200';
  if (type === 'date')   return '>2026-01-01, A..B';
  return '';
}

/** True when the column has a resolved filter type that maps to one of
 *  the per-type popups (Tasks 3-6 + 9). Used to decide whether to
 *  mount the expand button on the floating-filter cell. A column with
 *  no `filter:` set but a numeric `cellDataType` also qualifies for
 *  the number popup. Cycle 7 / Task 3. */
function hasPopupFilter(def: FloatingFilterColDef): boolean {
  if (def.filter === 'text' || def.filter === 'number' || def.filter === 'date' || def.filter === 'set') {
    return true;
  }
  if (def.cellDataType === 'number' || def.cellDataType === 'text') {
    return true;
  }
  return false;
}
