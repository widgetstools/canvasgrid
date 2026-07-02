// @cgrid/renderers — category 7: Composite (multi-value). Catalog §3.7.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (StackedValueCellParams, PriceQuoteCellParams, …).
//
// Multi-field threading (§2.3): these renderers read named rowData fields per
// their params field-mapping. The bridge's `colDef()` builders (bridge.ts)
// emit a ColDef carrying a minimal Tier-2 composite program so kernel threads
// `rowData`/`rowId`/`themeKind` onto the paint config — a dedicated task
// proves that threading end-to-end before this category relies on it.

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.7 StackedValueCell — params: `StackedValueCellParams`. */
export const stackedValueCell: CellPainter = {
  paint() {
    throw new Error('not implemented: stacked-value');
  },
};

/** Catalog §3.7 PriceQuoteCell — params: `PriceQuoteCellParams`. */
export const priceQuoteCell: CellPainter = {
  paint() {
    throw new Error('not implemented: price-quote');
  },
};

/** Catalog §3.7 NBBOCell — params: `NBBOCellParams`. */
export const nbboCell: CellPainter = {
  paint() {
    throw new Error('not implemented: nbbo');
  },
};

/** Catalog §3.7 BenchmarkSpreadCell — params: `BenchmarkSpreadCellParams`. */
export const benchmarkSpreadCell: CellPainter = {
  paint() {
    throw new Error('not implemented: benchmark-spread');
  },
};

/** Catalog §3.7 PriceChangeComposite — params: `PriceChangeCompositeParams`. */
export const priceChangeComposite: CellPainter = {
  paint() {
    throw new Error('not implemented: price-change-composite');
  },
};
