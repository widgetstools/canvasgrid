/**
 * Opt-in Data provider settings module — Markets-shaped Customize panel:
 * active provider selection only. Full authoring opens in a shared browser
 * popout (`openProviderEditorPopout`).
 *
 * Host: `extensions: [dataProviderModule({ catalog, inProcess })]`
 * Custom transports: `registerTransportPlugin(...)` in app + worker entry.
 */
import {
  openProviderEditorPopout,
  type ConfigBackend,
} from '@wellsfargo-starui/velocity-grid-data';
import type { ModuleInstance, SettingsModule, VelocityGridExtContext } from '../extension/types';
import {
  DataProviderController,
  type DataProviderControllerOptions,
} from './dataProviderController';

export type DataProviderModuleOptions = DataProviderControllerOptions & {
  /** Shared controller instance (advanced); otherwise one is created. */
  controller?: DataProviderController;
};

const STYLE = `
.vgext-dp {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  color: var(--vg-fg-color, #1a1f24);
}
.vgext-dp__section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.vgext-dp__row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.vgext-dp__row label {
  font-size: 12px;
  color: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
}
.vgext-dp__row select,
.vgext-dp__row button {
  font: inherit;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--vg-border-color, #c5d0d8);
  border-radius: var(--vg-radius, 2px);
  background: var(--vg-input-bg, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 3%, transparent));
  color: var(--vg-fg-color, #1a1f24);
  color-scheme: inherit;
  cursor: pointer;
}
.vgext-dp__row select {
  flex: 1;
  min-width: 160px;
}
.vgext-dp__row select:hover,
.vgext-dp__row button:hover {
  border-color: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
}
.vgext-dp__row button.primary {
  background: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
  color: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
  border-color: transparent;
}
.vgext-dp__row button.primary:hover {
  filter: brightness(1.08);
}
.vgext-dp__row button:disabled {
  opacity: 0.55;
  cursor: default;
}
.vgext-dp__hint {
  font-size: 11px;
  color: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
  line-height: 1.4;
}
`;

let stylesInjected = false;
function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector('style[data-vgext-dp]');
  if (existing) {
    existing.textContent = STYLE;
    stylesInjected = true;
    return;
  }
  if (stylesInjected) return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-vgext-dp', '');
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function dataProviderModule(opts?: DataProviderModuleOptions): SettingsModule {
  const controller = opts?.controller ?? new DataProviderController(opts);

  return {
    id: 'data-provider',
    kind: 'settings-module',
    title: 'Data provider',
    icon: 'database',
    category: 'data',

    init(ctx: VelocityGridExtContext): void {
      controller.attach(ctx);
    },

    dispose(): void {
      controller.detach();
    },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      ensureStyles();
      const root = document.createElement('div');
      root.className = 'vgext-dp';
      host.appendChild(root);

      const title = document.createElement('h3');
      title.className = 'vgext-dp__section-title';
      title.textContent = 'Active provider';
      root.appendChild(title);

      const row = document.createElement('div');
      row.className = 'vgext-dp__row';
      const lab = document.createElement('label');
      lab.textContent = 'Provider';
      lab.htmlFor = 'vgext-dp-active';
      const sel = document.createElement('select');
      sel.id = 'vgext-dp-active';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'primary';
      applyBtn.textContent = 'Apply';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit…';
      editBtn.title = 'Open the shared data-provider editor popout';
      const manageBtn = document.createElement('button');
      manageBtn.type = 'button';
      manageBtn.textContent = 'Manage…';
      manageBtn.title = 'Open the catalog editor (all providers)';
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.textContent = 'Refresh';
      row.append(lab, sel, applyBtn, editBtn, manageBtn, refreshBtn);
      root.appendChild(row);

      const hint = document.createElement('div');
      hint.className = 'vgext-dp__hint';
      hint.textContent =
        'Apply attaches the selected catalog provider to this grid. Author connection, fields, and columns in the shared editor popout.';
      root.appendChild(hint);

      const catalog: ConfigBackend = controller.getCatalog();

      const rebuildSelect = async (): Promise<void> => {
        const list = await catalog.list();
        const active = controller.getActiveProviderId();
        sel.replaceChildren();
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '— None —';
        sel.appendChild(none);
        for (const p of list) {
          const opt = document.createElement('option');
          opt.value = p.providerId;
          opt.textContent = `${p.name} (${p.providerType})`;
          if (p.providerId === active) opt.selected = true;
          sel.appendChild(opt);
        }
        if (active) sel.value = active;
      };

      const openEditor = (providerId: string | null): void => {
        const themeSource =
          host.closest<HTMLElement>('.vgext-root')
          ?? document.querySelector<HTMLElement>('.vgext-root')
          ?? document.querySelector<HTMLElement>('[class*="vg-theme-"]');
        const handle = openProviderEditorPopout({
          backend: catalog,
          providerId,
          themeSource,
          hubOpts: controller.getHubOpts(),
          onSaved: () => {
            void rebuildSelect();
            ctx.profiles.markDirty();
          },
          onClose: () => { void rebuildSelect(); },
        });
        if (!handle) {
          hint.textContent = 'Pop-up blocked — allow pop-ups for this origin, then try Edit / Manage again.';
        }
      };

      applyBtn.addEventListener('click', () => {
        void (async () => {
          applyBtn.disabled = true;
          try {
            const id = sel.value || null;
            await controller.setActiveProvider(id, { force: true });
            await rebuildSelect();
            hint.textContent = id
              ? `Applied “${id}” · status ${controller.getProvider()?.getStatus() ?? '—'} · rows ${controller.getProvider()?.getData().length ?? 0}`
              : 'Cleared active provider.';
          } catch (err) {
            console.error('[velocity-grid-ext] Apply data provider failed', err);
            hint.textContent = err instanceof Error ? err.message : String(err);
          } finally {
            applyBtn.disabled = false;
          }
        })();
      });

      editBtn.addEventListener('click', () => {
        openEditor(sel.value || controller.getActiveProviderId());
      });
      manageBtn.addEventListener('click', () => {
        openEditor(null);
      });
      refreshBtn.addEventListener('click', () => { void rebuildSelect(); });

      const onFocus = (): void => { void rebuildSelect(); };
      window.addEventListener('focus', onFocus);

      void rebuildSelect();

      return {
        destroy() {
          window.removeEventListener('focus', onFocus);
          host.replaceChildren();
        },
        refresh() {
          void rebuildSelect();
        },
      };
    },
  };
}

export { DataProviderController };
export type { DataProviderControllerOptions, DataProviderStateSlice } from './dataProviderController';
