import { describe, it, expect } from 'vitest';
import { FloatingFilterSubgrid } from '../src/core/floatingFilterSubgrid';

describe('FloatingFilterSubgrid', () => {
  it('reports 1 row when enabled, 0 when disabled', () => {
    let enabled = true;
    const sub = new FloatingFilterSubgrid(() => 28, () => enabled);
    expect(sub.getRowCount()).toBe(1);
    enabled = false;
    expect(sub.getRowCount()).toBe(0);
  });

  it('returns the configured height for row 0', () => {
    const sub = new FloatingFilterSubgrid(() => 28, () => true);
    expect(sub.getRowHeight(0)).toBe(28);
  });

  it('honours a dynamic height accessor', () => {
    let h = 28;
    const sub = new FloatingFilterSubgrid(() => h, () => true);
    expect(sub.getRowHeight(0)).toBe(28);
    h = 36;
    expect(sub.getRowHeight(0)).toBe(36);
  });

  it('returns null for every getCell (DOM owns the cell)', () => {
    const sub = new FloatingFilterSubgrid(() => 28, () => true);
    expect(sub.getCell(0, 'anyCol')).toBeNull();
    expect(sub.getCell(0, 'another')).toBeNull();
  });

  it('declares type: floatingFilter and isHeader/isData/isTotals/isFooter false', () => {
    const sub = new FloatingFilterSubgrid(() => 28, () => true);
    expect(sub.type).toBe('floatingFilter');
    expect(sub.isHeader).toBe(false);
    expect(sub.isData).toBe(false);
    expect(sub.isTotals).toBe(false);
    expect(sub.isFooter).toBe(false);
    expect(sub.isFloatingFilter).toBe(true);
  });
});
