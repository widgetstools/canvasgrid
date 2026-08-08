/**
 * Default localStorage persistence for the full grid config blob
 * (`getConfig` / view state + layouts), keyed by `gridId`.
 *
 * Key: `velocity-grid:config:<gridId>`
 */

export const CONFIG_STORAGE_PREFIX = 'velocity-grid:config:';

export function configStorageKey(gridId: string): string {
  return `${CONFIG_STORAGE_PREFIX}${gridId}`;
}

export function saveConfigToLocalStorage(gridId: string, config: unknown): void {
  if (!gridId) {
    console.warn('[velocity-grid-ext] saveConfigToLocalStorage: gridId is required');
    return;
  }
  try {
    localStorage.setItem(configStorageKey(gridId), JSON.stringify(config));
  } catch (err) {
    console.warn('[velocity-grid-ext] saveConfigToLocalStorage failed:', err);
  }
}

export function loadConfigFromLocalStorage(gridId: string): unknown | null {
  if (!gridId) return null;
  try {
    const raw = localStorage.getItem(configStorageKey(gridId));
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch (err) {
    console.warn('[velocity-grid-ext] loadConfigFromLocalStorage failed:', err);
    return null;
  }
}

export function hasConfigInLocalStorage(gridId: string): boolean {
  if (!gridId) return false;
  try {
    return localStorage.getItem(configStorageKey(gridId)) != null;
  } catch {
    return false;
  }
}

export function clearConfigFromLocalStorage(gridId: string): void {
  if (!gridId) return;
  try {
    localStorage.removeItem(configStorageKey(gridId));
  } catch {
    /* ignore */
  }
}
