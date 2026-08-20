import { describe, expect, it } from 'vitest';
import {
  MemoryConfigBackend,
  LocalStorageConfigBackend,
  createDefaultConfigBackend,
  PROVIDER_CATALOG_STORAGE_KEY,
} from '../src/catalog/ConfigBackend';
import { MemoryStore } from '../src/storage/index';
import type { DataProviderConfig } from '../src/types';

function sample(id: string, name: string): DataProviderConfig {
  return {
    providerId: id,
    name,
    providerType: 'mock',
    rowModel: 'clientSide',
    config: { keyColumn: 'positionId', rowCount: 10 },
  };
}

describe('MemoryConfigBackend', () => {
  it('saves, lists, gets by id/name, removes', async () => {
    const be = new MemoryConfigBackend();
    await be.save(sample('p1', 'Alpha'));
    await be.save(sample('p2', 'Beta'));
    expect((await be.list()).map((r) => r.providerId).sort()).toEqual(['p1', 'p2']);
    expect((await be.get('p1'))?.name).toBe('Alpha');
    expect((await be.getByName('Beta'))?.providerId).toBe('p2');
    await be.remove('p1');
    expect(await be.get('p1')).toBeNull();
  });
});

describe('LocalStorageConfigBackend + IStorage', () => {
  it('persists through an injected MemoryStore', async () => {
    const storage = new MemoryStore();
    const be = new LocalStorageConfigBackend({ storage });
    await be.save(sample('p1', 'Alpha'));
    expect(storage.getItem(PROVIDER_CATALOG_STORAGE_KEY)).toContain('Alpha');
    const again = new LocalStorageConfigBackend({ storage });
    expect((await again.get('p1'))?.name).toBe('Alpha');
  });

  it('createDefaultConfigBackend uses LocalStore-backed catalog', async () => {
    const be = createDefaultConfigBackend();
    expect(be).toBeInstanceOf(LocalStorageConfigBackend);
  });
});
