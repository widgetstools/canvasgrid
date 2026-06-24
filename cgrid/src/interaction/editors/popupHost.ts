/**
 * PopupHost — mounts a floating editor GUI anchored to a cell. Used by
 * editors whose `isPopup()` returns true (e.g. `largeText`) or whose host
 * column sets `cellEditorPopup: true`. The host is intentionally small —
 * positioning math + DOM hand-off only; the editor itself owns its DOM and
 * keyboard wiring.
 *
 * Positioning rules (single best-effort flip — see test cases):
 *   - `over`:  popup top = cellBounds.y         (default; preserves cell location)
 *   - `under`: popup top = cellBounds.y + cellBounds.h
 *   - If the requested position would push the popup past the viewport edge,
 *     flip to the opposite mode ONCE. We don't iterate further — a popup
 *     larger than the viewport in both modes is the editor's responsibility
 *     (most built-ins size to a small textarea/select that comfortably fits).
 *
 * Left positioning matches `cellBounds.x` verbatim. Horizontal collision is
 * deferred — popup widths are typically column-width; the cell is already
 * scrolled into view by the editor-trigger pipeline (Task 4).
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
    gui.style.left = `${anchor.cellBounds.x}px`;
    gui.style.zIndex = '20';
    // Pointer events live on the gui itself — the editor container above us is
    // pointer-events:none so paint stays untouched when no editor is active.
    gui.style.pointerEvents = 'auto';
    this.host.appendChild(gui);
    this.current = gui;
    // offsetHeight is read AFTER the gui mounts so the browser has had a
    // chance to lay it out. In jsdom/happy-dom the value is whatever the
    // test stubbed; in a real browser it's the measured height.
    const popupH = gui.offsetHeight || 0;
    const top = this.resolveTop(anchor, popupH);
    gui.style.top = `${top}px`;
  }

  unmount(): void {
    if (!this.current) return;
    this.current.remove();
    this.current = null;
  }

  private resolveTop(anchor: PopupAnchor, popupH: number): number {
    const { cellBounds, position, viewportBounds } = anchor;
    const overTop = cellBounds.y;
    const underTop = cellBounds.y + cellBounds.h;
    if (position === 'over') {
      const overOverflow = overTop + popupH > viewportBounds.height;
      return overOverflow ? underTop : overTop;
    }
    // position === 'under'
    const underOverflow = underTop + popupH > viewportBounds.height;
    if (!underOverflow) return underTop;
    // Flip to over: anchor at cellY - popupH if that fits; otherwise clamp to 0.
    const flippedTop = cellBounds.y - popupH;
    return Math.max(0, flippedTop);
  }
}
