/**
 * localStorage-backed AppData store — same API as {@link AppDataStore},
 * persisted under a single JSON key (default `vg-new:appdata`).
 */

import { AppDataStore } from './store';

export const APPDATA_STORAGE_PREFIX = 'vg-new:appdata';

export function appDataStorageKey(namespace = 'default'): string {
  return namespace === 'default' ? APPDATA_STORAGE_PREFIX : `${APPDATA_STORAGE_PREFIX}:${namespace}`;
}

/**
 * Named AppData bags persisted to localStorage. Hydrates on construct;
 * writes after every set/delete/clear.
 */
export class LocalStorageAppDataStore extends AppDataStore {
  private readonly key: string;
  private persisting = false;

  constructor(namespace = 'default') {
    super();
    this.key = appDataStorageKey(namespace);
    this.hydrate();
    // Persist after mutations; skip the hydrate-driven path via `persisting`.
    super.subscribe(() => {
      if (!this.persisting) this.persist();
    });
  }

  private hydrate(): void {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      this.persisting = true;
      try {
        for (const [providerName, bag] of Object.entries(parsed as Record<string, unknown>)) {
          if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
          for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
            super.set(providerName, key, value);
          }
        }
      } finally {
        this.persisting = false;
      }
    } catch {
      /* ignore corrupt / quota */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.snapshot()));
    } catch {
      /* quota / private mode */
    }
  }
}
