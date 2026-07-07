import { describe, it, expect } from 'vitest';
import type { SettingsModule, ToolbarItem } from '../src/extension/types';
import { isSettingsModule, isToolbarItem } from '../src/extension/types';

describe('extension type guards', () => {
  const mod = {
    id: 'x', kind: 'settings-module', title: 'X', icon: 'i', category: 'layout',
    init() {}, mount() { return { destroy() {} }; },
  } as SettingsModule;
  const item = {
    id: 'y', kind: 'toolbar-item', slot: 'primary-left',
    init() {}, render() { return { destroy() {} }; },
  } as ToolbarItem;

  it('discriminates settings-module vs toolbar-item', () => {
    expect(isSettingsModule(mod)).toBe(true);
    expect(isSettingsModule(item)).toBe(false);
    expect(isToolbarItem(item)).toBe(true);
    expect(isToolbarItem(mod)).toBe(false);
  });
});
