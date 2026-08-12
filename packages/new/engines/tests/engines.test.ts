import { describe, expect, it } from 'vitest';
import {
  AlertsEngine,
  CalcEngine,
  EditEngine,
  EnginesHost,
  FormatEngine,
  RulesEngine,
  TokenBucket,
  compileFormat,
  evaluate,
  parse,
  compile,
  renderMessage,
} from '../src/index';

describe('expression DSL', () => {
  it('evaluates field arithmetic and comparisons', () => {
    const p = parse('[pnl] + [dailyPnl]');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const c = compile(p.ast);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(evaluate(c.compiled, { row: { pnl: 10, dailyPnl: 2 } })).toBe(12);

    const p2 = parse('[pnl] < 0');
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    const c2 = compile(p2.ast);
    expect(c2.ok).toBe(true);
    if (!c2.ok) return;
    expect(evaluate(c2.compiled, { row: { pnl: -1 } })).toBe(true);
  });
});

describe('format', () => {
  it('compiles number / currency / percent codes', () => {
    expect(compileFormat('0.00')(12.345)).toMatch(/12\.35|12\.34/);
    expect(compileFormat('currency')(10)).toMatch(/\$/);
    expect(compileFormat('0%')(0.5)).toMatch(/%/);
  });

  it('format engine undo/redo', () => {
    const f = new FormatEngine();
    f.apply({ colIds: ['pnl'], bold: true, format: '0.00' });
    expect(f.resolve('pnl').bold).toBe(true);
    expect(f.formatValue('pnl', 1.2)).toMatch(/1\.20|1\.2/);
    expect(f.undo()).toBe(true);
    expect(f.resolve('pnl').bold).toBeUndefined();
    expect(f.redo()).toBe(true);
    expect(f.resolve('pnl').bold).toBe(true);
  });
});

describe('rules', () => {
  it('matches expression conditions and returns style', () => {
    const r = new RulesEngine();
    r.setRules([{
      id: 'loss',
      expression: '[pnl] < 0',
      style: { color: 'red', backgroundColor: '#fee' },
    }]);
    expect(r.match({ pnl: -1 })?.id).toBe('loss');
    expect(r.match({ pnl: 1 })).toBeUndefined();
    expect(r.styleFor({ pnl: -5 }, 'pnl')?.color).toBe('red');
  });
});

describe('calc', () => {
  it('evaluates calc columns and rejects calc-on-calc', () => {
    const c = new CalcEngine();
    c.setColumns([
      { alias: 'total', expression: '[pnl] + [dailyPnl]' },
      { alias: 'bad', expression: '[total] * 2' },
    ]);
    expect(c.evaluate({ pnl: 10, dailyPnl: 2 })).toEqual({ total: 12 });
    expect(c.getErrors().some((e) => e.alias === 'bad')).toBe(true);
    expect(c.toPerspectiveExpressions().total).toContain('"pnl"');
  });
});

describe('edit', () => {
  it('multiply / nudge / undo / redo', () => {
    const e = new EditEngine();
    let rows: Array<Record<string, unknown>> = [{ id: '1', pnl: 10 }];
    rows = e.apply(rows, (r) => String(r.id), 'pnl', ['1'], { type: 'multiply', factor: 2 });
    expect(rows[0]!.pnl).toBe(20);
    rows = e.nudge(rows, (r) => String(r.id), 'pnl', ['1'], 1, 5);
    expect(rows[0]!.pnl).toBe(25);
    rows = e.undo(rows, (r) => String(r.id));
    expect(rows[0]!.pnl).toBe(20);
    rows = e.redo(rows, (r) => String(r.id));
    expect(rows[0]!.pnl).toBe(25);
  });

  it('shortcuts bind and resolve', () => {
    const e = new EditEngine();
    e.bindShortcut('m', { type: 'multiply', factor: 1.01 });
    expect(e.getShortcut('M')?.type).toBe('multiply');
  });
});

describe('alerts', () => {
  it('fires only when condition matches and respects kill switch', () => {
    const a = new AlertsEngine({ maxPerSecond: 100 });
    a.setRules([{
      id: 'loss',
      expression: '[pnl] < 0',
      channels: ['badge', 'toast'],
      messageTemplate: 'Loss on {rowId}: {value}',
      column: 'pnl',
    }]);
    expect(a.evaluateRow({ pnl: 5 }, 'R1')).toHaveLength(0);
    const fired = a.evaluateRow({ pnl: -3 }, 'R2');
    expect(fired).toHaveLength(1);
    expect(fired[0]!.message).toContain('R2');
    expect(a.unreadCount()).toBe(1);
    a.setKillSwitch(true);
    expect(a.evaluateRow({ pnl: -9 }, 'R3')).toHaveLength(0);
  });

  it('token bucket rate-limits', () => {
    let t = 0;
    const bucket = new TokenBucket({ capacityPerSecond: 2, now: () => t });
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    t += 1000;
    expect(bucket.tryTake()).toBe(true);
  });

  it('renderMessage substitutes placeholders safely', () => {
    expect(renderMessage('{rule}:{value}', {
      rule: 'x', rowId: '1', column: 'pnl', value: 3, prev: 1,
    })).toBe('x:3');
  });
});

describe('EnginesHost facade', () => {
  it('wires format + rules + calc + alerts', () => {
    const h = new EnginesHost();
    h.applyFormat({ colIds: ['pnl'], format: '0.00' });
    h.setStyleRules([{ id: '1', expression: '[pnl] < 0', style: { color: 'red' } }]);
    h.setCalcColumns([{ alias: 'net', expression: '[pnl] + 1' }]);
    h.setAlertRules([{ id: 'a', expression: '[pnl] < 0', channels: ['badge'] }]);
    expect(h.formatValue('pnl', 1.234)).toMatch(/1\.23/);
    expect(h.cellStyle({ pnl: -1 }, 'pnl')?.color).toBe('red');
    expect(h.enrichRow({ pnl: 4 }).net).toBe(5);
    expect(h.evaluateAlerts({ pnl: -1 }, 'x')).toHaveLength(1);
  });
});
