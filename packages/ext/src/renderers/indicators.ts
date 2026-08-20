// @wellsfargo-starui/velocity-grid-ext/renderers — category 3: Indicators (semantic glyphs). Catalog §3.3.

import type { CellPaintConfig, CellPainter } from '@wellsfargo-starui/velocity-grid';
import { dot, fragText } from './paintUtils';
import { SEMANTIC_COLORS } from './palette';
import type {
  DirectionArrowParams,
  QuoteQualityDotParams,
  SemanticColorMap,
  StaleFlagParams,
  StatusDotParams,
  StructureGlyphKey,
  StructureIconStripParams,
  TrafficLightCellParams,
} from './types';
import { STRUCTURE_GLYPH_MAP } from './palette';

type Gc = Parameters<CellPainter['paint']>[0];

const PAD = 6;
const DOT_R = 4;

const STRUCTURE_KEYS: readonly StructureGlyphKey[] = [
  'callable', 'puttable', 'sinker', 'floater', 'step-up', 'make-whole',
];

const structureAbbrev: Readonly<Record<StructureGlyphKey, string>> = {
  callable: 'C',
  puttable: 'P',
  sinker: 'S',
  floater: 'F',
  'step-up': '^',
  'make-whole': 'M',
};

const colorScratch: Required<SemanticColorMap> = {
  positive: SEMANTIC_COLORS.positive,
  negative: SEMANTIC_COLORS.negative,
  warning: SEMANTIC_COLORS.warning,
  info: SEMANTIC_COLORS.info,
  muted: SEMANTIC_COLORS.muted,
};

/** Bridge Task 13 reads per-cell stale-flag tooltips keyed by rowId/colId. */
const staleTooltipByCell = new Map<string, string>();

function staleCellKey(rowId: string | undefined, colId: string | undefined): string | undefined {
  if (!rowId || !colId) return undefined;
  return `${rowId}\0${colId}`;
}

export function getStaleFlagTooltip(
  rowId: string | undefined,
  colId: string | undefined,
): string | undefined {
  const key = staleCellKey(rowId, colId);
  return key ? staleTooltipByCell.get(key) : undefined;
}

/** Evicts every stale-flag tooltip entry for `rowId` (any colId). Bridge
 *  `onRowsChanged` calls this per removed rowId, mirroring actions.ts's
 *  `clearRegionsForRow` — without it a removed row's stale tooltip (set
 *  while it was flagged stale) stays in this module-global map forever. */
export function clearStaleTooltipsForRow(rowId: string | undefined): void {
  if (!rowId) return;
  const prefix = `${rowId}\0`;
  for (const key of staleTooltipByCell.keys()) {
    if (key.startsWith(prefix)) staleTooltipByCell.delete(key);
  }
}

/** Evicts every stale-flag tooltip entry. Bridge `destroy()` calls this,
 *  mirroring `defaultHitRegionRegistry.clearAll()`. */
export function clearAllStaleTooltips(): void {
  staleTooltipByCell.clear();
}

/** @deprecated Use getStaleFlagTooltip(rowId, colId). Kept for bridge migration. */
export function getLastStaleFlagTooltip(): string | undefined {
  return staleTooltipByCell.values().next().value;
}

function padLeft(p: CellPaintConfig): number {
  return p.padding?.left ?? PAD;
}

function textY(gc: Gc, p: CellPaintConfig): number {
  const m = gc.measureText('Mg');
  return p.bounds.y + p.bounds.h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
}

function rowBool(row: Record<string, unknown> | undefined, field?: string): boolean {
  if (!field || !row) return false;
  const v = row[field];
  return v === true || v === 1 || v === 'true';
}

function rowString(row: Record<string, unknown> | undefined, field?: string): string | undefined {
  if (!field || !row) return undefined;
  const v = row[field];
  return v == null ? undefined : String(v);
}

function colorsFromParams(overrides?: SemanticColorMap): Required<SemanticColorMap> {
  colorScratch.positive = overrides?.positive ?? SEMANTIC_COLORS.positive;
  colorScratch.negative = overrides?.negative ?? SEMANTIC_COLORS.negative;
  colorScratch.warning = overrides?.warning ?? SEMANTIC_COLORS.warning;
  colorScratch.info = overrides?.info ?? SEMANTIC_COLORS.info;
  colorScratch.muted = overrides?.muted ?? SEMANTIC_COLORS.muted;
  return colorScratch;
}

function paintDirectionGlyph(
  gc: Gc,
  p: CellPaintConfig,
  dir: 'up' | 'down' | 'flat',
  color: string,
  iconX: number,
): void {
  const cy = textY(gc, p);
  const size = 8;
  gc.cache.save();
  gc.cache.strokeStyle = color;
  gc.cache.fillStyle = color;
  gc.cache.lineWidth = 1.5;
  gc.beginPath();
  // B1 fix — canvas Y grows DOWNWARD, so the apex of an 'up' (▲) triangle
  // must sit at the SMALLEST y (top) with its base at the LARGEST y
  // (bottom). The previous code had these swapped, so 'up' painted as ▼.
  if (dir === 'up') {
    gc.moveTo(iconX, cy - size * 0.35);
    gc.lineTo(iconX - size * 0.45, cy + size * 0.35);
    gc.lineTo(iconX + size * 0.45, cy + size * 0.35);
    gc.closePath();
    gc.fill();
  } else if (dir === 'down') {
    gc.moveTo(iconX, cy + size * 0.35);
    gc.lineTo(iconX - size * 0.45, cy - size * 0.35);
    gc.lineTo(iconX + size * 0.45, cy - size * 0.35);
    gc.closePath();
    gc.fill();
  } else {
    gc.moveTo(iconX - size * 0.5, cy);
    gc.lineTo(iconX + size * 0.5, cy);
    gc.stroke();
  }
  gc.cache.restore();
}

function paintStaleClockIcon(gc: Gc, cx: number, cy: number, color: string): void {
  const r = 5;
  gc.cache.strokeStyle = color;
  gc.cache.fillStyle = color;
  gc.cache.lineWidth = 1.25;
  gc.beginPath();
  gc.arc(cx, cy, r, 0, Math.PI * 2);
  gc.stroke();
  gc.beginPath();
  gc.moveTo(cx, cy);
  gc.lineTo(cx, cy - r * 0.55);
  gc.moveTo(cx, cy);
  gc.lineTo(cx + r * 0.45, cy + r * 0.15);
  gc.stroke();
}

function quoteQualityColor(
  row: Record<string, unknown> | undefined,
  params: QuoteQualityDotParams,
): string {
  if (rowBool(row, params.staleField) || rowBool(row, params.oneSidedField)) {
    return SEMANTIC_COLORS.negative;
  }
  if (
    rowBool(row, params.freshField)
    && rowBool(row, params.tightField)
    && rowBool(row, params.deepField)
  ) {
    return SEMANTIC_COLORS.positive;
  }
  return SEMANTIC_COLORS.warning;
}

function resolveTrafficLightColor(state: 'red' | 'amber' | 'green' | undefined): string {
  if (state === 'green') return SEMANTIC_COLORS.positive;
  if (state === 'amber') return SEMANTIC_COLORS.warning;
  if (state === 'red') return SEMANTIC_COLORS.negative;
  return SEMANTIC_COLORS.muted;
}

function structureGlyphLabel(
  key: StructureGlyphKey,
  overrides?: StructureIconStripParams['glyphOverrides'],
): string {
  const iconName = overrides?.[key] ?? STRUCTURE_GLYPH_MAP[key];
  const token = iconName.split('-').pop() ?? iconName;
  return (token.charAt(0) || structureAbbrev[key]).toUpperCase();
}

function paintStructureSlot(
  gc: Gc,
  p: CellPaintConfig,
  key: StructureGlyphKey,
  active: boolean,
  x: number,
  glyphLabel: string,
): number {
  const size = 12;
  const cy = textY(gc, p);
  const color = active ? SEMANTIC_COLORS.warning : SEMANTIC_COLORS.muted;
  gc.cache.strokeStyle = color;
  gc.cache.lineWidth = 1;
  gc.beginPath();
  gc.arc(x + size / 2, cy, size / 2 - 1, 0, Math.PI * 2);
  gc.stroke();
  fragText(gc, glyphLabel, x + size / 2, cy, {
    font: `600 8px ${p.font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`,
    color,
    align: 'center',
  });
  return x + size + 2;
}

/** Catalog §3.3 StatusDot — 8px filled circle in semantic colour; optional label after dot. */
export const statusDot: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as StatusDotParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const color = params.color
      ?? rowString(row, params.colorField)
      ?? SEMANTIC_COLORS.info;
    const label = params.label ?? rowString(row, params.labelField) ?? '';
    const cy = textY(gc, p);
    if (label) {
      // B7 — glyph + text reads left-to-right (directionArrow precedent);
      // only the label-less standalone dot centers.
      const cx = p.bounds.x + padLeft(p) + DOT_R;
      dot(gc, cx, cy, DOT_R, color);
      fragText(gc, label, cx + DOT_R + 6, cy, {
        font: p.font,
        color: p.fg,
        align: 'left',
      });
    } else {
      // B7 — standalone glyph indicators center horizontally in the cell.
      const cx = p.bounds.x + p.bounds.w / 2;
      dot(gc, cx, cy, DOT_R, color);
    }
  },
};

/** Catalog §3.3 QuoteQualityDot — green fresh+tight+deep / amber thin+wide / red stale+one-sided. */
export const quoteQualityDot: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as QuoteQualityDotParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const color = quoteQualityColor(row, params);
    // B7 — standalone glyph indicator; center horizontally in the cell.
    const cx = p.bounds.x + p.bounds.w / 2;
    dot(gc, cx, textY(gc, p), DOT_R, color);
  },
};

/** Catalog §3.3 StaleFlag — cell drops to 60% opacity + inline icon when aged. */
export const staleFlag: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as StaleFlagParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const nowMs = params.nowMs ?? 0;
    const lastTick = row?.[params.lastTickField];
    const lastMs = typeof lastTick === 'number' ? lastTick : Number(lastTick);
    const staleAfter = params.staleAfterMs ?? 8000;
    const text = p.valueFormatted || String(p.value ?? '');
    const isStale = Number.isFinite(lastMs) && nowMs - lastMs >= staleAfter;
    const ageSec = Number.isFinite(lastMs) ? Math.max(0, Math.floor((nowMs - lastMs) / 1000)) : 0;
    const cellKey = staleCellKey(p.rowId, p.colId);
    if (cellKey) {
      if (isStale) staleTooltipByCell.set(cellKey, `last tick ${ageSec}s ago`);
      else staleTooltipByCell.delete(cellKey);
    }

    if (isStale) {
      gc.cache.save();
      gc.cache.globalAlpha = 0.6;
    }

    let x = p.bounds.x + padLeft(p);
    if (text) {
      fragText(gc, text, x, textY(gc, p), { font: p.font, color: p.fg, align: 'left' });
      x += gc.measureText(text).width + 6;
    }

    if (isStale) {
      paintStaleClockIcon(gc, x + 5, textY(gc, p), SEMANTIC_COLORS.warning);
      gc.cache.restore();
    }
  },
};

/** Catalog §3.3 DirectionArrow — standalone ▲/▼/▬, coloured per direction. */
export const directionArrow: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as DirectionArrowParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const colors = colorsFromParams(params.colors);
    let dir = params.direction;
    if (!dir && params.directionField && row) {
      const raw = row[params.directionField];
      if (raw === 'up' || raw === 'down' || raw === 'flat') dir = raw;
    }
    dir = dir ?? 'flat';
    const color = dir === 'up' ? colors.positive : dir === 'down' ? colors.negative : colors.muted;
    paintDirectionGlyph(gc, p, dir, color, p.bounds.x + p.bounds.w / 2);
  },
};

/** Catalog §3.3 StructureIconStrip — fixed-income feature icons in a row. */
export const structureIconStrip: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as StructureIconStripParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const flags = params.flags
      ?? (params.flagsField && row
        ? (row[params.flagsField] as StructureIconStripParams['flags'])
        : undefined)
      ?? {};
    let x = p.bounds.x + padLeft(p);
    for (const key of STRUCTURE_KEYS) {
      if (!flags[key]) continue;
      const label = structureGlyphLabel(key, params.glyphOverrides);
      x = paintStructureSlot(gc, p, key, true, x, label);
    }
  },
};

/** Catalog §3.3 TrafficLightCell — three-state RAG dot. */
export const trafficLightCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as TrafficLightCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    let state = params.state;
    if (!state && params.stateField && row) {
      const raw = row[params.stateField];
      if (raw === 'red' || raw === 'amber' || raw === 'green') state = raw;
    }
    // B7 — standalone glyph indicator; center horizontally in the cell.
    const cx = p.bounds.x + p.bounds.w / 2;
    dot(gc, cx, textY(gc, p), DOT_R, resolveTrafficLightColor(state));
  },
};
