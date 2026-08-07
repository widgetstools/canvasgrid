/**
 * Full-grid busy / loading overlay controlled by `CGridOptions.loading`.
 * Mounts over the grid root (above the canvas, below popups that append
 * to `document.body`) and blocks pointer interaction while shown.
 */

export class LoadingOverlay {
  private readonly el: HTMLDivElement;
  private destroyed = false;

  constructor(private readonly host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cg-loading-overlay';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.innerHTML =
      '<div class="cg-loading-overlay-card">' +
      '<div class="cg-loading-spinner" aria-hidden="true"></div>' +
      '<div class="cg-loading-overlay-label">Loading…</div>' +
      '</div>';
    this.host.appendChild(this.el);
  }

  /** Sync visibility to the runtime `loading` flag. */
  setLoading(loading: boolean): void {
    if (this.destroyed) return;
    this.el.hidden = !loading;
    this.el.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.el.remove();
  }
}
