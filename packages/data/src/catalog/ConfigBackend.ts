import type { DataProviderConfig } from '../types';
import {
  LocalStore,
  storageGet,
  storageSet,
  type IStorage,
} from '../storage/index';

export interface ConfigBackend {
  list(userId?: string): Promise<DataProviderConfig[]>;
  get(providerId: string): Promise<DataProviderConfig | null>;
  getByName(name: string): Promise<DataProviderConfig | null>;
  save(cfg: DataProviderConfig): Promise<DataProviderConfig>;
  remove(providerId: string): Promise<void>;
}

export const PROVIDER_CATALOG_STORAGE_KEY = 'vg-data:provider-catalog';

export type LocalStorageConfigBackendOptions = {
  /** Shared transport (default: new LocalStore()). */
  storage?: IStorage;
  /** Override catalog document key (default: vg-data:provider-catalog). */
  key?: string;
};

/**
 * Provider catalog backed by {@link IStorage} (default {@link LocalStore}).
 * Same key as the historical localStorage catalog so existing data keeps working.
 */
export class LocalStorageConfigBackend implements ConfigBackend {
  private readonly storage: IStorage;
  private readonly key: string;

  constructor(opts?: LocalStorageConfigBackendOptions) {
    this.storage = opts?.storage ?? new LocalStore();
    this.key = opts?.key ?? PROVIDER_CATALOG_STORAGE_KEY;
  }

  private async read(): Promise<DataProviderConfig[]> {
    try {
      const raw = await storageGet(this.storage, this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as DataProviderConfig[] : [];
    } catch {
      return [];
    }
  }

  private async write(rows: DataProviderConfig[]): Promise<void> {
    await storageSet(this.storage, this.key, JSON.stringify(rows));
  }

  async list(userId?: string): Promise<DataProviderConfig[]> {
    const all = await this.read();
    return userId ? all.filter((r) => !r.userId || r.userId === userId) : all;
  }

  async get(providerId: string): Promise<DataProviderConfig | null> {
    return (await this.read()).find((r) => r.providerId === providerId) ?? null;
  }

  async getByName(name: string): Promise<DataProviderConfig | null> {
    return (await this.read()).find((r) => r.name === name) ?? null;
  }

  async save(cfg: DataProviderConfig): Promise<DataProviderConfig> {
    const rows = await this.read();
    const next = { ...cfg, updatedAt: new Date().toISOString() };
    const i = rows.findIndex((r) => r.providerId === cfg.providerId);
    if (i >= 0) rows[i] = next;
    else rows.push(next);
    await this.write(rows);
    return next;
  }

  async remove(providerId: string): Promise<void> {
    await this.write((await this.read()).filter((r) => r.providerId !== providerId));
  }
}

const IDB_NAME = 'vg-data-catalog';
const IDB_STORE = 'providers';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'providerId' });
        store.createIndex('name', 'name', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @deprecated Prefer {@link LocalStorageConfigBackend} with a shared {@link IStorage}
 * (LocalStore / RestStore). Kept for hosts that already seeded IndexedDB.
 */
export class IndexedDbConfigBackend implements ConfigBackend {
  async list(userId?: string): Promise<DataProviderConfig[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => {
        let rows = (req.result ?? []) as DataProviderConfig[];
        if (userId) rows = rows.filter((r) => !r.userId || r.userId === userId);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async get(providerId: string): Promise<DataProviderConfig | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(providerId);
      req.onsuccess = () => resolve((req.result as DataProviderConfig) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async getByName(name: string): Promise<DataProviderConfig | null> {
    const all = await this.list();
    return all.find((r) => r.name === name) ?? null;
  }

  async save(cfg: DataProviderConfig): Promise<DataProviderConfig> {
    const next = { ...cfg, updatedAt: new Date().toISOString() };
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(next);
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error);
    });
  }

  async remove(providerId: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(providerId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/** In-memory catalog — tests and ephemeral sessions. */
export class MemoryConfigBackend implements ConfigBackend {
  private rows = new Map<string, DataProviderConfig>();

  async list(userId?: string): Promise<DataProviderConfig[]> {
    const all = [...this.rows.values()];
    return userId ? all.filter((r) => !r.userId || r.userId === userId) : all;
  }

  async get(providerId: string): Promise<DataProviderConfig | null> {
    return this.rows.get(providerId) ?? null;
  }

  async getByName(name: string): Promise<DataProviderConfig | null> {
    return [...this.rows.values()].find((r) => r.name === name) ?? null;
  }

  async save(cfg: DataProviderConfig): Promise<DataProviderConfig> {
    const next = { ...cfg, updatedAt: new Date().toISOString() };
    this.rows.set(cfg.providerId, next);
    return next;
  }

  async remove(providerId: string): Promise<void> {
    this.rows.delete(providerId);
  }
}

/** REST / enterprise config-service backend (domain provider API, not generic KV). */
export class RestConfigBackend implements ConfigBackend {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  private url(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  async list(userId?: string): Promise<DataProviderConfig[]> {
    const u = new URL(this.url('providers'));
    if (userId) u.searchParams.set('userId', userId);
    const res = await this.fetchImpl(u.toString());
    if (!res.ok) throw new Error(`Config list failed: HTTP ${res.status}`);
    return (await res.json()) as DataProviderConfig[];
  }

  async get(providerId: string): Promise<DataProviderConfig | null> {
    const res = await this.fetchImpl(this.url(`providers/${encodeURIComponent(providerId)}`));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Config get failed: HTTP ${res.status}`);
    return (await res.json()) as DataProviderConfig;
  }

  async getByName(name: string): Promise<DataProviderConfig | null> {
    const u = new URL(this.url('providers'));
    u.searchParams.set('name', name);
    const res = await this.fetchImpl(u.toString());
    if (!res.ok) throw new Error(`Config getByName failed: HTTP ${res.status}`);
    const rows = (await res.json()) as DataProviderConfig[];
    return rows[0] ?? null;
  }

  async save(cfg: DataProviderConfig): Promise<DataProviderConfig> {
    const res = await this.fetchImpl(this.url(`providers/${encodeURIComponent(cfg.providerId)}`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (!res.ok) throw new Error(`Config save failed: HTTP ${res.status}`);
    return (await res.json()) as DataProviderConfig;
  }

  async remove(providerId: string): Promise<void> {
    const res = await this.fetchImpl(this.url(`providers/${encodeURIComponent(providerId)}`), {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Config remove failed: HTTP ${res.status}`);
    }
  }
}

/** Default catalog — shared {@link LocalStore} key `vg-data:provider-catalog`. */
export function createDefaultConfigBackend(storage?: IStorage): ConfigBackend {
  return new LocalStorageConfigBackend({ storage });
}

/**
 * Prefer this name in host docs: this interface is the **provider definition
 * catalog**, not Markets Config Manager (profiles / identity / sync).
 * See docs/starui-platform/03-config-planes.md.
 */
export type ProviderCatalogBackend = ConfigBackend;
