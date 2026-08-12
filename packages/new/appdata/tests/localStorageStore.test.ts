import { describe, expect, it } from 'vitest';
import {
  APPDATA_STORAGE_PREFIX,
  LocalStorageAppDataStore,
  resolveCfg,
  assertAppDataResolved,
} from '../src/index';

describe('LocalStorageAppDataStore', () => {
  it('persists under vg-new:appdata and resolves templates', () => {
    localStorage.clear();
    const a = new LocalStorageAppDataStore('ls-test');
    a.set('env', 'brokerUrl', 'ws://demo');
    expect(localStorage.getItem(`${APPDATA_STORAGE_PREFIX}:ls-test`)).toContain('brokerUrl');

    const b = new LocalStorageAppDataStore('ls-test');
    expect(b.get('env', 'brokerUrl')).toBe('ws://demo');

    const cfg = resolveCfg(
      { url: '{{env.brokerUrl}}/v1' },
      b.lookup,
    );
    expect(cfg.url).toBe('ws://demo/v1');
    assertAppDataResolved(cfg, 'test');
  });
});
