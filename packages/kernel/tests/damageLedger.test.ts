import { describe, it, expect } from 'vitest';
import { DamageLedger, DAMAGE_BLEED_PX, type DamageResolveCtx } from '../src/core/damageLedger';

const ctx = (over: Partial<DamageResolveCtx> = {}): DamageResolveCtx => ({
  canvasWidth: 1000, canvasHeight: 600, dpr: 2,
  bodyTop: 40, bodyBottom: 580, bodyLeft: 0, bodyRight: 1000,
  stickyBandBottom: null,
  pinnedBandRects: [],
  rowBand: (i) => (i >= 0 && i < 20 ? { top: 40 + i * 24, bottom: 40 + (i + 1) * 24 } : null),
  rowIndexForRowId: (id) => (id >= 100 && id < 120 ? id - 100 : null),
  colBounds: (colId) => (colId === 'px' ? { x: 200, w: 80 } : null),
  ...over,
});

describe('DamageLedger', () => {
  it('empty ledger resolves to FULL (legacy requestRepaint safety)', () => {
    const l = new DamageLedger();
    expect(l.takeResolved(ctx()).full).toBe(true);
  });

  it('full damage wins over everything and drains', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [1] });
    l.add({ kind: 'full' });
    expect(l.takeResolved(ctx()).full).toBe(true);
    // drained: next take (with nothing added) is full again by the empty rule
    expect(l.hasAny()).toBe(false);
  });

  it('rows resolve to full-width bled bands', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [2] });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.rects).toHaveLength(1);
    const rect = r.rects[0]!;
    // row 2 band = [88, 112]; +2 bleed; full body width; snapped OUT to 0.5px (dpr 2)
    expect(rect.y).toBeLessThanOrEqual(86);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(114);
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(1000);
  });

  it('cells resolve via rowId → local index → band ∩ column bounds', () => {
    const l = new DamageLedger();
    l.add({ kind: 'cells', cells: [{ rowId: 103, colId: 'px' }] });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    const rect = r.rects[0]!;
    expect(rect.x).toBeLessThanOrEqual(198);           // 200 - bleed
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(282); // 280 + bleed
  });

  it('off-screen cells resolve to nothing (partial with zero rects)', () => {
    const l = new DamageLedger();
    l.add({ kind: 'cells', cells: [{ rowId: 999, colId: 'px' }] });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.rects).toHaveLength(0);
  });

  it('overlapping rects merge', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [3, 4] }); // adjacent bands + bleed overlap
    expect(l.takeResolved(ctx()).rects).toHaveLength(1);
  });

  it('caps: >12 disjoint rects collapse to full', () => {
    const l = new DamageLedger();
    // 14 disjoint single-cell rects via rect damage
    for (let i = 0; i < 14; i++) l.add({ kind: 'rect', x: i * 70, y: 40 + (i % 5) * 90, w: 10, h: 10 });
    expect(l.takeResolved(ctx()).full).toBe(true);
  });

  it('caps: union area >60% collapses to full', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 0, y: 0, w: 1000, h: 400 }); // 66%
    expect(l.takeResolved(ctx()).full).toBe(true);
  });

  it('sticky band: rect intersecting the band extends to band + shadow', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 100, y: 50, w: 10, h: 10 });
    const r = l.takeResolved(ctx({ stickyBandBottom: 88 }));
    const rect = r.rects[0]!;
    expect(rect.y).toBeLessThanOrEqual(40);                 // extends up to bodyTop
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(88 + 8); // band bottom + shadow bleed
  });

  it('pinned/totals band: intersecting rect extends to the whole band', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 500, y: 555, w: 10, h: 10 });
    const r = l.takeResolved(ctx({ pinnedBandRects: [{ x: 0, y: 556, w: 1000, h: 24 }] }));
    const rect = r.rects[0]!;
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(1000);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(580);
  });

  it('DPR snapping lands on device-pixel boundaries', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 10.3, y: 41.7, w: 20.2, h: 9.1 });
    const rect = l.takeResolved(ctx()).rects[0]!;
    expect((rect.x * 2) % 1).toBe(0);
    expect((rect.y * 2) % 1).toBe(0);
    expect(((rect.x + rect.w) * 2) % 1).toBe(0);
    expect(((rect.y + rect.h) * 2) % 1).toBe(0);
  });

  it('scroll damage alone resolves to a blit', () => {
    const l = new DamageLedger();
    l.add({ kind: 'scroll', dy: 48 });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.blit).toEqual({ dy: 48 });
    // exposed band at the bottom, bled
    expect(r.rects.length).toBeGreaterThanOrEqual(1);
  });

  it('scroll + full collapses to full, no blit', () => {
    const l = new DamageLedger();
    l.add({ kind: 'scroll', dy: 48 });
    l.add({ kind: 'full' });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(true);
    expect(r.blit).toBeNull();
  });

  it('consecutive scrolls accumulate dy', () => {
    const l = new DamageLedger();
    l.add({ kind: 'scroll', dy: 20 });
    l.add({ kind: 'scroll', dy: 30 });
    expect(l.takeResolved(ctx()).blit).toEqual({ dy: 50 });
  });
});
