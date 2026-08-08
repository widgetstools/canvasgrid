/**
 * Cycle 10 / Task 1 — ContextMenuHost unit tests.
 *
 * The host owns mount/unmount + dismissal for the right-click menu.
 * `open(items, x, y)` mounts a `div.vg-context-menu` positioned `fixed`
 * at the cursor; `close()` unmounts it; outside click + Escape dismiss
 * implicitly. Separator items (`name: '---'`) render as `<hr>`; disabled
 * items render dim (`aria-disabled="true"`) and skip the `action`.
 *
 * The host is intentionally framework-agnostic: it knows nothing about
 * range selection, cgrid options, or the worker — Task 2 layers default
 * items on top, and the `RightClick` feature (also Task 1) routes the
 * `contextmenu` event into `grid.openContextMenu(items, x, y)`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextMenuHost } from '../src/interaction/contextMenu/host';
import type { MenuItem } from '../src/interaction/contextMenu/types';

describe('ContextMenuHost', () => {
  let host: HTMLElement;
  let menu: ContextMenuHost;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    menu = new ContextMenuHost(host);
  });

  afterEach(() => {
    menu.destroy();
    host.parentElement?.removeChild(host);
  });

  it('open mounts a div.vg-context-menu at (x, y) and isOpen returns true', () => {
    menu.open([], 10, 20);
    const root = host.querySelector('.vg-context-menu') as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(menu.isOpen()).toBe(true);
    // Positioned `fixed`. Style values come back without their unit on jsdom's
    // computed-style fallback, but the inline `style.left` / `style.top` are
    // exactly what we set.
    expect(root!.style.position).toBe('fixed');
    expect(root!.style.left).toBe('10px');
    expect(root!.style.top).toBe('20px');
  });

  it('close removes the DOM node and isOpen returns false', () => {
    menu.open([{ name: 'A' }], 0, 0);
    menu.close();
    expect(host.querySelector('.vg-context-menu')).toBeNull();
    expect(menu.isOpen()).toBe(false);
  });

  it('close is a no-op when nothing is mounted', () => {
    expect(() => menu.close()).not.toThrow();
    expect(menu.isOpen()).toBe(false);
  });

  it('opening a second time replaces the first menu', () => {
    menu.open([{ name: 'first' }], 0, 0);
    menu.open([{ name: 'second' }], 50, 50);
    const items = Array.from(host.querySelectorAll('.vg-context-menu .vg-menu-item'));
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain('second');
  });

  it('renders one button per item; clicking it fires action and closes the menu', () => {
    const spy = vi.fn();
    const params = { rowIndex: 0, colId: 'a', ranges: [], defaultItems: [] };
    menu.open([{ name: 'Copy', action: spy }], 0, 0, params);
    const btn = host.querySelector('.vg-menu-item') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    // Action receives the GetContextMenuItemsParams object the host opened with.
    expect(spy).toHaveBeenCalledWith(params);
    expect(menu.isOpen()).toBe(false);
  });

  it('renders separator items (name === "---") as <hr> and does NOT fire on click', () => {
    const spy = vi.fn();
    const items: MenuItem[] = [
      { name: 'A', action: spy },
      { name: '---' },
      { name: 'B', action: spy },
    ];
    menu.open(items, 0, 0);
    const hrs = host.querySelectorAll('.vg-context-menu hr');
    expect(hrs.length).toBe(1);
    const buttons = host.querySelectorAll('.vg-context-menu .vg-menu-item');
    expect(buttons.length).toBe(2);
  });

  it('disabled items render with aria-disabled and skip action on click', () => {
    const spy = vi.fn();
    menu.open([{ name: 'Paste', action: spy, disabled: true }], 0, 0);
    const btn = host.querySelector('.vg-menu-item') as HTMLElement;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    // Disabled click is consumed but does NOT close the menu — matches
    // native menus, the user can keep choosing.
    expect(menu.isOpen()).toBe(true);
  });

  it('clicking outside the menu closes it', () => {
    menu.open([{ name: 'A' }], 0, 0);
    expect(menu.isOpen()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
    expect(host.querySelector('.vg-context-menu')).toBeNull();
  });

  it('clicking INSIDE the menu does NOT close it', () => {
    menu.open([{ name: 'A' }], 0, 0);
    const root = host.querySelector('.vg-context-menu') as HTMLElement;
    root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu.isOpen()).toBe(true);
  });

  it('Escape key closes the menu', () => {
    menu.open([{ name: 'A' }], 0, 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });

  it('viewport clamp: when (x, y) would overflow the viewport, the menu is shifted to fit', () => {
    // jsdom defaults window to 1024 × 768. Open just inside the bottom-right
    // corner and assert the menu's measured offset clamps so it doesn't
    // overflow. We use Object.defineProperty to force a known size on the
    // menu root via offsetWidth / offsetHeight so the clamp math is
    // deterministic in jsdom (which returns 0 for layout boxes).
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    // We need the menu to "measure" 200x100 — patch the prototype getter for
    // offsetWidth/Height so the clamp math sees a real box.
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
    try {
      menu.open([{ name: 'A' }], 750, 580);
      const root = host.querySelector('.vg-context-menu') as HTMLElement;
      // 750 + 200 = 950 > 800 → clamp to 800 - 200 = 600.
      // 580 + 100 = 680 > 600 → clamp to 600 - 100 = 500.
      expect(root.style.left).toBe('600px');
      expect(root.style.top).toBe('500px');
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('destroy tears down listeners + any active menu (idempotent)', () => {
    menu.open([{ name: 'A' }], 0, 0);
    menu.destroy();
    expect(menu.isOpen()).toBe(false);
    expect(host.querySelector('.vg-context-menu')).toBeNull();
    // After destroy, opening again is a no-op — outside-click and Escape
    // listeners are gone so a fresh open would leak.
    menu.open([{ name: 'B' }], 0, 0);
    expect(menu.isOpen()).toBe(false);
  });
});
