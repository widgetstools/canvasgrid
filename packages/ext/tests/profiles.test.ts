import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import type { ProfileSnapshot } from '../src/extension/types';

const snap = (id: string): ProfileSnapshot => ({
  meta: { id, name: id, updatedAt: 1 },
  gridState: {} as any,
  ext: { theme: 'dark' },
});

describe('LocalStorageProfileStore', () => {
  beforeEach(() => localStorage.clear());

  it('saves, lists, loads and removes profiles under a namespaced key', async () => {
    const store = new LocalStorageProfileStore('demo');
    await store.save('a', snap('a'));
    await store.save('b', snap('b'));
    expect((await store.list()).map(m => m.id).sort()).toEqual(['a', 'b']);
    expect((await store.load('a'))?.ext).toEqual({ theme: 'dark' });
    await store.remove('a');
    expect((await store.list()).map(m => m.id)).toEqual(['b']);
    expect(await store.load('missing')).toBeNull();
  });
});
