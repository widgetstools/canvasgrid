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
  /** Cycle 10 / Task 4 — read the system clipboard + apply via
   *  `applyTransaction` rooted at the focused cell. The Paste
   *  default-menu item routes here. */
  pasteFromClipboard(): Promise<void>;
  /** Cycle 10 / Task 5 — copy ranges then clear the source cells via
   *  `applyTransaction`. The Cut default-menu item routes here. */
  cutSelectedRanges(): Promise<void>;
  /** Cycle 10 / Task 6 — resolved `CGridOptions.suppressClipboardPaste`.
   *  The default `Paste` item renders disabled when `true` so users see
   *  the gate visually instead of hitting a silent no-op. Optional for
   *  back-compat: registries built before Task 6 land continue to work
   *  (`undefined` is treated as `false`). */
  isClipboardPasteSuppressed?(): boolean;
  /** Cycle 20 — Export submenu. The `CSV` / `Excel Export` items route
   *  here. Optional for back-compat: registries built before Cycle 20
   *  land render the Export menu disabled. */
  exportDataAsCsv?(params?: { fileName?: string }): Promise<void>;
  exportDataAsExcel?(params?: { fileName?: string }): Promise<void>;
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

  const pinAction = (pinned: 'left' | 'right' | null) => () => {
    // The registry is rebuilt per right-click (see
    // `CGrid.resolveContextMenuItems`), so the closure-captured `colId`
    // is always the freshly-clicked column. `colId === null` happens
    // when the right-click landed outside any column (the menu is
    // already gated via `disabled: !hasColumn` so this is defence in
    // depth for hosts that don't honour `disabled`).
    if (colId === null) return;
    grid.setColumnsPinned([colId], pinned);
  };

  return [
    {
      name: 'Cut',
      icon: '✂',
      shortcut: 'Ctrl+X',
      // Cycle 10 / Task 5 — same gesture-stack reasoning as Copy /
      // Paste: the menu-item click is the active user gesture, so the
      // `navigator.clipboard.writeText` inside `cutSelectedRanges`
      // resolves. `no-ranges` rejections are swallowed (right-clicking
      // without an active selection should be a silent no-op).
      action: () => {
        void grid.cutSelectedRanges().catch((err) => {
          if (err instanceof Error && err.message === 'no-ranges') return;
          console.warn('[cgrid] cutSelectedRanges:', err);
        });
      },
    },
    {
      name: 'Copy',
      icon: '⎘',
      shortcut: 'Ctrl+C',
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
      icon: '\u{1F4CB}',
      shortcut: 'Ctrl+V',
      // Cycle 10 / Task 6 — when `suppressClipboardPaste` is on, the item
      // renders dim so users see the gate. We still wire the action so
      // hosts that don't honour `disabled` short-circuit via the
      // API-side gate (`pasteFromClipboard` no-ops in the same case).
      disabled: grid.isClipboardPasteSuppressed?.() === true,
      // Same gesture-stack reasoning as Copy: the menu-item click is the
      // active user gesture, so `navigator.clipboard.readText` inside
      // `pasteFromClipboard` resolves. Errors (permission denied, no
      // gesture if invoked programmatically) get a single warn line.
      action: () => {
        void grid.pasteFromClipboard().catch((err) => {
          console.warn('[cgrid] pasteFromClipboard:', err);
        });
      },
    },
    { name: '---' },
    {
      name: 'Export',
      icon: '↓',
      // Cycle 20 — submenu surfaces CSV + Excel as separate items, the
      // ag-grid vocabulary. Items render disabled if the host grid
      // didn't supply the matching method (back-compat with hosts
      // built before Cycle 20).
      disabled: !grid.exportDataAsCsv && !grid.exportDataAsExcel,
      subMenu: [
        {
          name: 'CSV Export',
          disabled: !grid.exportDataAsCsv,
          action: () => {
            void grid.exportDataAsCsv?.().catch((err) => {
              console.warn('[cgrid] exportDataAsCsv:', err);
            });
          },
        },
        {
          name: 'Excel Export',
          disabled: !grid.exportDataAsExcel,
          action: () => {
            void grid.exportDataAsExcel?.().catch((err) => {
              console.warn('[cgrid] exportDataAsExcel:', err);
            });
          },
        },
      ],
    },
    { name: '---' },
    {
      name: 'Autosize Columns',
      icon: '↔',
      action: () => { void grid.autoSizeAllColumns(); },
    },
    {
      name: 'Pin Column',
      icon: '📌',
      disabled: !hasColumn,
      subMenu: [
        { name: 'Pin Left', action: pinAction('left') },
        { name: 'Pin Right', action: pinAction('right') },
        { name: 'No Pin', action: pinAction(null) },
      ],
    },
    {
      name: 'Reset Columns',
      icon: '↺',
      action: () => { grid.resetColumnState(); },
    },
  ];
}
