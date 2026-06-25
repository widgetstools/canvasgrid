/**
 * Cycle 7 / Task 3 — FilterPopupHost.
 *
 * Centralised open/close orchestration for per-column filter popups
 * (number / date / text / multi-condition / set). Tasks 4-6 + 9 build on
 * this so each filter type only writes its own popup body — the host
 * handles anchoring, single-popup-at-a-time discipline, outside-click
 * dismissal, and Escape-to-close.
 *
 * Layered on top of Cycle 5's `PopupHost`, which owns the
 * cell-anchored positioning math (over/under flip, viewport clamp).
 * This host adds the filter-specific lifecycle: tracks the currently
 * open `colId`, closes any prior popup before opening a new one, and
 * tears down on outside-click / Escape.
 */
import type { PopupHost } from '../editors/popupHost';

/** Factory that builds the popup's DOM body. Tasks 3-9 implement this
 *  for each filter type (NumberFilterPopup, DateFilterPopup, etc.).
 *
 *  - `buildGui()` is called once per `open` and returns the root element
 *    the host should mount.
 *  - `destroy()` is called exactly once per opened popup — on `close()`,
 *    on outside-click, on Escape, on a second `open(...)` for a
 *    different column, and on `destroy()`. Idempotency is the
 *    factory's responsibility. */
export interface FilterPopupFactory {
  buildGui(): HTMLElement;
  destroy(): void;
}

/** Anchor params handed to `open(...)`. The host forwards these to
 *  `PopupHost.mount` with `position: 'under'` (filter popups always
 *  drop below the floating-filter cell, with the existing over/under
 *  flip kicking in near the viewport's bottom edge). */
export interface FilterPopupAnchor {
  cellBounds: { x: number; y: number; w: number; h: number };
  viewportBounds: { width: number; height: number };
}

export class FilterPopupHost {
  private current: { colId: string; factory: FilterPopupFactory } | null = null;
  private destroyed = false;
  private readonly onDocMouseDown = (ev: MouseEvent) => this.handleDocMouseDown(ev);
  private readonly onDocKeyDown = (ev: KeyboardEvent) => this.handleDocKeyDown(ev);

  constructor(
    private host: HTMLElement,
    private popupHost: PopupHost,
  ) {
    document.addEventListener('mousedown', this.onDocMouseDown, true);
    document.addEventListener('keydown', this.onDocKeyDown, true);
  }

  /** Open the popup for `colId`, mounting `factory.buildGui()` under the
   *  cell described by `anchor`. Closes any popup that's already open
   *  first (one-at-a-time). No-op after `destroy()`. */
  open(colId: string, anchor: FilterPopupAnchor, factory: FilterPopupFactory): void {
    if (this.destroyed) return;
    if (this.current) this.closeInternal();
    const gui = factory.buildGui();
    // Mark the GUI so outside-click detection can ignore mousedowns that
    // bubble from inside the popup body.
    gui.setAttribute('data-cg-filter-popup-root', '');
    this.popupHost.mount(gui, {
      cellBounds: anchor.cellBounds,
      position: 'under',
      viewportBounds: anchor.viewportBounds,
    });
    this.current = { colId, factory };
  }

  /** Close the active popup (if any). Calls `factory.destroy()` once. */
  close(): void {
    this.closeInternal();
  }

  isOpen(): boolean { return this.current !== null; }

  /** Currently-open column id, or `null` when nothing is mounted. Used
   *  by `CGridApi.showColumnFilter` to skip a redundant re-mount when
   *  the user clicks the expand button on the already-open column. */
  openColId(): string | null { return this.current?.colId ?? null; }

  /** Tear down listeners and any active popup. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeInternal();
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    document.removeEventListener('keydown', this.onDocKeyDown, true);
  }

  private closeInternal(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    this.popupHost.unmount();
    c.factory.destroy();
  }

  private handleDocMouseDown(ev: MouseEvent): void {
    if (!this.current) return;
    const target = ev.target as Node | null;
    if (target && this.isInsidePopup(target)) return;
    this.closeInternal();
  }

  private handleDocKeyDown(ev: KeyboardEvent): void {
    if (!this.current) return;
    if (ev.key !== 'Escape') return;
    this.closeInternal();
  }

  /** True when `target` is inside the currently-mounted popup body. The
   *  popup is mounted under `host`, so a `host.contains(target)` check
   *  combined with the `data-cg-filter-popup-root` marker on the popup
   *  body covers both direct children and any portal-mounted overlays
   *  the popup might add later (e.g. a date-picker calendar). */
  private isInsidePopup(target: Node): boolean {
    if (!this.host.contains(target)) return false;
    let el: Node | null = target;
    while (el) {
      if (el instanceof HTMLElement && el.hasAttribute('data-cg-filter-popup-root')) {
        return true;
      }
      el = el.parentNode;
    }
    return false;
  }
}
