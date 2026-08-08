import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  planLayer,
  PaintCacheLayer,
  type LayerGeometry,
  type PaintCacheCanvasFactory,
} from '../src/core/paintCache';

// ---------------------------------------------------------------------------
// planLayer — pure geometry
// ---------------------------------------------------------------------------

describe('planLayer', () => {
  it('resets on first paint (current === null)', () => {
    const plan = planLayer({
      current: null, scrollTop: 500, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    expect(plan.kind).toBe('reset');
    // idealTop = clamp(scrollTop - overscanPx, 0, contentHeight) = 400
    expect(plan).toEqual({ kind: 'reset', newTop: 400 });
  });

  it('keeps the layer while both margins stay >= 25% of overscan', () => {
    // overscanPx=100 -> threshold=25. Layer covers [0,400] (bodyHeight=200 -> layerHeight=400).
    const current: LayerGeometry = { layerTop: 0, layerHeight: 400 };
    // scrollTop=100 -> visible [100,300]; topMargin=100, bottomMargin=100 -> both >= 25.
    const plan = planLayer({
      current, scrollTop: 100, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    expect(plan).toEqual({ kind: 'keep' });
  });

  it('keeps exactly AT the 25%-of-overscan threshold (boundary is inclusive)', () => {
    const current: LayerGeometry = { layerTop: 0, layerHeight: 400 };
    // threshold = 25. Want topMargin === 25 exactly and bottomMargin comfortably above.
    // topMargin = scrollTop - covTop = scrollTop => scrollTop = 25.
    // bottomMargin = covBottom - visBottom = 400 - (25+200) = 175 >= 25.
    const plan = planLayer({
      current, scrollTop: 25, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    expect(plan).toEqual({ kind: 'keep' });
  });

  it('shifts down (re-centers) when the bottom margin erodes below threshold, rasterBands = newly covered band only', () => {
    const current: LayerGeometry = { layerTop: 0, layerHeight: 400 };
    // scrollTop=190 -> visible [190,390]; bottomMargin = 400-390=10 < 25 -> shift.
    const plan = planLayer({
      current, scrollTop: 190, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    // idealTop = clamp(190-100,0,10000) = 90. dy = 90-0 = 90.
    expect(plan.kind).toBe('shift');
    if (plan.kind !== 'shift') throw new Error('unreachable');
    expect(plan.dy).toBe(90);
    expect(plan.newTop).toBe(90);
    // Newly covered band = old coverage bottom (400) .. new bottom (90+400=490).
    expect(plan.rasterBands).toEqual([{ top: 400, bottom: 490 }]);

    // Re-centering property: after applying the shift, both margins equal overscanPx exactly.
    const newCovTop = plan.newTop;
    const newCovBottom = plan.newTop + 400;
    expect(190 - newCovTop).toBe(100);
    expect(newCovBottom - 390).toBe(100);
  });

  it('shifts up (re-centers) when the top margin erodes below threshold, rasterBands = newly covered band only', () => {
    const current: LayerGeometry = { layerTop: 200, layerHeight: 400 };
    // scrollTop=210 -> visible [210,410]; topMargin = 210-200=10 < 25 -> shift.
    const plan = planLayer({
      current, scrollTop: 210, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    // idealTop = clamp(210-100,0,10000) = 110. dy = 110-200 = -90.
    expect(plan.kind).toBe('shift');
    if (plan.kind !== 'shift') throw new Error('unreachable');
    expect(plan.dy).toBe(-90);
    expect(plan.newTop).toBe(110);
    // Newly covered band = new top (110) .. old coverage top (200).
    expect(plan.rasterBands).toEqual([{ top: 110, bottom: 200 }]);
  });

  it('resets on a scroll jump bigger than the layer coverage (no overlap left)', () => {
    const current: LayerGeometry = { layerTop: 0, layerHeight: 400 };
    const plan = planLayer({
      current, scrollTop: 5000, bodyHeight: 200, overscanPx: 100, contentHeight: 100000,
    });
    expect(plan).toEqual({ kind: 'reset', newTop: 4900 });
  });

  it('resets when the layer target height changed since the last plan (resize/option change)', () => {
    const current: LayerGeometry = { layerTop: 0, layerHeight: 400 };
    // Same scrollTop as the "keep" case, but overscanPx differs -> layerHeight differs -> reset.
    const plan = planLayer({
      current, scrollTop: 100, bodyHeight: 200, overscanPx: 50, contentHeight: 10000,
    });
    expect(plan.kind).toBe('reset');
  });

  it('clamps newTop to 0 when scrollTop - overscanPx would go negative', () => {
    const plan = planLayer({
      current: null, scrollTop: 10, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    expect(plan).toEqual({ kind: 'reset', newTop: 0 });
  });

  it('clamps newTop to contentHeight when scrollTop - overscanPx would exceed it', () => {
    const plan = planLayer({
      current: null, scrollTop: 10200, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    expect(plan).toEqual({ kind: 'reset', newTop: 10000 });
  });

  it('keeps (no-op) rather than shifting when already pinned at the top content edge', () => {
    // Layer already anchored at layerTop=0 (pinned). scrollTop small enough that
    // idealTop also clamps to 0 -> dy===0 -> keep, even though the margin is thin.
    const current: LayerGeometry = { layerTop: 0, layerHeight: 400 };
    const plan = planLayer({
      current, scrollTop: 10, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    expect(plan).toEqual({ kind: 'keep' });
  });

  it('shift near the content top edge never produces a negative-height band', () => {
    // Layer currently covers [50, 450]; scroll up toward the very top so the
    // ideal anchor clamps at 0 — band would be [0, 50], still positive.
    const current: LayerGeometry = { layerTop: 50, layerHeight: 400 };
    const plan = planLayer({
      current, scrollTop: 5, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
    });
    expect(plan.kind).toBe('shift');
    if (plan.kind !== 'shift') throw new Error('unreachable');
    for (const band of plan.rasterBands) {
      expect(band.bottom - band.top).toBeGreaterThan(0);
      expect(band.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('shift near the content bottom edge clamps the (already fully out-of-range) band to empty instead of negative', () => {
    // Old coverage [800,1200] already runs past the end of data (contentHeight
    // 1000) on its bottom side; scrolling further down erodes the bottom
    // margin and forces a shift whose "newly covered" band is entirely past
    // the end of data too — it must clamp to empty, never negative-height.
    const current: LayerGeometry = { layerTop: 800, layerHeight: 400 };
    const plan = planLayer({
      current, scrollTop: 985, bodyHeight: 200, overscanPx: 100, contentHeight: 1000,
    });
    expect(plan.kind).toBe('shift');
    if (plan.kind !== 'shift') throw new Error('unreachable');
    expect(plan.dy).toBe(85);
    expect(plan.rasterBands).toEqual([]);
    for (const band of plan.rasterBands) {
      expect(band.bottom - band.top).toBeGreaterThan(0);
    }
  });

  // ─── Closeout fix wave — I-1 regression lock ─────────────────────────
  // `planLayer` itself stays exact-arithmetic pure (no quantization — that
  // is deliberately the CALL SITE's job, velocityGrid.ts's paint closure); this
  // proves the call site's quantization formula (`qdy = round(dy*dpr)/dpr`
  // before `layer.shift(qdy)`) keeps the anchor device-pixel-aligned
  // across repeated fractional shifts, and that OMITTING it (passing
  // `planLayer`'s raw `dy` straight to `shift`) drifts — the exact bug
  // I-1 describes.
  describe('I-1 — device-grid quantization of the shift anchor at fractional dpr', () => {
    it('quantizing dy (round(dy*dpr)/dpr) before shift() keeps the anchor exactly device-pixel-aligned across 5 consecutive fractional shifts', () => {
      const dpr = 1.25;
      const { factory } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(400, 400, dpr);
      layer.reset(0);

      // Deliberately non-device-aligned CSS delta: 33.33 * 1.25 = 41.6625,
      // not an integer device px.
      const rawDy = 33.33;
      for (let i = 0; i < 5; i++) {
        const qdy = Math.round(rawDy * dpr) / dpr;
        layer.shift(qdy);
      }
      const layerTop = layer.geometry().layerTop;
      const devicePx = layerTop * dpr;
      expect(Math.abs(devicePx - Math.round(devicePx))).toBeLessThan(1e-9);
    });

    it('WITHOUT quantization, the same 5 fractional shifts drift the anchor off the device-pixel grid (the bug this fix closes)', () => {
      const dpr = 1.25;
      const { factory } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(400, 400, dpr);
      layer.reset(0);

      const rawDy = 33.33;
      for (let i = 0; i < 5; i++) {
        layer.shift(rawDy); // no quantization — the pre-fix call site
      }
      const layerTop = layer.geometry().layerTop;
      const devicePx = layerTop * dpr;
      expect(Math.abs(devicePx - Math.round(devicePx))).toBeGreaterThan(1e-6);
    });

    it('quantizing the reset anchor (round(newTop*dpr)/dpr) lands it exactly on the device-pixel grid even from a fractional idealTop', () => {
      const dpr = 1.25;
      const { factory } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(400, 400, dpr);

      // planLayer's own idealTop math (odd bodyHeight -> fractional
      // overscanPx -> fractional idealTop), unquantized.
      const plan = planLayer({
        current: null, scrollTop: 1000, bodyHeight: 201, overscanPx: 100.5, contentHeight: 100000,
      });
      expect(plan.kind).toBe('reset');
      if (plan.kind !== 'reset') throw new Error('unreachable');
      expect(plan.newTop % (1 / dpr)).not.toBe(0); // confirm it's genuinely fractional at this dpr

      const qTop = Math.round(plan.newTop * dpr) / dpr;
      layer.reset(qTop);
      const devicePx = layer.geometry().layerTop * dpr;
      expect(Math.abs(devicePx - Math.round(devicePx))).toBeLessThan(1e-9);
    });
  });

  it('is pure — produces the same result for the same input with no globals touched, even without a DOM', () => {
    const original = (globalThis as Record<string, unknown>)['document'];
    // Prove no DOM access happens by removing `document` entirely for the call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).document = undefined;
    try {
      const args = {
        current: { layerTop: 0, layerHeight: 400 } as LayerGeometry,
        scrollTop: 190, bodyHeight: 200, overscanPx: 100, contentHeight: 10000,
      };
      const a = planLayer(args);
      const b = planLayer(args);
      expect(a).toEqual(b);
    } finally {
      (globalThis as Record<string, unknown>)['document'] = original;
    }
  });
});

// ---------------------------------------------------------------------------
// PaintCacheLayer — offscreen lifecycle (canvas access behind an injected
// factory so this runs under happy-dom without a real canvas backend).
// ---------------------------------------------------------------------------

interface FakeCtx {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(): FakeCtx;
}

function makeFakeCanvasFactory(): { factory: PaintCacheCanvasFactory; canvas: FakeCanvas; ctx: FakeCtx } {
  const ctx: FakeCtx = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  };
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
  return { factory: (() => canvas) as unknown as PaintCacheCanvasFactory, canvas, ctx };
}

describe('PaintCacheLayer', () => {
  describe('construction / availability', () => {
    it('is available when the injected factory yields a working canvas', () => {
      const { factory } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      expect(layer.available).toBe(true);
    });

    it('is NOT available (and never throws) when the factory returns null', () => {
      const layer = new PaintCacheLayer(() => null);
      expect(layer.available).toBe(false);
      expect(() => layer.ensureSize(100, 100, 1)).not.toThrow();
      expect(() => layer.shift(10)).not.toThrow();
      expect(() => layer.reset(0)).not.toThrow();
      expect(() => layer.dispose()).not.toThrow();
    });

    it('is NOT available (and never throws) when the factory throws', () => {
      const layer = new PaintCacheLayer(() => {
        throw new Error('boom');
      });
      expect(layer.available).toBe(false);
    });

    it('is NOT available (and never throws) when getContext returns null', () => {
      const canvas = { width: 0, height: 0, getContext: () => null };
      const layer = new PaintCacheLayer(() => canvas as unknown as ReturnType<PaintCacheCanvasFactory>);
      expect(layer.available).toBe(false);
    });

    it('falls back through the default factory (OffscreenCanvas unsupported under happy-dom -> detached <canvas>) without throwing', () => {
      const restoreGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = (() => {
        const fakeCtx: unknown = {
          save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(),
          drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
          fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
          lineWidth: 1, globalAlpha: 1,
        };
        return () => fakeCtx;
      })() as unknown as typeof HTMLCanvasElement.prototype.getContext;
      try {
        const layer = new PaintCacheLayer();
        expect(layer.available).toBe(true);
      } finally {
        HTMLCanvasElement.prototype.getContext = restoreGetContext;
      }
    });
  });

  describe('ensureSize', () => {
    it('sizes the backing store to round(css*dpr) and installs the dpr transform', () => {
      const { factory, canvas, ctx } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(200, 100, 2);
      expect(canvas.width).toBe(400);
      expect(canvas.height).toBe(200);
      expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
      expect(ctx.setTransform).toHaveBeenCalledTimes(1);
      expect(layer.geometry().layerHeight).toBe(100);
    });

    it('reallocates only when size or dpr actually changes (no-op call does not touch the backing store again)', () => {
      const { factory, canvas, ctx } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(200, 100, 2);
      expect(ctx.setTransform).toHaveBeenCalledTimes(1);

      // Identical call again — must be a complete no-op on the backing store.
      layer.ensureSize(200, 100, 2);
      expect(ctx.setTransform).toHaveBeenCalledTimes(1);
      expect(canvas.width).toBe(400);
      expect(canvas.height).toBe(200);

      // dpr change -> reallocate.
      layer.ensureSize(200, 100, 1);
      expect(ctx.setTransform).toHaveBeenCalledTimes(2);
      expect(ctx.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
      expect(canvas.width).toBe(200);
      expect(canvas.height).toBe(100);

      // width change (css) -> reallocate.
      layer.ensureSize(300, 100, 1);
      expect(ctx.setTransform).toHaveBeenCalledTimes(3);
      expect(canvas.width).toBe(300);
    });
  });

  describe('shift — CTM discipline (device-px src/dest on an untransformed copy path)', () => {
    it('scrolling down: saves, resets to identity transform, blits device-px rects shifted up, clears the exposed bottom band, restores', () => {
      const { factory, canvas, ctx } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(100, 50, 2); // backing store: 200x100 device px, dpr=2
      ctx.setTransform.mockClear();

      layer.shift(10); // content/css px; devDy = 10*2 = 20

      expect(ctx.save).toHaveBeenCalledTimes(1);
      // The blit's OWN setTransform(1,0,0,1,0,0) call, distinct from ensureSize's dpr transform.
      expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
      expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 20, 200, 80, 0, 0, 200, 80);
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 80, 200, 20);
      expect(ctx.restore).toHaveBeenCalledTimes(1);

      // Anchor advances by dy so geometry stays consistent with the pixels.
      expect(layer.geometry().layerTop).toBe(10);
    });

    it('scrolling up: blits device-px rects shifted down, clears the exposed top band', () => {
      const { factory, canvas, ctx } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(100, 50, 2); // 200x100 device px

      layer.shift(-10); // devDy = -20

      expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 200, 80, 0, 20, 200, 80);
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 20);
      expect(layer.geometry().layerTop).toBe(-10);
    });

    it('is a no-op on the canvas when dy is 0, but still safe to call', () => {
      const { factory, ctx } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(100, 50, 1);
      ctx.drawImage.mockClear();
      ctx.save.mockClear();
      layer.shift(0);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.save).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('re-anchors and clears the full backing store on an untransformed path', () => {
      const { factory, canvas, ctx } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(100, 50, 2);
      ctx.save.mockClear(); ctx.restore.mockClear(); ctx.setTransform.mockClear(); ctx.clearRect.mockClear();

      layer.reset(250);

      expect(layer.geometry().layerTop).toBe(250);
      expect(ctx.save).toHaveBeenCalledTimes(1);
      expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
      expect(ctx.restore).toHaveBeenCalledTimes(1);
    });
  });

  describe('coordinate mapping', () => {
    it('contentToLayerY maps content-space y to layer-local y via the current anchor', () => {
      const { factory } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.reset(500);
      expect(layer.contentToLayerY(520)).toBe(20);
      expect(layer.contentToLayerY(480)).toBe(-20);
    });

    it('visibleSrcRect returns the device-px source rect for the present blit', () => {
      const { factory } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.reset(400);
      const rect = layer.visibleSrcRect(450, 200, 2);
      expect(rect).toEqual({ sy: 100, sh: 400 });
    });
  });

  // ─── Closeout directive B — pending-band ledger ────────────────────────

  describe('pending-band ledger', () => {
    it('addPending merges overlapping/touching bands', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(100, 200);
      layer.addPending(200, 300); // touching -> merges
      layer.addPending(50, 100);  // touching the merged run's new top -> merges too
      expect(layer.pendingBands()).toEqual([{ top: 50, bottom: 300 }]);
    });

    it('addPending keeps disjoint bands separate, sorted by top', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(500, 600);
      layer.addPending(100, 200);
      expect(layer.pendingBands()).toEqual([{ top: 100, bottom: 200 }, { top: 500, bottom: 600 }]);
    });

    it('addPending is a no-op for a non-positive-height span', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(100, 100);
      layer.addPending(200, 150);
      expect(layer.hasPendingBands()).toBe(false);
    });

    it('pendingBacklogPx sums band heights', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 50);
      layer.addPending(100, 130);
      expect(layer.pendingBacklogPx()).toBe(80);
    });

    it('takePendingIntersecting removes only the overlapping portion, splitting a partially-overlapping band', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 1000);
      const taken = layer.takePendingIntersecting(400, 600);
      expect(taken).toEqual([{ top: 400, bottom: 600 }]);
      expect(layer.pendingBands()).toEqual([{ top: 0, bottom: 400 }, { top: 600, bottom: 1000 }]);
    });

    it('takePendingIntersecting returns [] and leaves the ledger untouched when nothing overlaps', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 100);
      const taken = layer.takePendingIntersecting(200, 300);
      expect(taken).toEqual([]);
      expect(layer.pendingBands()).toEqual([{ top: 0, bottom: 100 }]);
    });

    it('takeAllPending drains everything unconditionally', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 50);
      layer.addPending(100, 150);
      const all = layer.takeAllPending();
      expect(all).toEqual([{ top: 0, bottom: 50 }, { top: 100, bottom: 150 }]);
      expect(layer.hasPendingBands()).toBe(false);
    });

    it('takePendingNearest returns null when nothing is pending', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      expect(layer.takePendingNearest(500, 100)).toBeNull();
    });

    it('takePendingNearest takes a whole band when it fits within maxPx', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(100, 150);
      const chunk = layer.takePendingNearest(0, 100);
      expect(chunk).toEqual({ top: 100, bottom: 150 });
      expect(layer.hasPendingBands()).toBe(false);
    });

    it('takePendingNearest picks the band CLOSEST to the anchor across multiple bands', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 50);     // far from anchor 1000
      layer.addPending(950, 990);  // closest to anchor 1000
      const chunk = layer.takePendingNearest(1000, 1000);
      expect(chunk).toEqual({ top: 950, bottom: 990 });
      expect(layer.pendingBands()).toEqual([{ top: 0, bottom: 50 }]);
    });

    it('takePendingNearest carves a maxPx-tall sub-chunk nearest the anchor from an oversized band, leaving the remainder pending', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 1000);
      // anchor below the band -> carve from the BOTTOM end (nearest anchor).
      const chunk = layer.takePendingNearest(2000, 100);
      expect(chunk).toEqual({ top: 900, bottom: 1000 });
      expect(layer.pendingBands()).toEqual([{ top: 0, bottom: 900 }]);
    });

    it('takePendingNearest carves from the TOP end when the anchor sits above the band', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(1000, 2000);
      const chunk = layer.takePendingNearest(0, 100);
      expect(chunk).toEqual({ top: 1000, bottom: 1100 });
      expect(layer.pendingBands()).toEqual([{ top: 1100, bottom: 2000 }]);
    });

    it('takePendingNearest carves a chunk straddling the anchor when the anchor sits INSIDE an oversized band, leaving both remainders pending', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 1000);
      const chunk = layer.takePendingNearest(500, 100);
      if (!chunk) throw new Error('unreachable');
      expect(chunk.bottom - chunk.top).toBe(100);
      expect(chunk.top).toBeGreaterThanOrEqual(0);
      expect(chunk.bottom).toBeLessThanOrEqual(1000);
      expect(chunk.top).toBeLessThanOrEqual(500);
      expect(chunk.bottom).toBeGreaterThanOrEqual(500);
      const remaining = layer.pendingBands();
      const remainingArea = remaining.reduce((a, b) => a + (b.bottom - b.top), 0);
      expect(remainingArea).toBe(900);
    });

    it('reset() clears every pending band', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 100);
      layer.reset(500);
      expect(layer.hasPendingBands()).toBe(false);
    });

    it('dispose() clears every pending band', () => {
      const layer = new PaintCacheLayer(makeFakeCanvasFactory().factory);
      layer.addPending(0, 100);
      layer.dispose();
      expect(layer.hasPendingBands()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('frees the backing store and is safe to call twice', () => {
      const { factory, canvas } = makeFakeCanvasFactory();
      const layer = new PaintCacheLayer(factory);
      layer.ensureSize(100, 50, 1);
      layer.dispose();
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
      expect(() => layer.dispose()).not.toThrow();
    });
  });
});
