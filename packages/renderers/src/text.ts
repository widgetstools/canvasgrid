// @cgrid/renderers — category 2: Text / identity. Catalog §3.2.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (TickerCellParams, CurrencyPairCellParams, …).

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.2 TickerCell — params: `TickerCellParams`. */
export const tickerCell: CellPainter = {
  paint() {
    throw new Error('not implemented: ticker');
  },
};

/** Catalog §3.2 CurrencyPairCell — params: `CurrencyPairCellParams`. */
export const currencyPairCell: CellPainter = {
  paint() {
    throw new Error('not implemented: currency-pair');
  },
};

/** Catalog §3.2 TimestampCell — params: `TimestampCellParams`. */
export const timestampCell: CellPainter = {
  paint() {
    throw new Error('not implemented: timestamp');
  },
};

/** Catalog §3.2 AgeCell — params: `AgeCellParams`. */
export const ageCell: CellPainter = {
  paint() {
    throw new Error('not implemented: age');
  },
};

/** Catalog §3.2 RelativeTimeCell — params: `RelativeTimeCellParams`. */
export const relativeTimeCell: CellPainter = {
  paint() {
    throw new Error('not implemented: relative-time');
  },
};
