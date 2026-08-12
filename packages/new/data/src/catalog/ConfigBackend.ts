export const PROVIDER_CATALOG_KEY = 'vg-new:provider-catalog';

export type DataProviderConfig = {
  id: string;
  name: string;
  transport: 'mock' | 'stomp' | 'rest' | 'websocket' | 'perspective';
  connection?: Record<string, unknown>;
  columnDefinitions?: Array<{ field: string; type?: string }>;
  updatedAt?: number;
};

export interface ConfigBackend {
  list(): Promise<DataProviderConfig[]>;
  get(id: string): Promise<DataProviderConfig | null>;
  save(cfg: DataProviderConfig): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryConfigBackend implements ConfigBackend {
  private readonly map = new Map<string, DataProviderConfig>();

  async list(): Promise<DataProviderConfig[]> {
    return [...this.map.values()];
  }

  async get(id: string): Promise<DataProviderConfig | null> {
    return this.map.get(id) ?? null;
  }

  async save(cfg: DataProviderConfig): Promise<void> {
    this.map.set(cfg.id, { ...cfg, updatedAt: Date.now() });
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}

export class LocalStorageConfigBackend implements ConfigBackend {
  constructor(private readonly key = PROVIDER_CATALOG_KEY) {}

  private read(): DataProviderConfig[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as DataProviderConfig[] : [];
    } catch {
      return [];
    }
  }

  private write(rows: DataProviderConfig[]): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(rows));
    } catch { /* quota */ }
  }

  async list(): Promise<DataProviderConfig[]> {
    return this.read();
  }

  async get(id: string): Promise<DataProviderConfig | null> {
    return this.read().find((r) => r.id === id) ?? null;
  }

  async save(cfg: DataProviderConfig): Promise<void> {
    const rows = this.read().filter((r) => r.id !== cfg.id);
    rows.push({ ...cfg, updatedAt: Date.now() });
    this.write(rows);
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((r) => r.id !== id));
  }
}
