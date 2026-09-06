import { describe, it, expect } from 'vitest';
import { makeRng, makeRows, tickRow } from '../src/data/domain';

describe('blotter domain', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRows(50, 7, 1_000);
    const b = makeRows(50, 7, 1_000);
    expect(a).toEqual(b);
    // A lab that reshuffles on reload cannot be screenshotted or asserted on,
    // so this is a property the demo depends on, not a nicety.
    expect(makeRows(50, 8, 1_000)[0]).not.toEqual(a[0]);
  });

  it('gives every row a stable unique id', () => {
    const rows = makeRows(500);
    expect(new Set(rows.map((r) => r.id)).size).toBe(500);
  });

  it('quotes a two-sided market: bid <= mid <= ask', () => {
    for (const row of makeRows(300)) {
      expect(row.bidPrice).toBeLessThanOrEqual(row.midPrice);
      expect(row.midPrice).toBeLessThanOrEqual(row.askPrice);
    }
  });

  it('prices worse credit at a wider spread', () => {
    const rows = makeRows(4_000);
    const avg = (rating: string[]) => {
      const hits = rows.filter((r) => rating.includes(r.compositeRating));
      return hits.reduce((sum, r) => sum + r.oas, 0) / hits.length;
    };
    // The generator bands OAS off the rating, so this ordering is the domain
    // invariant a fixed-income reader checks first.
    expect(avg(['AAA', 'AA+', 'AA'])).toBeLessThan(avg(['BBB+', 'BBB', 'BBB-']));
    expect(avg(['BBB+', 'BBB', 'BBB-'])).toBeLessThan(avg(['BB-', 'B+', 'B']));
  });

  it('prices from the yield, so no bond lands on a clamp', () => {
    const rows = makeRows(3_000, 12, 0);
    // The bug this locks: price and yield generated independently produced
    // short bonds with low coupons trading far above par, whose implied yield
    // was negative and came back as a wall of identical floor values.
    const ytms = rows.map((r) => r.yieldToMaturity);
    const atFloor = ytms.filter((y) => y <= 0.11).length;
    expect(atFloor).toBe(0);
    expect(Math.min(...ytms)).toBeGreaterThan(0.3);
    expect(Math.max(...ytms)).toBeLessThan(30);
    // Prices should cluster around par the way a real book does, because the
    // coupon was set near the yield at issue.
    const mids = rows.map((r) => r.midPrice);
    expect(mids.filter((p) => p > 70 && p < 130).length / mids.length).toBeGreaterThan(0.95);
    expect(Math.min(...mids)).toBeGreaterThan(20);
    expect(Math.max(...mids)).toBeLessThan(180);
  });

  it('yields wider for worse credit at a comparable tenor', () => {
    const rows = makeRows(4_000, 13, 0).filter((r) => r.modifiedDuration > 4 && r.modifiedDuration < 9);
    const avg = (rs: typeof rows) => rs.reduce((n, r) => n + r.yieldToMaturity, 0) / rs.length;
    const ig = rows.filter((r) => ['AAA', 'AA+', 'AA', 'AA-'].includes(r.compositeRating));
    const hy = rows.filter((r) => ['BB-', 'B+', 'B'].includes(r.compositeRating));
    expect(ig.length).toBeGreaterThan(20);
    expect(hy.length).toBeGreaterThan(20);
    expect(avg(hy)).toBeGreaterThan(avg(ig));
  });

  it('moves yield inversely to price on a tick', () => {
    const rng = makeRng(11);
    let checked = 0;
    for (const row of makeRows(200, 3)) {
      const after = tickRow(row, rng);
      // Yield is rounded to 3dp, so a small move on a long-duration bond can
      // leave it unchanged. The invariant is about DIRECTION when it does
      // move, not that every price tick must register in the yield.
      if (after.yieldToMaturity === row.yieldToMaturity) continue;
      checked++;
      expect(after.midPrice > row.midPrice).toBe(after.yieldToMaturity < row.yieldToMaturity);
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('returns a new object per tick rather than mutating in place', () => {
    const rng = makeRng(5);
    const row = makeRows(1)[0]!;
    const next = tickRow(row, rng);
    // The grid diffs by row identity; mutating in place would defeat both the
    // flash mask and the raster cache.
    expect(next).not.toBe(row);
    expect(row.lastUpdate).not.toBe(undefined);
  });

  it('keeps market value consistent with price and quantity after a tick', () => {
    const rng = makeRng(9);
    for (const row of makeRows(100, 4)) {
      const next = tickRow(row, rng);
      expect(next.marketValue).toBe(Math.round((next.quantityFace * next.midPrice) / 100));
    }
  });
});
