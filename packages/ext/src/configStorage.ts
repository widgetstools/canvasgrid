/**
 * Workspace persistence helpers.
 *
 * All reads/writes go through {@link LocalStorageConfigSession} (flat instance
 * document under `velocity-grid:instance:<gridId>`). Legacy
 * `velocity-grid:config:<gridId>` keys are migrated on first open.
 *
 * Prefer injecting a custom {@link ConfigSession} via
 * `ext.profiles.store` for host Config Manager backends.
 */

import {
  LocalStorageConfigSession,
  LEGACY_CONFIG_PREFIX,
  instanceStorageKey,
  type WorkspaceConfig,
} from './profiles/configSession';

/** @deprecated Prefer {@link instanceStorageKey}. Kept for callers/tests. */
export const CONFIG_STORAGE_PREFIX = LEGACY_CONFIG_PREFIX;

export function configStorageKey(gridId: string): string {
  return `${CONFIG_STORAGE_PREFIX}${gridId}`;
}

export { instanceStorageKey };

function session(gridId: string): LocalStorageConfigSession {
  return new LocalStorageConfigSession(gridId);
}

export function saveConfigToLocalStorage(gridId: string, config: unknown): void {
  if (!gridId) {
    console.warn('[velocity-grid-ext] saveConfigToLocalStorage: gridId is required');
    return;
  }
  try {
    session(gridId).saveWorkspaceSync(config as WorkspaceConfig);
  } catch (err) {
    console.warn('[velocity-grid-ext] saveConfigToLocalStorage failed:', err);
  }
}

export function loadConfigFromLocalStorage(gridId: string): unknown | null {
  if (!gridId) return null;
  try {
    return session(gridId).loadWorkspaceSync();
  } catch (err) {
    console.warn('[velocity-grid-ext] loadConfigFromLocalStorage failed:', err);
    return null;
  }
}

export function hasConfigInLocalStorage(gridId: string): boolean {
  if (!gridId) return false;
  try {
    return session(gridId).hasWorkspaceSync();
  } catch {
    return false;
  }
}

export function clearConfigFromLocalStorage(gridId: string): void {
  if (!gridId) return;
  try {
    session(gridId).clearWorkspaceSync();
    // Drop legacy key so a later migrate does not resurrect it.
    try { localStorage.removeItem(configStorageKey(gridId)); } catch { /* ignore */ }
  } catch {
    /* ignore */
  }
}
