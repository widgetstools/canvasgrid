// @cgrid/renderers — category 4: Badges / pills. Catalog §3.4.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (StatusPillParams, RatingBadgeParams, …).
// Palette data: see palette.ts (STATUS_PILL_MAP, RATING_SCALE_BANDS, DEFAULT_VENUE_PALETTE).

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.4 StatusPill — params: `StatusPillParams`. */
export const statusPill: CellPainter = {
  paint() {
    throw new Error('not implemented: status-pill');
  },
};

/** Catalog §3.4 RatingBadge — params: `RatingBadgeParams`. */
export const ratingBadge: CellPainter = {
  paint() {
    throw new Error('not implemented: rating-badge');
  },
};

/** Catalog §3.4 RatingClusterCell — params: `RatingClusterCellParams`. */
export const ratingClusterCell: CellPainter = {
  paint() {
    throw new Error('not implemented: rating-cluster');
  },
};

/** Catalog §3.4 TagCell — params: `TagCellParams`. */
export const tagCell: CellPainter = {
  paint() {
    throw new Error('not implemented: tag');
  },
};

/** Catalog §3.4 VenueChip — params: `VenueChipParams`. */
export const venueChip: CellPainter = {
  paint() {
    throw new Error('not implemented: venue-chip');
  },
};

/** Catalog §3.4 SideChip — params: `SideChipParams`. */
export const sideChip: CellPainter = {
  paint() {
    throw new Error('not implemented: side-chip');
  },
};

/** Catalog §3.4 TimeInForcePill — params: `TimeInForcePillParams`. */
export const tifPill: CellPainter = {
  paint() {
    throw new Error('not implemented: tif-pill');
  },
};
