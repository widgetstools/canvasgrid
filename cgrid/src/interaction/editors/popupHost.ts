/**
 * PopupHost — mounts a floating editor GUI anchored to a cell. Used by
 * editors whose `isPopup()` returns true (e.g. `largeText`) or whose host
 * column sets `cellEditorPopup: true`. The host is intentionally small —
 * positioning math + DOM hand-off only; the editor itself owns its DOM and
 * keyboard wiring.
 *
 * Positioning rules — the popup stays inside the container (the editor
 * host's visible bounds):
 *
 *   Vertical:
 *     - `over`:   start at `cellBounds.y`. If the popup would overflow the
 *                 bottom, try `under` (cell.y + cell.h). If that also
 *                 overflows, clamp so the bottom edge sits at
 *                 `viewportBounds.height`.
 *     - `under`:  start at `cellBounds.y + cellBounds.h`. If the popup
 *                 would overflow the bottom, try `over` (cell.y - popupH).
 *                 If that also overflows the top, clamp similarly.
 *
 *   Horizontal:
 *     - Start at `cellBounds.x`.
 *     - If `cell.x + popupW > viewportBounds.width`, shift left so the
 *       right edge sits at `viewportBounds.width`. Never go below 0; a
 *       popup wider than the viewport pins to the left edge and accepts
 *       overflow on the right (the editor is then responsible for
 *       scrolling its own content).
 *
 * Width/height are not set — the editor's own GUI controls its intrinsic
 * size. PopupHost only positions; it does not resize.
 */

export interface PopupAnchor {
  cellBounds: { x: number; y: number; w: number; h: number };
  position: 'over' | 'under';
  viewportBounds: { width: number; height: number };
}

export class PopupHost {
  private current: HTMLElement | null = null;

  constructor(private host: HTMLElement) {}

  mount(gui: HTMLElement, anchor: PopupAnchor): void {
    if (this.current) this.unmount();
    gui.style.position = 'absolute';
    gui.style.zIndex = '20';
    // Pointer events live on the gui itself — the editor container above us is
    // pointer-events:none so paint stays untouched when no editor is active.
    gui.style.pointerEvents = 'auto';
    this.host.appendChild(gui);
    this.current = gui;
    // offsetWidth / offsetHeight are read AFTER the gui mounts so the browser
    // has laid it out. In jsdom/happy-dom both fall back to whatever the test
    // stubbed; in a real browser they're the measured natural dimensions.
    const popupW = gui.offsetWidth || 0;
    const popupH = gui.offsetHeight || 0;
    gui.style.left = `${this.resolveLeft(anchor, popupW)}px`;
    gui.style.top = `${this.resolveTop(anchor, popupH)}px`;
  }

  unmount(): void {
    if (!this.current) return;
    this.current.remove();
    this.current = null;
  }

  private resolveLeft(anchor: PopupAnchor, popupW: number): number {
    const desired = anchor.cellBounds.x;
    const maxLeft = anchor.viewportBounds.width - popupW;
    // Clamp into [0, maxLeft]. When popupW > viewportBounds.width, maxLeft
    // is negative and Math.min picks it — Math.max(0, ...) then pins to 0.
    return Math.max(0, Math.min(desired, maxLeft));
  }

  private resolveTop(anchor: PopupAnchor, popupH: number): number {
    const { cellBounds, position, viewportBounds } = anchor;
    const overTop = cellBounds.y;
    const underTop = cellBounds.y + cellBounds.h;
    const fitsAt = (top: number) => top >= 0 && top + popupH <= viewportBounds.height;

    if (position === 'over') {
      if (fitsAt(overTop)) return overTop;
      if (fitsAt(underTop)) return underTop;
      // Both modes overflow; clamp so the popup stays inside the viewport
      // (bottom edge at viewportH). Pin to 0 if even that goes negative —
      // popup taller than the viewport.
      return Math.max(0, viewportBounds.height - popupH);
    }
    // position === 'under'
    if (fitsAt(underTop)) return underTop;
    const flippedOver = cellBounds.y - popupH;
    if (fitsAt(flippedOver)) return flippedOver;
    return Math.max(0, viewportBounds.height - popupH);
  }
}
