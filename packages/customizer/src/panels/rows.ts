/**
 * Cycle 21i Phase 2 / T7 — shared settings-row template helpers.
 *
 * The flat panels (#09 Smart Edit, #10 Bulk Update) repeat two row
 * shapes: a switch bound to a boolean setting and a number input bound
 * to a numeric one. These helpers keep each panel's render() at the
 * "band layout per the doc" altitude; the diff rail (modified vs the
 * engine default) comes free.
 */
import { html, type TemplateResult } from 'lit';
import type { CgcChangeDetail } from '../components';

export interface SwitchRowSpec {
  label: string;
  hint?: string;
  value: boolean;
  defaultValue: boolean;
  onChange: (value: boolean) => void;
}

export function switchRow(spec: SwitchRowSpec): TemplateResult {
  return html`
    <cgc-field label=${spec.label} hint=${spec.hint ?? ''} ?modified=${spec.value !== spec.defaultValue}>
      <cgc-switch .checked=${spec.value} aria-label=${spec.label}
        @cgc-change=${(e: CustomEvent<CgcChangeDetail>) => spec.onChange(e.detail.value === true)}></cgc-switch>
    </cgc-field>
  `;
}

export interface NumberRowSpec {
  label: string;
  hint?: string;
  value: number;
  defaultValue: number;
  min?: number;
  step?: number;
  /** Invoked only with finite numbers >= min (cleared inputs are ignored). */
  onChange: (value: number) => void;
}

export function numberRow(spec: NumberRowSpec): TemplateResult {
  return html`
    <cgc-field label=${spec.label} hint=${spec.hint ?? ''} ?modified=${spec.value !== spec.defaultValue}>
      <cgc-number .value=${spec.value} min=${spec.min ?? 0} step=${spec.step ?? 1} aria-label=${spec.label}
        @cgc-change=${(e: CustomEvent<CgcChangeDetail>) => {
          const v = e.detail.value;
          if (typeof v === 'number' && Number.isFinite(v) && v >= (spec.min ?? 0)) spec.onChange(v);
        }}></cgc-number>
    </cgc-field>
  `;
}
