import { describe, it, expect, vi, beforeAll } from 'vitest';
import { paintStickyGroups } from '../src/renderer/painters/stickyGroups';
import type { CachedContext2D } from '../src/renderer/gc';
import type { PainterCtx } from '../src/renderer/painters/types';

// happy-dom lacks Path2D; the chevron's drawIcon constructs one. Stub it.
beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
});

// Recording gc — mirrors the fakeGc used by byRows.test.ts. Every draw op is
// a vi.fn() so the test can assert on the clip/rect call sequence.
function fakeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), createLinearGradient: () => ({ addColorStop: vi.fn() }),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(t, k) { return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx as CachedContext2D;
}

// Minimal PainterCtx exercising ONLY what paintStickyGroups reads. One narrow
// (60px) value column carrying a group aggregate far wider than the column.
function makeCtx(): PainterCtx {
  return {
    viewport: {
      bodyTop: 40, bodyLeft: 0, bodyRight: 300, bodyBottom: 400,
      visibleColumns: [
        { colId: 'ag-Grid-AutoColumn', index: 0, left: 0, right: 150, width: 150 },
        { colId: 'notional', index: 1, left: 150, right: 210, width: 60 },
      ],
      visibleRows: [],
    } as any,
    theme: {
      rowHeight: 30, fg: '#fff', font: '13px Inter', cellFont: '13px JetBrains Mono',
      bg: '#000', groupRowBg: '#111', gridLineColor: 'rgba(255,255,255,0.1)',
      groupChevronColor: '#999', groupCountColor: '#777',
    } as any,
    groupHideOpenParents: false,
    stickyAncestors: [
      { depth: 0, key: 'EMEA', colId: 'region', value: 'EMEA', childCount: 1632, isExpanded: true },
    ],
    getStickyGroupTotals: (key: string, colId: string) =>
      key === 'EMEA' && colId === 'notional'
        ? { value: 0, valueFormatted: '25,041,234,254,565,720,702' }
        : null,
  } as unknown as PainterCtx;
}

describe('paintStickyGroups — per-column aggregate clip', () => {
  it('clips each aggregate value to its column bounds so a wide group sum cannot overflow into the neighbour', () => {
    const gc = fakeGc();
    paintStickyGroups(gc, makeCtx());

    // The fix must establish a clip rect covering exactly the narrow value
    // column (left 150, width 60) at the sticky row band before painting its
    // aggregate — the same per-cell clip the body painter applies. Pre-fix the
    // ONLY rect is the whole-band clip (0, 40, 300, …), so this fails.
    expect(gc.rect).toHaveBeenCalledWith(150, expect.any(Number), 60, 30);
    // The aggregate value is still painted (right-aligned inside the column).
    expect(gc.fillText).toHaveBeenCalledWith('25,041,234,254,565,720,702', 210 - 6, expect.any(Number));
  });
});
