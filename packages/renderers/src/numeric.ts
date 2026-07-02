// @cgrid/renderers — category 1: Numeric (tick-aware). Catalog §3.1.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (NumberCellParams, PriceCellParams, …).

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.1 NumberCell — params: `NumberCellParams`. */
export const numberCell: CellPainter = {
  paint() {
    throw new Error('not implemented: number');
  },
};

/** Catalog §3.1 PriceCell — params: `PriceCellParams`. */
export const priceCell: CellPainter = {
  paint() {
    throw new Error('not implemented: price');
  },
};

/** Catalog §3.1 PriceDirectionCell — params: `PriceDirectionCellParams`. */
export const priceDirectionCell: CellPainter = {
  paint() {
    throw new Error('not implemented: price-direction');
  },
};

/** Catalog §3.1 PnlCell — params: `PnlCellParams`. */
export const pnlCell: CellPainter = {
  paint() {
    throw new Error('not implemented: pnl');
  },
};

/** Catalog §3.1 DeltaCell — params: `DeltaCellParams`. */
export const deltaCell: CellPainter = {
  paint() {
    throw new Error('not implemented: delta');
  },
};

/** Catalog §3.1 BpsCell — params: `BpsCellParams`. */
export const bpsCell: CellPainter = {
  paint() {
    throw new Error('not implemented: bps');
  },
};

/** Catalog §3.1 PctChangeCell — params: `PctChangeCellParams`. */
export const pctChangeCell: CellPainter = {
  paint() {
    throw new Error('not implemented: pct-change');
  },
};

/** Catalog §3.1 FractionalPriceCell — params: `FractionalPriceCellParams`. */
export const fractionalPriceCell: CellPainter = {
  paint() {
    throw new Error('not implemented: fractional-price');
  },
};

/** Catalog §3.1 AbbreviatedNumberCell — params: `AbbreviatedNumberCellParams`. */
export const abbreviatedNumberCell: CellPainter = {
  paint() {
    throw new Error('not implemented: abbreviated-number');
  },
};
