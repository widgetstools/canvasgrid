import { describe, it, expect, vi } from 'vitest';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { PaintCacheCanvasFactory } from '../src/core/paintCache';
import {
  RasterBudget,
  cellStyleSignature,
  cellCacheBypass,
  CellBitmapCache,
  RowStripCache,
} from '../src/renderer/rasterCache';

// ---------------------------------------------------------------------------
// Fake canvas factory (paintCache.test.ts fixture style) — no DOM. Tracks
// allocation count so the pooling contract (evict → reuse, bounded growth)
// is directly observable.
// ---------------------------------------------------------------------------

interface FakeCtx {
  canvas: FakeCanvas;
  log: string[];
  setTransform: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(type: '2d', attrs?: unknown): FakeCtx;
  __ctx: FakeCtx;
}

function makeFakeFactory(): {
  factory: PaintCacheCanvasFactory;
  allocs: () => number;
  canvases: FakeCanvas[];
} {
  let allocations = 0;
  const canvases: FakeCanvas[] = [];
  const factory = (): FakeCanvas => {
    allocations++;
    const log: string[] = [];
    const canvas = { width: 0, height: 0 } as FakeCanvas;
    const ctx: FakeCtx = {
      canvas,
      log,
      setTransform: vi.fn((...a: number[]) => { log.push(`setTransform(${a.join(',')})`); }),
      clearRect: vi.fn((...a: number[]) => { log.push(`clearRect(${a.join(',')})`); }),
      drawImage: vi.fn(() => { log.push('drawImage'); }),
      save: vi.fn(() => { log.push('save'); }),
      restore: vi.fn(() => { log.push('restore'); }),
      beginPath: vi.fn(() => { log.push('beginPath'); }),
      rect: vi.fn((...a: number[]) => { log.push(`rect(${a.join(',')})`); }),
      clip: vi.fn(() => { log.push('clip'); }),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
    };
    canvas.__ctx = ctx;
    canvas.getContext = () => ctx;
    canvases.push(canvas);
    return canvas;
  };
  return {
    factory: factory as unknown as PaintCacheCanvasFactory,
    allocs: () => allocations,
    canvases,
  };
}

function makeConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 42,
    valueFormatted: '42.00',
    bounds: { x: 100, y: 200, w: 100, h: 24 },
    font: '12px Inter',
    fg: '#111111',
    bg: '#ffffff',
    borderColor: '#e0e0e0',
    halign: 'left',
    prefillColor: '#ffffff',
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RasterBudget
// ---------------------------------------------------------------------------

describe('RasterBudget', () => {
  it('accepts charges within budget and accumulates spent()', () => {
    const b = new RasterBudget(1000);
    const evict = vi.fn(() => 0);
    expect(b.charge(400, evict)).toBe(true);
    expect(b.charge(600, evict)).toBe(true);
    expect(b.spent()).toBe(1000);
    expect(evict).not.toHaveBeenCalled();
  });

  it('calls evict until the charge fits, crediting freed bytes', () => {
    const b = new RasterBudget(1000);
    expect(b.charge(1000, () => 0)).toBe(true);
    const evict = vi.fn(() => 300); // frees 300 per call
    expect(b.charge(500, evict)).toBe(true);
    // needed to free >= 500 → two evict calls (300 + 300)
    expect(evict).toHaveBeenCalledTimes(2);
    expect(b.spent()).toBe(1000 - 600 + 500);
  });

  it('returns false without evicting when a single charge exceeds maxBytes outright', () => {
    const b = new RasterBudget(100);
    const evict = vi.fn(() => 50);
    expect(b.charge(101, evict)).toBe(false);
    expect(evict).not.toHaveBeenCalled();
    expect(b.spent()).toBe(0);
  });

  it('returns false (spent unchanged) when evict runs dry before the charge fits', () => {
    const b = new RasterBudget(100);
    expect(b.charge(90, () => 0)).toBe(true);
    let left = 1;
    const evict = vi.fn(() => (left-- > 0 ? 10 : 0)); // frees 10 once, then dry
    expect(b.charge(30, evict)).toBe(false);
    expect(b.spent()).toBe(80); // the 10 genuinely freed stays credited
  });
});

// ---------------------------------------------------------------------------
// cellStyleSignature
// ---------------------------------------------------------------------------

describe('cellStyleSignature', () => {
  it('is deterministic for identical input', () => {
    expect(cellStyleSignature('text', makeConfig())).toBe(cellStyleSignature('text', makeConfig()));
  });

  it('is stable across bounds.x / bounds.y changes (position-independent)', () => {
    const a = cellStyleSignature('text', makeConfig({ bounds: { x: 0, y: 0, w: 100, h: 24 } }));
    const b = cellStyleSignature('text', makeConfig({ bounds: { x: 555, y: 1234, w: 100, h: 24 } }));
    expect(a).toBe(b);
  });

  it('is stable across fields OUTSIDE the covered set (flashFromColor, textTransform)', () => {
    const a = cellStyleSignature('text', makeConfig());
    const b = cellStyleSignature('text', makeConfig({ flashFromColor: '#fe0', textTransform: 'uppercase' }));
    expect(a).toBe(b);
  });

  it('changes when rendererName changes', () => {
    expect(cellStyleSignature('text', makeConfig())).not.toBe(cellStyleSignature('number', makeConfig()));
  });

  // Every covered field: mutating it alone must change the signature.
  const mutations: Array<[string, Partial<CellPaintConfig>]> = [
    ['valueFormatted', { valueFormatted: '43.00' }],
    ['value (String())', { value: 43 }],
    ['font', { font: '13px Inter' }],
    ['fg', { fg: '#222222' }],
    ['bg', { bg: '#fafafa' }],
    ['borderColor', { borderColor: '#d0d0d0' }],
    ['halign', { halign: 'right' }],
    ['valign', { valign: 'top' }],
    ['letterSpacing', { letterSpacing: 2 }],
    ['lineHeight', { lineHeight: 1.5 }],
    ['padding', { padding: { left: 12 } }],
    ['border', { border: { all: { width: 1, color: '#f00' } } }],
    ['textDecoration', { textDecoration: 'underline' }],
    ['ruleIndicator', { ruleIndicator: { iconName: 'alert', color: '#f00', target: 'cell', position: 'right' } }],
    ['prefillColor', { prefillColor: '#eeeeee' }],
    ['isFocused', { isFocused: true }],
    ['isSelected', { isSelected: true }],
    ['isHovered', { isHovered: true }],
    ['isHeader', { isHeader: true }],
    ['sortDirection', { sortDirection: 'asc' }],
    ['sortIndex', { sortIndex: 2 }],
    ['sortTotal', { sortTotal: 3 }],
    ['unSortIcon', { unSortIcon: true }],
    ['unSortIconColor', { unSortIconColor: '#888888' }],
    ['iconColor', { iconColor: '#999999' }],
    ['wrapHeader', { wrapHeader: true }],
    ['headerCheckboxState', { headerCheckboxState: 'all' }],
    ['bounds.w', { bounds: { x: 100, y: 200, w: 120, h: 24 } }],
    ['bounds.h', { bounds: { x: 100, y: 200, w: 100, h: 32 } }],
  ];
  for (const [name, patch] of mutations) {
    it(`changes when ${name} changes`, () => {
      const base = cellStyleSignature('text', makeConfig());
      const mutated = cellStyleSignature('text', makeConfig(patch));
      expect(mutated).not.toBe(base);
    });
  }

  it('distinguishes value vs valueFormatted swaps (no field-collision via concatenation)', () => {
    const a = cellStyleSignature('text', makeConfig({ value: 'ab', valueFormatted: 'c' }));
    const b = cellStyleSignature('text', makeConfig({ value: 'a', valueFormatted: 'bc' }));
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// cellCacheBypass
// ---------------------------------------------------------------------------

describe('cellCacheBypass', () => {
  it('does not bypass a plain cacheable cell', () => {
    expect(cellCacheBypass('text', makeConfig(), true)).toBe(false);
  });
  it('bypasses when cacheable=false (custom renderer not opted in / pending icon)', () => {
    expect(cellCacheBypass('custom', makeConfig(), false)).toBe(true);
  });
  it('bypasses when flashAlpha is set (even 0)', () => {
    expect(cellCacheBypass('text', makeConfig({ flashAlpha: 0 }), true)).toBe(true);
    expect(cellCacheBypass('text', makeConfig({ flashAlpha: 0.5 }), true)).toBe(true);
  });
  it('bypasses when a content slot is set', () => {
    expect(cellCacheBypass('text', makeConfig({ content: { kind: 'text', value: 'x' } }), true)).toBe(true);
  });
  it('bypasses when decorators are non-empty, but NOT for an empty decorators array', () => {
    expect(cellCacheBypass('text', makeConfig({ decorators: [] }), true)).toBe(false);
    expect(
      cellCacheBypass('text', makeConfig({ decorators: [{ kind: 'dot', color: '#f00', position: 'tr' } as never] }), true),
    ).toBe(true);
  });
  it('bypasses when params is set (any value, including null)', () => {
    expect(cellCacheBypass('text', makeConfig({ params: { a: 1 } }), true)).toBe(true);
    expect(cellCacheBypass('text', makeConfig({ params: null }), true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CellBitmapCache
// ---------------------------------------------------------------------------

describe('CellBitmapCache', () => {
  it('degrades to available=false with safe no-ops for a null factory (never throws)', () => {
    const budget = new RasterBudget(1000);
    const cache = new CellBitmapCache(budget, null as unknown as PaintCacheCanvasFactory);
    expect(cache.available).toBe(false);
    expect(cache.get('k')).toBeNull();
    expect(cache.render('k', 10, 10, 1, () => {})).toBeNull();
    expect(() => cache.epochBump()).not.toThrow();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(() => cache.dispose()).not.toThrow();
    expect(budget.spent()).toBe(0);
  });

  it('degrades to available=false when the factory throws during construction probing', () => {
    const budget = new RasterBudget(1000);
    const cache = new CellBitmapCache(budget, (() => { throw new Error('no canvas'); }) as unknown as PaintCacheCanvasFactory);
    expect(cache.available).toBe(false);
    expect(cache.render('k', 10, 10, 1, () => {})).toBeNull();
  });

  it('render → get returns the same canvas and charges the budget wDev*hDev*4', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    expect(cache.available).toBe(true);
    const paint = vi.fn();
    const canvas = cache.render('k1', 10, 8, 2, paint);
    expect(canvas).not.toBeNull();
    expect(paint).toHaveBeenCalledTimes(1);
    expect(cache.get('k1')).toBe(canvas);
    // 20×16 device px × 4 bytes
    expect(cache.stats()).toEqual({ entries: 1, bytes: 20 * 16 * 4 });
    expect(budget.spent()).toBe(20 * 16 * 4);
  });

  it('applies the scratch dpr discipline: backing store round(css*dpr), setTransform(dpr,0,0,dpr,0,0), cleared before paint', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    let sawDims: [number, number] | null = null;
    let sawLogTail: string[] = [];
    const canvas = cache.render('k1', 10.4, 8.2, 2, (gc) => {
      const c = (gc as unknown as FakeCtx).canvas;
      sawDims = [c.width, c.height];
      sawLogTail = [...(gc as unknown as FakeCtx).log];
    });
    expect(canvas).not.toBeNull();
    expect(sawDims).toEqual([Math.round(10.4 * 2), Math.round(8.2 * 2)]);
    // Cleared on the identity transform, then the dpr CTM installed — in order.
    const log = sawLogTail;
    const clearIdx = log.findIndex((l) => l.startsWith('clearRect'));
    const dprIdx = log.lastIndexOf('setTransform(2,0,0,2,0,0)');
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(dprIdx).toBeGreaterThan(clearIdx);
  });

  it('render on an existing key returns the cached bitmap WITHOUT repainting or double-charging', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    const paint1 = vi.fn();
    const c1 = cache.render('k1', 10, 8, 1, paint1);
    const paint2 = vi.fn();
    const c2 = cache.render('k1', 10, 8, 1, paint2);
    expect(c2).toBe(c1);
    expect(paint2).not.toHaveBeenCalled();
    expect(cache.stats()).toEqual({ entries: 1, bytes: 10 * 8 * 4 });
  });

  it('epochBump makes every prior key a miss and returns the bytes to the budget', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    cache.render('k1', 10, 8, 1, () => {});
    cache.render('k2', 10, 8, 1, () => {});
    expect(budget.spent()).toBe(2 * 10 * 8 * 4);
    cache.epochBump();
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')).toBeNull();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(budget.spent()).toBe(0);
  });

  it('returns null (never throws) for a single entry too large for the whole budget', () => {
    const budget = new RasterBudget(100);
    const { factory } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    // 10×10×4 = 400 > 100
    expect(cache.render('big', 10, 10, 1, () => {})).toBeNull();
    expect(budget.spent()).toBe(0);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('evicts the least-recently-touched entry when the budget fills (get() LRU-touches)', () => {
    // 3 entries of 100 bytes each fit exactly.
    const budget = new RasterBudget(300);
    const { factory } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    cache.render('a', 5, 5, 1, () => {}); // 100 bytes
    cache.render('b', 5, 5, 1, () => {});
    cache.render('c', 5, 5, 1, () => {});
    expect(cache.get('a')).not.toBeNull(); // touch a → LRU order: b, c, a
    cache.render('d', 5, 5, 1, () => {});
    expect(cache.get('b')).toBeNull(); // b was oldest-touched
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.get('d')).not.toBeNull();
    expect(budget.spent()).toBe(300);
  });

  it('pools evicted canvases: a same-dims render after eviction reuses the canvas object (no new allocation)', () => {
    const budget = new RasterBudget(100); // exactly one 5×5 entry
    const { factory, allocs } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    const allocsAfterConstruction = allocs();
    const c1 = cache.render('k1', 5, 5, 1, () => {});
    const c2 = cache.render('k2', 5, 5, 1, () => {}); // evicts k1 → its canvas pooled
    expect(cache.get('k1')).toBeNull();
    expect(c2).toBe(c1); // the very canvas object k1 owned, recycled
    // No allocation beyond what construction + the first render needed.
    expect(allocs() - allocsAfterConstruction).toBeLessThanOrEqual(1);
  });

  it('pool growth is bounded: repeated render/epochBump cycles at varying sizes stay at O(1) allocations', () => {
    const budget = new RasterBudget(1_000_000);
    const { factory, allocs } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    for (let i = 1; i <= 20; i++) {
      cache.render(`k${i}`, i + 4, 6, 1, () => {});
      cache.epochBump();
    }
    expect(allocs()).toBeLessThanOrEqual(2);
  });

  it('dispose releases everything (budget back to 0) and is idempotent', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const cache = new CellBitmapCache(budget, factory);
    cache.render('k1', 10, 8, 1, () => {});
    cache.dispose();
    expect(budget.spent()).toBe(0);
    expect(cache.get('k1')).toBeNull();
    expect(cache.render('k2', 10, 8, 1, () => {})).toBeNull();
    expect(() => cache.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RowStripCache
// ---------------------------------------------------------------------------

const SRC = {} as CanvasImageSource;

describe('RowStripCache', () => {
  it('degrades to available=false with safe no-ops for a null factory (never throws)', () => {
    const budget = new RasterBudget(1000);
    const strips = new RowStripCache(budget, null as unknown as PaintCacheCanvasFactory);
    expect(strips.available).toBe(false);
    expect(() => strips.capture({ rowId: 'r1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 10, 10)).not.toThrow();
    expect(strips.get('r1', 1, 0)).toBeNull();
    expect(strips.patch('r1', 2, 0, 10, () => {})).toBe(false);
    expect(() => strips.layoutEpochBump()).not.toThrow();
    expect(() => strips.invalidateRow('r1')).not.toThrow();
    expect(strips.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(() => strips.dispose()).not.toThrow();
    expect(budget.spent()).toBe(0);
  });

  it('capture copies the device-px source band on an identity transform, then get hits on the exact key', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    strips.capture({ rowId: 'r1', rowVersion: 3, layoutEpoch: 7 }, SRC, 48, 200, 24);
    const canvas = strips.get('r1', 3, 7) as FakeCanvas | null;
    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBe(200);
    expect(canvas!.height).toBe(24);
    const ctx = canvas!.__ctx;
    expect(ctx.drawImage).toHaveBeenCalledWith(SRC, 0, 48, 200, 24, 0, 0, 200, 24);
    // drawImage ran after an identity setTransform.
    const idIdx = ctx.log.lastIndexOf('setTransform(1,0,0,1,0,0)');
    const drawIdx = ctx.log.lastIndexOf('drawImage');
    expect(idIdx).toBeGreaterThanOrEqual(0);
    expect(drawIdx).toBeGreaterThan(idIdx);
    expect(budget.spent()).toBe(200 * 24 * 4);
  });

  it('misses on rowVersion or layoutEpoch mismatch', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    strips.capture({ rowId: 'r1', rowVersion: 3, layoutEpoch: 7 }, SRC, 0, 100, 24);
    expect(strips.get('r1', 4, 7)).toBeNull();
    expect(strips.get('r1', 3, 8)).toBeNull();
    expect(strips.get('r2', 3, 7)).toBeNull();
    expect(strips.get('r1', 3, 7)).not.toBeNull();
  });

  it('patch on a missing row returns false', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    expect(strips.patch('nope', 2, 0, 50, () => {})).toBe(false);
  });

  it('patch repaints one cell span (device-px clip+clear, dpr CTM translated to the span) and advances the version', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    strips.capture({ rowId: 'r1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 400, 48); // dpr 2 strip of a 200×24 css row
    const canvas = strips.get('r1', 1, 0) as FakeCanvas;
    const paint = vi.fn();
    expect(strips.patch('r1', 2, 30, 20, paint, 2)).toBe(true);
    expect(paint).toHaveBeenCalledTimes(1);
    // Old version misses, new version hits — the SAME canvas, patched in place.
    expect(strips.get('r1', 1, 0)).toBeNull();
    expect(strips.get('r1', 2, 0)).toBe(canvas);
    const log = canvas.__ctx.log;
    // Span cleared in device px: x0 = round(30*2) = 60, x1 = round(50*2) = 100 → w 40, full strip height.
    expect(log).toContain('clearRect(60,0,40,48)');
    // Painter CTM: dpr scale translated to the span start so paint draws the cell at (0,0,w,h).
    expect(log).toContain('setTransform(2,0,0,2,60,0)');
    // Clip + save/restore hygiene around the patch.
    expect(canvas.__ctx.clip).toHaveBeenCalled();
    expect(canvas.__ctx.save).toHaveBeenCalled();
    expect(canvas.__ctx.restore).toHaveBeenCalled();
  });

  it('layoutEpochBump drops everything', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    strips.capture({ rowId: 'r1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 100, 24);
    strips.capture({ rowId: 'r2', rowVersion: 1, layoutEpoch: 0 }, SRC, 24, 100, 24);
    strips.layoutEpochBump();
    expect(strips.get('r1', 1, 0)).toBeNull();
    expect(strips.get('r2', 1, 0)).toBeNull();
    expect(strips.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(budget.spent()).toBe(0);
  });

  it('invalidateRow drops just that row and credits the budget', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    strips.capture({ rowId: 'r1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 100, 24);
    strips.capture({ rowId: 'r2', rowVersion: 1, layoutEpoch: 0 }, SRC, 24, 100, 24);
    strips.invalidateRow('r1');
    expect(strips.get('r1', 1, 0)).toBeNull();
    expect(strips.patch('r1', 2, 0, 10, () => {})).toBe(false);
    expect(strips.get('r2', 1, 0)).not.toBeNull();
    expect(budget.spent()).toBe(100 * 24 * 4);
    expect(strips.stats()).toEqual({ entries: 1, bytes: 100 * 24 * 4 });
  });

  it('re-capturing a row replaces the old strip without leaking bytes', () => {
    const budget = new RasterBudget(100_000);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    strips.capture({ rowId: 'r1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 100, 24);
    strips.capture({ rowId: 'r1', rowVersion: 2, layoutEpoch: 0 }, SRC, 0, 100, 24);
    expect(strips.get('r1', 1, 0)).toBeNull();
    expect(strips.get('r1', 2, 0)).not.toBeNull();
    expect(strips.stats()).toEqual({ entries: 1, bytes: 100 * 24 * 4 });
    expect(budget.spent()).toBe(100 * 24 * 4);
  });

  it('capture is a no-op (null-ish) for a strip too large for the whole budget', () => {
    const budget = new RasterBudget(100);
    const { factory } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    expect(() => strips.capture({ rowId: 'r1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 100, 24)).not.toThrow();
    expect(strips.get('r1', 1, 0)).toBeNull();
    expect(budget.spent()).toBe(0);
  });

  it('pools evicted strips: same-dims capture after eviction reuses the canvas object', () => {
    const budget = new RasterBudget(100 * 24 * 4); // exactly one strip
    const { factory, allocs } = makeFakeFactory();
    const strips = new RowStripCache(budget, factory);
    const before = allocs();
    strips.capture({ rowId: 'r1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 100, 24);
    const c1 = strips.get('r1', 1, 0);
    strips.capture({ rowId: 'r2', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 100, 24); // evicts r1
    expect(strips.get('r1', 1, 0)).toBeNull();
    expect(strips.get('r2', 1, 0)).toBe(c1);
    expect(allocs() - before).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Shared budget across BOTH tiers — cross-tier LRU
// ---------------------------------------------------------------------------

describe('shared RasterBudget across CellBitmapCache + RowStripCache', () => {
  it('evicts the globally oldest-touched entry regardless of which tier owns it', () => {
    const budget = new RasterBudget(300);
    const cells = new CellBitmapCache(budget, makeFakeFactory().factory);
    const strips = new RowStripCache(budget, makeFakeFactory().factory);

    cells.render('a', 5, 5, 1, () => {});   // 100 bytes, oldest
    cells.render('b', 5, 5, 1, () => {});   // 100
    strips.capture({ rowId: 's1', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 25, 1); // 100 → budget full
    expect(budget.spent()).toBe(300);

    expect(cells.get('a')).not.toBeNull(); // touch a → global LRU order: b, s1, a

    // A strip capture must evict the CELL entry 'b' (cross-tier LRU).
    strips.capture({ rowId: 's2', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 25, 1);
    expect(cells.get('b')).toBeNull();
    expect(cells.get('a')).not.toBeNull();
    expect(strips.get('s1', 1, 0)).not.toBeNull();
    expect(strips.get('s2', 1, 0)).not.toBeNull();
    expect(budget.spent()).toBe(300);

    // The verification gets above LRU-touched a, s1, s2 in that order.
    // Touch 'a' once more so the STRIP 's1' is globally oldest…
    expect(cells.get('a')).not.toBeNull(); // order: s1, s2, a
    // …then a cell render must evict it (cell tier evicting strip tier).
    cells.render('c', 5, 5, 1, () => {});
    expect(strips.get('s1', 1, 0)).toBeNull();
    expect(strips.get('s2', 1, 0)).not.toBeNull();
    expect(cells.get('a')).not.toBeNull();
    expect(budget.spent()).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Purity — no Date, no direct DOM access outside the injected factory
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('full render/capture/evict flow works with document removed from globalThis', () => {
    const original = (globalThis as Record<string, unknown>)['document'];
    (globalThis as Record<string, unknown>)['document'] = undefined;
    try {
      const budget = new RasterBudget(300);
      const cells = new CellBitmapCache(budget, makeFakeFactory().factory);
      const strips = new RowStripCache(budget, makeFakeFactory().factory);
      cells.render('a', 5, 5, 1, () => {});
      strips.capture({ rowId: 'r', rowVersion: 1, layoutEpoch: 0 }, SRC, 0, 25, 1);
      cells.render('b', 5, 5, 1, () => {});
      cells.render('c', 5, 5, 1, () => {}); // forces an eviction
      expect(cellStyleSignature('text', makeConfig())).toBeTypeOf('string');
      expect(cellCacheBypass('text', makeConfig(), true)).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>)['document'] = original;
    }
  });
});
