/**
 * Cycle 21i Phase 2 / T7 — #10 Bulk Update settings panel.
 *
 * Flat settings panel over the @cgrid/edit engine's bulk-update slice,
 * per docs/starui-customizer-ui/10-bulk-update.md: GLOBAL (enabled /
 * confirm threshold / single column / record history) + DROPDOWN
 * (distinct values / max dropdown size). Same immediate-apply +
 * engine-owned persistence contract as the Smart Edit panel (#09) —
 * the second consumer proving the T5 chrome + row helpers are
 * actually reusable.
 */
import { html, css } from 'lit';
import type { ToolPanel } from '@cgrid/kernel';
import type { EditBridgeHandle, BulkUpdateSettings } from '@cgrid/edit';
import { DEFAULT_EDIT_SETTINGS } from '@cgrid/edit';
import { CgcPanelElement, litToolPanel } from '../litToolPanel';
import { chromeBase } from '../styles';
import { switchRow, numberRow } from './rows';

let tagCounter = 0;

export function bulkUpdateToolPanel(getHandle: () => EditBridgeHandle | undefined): new () => ToolPanel {
  class BulkUpdatePanel extends CgcPanelElement {
    static override styles = [chromeBase, css`
      :host {
        display: block;
      }
      .empty {
        padding: 10px 12px;
        font-size: var(--cg-font-size-sm);
        color: color-mix(in srgb, var(--cg-fg-color) 55%, transparent);
      }
    `];

    private get settings(): BulkUpdateSettings | null {
      return getHandle()?.getSettings().bulkUpdate ?? null;
    }

    private patch(partial: Partial<BulkUpdateSettings>): void {
      getHandle()?.updateSettings({ bulkUpdate: partial });
      this.requestUpdate();
    }

    override render() {
      const s = this.settings;
      if (!s) {
        return html`<div class="empty">Bulk Update engine is not wired — call wireEditIntoKernel(grid) first.</div>`;
      }
      const d = DEFAULT_EDIT_SETTINGS.bulkUpdate;
      return html`
        <cgc-band band-title="Global">
          ${switchRow({
            label: 'Enabled', hint: 'Bulk-update toolbar + gestures',
            value: s.enabled, defaultValue: d.enabled,
            onChange: (v) => this.patch({ enabled: v }),
          })}
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
            label: 'Record history', hint: 'Journal entries for undo',
            value: s.recordHistory, defaultValue: d.recordHistory,
            onChange: (v) => this.patch({ recordHistory: v }),
          })}
        </cgc-band>
        <cgc-band band-title="Dropdown">
          ${switchRow({
            label: 'Distinct values', hint: 'Offer existing column values',
            value: s.showDistinctValues, defaultValue: d.showDistinctValues,
            onChange: (v) => this.patch({ showDistinctValues: v }),
          })}
          ${numberRow({
            label: 'Max dropdown', hint: 'values shown', min: 1,
            value: s.maxDropdownValues, defaultValue: d.maxDropdownValues,
            onChange: (v) => this.patch({ maxDropdownValues: v }),
          })}
        </cgc-band>
      `;
    }
  }

  return litToolPanel(`cgc-bulk-update-panel-${tagCounter++}`, BulkUpdatePanel);
}
