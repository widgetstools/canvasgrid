/**
 * Cycle 10 / Task 1 — context-menu types.
 *
 * Public shape for the right-click menu surface. `MenuItem` mirrors ag-grid's
 * `MenuItemDef` minimally: `name` (label), optional `icon` (HTML or unicode),
 * `action` callback, `disabled` flag, and a nested `subMenu`. A separator is
 * declared by `name === '---'` — the host renders it as an `<hr>` and skips
 * the click action.
 *
 * `GetContextMenuItemsParams` is what `CGridOptions.getContextMenuItems`
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
  /** Icon HTML or unicode char. Optional. */
  icon?: string;
  /** Click handler. Skipped when `disabled === true` or when the item is a separator. */
  action?: (params: GetContextMenuItemsParams) => void;
  /** Disabled items render dim + skip the action. */
  disabled?: boolean;
  /** Nested items render a submenu on hover. */
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

/** Resolution signature for `CGridOptions.getContextMenuItems`. Returning an
 *  empty array suppresses the menu (the host renders nothing + the native
 *  browser menu also stays suppressed because the feature already called
 *  `preventDefault`). */
export type GetContextMenuItemsCallback =
  (params: GetContextMenuItemsParams) => MenuItem[];
