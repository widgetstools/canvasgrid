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

  it('derives cellStyleFn from format program (mapped to ColCellOverrides keys)', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: '$#,##0.00' }] as any);
    const negStyle = resolved[0].cellStyleFn!({ value: -1, data: {}, colId: 'x', rowIndex: 0 } as any);
    // Task 13 fix — resolveStyle's `color` maps onto the kernel's `fg`
    // override key so applyOverridePatch actually paints it.
    expect((negStyle as any)?.fg).toBe('#e53935');
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

  it("compiled composite routes cellRenderer to 'composite' (Task 13)", () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x',
      type: 'composite',
      fragments: [{ text: 'a' }],
      align: 'right',
      overflow: 'clip',
    }] as any);
    expect(resolved[0].cellRenderer).toBe('composite');
    expect(resolved[0].compositeAlign).toBe('right');
    expect(resolved[0].compositeOverflow).toBe('clip');
  });

  it('explicit cellRenderer wins over composite routing', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x',
      type: 'composite',
      fragments: [{ text: 'a' }],
      cellRenderer: 'text',
    }] as any);
    expect(resolved[0].cellRenderer).toBe('text');
  });

  it('composite without compiler falls back to text renderer', () => {
    const resolved = resolveColDefs([{
      colId: 'x',
      type: 'composite',
      fragments: [{ text: 'a' }],
    }] as any);
    expect(resolved[0].cellRenderer).toBe('text');
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

// ─── Static cellStyle preservation through the format-compile pass ────────
// Regression (VelocityGridExt formatting toolbar): a STATIC cellStyle object —
// authored, or folded in by @wellsfargo-starui/velocity-grid/calc's editColumn/template overrides —
// was silently dropped whenever the column also had a string valueFormatter
// (both mergeCellStyle call sites passed `undefined` for non-function
// styles), so "style this column" never painted on any formatted column.
describe('compileFormatSlots — static cellStyle survives format compile', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('static object + string formatter → merged cellStyleFn carrying the static keys', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x', valueFormatter: '$#,##0.00',
      cellStyle: { bg: '#12333a', fg: '#4fd1c5' },
    }] as any);
    // The static object stays visible on the resolved def (the header fold
    // reads cellStyle.halign); the merged fn carries the same keys for paint.
    expect(resolved[0].cellStyle).toEqual({ bg: '#12333a', fg: '#4fd1c5' });
    const style = resolved[0].cellStyleFn!({ value: 5, data: {}, colId: 'x', rowIndex: 0 } as any);
    expect(style).toEqual({ bg: '#12333a', fg: '#4fd1c5' }); // was undefined before the fix
  });

  it('user static style overlays the format-derived style (mergeCellStyle contract)', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x', valueFormatter: '$#,##0.00',
      cellStyle: { fg: '#4fd1c5' },
    }] as any);
    // negative → program says fg '#e53935'; user's static fg wins, per
    // mergeCellStyle's documented "user overlays and wins" precedence.
    const neg = resolved[0].cellStyleFn!({ value: -1, data: {}, colId: 'x', rowIndex: 0 } as any);
    expect(neg).toEqual({ fg: '#4fd1c5' });
  });

  it('composite path: static cellStyle survives too', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x', type: 'composite', fragments: [],
      cellStyle: { bg: '#222222' },
    }] as any);
    const style = resolved[0].cellStyleFn!({ value: 1, data: {}, colId: 'x', rowIndex: 0 } as any);
    expect(style).toEqual({ bg: '#222222' });
  });
});

// ─── Static cellIcon preservation through the format-compile pass ─────────
// Regression (VelocityGridExt formatting toolbar): the pre-branch compileFormatSlots
// derived cellIcon purely from the format program, wiping any STATIC cellIcon
// the moment a string valueFormatter compiled. So the toolbar sequence "set an
// icon, then apply a currency format" silently dropped the icon. The fix keeps
// `evalFormatProgram(...).icon ?? staticRef` — the static ref is the fallback
// when the format string carries no {icon:} of its own.
describe('compileFormatSlots — static cellIcon survives format compile', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('static cellIcon object + compiling string formatter (no format icon) → resolved fn returns the static ref', () => {
    registerFormatCompiler(fakeCompiler); // resolveIcon → null for '$#,##0.00'
    const resolved = resolveColDefs([{
      colId: 'x', valueFormatter: '$#,##0.00',
      cellIcon: { name: 'flame' },
    }] as any);
    const icon = (resolved[0].cellIcon as any)({ value: 5, data: {}, colId: 'x', rowIndex: 0 });
    expect(icon).toEqual({ name: 'flame' }); // was null before the fallback fix
  });

  it('string cellIcon is normalized to { name } and survives too', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x', valueFormatter: '$#,##0.00',
      cellIcon: 'star',
    }] as any);
    const icon = (resolved[0].cellIcon as any)({ value: 5, data: {}, colId: 'x', rowIndex: 0 });
    expect(icon).toEqual({ name: 'star' });
  });
});
