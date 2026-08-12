import { describe, expect, it } from 'vitest';
import { AppDataStore, resolveTemplate, assertAppDataResolved } from '../src/index';

describe('vg-new-appdata', () => {
  it('resolves tokens', () => {
    const store = new AppDataStore();
    store.set('Env', 'asOfDate', '2026-08-12');
    expect(resolveTemplate('d={{Env.asOfDate}}', store.lookup)).toBe('d=2026-08-12');
  });

  it('assert fail-closed', () => {
    expect(assertAppDataResolved('{{Env.x}}', 'test')).toContain('unresolved');
  });
});
