import { describe, it, expect, vi } from 'vitest';
import { ExtensionRegistry } from '../src/extension/registry';
import type { CgExtContext, SettingsModule, ToolbarItem } from '../src/extension/types';

const mod = (id: string): SettingsModule => ({
  id, kind: 'settings-module', title: id, icon: 'i', category: 'layout',
  init: vi.fn(), mount: () => ({ destroy() {} }),
});
const item = (id: string): ToolbarItem => ({
  id, kind: 'toolbar-item', slot: 'primary-left',
  init: vi.fn(), render: () => ({ destroy() {} }),
});

describe('ExtensionRegistry', () => {
  it('registers, dedupes by id (last wins), removes, and filters by kind', () => {
    const r = new ExtensionRegistry();
    r.register(mod('grid-options'));
    r.register(item('save'));
    const replacement = mod('grid-options');
    r.register(replacement);                       // same id → replace
    expect(r.all()).toHaveLength(2);
    expect(r.get('grid-options')).toBe(replacement);
    expect(r.settingsModules().map(m => m.id)).toEqual(['grid-options']);
    expect(r.toolbarItems().map(m => m.id)).toEqual(['save']);
    r.remove('save');
    expect(r.has('save')).toBe(false);
  });

  it('initAll calls init once per extension with the context; disposeAll disposes', () => {
    const r = new ExtensionRegistry();
    const m = mod('m');
    const disposed = vi.fn();
    (m as any).dispose = disposed;
    r.register(m);
    const ctx = {} as CgExtContext;
    r.initAll(ctx);
    expect(m.init).toHaveBeenCalledWith(ctx);
    r.disposeAll();
    expect(disposed).toHaveBeenCalledOnce();
  });
});
