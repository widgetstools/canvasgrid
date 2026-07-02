// @cgrid/renderers — category 5: Bars / gauges. Catalog §3.5.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (ProgressBarCellParams, HeatCellParams, …).
// HeatCell's LAB-space interpolation lives in paintUtils.ts (interpolateLab); HeatCell
// and BidirectionalBarCell/VolumeBar read column-wide stats via columnStats.ts.

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.5 ProgressBarCell — params: `ProgressBarCellParams`. */
export const progressBarCell: CellPainter = {
  paint() {
    throw new Error('not implemented: progress-bar');
  },
};

/** Catalog §3.5 RangeBarCell — params: `RangeBarCellParams`. */
export const rangeBarCell: CellPainter = {
  paint() {
    throw new Error('not implemented: range-bar');
  },
};

/** Catalog §3.5 BidirectionalBarCell — params: `BidirectionalBarCellParams`. */
export const bidirectionalBarCell: CellPainter = {
  paint() {
    throw new Error('not implemented: bidirectional-bar');
  },
};

/** Catalog §3.5 HeatCell — params: `HeatCellParams`. */
export const heatCell: CellPainter = {
  paint() {
    throw new Error('not implemented: heat');
  },
};

/** Catalog §3.5 GaugeCell — params: `GaugeCellParams`. */
export const gaugeCell: CellPainter = {
  paint() {
    throw new Error('not implemented: gauge');
  },
};

/** Catalog §3.5 SpreadBarCell — params: `SpreadBarCellParams`. */
export const spreadBarCell: CellPainter = {
  paint() {
    throw new Error('not implemented: spread-bar');
  },
};

/** Catalog §3.5 VolumeBar — params: `VolumeBarParams`. */
export const volumeBar: CellPainter = {
  paint() {
    throw new Error('not implemented: volume-bar');
  },
};

/** Catalog §3.5 MaturityLadderBar — params: `MaturityLadderBarParams`. */
export const maturityLadderBar: CellPainter = {
  paint() {
    throw new Error('not implemented: maturity-ladder');
  },
};
