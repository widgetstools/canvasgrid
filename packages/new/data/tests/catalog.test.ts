import { describe, expect, it } from 'vitest';
import { MemoryConfigBackend, PROVIDER_CATALOG_KEY } from '../src/index';

describe('vg-new-data catalog', () => {
  it('saves and lists providers', async () => {
    const b = new MemoryConfigBackend();
    await b.save({ id: 'a', name: 'A', transport: 'mock' });
    expect((await b.list()).map((r) => r.id)).toEqual(['a']);
    expect(PROVIDER_CATALOG_KEY).toBe('vg-new:provider-catalog');
  });
});
