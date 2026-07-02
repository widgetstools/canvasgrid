import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerFormatCompiler,
  getFormatCompiler,
  _resetFormatCompiler_forTests,
  type FormatCompiler,
} from '../../src/core/formatCompilerSlot';

describe('Kernel format-compiler slot', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('returns null when no compiler registered', () => {
    expect(getFormatCompiler()).toBeNull();
  });

  it('stores and returns the registered compiler', () => {
    const fake: FormatCompiler = () => ({ ok: true, program: {
      formatText: () => 'fake',
      resolveStyle: () => null,
      resolveIcon: () => null,
      resolveFragments: () => null,
      source: 'fake',
      tiers: { tier0: true, tier1: false, tier2: false },
    } });
    registerFormatCompiler(fake);
    expect(getFormatCompiler()).toBe(fake);
  });

  it('overwrites previous compiler on re-register', () => {
    const first: FormatCompiler = () => ({ ok: false, error: { message: 'first', loc: { start: 0, end: 0 } } });
    const second: FormatCompiler = () => ({ ok: false, error: { message: 'second', loc: { start: 0, end: 0 } } });
    registerFormatCompiler(first);
    registerFormatCompiler(second);
    expect(getFormatCompiler()).toBe(second);
  });
});
