/**
 * Cycle 4 / Task 11 (cell-flash patch) — FlashRegistry.
 *
 * Per-cell flash tracker. Keyed by numeric rowId (what worker chunks
 * ship in `Uint32Array`) so the painter lookup is allocation-free.
 * Per-rAF `tick(now)` prunes expired entries; `getAlpha(rowId, colId,
 * now)` returns the per-cell alpha (1 during flashDuration, linear
 * fade to 0 over fadeDuration, 0 outside the window). Honors live
 * `enabled` and `reducedMotion` deps.
 */
import { describe, it, expect } from 'vitest';
import { FlashRegistry } from '../src/core/flashRegistry';

function buildDeps(overrides: Partial<{
  enabled: boolean;
  flashDuration: number;
  fadeDuration: number;
  reducedMotion: boolean;
  repaintCount: number;
}> = {}): {
  registry: FlashRegistry;
  state: { repaintCount: number };
  setEnabled: (b: boolean) => void;
  setReducedMotion: (b: boolean) => void;
} {
  const state = { repaintCount: 0 };
  let enabled = overrides.enabled ?? true;
  let reducedMotion = overrides.reducedMotion ?? false;
  const flashDuration = overrides.flashDuration ?? 100;
  const fadeDuration = overrides.fadeDuration ?? 200;
  const registry = new FlashRegistry({
    getEnabled: () => enabled,
    getFlashDuration: () => flashDuration,
    getFadeDuration: () => fadeDuration,
    getReducedMotion: () => reducedMotion,
    requestRepaint: () => { state.repaintCount++; },
  });
  return {
    registry,
    state,
    setEnabled: (b: boolean) => { enabled = b; },
    setReducedMotion: (b: boolean) => { reducedMotion = b; },
  };
}

describe('FlashRegistry', () => {
  it('flash + getAlpha at startedAt returns 1', () => {
    const { registry } = buildDeps();
    registry.flash(42, 'price', 1000);
    expect(registry.getAlpha(42, 'price', 1000)).toBe(1);
  });

  it('getAlpha returns 1 throughout the flashDuration window', () => {
    const { registry } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
    registry.flash(42, 'price', 1000);
    expect(registry.getAlpha(42, 'price', 1000)).toBe(1);
    expect(registry.getAlpha(42, 'price', 1050)).toBe(1);
    expect(registry.getAlpha(42, 'price', 1099)).toBe(1);
    // exactly at the flashDuration boundary → still 1 (closed interval on
    // the flash side; fade begins strictly after).
    expect(registry.getAlpha(42, 'price', 1100)).toBe(1);
  });

  it('getAlpha linearly fades 1 → 0 across the fade window', () => {
    const { registry } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
    registry.flash(42, 'price', 1000);
    // 100ms into the fade (of 200ms total) → alpha = 0.5
    expect(registry.getAlpha(42, 'price', 1200)).toBeCloseTo(0.5, 5);
    // 50ms into the fade → alpha = 0.75
    expect(registry.getAlpha(42, 'price', 1150)).toBeCloseTo(0.75, 5);
    // 150ms into the fade → alpha = 0.25
    expect(registry.getAlpha(42, 'price', 1250)).toBeCloseTo(0.25, 5);
  });

  it('getAlpha returns 0 past the fade window', () => {
    const { registry } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
    registry.flash(42, 'price', 1000);
    expect(registry.getAlpha(42, 'price', 1300)).toBe(0);
    expect(registry.getAlpha(42, 'price', 9999)).toBe(0);
  });

  it('tick past the fade window prunes the entry', () => {
    const { registry } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
    registry.flash(42, 'price', 1000);
    expect(registry.size()).toBe(1);
    registry.tick(1500); // well past 1000 + 100 + 200 = 1300
    expect(registry.size()).toBe(0);
  });

  it('tick during the active window keeps the entry + requests a repaint', () => {
    const { registry, state } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
    registry.flash(42, 'price', 1000);
    const repaintsBefore = state.repaintCount;
    registry.tick(1150);
    expect(registry.size()).toBe(1);
    expect(state.repaintCount).toBeGreaterThan(repaintsBefore);
  });

  it('tick with no active entries is a no-op + does NOT request a repaint', () => {
    const { registry, state } = buildDeps();
    const repaintsBefore = state.repaintCount;
    registry.tick(1000);
    registry.tick(2000);
    expect(state.repaintCount).toBe(repaintsBefore);
  });

  it('getEnabled() === false suppresses every flash()', () => {
    const { registry, setEnabled } = buildDeps({ enabled: false });
    registry.flash(42, 'price', 1000);
    expect(registry.size()).toBe(0);
    expect(registry.getAlpha(42, 'price', 1000)).toBe(0);
    // Flipping the flag back to true lets subsequent flashes register.
    setEnabled(true);
    registry.flash(42, 'price', 2000);
    expect(registry.size()).toBe(1);
  });

  it('getReducedMotion() === true suppresses every flash()', () => {
    const { registry, setReducedMotion } = buildDeps({ reducedMotion: true });
    registry.flash(42, 'price', 1000);
    expect(registry.size()).toBe(0);
    setReducedMotion(false);
    registry.flash(42, 'price', 2000);
    expect(registry.size()).toBe(1);
  });

  it('re-flashing the same cell restarts the timer', () => {
    const { registry } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
    registry.flash(42, 'price', 1000);
    // Halfway through the fade — alpha would be 0.5 if untouched.
    expect(registry.getAlpha(42, 'price', 1200)).toBeCloseTo(0.5, 5);
    // Re-flash at t=1200 — the timer resets to 1200.
    registry.flash(42, 'price', 1200);
    // Now at t=1200, we're at the start of a new flashDuration → 1.
    expect(registry.getAlpha(42, 'price', 1200)).toBe(1);
    // Only one entry exists for this cell (the re-flash replaces).
    expect(registry.size()).toBe(1);
  });

  it('ingestMask unpacks bits and fires flash() per set cell', () => {
    const { registry } = buildDeps();
    const rowIds = new Uint32Array([10, 20, 30]);
    const colIds = ['a', 'b', 'c'];
    // Bit layout (row-major, cols = 3):
    //   bit 0 = (row 10, col a)
    //   bit 1 = (row 10, col b)
    //   bit 2 = (row 10, col c)
    //   bit 3 = (row 20, col a)
    //   ...
    //   bit 8 = (row 30, col c)
    // Mask: flash (10,a), (20,b), (30,c) → bits 0, 4, 8 set.
    // bit 0 → byte 0 = 0b00000001
    // bit 4 → byte 0 = 0b00010000 → byte 0 = 0b00010001 = 0x11
    // bit 8 → byte 1 = 0b00000001 = 0x01
    const mask = new Uint8Array([0x11, 0x01]);
    registry.ingestMask({ rowIds, colIds, mask, now: 5000 });
    expect(registry.size()).toBe(3);
    expect(registry.getAlpha(10, 'a', 5000)).toBe(1);
    expect(registry.getAlpha(20, 'b', 5000)).toBe(1);
    expect(registry.getAlpha(30, 'c', 5000)).toBe(1);
    // Cells whose bits were NOT set stay at 0.
    expect(registry.getAlpha(10, 'b', 5000)).toBe(0);
    expect(registry.getAlpha(20, 'a', 5000)).toBe(0);
    expect(registry.getAlpha(30, 'a', 5000)).toBe(0);
  });

  it('flashMany flashes every (rowId, colId) pair', () => {
    const { registry } = buildDeps();
    registry.flashMany([10, 20], ['a', 'b'], 3000);
    expect(registry.size()).toBe(4);
    expect(registry.getAlpha(10, 'a', 3000)).toBe(1);
    expect(registry.getAlpha(10, 'b', 3000)).toBe(1);
    expect(registry.getAlpha(20, 'a', 3000)).toBe(1);
    expect(registry.getAlpha(20, 'b', 3000)).toBe(1);
  });

  it('destroy() clears entries + makes flash() a no-op', () => {
    const { registry } = buildDeps();
    registry.flash(42, 'price', 1000);
    registry.destroy();
    expect(registry.size()).toBe(0);
    registry.flash(43, 'price', 1100);
    expect(registry.size()).toBe(0);
  });

  // ── Cycle 21e / Task 13 — per-call overrides ──────────────────────────
  describe('per-call overrides', () => {
    it('flash(..., override) captures per-call flashDuration/fadeDuration — tick prunes at the per-call window, not the global one', () => {
      const { registry } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
      // Global window would prune at 1000 + 100 + 200 = 1300. Override
      // window is much longer: 1000 + 5000 + 5000 = 11000.
      registry.flash(42, 'price', 1000, { flashDuration: 5000, fadeDuration: 5000 });
      registry.tick(1300);
      expect(registry.size()).toBe(1);
      expect(registry.getAlpha(42, 'price', 1300)).toBe(1);
      registry.tick(11500);
      expect(registry.size()).toBe(0);
    });

    it('getAlpha on an entry with mode "pulse" at startedAt + total*0.25 ≈ 1', () => {
      const { registry } = buildDeps();
      registry.flash(42, 'price', 1000, { flashDuration: 500, fadeDuration: 1000, mode: 'pulse' });
      // total = 1500; quarter point = 375.
      expect(registry.getAlpha(42, 'price', 1000 + 375)).toBeCloseTo(1, 10);
    });

    it('getAlpha on an entry with mode "glow" mid-window = 1', () => {
      const { registry } = buildDeps();
      registry.flash(42, 'price', 1000, { flashDuration: 500, fadeDuration: 1000, mode: 'glow' });
      // total = 1500; midpoint = 750, within the 60% plateau (900).
      expect(registry.getAlpha(42, 'price', 1000 + 750)).toBe(1);
    });

    it('getColor returns the override color for the flashed cell and undefined otherwise', () => {
      const { registry } = buildDeps();
      registry.flash(42, 'price', 1000, { color: '#ff0000' });
      registry.flash(43, 'price', 1000); // no override
      expect(registry.getColor(42, 'price')).toBe('#ff0000');
      expect(registry.getColor(43, 'price')).toBeUndefined();
      expect(registry.getColor(99, 'price')).toBeUndefined(); // not flashing at all
    });

    it('ingestMask with stringRowIds + getOverride applies the override only to matching bits', () => {
      const { registry } = buildDeps({ flashDuration: 100, fadeDuration: 200 });
      const rowIds = new Uint32Array([10, 20]);
      const colIds = ['a', 'b'];
      // Bits: (10,a) and (20,b) set → bit 0 and bit 3.
      const mask = new Uint8Array([0b00001001]);
      const stringRowIds = ['r10', 'r20'];
      registry.ingestMask({
        rowIds, colIds, mask, now: 5000, stringRowIds,
        getOverride: (sid, colId) => {
          if (sid === 'r10' && colId === 'a') return { color: '#00ff00', mode: 'pulse' };
          return undefined;
        },
      });
      expect(registry.getColor(10, 'a')).toBe('#00ff00');
      expect(registry.getColor(20, 'b')).toBeUndefined();
    });

    it('ingestMask without getOverride behaves unchanged (default path regression)', () => {
      const { registry } = buildDeps();
      const rowIds = new Uint32Array([10, 20, 30]);
      const colIds = ['a', 'b', 'c'];
      const mask = new Uint8Array([0x11, 0x01]);
      registry.ingestMask({ rowIds, colIds, mask, now: 5000 });
      expect(registry.size()).toBe(3);
      expect(registry.getAlpha(10, 'a', 5000)).toBe(1);
      expect(registry.getColor(10, 'a')).toBeUndefined();
    });
  });
});
