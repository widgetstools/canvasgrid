/**
 * Cycle 10 / Task 1 — ContextMenuHost.
 *
 * DOM portal that mounts the right-click menu over the grid. The menu is
 * positioned `fixed` at the cursor (viewport coordinates), clamped to the
 * viewport so it never overflows the right or bottom edge. Outside-click
 * and Escape dismiss it; opening a second time replaces the first.
 *
 * Rendering shape (per `docs/catalog/screenshots/19-context-menu-default.png`):
 *   ┌──────────────────────────────────────────────┐
 *   │  ✂   Cut                          Ctrl+X     │
 *   │  ⎘   Copy                         Ctrl+C     │
 *   │  📋  Paste                        Ctrl+V     │  ← dim when disabled
 *   │  ────────────────────────────────────────    │  ← separator
 *   │  ↓   Export                            ▶     │  ← chevron for subMenu
 *   └──────────────────────────────────────────────┘
 *
 * Each row is a 3-column CSS grid: icon gutter (fixed width so labels
 * align even when only some items carry icons) / label (flex-grow) /
 * shortcut-or-chevron (right-aligned, dim). The literal `name === '---'`
 * renders as a thin horizontal rule. Disabled items render with
 * `aria-disabled="true"` and skip the click action — but leave the menu
 * open so the user can keep choosing, matching native platform menus.
 *
 * Submenus render on `mouseenter` of a row that carries `subMenu`. The
 * sub-popup mounts as a sibling under the same host (`pointer-events:
 * auto` inherits), positioned at the parent row's right edge. Hovering
 * away closes it; entering a different parent-row closes the old one
 * and opens the new one. Submenus reuse the same render pipeline so
 * deeper nesting works without special-casing.
 *
 * Mirrors `FilterPopupHost` for outside-click / Escape behaviour
 * (mousedown listener attached on `document` in capture phase so a click
 * anywhere outside our subtree closes the menu before the click reaches
 * its target).
 */
import type { GetContextMenuItemsParams, GetMainMenuItemsParams, MenuItem } from './types';
import { sanitizeIconHtml } from '../../core/sanitizeHtml';

/** Params handed to `MenuItem.action` callbacks. The host threads the
 *  object through without inspecting it — item authors cast (or close
 *  over typed params in the registry builder) to the variant they
 *  registered against (`GetContextMenuItemsParams` for cell-menu items,
 *  `GetMainMenuItemsParams` for header-menu items). */
type MenuItemActionParams = GetContextMenuItemsParams | GetMainMenuItemsParams;

/** Empty params object reused when callers don't pass one (e.g. internal
 *  test fixtures). Matches the `null` defaults `RightClick` would feed
 *  through when the right-click landed outside a body cell. */
const EMPTY_PARAMS: GetContextMenuItemsParams = {
  rowIndex: null,
  colId: null,
  ranges: [],
  defaultItems: [],
};

interface MountedLevel {
  root: HTMLElement;
  /** The row in the parent level that owns this submenu (null for the
   *  top-level menu). Used to close stale submenus when the user hovers
   *  away from the parent row. */
  parentRow: HTMLElement | null;
}

export class ContextMenuHost {
  /** Stack of mounted menu levels: index 0 is the top-level menu, index
   *  1 is the first submenu, etc. Levels above the most recent one are
   *  trimmed when a sibling row opens a different submenu. */
  private levels: MountedLevel[] = [];
  private destroyed = false;
  private readonly onDocMouseDown = (ev: MouseEvent) => this.handleDocMouseDown(ev);
  private readonly onDocKeyDown = (ev: KeyboardEvent) => this.handleDocKeyDown(ev);

  constructor(private host: HTMLElement) {
    document.addEventListener('mousedown', this.onDocMouseDown, true);
    document.addEventListener('keydown', this.onDocKeyDown, true);
  }

  /** Mount a fresh menu rendering `items` at viewport coordinates `(x, y)`.
   *  Closes any existing menu first (one-at-a-time). `params` rides into
   *  each item's `action` callback so apps can read the hit-test +
   *  selection snapshot without a separate closure capture. No-op after
   *  `destroy()`. */
  open(items: MenuItem[], x: number, y: number, params: MenuItemActionParams = EMPTY_PARAMS): void {
    if (this.destroyed) return;
    this.closeInternal();

    const root = this.renderLevel(items, params);
    root.style.position = 'fixed';
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.zIndex = '10000';
    this.host.appendChild(root);
    this.levels.push({ root, parentRow: null });
    this.clampToViewport(root, x, y);
  }

  /** Close the active menu (if any). Idempotent. */
  close(): void {
    this.closeInternal();
  }

  isOpen(): boolean { return this.levels.length > 0; }

  /** Tear down listeners + any active menu. Idempotent. After `destroy()`,
   *  subsequent `open(...)` calls no-op. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeInternal();
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    document.removeEventListener('keydown', this.onDocKeyDown, true);
  }

  /** Render one menu level and return its root element. Caller positions
   *  the root (top-level: at the cursor; submenu: at the parent row's
   *  right edge). */
  private renderLevel(items: MenuItem[], params: MenuItemActionParams): HTMLElement {
    const root = document.createElement('div');
    root.className = 'vg-context-menu';
    root.setAttribute('role', 'menu');
    root.setAttribute('data-vg-context-menu-root', '');
    // editorContainer (the typical host) carries `pointer-events: none`
    // so the canvas under it stays interactive — children must opt back
    // in or clicks fall through to the canvas.
    root.style.pointerEvents = 'auto';

    for (const item of items) {
      if (item.name === '---') {
        const hr = document.createElement('hr');
        hr.className = 'vg-menu-separator';
        root.appendChild(hr);
        continue;
      }
      root.appendChild(this.renderRow(item, params));
    }
    return root;
  }

  private renderRow(item: MenuItem, params: MenuItemActionParams): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vg-menu-item';
    row.setAttribute('role', 'menuitem');
    row.setAttribute('tabindex', '-1');
    if (item.disabled) row.setAttribute('aria-disabled', 'true');
    if (item.subMenu && item.subMenu.length > 0) row.setAttribute('aria-haspopup', 'menu');

    const iconSlot = document.createElement('span');
    iconSlot.className = 'vg-menu-item-icon';
    if (item.icon) iconSlot.innerHTML = sanitizeIconHtml(item.icon);
    row.appendChild(iconSlot);

    const label = document.createElement('span');
    label.className = 'vg-menu-item-label';
    label.textContent = item.name;
    row.appendChild(label);

    const tail = document.createElement('span');
    tail.className = 'vg-menu-item-tail';
    if (item.subMenu && item.subMenu.length > 0) {
      tail.textContent = '▶';
      tail.classList.add('vg-menu-item-chevron');
    } else if (item.shortcut) {
      tail.textContent = item.shortcut;
    }
    row.appendChild(tail);

    // Hover handling — opens submenus, closes sibling submenus.
    row.addEventListener('mouseenter', () => {
      this.handleRowHover(row, item, params);
    });
    row.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (item.disabled) return;
      // Submenu parents don't fire `action` — hover already mounted the
      // submenu and clicking the row keeps it open.
      if (item.subMenu && item.subMenu.length > 0) return;
      try {
        item.action?.(params);
      } finally {
        this.closeInternal();
      }
    });
    return row;
  }

  /** When the cursor enters a row, trim any submenu levels deeper than
   *  this row's level (we hovered away from their parent) and, if the
   *  row carries a submenu, mount it positioned at the row's right edge. */
  private handleRowHover(row: HTMLElement, item: MenuItem, params: MenuItemActionParams): void {
    // Find the level this row belongs to so we can trim deeper levels.
    const rowLevelIndex = this.levels.findIndex((lvl) => lvl.root.contains(row));
    if (rowLevelIndex < 0) return;
    // Trim everything deeper than the hovered row's level.
    while (this.levels.length > rowLevelIndex + 1) {
      const popped = this.levels.pop()!;
      popped.root.remove();
    }
    if (!item.subMenu || item.subMenu.length === 0) return;
    if (item.disabled) return;
    // Mount the submenu at the parent row's right edge.
    const sub = this.renderLevel(item.subMenu, params);
    sub.style.position = 'fixed';
    const rect = row.getBoundingClientRect();
    sub.style.left = `${rect.right}px`;
    sub.style.top = `${rect.top}px`;
    sub.style.zIndex = '10001';
    this.host.appendChild(sub);
    this.levels.push({ root: sub, parentRow: row });
    this.clampToViewport(sub, rect.right, rect.top);
  }

  /** Clamp a freshly-mounted level to the viewport so it doesn't overflow
   *  the right / bottom edges. Forces a sync layout via `offsetWidth` /
   *  `offsetHeight` — intentional; the alternative is a one-frame flicker. */
  private clampToViewport(root: HTMLElement, x: number, y: number): void {
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (vw > 0 && x + w > vw) root.style.left = `${Math.max(0, vw - w)}px`;
    if (vh > 0 && y + h > vh) root.style.top = `${Math.max(0, vh - h)}px`;
  }

  private closeInternal(): void {
    while (this.levels.length > 0) {
      const lvl = this.levels.pop()!;
      lvl.root.remove();
    }
  }

  private handleDocMouseDown(ev: MouseEvent): void {
    if (this.levels.length === 0) return;
    const target = ev.target as Node | null;
    if (target) {
      // A click inside ANY mounted level (top-level or a submenu) keeps
      // the menu open — those clicks are handled by the row listeners.
      for (const lvl of this.levels) {
        if (lvl.root.contains(target)) return;
      }
    }
    this.closeInternal();
  }

  private handleDocKeyDown(ev: KeyboardEvent): void {
    if (this.levels.length === 0) return;
    if (ev.key !== 'Escape') return;
    this.closeInternal();
  }
}
