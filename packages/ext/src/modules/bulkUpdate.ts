/**
 * Bulk Update — Customize sheet flat settings (starui customizer-ui #10).
 */
import type { BulkUpdateSettings } from '@wellsfargo-starui/velocity-grid-edit';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import {
  band, el, injectCockpitStyles, lucideSvg, numberInput, row, checkbox, engineMissingNotice,
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
        if (!h || !draft) return;
        h.updateSettings({ bulkUpdate: clone(draft) });
        h.updateSettings({ history: { recordSources: { bulkUpdate: draft.recordHistory } } });
        ctx.profiles.markDirty();
        committed = clone(draft);
        render();
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
        const saveBtn = el('button', 'ckp-actbtn') as HTMLButtonElement;
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        const resetBtn = el('button', 'ckp-actbtn ckp-btn-secondary') as HTMLButtonElement;
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
        head.append(title, saveBtn, resetBtn);
        root.appendChild(head);

        const body = el('div', 'ckp-flat-body');

        const g = band('Global');
        g.body.append(
          row('Enabled', checkbox(d.enabled, (v) => { d.enabled = v; render(); })),
          row('Confirm threshold', numberInput(d.confirmThreshold, (v) => {
            if (v === undefined) return;
            d.confirmThreshold = Math.max(0, Math.floor(v));
            render();
          }), '0 = never'),
          row('Single column', checkbox(d.enforceSingleColumn, (v) => {
            d.enforceSingleColumn = v;
            render();
          })),
          row('Record history', checkbox(d.recordHistory, (v) => {
            d.recordHistory = v;
            render();
          }), 'Logs operations to the undo/redo journal'),
        );
        body.appendChild(g.root);

        const drop = band('Dropdown');
        drop.body.append(
          row('Distinct values', checkbox(d.showDistinctValues, (v) => {
            d.showDistinctValues = v;
            render();
          })),
          row('Max dropdown', numberInput(d.maxDropdownValues, (v) => {
            if (v === undefined) return;
            d.maxDropdownValues = Math.max(1, Math.floor(v));
            render();
          })),
        );
        body.appendChild(drop.root);
        root.appendChild(body);
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
