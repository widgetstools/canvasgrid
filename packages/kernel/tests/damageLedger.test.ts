import { describe, it, expect } from 'vitest';
import {
  DamageLedger, DAMAGE_BLEED_PX, screenYToContentY, dataRectToScreen,
  type DamageResolveCtx,
} from '../src/core/damageLedger';

// scrollTop === bodyTop (40) so `screenYToContentY` is a numeric no-op —
// every pre-existing assertion below (written against screen-space `y`
// values) keeps working unmodified after the `rects` → `dataRects` rename.
// Tests exercising the actual content transform / chrome-data split use an
// explicit `scrollTop` override (see below).
const ctx = (over: Partial<DamageResolveCtx> = {}): DamageResolveCtx => ({
  canvasWidth: 1000, canvasHeight: 600, dpr: 2,
  bodyTop: 40, bodyBottom: 580, bodyLeft: 0, bodyRight: 1000,
  scrollTop: 40, layerTop: 40, layerHeight: 540,
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
    expect(r.dataRects).toHaveLength(1);
    const rect = r.dataRects[0]!;
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
    const rect = r.dataRects[0]!;
    expect(rect.x).toBeLessThanOrEqual(198);           // 200 - bleed
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(282); // 280 + bleed
  });

  it('off-screen cells resolve to nothing (partial with zero rects)', () => {
    const l = new DamageLedger();
    l.add({ kind: 'cells', cells: [{ rowId: 999, colId: 'px' }] });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.dataRects).toHaveLength(0);
  });

  it('overlapping rects merge', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [3, 4] }); // adjacent bands + bleed overlap
    expect(l.takeResolved(ctx()).dataRects).toHaveLength(1);
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
    const rect = r.dataRects[0]!;
    expect(rect.y).toBeLessThanOrEqual(40);                 // extends up to bodyTop
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(88 + 8); // band bottom + shadow bleed
  });

  it('pinned/totals band: intersecting rect extends to the whole band', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 500, y: 555, w: 10, h: 10 });
    const r = l.takeResolved(ctx({ pinnedBandRects: [{ x: 0, y: 556, w: 1000, h: 24 }] }));
    const rect = r.dataRects[0]!;
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(1000);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(580);
  });

  it('DPR snapping lands on device-pixel boundaries', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 10.3, y: 41.7, w: 20.2, h: 9.1 });
    const rect = l.takeResolved(ctx()).dataRects[0]!;
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
    expect(r.dataRects.length).toBeGreaterThanOrEqual(1);
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

  // ─── Task 2 — two-domain damage resolution ────────────────────────────

  describe('screenYToContentY / dataRectToScreen', () => {
    it('is a lossless round trip for any scrollTop/bodyTop pair', () => {
      const t = { scrollTop: 1234, bodyTop: 40 };
      const y = 88;
      const contentY = screenYToContentY(y, t);
      expect(contentY).toBe(y - t.bodyTop + t.scrollTop);
      expect(dataRectToScreen({ x: 0, y: contentY, w: 100, h: 24 }, t)).toEqual({ x: 0, y, w: 100, h: 24 });
    });

    it('is a numeric no-op when scrollTop === bodyTop', () => {
      const t = { scrollTop: 40, bodyTop: 40 };
      expect(screenYToContentY(86, t)).toBe(86);
    });
  });

  it('band/rect damage straddling bodyTop splits: above-body → chromeRects (screen space), in-body → dataRects (content space)', () => {
    const l = new DamageLedger();
    // Spans y:[20,60) — 20 above bodyTop (40), 20 inside the body.
    l.add({ kind: 'rect', x: 0, y: 20, w: 1000, h: 40 });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    // Chrome piece: bled/snapped top stays above bodyTop, screen-space.
    expect(r.chromeRects.length).toBeGreaterThanOrEqual(1);
    for (const cr of r.chromeRects) {
      expect(cr.y + cr.h).toBeLessThanOrEqual(40);
    }
    // Data piece: starts exactly at bodyTop, content-space (scrollTop ===
    // bodyTop in the default fixture, so numerically unchanged).
    expect(r.dataRects.length).toBeGreaterThanOrEqual(1);
    const dataPiece = r.dataRects.find((d) => d.y === 40)!;
    expect(dataPiece).toBeDefined();
    expect(dataPiece.y + dataPiece.h).toBeGreaterThanOrEqual(60);
  });

  it('band/rect damage entirely above bodyTop resolves to chromeRects only, no dataRects', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 0, y: 0, w: 1000, h: 10 }); // bled to ~[-2,12], well above bodyTop=40
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.chromeRects.length).toBeGreaterThanOrEqual(1);
    expect(r.dataRects).toHaveLength(0);
  });

  it('content transform correctness with a non-identity scrollTop (rows always resolve to dataRects, never body-clipped)', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [2] }); // band [88, 112] pre-bleed
    const nonIdentityCtx = ctx({ scrollTop: 1000, layerTop: 1000 });
    const r = l.takeResolved(nonIdentityCtx);
    expect(r.full).toBe(false);
    expect(r.chromeRects).toHaveLength(0); // rows never split — always data
    const rect = r.dataRects[0]!;
    // Same bled/snapped bounds as the scrollTop===bodyTop case (86..114),
    // shifted by the transform: contentY = screenY - bodyTop + scrollTop.
    expect(rect.y).toBe(screenYToContentY(86, nonIdentityCtx));
    expect(rect.y + rect.h).toBe(screenYToContentY(114, nonIdentityCtx));
    // Round trip back to screen space reproduces the original bounds.
    const backToScreen = dataRectToScreen(rect, nonIdentityCtx);
    expect(backToScreen.y).toBe(86);
    expect(backToScreen.y + backToScreen.h).toBe(114);
  });

  it('per-domain cap: data cap uses the LAYER area, not the full canvas area', () => {
    const l = new DamageLedger();
    // Entirely inside the body [40,580]; area (post-bleed) ~64,000 —
    // ~11% of the full canvas (600,000) but ~128% of a 50px-tall layer
    // (50,000), so ONLY the layer-scoped cap should trip.
    l.add({ kind: 'rect', x: 0, y: 100, w: 1000, h: 60 });
    const rNormalLayer = l.takeResolved(ctx({ layerHeight: 540 }));
    expect(rNormalLayer.full).toBe(false);

    const l2 = new DamageLedger();
    l2.add({ kind: 'rect', x: 0, y: 100, w: 1000, h: 60 });
    const rSmallLayer = l2.takeResolved(ctx({ layerHeight: 50 }));
    expect(rSmallLayer.full).toBe(true);
  });

  it('per-domain cap: chrome cap trips independently of a compliant data domain', () => {
    const l = new DamageLedger();
    // 14 disjoint rects entirely above bodyTop (40) — chrome-only.
    for (let i = 0; i < 14; i++) l.add({ kind: 'rect', x: i * 70, y: 0, w: 10, h: 8 });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(true);
  });

  // ─── Task 4 — paintCacheLayerActive gates the scroll-exposed-band push ───

  describe('paintCacheLayerActive', () => {
    it('defaults to today\'s behavior (falsy): a pure scroll still pushes an exposed data band', () => {
      const l = new DamageLedger();
      l.add({ kind: 'scroll', dy: 48 });
      const r = l.takeResolved(ctx());
      expect(r.full).toBe(false);
      expect(r.blit).toEqual({ dy: 48 });
      expect(r.dataRects.length).toBeGreaterThanOrEqual(1);
    });

    it('when active, a pure scroll resolves to EMPTY dataRects/chromeRects (present-only) — the layer\'s own planLayer supersedes the exposed-band push', () => {
      const l = new DamageLedger();
      l.add({ kind: 'scroll', dy: 48 });
      const r = l.takeResolved(ctx({ paintCacheLayerActive: true }));
      expect(r.full).toBe(false);
      // `blit` stays populated (informational/back-compat) — only the
      // exposed-band PUSH into `dataRects` is suppressed.
      expect(r.blit).toEqual({ dy: 48 });
      expect(r.dataRects).toHaveLength(0);
      expect(r.chromeRects).toHaveLength(0);
    });

    it('when active, sticky-band + pinned/totals chrome redamage on scroll is UNCHANGED — those bands are screen-anchored chrome the layer never covers', () => {
      const l1 = new DamageLedger();
      l1.add({ kind: 'scroll', dy: 48 });
      const withSticky = ctx({ stickyBandBottom: 100 });
      const inactive = l1.takeResolved(withSticky);

      const l2 = new DamageLedger();
      l2.add({ kind: 'scroll', dy: 48 });
      const active = l2.takeResolved({ ...withSticky, paintCacheLayerActive: true });

      // Both resolve the sticky band into SOME rect (chrome or data,
      // depending on where the band geometrically falls) — the point is
      // this contribution is NOT gated by `paintCacheLayerActive`, unlike
      // the exposed-band push above.
      const totalRects = (r: ReturnType<DamageLedger['takeResolved']>) => r.chromeRects.length + r.dataRects.length;
      expect(totalRects(active)).toBeGreaterThan(0);
      // Inactive keeps the exposed band ON TOP of the sticky contribution,
      // so it can only have as many or more rects than the active case.
      expect(totalRects(inactive)).toBeGreaterThanOrEqual(totalRects(active));
    });

    it('a non-scroll partial (rows/cells) is completely unaffected by the flag', () => {
      const l1 = new DamageLedger();
      l1.add({ kind: 'rows', rowIndices: [2] });
      const inactive = l1.takeResolved(ctx());

      const l2 = new DamageLedger();
      l2.add({ kind: 'rows', rowIndices: [2] });
      const active = l2.takeResolved(ctx({ paintCacheLayerActive: true }));

      expect(active).toEqual(inactive);
    });
  });
});
