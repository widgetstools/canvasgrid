import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearConfigFromLocalStorage,
  configStorageKey,
  hasConfigInLocalStorage,
  loadConfigFromLocalStorage,
  saveConfigToLocalStorage,
} from '../src/configStorage';
import { instanceStorageKey } from '../src/profiles/configSession';

beforeEach(() => localStorage.clear());

describe('configStorage', () => {
  it('round-trips workspace through ConfigSession instance key', () => {
    const config = { version: 4, layouts: { version: 1, activeLayoutId: 'default', layouts: [], grid: {} } };
    saveConfigToLocalStorage('grid1', config);
    expect(configStorageKey('grid1')).toBe('velocity-grid:config:grid1');
    expect(instanceStorageKey('grid1')).toBe('velocity-grid:instance:grid1');
    expect(hasConfigInLocalStorage('grid1')).toBe(true);
    expect(localStorage.getItem(instanceStorageKey('grid1'))).toBeTruthy();
    const loaded = loadConfigFromLocalStorage('grid1') as { version: number; layouts?: unknown };
    expect(loaded.version).toBe(4);
    expect(loaded.layouts).toEqual(config.layouts);
    clearConfigFromLocalStorage('grid1');
    expect(hasConfigInLocalStorage('grid1')).toBe(false);
  });
});
