/**
 * Shared string KV transport for AppData, provider catalog, and Ext ConfigSession.
 * Domain APIs stay on top; hosts swap LocalStore / RestStore / MemoryStore.
 */
export interface IStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export type StorageOpts = {
  storage?: IStorage;
};
