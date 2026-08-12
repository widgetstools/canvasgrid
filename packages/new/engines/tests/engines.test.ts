import { describe, expect, it } from 'vitest';
import { CalcEngine, EditEngine, FormatEngine, RulesEngine } from '../src/index';

describe('engines', () => {
  it('calc evaluates a+b', () => {
    const c = new CalcEngine();
    c.setColumns([{ alias: 'total', expression: 'pnl + dailyPnl' }]);
    expect(c.evaluate({ pnl: 10, dailyPnl: 2 })).toEqual({ total: 12 });
  });

  it('rules match predicates', () => {
    const r = new RulesEngine();
    r.setRules([{ id: '1', expression: 'pnl < 0', style: { color: 'red' } }]);
    expect(r.match({ pnl: -1 })?.id).toBe('1');
    expect(r.match({ pnl: 1 })).toBeUndefined();
  });

  it('format undo', () => {
    const f = new FormatEngine();
    f.apply({ colIds: ['pnl'], bold: true });
    expect(f.getPatches()).toHaveLength(1);
    expect(f.undo()).toBe(true);
    expect(f.getPatches()).toHaveLength(0);
  });

  it('edit multiply + undo', () => {
    const e = new EditEngine();
    const rows = [{ id: '1', pnl: 10 }];
    const next = e.apply(rows, (r) => String(r.id), 'pnl', ['1'], { type: 'multiply', factor: 2 });
    expect(next[0]!.pnl).toBe(20);
    const undone = e.undo(next, (r) => String(r.id));
    expect(undone[0]!.pnl).toBe(10);
  });
});
