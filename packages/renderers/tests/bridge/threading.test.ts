/**
 * Minimal-composite threading proof — spec §2.3 LOCKED design.
 *
 * Pure integration test over landed kernel mechanics: calls resolveColDef /
 * applyCellProps directly (no VelocityGrid instantiation). Style mirrors
 * packages/kernel/tests/cellClassRules.test.ts — inline fixtures, no imports
 * from that file.
 *
 * Cycle 21f / Task 3.
 */
import { describe, it, expect } from 'vitest';
import { resolveColDef, applyCellProps } from '../../../kernel/src/core/propertyChain';
import type { CellPaintConfig } from '../../../kernel/src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../../../kernel/src/theming/cssReader';
import type { FormatProgramShape } from '../../../kernel/src/core/formatCompilerSlot';
import { makeFakeGc } from '../helpers/fakeGc';

// ---------------------------------------------------------------------------
// Helpers — inline fixtures (shape copied from cellClassRules.test.ts)
// ---------------------------------------------------------------------------

function makeTheme(): ResolvedTheme {
  // Minimal subset — shape mirrors cellClassRules.test.ts inline fixture.
  // Cast because ResolvedTheme has many optional-in-practice theme tokens
  // that aren't needed for these structural tests.
  return {
    font: '13px system-ui',
    fg: '#111111',
    bg: '#ffffff',
    headerBg: '#e8ecef',
    headerFg: '#1a1f24',
    borderColor: '#d5dbe0',
    gridLineColor: '#e8ecef',
    rowAltBg: '#f4f6f8',
    rowHoverBg: '#eef1f3',
    rowSelectedBg: 'rgba(13,148,136,0.12)',
    focusRingColor: '#0d9488',
    focusRingWidth: 2,
    flashFromColor: '#fef3c7',
    flashToColor: 'rgba(254,243,199,0)',
    rowHeight: 30,
    headerHeight: 32,
    resizerHotZone: 4,
    scrollbarThickness: 10,
    cellClassVariants: new Map(),
    headerClassVariants: new Map(),
  } as unknown as ResolvedTheme;
}

function makeConfig(): CellPaintConfig {
  return {
    value: '',
    valueFormatted: '',
    bounds: { x: 0, y: 0, w: 100, h: 30 },
    font: '',
    fg: '',
    bg: '',
    borderColor: '',
    halign: 'left',
    prefillColor: '',
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader: false,
  };
}

/** Minimal synthetic FormatProgramShape stub (per the task brief). */
const stub: FormatProgramShape = {
  formatText: () => '',
  resolveStyle: () => null,
  resolveIcon: () => null,
  resolveFragments: () => null,
  source: 'renderers-thread-stub',
  tiers: { tier0: false, tier1: false, tier2: true },
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('threading proof — composite fallback', () => {
  it('(1) resolveColDef with _compositeProgram and no explicit cellRenderer → cellRenderer === "composite"', () => {
    const resolved = resolveColDef(
      { field: 'summary', _compositeProgram: stub } as any,
    );
    expect(resolved.cellRenderer).toBe('composite');
  });

  it('(2) explicit cellRenderer WINS over composite fallback', () => {
    const resolved = resolveColDef(
      { field: 'summary', _compositeProgram: stub, cellRenderer: 'price' } as any,
    );
    expect(resolved.cellRenderer).toBe('price');
  });
});

describe('threading proof — applyCellProps threads rowData / rowId / themeKind', () => {
  const theme = makeTheme();

  it('(3) applyCellProps with _compositeProgram on non-header → compositeProgram/rowData/rowId/themeKind set', () => {
    // Use case-2 resolved colDef (explicit cellRenderer 'price', but _compositeProgram still present)
    const colDef = resolveColDef(
      { field: 'summary', _compositeProgram: stub, cellRenderer: 'price' } as any,
    );

    const target = makeConfig();
    applyCellProps(target, {
      theme,
      colDef,
      value: null,
      valueFormatted: '',
      x: 0, y: 0, w: 100, h: 24,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: { symbol: 'AAPL', bid: 100.1, ask: 100.3 },
      rowId: 'r1',
      themeKind: 'dark',
    });

    expect(target.rowData).toEqual({ symbol: 'AAPL', bid: 100.1, ask: 100.3 });
    expect(target.rowId).toBe('r1');
    expect(target.themeKind).toBe('dark');
    expect(target.compositeProgram).toBe(stub);
  });

  it('(4) a real painter can read rowData via the composite channel end-to-end', () => {
    const colDef = resolveColDef(
      { field: 'summary', _compositeProgram: stub } as any,
    );

    const target = makeConfig();
    applyCellProps(target, {
      theme,
      colDef,
      value: null,
      valueFormatted: '',
      x: 0, y: 0, w: 100, h: 24,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: { symbol: 'AAPL', bid: 100.1, ask: 100.3 },
      rowId: 'r1',
      themeKind: 'dark',
    });

    // Inline test painter reads bid from rowData and fillText's it.
    const painter = {
      paint(gc: ReturnType<typeof makeFakeGc>, p: CellPaintConfig) {
        gc.fillText(String((p.rowData as { bid?: number } | undefined)?.bid ?? ''), 0, 0);
      },
    };

    const gc = makeFakeGc();
    painter.paint(gc, target);

    const fillTextCall = gc.calls.find(c => c.op === 'fillText');
    expect(fillTextCall).toBeDefined();
    expect(fillTextCall?.args[0]).toBe('100.1');
  });
});
