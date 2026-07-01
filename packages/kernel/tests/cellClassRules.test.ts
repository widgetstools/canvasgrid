/**
 * Cycle 6 / Task 7 — cellClass / cellClassRules / cellStyle (function form) /
 * headerClass via theme-driven variants.
 *
 * Tests cover:
 *  1. Static cellClass applies the matching variant's ColCellOverrides.
 *  2. cellClassRules applies the variant only when the predicate returns true.
 *  3. Multiple matched classes stack, later wins.
 *  4. Function-form cellStyle overrides class-driven variants (highest precedence).
 *  5. headerClass applies the header variant to the header row.
 *  6. Unknown class name produces no override (falls through silently).
 *  7. CColGroupDef.headerClass wired for group-header paint (fix-pass).
 */
import { describe, it, expect } from 'vitest';
import { resolveColDef, applyCellProps } from '../src/core/propertyChain';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { ColCellOverrides } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTheme(
  cellClassVariants: Map<string, ColCellOverrides> = new Map(),
  headerClassVariants: Map<string, ColCellOverrides> = new Map(),
): ResolvedTheme {
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
    cellClassVariants,
    headerClassVariants,
  };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cellClass — static string applies matching variant', () => {
  it('applies bg override from cellClassVariants when cellClass matches a known class', () => {
    const warningVariant: ColCellOverrides = { bg: '#fff4d1', fg: '#6b4f00' };
    const theme = makeTheme(new Map([['warning', warningVariant]]));

    const colDef = resolveColDef({ field: 'pnl', cellClass: 'warning' });
    const config = makeConfig();

    applyCellProps(config, {
      theme,
      colDef,
      value: 100,
      valueFormatted: '100',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: {},
    });

    expect(config.bg).toBe('#fff4d1');
    expect(config.fg).toBe('#6b4f00');
  });
});

describe('cellClassRules — predicate-based class application', () => {
  it('applies variant only when the predicate returns true', () => {
    const positiveVariant: ColCellOverrides = { bg: '#e7f7ec' };
    const theme = makeTheme(new Map([['positive', positiveVariant]]));

    const colDef = resolveColDef({
      field: 'pnl',
      cellClassRules: {
        positive: (p) => typeof p.value === 'number' && p.value > 0,
      },
    });
    const config = makeConfig();

    // Predicate true (value > 0) → variant applies.
    applyCellProps(config, {
      theme,
      colDef,
      value: 50,
      valueFormatted: '50',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: {},
    });
    expect(config.bg).toBe('#e7f7ec');

    // Predicate false (value < 0) → no override, bg stays at rowBg.
    applyCellProps(config, {
      theme,
      colDef,
      value: -10,
      valueFormatted: '-10',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: {},
    });
    expect(config.bg).toBe(theme.bg);
  });
});

describe('cellClass stacking — multiple classes, later wins', () => {
  it('applies later class overrides over earlier class overrides', () => {
    const warningVariant: ColCellOverrides = { bg: '#fff4d1', fg: '#6b4f00', font: '13px bold' };
    const criticalVariant: ColCellOverrides = { bg: '#fde7e9', fg: '#8b0000' };
    const theme = makeTheme(new Map([
      ['warning', warningVariant],
      ['critical', criticalVariant],
    ]));

    // Static class 'warning' + rule that adds 'critical' when value < 0.
    // Both match; critical comes after warning → critical's fields should win.
    const colDef = resolveColDef({
      field: 'pnl',
      cellClass: 'warning',
      cellClassRules: {
        critical: (p) => typeof p.value === 'number' && p.value < 0,
      },
    });
    const config = makeConfig();

    applyCellProps(config, {
      theme,
      colDef,
      value: -5,
      valueFormatted: '-5',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: {},
    });

    // critical's bg and fg override warning's
    expect(config.bg).toBe('#fde7e9');
    expect(config.fg).toBe('#8b0000');
    // font was only set by warning (critical has no font) — warning wins for unset slots
    expect(config.font).toBe('13px bold');
  });
});

describe('cellStyle function form — highest precedence', () => {
  it('function-form cellStyle overrides class-driven variants', () => {
    const warningVariant: ColCellOverrides = { bg: '#fff4d1', fg: '#6b4f00' };
    const theme = makeTheme(new Map([['warning', warningVariant]]));

    const colDef = resolveColDef({
      field: 'pnl',
      cellClass: 'warning',
      // Function-form cellStyle that overrides bg to a custom color
      cellStyle: (p) => ({ bg: '#ccffcc', fg: '#003300' }),
    });
    const config = makeConfig();

    applyCellProps(config, {
      theme,
      colDef,
      value: 10,
      valueFormatted: '10',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: {},
    });

    // cellStyle function wins over the class-driven warning variant
    expect(config.bg).toBe('#ccffcc');
    expect(config.fg).toBe('#003300');
  });
});

describe('headerClass — applies header variant to header row', () => {
  it('applies headerClassVariants when headerClass matches and isHeader=true', () => {
    const stickyVariant: ColCellOverrides = { bg: '#e0e7ff', fg: '#1e3a8a' };
    const theme = makeTheme(
      new Map(),
      new Map([['sticky', stickyVariant]]),
    );

    const colDef = resolveColDef({ field: 'ticker', headerClass: 'sticky' });
    const config = makeConfig();

    applyCellProps(config, {
      theme,
      colDef,
      value: 'Ticker',
      valueFormatted: 'Ticker',
      x: 0, y: 0, w: 100, h: 32,
      rowBg: theme.headerBg,
      prefillColor: theme.headerBg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: true,
      rowData: undefined,
    });

    expect(config.bg).toBe('#e0e7ff');
    expect(config.fg).toBe('#1e3a8a');
  });
});

describe('CColGroupDef.headerClass — wired for group-header paint (fix-pass)', () => {
  it('static string headerClass on a group applies the header variant', () => {
    const stickyVariant: ColCellOverrides = { bg: '#f0f4ff', fg: '#1e3a8a' };
    const theme = makeTheme(
      new Map(),
      new Map([['sticky', stickyVariant]]),
    );

    // Simulate the group-header paint path: applyCellProps is called with
    // groupHeaderClassNames pre-resolved from the group's headerClassStatic.
    const colDef = resolveColDef({ field: 'ticker' }); // leaf colDef — no headerClass
    const config = makeConfig();

    applyCellProps(config, {
      theme,
      colDef,
      value: 'Group Header',
      valueFormatted: 'Group Header',
      x: 0, y: 0, w: 200, h: 32,
      rowBg: theme.headerBg,
      prefillColor: theme.headerBg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: true,
      rowData: undefined,
      // Group's pre-resolved headerClass names (as produced by byRows.ts via groupDef.headerClassStatic)
      groupHeaderClassNames: ['sticky'],
    });

    expect(config.bg).toBe('#f0f4ff');
    expect(config.fg).toBe('#1e3a8a');
  });

  it('function-form headerClass on a group resolves class names per colId', () => {
    const highlightVariant: ColCellOverrides = { bg: '#fffbe6' };
    const theme = makeTheme(
      new Map(),
      new Map([['highlight', highlightVariant]]),
    );

    // Function-form: returns 'highlight' only for colId 'X'
    const colDef = resolveColDef({ field: 'ticker' });
    const config = makeConfig();

    // Simulate byRows resolving groupDef.headerClassFn({ colId: 'X' }) → ['highlight']
    applyCellProps(config, {
      theme,
      colDef,
      value: 'Group',
      valueFormatted: 'Group',
      x: 0, y: 0, w: 200, h: 32,
      rowBg: theme.headerBg,
      prefillColor: theme.headerBg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: true,
      rowData: undefined,
      groupHeaderClassNames: ['highlight'], // resolved from fn({ colId: 'X' })
    });

    expect(config.bg).toBe('#fffbe6');

    // When fn returns empty (non-matching colId), no override should apply.
    const config2 = makeConfig();
    applyCellProps(config2, {
      theme,
      colDef,
      value: 'Group',
      valueFormatted: 'Group',
      x: 0, y: 0, w: 200, h: 32,
      rowBg: theme.headerBg,
      prefillColor: theme.headerBg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: true,
      rowData: undefined,
      groupHeaderClassNames: [], // fn returned undefined/empty for colId 'Y'
    });

    expect(config2.bg).toBe(theme.headerBg); // no variant applied
  });
});

describe('unknown class name — falls through silently', () => {
  it('produces no override when the class name is not in cellClassVariants', () => {
    const theme = makeTheme(new Map()); // empty variants map

    const colDef = resolveColDef({ field: 'pnl', cellClass: 'nonexistent' });
    const config = makeConfig();

    applyCellProps(config, {
      theme,
      colDef,
      value: 10,
      valueFormatted: '10',
      x: 0, y: 0, w: 100, h: 30,
      rowBg: theme.bg,
      prefillColor: theme.bg,
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowData: {},
    });

    // No override — bg stays at rowBg, fg stays at theme.fg
    expect(config.bg).toBe(theme.bg);
    expect(config.fg).toBe(theme.fg);
  });
});
