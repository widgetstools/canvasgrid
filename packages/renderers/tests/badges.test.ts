// @cgrid/renderers — badges category tests (Cycle 21f / Task 8).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import {
  DEFAULT_VENUE_PALETTE, RATING_SCALE_BANDS, SEMANTIC_COLORS, STATUS_PILL_MAP,
} from '../src/palette';
import { withAlpha } from '../src/paintUtils';
import {
  statusPill, ratingBadge, ratingClusterCell, tagCell, venueChip, sideChip, tifPill,
} from '../src/badges';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 'WORKING',
    valueFormatted: 'WORKING',
    bounds: { x: 0, y: 0, w: 140, h: 24 },
    font: '13px Inter, sans-serif',
    fg: '#111111',
    bg: '#ffffff',
    borderColor: '#ccc',
    halign: 'left',
    prefillColor: '#ffffff',
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader: false,
    ...overrides,
  };
}

function pillFills(calls: FakeGc['calls']): string[] {
  return calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.args[0]));
}

describe('statusPill', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints WORKING cyan pill (nominal)', () => {
    statusPill.paint(gc, baseConfig({ params: { status: 'WORKING' } }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'WORKING')).toBe(true);
    expect(pillFills(gc.calls).some((c) => c.includes('3b82f6') || c.startsWith('rgba(59, 130, 246'))).toBe(true);
  });

  it('paints REJECTED red-on-white (variant)', () => {
    statusPill.paint(gc, baseConfig({ params: { status: 'REJECTED' } }));
    expect(gc.calls.some((c) => c.op === 'set:strokeStyle' && c.args[0] === STATUS_PILL_MAP.REJECTED!.border)).toBe(true);
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'REJECTED')).toBe(true);
  });

  it('PENDING uses dashed border stroke (edge)', () => {
    statusPill.paint(gc, baseConfig({ params: { status: 'PENDING' } }));
    expect(gc.calls.some((c) => c.op === 'setLineDash' && Array.isArray(c.args[0]))).toBe(true);
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });
});

describe('ratingBadge', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('AAA uses top-band green (nominal)', () => {
    ratingBadge.paint(gc, baseConfig({ params: { rating: 'AAA', agency: 'sp' } }));
    const aaa = RATING_SCALE_BANDS.find((b) => b.grade === 'AAA')!;
    expect(pillFills(gc.calls).some((c) => c.includes('0aa063') || c.startsWith('rgba(10, 160, 99'))).toBe(true);
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'AAA')).toBe(true);
    void aaa;
  });

  it('BB+ uses HY amber tint (variant)', () => {
    ratingBadge.paint(gc, baseConfig({ params: { rating: 'BB+' } }));
    expect(pillFills(gc.calls).some((c) => c.includes('f0b429') || c.startsWith('rgba(240, 180, 41'))).toBe(true);
  });

  it('NR uses muted grey (edge)', () => {
    ratingBadge.paint(gc, baseConfig({ params: { rating: 'NR' } }));
    expect(pillFills(gc.calls).some((c) => c.includes('8a8f98') || c.startsWith('rgba(138, 143, 152'))).toBe(true);
  });

  // B7 — standalone glyph indicator; the pill centers horizontally in the
  // cell rather than hugging the left edge. fakeGc's measureText is
  // 7px/char: 'AAA'.width=21, pill width=21+12=33, bounds.w=140 →
  // x=(140-33)/2=53.5, and `pill()`'s first path op is `moveTo(x+radius, y)`
  // with radius=3 → 56.5 (far from the old left-aligned ~9).
  it('centers the pill horizontally in the cell (B7)', () => {
    ratingBadge.paint(gc, baseConfig({ params: { rating: 'AAA' } }));
    const moveTo = gc.calls.find((c) => c.op === 'moveTo')!;
    expect(Number(moveTo.args[0])).toBeCloseTo(56.5, 5);
  });
});

describe('ratingClusterCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('lays out three badges side-by-side (nominal)', () => {
    ratingClusterCell.paint(gc, baseConfig({
      rowData: { sp: 'AAA', moodys: 'Aa1', fitch: 'AA' },
      params: { spField: 'sp', moodysField: 'moodys', fitchField: 'fitch' },
    }));
    const labels = gc.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(labels).toEqual(expect.arrayContaining(['AAA', 'Aa1', 'AA']));
  });

  it('shows optional agency nano labels (variant)', () => {
    ratingClusterCell.paint(gc, baseConfig({
      rowData: { sp: 'AAA', moodys: 'Aa1', fitch: 'AA' },
      params: {
        spField: 'sp', moodysField: 'moodys', fitchField: 'fitch', showAgencyLabels: true,
      },
    }));
    const labels = gc.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(labels).toEqual(expect.arrayContaining(['S&P', "Moody's", 'Fitch']));
  });

  it('skips empty agency fields (edge)', () => {
    ratingClusterCell.paint(gc, baseConfig({
      rowData: { sp: 'AAA' },
      params: { spField: 'sp', moodysField: 'moodys', fitchField: 'fitch' },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBe(1);
  });
});

describe('tagCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints muted tag from text param (nominal)', () => {
    tagCell.paint(gc, baseConfig({ params: { text: '144A' } }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === '144A')).toBe(true);
  });

  it('uses valueFormatted fallback (edge)', () => {
    tagCell.paint(gc, baseConfig({ valueFormatted: 'TRACE', params: {} }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'TRACE')).toBe(true);
  });

  it('no throw on empty text (variant)', () => {
    expect(() => tagCell.paint(gc, baseConfig({ valueFormatted: '', params: {} }))).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream A (2026-07-06 CSS styling model) — chip geometry-as-style.
// `--cg-chip-height` / `--cg-chip-radius` → `RendererPalette.chipHeight` /
// `.chipRadius`, read by `paintCapsPill()`. bounds.h is 24 in `baseConfig`,
// so the default chip (16px) centers at y = (24-16)/2 = 4.
// ───────────────────────────────────────────────────────────────────────
describe('tagCell — Workstream A chip geometry', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('reads chip height/radius from p.palette when present', () => {
    tagCell.paint(gc, baseConfig({
      params: { text: 'NEW' },
      palette: {
        positive: SEMANTIC_COLORS.positive, negative: SEMANTIC_COLORS.negative,
        warning: SEMANTIC_COLORS.warning, info: SEMANTIC_COLORS.info, muted: SEMANTIC_COLORS.muted,
        barHeight: 8, chipHeight: 24, chipRadius: 7,
        status: {} as never, rating: {} as never, venue: {},
      },
    }));
    const arcTo = gc.calls.find((c) => c.op === 'arcTo');
    expect(arcTo?.args[4]).toBe(7);
    const moveTo = gc.calls.find((c) => c.op === 'moveTo');
    // y = (24 bounds.h - 24 chipHeight) / 2 = 0
    expect(moveTo?.args[1]).toBe(0);
  });

  it('falls back to height 16 / radius 3 when p.palette is absent (byte-identical)', () => {
    tagCell.paint(gc, baseConfig({ params: { text: 'NEW' } }));
    const arcTo = gc.calls.find((c) => c.op === 'arcTo');
    expect(arcTo?.args[4]).toBe(3);
    const moveTo = gc.calls.find((c) => c.op === 'moveTo');
    expect(moveTo?.args[1]).toBe((24 - 16) / 2);
  });
});

describe('venueChip', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('uses XNAS palette token (nominal)', () => {
    venueChip.paint(gc, baseConfig({ params: { mic: 'XNAS' } }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'XNAS')).toBe(true);
    expect(pillFills(gc.calls).some((c) => c.includes('3b82f6') || c.startsWith('rgba(59, 130, 246'))).toBe(true);
    void DEFAULT_VENUE_PALETTE.XNAS;
  });

  it('centers chip in cell (edge)', () => {
    venueChip.paint(gc, baseConfig({ bounds: { x: 0, y: 0, w: 100, h: 24 }, params: { mic: 'BATS' } }));
    const fillRect = gc.calls.find((c) => c.op === 'fill' && gc.calls[gc.calls.indexOf(c) - 1]?.op === 'closePath');
    expect(fillRect).toBeDefined();
  });

  it('reads micField from rowData (variant)', () => {
    venueChip.paint(gc, baseConfig({
      rowData: { venue: 'EDGX' },
      params: { micField: 'venue' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'EDGX')).toBe(true);
  });
});

describe('sideChip', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('L uses green background (nominal)', () => {
    sideChip.paint(gc, baseConfig({ params: { side: 'long' } }));
    expect(pillFills(gc.calls)).toContain(SEMANTIC_COLORS.positive);
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'L')).toBe(true);
  });

  it('S uses red background (variant)', () => {
    sideChip.paint(gc, baseConfig({ params: { side: 'short' } }));
    expect(pillFills(gc.calls)).toContain(SEMANTIC_COLORS.negative);
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'S')).toBe(true);
  });

  it('reads sideField aliases (edge)', () => {
    sideChip.paint(gc, baseConfig({
      rowData: { side: 'L' },
      params: { sideField: 'side' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'L')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream A, part 2 (2026-07-06 CSS styling model) — status-pill /
// rating-scale / venue structured maps, threaded via `p.palette.status` /
// `.rating` / `.venue` (same channel WS-A1's `chipHeight`/`chipRadius`
// used). `fullPalette()` builds a complete, valid `RendererPalette`-shaped
// object from the palette.ts literals (the byte-identical defaults) so
// each test only needs to override the one map/entry under test.
// ───────────────────────────────────────────────────────────────────────
function fullPalette(overrides: Record<string, unknown> = {}): NonNullable<CellPaintConfig['palette']> {
  const status = Object.fromEntries(
    Object.entries(STATUS_PILL_MAP).map(([k, v]) => [k, { ...v }]),
  );
  const rating = Object.fromEntries(RATING_SCALE_BANDS.map((b) => [b.grade, b.color]));
  const venue = { ...DEFAULT_VENUE_PALETTE };
  return {
    positive: SEMANTIC_COLORS.positive,
    negative: SEMANTIC_COLORS.negative,
    warning: SEMANTIC_COLORS.warning,
    info: SEMANTIC_COLORS.info,
    muted: SEMANTIC_COLORS.muted,
    barHeight: 8,
    chipHeight: 16,
    chipRadius: 3,
    status,
    rating,
    venue,
    ...overrides,
  } as NonNullable<CellPaintConfig['palette']>;
}

describe('statusPill — Workstream A part 2 (status palette via CSS tokens)', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('reads p.palette.status[state] when present', () => {
    const palette = fullPalette({
      status: {
        ...(fullPalette().status as Record<string, unknown>),
        WORKING: { bg: '#111111', fg: '#222222' },
      },
    });
    statusPill.paint(gc, baseConfig({ params: { status: 'WORKING' }, palette }));
    expect(pillFills(gc.calls)).toContain('#111111');
  });

  it('falls back to STATUS_PILL_MAP when p.palette is absent (byte-identical)', () => {
    statusPill.paint(gc, baseConfig({ params: { status: 'WORKING' } }));
    expect(pillFills(gc.calls).some((c) => c.includes('3b82f6') || c.startsWith('rgba(59, 130, 246'))).toBe(true);
  });

  it('an explicit params.statusColors override still wins over p.palette.status', () => {
    const palette = fullPalette({
      status: {
        ...(fullPalette().status as Record<string, unknown>),
        WORKING: { bg: '#111111', fg: '#222222' },
      },
    });
    statusPill.paint(gc, baseConfig({
      params: { status: 'WORKING', statusColors: { WORKING: { bg: '#ff00ff', fg: '#00ffff' } } },
      palette,
    }));
    expect(pillFills(gc.calls)).toContain('#ff00ff');
  });
});

describe('ratingBadge — Workstream A part 2 (rating palette via CSS tokens)', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('reads p.palette.rating[grade] when present', () => {
    const palette = fullPalette({
      rating: { ...(fullPalette().rating as Record<string, string>), AAA: '#123123' },
    });
    ratingBadge.paint(gc, baseConfig({ params: { rating: 'AAA' }, palette }));
    expect(pillFills(gc.calls)).toContain(withAlpha('#123123', 0.18));
  });

  it('falls back to RATING_SCALE_BANDS when p.palette is absent (byte-identical)', () => {
    ratingBadge.paint(gc, baseConfig({ params: { rating: 'AAA' } }));
    expect(pillFills(gc.calls).some((c) => c.includes('0aa063') || c.startsWith('rgba(10, 160, 99'))).toBe(true);
  });
});

describe('venueChip — Workstream A part 2 (venue palette via CSS tokens)', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('reads p.palette.venue[mic] when present', () => {
    const palette = fullPalette({
      venue: { ...(fullPalette().venue as Record<string, string>), XNAS: '#abcdef' },
    });
    venueChip.paint(gc, baseConfig({ params: { mic: 'XNAS' }, palette }));
    expect(pillFills(gc.calls)).toContain(withAlpha('#abcdef', 0.18));
  });

  it('falls back to DEFAULT_VENUE_PALETTE when p.palette is absent (byte-identical)', () => {
    venueChip.paint(gc, baseConfig({ params: { mic: 'XNAS' } }));
    expect(pillFills(gc.calls).some((c) => c.includes('3b82f6') || c.startsWith('rgba(59, 130, 246'))).toBe(true);
  });

  it('an explicit params.venueColors override still wins over p.palette.venue', () => {
    const palette = fullPalette({
      venue: { ...(fullPalette().venue as Record<string, string>), XNAS: '#abcdef' },
    });
    venueChip.paint(gc, baseConfig({
      params: { mic: 'XNAS', venueColors: { XNAS: '#000011' } },
      palette,
    }));
    expect(pillFills(gc.calls)).toContain(withAlpha('#000011', 0.18));
  });
});

describe('tifPill', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints DAY label (nominal)', () => {
    tifPill.paint(gc, baseConfig({ params: { tif: 'DAY' } }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'DAY')).toBe(true);
  });

  it('colour-codes IOC (variant)', () => {
    tifPill.paint(gc, baseConfig({ params: { tif: 'IOC' } }));
    expect(pillFills(gc.calls).some((c) => c.includes('f0b429') || c.startsWith('rgba(240, 180, 41'))).toBe(true);
  });

  it('reads tifField from rowData (edge)', () => {
    tifPill.paint(gc, baseConfig({
      rowData: { tif: 'FOK' },
      params: { tifField: 'tif' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'FOK')).toBe(true);
  });
});
