import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearConfigFromLocalStorage,
  configStorageKey,
  hasConfigInLocalStorage,
  loadConfigFromLocalStorage,
  saveConfigToLocalStorage,
} from '../src/configStorage';

beforeEach(() => localStorage.clear());

describe('configStorage', () => {
  it('round-trips config under velocity-grid:config:<gridId>', () => {
    const config = { version: 4, layouts: { version: 1, activeLayoutId: 'default', layouts: [], grid: {} } };
    saveConfigToLocalStorage('grid1', config);
    expect(configStorageKey('grid1')).toBe('velocity-grid:config:grid1');
    expect(hasConfigInLocalStorage('grid1')).toBe(true);
    expect(loadConfigFromLocalStorage('grid1')).toEqual(config);
    clearConfigFromLocalStorage('grid1');
    expect(hasConfigInLocalStorage('grid1')).toBe(false);
  });
});
