import type { ViewportState } from './viewport';

/**
 * Computes scrollbar track + thumb rectangles for a given viewport.
 *
 * Scrollbars overlay the body region — they don't shrink the body. The
 * vertical scrollbar sits along the body's right edge; the horizontal one
 * sits along the body's bottom edge. When both overflow, the corner where
 * they meet is reserved (small filled square) so the thumbs don't collide.
 */
export interface ScrollbarRect {
  track: { x: number; y: number; w: number; h: number };
  thumb: { x: number; y: number; w: number; h: number };
  /** Whether this axis is overflowing and the bar should be visible. */
  visible: boolean;
}

export interface ScrollbarGeometry {
  vertical: ScrollbarRect;
  horizontal: ScrollbarRect;
  thickness: number;
}

const MIN_THUMB = 24;

export function computeScrollbars(vs: ViewportState, thickness: number): ScrollbarGeometry {
  // Reserve corner space when both axes overflow so thumbs don't overlap.
  const vVisible = vs.maxScrollTop > 0;
  const hVisible = vs.maxScrollLeft > 0;
  const cornerV = hVisible ? thickness : 0;  // shorter vertical track when h-bar present
  const cornerH = vVisible ? thickness : 0;

  // Vertical track: right edge of body, from bodyTop to bodyBottom (minus corner).
  const vTrackX = vs.bodyRight - thickness;
  const vTrackY = vs.bodyTop;
  const vTrackW = thickness;
  const vTrackH = vs.bodyHeight - cornerV;

  let vThumbY = vTrackY;
  let vThumbH = vTrackH;
  if (vVisible && vs.contentHeight > 0) {
    vThumbH = Math.max(MIN_THUMB, (vs.bodyHeight / vs.contentHeight) * vTrackH);
    const range = vTrackH - vThumbH;
    const ratio = vs.maxScrollTop > 0 ? vs.scrollTop / vs.maxScrollTop : 0;
    vThumbY = vTrackY + range * ratio;
  }

  // Horizontal track: bottom edge of body, from bodyLeft to bodyRight (minus corner).
  const hTrackX = vs.bodyLeft;
  const hTrackY = vs.bodyBottom - thickness;
  const hTrackW = vs.bodyWidth - cornerH;
  const hTrackH = thickness;

  let hThumbX = hTrackX;
  let hThumbW = hTrackW;
  if (hVisible && vs.contentWidth > 0) {
    hThumbW = Math.max(MIN_THUMB, (vs.bodyWidth / vs.contentWidth) * hTrackW);
    const range = hTrackW - hThumbW;
    const ratio = vs.maxScrollLeft > 0 ? vs.scrollLeft / vs.maxScrollLeft : 0;
    hThumbX = hTrackX + range * ratio;
  }

  return {
    thickness,
    vertical: {
      track: { x: vTrackX, y: vTrackY, w: vTrackW, h: vTrackH },
      thumb: { x: vTrackX, y: vThumbY, w: vTrackW, h: vThumbH },
      visible: vVisible,
    },
    horizontal: {
      track: { x: hTrackX, y: hTrackY, w: hTrackW, h: hTrackH },
      thumb: { x: hThumbX, y: hTrackY, w: hThumbW, h: hTrackH },
      visible: hVisible,
    },
  };
}

/** Convert a thumb position back into a scroll offset. Used by drag handlers. */
export function thumbToScroll(
  thumbStart: number,
  trackStart: number,
  trackLength: number,
  thumbLength: number,
  maxScroll: number,
): number {
  const range = trackLength - thumbLength;
  if (range <= 0) return 0;
  const ratio = (thumbStart - trackStart) / range;
  return Math.max(0, Math.min(maxScroll, ratio * maxScroll));
}
