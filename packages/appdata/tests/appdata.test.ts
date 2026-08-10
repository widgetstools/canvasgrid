import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveTemplate,
  resolveCfg,
  collectTemplateRefs,
  findUnresolvedAppDataTokens,
  assertAppDataResolved,
  AppDataStore,
  type AppDataLookup,
} from '../src/index';

const lookup: AppDataLookup = (name, key) => {
  if (name === 'positions' && key === 'asOfDate') return '2026-04-01';
  if (name === 'positions' && key === 'rate') return 1000;
  if (name === 'SessionContext' && key === 'userId') return 'jdoe';
  if (name === 'ctx' && key === 'user') return { id: 'alice', name: 'Alice' };
  return undefined;
};

describe('resolveTemplate', () => {
  it('substitutes SessionContext.userId in a connection string', () => {
    expect(
      resolveTemplate('w2w222w2w;userId={{SessionContext.userId}}', lookup),
    ).toBe('w2w222w2w;userId=jdoe');
  });

  it('substitutes a single token', () => {
    expect(resolveTemplate('asOf={{positions.asOfDate}}', lookup)).toBe('asOf=2026-04-01');
  });

  it('walks nested AppData object values via dotted paths', () => {
    expect(resolveTemplate('user={{ctx.user.id}}', lookup)).toBe('user=alice');
  });

  it('leaves unresolved tokens verbatim', () => {
    expect(resolveTemplate('{{nope.thing}}', lookup)).toBe('{{nope.thing}}');
  });
});

describe('resolveCfg', () => {
  it('walks every string field of a nested cfg shape', () => {
    const cfg = {
      url: 'http://api.example.com/{{positions.asOfDate}}',
      headers: { 'X-User': '{{SessionContext.userId}}' },
      limit: 100,
    };
    expect(resolveCfg(cfg, lookup)).toEqual({
      url: 'http://api.example.com/2026-04-01',
      headers: { 'X-User': 'jdoe' },
      limit: 100,
    });
    expect(cfg.url).toContain('{{');
  });
});

describe('collectTemplateRefs / unresolved', () => {
  it('returns each (provider, key) pair once', () => {
    const refs = collectTemplateRefs({
      a: '{{positions.asOfDate}}',
      b: '{{SessionContext.userId}}',
    });
    expect(refs.map((r) => `${r.providerName}.${r.key}`).sort()).toEqual([
      'SessionContext.userId',
      'positions.asOfDate',
    ]);
  });

  it('assertAppDataResolved fails closed on leftover tokens', () => {
    const cfg = resolveCfg({ url: '{{nope.missing}}' }, lookup);
    expect(findUnresolvedAppDataTokens(cfg)).toEqual(['{{nope.missing}}']);
    expect(assertAppDataResolved(cfg, 'test')).toMatch(/unresolved/);
  });
});

describe('AppDataStore', () => {
  it('get/set/lookup drive resolveTemplate', () => {
    const store = new AppDataStore();
    store.set('SessionContext', 'userId', 'patel');
    expect(store.get('SessionContext', 'userId')).toBe('patel');
    expect(
      resolveTemplate('u={{SessionContext.userId}}', store.lookup),
    ).toBe('u=patel');
  });

  it('subscribe fires on set', () => {
    const store = new AppDataStore();
    const seen: string[] = [];
    const off = store.subscribe((c) => seen.push(`${c.providerName}.${c.key}=${c.value}`));
    store.set('SessionContext', 'userId', 'a');
    store.set('SessionContext', 'userId', 'b');
    off();
    store.set('SessionContext', 'userId', 'c');
    expect(seen).toEqual(['SessionContext.userId=a', 'SessionContext.userId=b']);
  });
});

describe('LocalStorageAppDataStore', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips bags across instances', async () => {
    const { LocalStorageAppDataStore, appDataStorageKey } = await import('../src/localStorageStore');
    const a = new LocalStorageAppDataStore('test-ns');
    a.set('SessionContext', 'userId', 'jdoe');
    a.set('positions', 'asOfDate', '2026-04-01');
    expect(localStorage.getItem(appDataStorageKey('test-ns'))).toBeTruthy();

    const b = new LocalStorageAppDataStore('test-ns');
    expect(b.get('SessionContext', 'userId')).toBe('jdoe');
    expect(b.get('positions', 'asOfDate')).toBe('2026-04-01');
    expect(
      resolveTemplate('{{SessionContext.userId}}/{{positions.asOfDate}}', b.lookup),
    ).toBe('jdoe/2026-04-01');
  });
});
