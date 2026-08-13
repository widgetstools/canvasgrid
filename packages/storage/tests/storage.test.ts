import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStore,
  MemoryStore,
  RestStore,
  getJson,
  setJson,
  storageGetSync,
  storageSetSync,
} from '../src/index';

describe('MemoryStore', () => {
  it('round-trips string and json helpers', async () => {
    const s = new MemoryStore();
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
    await setJson(s, 'doc', { x: 2 });
    expect(await getJson<{ x: number }>(s, 'doc')).toEqual({ x: 2 });
    s.removeItem('a');
    expect(s.getItem('a')).toBeNull();
  });
});

describe('LocalStore', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('persists via localStorage', () => {
    const s = new LocalStore();
    storageSetSync(s, 'k', 'v');
    expect(storageGetSync(s, 'k')).toBe('v');
    expect(localStorage.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(localStorage.getItem('k')).toBeNull();
  });
});

describe('RestStore', () => {
  it('GETs / PUTs / DELETEs under /kv/{key}', async () => {
    const map = new Map<string, string>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const key = decodeURIComponent(url.split('/kv/')[1] ?? '');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        if (!map.has(key)) return new Response(null, { status: 404 });
        return new Response(map.get(key)!, { status: 200 });
      }
      if (method === 'PUT') {
        map.set(key, String(init?.body ?? ''));
        return new Response(null, { status: 204 });
      }
      if (method === 'DELETE') {
        map.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    });

    const s = new RestStore({ baseUrl: 'https://example.test/api/', fetchImpl: fetchImpl as typeof fetch });
    expect(await s.getItem('vg-appdata')).toBeNull();
    await s.setItem('vg-appdata', '{"a":1}');
    expect(await s.getItem('vg-appdata')).toBe('{"a":1}');
    await s.removeItem('vg-appdata');
    expect(await s.getItem('vg-appdata')).toBeNull();
    expect(fetchImpl).toHaveBeenCalled();
  });
});
