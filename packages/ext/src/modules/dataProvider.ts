/**
 * Opt-in Data provider settings module — catalog list, active selection
 * (persisted via StateModule `data-provider`), and ProviderEditor shell.
 *
 * Host: `extensions: [dataProviderModule({ catalog, inProcess })]`
 * Custom transports: `registerTransportPlugin(...)` in app + worker entry.
 */
import {
  mountProviderEditor,
  type ConfigBackend,
  type ProviderEditor,
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
.vgext-dp__editor { flex: 1; min-height: 280px; overflow: auto; }
.vgext-dp__hint {
  font-size: 11px;
  color: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
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

function syncEditorPreview(editor: ProviderEditor | null, controller: DataProviderController): void {
  const provider = controller.getProvider();
  if (!editor || !provider) return;
  editor.setPreview(provider.getStatus(), [...provider.getData()].slice(0, 5));
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

      const row = document.createElement('div');
      row.className = 'vgext-dp__row';
      const lab = document.createElement('label');
      lab.textContent = 'Active provider';
      const sel = document.createElement('select');
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'primary';
      applyBtn.textContent = 'Apply';
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.textContent = 'Refresh list';
      row.append(lab, sel, applyBtn, refreshBtn);
      root.appendChild(row);

      const hint = document.createElement('div');
      hint.className = 'vgext-dp__hint';
      hint.textContent = 'Apply saves the editor form, starts the hub feed, and binds the grid.';
      root.appendChild(hint);

      const editorHost = document.createElement('div');
      editorHost.className = 'vgext-dp__editor';
      root.appendChild(editorHost);

      let editor: ProviderEditor | null = null;
      let previewOff: (() => void) | null = null;
      const catalog: ConfigBackend = controller.getCatalog();

      const wirePreview = (): void => {
        previewOff?.();
        previewOff = null;
        const provider = controller.getProvider();
        if (!editor || !provider) return;
        syncEditorPreview(editor, controller);
        const offs = [
          provider.onStatus(() => syncEditorPreview(editor, controller)),
          provider.onSnapshotData(() => syncEditorPreview(editor, controller)),
          provider.onRowsReceived(() => syncEditorPreview(editor, controller)),
        ];
        previewOff = () => offs.forEach((fn) => fn());
      };

      const rebuildSelect = async (): Promise<void> => {
        const list = await catalog.list();
        const active = controller.getActiveProviderId();
        sel.replaceChildren();
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '(none)';
        sel.appendChild(none);
        for (const p of list) {
          const opt = document.createElement('option');
          opt.value = p.providerId;
          opt.textContent = `${p.name} (${p.providerId})`;
          if (p.providerId === active) opt.selected = true;
          sel.appendChild(opt);
        }
        if (active) sel.value = active;
        else if (!sel.value && list[0]) sel.value = list[0].providerId;
      };

      const remountEditor = async (): Promise<void> => {
        editor?.destroy();
        editorHost.replaceChildren();
        const selectedId = sel.value || controller.getActiveProviderId();
        const initial = selectedId ? (await catalog.get(selectedId)) ?? undefined : undefined;
        editor = mountProviderEditor({
          mount: editorHost,
          backend: catalog,
          initial: initial ?? undefined,
          onChange: () => ctx.profiles.markDirty(),
          onSave: async (cfg) => {
            await controller.saveDefinition(cfg);
            await rebuildSelect();
            sel.value = cfg.providerId;
            wirePreview();
          },
        });
        wirePreview();
      };

      applyBtn.addEventListener('click', () => {
        void (async () => {
          applyBtn.disabled = true;
          try {
            // Persist the form the user is looking at, then activate that id.
            if (editor) {
              const draft = editor.getConfig();
              await catalog.save(draft);
              sel.value = draft.providerId;
            }
            const id = sel.value || null;
            await controller.setActiveProvider(id, { force: true });
            await rebuildSelect();
            await remountEditor();
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
      refreshBtn.addEventListener('click', () => { void rebuildSelect(); });
      sel.addEventListener('change', () => { void remountEditor(); });

      void (async () => {
        await rebuildSelect();
        await remountEditor();
      })();

      return {
        destroy() {
          previewOff?.();
          previewOff = null;
          editor?.destroy();
          editor = null;
          host.replaceChildren();
        },
        refresh() {
          void rebuildSelect();
          wirePreview();
        },
      };
    },
  };
}

export { DataProviderController };
export type { DataProviderControllerOptions, DataProviderStateSlice } from './dataProviderController';
