/**
 * Cycle 21i Phase 2 / T6 — #09 Smart Edit settings panel.
 *
 * Flat settings panel over the @cgrid/edit engine's smart-edit slice,
 * per docs/starui-customizer-ui/09-smart-edit.md: GLOBAL (enabled /
 * increment step / K/M/B), OPERATIONS (× ÷ + − Set toggle group),
 * SAFETY (confirm threshold / single column / preview / history).
 *
 * Immediate-apply (Phase 1 convention — no draft/save): every change
 * writes through `EditBridgeHandle.updateSettings`, which marks the
 * engine-owned `editSettings` state module dirty so the kernel
 * autosave persists it. The diff rail marks rows changed from
 * `DEFAULT_EDIT_SETTINGS`.
 *
 * `smartEditToolPanel(getHandle)` takes a GETTER because tool-panel
 * components are handed to the CGrid constructor while
 * `wireEditIntoKernel(grid)` can only run after construction — the
 * getter resolves lazily at first render.
 */
import { html, css, nothing } from 'lit';
import type { ToolPanel } from '@cgrid/kernel';
import type { EditBridgeHandle, SmartEditOp, SmartEditSettings } from '@cgrid/edit';
import { DEFAULT_EDIT_SETTINGS } from '@cgrid/edit';
import { CgcPanelElement, litToolPanel } from '../litToolPanel';
import { chromeBase } from '../styles';

const OP_LABELS: Array<{ op: SmartEditOp; glyph: string; title: string }> = [
  { op: 'multiply', glyph: '×', title: 'Multiply' },
  { op: 'divide', glyph: '÷', title: 'Divide' },
  { op: 'add', glyph: '+', title: 'Add' },
  { op: 'subtract', glyph: '−', title: 'Subtract' },
  { op: 'set', glyph: 'Set', title: 'Set value' },
];

/** Per-factory-call unique tags: custom elements bind a tag to ONE
 *  constructor, and each grid's panel class closes over its own handle
 *  getter. */
let tagCounter = 0;

export function smartEditToolPanel(getHandle: () => EditBridgeHandle | undefined): new () => ToolPanel {
  class SmartEditPanel extends CgcPanelElement {
    static override styles = [chromeBase, css`
      :host {
        display: block;
      }
      /* Operation toggle group — mirrors the kernel op-toggle vocabulary
       * (segmented buttons, accent = active). */
      .ops {
        display: flex;
        gap: 4px;
      }
      .ops button {
        min-width: 28px;
        height: 22px;
        padding: 0 7px;
        font-family: var(--cg-font-family);
        font-size: var(--cg-font-size-sm);
        color: var(--cg-fg-color);
        background: color-mix(in srgb, var(--cg-fg-color) 5%, transparent);
        border: 1px solid var(--cg-border-color);
        border-radius: 4px;
        cursor: pointer;
      }
      .ops button[aria-pressed='true'] {
        background: color-mix(in srgb, var(--cgc-accent) 22%, transparent);
        border-color: var(--cgc-accent);
      }
      .ops button:focus-visible {
        outline: 2px solid var(--cg-focus-ring-color);
        outline-offset: 1px;
      }
      .empty {
        padding: 10px 12px;
        font-size: var(--cg-font-size-sm);
        color: color-mix(in srgb, var(--cg-fg-color) 55%, transparent);
      }
    `];

    private get settings(): SmartEditSettings | null {
      return getHandle()?.getSettings().smartEdit ?? null;
    }

    private patch(partial: Partial<SmartEditSettings>): void {
      getHandle()?.updateSettings({ smartEdit: partial });
      this.requestUpdate();
    }

    private toggleOp(op: SmartEditOp, current: readonly SmartEditOp[]): void {
      const next = current.includes(op) ? current.filter((o) => o !== op) : [...current, op];
      // The engine's defensive merge treats an empty ops list as
      // "revert to defaults" — keep at least one op enabled instead.
      if (next.length === 0) return;
      this.patch({ enabledOps: next as SmartEditOp[] });
    }

    override render() {
      const s = this.settings;
      if (!s) {
        return html`<div class="empty">Smart Edit engine is not wired — call wireEditIntoKernel(grid) first.</div>`;
      }
      const d = DEFAULT_EDIT_SETTINGS.smartEdit;
      const opsModified = s.enabledOps.length !== d.enabledOps.length
        || s.enabledOps.some((op) => !d.enabledOps.includes(op));
      return html`
        <cgc-band band-title="Global">
          <cgc-field label="Enabled" hint="Smart-edit toolbar + gestures" ?modified=${s.enabled !== d.enabled}>
            <cgc-switch .checked=${s.enabled} aria-label="Enabled"
              @cgc-change=${(e: CustomEvent<{ value: unknown }>) => this.patch({ enabled: e.detail.value === true })}></cgc-switch>
          </cgc-field>
          <cgc-field label="Increment step" hint="± nudge amount" ?modified=${s.incrementStep !== d.incrementStep}>
            <cgc-number .value=${s.incrementStep} min="0" step="0.0001" aria-label="Increment step"
              @cgc-change=${(e: CustomEvent<{ value: unknown }>) => {
                const v = e.detail.value;
                if (typeof v === 'number' && Number.isFinite(v)) this.patch({ incrementStep: v });
              }}></cgc-number>
          </cgc-field>
          <cgc-field label="K/M/B shortcuts" hint="1.5M parses as 1,500,000" ?modified=${s.magnitudeShortcutsEnabled !== d.magnitudeShortcutsEnabled}>
            <cgc-switch .checked=${s.magnitudeShortcutsEnabled} aria-label="K/M/B shortcuts"
              @cgc-change=${(e: CustomEvent<{ value: unknown }>) => this.patch({ magnitudeShortcutsEnabled: e.detail.value === true })}></cgc-switch>
          </cgc-field>
        </cgc-band>
        <cgc-band band-title="Operations">
          <cgc-field label="Toolbar ops" hint="At least one stays on" ?modified=${opsModified}>
            <div class="ops" role="group" aria-label="Toolbar operations">
              ${OP_LABELS.map(({ op, glyph, title }) => html`
                <button type="button" title=${title} aria-label=${title}
                  aria-pressed=${s.enabledOps.includes(op) ? 'true' : 'false'}
                  @click=${() => this.toggleOp(op, s.enabledOps)}>${glyph}</button>
              `)}
            </div>
          </cgc-field>
        </cgc-band>
        <cgc-band band-title="Safety">
          <cgc-field label="Confirm above" hint="cells · 0 = never ask" ?modified=${s.confirmThreshold !== d.confirmThreshold}>
            <cgc-number .value=${s.confirmThreshold} min="0" step="1" aria-label="Confirm above"
              @cgc-change=${(e: CustomEvent<{ value: unknown }>) => {
                const v = e.detail.value;
                if (typeof v === 'number' && Number.isFinite(v) && v >= 0) this.patch({ confirmThreshold: v });
              }}></cgc-number>
          </cgc-field>
          <cgc-field label="Single column" hint="Targets must share one column" ?modified=${s.enforceSingleColumn !== d.enforceSingleColumn}>
            <cgc-switch .checked=${s.enforceSingleColumn} aria-label="Single column"
              @cgc-change=${(e: CustomEvent<{ value: unknown }>) => this.patch({ enforceSingleColumn: e.detail.value === true })}></cgc-switch>
          </cgc-field>
          <cgc-field label="Preview before apply" ?modified=${s.previewBeforeApply !== d.previewBeforeApply}>
            <cgc-switch .checked=${s.previewBeforeApply} aria-label="Preview before apply"
              @cgc-change=${(e: CustomEvent<{ value: unknown }>) => this.patch({ previewBeforeApply: e.detail.value === true })}></cgc-switch>
          </cgc-field>
          <cgc-field label="Record history" hint="Journal entries for undo" ?modified=${s.recordHistory !== d.recordHistory}>
            <cgc-switch .checked=${s.recordHistory} aria-label="Record history"
              @cgc-change=${(e: CustomEvent<{ value: unknown }>) => this.patch({ recordHistory: e.detail.value === true })}></cgc-switch>
          </cgc-field>
        </cgc-band>
      `;
    }
  }

  return litToolPanel(`cgc-smart-edit-panel-${tagCounter++}`, SmartEditPanel);
}
