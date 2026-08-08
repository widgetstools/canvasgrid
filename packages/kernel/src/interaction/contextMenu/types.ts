/**
 * Cycle 10 / Task 1 — context-menu types.
 *
 * Public shape for the right-click menu surface. `MenuItem` mirrors ag-grid's
 * `MenuItemDef` minimally: `name` (label), optional `icon` (HTML or unicode),
 * `action` callback, `disabled` flag, and a nested `subMenu`. A separator is
 * declared by `name === '---'` — the host renders it as an `<hr>` and skips
 * the click action.
 *
 * `GetContextMenuItemsParams` is what `VelocityGridOptions.getContextMenuItems`
 * receives. It carries the hit-test result (`rowIndex` / `colId` are `null`
 * when the right-click landed outside a body cell — header, scrollbar, or
 * empty space), the current `SelectionModel.ranges` snapshot, and the
 * built-in `defaultItems` list. Apps mix the default list into a custom
 * list with `filter` / `concat` / spread — same pattern as ag-grid.
 */
import type { SelectionRange } from '../../types';

export interface MenuItem {
  /** Display label. The literal string `'---'` renders a horizontal rule. */
  name: string;
  /** Icon HTML or unicode char. Optional. Rendered in a fixed-width left
   *  gutter so labels align even when only some items carry icons. */
  icon?: string;
  /** Right-aligned shortcut hint (e.g. `'Ctrl+C'`). Rendered dim so it
   *  reads as metadata, not as a clickable element. Mutually exclusive
   *  with `subMenu` (a submenu chevron replaces the shortcut column when
   *  both are present, shortcut wins for the visual contract). */
  shortcut?: string;
  /** Click handler. Skipped when `disabled === true` or when the item is a
   *  separator. The host passes the live params (cell or header) the menu
   *  was resolved against — `unknown` here because the host renders both
   *  `GetContextMenuItemsParams` and `GetMainMenuItemsParams` menus
   *  through the same `MenuItem[]` shape. Default-item authors that need
   *  the typed params close over them at build time
   *  (`buildDefaultMenuItems` / `buildDefaultMainMenuItems`). */
  action?: (params: unknown) => void;
  /** Disabled items render dim + skip the action. */
  disabled?: boolean;
  /** Nested items render a submenu on hover. When present, the row shows
   *  a `▶` chevron in the shortcut slot. */
  subMenu?: MenuItem[];
}

export interface GetContextMenuItemsParams {
  /** Row index under the cursor (null when the right-click hit the header / scrollbar). */
  rowIndex: number | null;
  /** ColId under the cursor (null when the hit isn't a body cell). */
  colId: string | null;
  /** Current cell-range selection (Cycle 9). Empty array when no range is active. */
  ranges: SelectionRange[];
  /** The default item list — apps mix-and-match into a custom list. Empty
   *  in Task 1; populated by Task 2's `buildDefaultMenuItems`. */
  defaultItems: MenuItem[];
}

/** Resolution signature for `VelocityGridOptions.getContextMenuItems`. Returning an
 *  empty array suppresses the menu (the host renders nothing + the native
 *  browser menu also stays suppressed because the feature already called
 *  `preventDefault`). */
export type GetContextMenuItemsCallback =
  (params: GetContextMenuItemsParams) => MenuItem[];

/** Params handed to `VelocityGridOptions.getMainMenuItems`. The column menu has no
 *  row context (right-click landed in the header band, not a body cell), so
 *  `rowIndex` is dropped. `colId` is always populated — `getMainMenuItems`
 *  only fires when the hit kind is `header` or `headerGroup`. */
export interface GetMainMenuItemsParams {
  /** Column the header / group header right-click landed on. Always
   *  populated (the resolver routes only header / headerGroup hits here). */
  colId: string;
  /** The default item list — apps mix-and-match into a custom list with
   *  `filter` / `concat` / spread, same pattern as `getContextMenuItems`. */
  defaultItems: MenuItem[];
}

/** Resolution signature for `VelocityGridOptions.getMainMenuItems`. Mirrors
 *  ag-grid's split: cell right-clicks call `getContextMenuItems`, header
 *  right-clicks call `getMainMenuItems`. Returning an empty array
 *  suppresses the menu. */
export type GetMainMenuItemsCallback =
  (params: GetMainMenuItemsParams) => MenuItem[];
