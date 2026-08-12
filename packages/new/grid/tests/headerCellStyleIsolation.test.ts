import { describe, it, expect } from 'vitest';
import { resolveColDef, applyCellProps } from '../src/core/propertyChain';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { ColCellOverrides } from '../src/types';

// Header/cell style isolation: a column's CELL styling (static `cellStyle`
// object or function-form `cellStyle`) never restyles its column header —
// ALIGNMENT is the single attribute that carries onto the caption. Header
// looks come exclusively from the theme, headerClass variants, and
// headerStyle.

function makeTheme(
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
    cellClassVariants: new Map(),
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

const LOUD_CELL_STYLE = {
  fg: '#ff0000',
  bg: '#00ff00',
  fontWeight: 700,
  textDecoration: 'underline',
  halign: 'center',
  valign: 'top',
  decorators: [{ position: 'tr', kind: 'emoji', value: '▲', size: 9 }],
} as const;

function fold(colDef: ReturnType<typeof resolveColDef>, isHeader: boolean, theme = makeTheme()): CellPaintConfig {
  const config = makeConfig();
  applyCellProps(config, {
    theme,
    colDef,
    value: 'DV01',
    valueFormatted: 'DV01',
    x: 0, y: 0, w: 100, h: 30,
    rowBg: isHeader ? theme.headerBg : theme.bg,
    prefillColor: theme.bg,
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader,
    rowData: {},
  });
  return config;
}

describe('header isolation — static cellStyle', () => {
  const colDef = resolveColDef({ field: 'dv01', cellStyle: LOUD_CELL_STYLE as never });

  it('applies nothing but alignment to the header', () => {
    const theme = makeTheme();
    const config = fold(colDef, true, theme);
    expect(config.fg).toBe(theme.headerFg);       // NOT #ff0000
    expect(config.bg).toBe(theme.headerBg);       // NOT #00ff00
    expect(config.font).toBe(theme.font);         // weight untouched
    expect(config.textDecoration).toBeUndefined();
    expect(config.decorators).toBeUndefined();
    expect(config.halign).toBe('center');         // alignment DOES carry
    expect(config.valign).toBe('top');
  });

  it('still applies fully to the data cell', () => {
    const config = fold(colDef, false);
    expect(config.fg).toBe('#ff0000');
    expect(config.bg).toBe('#00ff00');
    expect(config.textDecoration).toBe('underline');
    expect(config.halign).toBe('center');
  });

  it('headers without an explicit cell halign stay left', () => {
    const plain = resolveColDef({ field: 'qty', cellDataType: 'number' });
    const config = fold(plain, true);
    expect(config.halign).toBe('left'); // numbers right-align cells, not captions
  });
});

describe('header isolation — headerStyle still wins the header', () => {
  it('headerStyle restyles the header while cellStyle is ignored there', () => {
    const colDef = resolveColDef({
      field: 'dv01',
      cellStyle: LOUD_CELL_STYLE as never,
      headerStyle: { fg: '#123456' } as never,
    });
    const config = fold(colDef, true);
    expect(config.fg).toBe('#123456'); // from headerStyle
    expect(config.bg).toBe(makeTheme().headerBg); // cellStyle.bg still ignored
  });
});

describe('header isolation — function-form cellStyle', () => {
  const colDef = resolveColDef({
    field: 'dv01',
    cellStyle: () => ({ fg: '#ff00ff', bg: '#101010', halign: 'right' }),
  });

  it('is skipped entirely on headers (it runs after headerStyle and is per-row)', () => {
    const theme = makeTheme();
    const config = fold(colDef, true, theme);
    expect(config.fg).toBe(theme.headerFg);
    expect(config.bg).toBe(theme.headerBg);
    expect(config.halign).toBe('left'); // fn halign does NOT carry — only static cellStyle.halign does
  });

  it('applies on data cells', () => {
    const config = fold(colDef, false);
    expect(config.fg).toBe('#ff00ff');
    expect(config.halign).toBe('right');
  });
});
