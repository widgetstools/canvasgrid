import { describe, expect, it } from 'vitest';
import { MemoryConfigBackend } from '../src/catalog/ConfigBackend';
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
