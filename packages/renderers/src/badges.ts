// @cgrid/renderers — category 4: Badges / pills. Catalog §3.4.

import type { CellPaintConfig, CellPainter } from '@cgrid/kernel';
import { fragText, pill, withAlpha } from './paintUtils';
import {
  DEFAULT_VENUE_PALETTE,
  RATING_SCALE_BANDS,
  SEMANTIC_COLORS,
  STATUS_PILL_MAP,
  resolvePillColors,
} from './palette';
import type {
  RatingBadgeParams,
  RatingClusterCellParams,
  SideChipParams,
  StatusPillParams,
  TagCellParams,
  TimeInForcePillParams,
  VenueChipParams,
} from './types';

type Gc = Parameters<CellPainter['paint']>[0];

const PAD = 6;
const CHIP_H = 16;
const SIDE_SIZE = 15;

const TIF_COLORS: Readonly<Record<string, { bg: string; fg: string }>> = {
  DAY: { bg: withAlpha(SEMANTIC_COLORS.info, 0.15), fg: SEMANTIC_COLORS.info },
  GTC: { bg: withAlpha(SEMANTIC_COLORS.muted, 0.15), fg: SEMANTIC_COLORS.muted },
  IOC: { bg: withAlpha(SEMANTIC_COLORS.warning, 0.15), fg: SEMANTIC_COLORS.warning },
  FOK: { bg: withAlpha(SEMANTIC_COLORS.negative, 0.15), fg: SEMANTIC_COLORS.negative },
};

const ratingColorScratch = { color: SEMANTIC_COLORS.muted };

function padLeft(p: CellPaintConfig): number {
  return p.padding?.left ?? PAD;
}

function fontFamily(baseFont: string): string {
  return baseFont.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif';
}

function textY(gc: Gc, p: CellPaintConfig, offset = 0): number {
  const m = gc.measureText('Mg');
  return p.bounds.y + p.bounds.h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 + offset;
}

function rowString(row: Record<string, unknown> | undefined, field?: string): string | undefined {
  if (!field || !row) return undefined;
  const v = row[field];
  return v == null ? undefined : String(v);
}

function ratingColor(grade: string): string {
  const band = RATING_SCALE_BANDS.find((b) => b.grade === grade);
  ratingColorScratch.color = band?.color ?? SEMANTIC_COLORS.muted;
  return ratingColorScratch.color;
}

function paintCapsPill(
  gc: Gc,
  p: CellPaintConfig,
  text: string,
  bg: string,
  fg: string,
  x: number,
  border?: string,
  dashed?: boolean,
  uppercase = true,
): number {
  const label = uppercase ? text.toUpperCase() : text;
  const font = `600 10px ${fontFamily(p.font)}`;
  gc.cache.font = font;
  const textW = gc.measureText(label).width;
  const padX = 6;
  const w = textW + padX * 2;
  // Workstream A (2026-07-06 CSS styling model) — geometry-as-style:
  // `--cg-chip-height` / `--cg-chip-radius` resolve into
  // `RendererPalette.chipHeight` / `.chipRadius`; CHIP_H + the literal `3`
  // (below) are now only the byte-identical fallbacks.
  const chipH = p.palette?.chipHeight ?? CHIP_H;
  const radius = p.palette?.chipRadius ?? 3;
  const y = p.bounds.y + (p.bounds.h - chipH) / 2;
  pill(gc, x, y, w, chipH, radius, bg, dashed ? undefined : border);
  if (dashed && border) {
    gc.cache.strokeStyle = border;
    gc.setLineDash([3, 2]);
    gc.beginPath();
    gc.moveTo(x + radius, y);
    gc.arcTo(x + w, y, x + w, y + chipH, radius);
    gc.arcTo(x + w, y + chipH, x, y + chipH, radius);
    gc.arcTo(x, y + chipH, x, y, radius);
    gc.arcTo(x, y, x + w, y, radius);
    gc.closePath();
    gc.stroke();
    gc.setLineDash([]);
  }
  fragText(gc, label, x + padX, textY(gc, p), { font, color: fg, align: 'left' });
  return x + w + 4;
}

function paintRatingBadge(
  gc: Gc,
  p: CellPaintConfig,
  grade: string,
  x: number,
): number {
  const color = ratingColor(grade);
  const bg = withAlpha(color, 0.18);
  return paintCapsPill(gc, p, grade, bg, color, x, undefined, undefined, false);
}

/** Catalog §3.4 StatusPill — order/state label with semantic colour. */
export const statusPill: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as StatusPillParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const status = (params.status ?? rowString(row, params.statusField) ?? '').toUpperCase();
    if (!status) return;
    const themeKind = p.themeKind ?? 'light';
    const custom = params.statusColors?.[status];
    const resolved = custom ?? resolvePillColors(status, themeKind);
    const style = STATUS_PILL_MAP[status];
    paintCapsPill(
      gc,
      p,
      status,
      resolved.bg,
      resolved.fg,
      p.bounds.x + padLeft(p),
      resolved.border ?? custom?.border,
      style?.dashed ?? custom?.dashed,
    );
  },
};

/** Catalog §3.4 RatingBadge — single agency rating, AAA green → D red. */
export const ratingBadge: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as RatingBadgeParams;
    const grade = params.rating || p.valueFormatted || String(p.value ?? '');
    if (!grade) return;
    void params.agency;
    // B7 — standalone glyph indicator; center the pill horizontally in the
    // cell. Mirrors paintCapsPill's own width formula (measureText + 2×padX)
    // since that helper doesn't expose a measure-only variant.
    gc.cache.font = `600 10px ${fontFamily(p.font)}`;
    const w = gc.measureText(grade).width + 12;
    const x = p.bounds.x + (p.bounds.w - w) / 2;
    paintRatingBadge(gc, p, grade, x);
  },
};

/** Catalog §3.4 RatingClusterCell — three RatingBadges side-by-side. */
export const ratingClusterCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as RatingClusterCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const entries: Array<{ label: string; grade: string }> = [
      { label: 'S&P', grade: rowString(row, params.spField) ?? '' },
      { label: "Moody's", grade: rowString(row, params.moodysField) ?? '' },
      { label: 'Fitch', grade: rowString(row, params.fitchField) ?? '' },
    ];
    let x = p.bounds.x + padLeft(p);
    const labelOffset = params.showAgencyLabels ? 6 : 0;
    for (const entry of entries) {
      if (!entry.grade) continue;
      const endX = paintRatingBadge(gc, p, entry.grade, x);
      if (params.showAgencyLabels) {
        fragText(gc, entry.label, x + (endX - x) / 2, textY(gc, p, labelOffset), {
          font: `400 10px ${fontFamily(p.font)}`,
          color: SEMANTIC_COLORS.muted,
          align: 'center',
        });
      }
      x = endX;
    }
  },
};

/** Catalog §3.4 TagCell — generic muted-grey tag. */
export const tagCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as TagCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const text = params.text ?? rowString(row, params.textField) ?? p.valueFormatted ?? String(p.value ?? '');
    if (!text) return;
    paintCapsPill(
      gc,
      p,
      text,
      withAlpha(SEMANTIC_COLORS.muted, 0.12),
      SEMANTIC_COLORS.muted,
      p.bounds.x + padLeft(p),
    );
  },
};

/** Catalog §3.4 VenueChip — execution venue MIC with venue-specific palette. */
export const venueChip: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as VenueChipParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const mic = (params.mic ?? rowString(row, params.micField) ?? p.valueFormatted ?? '').toUpperCase();
    if (!mic) return;
    const palette = params.venueColors ?? DEFAULT_VENUE_PALETTE;
    const color = palette[mic] ?? SEMANTIC_COLORS.info;
    const font = `600 10px ${fontFamily(p.font)}`;
    gc.cache.font = font;
    const textW = gc.measureText(mic).width;
    const w = textW + 12;
    const x = p.bounds.x + (p.bounds.w - w) / 2;
    // Workstream A (2026-07-06 CSS styling model) — same geometry tokens
    // as paintCapsPill (chip height/radius); this painter builds its pill
    // inline rather than through that helper.
    const chipH = p.palette?.chipHeight ?? CHIP_H;
    const chipRadius = p.palette?.chipRadius ?? 3;
    const y = p.bounds.y + (p.bounds.h - chipH) / 2;
    pill(gc, x, y, w, chipH, chipRadius, withAlpha(color, 0.18));
    fragText(gc, mic, x + w / 2, textY(gc, p), { font, color, align: 'center' });
  },
};

/** Catalog §3.4 SideChip — long/short single-char square chip. */
export const sideChip: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as SideChipParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    let side = params.side;
    if (!side && params.sideField && row) {
      const raw = String(row[params.sideField] ?? '').toLowerCase();
      if (raw === 'long' || raw === 'l') side = 'long';
      if (raw === 'short' || raw === 's') side = 'short';
    }
    if (!side) return;
    const label = side === 'long' ? 'L' : 'S';
    const bg = side === 'long' ? SEMANTIC_COLORS.positive : SEMANTIC_COLORS.negative;
    const x = p.bounds.x + padLeft(p);
    const y = p.bounds.y + (p.bounds.h - SIDE_SIZE) / 2;
    pill(gc, x, y, SIDE_SIZE, SIDE_SIZE, 2, bg);
    fragText(gc, label, x + SIDE_SIZE / 2, textY(gc, p), {
      font: `700 10px ${fontFamily(p.font)}`,
      color: STATUS_PILL_MAP.REJECTED!.bg,
      align: 'center',
    });
  },
};

/** Catalog §3.4 TimeInForcePill — DAY/GTC/IOC/FOK colour-coded pill. */
export const tifPill: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as TimeInForcePillParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const tif = (params.tif ?? rowString(row, params.tifField) ?? p.valueFormatted ?? '').toUpperCase();
    if (!tif) return;
    const colors = TIF_COLORS[tif] ?? {
      bg: withAlpha(SEMANTIC_COLORS.muted, 0.12),
      fg: SEMANTIC_COLORS.muted,
    };
    paintCapsPill(gc, p, tif, colors.bg, colors.fg, p.bounds.x + padLeft(p));
  },
};
