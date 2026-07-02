import { describe, it, expect, beforeEach } from 'vitest';
import { registerIconSet, resolveIcon, listIconSets, _resetIconRegistry_forTests } from '../../src/icons/registry';

// vitest jsdom env provides Path2D; if not, mock.
class FakePath2D {
  constructor(public d: string) {}
}
if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = FakePath2D;
}

describe('Icon registry', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('resolveIcon returns null when no sets registered', () => {
    expect(resolveIcon('foo')).toBeNull();
  });

  it('registerIconSet + resolveIcon roundtrip', () => {
    registerIconSet('lucide', { 'trending-up': 'M1 1 L2 2' });
    const p = resolveIcon('trending-up');
    expect(p).not.toBeNull();
  });

  it('setHint prioritizes named set', () => {
    registerIconSet('lucide', { star: 'M1' });
    registerIconSet('phosphor', { star: 'M2' });
    const p1 = resolveIcon('star', 'phosphor') as unknown as FakePath2D;
    const p2 = resolveIcon('star', 'lucide') as unknown as FakePath2D;
    expect(p1.d).toBe('M2');
    expect(p2.d).toBe('M1');
  });

  it('lazy Path2D — repeat call returns cached instance', () => {
    registerIconSet('lucide', { a: 'M1' });
    const first = resolveIcon('a');
    const second = resolveIcon('a');
    expect(first).toBe(second);
  });

  it('listIconSets returns registered sets in insertion order', () => {
    registerIconSet('a', {});
    registerIconSet('b', {});
    expect(listIconSets()).toEqual(['a', 'b']);
  });

  it('unknown icon returns null', () => {
    registerIconSet('lucide', { star: 'M1' });
    expect(resolveIcon('unknown')).toBeNull();
  });
});
