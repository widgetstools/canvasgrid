/**
 * Cycle 10 / Task 2 — default context-menu items registry.
 *
 * `buildDefaultMenuItems(grid, params)` produces the eight standard items
 * (Copy, Copy with Headers, Paste, Cut, Export, Autosize Columns, Pin
 * Column ►, Reset Columns) plus two separators between the logical
 * groups (clipboard / export / column-ops). Apps that don't supply
 * `CGridOptions.getContextMenuItems` see this list directly; apps that
 * DO supply a callback receive the same list via `params.defaultItems`
 * and mix-and-match (filter / concat / spread).
 *
 * Copy / Paste / Cut and Export are intentionally stubbed for Task 2 —
 * they emit a `console.debug('[clipboard]' / '[export]')` breadcrumb
 * so the wiring is visible during development. Tasks 3–5 swap the
 * clipboard stubs for the worker-backed `copySelectedRangesToClipboard`
 * / `pasteFromClipboard` / `cutSelectedRanges` calls.
 *
 * Pin Column expands to a Left / Right / Clear submenu. The submenu
 * items act on `params.colId` — when the right-click landed outside a
 * body cell / header (so `colId === null`), Pin Column renders disabled
 * and the submenu actions short-circuit defensively.
 *
 * Grid surface kept narrow on purpose. The registry needs only the
 * column-ops methods today (Tasks 3–5 will extend `DefaultMenuGrid`
 * with the clipboard API). That keeps tests trivial — a `vi.fn()` stub
 * per slot is enough.
 */
import type { GetContextMenuItemsParams, MenuItem } from './types';

/** The slice of the CGrid surface the default registry depends on.
 *  Deliberately a structural interface rather than the full `CGrid`
 *  class so the registry stays test-friendly and Tasks 3–5 can extend
 *  it without churning every call site. */
export interface DefaultMenuGrid {
  /** Cycle 6 / Task 4 — autosize every visible non-`suppressAutoSize` leaf. */
  autoSizeAllColumns(skipHeader?: boolean): Promise<void> | void;
  /** Cycle 6 / Task 2 — restore construction-time column state. */
  resetColumnState(): void;
  /** Cycle 6 / Task 5 — pin / unpin a batch of leaf columns. */
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
  /** Cycle 10 / Task 3 — serialise the current range selection to the
   *  system clipboard. The Copy default-menu item routes here. */
  copySelectedRangesToClipboard(): Promise<void>;
}

/** Build the eight-item default list. `grid` carries the column-ops
 *  callbacks; `params` is the hit + selection snapshot the right-click
 *  produced. `params.colId === null` means the right-click landed
 *  outside a column (header gutter, empty scrollbar area, body without
 *  a column under the cursor) — Pin Column renders disabled so the
 *  user can't pin a phantom column. */
export function buildDefaultMenuItems(
  grid: DefaultMenuGrid,
  params: GetContextMenuItemsParams,
): MenuItem[] {
  const hasColumn = params.colId !== null;
  const colId = params.colId;

  const pinAction = (pinned: 'left' | 'right' | null) => (p: GetContextMenuItemsParams) => {
    // Prefer the colId from the live params at click time (matches ag-grid
    // and lets apps re-anchor the menu by re-resolving params). Fall back
    // to the closure capture only if a host invoked us without params.
    const target = p?.colId ?? colId;
    if (target === null) return;
    grid.setColumnsPinned([target], pinned);
  };

  return [
    {
      name: 'Copy',
      icon: '⎘', // ⎘ — overlapping pages glyph
      // Click handlers run in the user-gesture stack the menu-item
      // click started — `navigator.clipboard.writeText` inside the
      // API call sees an active gesture, so the async-clipboard call
      // resolves. `no-ranges` rejections are swallowed (right-clicking
      // without an active selection should be a silent no-op, not a
      // console error).
      action: () => {
        void grid.copySelectedRangesToClipboard().catch((err) => {
          if (err instanceof Error && err.message === 'no-ranges') return;
          console.warn('[cgrid] copySelectedRangesToClipboard:', err);
        });
      },
    },
    {
      name: 'Copy with Headers',
      icon: '⎘',
      action: () => { console.debug('[clipboard] copy-with-headers (stub — wired in Task 3)'); },
    },
    {
      name: 'Paste',
      icon: '\u{1F4CB}', // 📋 clipboard
      action: () => { console.debug('[clipboard] paste (stub — wired in Task 4)'); },
    },
    {
      name: 'Cut',
      icon: '✂', // ✂ scissors
      action: () => { console.debug('[clipboard] cut (stub — wired in Task 5)'); },
    },
    { name: '---' },
    {
      name: 'Export',
      action: () => { console.debug('[export] (stub — out of scope for Cycle 10)'); },
    },
    { name: '---' },
    {
      name: 'Autosize Columns',
      action: () => { void grid.autoSizeAllColumns(); },
    },
    {
      name: 'Pin Column',
      disabled: !hasColumn,
      subMenu: [
        { name: 'Left', action: pinAction('left') },
        { name: 'Right', action: pinAction('right') },
        { name: 'Clear', action: pinAction(null) },
      ],
    },
    {
      name: 'Reset Columns',
      action: () => { grid.resetColumnState(); },
    },
  ];
}
