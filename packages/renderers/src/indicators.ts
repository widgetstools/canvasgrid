// @cgrid/renderers — category 3: Indicators (semantic glyphs). Catalog §3.3.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (StatusDotParams, QuoteQualityDotParams, …).

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.3 StatusDot — params: `StatusDotParams`. */
export const statusDot: CellPainter = {
  paint() {
    throw new Error('not implemented: status-dot');
  },
};

/** Catalog §3.3 QuoteQualityDot — params: `QuoteQualityDotParams`. */
export const quoteQualityDot: CellPainter = {
  paint() {
    throw new Error('not implemented: quote-quality-dot');
  },
};

/** Catalog §3.3 StaleFlag — params: `StaleFlagParams`. */
export const staleFlag: CellPainter = {
  paint() {
    throw new Error('not implemented: stale-flag');
  },
};

/** Catalog §3.3 DirectionArrow — params: `DirectionArrowParams`. */
export const directionArrow: CellPainter = {
  paint() {
    throw new Error('not implemented: direction-arrow');
  },
};

/** Catalog §3.3 StructureIconStrip — params: `StructureIconStripParams`. */
export const structureIconStrip: CellPainter = {
  paint() {
    throw new Error('not implemented: structure-icon-strip');
  },
};

/** Catalog §3.3 TrafficLightCell — params: `TrafficLightCellParams`. */
export const trafficLightCell: CellPainter = {
  paint() {
    throw new Error('not implemented: traffic-light');
  },
};
