/**
 * Shared types for the canvas-painted sparkline family (Cycle 21 / Tasks 1-3).
 *
 * Per-cell options arrive opaquely through `cellRendererParams.sparkline`
 * (see `CellPaintConfig.params`). Each variant reads its slice (`options`)
 * and falls back to `p.fg` when a color isn't supplied so light + dark
 * themes pick up the surrounding text color automatically.
 */

export type SparklineType = 'line' | 'column' | 'area' | 'bar' | 'pie';

export interface SparklineLineOptions {
  lineColor?: string;
  lineWidth?: number;
}

export interface SparklineColumnOptions {
  fill?: string;
  /** Optional gap (px) between columns. Defaults to 1. */
  gap?: number;
}

export interface SparklineAreaOptions {
  lineColor?: string;
  lineWidth?: number;
  fill?: string;
}

export interface SparklineBarOptions {
  fill?: string;
  gap?: number;
}

export interface SparklinePieOptions {
  fill?: string;
  /** Background ring color shown behind the segment. */
  trackColor?: string;
}

export type SparklineOptions =
  | SparklineLineOptions
  | SparklineColumnOptions
  | SparklineAreaOptions
  | SparklineBarOptions
  | SparklinePieOptions;

export interface SparklineParams {
  /** Discriminates the variant painter. */
  type?: SparklineType;
  options?: SparklineOptions;
}
