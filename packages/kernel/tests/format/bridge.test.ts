// Cycle 21c / Task 17 — wireIntoKernel bridge.

import { describe, it, expect, vi } from 'vitest';
import { wireIntoKernel } from '../../src/format/bridge';

function makeFakeGrid() {
  const registrations = {
    compiler: null as unknown,
    compilerRegisterCount: 0,
    iconSets: {} as Record<string, unknown>,
  };
  const grid = {
    registerFormatCompiler(fn: unknown) {
      registrations.compiler = fn;
      registrations.compilerRegisterCount += 1;
    },
    registerIconSet(name: string, paths: unknown) { registrations.iconSets[name] = paths; },
    _reg: registrations,
  };
  return grid;
}

/** Poll until the async Lucide load lands on the fake grid (the
 *  dynamic import transform can take longer than one macrotask). */
async function waitForLucide(grid: ReturnType<typeof makeFakeGrid>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (grid._reg.iconSets.lucide === undefined && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('wireIntoKernel', () => {
  it('registers format compiler on the grid', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    expect(grid._reg.compiler).not.toBeNull();
    expect(typeof grid._reg.compiler).toBe('function');
  });

  it('is idempotent — re-calling is a no-op', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    expect(grid._reg.compilerRegisterCount).toBe(1);
    wireIntoKernel(grid as unknown);
    expect(grid._reg.compilerRegisterCount).toBe(1);
  });

  it('registers additionalIconSets synchronously when provided', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown, {
      additionalIconSets: { phosphor: { star: 'M1' } },
    });
    expect(grid._reg.iconSets.phosphor).toEqual({ star: 'M1' });
  });

  it('registers the Lucide bundle asynchronously', async () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    await waitForLucide(grid);
    const lucide = grid._reg.iconSets.lucide as Record<string, string> | undefined;
    expect(lucide).toBeDefined();
    // Sanity: the generated bundle is large and contains known icons.
    expect(Object.keys(lucide!).length).toBeGreaterThan(1000);
    expect(lucide!['trending-up']).toBeTypeOf('string');
  });

  it('registered compiler compiles a real Tier 0 format string', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    const compiler = grid._reg.compiler as (s: string) =>
      | { ok: true; program: { formatText: (c: unknown) => string } }
      | { ok: false; error: { message: string } };
    const result = compiler('$#,##0.00');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.program.formatText({ value: 42, row: {}, colId: 'x' })).toBe('$42.00');
    }
  });

  it('registered compiler surfaces compile errors in kernel shape', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    const compiler = grid._reg.compiler as (s: unknown) =>
      | { ok: true }
      | { ok: false; error: { message: string; loc: { start: number; end: number } } };
    // 5 Excel sections — excel-section-count error.
    const result = compiler('0;0;0;0;0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('4 sections');
      expect(result.error.loc).toBeDefined();
    }
  });

  it('registered compiler compiles a composite ColDef', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    const compiler = grid._reg.compiler as (s: unknown) =>
      | { ok: true; program: { formatText: (c: unknown) => string; resolveFragments: (c: unknown) => unknown[] | null } }
      | { ok: false };
    const result = compiler({
      colId: 'summary',
      type: 'composite',
      fragments: [
        { expr: '[symbol]', style: { weight: 'bold' } },
        { text: ' ' },
        { expr: '[price]', format: '$#,##0.00' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = { value: null, row: { symbol: 'AAPL', price: 150.25 }, colId: 'summary' };
      expect(result.program.formatText(ctx)).toBe('AAPL $150.25');
      expect(result.program.resolveFragments(ctx)).toHaveLength(3);
    }
  });

  it('failed icon-set registration during async load is non-fatal', async () => {
    const grid = makeFakeGrid();
    grid.registerIconSet = vi.fn(() => { throw new Error('boom'); });
    expect(() => wireIntoKernel(grid as unknown)).not.toThrow();
    // Give the async load a chance to settle — the .catch swallows the throw.
    await new Promise((r) => setTimeout(r, 50));
  });
});
