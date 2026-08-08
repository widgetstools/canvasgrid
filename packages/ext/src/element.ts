import { VelocityGridExt, type VelocityGridExtOptions } from './velocityGridExt';

/** Thin custom element over VelocityGridExt. The class is the source of truth; the
 *  element is a shell. Set `.options` before or after connect; it (re)builds
 *  the instance on connect. */
export class VelocityGridExtElement extends HTMLElement {
  options: VelocityGridExtOptions = {} as VelocityGridExtOptions;
  private _instance: VelocityGridExt | null = null;

  get instance(): VelocityGridExt | null { return this._instance; }

  connectedCallback(): void {
    if (this._instance) return;
    this._instance = new VelocityGridExt(this, this.options);
  }
  disconnectedCallback(): void {
    this._instance?.destroy();
    this._instance = null;
  }
}

export function defineVelocityGridExt(tag = 'velocity-grid-ext'): void {
  if (!customElements.get(tag)) customElements.define(tag, VelocityGridExtElement);
}
