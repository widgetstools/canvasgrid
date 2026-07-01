import { describe, it, expect, vi } from 'vitest';
import { FlashRegistry } from '../src/core/flashRegistry';
import { buildFlashAlphaMask } from '../src/core/flashAlphaMask';

/**
 * Cycle 25 / Task 7 — GPU-friendly alpha mask.
 *
 * The painter currently calls `registry.getAlpha(rowId, colId, now)`
 * for every visible cell every frame; even with the empty-registry
 * fast path, an active flash forces a Map lookup AND a `${rowId}
 * ${colId}` string allocation per cell. `buildFlashAlphaMask` builds
 * the mask once per paint as a `Float32Array(rows × cols)` indexed
 * by `r * cols + c`. The painter reads alphas by index — zero per-
 * cell allocation, and the mask itself is a candidate for upload to
 * a future GPU compositor.
 */

function makeRegistry(enabled = true) {
  return new FlashRegistry({
    getEnabled: () => enabled,
    getFlashDuration: () => 200,
    getFadeDuration: () => 600,
    getReducedMotion: () => false,
    requestRepaint: vi.fn(),
  });
}

describe('buildFlashAlphaMask', () => {
  it('returns an all-zero mask when no cells are flashing', () => {
    const reg = makeRegistry();
    const mask = buildFlashAlphaMask({
      registry: reg,
      rowIds: new Uint32Array([1, 2, 3]),
      colIds: ['a', 'b'],
      now: 0,
    });
    expect(mask.length).toBe(6);
    for (let i = 0; i < mask.length; i++) expect(mask[i]).toBe(0);
  });

  it('writes 1.0 for cells inside the flash window', () => {
    const reg = makeRegistry();
    reg.flash(2, 'b', 0);
    const mask = buildFlashAlphaMask({
      registry: reg,
      rowIds: new Uint32Array([1, 2, 3]),
      colIds: ['a', 'b'],
      now: 100, // within 200ms flash window
    });
    // row 2 ('index 1') × col 'b' (index 1) → r*2 + 1 = 3
    expect(mask[3]).toBe(1);
    // Every other cell is 0
    for (let i = 0; i < mask.length; i++) {
      if (i === 3) continue;
      expect(mask[i]).toBe(0);
    }
  });

  it('linearly fades alpha across the fade window', () => {
    const reg = makeRegistry();
    reg.flash(1, 'a', 0);
    // After 200ms flash + 300ms of 600ms fade → alpha ≈ 0.5
    const mask = buildFlashAlphaMask({
      registry: reg,
      rowIds: new Uint32Array([1]),
      colIds: ['a'],
      now: 500,
    });
    expect(mask[0]).toBeGreaterThan(0.4);
    expect(mask[0]).toBeLessThan(0.6);
  });

  it('returns the existing mask buffer when reused (no fresh allocation per frame)', () => {
    const reg = makeRegistry();
    const reused = new Float32Array(6);
    const mask1 = buildFlashAlphaMask({
      registry: reg,
      rowIds: new Uint32Array([1, 2, 3]),
      colIds: ['a', 'b'],
      now: 0,
      out: reused,
    });
    expect(mask1).toBe(reused);
    const mask2 = buildFlashAlphaMask({
      registry: reg,
      rowIds: new Uint32Array([1, 2, 3]),
      colIds: ['a', 'b'],
      now: 1000,
      out: reused,
    });
    expect(mask2).toBe(reused);
  });

  it('returns a length-0 mask for empty input', () => {
    const reg = makeRegistry();
    const mask = buildFlashAlphaMask({
      registry: reg,
      rowIds: new Uint32Array([]),
      colIds: [],
      now: 0,
    });
    expect(mask.length).toBe(0);
  });
});
