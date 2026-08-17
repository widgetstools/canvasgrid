/**
 * Smart Edit — Customize sheet flat settings (starui customizer-ui #09).
 * GLOBAL / OPERATIONS / SAFETY bands; Done commits via edit handle.
 */
import type { SmartEditOp, SmartEditSettings } from '@wellsfargo-starui/velocity-grid-edit';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import {
  band, el, injectCockpitStyles, lucideSvg, numberInput, row, switchToggle, switchToggleEnhanced,
  actionButtonEnhanced, resetButtonEnhanced, engineMissingNotice, animateSaveButton,
  createTabGroup,
} from '../ui/cockpit';
import { clone, editHandle } from './editHandle';

const OPS: Array<{ op: SmartEditOp; label: string }> = [
  { op: 'multiply', label: '×' },
  { op: 'divide', label: '÷' },
  { op: 'add', label: '+' },
  { op: 'subtract', label: '−' },
  { op: 'set', label: 'Set' },
];

export function smartEditModule(): SettingsModule {
  return {
    id: 'smart-edit',
    kind: 'settings-module',
    title: 'Smart Edit',
    icon: 'sparkles',
    category: 'editing',

    init(): void { injectCockpitStyles(); },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      let committed: SmartEditSettings | null = null;
      let draft: SmartEditSettings | null = null;
      const root = el('div', 'ckp ckp-flat');
      host.appendChild(root);

      const load = (): void => {
        const h = editHandle(ctx);
        if (!h) { committed = null; draft = null; return; }
        committed = clone(h.getSettings().smartEdit);
        draft = clone(committed);
      };

      const isDirty = (): boolean =>
        !!draft && !!committed && JSON.stringify(draft) !== JSON.stringify(committed);

      let saveBtn: HTMLButtonElement | null = null;

      const save = (): void => {
        const h = editHandle(ctx);
        if (!h || !draft || !saveBtn) return;
        h.updateSettings({ smartEdit: clone(draft) });
        // Keep Edit History recordSources in sync with feature-level flag.
        h.updateSettings({ history: { recordSources: { smartEdit: draft.recordHistory } } });
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
            feature: 'Smart Edit', icon: 'pencil',
          }));
          return;
        }
        const d = draft;

        // Header (sticky, outside tabs)
        const head = el('div', 'ckp-pane-head');
        const title = el('div', 'ckp-title', 'Smart Edit');
        saveBtn = actionButtonEnhanced('Save', 'save');
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        const resetBtn = resetButtonEnhanced('Reset', 'rotate-ccw');
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
        head.append(title, saveBtn, resetBtn);
        root.appendChild(head);

        // Settings Tab Content
        const settingsPane = el('div');
        const g = band('Global');
        g.body.append(
          row('Enabled', switchToggleEnhanced(d.enabled, (v) => { d.enabled = v; render(); })),
          row('Increment step', numberInput(d.incrementStep, (v) => {
            if (v === undefined) return;
            d.incrementStep = v;
            render();
          })),
          row('K/M/B shortcuts', switchToggleEnhanced(d.magnitudeShortcutsEnabled, (v) => {
            d.magnitudeShortcutsEnabled = v;
            render();
          }), 'Parse K/M/B suffixes in numeric cell editors'),
        );
        settingsPane.appendChild(g.root);

        const ops = band('Operations');
        const group = el('div', 'ckp-pills');
        for (const { op, label } of OPS) {
          const on = d.enabledOps.includes(op);
          const b = el('button', `ckp-pill${on ? ' on' : ''}`, label) as HTMLButtonElement;
          b.type = 'button';
          b.title = op;
          b.addEventListener('click', () => {
            const set = new Set(d.enabledOps);
            if (set.has(op)) {
              if (set.size <= 1) return; // keep at least one
              set.delete(op);
            } else set.add(op);
            d.enabledOps = OPS.map((o) => o.op).filter((o) => set.has(o));
            render();
          });
          group.appendChild(b);
        }
        ops.body.append(row('Toolbar ops', group));
        settingsPane.appendChild(ops.root);

        // Advanced Tab Content
        const advancedPane = el('div');
        const safety = band('Safety');
        safety.body.append(
          row('Confirm above N', numberInput(d.confirmThreshold, (v) => {
            if (v === undefined) return;
            d.confirmThreshold = Math.max(0, Math.floor(v));
            render();
          }), '0 = never'),
          row('Single column', switchToggleEnhanced(d.enforceSingleColumn, (v) => {
            d.enforceSingleColumn = v;
            render();
          })),
          row('Preview before', switchToggleEnhanced(d.previewBeforeApply, (v) => {
            d.previewBeforeApply = v;
            render();
          })),
          row('Record history', switchToggleEnhanced(d.recordHistory, (v) => {
            d.recordHistory = v;
            render();
          }), 'Logs operations to the undo/redo journal'),
        );
        advancedPane.appendChild(safety.root);

        // Create tab group
        const tabGroup = createTabGroup([
          { id: 'settings', label: 'Settings', icon: 'sliders-horizontal', content: settingsPane },
          { id: 'advanced', label: 'Advanced', icon: 'cog', content: advancedPane },
        ], 'settings', lucideSvg);

        root.appendChild(tabGroup.root);
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
