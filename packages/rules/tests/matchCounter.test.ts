import { describe, expect, it } from 'vitest';
import { MatchCounter } from '../src/matchCounter';

describe('MatchCounter', () => {
  it('starts at zero for unknown rules', () => {
    expect(new MatchCounter().count('nope')).toBe(0);
  });

  it('sums per-row contributions per rule', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 2);
    c.setRowMatches('r1', 'b', 1);
    c.setRowMatches('r2', 'a', 1);
    expect(c.count('r1')).toBe(3);
    expect(c.count('r2')).toBe(1);
  });

  it('re-setting a contribution adjusts the total exactly', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 2);
    c.setRowMatches('r1', 'a', 2); // no-op
    expect(c.count('r1')).toBe(2);
    c.setRowMatches('r1', 'a', 5);
    expect(c.count('r1')).toBe(5);
    c.setRowMatches('r1', 'a', 0);
    expect(c.count('r1')).toBe(0);
  });

  it('dropRow removes every rule contribution for that row (idempotent)', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 2);
    c.setRowMatches('r2', 'a', 1);
    c.setRowMatches('r1', 'b', 4);
    c.dropRow('a');
    expect(c.count('r1')).toBe(4);
    expect(c.count('r2')).toBe(0);
    c.dropRow('a'); // idempotent
    expect(c.count('r1')).toBe(4);
  });

  it('resetAll clears totals and contributions', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 3);
    c.resetAll();
    expect(c.count('r1')).toBe(0);
  });
});
