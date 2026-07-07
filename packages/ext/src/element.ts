import { CGridExt, type CGridExtOptions } from './cgridExt';

/** Thin custom element over CGridExt. The class is the source of truth; the
 *  element is a shell. Set `.options` before or after connect; it (re)builds
 *  the instance on connect. */
export class CgridExtElement extends HTMLElement {
  options: CGridExtOptions = {} as CGridExtOptions;
  private _instance: CGridExt | null = null;
  private _wrapper: HTMLElement | null = null;

  get instance(): CGridExt | null { return this._instance; }

  connectedCallback(): void {
    if (this._instance) return;
    if (!this._wrapper) {
      this._wrapper = document.createElement('div');
      this.appendChild(this._wrapper);
    }
    this._instance = new CGridExt(this._wrapper, this.options);
  }
  disconnectedCallback(): void {
    this._instance?.destroy();
    this._instance = null;
  }
}

export function defineCgridExt(tag = 'cgrid-ext'): void {
  if (!customElements.get(tag)) customElements.define(tag, CgridExtElement);
}
