import { describe, it, expect, vi } from 'vitest';
import {
  normalizeToken,
  soundex,
  matchFieldToCatalog,
  buildAutoFormatPlan,
  runAutoFormat,
} from '../src/toolbar/autoFormat';

describe('normalizeToken / soundex', () => {
  it('normalizes casing and separators', () => {
    expect(normalizeToken('unrealizedPnL')).toBe('unrealizedpnl');
    expect(normalizeToken('day_chg_pct')).toBe('daychgpct');
  });

  it('encodes Soundex examples', () => {
    expect(soundex('Robert')).toBe(soundex('Rupert'));
    expect(soundex('yield')).toBe(soundex('yeild'));
  });
});

describe('matchFieldToCatalog', () => {
  it('matches nested market value → notional format', () => {
    const r = matchFieldToCatalog('position.marketValue', undefined, 'number');
    expect(r?.alignment).toBe('right');
    expect(r?.format).toBe('#,##0.00');
  });

  it('matches mktValue suffix via value', () => {
    const r = matchFieldToCatalog('mktValue', undefined, 'number');
    expect(r?.format).toBe('#,##0.00');
    expect(r?.alignment).toBe('right');
  });

  it('matches dailyPnl with green/red format', () => {
    const r = matchFieldToCatalog('dailyPnl', undefined, 'number');
    expect(r?.format).toContain('[Green]');
    expect(r?.format).toContain('[Red]');
  });

  it('matches ticker with bold left align', () => {
    const r = matchFieldToCatalog('ticker', undefined, 'text');
    expect(r).toEqual({ bold: true, alignment: 'left' });
  });

  it('does not phonetically match text desk → daychg', () => {
    expect(soundex('desk')).toBe(soundex('daychg'));
    expect(matchFieldToCatalog('desk', undefined, 'text')).toBeNull();
  });

  it('falls back by cellDataType for unknown numeric fields', () => {
    expect(matchFieldToCatalog('xyzzy', undefined, 'number')).toEqual({
      alignment: 'right',
      format: '#,##0.00',
    });
  });
});

describe('buildAutoFormatPlan / runAutoFormat', () => {
  it('builds a plan keyed by colId', () => {
    const plan = buildAutoFormatPlan([
      { colId: 'pnl', field: 'pnl', cellDataType: 'number' },
      { colId: 'desk', field: 'desk', cellDataType: 'text' },
    ]);
    expect(plan.pnl?.format).toContain('[Green]');
    expect(plan.desk).toBeUndefined();
  });

  it('applies format + cellStyle via editColumn', () => {
    const editColumn = vi.fn();
    const markDirty = vi.fn();
    const n = runAutoFormat({
      grid: {
        getGridOption: (k) => (k === 'columnDefs'
          ? [
              { colId: 'mktValue', field: 'mktValue', cellDataType: 'number' },
              { colId: 'ticker', field: 'ticker', cellDataType: 'text' },
              { colId: 'ccy', field: 'ccy', cellDataType: 'text' },
            ]
          : undefined),
        editColumn,
      },
      profiles: { markDirty },
    });
    expect(n).toBe(3);
    expect(editColumn).toHaveBeenCalledWith('mktValue', {
      format: '#,##0.00',
      cellStyle: { halign: 'right' },
    });
    expect(editColumn).toHaveBeenCalledWith('ticker', {
      cellStyle: { halign: 'left', fontWeight: 'bold' },
    });
    expect(editColumn).toHaveBeenCalledWith('ccy', {
      cellStyle: { halign: 'center' },
    });
    expect(markDirty).toHaveBeenCalled();
  });
});
