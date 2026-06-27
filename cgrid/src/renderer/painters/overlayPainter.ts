import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';

export function paintOverlay(gc: CachedContext2D, p: PainterCtx): void {
  const { theme, selection } = p;
  const { focusedRowIndex, focusedColId } = selection;

  if (focusedRowIndex === null || focusedColId === null) return;

  // Cycle 12 / Task 2 — band-clip math lives behind getVisibleCellBounds.
  // The helper returns null when the focused cell has scrolled out of its
  // column's band (center vs pinned-left vs pinned-right) OR exited the
  // body's vertical region. No save/clip/restore pair is needed because
  // the bounds are already band-bounded.
  const bounds = p.getVisibleCellBounds(focusedRowIndex, focusedColId);
  if (!bounds) return;

  const hw = theme.focusRingWidth / 2;
  gc.cache.strokeStyle = theme.focusRingColor;
  gc.cache.lineWidth = theme.focusRingWidth;
  gc.strokeRect(
    bounds.x + hw,
    bounds.y + hw,
    bounds.w - theme.focusRingWidth,
    bounds.h - theme.focusRingWidth,
  );
}
