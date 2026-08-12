import {
  el,
  mountBanner,
  mountButton,
  mountEmptyState,
  mountField,
  mountSelect,
  type Disposable,
} from '@wellsfargo-starui/vg-new-ui';
import type { ExtContext, SettingsModule } from './types';

function panel(title: string, body: (host: HTMLElement, ctx: ExtContext) => void): SettingsModule['mount'] {
  return (host, ctx) => {
    const root = el('div');
    root.appendChild(el('h3', undefined, title));
    root.querySelector('h3')!.style.cssText = 'margin:0 0 12px;font-size:14px;';
    body(root, ctx);
    host.appendChild(root);
    return { destroy() { root.remove(); } };
  };
}

function draftSavePanel(
  title: string,
  renderDraft: (host: HTMLElement, draft: { value: string }, ctx: ExtContext) => Disposable[],
): SettingsModule['mount'] {
  return (host, ctx) => {
    const root = el('div');
    root.appendChild(el('h3', undefined, title));
    (root.firstChild as HTMLElement).style.cssText = 'margin:0 0 12px;font-size:14px;';
    const draft = { value: '' };
    const dispos: Disposable[] = [];
    const body = el('div');
    root.appendChild(body);
    dispos.push(...renderDraft(body, draft, ctx));
    const footer = el('div');
    footer.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;';
    root.appendChild(footer);
    dispos.push(mountButton(footer, {
      label: 'Reset',
      variant: 'ghost',
      onClick: () => { draft.value = ''; ctx.markDirty(); },
    }));
    dispos.push(mountButton(footer, {
      label: 'Save',
      variant: 'primary',
      onClick: () => { ctx.session.setModuleSlice(title, { value: draft.value }); void ctx.session.save(); },
    }));
    host.appendChild(root);
    return {
      destroy() {
        for (const d of dispos) d.destroy();
        root.remove();
      },
    };
  };
}

export function buildDefaultModules(): SettingsModule[] {
  return [
    {
      id: 'grid-options',
      kind: 'settings',
      category: 'layout',
      label: 'Grid options',
      mount: panel('Grid options', (host, ctx) => {
        mountBanner(host, { text: 'Runtime options (row height, selection). Draft → Save.' });
        mountField(host, {
          label: 'Quick filter',
          value: ctx.gridApi.getQuickFilterText(),
          onChange: (v) => ctx.gridApi.setQuickFilterText(v),
        });
      }),
    },
    {
      id: 'column-groups',
      kind: 'settings',
      category: 'layout',
      label: 'Column groups',
      mount: panel('Column groups', (host) => {
        mountEmptyState(host, { title: 'Column groups', detail: 'Port of kernel groups editor (E-MOD-02).' });
      }),
    },
    {
      id: 'column-settings',
      kind: 'settings',
      category: 'layout',
      label: 'Column settings',
      mount: draftSavePanel('Column settings', (host, draft) => [
        mountField(host, {
          label: 'Caption',
          value: draft.value,
          onChange: (v) => { draft.value = v; },
        }),
      ]),
    },
    {
      id: 'data-provider',
      kind: 'settings',
      category: 'data',
      label: 'Data provider',
      mount: panel('Data provider', (host, ctx) => {
        mountBanner(host, {
          text: 'One panel for CSRM hub + Perspective bind strategies. Apply selects; Edit opens catalog popout.',
          tone: 'warn',
        });
        const select = mountSelect(host, {
          label: 'Provider',
          options: [
            { value: '', label: '(none)' },
            { value: 'positions-seed', label: 'positions-seed' },
            { value: 'positions-stomp', label: 'positions-stomp' },
          ],
          value: ctx.session.getDoc().gridLevelData?.activeProviderId ?? '',
          onChange: (v) => ctx.session.setActiveProviderId(v || undefined),
        });
        const actions = el('div');
        actions.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
        host.appendChild(actions);
        mountButton(actions, {
          label: 'Apply',
          variant: 'primary',
          onClick: () => {
            ctx.session.setActiveProviderId(select.getValue() || undefined);
            void ctx.session.save();
          },
        });
        mountButton(actions, {
          label: 'Edit…',
          onClick: () => {
            // Popout wired via vg-new-data openProviderEditorPopout
            window.dispatchEvent(new CustomEvent('vg-new:open-provider-editor'));
          },
        });
      }),
    },
    {
      id: 'calculated-columns',
      kind: 'settings',
      category: 'data',
      label: 'Calculated columns',
      mount: draftSavePanel('Calculated columns', (host, draft) => [
        mountField(host, {
          label: 'Expression',
          placeholder: 'pnl + dailyPnl',
          value: draft.value,
          onChange: (v) => { draft.value = v; },
        }),
      ]),
    },
    {
      id: 'conditional-styling',
      kind: 'settings',
      category: 'format',
      label: 'Conditional styling',
      mount: draftSavePanel('Conditional styling', (host, draft) => [
        mountField(host, {
          label: 'Rule expression',
          placeholder: 'pnl < 0',
          value: draft.value,
          onChange: (v) => { draft.value = v; },
        }),
      ]),
    },
    {
      id: 'alerts',
      kind: 'settings',
      category: 'format',
      label: 'Alerts',
      mount: panel('Alerts', (host) => {
        mountEmptyState(host, { title: 'Alerts', detail: 'Channels, frequency, kill-switch (E-MOD-05).' });
      }),
    },
    {
      id: 'smart-edit',
      kind: 'settings',
      category: 'editing',
      label: 'Smart edit',
      mount: draftSavePanel('Smart edit', (host, draft) => [
        mountSelect(host, {
          label: 'Operation',
          options: [
            { value: 'multiply', label: 'Multiply' },
            { value: 'add', label: 'Add' },
            { value: 'set', label: 'Set' },
          ],
          onChange: (v) => { draft.value = v; },
        }),
      ]),
    },
    {
      id: 'bulk-update',
      kind: 'settings',
      category: 'editing',
      label: 'Bulk update',
      mount: draftSavePanel('Bulk update', (host, draft) => [
        mountField(host, { label: 'Value', onChange: (v) => { draft.value = v; } }),
      ]),
    },
    {
      id: 'plus-minus',
      kind: 'settings',
      category: 'editing',
      label: 'Plus / minus',
      mount: panel('Plus / minus', (host) => {
        mountEmptyState(host, { title: 'Nudges', detail: 'Step sizes + expression gate (E-MOD-09).' });
      }),
    },
    {
      id: 'shortcuts',
      kind: 'settings',
      category: 'editing',
      label: 'Shortcuts',
      mount: panel('Shortcuts', (host) => {
        mountEmptyState(host, { title: 'Key bindings', detail: 'Letter → numeric op (E-MOD-10).' });
      }),
    },
    {
      id: 'data-change-history',
      kind: 'settings',
      category: 'editing',
      label: 'Edit history',
      mount: panel('Edit history', (host) => {
        mountEmptyState(host, { title: 'History', detail: 'Suspend / stream / undo (E-MOD-11).' });
      }),
    },
  ];
}
