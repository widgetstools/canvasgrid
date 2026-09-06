/**
 * Behaviour of the "Tick arrows" profile, driven through the real rule engine.
 *
 * The shape of the rules is checked in `seeds.test.ts`; what matters here is
 * what a trader actually sees: an arrow appears on the cell that moved,
 * pointing the way it moved, and it is gone 800ms later. The last part is the
 * easiest to get wrong and the hardest to see — a rule with no active window
 * latches on and never clears, which looks fine for a second and wrong for the
 * rest of the session.
 *
 * Driven with an injected clock rather than timers: the assertion is about
 * 800ms of grid time, and a test that waits 800ms of wall time to find out is
 * both slower and flakier.
 */
import { describe, it, expect } from 'vitest';
import { RuleEngine } from '@wellsfargo-starui/velocity-grid/rules';
import type { RowChangeSet } from '@wellsfargo-starui/velocity-grid/rules';
import { TICK_ARROW_MS, TICK_ARROW_RULES } from '../src/lab/seeds';

/** A rule engine whose clock this test owns. */
function engineAt(start = 0) {
  let now = start;
  const engine = new RuleEngine({ now: () => now });
  engine.setRules(TICK_ARROW_RULES);
  return { engine, advance: (ms: number) => { now += ms; }, at: () => now };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'POS-1', midPrice: 100, bidPrice: 99.9, askPrice: 100.1, dailyPnL: 10,
  ...over,
});

/** One tick: report the change, then close the tick as the bridge does. */
function tick(engine: RuleEngine, next: Record<string, unknown>, cells: Array<{ colId: string; oldValue: unknown }>) {
  const changes: RowChangeSet = {
    added: [],
    removed: [],
    updated: [{
      rowId: 'POS-1',
      row: next,
      cells: cells.map((c) => ({
        rowId: 'POS-1', colId: c.colId, oldValue: c.oldValue, newValue: next[c.colId],
      })),
    }],
  };
  engine.applyChanges(changes);
  engine.endTick();
}

const indicatorOn = (engine: RuleEngine, data: Record<string, unknown>, colId: string) =>
  engine.evaluateCell({ row: data, rowId: 'POS-1', colId, theme: 'dark' }).indicator;

describe('tick arrows', () => {
  it('raises a green up arrow on the cell that rose', () => {
    const { engine } = engineAt();
    const next = row({ midPrice: 101 });
    tick(engine, next, [{ colId: 'midPrice', oldValue: 100 }]);

    const ind = indicatorOn(engine, next, 'midPrice');
    expect(ind).not.toBeNull();
    expect(ind!.iconName).toBe('arrow-up');
    expect(ind!.color).toBe('#0aa063');
  });

  it('raises a red down arrow on the cell that fell', () => {
    const { engine } = engineAt();
    const next = row({ midPrice: 99 });
    tick(engine, next, [{ colId: 'midPrice', oldValue: 100 }]);

    const ind = indicatorOn(engine, next, 'midPrice');
    expect(ind).not.toBeNull();
    expect(ind!.iconName).toBe('arrow-down');
    expect(ind!.color).toBe('#e63946');
  });

  it('marks only the cell that moved, not its neighbours', () => {
    const { engine } = engineAt();
    const next = row({ midPrice: 101 });
    tick(engine, next, [{ colId: 'midPrice', oldValue: 100 }]);

    expect(indicatorOn(engine, next, 'midPrice')).not.toBeNull();
    // bid and ask did not change on this tick; an arrow on them would be a lie.
    expect(indicatorOn(engine, next, 'bidPrice')).toBeNull();
    expect(indicatorOn(engine, next, 'askPrice')).toBeNull();
  });

  it('shows the arrow for 800ms, then drops it', () => {
    const { engine, advance } = engineAt();
    const next = row({ midPrice: 101 });
    tick(engine, next, [{ colId: 'midPrice', oldValue: 100 }]);

    expect(indicatorOn(engine, next, 'midPrice')).not.toBeNull();

    advance(TICK_ARROW_MS - 100);
    engine.endTick();
    expect(indicatorOn(engine, next, 'midPrice')).not.toBeNull();

    advance(200); // now past 800ms since activation
    engine.endTick();
    expect(indicatorOn(engine, next, 'midPrice')).toBeNull();
  });

  it('a second move re-arms the window rather than leaving a stale arrow', () => {
    const { engine, advance } = engineAt();
    let next = row({ midPrice: 101 });
    tick(engine, next, [{ colId: 'midPrice', oldValue: 100 }]);

    advance(600);
    engine.endTick();
    // Falls this time — the arrow must flip, not keep pointing up.
    next = row({ midPrice: 100.2 });
    tick(engine, next, [{ colId: 'midPrice', oldValue: 101 }]);
    expect(indicatorOn(engine, next, 'midPrice')!.iconName).toBe('arrow-down');

    // And the clock restarted: 600ms after the FIRST move is not an expiry.
    advance(300);
    engine.endTick();
    expect(indicatorOn(engine, next, 'midPrice')).not.toBeNull();

    advance(600);
    engine.endTick();
    expect(indicatorOn(engine, next, 'midPrice')).toBeNull();
  });

  it('leaves an untouched row alone entirely', () => {
    const { engine } = engineAt();
    const other = { ...row(), id: 'POS-2' };
    const next = row({ midPrice: 101 });
    tick(engine, next, [{ colId: 'midPrice', oldValue: 100 }]);

    expect(
      engine.evaluateCell({ row: other, rowId: 'POS-2', colId: 'midPrice', theme: 'dark' }).indicator,
    ).toBeNull();
  });

  it('covers each ticking column independently', () => {
    const { engine } = engineAt();
    const next = row({ dailyPnL: 25 });
    tick(engine, next, [{ colId: 'dailyPnL', oldValue: 10 }]);

    expect(indicatorOn(engine, next, 'dailyPnL')!.iconName).toBe('arrow-up');
    expect(indicatorOn(engine, next, 'midPrice')).toBeNull();
  });
});
