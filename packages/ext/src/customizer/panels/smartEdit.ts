/**
 * Cycle 21i Phase 2 / T6 — #09 Smart Edit settings panel.
 *
 * Flat settings panel over the `edit` engine's smart-edit slice,
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
 * components are handed to the VelocityGrid constructor while
 * `wireEditIntoKernel(grid)` can only run after construction — the
 * getter resolves lazily at first render.
 */
import { html, css } from 'lit';
import type { ToolPanel } from '@wellsfargo-starui/velocity-grid';
import type { EditBridgeHandle, SmartEditOp, SmartEditSettings } from '../../edit/index';
import { DEFAULT_EDIT_SETTINGS } from '../../edit/index';
import { CgcPanelElement, litToolPanel } from '../litToolPanel';
import { chromeBase } from '../styles';
import { switchRow, numberRow } from './rows';

const OP_LABELS: Array<{ op: SmartEditOp; glyph: string; title: string }> = [
  { op: 'multiply', glyph: '×', title: 'Multiply' },
  { op: 'divide', glyph: '÷', title: 'Divide' },
  { op: 'add', glyph: '+', title: 'Add' },
  { op: 'subtract', glyph: '−', title: 'Subtract' },
  { op: 'set', glyph: 'Set', title: 'Set value' },
];

/** Module-level element class with the handle getter as an INSTANCE
 *  property (assigned via litToolPanel's setup hook): one stable tag
 *  serves every grid. customElements.define is permanent, so per-grid
 *  classes/tags would grow the registry forever and pin each grid's
 *  closures past destroy(). */
class SmartEditPanel extends CgcPanelElement {
  /** Grid-specific bridge accessor — assigned per instance. */
  getHandle: (() => EditBridgeHandle | undefined) | undefined;

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
        font-family: var(--vg-font-family);
        font-size: var(--vg-font-size-sm);
        color: var(--vg-fg-color);
        background: color-mix(in srgb, var(--vg-fg-color) 5%, transparent);
        border: 1px solid var(--vg-border-color);
        border-radius: 4px;
        cursor: pointer;
      }
      .ops button[aria-pressed='true'] {
        background: color-mix(in srgb, var(--cgc-accent) 22%, transparent);
        border-color: var(--cgc-accent);
      }
      .ops button:focus-visible {
        outline: 2px solid var(--vg-focus-ring-color);
        outline-offset: 1px;
      }
      .empty {
        padding: 10px 12px;
        font-size: var(--vg-font-size-sm);
        color: color-mix(in srgb, var(--vg-fg-color) 55%, transparent);
      }
    `];

    private get settings(): SmartEditSettings | null {
      return this.getHandle?.()?.getSettings().smartEdit ?? null;
    }

    private patch(partial: Partial<SmartEditSettings>): void {
      this.getHandle?.()?.updateSettings({ smartEdit: partial });
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
          ${switchRow({
            label: 'Enabled', hint: 'Smart-edit toolbar + gestures',
            value: s.enabled, defaultValue: d.enabled,
            onChange: (v) => this.patch({ enabled: v }),
          })}
          ${numberRow({
            label: 'Increment step', hint: '± nudge amount', step: 0.0001,
            value: s.incrementStep, defaultValue: d.incrementStep,
            onChange: (v) => this.patch({ incrementStep: v }),
          })}
          ${switchRow({
            label: 'K/M/B shortcuts', hint: '1.5M parses as 1,500,000',
            value: s.magnitudeShortcutsEnabled, defaultValue: d.magnitudeShortcutsEnabled,
            onChange: (v) => this.patch({ magnitudeShortcutsEnabled: v }),
          })}
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
          ${numberRow({
            label: 'Confirm above', hint: 'cells · 0 = never ask',
            value: s.confirmThreshold, defaultValue: d.confirmThreshold,
            onChange: (v) => this.patch({ confirmThreshold: v }),
          })}
          ${switchRow({
            label: 'Single column', hint: 'Targets must share one column',
            value: s.enforceSingleColumn, defaultValue: d.enforceSingleColumn,
            onChange: (v) => this.patch({ enforceSingleColumn: v }),
          })}
          ${switchRow({
            label: 'Preview before apply',
            value: s.previewBeforeApply, defaultValue: d.previewBeforeApply,
            onChange: (v) => this.patch({ previewBeforeApply: v }),
          })}
          ${switchRow({
            label: 'Record history', hint: 'Journal entries for undo',
            value: s.recordHistory, defaultValue: d.recordHistory,
            onChange: (v) => this.patch({ recordHistory: v }),
          })}
        </cgc-band>
      `;
    }
  }

export function smartEditToolPanel(getHandle: () => EditBridgeHandle | undefined): new () => ToolPanel {
  return litToolPanel('cgc-smart-edit-panel', SmartEditPanel, (el) => {
    (el as SmartEditPanel).getHandle = getHandle;
  });
}
