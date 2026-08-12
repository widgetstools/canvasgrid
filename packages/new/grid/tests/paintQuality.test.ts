import { describe, it, expect } from 'vitest';
import {
  applyPaintQualityDefaults,
  isSoftwareCanvasRaster,
} from '../src/core/paintQuality';

describe('applyPaintQualityDefaults', () => {
  it('performance mode forces paintCache off and overscan 0', () => {
    const opts: { qualityMode?: 'performance'; paintCache?: boolean; paintCacheOverscan?: number } = {
      qualityMode: 'performance',
    };
    const r = applyPaintQualityDefaults(opts, () => false);
    expect(r.reason).toBe('performance');
    expect(opts.paintCache).toBe(false);
    expect(opts.paintCacheOverscan).toBe(0);
  });

  it('explicit paintCache: true wins over performance mode', () => {
    const opts = { qualityMode: 'performance' as const, paintCache: true };
    const r = applyPaintQualityDefaults(opts, () => true);
    expect(r.reason).toBe('explicit-on');
    expect(opts.paintCache).toBe(true);
  });

  it('explicit paintCache: false wins over quality mode', () => {
    const opts = { qualityMode: 'quality' as const, paintCache: false };
    const r = applyPaintQualityDefaults(opts, () => false);
    expect(r.reason).toBe('explicit-off');
    expect(opts.paintCache).toBe(false);
  });

  it('auto + software detector disables paintCache', () => {
    const opts: { paintCache?: boolean; paintCacheOverscan?: number } = {};
    const r = applyPaintQualityDefaults(opts, () => true);
    expect(r.reason).toBe('software-auto');
    expect(opts.paintCache).toBe(false);
    expect(opts.paintCacheOverscan).toBe(0);
  });

  it('auto + hardware keeps default (paintCache unset)', () => {
    const opts: { paintCache?: boolean } = {};
    const r = applyPaintQualityDefaults(opts, () => false);
    expect(r.reason).toBe('default-on');
    expect(opts.paintCache).toBeUndefined();
  });

  it('quality mode ignores software detector', () => {
    const opts: { qualityMode?: 'quality'; paintCache?: boolean } = { qualityMode: 'quality' };
    const r = applyPaintQualityDefaults(opts, () => true);
    expect(r.reason).toBe('default-on');
    expect(opts.paintCache).toBeUndefined();
  });
});

describe('isSoftwareCanvasRaster', () => {
  it('returns false when getContext yields no GL (jsdom)', () => {
    expect(isSoftwareCanvasRaster()).toBe(false);
  });
});
