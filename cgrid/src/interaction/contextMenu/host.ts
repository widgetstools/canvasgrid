/**
 * Cycle 10 / Task 1 — ContextMenuHost.
 *
 * DOM portal that mounts the right-click menu over the grid. The menu is
 * positioned `fixed` at the cursor (viewport coordinates), clamped to the
 * viewport so it never overflows the right or bottom edge. Outside-click
 * and Escape dismiss it; opening a second time replaces the first.
 *
 * The host is intentionally minimal — it owns DOM lifecycle and dismissal
 * only. `items` is the resolved `MenuItem[]` produced by
 * `getContextMenuItems(params)` (Task 1 ships the empty surface; Task 2
 * fills in the default registry). Each item renders as a button; the
 * literal `name === '---'` renders as `<hr>` (separator). Disabled items
 * render with `aria-disabled="true"` and skip the click action — but
 * leave the menu open so the user can keep choosing, matching native
 * platform menus.
 *
 * Mirrors `FilterPopupHost` for outside-click / Escape behaviour
 * (mousedown listener attached on `document` in capture phase so a click
 * anywhere outside our subtree closes the menu before the click reaches
 * its target).
 */
import type { GetContextMenuItemsParams, MenuItem } from './types';

/** Empty params object reused when callers don't pass one (e.g. internal
 *  test fixtures). Matches the `null` defaults `RightClick` would feed
 *  through when the right-click landed outside a body cell. */
const EMPTY_PARAMS: GetContextMenuItemsParams = {
  rowIndex: null,
  colId: null,
  ranges: [],
  defaultItems: [],
};

export class ContextMenuHost {
  private current: { root: HTMLElement } | null = null;
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
  open(items: MenuItem[], x: number, y: number, params: GetContextMenuItemsParams = EMPTY_PARAMS): void {
    if (this.destroyed) return;
    if (this.current) this.closeInternal();

    const root = document.createElement('div');
    root.className = 'cg-context-menu';
    root.setAttribute('role', 'menu');
    root.setAttribute('data-cg-context-menu-root', '');
    root.style.position = 'fixed';
    // Initial paint at (x, y); we re-position below once the box has
    // measured itself, so the clamp can subtract real width / height.
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.zIndex = '10000';
    // editorContainer carries `pointer-events: none` so the canvas under
    // it stays interactive when the editor pool is mounted but empty.
    // Children must opt back in — without this, clicks on menu buttons
    // fall through to the canvas below.
    root.style.pointerEvents = 'auto';

    for (const item of items) {
      if (item.name === '---') {
        root.appendChild(document.createElement('hr'));
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cg-menu-item';
      btn.setAttribute('role', 'menuitem');
      if (item.disabled) btn.setAttribute('aria-disabled', 'true');
      // Icon slot first (HTML or unicode char), then label.
      if (item.icon) {
        const icon = document.createElement('span');
        icon.className = 'cg-menu-item-icon';
        icon.innerHTML = item.icon;
        btn.appendChild(icon);
      }
      const label = document.createElement('span');
      label.className = 'cg-menu-item-label';
      label.textContent = item.name;
      btn.appendChild(label);
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (item.disabled) return;
        // Run the action FIRST so it sees the still-open menu (some apps
        // open a sub-popup anchored to the menu rect), then close.
        try {
          item.action?.(params);
        } finally {
          this.closeInternal();
        }
      });
      root.appendChild(btn);
    }

    this.host.appendChild(root);
    this.current = { root };

    // Viewport clamp: now that the menu is in the DOM, measure it and
    // shift left / up so it doesn't overflow the right / bottom edges.
    // This runs synchronously — `offsetWidth` / `offsetHeight` force a
    // layout, which is what we want here.
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (vw > 0 && x + w > vw) root.style.left = `${Math.max(0, vw - w)}px`;
    if (vh > 0 && y + h > vh) root.style.top = `${Math.max(0, vh - h)}px`;
  }

  /** Close the active menu (if any). Idempotent. */
  close(): void {
    this.closeInternal();
  }

  isOpen(): boolean { return this.current !== null; }

  /** Tear down listeners + any active menu. Idempotent. After `destroy()`,
   *  subsequent `open(...)` calls no-op. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeInternal();
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    document.removeEventListener('keydown', this.onDocKeyDown, true);
  }

  private closeInternal(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    c.root.parentElement?.removeChild(c.root);
  }

  private handleDocMouseDown(ev: MouseEvent): void {
    if (!this.current) return;
    const target = ev.target as Node | null;
    if (target && this.current.root.contains(target)) return;
    this.closeInternal();
  }

  private handleDocKeyDown(ev: KeyboardEvent): void {
    if (!this.current) return;
    if (ev.key !== 'Escape') return;
    this.closeInternal();
  }
}
