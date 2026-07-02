import { describe, expect, it } from 'vitest';
import {
  DATA_VERSION_MAP_SOURCE, DataVersionMap, SCOPE_KEY_SOURCE, scopeKeyOf,
} from '../src/scopeKey';

describe('scopeKeyOf — canonicalization', () => {
  it('canonical forms', () => {
    expect(scopeKeyOf({ kind: 'all' })).toBe('all');
    expect(scopeKeyOf({ kind: 'visible' })).toBe('visible');
    expect(scopeKeyOf({ kind: 'group' }, { groupKey: 'sig9|Energy/US' })).toBe('group:sig9|Energy/US');
    expect(scopeKeyOf({ kind: 'parent' }, { parentKey: 'sig9|Energy' })).toBe('parent:sig9|Energy');
  });

  it('missing required ctx member throws (programmer error, not a null cell)', () => {
    expect(() => scopeKeyOf({ kind: 'group' })).toThrow(/groupKey/);
    expect(() => scopeKeyOf({ kind: 'parent' }, { groupKey: 'x' })).toThrow(/parentKey/);
  });

  it('SCOPE_KEY_SOURCE / DATA_VERSION_MAP_SOURCE round-trip through new Function (worker shipping)', () => {
    const rebuiltFn = new Function('return (' + SCOPE_KEY_SOURCE + ')')() as typeof scopeKeyOf;
    expect(rebuiltFn({ kind: 'all' })).toBe('all');
    expect(rebuiltFn({ kind: 'group' }, { groupKey: 'g' })).toBe('group:g');
    const RebuiltMap = new Function('return (' + DATA_VERSION_MAP_SOURCE + ')')() as typeof DataVersionMap;
    const m = new RebuiltMap();
    expect(m.bump('all')).toBe(1);
    expect(m.versionOf('all')).toBe(1);
  });
});

describe('DataVersionMap', () => {
  it('versionOf defaults to 0; bump increments and returns the new version', () => {
    const m = new DataVersionMap();
    expect(m.versionOf('all')).toBe(0);
    expect(m.bump('all')).toBe(1);
    expect(m.bump('all')).toBe(2);
    expect(m.versionOf('all')).toBe(2);
    expect(m.versionOf('visible')).toBe(0); // untouched
  });

  it('bumpAllMatching bumps only prefixed keys and reports the count (regroup invalidation)', () => {
    const m = new DataVersionMap();
    m.bump('group:s1|A');
    m.bump('group:s1|B');
    m.bump('parent:s1|A');
    m.bump('all');
    expect(m.bumpAllMatching('group:')).toBe(2);
    expect(m.versionOf('group:s1|A')).toBe(2);
    expect(m.versionOf('group:s1|B')).toBe(2);
    expect(m.versionOf('parent:s1|A')).toBe(1);
    expect(m.versionOf('all')).toBe(1);
  });

  it('clear resets everything to 0', () => {
    const m = new DataVersionMap();
    m.bump('all');
    m.clear();
    expect(m.versionOf('all')).toBe(0);
  });
});
