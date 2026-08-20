/**
 * Persisted AppData store — same API as {@link AppDataStore},
 * backed by a shared {@link IStorage} (default {@link LocalStore}).
 */

import {
  LocalStore,
  storageGetSync,
  type IStorage,
} from '../storage/index';
import { AppDataStore } from './store';

export const APPDATA_STORAGE_PREFIX = 'vg-appdata';

export function appDataStorageKey(namespace = 'default'): string {
  return namespace === 'default' ? APPDATA_STORAGE_PREFIX : `${APPDATA_STORAGE_PREFIX}:${namespace}`;
}

export type PersistedAppDataStoreOptions = {
  /** Shared transport (default: new LocalStore()). */
  storage?: IStorage;
};

/**
 * Named AppData bags persisted through {@link IStorage}. Hydrates on construct;
 * writes after every set/delete/clear. Sync hydrate/persist requires a sync
 * store (LocalStore / MemoryStore); async RestStore should use a host-level
 * hydrate before mount.
 */
export class PersistedAppDataStore extends AppDataStore {
  private readonly key: string;
  private readonly storage: IStorage;
  private persisting = false;
  private persistScheduled = false;

  constructor(namespace = 'default', opts?: PersistedAppDataStoreOptions | IStorage) {
    super();
    this.key = appDataStorageKey(namespace);
    this.storage = resolveStorage(opts);
    this.hydrate();
    // Persist after mutations; skip the hydrate-driven path via `persisting`.
    super.subscribe(() => {
      if (!this.persisting) this.schedulePersist();
    });
  }

  /** Coalesces rapid successive mutations (e.g. a bulk `clear()`, which
   *  emits per-key) into a single JSON.stringify + storage write per
   *  microtask tick instead of one write per mutation. */
  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistScheduled = false;
      this.persist();
    });
  }

  private hydrate(): void {
    try {
      const raw = storageGetSync(this.storage, this.key);
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
      /* ignore corrupt / quota / async storage */
    }
  }

  private persist(): void {
    try {
      const payload = JSON.stringify(this.snapshot());
      const result = this.storage.setItem(this.key, payload);
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch(() => { /* ignore */ });
      }
    } catch {
      /* quota / private mode */
    }
  }
}

function resolveStorage(opts?: PersistedAppDataStoreOptions | IStorage): IStorage {
  if (!opts) return new LocalStore();
  if (typeof (opts as IStorage).getItem === 'function') return opts as IStorage;
  return (opts as PersistedAppDataStoreOptions).storage ?? new LocalStore();
}

/**
 * @deprecated Prefer {@link PersistedAppDataStore}. Alias kept for hosts that
 * construct LocalStorageAppDataStore by name.
 */
export class LocalStorageAppDataStore extends PersistedAppDataStore {}
