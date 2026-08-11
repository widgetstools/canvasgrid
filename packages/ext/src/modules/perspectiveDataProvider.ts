/**
 * Opt-in Perspective SSRM data-provider settings module.
 *
 * Same Customize panel + **real** DataProvider editor popout as
 * `dataProviderModule`. Apply maps the catalog STOMP config onto
 * `StompPerspectiveProvider` (SSRM) instead of the hub CSRM bind path.
 */
import {
  openProviderEditorPopout,
  type ConfigBackend,
} from '@wellsfargo-starui/velocity-grid-data';
import {
  PerspectiveDataProviderController,
  type PerspectiveDataProviderControllerOptions,
} from '@wellsfargo-starui/velocity-grid-perspective';
import type { ModuleInstance, SettingsModule, VelocityGridExtContext } from '../extension/types';

export type PerspectiveDataProviderModuleOptions = PerspectiveDataProviderControllerOptions & {
  controller?: PerspectiveDataProviderController;
};

/* Same chrome as hub dataProviderModule. */
const STYLE = `
.vgext-dp {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  color: var(--vg-fg-color, #1a1f24);
}
.vgext-dp__section-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vg-fg-color, #1a1f24);
}
.vgext-dp__section-title::after {
  content: "";
  flex: 1 1 auto;
  height: 1px;
  background: var(--vg-border-color, #c5d0d8);
}
.vgext-dp__row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.vgext-dp__row label {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
}
.vgext-dp__row select {
  flex: 1;
  min-width: 160px;
  font: inherit;
  font-size: 12px;
  padding: 7px 10px;
  border: 1px solid var(--vg-border-color, #c5d0d8);
  border-radius: var(--vg-radius, 2px);
  background: var(--vg-input-bg, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 3%, transparent));
  color: var(--vg-fg-color, #1a1f24);
  color-scheme: inherit;
  cursor: pointer;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vgext-dp__row select:hover {
  border-color: color-mix(in srgb, var(--vg-muted-fg-color, #8a93a6) 45%, var(--vg-border-color, #c5d0d8));
}
.vgext-dp__row select:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 70%, var(--vg-border-color, #c5d0d8));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 16%, transparent);
}
.vgext-dp__row button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 7px 12px;
  border: 1px solid transparent;
  border-radius: var(--vg-radius, 2px);
  background: transparent;
  color: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
  cursor: pointer;
  transition: color 110ms ease, background 110ms ease, border-color 110ms ease;
}
.vgext-dp__row button:hover:not(:disabled) {
  color: var(--vg-fg-color, #1a1f24);
  background: color-mix(in srgb, var(--vg-fg-color, #1a1f24) 6%, transparent);
  border-color: var(--vg-border-color, #c5d0d8);
}
.vgext-dp__row button.primary {
  color: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
  background: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
  border-color: transparent;
}
.vgext-dp__row button.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.vgext-dp__row button:disabled {
  opacity: 0.5;
  cursor: default;
}
.vgext-dp__hint {
  font-size: 11px;
  color: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
  line-height: 1.45;
}
`;

let stylesInjected = false;
function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector('style[data-vgext-psp-dp]');
  if (existing) {
    existing.textContent = STYLE;
    stylesInjected = true;
    return;
  }
  if (stylesInjected) return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-vgext-psp-dp', '');
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function perspectiveDataProviderModule(
  opts?: PerspectiveDataProviderModuleOptions,
): SettingsModule {
  const controller = opts?.controller ?? new PerspectiveDataProviderController(opts);

  return {
    id: 'perspective-data-provider',
    kind: 'settings-module',
    title: 'Data provider',
    icon: 'database',
    category: 'data',

    init(ctx: VelocityGridExtContext): void {
      controller.attach(ctx as never);
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
      lab.htmlFor = 'vgext-psp-dp-active';
      const sel = document.createElement('select');
      sel.id = 'vgext-psp-dp-active';
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
        'Apply attaches a View on the shared DataProvider book (SSRM). '
        + 'Multiple grids can use the same provider — each gets its own View; '
        + 'the DataProvider owns the table. Author connection / columns in the editor.';
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
            if (!id) {
              hint.textContent = 'Cleared active provider · selection saved for next load.';
            } else {
              hint.textContent =
                `Applied “${id}” · Perspective SSRM bound · selection saved for next load.`;
            }
          } catch (err) {
            console.error('[velocity-grid-ext] Apply Perspective provider failed', err);
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

export { PerspectiveDataProviderController };
