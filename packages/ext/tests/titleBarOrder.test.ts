import { describe, it, expect, vi, beforeAll } from 'vitest';
import { installGridTestEnv } from './setup';
import { ShellLayout } from '../src/shell/shell';
import { buildDefaultBundle } from '../src/defaultBundle';
import { ExtensionRegistry } from '../src/extension/registry';
import { titleBarExtensions } from '../src/toolbar/titleBar';
import { isToolbarItem } from '../src/extension/types';
import type { VelocityGridExtContext, ToolbarItem, ToolbarSlot } from '../src/extension/types';

/**
 * Title-bar ORDER is a contract, not an accident of mount order.
 *
 * It used to be neither. Two invisible mechanisms decided it:
 *
 *  - `ShellLayout` created slot containers lazily, so the first slot any
 *    extension touched became the left-most child of the bar. The default
 *    bundle's `primary-right` buttons always mount before any `primary-left`
 *    item, so the utility cluster rendered to the LEFT of the caption.
 *  - `ExtensionRegistry.register` keeps an id's ORIGINAL index when a later
 *    spec replaces it, so the title bar's `settings-launcher` inherited the
 *    default bundle's index 0 and led the cluster.
 *
 * Both reproduce below without the fix, and neither is visible from the item
 * factories — which is why this is pinned here rather than left to review.
 */

beforeAll(() => installGridTestEnv());

const ctx = {
  grid: {
    setGridOption() {},
    addEventListener: () => () => {},
    getActiveLayout: () => ({ name: 'Default' }),
    openToolPanel() {},
    setTheme() {},
  },
  events: { on: () => () => {}, emit() {} },
  session: { onChange: () => () => {} },
  profiles: {
    isDirty: () => false,
    onDirtyChange: () => () => {},
    save: async () => {},
    list: async () => [],
    onListChange: () => () => {},
  },
} as unknown as VelocityGridExtContext;

/** Mount the real default bundle + real title bar exactly as VelocityGridExt
 *  does, and read back the rendered left-to-right order. */
function renderBar(): { slots: string[]; items: (slot: ToolbarSlot) => string[] } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const shell = new ShellLayout(root);

  const registry = new ExtensionRegistry();
  for (const e of buildDefaultBundle()) registry.register(e);
  registry.applySpecs(titleBarExtensions({ name: 'Test Grid' }));
  for (const e of registry.all()) {
    if (isToolbarItem(e)) {
      try { shell.mountToolbarItem(e as ToolbarItem, ctx); } catch { /* render may need more ctx */ }
    }
  }

  const bar = root.querySelector('.vgext-titlebar')!;
  return {
    slots: Array.from(bar.children).map((c) => c.className.replace('vgext-slot-', '')),
    // Child scan, not `:scope >` — the test DOM does not support it.
    items: (slot) => Array.from(bar.querySelector(`.vgext-slot-${slot}`)!.children)
      .map((c) => (c as HTMLElement).dataset.itemId!),
  };
}

describe('title bar renders in its declared left-to-right order', () => {
  it('places the slots left → center → right regardless of mount order', () => {
    // The default bundle mounts primary-right items first; the caption must
    // still come first in the DOM.
    expect(renderBar().slots).toEqual(['primary-left', 'primary-center', 'primary-right']);
  });

  it('left cluster is the caption, then the filter pills', () => {
    expect(renderBar().items('primary-left')).toEqual(['brand', 'saved-filters']);
  });

  it('right cluster is search → alerts → layouts → date → toolbars → overflow', () => {
    expect(renderBar().items('primary-right')).toEqual([
      'search',
      'notifications',
      'layouts',
      'layout-save',
      'date',
      'settings-launcher',
      'overflow',
    ]);
  });

  it('drops the default profile Save, so only the layout disk saves', () => {
    // Two save controls sat side by side and wrote through different
    // persisters (profile store vs ConfigSession).
    expect(renderBar().items('primary-right')).not.toContain('save');
  });

  it('an undeclared item appends to the cluster instead of leading it', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const shell = new ShellLayout(root);
    const plain = (id: string): ToolbarItem => ({
      id, kind: 'toolbar-item', slot: 'primary-right', init: vi.fn(),
      render: (host) => { host.textContent = id; return { destroy() {} }; },
    });
    shell.mountToolbarItem({ ...plain('consumer-a') }, ctx);
    shell.mountToolbarItem({ ...plain('ordered'), order: 10 }, ctx);
    shell.mountToolbarItem({ ...plain('consumer-b') }, ctx);

    const ids = Array.from(
      root.querySelectorAll('.vgext-slot-primary-right > .vgext-toolbar-item'),
    ).map((c) => (c as HTMLElement).dataset.itemId);
    // Declared chrome first; the two undeclared items keep registration order.
    expect(ids).toEqual(['ordered', 'consumer-a', 'consumer-b']);
  });
});
