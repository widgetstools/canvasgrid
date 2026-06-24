import type { PainterCtx } from './types';
import { computeScrollbars } from '../../core/scrollbarGeometry';

const TRACK_BG_ALPHA = 0.25;
const THUMB_RADIUS = 3;

/**
 * Paints vertical and horizontal scrollbars over the body region.
 *
 * Visible only when the body actually overflows on that axis. Tracks are
 * translucent; thumbs use the header background color (which gives decent
 * contrast against both light + dark themes).
 */
export function paintScrollbars(ctx: CanvasRenderingContext2D, p: PainterCtx): void {
  const { viewport: vs, theme } = p;
  const sb = computeScrollbars(vs, theme.scrollbarThickness ?? 10);

  const drawTrack = (rect: { x: number; y: number; w: number; h: number }) => {
    ctx.save();
    ctx.globalAlpha = TRACK_BG_ALPHA;
    ctx.fillStyle = theme.borderColor;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  };

  const drawThumb = (rect: { x: number; y: number; w: number; h: number }) => {
    ctx.fillStyle = theme.headerBg;
    fillRounded(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, THUMB_RADIUS);
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth = 1;
    strokeRounded(ctx, rect.x + 0.5 + 1, rect.y + 0.5 + 1, rect.w - 2, rect.h - 2, THUMB_RADIUS);
  };

  if (sb.vertical.visible) {
    drawTrack(sb.vertical.track);
    drawThumb(sb.vertical.thumb);
  }
  if (sb.horizontal.visible) {
    drawTrack(sb.horizontal.track);
    drawThumb(sb.horizontal.thumb);
  }
  // Corner where both meet — filled solid so the underlying body cells don't peek through.
  if (sb.vertical.visible && sb.horizontal.visible) {
    const t = sb.thickness;
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(vs.bodyRight - t, vs.bodyBottom - t, t, t);
  }
}

function fillRounded(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
  ctx.fill();
}

function strokeRounded(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
  ctx.stroke();
}
