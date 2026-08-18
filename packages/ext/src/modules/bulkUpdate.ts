/**
 * Bulk Update — Customize sheet flat settings (starui customizer-ui #10).
 * Phase 4: Settings / Advanced tabs + workflow link to Edit History.
 */
import type { BulkUpdateSettings } from '@wellsfargo-starui/velocity-grid-edit';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import {
  band, el, injectCockpitStyles, lucideSvg, numberInput, row, switchToggleEnhanced,
  actionButtonEnhanced, resetButtonEnhanced, engineMissingNotice, animateSaveButton,
  createSettingsAdvancedTabs, markBandComplexity, appendBandsByComplexity,
  workflowLink, workflowStrip,
} from '../ui/cockpit';
import { clone, editHandle } from './editHandle';

export function bulkUpdateModule(): SettingsModule {
  return {
    id: 'bulk-update',
    kind: 'settings-module',
    title: 'Bulk Update',
    icon: 'replace',
    category: 'editing',

    init(): void { injectCockpitStyles(); },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      let committed: BulkUpdateSettings | null = null;
      let draft: BulkUpdateSettings | null = null;
      let saveBtn: HTMLButtonElement | null = null;
      const root = el('div', 'ckp ckp-flat');
      host.appendChild(root);

      const load = (): void => {
        const h = editHandle(ctx);
        if (!h) { committed = null; draft = null; return; }
        committed = clone(h.getSettings().bulkUpdate);
        draft = clone(committed);
      };

      const isDirty = (): boolean =>
        !!draft && !!committed && JSON.stringify(draft) !== JSON.stringify(committed);

      const save = (): void => {
        const h = editHandle(ctx);
        if (!h || !draft || !saveBtn) return;
        h.updateSettings({ bulkUpdate: clone(draft) });
        h.updateSettings({ history: { recordSources: { bulkUpdate: draft.recordHistory } } });
        ctx.profiles.markDirty();
        committed = clone(draft);
        animateSaveButton(saveBtn, () => render());
      };

      const reset = (): void => {
        if (!committed) return;
        draft = clone(committed);
        render();
      };

      const render = (): void => {
        root.replaceChildren();
        if (!draft) {
          root.appendChild(engineMissingNotice('edit', {
            feature: 'Bulk Update', icon: 'replace',
          }));
          return;
        }
        const d = draft;
        const head = el('div', 'ckp-pane-head');
        const title = el('div', 'ckp-title', 'Bulk Update');
        saveBtn = actionButtonEnhanced('Save', 'save');
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        const resetBtn = resetButtonEnhanced('Reset', 'rotate-ccw');
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
        head.append(title, saveBtn, resetBtn);
        root.appendChild(head);

        root.appendChild(workflowStrip([
          workflowLink({
            label: 'View audit trail',
            hint: 'See bulk updates in Edit History',
            icon: 'history',
            moduleId: 'data-change-history',
            events: ctx.events,
            lucideSvg,
          }),
        ]));

        const g = band('Global');
        markBandComplexity(g, 'basic');
        g.body.append(
          row('Enabled', switchToggleEnhanced(d.enabled, (v) => { d.enabled = v; render(); })),
          row('Confirm threshold', numberInput(d.confirmThreshold, (v) => {
            if (v === undefined) return;
            d.confirmThreshold = Math.max(0, Math.floor(v));
            render();
          }), '0 = never'),
          row('Single column', switchToggleEnhanced(d.enforceSingleColumn, (v) => {
            d.enforceSingleColumn = v;
            render();
          })),
        );

        const history = band('History');
        markBandComplexity(history, 'advanced');
        history.body.append(
          row('Record history', switchToggleEnhanced(d.recordHistory, (v) => {
            d.recordHistory = v;
            render();
          }), 'Logs operations to the undo/redo journal'),
        );

        const drop = band('Dropdown');
        markBandComplexity(drop, 'advanced');
        drop.body.append(
          row('Distinct values', switchToggleEnhanced(d.showDistinctValues, (v) => {
            d.showDistinctValues = v;
            render();
          })),
          row('Max dropdown', numberInput(d.maxDropdownValues, (v) => {
            if (v === undefined) return;
            d.maxDropdownValues = Math.max(1, Math.floor(v));
            render();
          })),
        );

        const settingsPane = el('div');
        const advancedPane = el('div');
        appendBandsByComplexity(settingsPane, advancedPane, [g, history, drop]);

        root.appendChild(createSettingsAdvancedTabs({
          settings: settingsPane,
          advanced: advancedPane,
          lucideSvg,
        }).root);
      };

      load();
      render();
      return {
        destroy() { root.replaceChildren(); root.remove(); },
        commit() { if (isDirty()) save(); },
        refresh() { load(); render(); },
      };
    },
  };
}
