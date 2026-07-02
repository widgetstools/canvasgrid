import { describe, it, expect, beforeEach } from 'vitest';
import { resolveColDefs } from '../../src/core/propertyChain';
import {
  registerFormatCompiler,
  _resetFormatCompiler_forTests,
  type FormatCompiler,
} from '../../src/core/formatCompilerSlot';

const fakeCompiler: FormatCompiler = (source) => {
  if (typeof source === 'string' && source === '$#,##0.00') {
    return {
      ok: true,
      program: {
        formatText: (ctx) => `$${Number(ctx.value).toFixed(2)}`,
        resolveStyle: (ctx) => Number(ctx.value) < 0 ? { color: '#e53935' } : null,
        resolveIcon: () => null,
        resolveFragments: () => null,
        source: source,
        tiers: { tier0: true, tier1: false, tier2: false },
      },
    };
  }
  if (typeof source === 'object' && source.type === 'composite') {
    return {
      ok: true,
      program: {
        formatText: () => 'composite',
        resolveStyle: () => null,
        resolveIcon: () => null,
        resolveFragments: () => [{ text: 'a', style: {} }, { text: 'b', style: {} }],
        source: source,
        tiers: { tier0: false, tier1: false, tier2: true },
      },
    };
  }
  return { ok: false, error: { message: 'unknown source', loc: { start: 0, end: 0 } } };
};

describe('compileFormatSlots — string valueFormatter', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('leaves function-form valueFormatter untouched', () => {
    // No compiler registered — behaviour identical to today
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: (p: any) => `val:${p.value}` }] as any);
    expect(typeof resolved[0].valueFormatter).toBe('function');
    expect(resolved[0].valueFormatter!({ value: 5, data: {}, colId: 'x' } as any)).toBe('val:5');
  });

  it('compiles string valueFormatter via registered compiler', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: '$#,##0.00' }] as any);
    expect(typeof resolved[0].valueFormatter).toBe('function');
    expect(resolved[0].valueFormatter!({ value: 42, data: {}, colId: 'x' } as any)).toBe('$42.00');
  });

  it('derives cellStyleFn from format program', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: '$#,##0.00' }] as any);
    const negStyle = resolved[0].cellStyleFn!({ value: -1, data: {}, colId: 'x', rowIndex: 0 } as any);
    expect((negStyle as any)?.color).toBe('#e53935');
    const posStyle = resolved[0].cellStyleFn!({ value: 1, data: {}, colId: 'x', rowIndex: 0 } as any);
    expect(posStyle).toBeUndefined();
  });

  it('user cellStyle (function) overlays format-derived style (user wins)', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x',
      valueFormatter: '$#,##0.00',
      cellStyle: () => ({ color: 'purple', background: 'yellow' }),
    }] as any);
    const style = resolved[0].cellStyleFn!({ value: -1, data: {}, colId: 'x', rowIndex: 0 } as any);
    expect((style as any)?.color).toBe('purple');
    expect((style as any)?.background).toBe('yellow');
  });

  it('compile failure falls back to raw string (no crash)', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: 'unknown-format' }] as any);
    // valueFormatter kept as raw string; no crash, no cellStyleFn from format.
    expect(typeof resolved[0].valueFormatter).toBe('string');
  });

  it('pass-through when no compiler registered', () => {
    // _resetFormatCompiler_forTests called in beforeEach, so no compiler
    const fn = (p: any) => `raw:${p.value}`;
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: fn }] as any);
    expect(resolved[0].valueFormatter).toBe(fn);
  });
});

describe('compileFormatSlots — composite', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('composite ColDef produces _compositeProgram + derived formatters', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x',
      type: 'composite',
      fragments: [{ text: 'a' }],
    }] as any);
    expect((resolved[0] as any)._compositeProgram).toBeDefined();
    expect(resolved[0].valueFormatter!({ value: null, data: {}, colId: 'x' } as any)).toBe('composite');
  });

  it('composite with no compiler registered is pass-through', () => {
    // No compiler — should not throw
    const resolved = resolveColDefs([{
      colId: 'x',
      type: 'composite',
      fragments: [{ text: 'a' }],
    }] as any);
    expect((resolved[0] as any)._compositeProgram).toBeUndefined();
  });
});
