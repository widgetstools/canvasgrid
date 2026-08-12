/**
 * Full-grid busy / loading overlay controlled by `VelocityGridOptions.loading`.
 * Mounts over the grid root (above the canvas, below popups that append
 * to `document.body`) and blocks pointer interaction while shown.
 * Optional `loadingMessage` drives the label (e.g. row-load progress).
 */

export class LoadingOverlay {
  private readonly el: HTMLDivElement;
  private readonly labelEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private destroyed = false;

  constructor(private readonly host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'vg-loading-overlay';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;

    const card = document.createElement('div');
    card.className = 'vg-loading-overlay-card';
    const spinner = document.createElement('div');
    spinner.className = 'vg-loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'vg-loading-overlay-label';
    this.labelEl.textContent = 'Loading…';
    this.detailEl = document.createElement('div');
    this.detailEl.className = 'vg-loading-overlay-detail';
    this.detailEl.hidden = true;
    card.append(spinner, this.labelEl, this.detailEl);
    this.el.appendChild(card);
    this.host.appendChild(this.el);
  }

  /** Sync visibility to the runtime `loading` flag. */
  setLoading(loading: boolean): void {
    if (this.destroyed) return;
    this.el.hidden = !loading;
    this.el.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (!loading) this.setDetail(null);
  }

  /** Primary label under the spinner (defaults to “Loading…”). */
  setMessage(message: string | null | undefined): void {
    if (this.destroyed) return;
    const text = (message ?? '').trim();
    this.labelEl.textContent = text || 'Loading…';
  }

  /**
   * Secondary progress line (e.g. “12,450 / 20,000 rows”). Pass
   * `null` / empty to hide. When only `loaded` is known, shows
   * “12,450 rows loaded”.
   */
  setDetail(detail: string | null | undefined): void {
    if (this.destroyed) return;
    const text = (detail ?? '').trim();
    this.detailEl.textContent = text;
    this.detailEl.hidden = !text;
  }

  /** Convenience: format a loaded[/total] row counter into the detail line. */
  setProgress(loaded: number, total?: number | null): void {
    if (this.destroyed) return;
    const n = Math.max(0, Math.floor(loaded));
    const fmt = (v: number) => v.toLocaleString();
    if (total != null && total > 0) {
      this.setDetail(`${fmt(n)} / ${fmt(Math.floor(total))} rows`);
    } else if (n > 0) {
      this.setDetail(`${fmt(n)} rows loaded`);
    } else {
      this.setDetail(null);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.el.remove();
  }
}
