/**
 * `<cgc-expression-editor>` — foundation ExpressionEditor (Phase 3 lite).
 *
 * Textarea + live `@wellsfargo-starui/velocity-grid-expression` validate. CodeMirror can replace the
 * textarea later behind the same value / schema / cgc-change API.
 */
import { LitElement, html, css, nothing } from 'lit';
import { validate, type Schema, type ValidationError } from '@wellsfargo-starui/velocity-grid-expression';
import { chromeBase } from './styles';

function emitChange(el: HTMLElement, value: string): void {
  el.dispatchEvent(new CustomEvent('cgc-change', {
    detail: { value },
    bubbles: true,
    composed: true,
  }));
}

export class CgcExpressionEditor extends LitElement {
  static override styles = [
    chromeBase,
    css`
      :host { display: block; }
      textarea {
        width: 100%; box-sizing: border-box; min-height: 72px; resize: vertical;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        background: var(--vg-input-bg, #1a1f2b);
        color: var(--vg-fg-color, #e5e9f0);
        border: 1px solid var(--vg-border-color, rgba(255,255,255,0.12));
        border-radius: 2px;
        padding: 8px 10px;
      }
      textarea:focus {
        outline: 2px solid color-mix(in srgb, var(--vg-accent-color, #5b8def) 55%, transparent);
        outline-offset: 1px;
      }
      textarea.is-invalid {
        border-color: var(--vg-danger-color, #f87171);
      }
      .errors {
        margin: 6px 0 0; padding: 0; list-style: none;
        font-size: 11px; color: var(--vg-danger-color, #f87171);
      }
      .errors li { margin: 2px 0; }
      .ok {
        margin-top: 6px; font-size: 11px;
        color: var(--vg-success-color, #4ade80);
      }
    `,
  ];

  static override properties = {
    value: { type: String },
    placeholder: { type: String },
    /** JSON-serialized Schema (`{ fields: { col: 'number', … } }`) for attribute use. */
    schemaJson: { type: String, attribute: 'schema-json' },
  };

  declare value: string;
  declare placeholder: string;
  declare schemaJson: string;

  /** Prefer setting this property over schemaJson when embedding from TS. */
  schema: Schema = { fields: {} };

  private errors: ValidationError[] = [];
  private valid = true;

  constructor() {
    super();
    this.value = '';
    this.placeholder = '[field] > 0';
    this.schemaJson = '';
  }

  private resolvedSchema(): Schema {
    if (this.schemaJson) {
      try {
        const parsed = JSON.parse(this.schemaJson) as Schema;
        if (parsed?.fields && typeof parsed.fields === 'object') return parsed;
      } catch { /* fall through */ }
    }
    return this.schema;
  }

  private runValidate(source: string): void {
    const result = validate(source, this.resolvedSchema());
    this.valid = result.ok;
    this.errors = result.ok ? [] : result.errors;
    this.requestUpdate();
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('value') || changed.has('schemaJson')) {
      if (this.value.trim()) this.runValidate(this.value);
      else { this.valid = true; this.errors = []; }
    }
  }

  private onInput(e: Event): void {
    const next = (e.target as HTMLTextAreaElement).value;
    this.value = next;
    this.runValidate(next);
    emitChange(this, next);
  }

  override render() {
    const showOk = this.value.trim().length > 0 && this.valid;
    return html`
      <textarea
        class=${this.valid ? '' : 'is-invalid'}
        .value=${this.value}
        placeholder=${this.placeholder}
        spellcheck="false"
        aria-invalid=${this.valid ? 'false' : 'true'}
        @input=${this.onInput}
      ></textarea>
      ${this.errors.length
        ? html`<ul class="errors">${this.errors.map((err) => html`<li>${err.message}</li>`)}</ul>`
        : nothing}
      ${showOk ? html`<div class="ok">Valid</div>` : nothing}
    `;
  }
}

let defined = false;
export function defineExpressionEditor(): void {
  if (defined || typeof customElements === 'undefined') return;
  if (!customElements.get('cgc-expression-editor')) {
    customElements.define('cgc-expression-editor', CgcExpressionEditor);
  }
  defined = true;
}
