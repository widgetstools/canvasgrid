/**
 * Cycle 21i Phase 2 / T5 — flat-panel chrome components.
 *
 * The subset the flat settings panels (#09 Smart Edit, #10 Bulk Update)
 * need: section band, field row, switch, select, number input. Visual
 * parity with the kernel's native settings chrome is the contract (see
 * styles.ts); the full ~27-component StarUI foundation library grows in
 * Phases 3-4 as consumers arrive, not speculatively.
 *
 * Tag prefix `cgc-` (cgrid customizer). Components are controlled: they
 * render the value they're given and emit `cgc-change` with
 * `detail.value` — the panel owns state + writes to the engine.
 */
import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { chromeBase, bandStyles, rowStyles, switchStyles, inputStyles } from './styles';

/** Fired by every control on user input. */
export interface CgcChangeDetail {
  value: unknown;
}

function emitChange(el: HTMLElement, value: unknown): void {
  el.dispatchEvent(new CustomEvent<CgcChangeDetail>('cgc-change', {
    detail: { value },
    bubbles: true,
    composed: true,
  }));
}

/** Collapsible section band (`<cgc-band title="Editing">…rows…</cgc-band>`). */
export class CgcBand extends LitElement {
  static override styles = [chromeBase, bandStyles];

  @property({ type: String, attribute: 'band-title' }) accessor bandTitle = '';
  @property({ type: Boolean, reflect: true }) accessor collapsed = false;

  override render() {
    return html`
      <button
        type="button"
        class="header"
        aria-expanded=${this.collapsed ? 'false' : 'true'}
        @click=${() => { this.collapsed = !this.collapsed; }}
      >
        <span class="chevron"></span>
        <span class="title">${this.bandTitle}</span>
      </button>
      ${this.collapsed ? nothing : html`<slot></slot>`}
    `;
  }
}

/** Field row: label + optional hint on the left, control slot pinned
 *  right. Set the `modified` attribute for the diff-rail tick. */
export class CgcField extends LitElement {
  static override styles = [chromeBase, rowStyles];

  @property({ type: String }) accessor label = '';
  @property({ type: String }) accessor hint = '';
  @property({ type: Boolean, reflect: true }) accessor modified = false;

  override render() {
    return html`
      <div class="label">
        <span class="label-text">${this.label}</span>
        ${this.hint ? html`<span class="hint">${this.hint}</span>` : nothing}
      </div>
      <div class="control"><slot></slot></div>
    `;
  }
}

/** Toggle switch. Controlled: renders `checked`, emits `cgc-change`
 *  with the flipped boolean. */
export class CgcSwitch extends LitElement {
  static override styles = [chromeBase, switchStyles];

  @property({ type: Boolean }) accessor checked = false;
  @property({ type: String, attribute: 'aria-label' }) accessor ariaLabelText = '';

  override render() {
    return html`
      <button
        type="button"
        role="switch"
        aria-pressed=${this.checked ? 'true' : 'false'}
        aria-label=${this.ariaLabelText || nothing}
        @click=${() => emitChange(this, !this.checked)}
      >
        <span class="knob"></span>
      </button>
    `;
  }
}

/** Select. `options` is `[{ value, label }]`; emits the selected value. */
export class CgcSelect extends LitElement {
  static override styles = [chromeBase, inputStyles];

  @property({ attribute: false }) accessor options: Array<{ value: string; label: string }> = [];
  @property({ type: String }) accessor value = '';
  @property({ type: String, attribute: 'aria-label' }) accessor ariaLabelText = '';

  override render() {
    return html`
      <select
        aria-label=${this.ariaLabelText || nothing}
        .value=${this.value}
        @change=${(e: Event) => emitChange(this, (e.target as HTMLSelectElement).value)}
      >
        ${this.options.map((o) => html`
          <option value=${o.value} ?selected=${o.value === this.value}>${o.label}</option>
        `)}
      </select>
    `;
  }
}

/** Number input. Emits a number (or undefined when cleared). */
export class CgcNumber extends LitElement {
  static override styles = [chromeBase, inputStyles];

  @property({ type: Number }) accessor value: number | undefined = undefined;
  @property({ type: Number }) accessor min: number | undefined = undefined;
  @property({ type: Number }) accessor max: number | undefined = undefined;
  @property({ type: Number }) accessor step: number | undefined = undefined;
  @property({ type: String }) accessor placeholder = '';
  @property({ type: String, attribute: 'aria-label' }) accessor ariaLabelText = '';

  override render() {
    return html`
      <input
        type="number"
        aria-label=${this.ariaLabelText || nothing}
        .value=${this.value === undefined ? '' : String(this.value)}
        min=${this.min ?? nothing}
        max=${this.max ?? nothing}
        step=${this.step ?? nothing}
        placeholder=${this.placeholder || nothing}
        @change=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value;
          emitChange(this, raw === '' ? undefined : Number(raw));
        }}
      />
    `;
  }
}

/** Register every chrome component once. Safe to call repeatedly
 *  (skips tags that are already defined — HMR, multiple panels). */
export function defineChromeComponents(): void {
  const defs: Array<[string, CustomElementConstructor]> = [
    ['cgc-band', CgcBand],
    ['cgc-field', CgcField],
    ['cgc-switch', CgcSwitch],
    ['cgc-select', CgcSelect],
    ['cgc-number', CgcNumber],
  ];
  for (const [tag, ctor] of defs) {
    if (!customElements.get(tag)) customElements.define(tag, ctor);
  }
}
