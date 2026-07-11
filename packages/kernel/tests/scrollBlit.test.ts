/**
 * Damage-region rendering (Task 5) — `decideScrollDamage` pure-function
 * unit tests. Spec §5.4: a vertical-only scroll smaller than the body
 * height, with no DPR/bounds change, resolves to `{kind:'scroll', dy}` so
 * the ledger can blit the still-valid body pixels; every other case bails
 * to `{kind:'full'}` — the blit is an optimization, never a correctness
 * dependency, so every ambiguous or out-of-bounds input degrades to full.
 */
import { describe, it, expect } from 'vitest';
import { decideScrollDamage } from '../src/core/damageLedger';

describe('decideScrollDamage', () => {
  it('pure vertical scroll within body height → scroll damage', () => {
    expect(decideScrollDamage({ dx: 0, dy: 48, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
      .toEqual({ kind: 'scroll', dy: 48 });
  });

  it('horizontal component → full', () => {
    expect(decideScrollDamage({ dx: 3, dy: 48, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
      .toEqual({ kind: 'full' });
  });

  it('|dy| >= bodyHeight → full', () => {
    expect(decideScrollDamage({ dx: 0, dy: 600, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
      .toEqual({ kind: 'full' });
  });

  it('dpr/bounds change → full', () => {
    expect(decideScrollDamage({ dx: 0, dy: 10, bodyHeight: 500, dprChanged: true, boundsChanged: false }))
      .toEqual({ kind: 'full' });
  });

  it('boundsChanged alone → full', () => {
    expect(decideScrollDamage({ dx: 0, dy: 10, bodyHeight: 500, dprChanged: false, boundsChanged: true }))
      .toEqual({ kind: 'full' });
  });

  it('negative dy (scroll up) within body height → scroll damage', () => {
    expect(decideScrollDamage({ dx: 0, dy: -48, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
      .toEqual({ kind: 'scroll', dy: -48 });
  });

  it('|dy| exactly equal to bodyHeight → full (boundary, not partial)', () => {
    expect(decideScrollDamage({ dx: 0, dy: -500, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
      .toEqual({ kind: 'full' });
  });

  it('zero delta → scroll damage with dy 0 (harmless no-op on the ledger)', () => {
    expect(decideScrollDamage({ dx: 0, dy: 0, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
      .toEqual({ kind: 'scroll', dy: 0 });
  });
});
