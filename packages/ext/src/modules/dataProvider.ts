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

/**
 * DATA-tab provider panel chrome. Speaks the same language as the rest of the
 * customize drawer: one eyebrow spec for the section head, sentence-case row
 * labels, the four-rung button ladder, 28px controls, and read-only state
 * chips. Every value comes from the ext chrome tokens in `ui/chromeTokens.ts`.
 *
 * Shared: `perspectiveDataProviderModule` renders the same panel for SSRM and
 * used to carry a byte-for-byte copy of this sheet, so the two drifted apart
 * on every edit. One stylesheet, two modules.
 */
export const DATA_PANEL_STYLE = `
.vgext-dp {
  display: flex;
  flex-direction: column;
  gap: var(--vgext-space-4, 16px);
  height: 100%;
  min-height: 0;
  color: var(--vg-fg-color, #1a1f24);
}
.vgext-dp__section-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--vgext-space-3, 12px);
  font-size: var(--vgext-eyebrow-size, 11px);
  font-weight: var(--vgext-eyebrow-weight, 600);
  letter-spacing: var(--vgext-eyebrow-track, 0.1em);
  text-transform: uppercase;
  color: var(--vg-muted-fg-color, #8a93a6);
}
.vgext-dp__section-title::after {
  content: "";
  flex: 1 1 auto;
  height: 1px;
  background: var(--vg-line-divider, var(--vg-border-color, #c5d0d8));
}
.vgext-dp__row { display: flex; flex-wrap: wrap; gap: var(--vgext-space-2, 8px); align-items: center; }
/* Sentence-case row label, matching every other settings row in the drawer.
 * It used to be a second uppercase eyebrow sitting inline with the control,
 * which made the section head and the field label read as the same rank. */
.vgext-dp__row label {
  font-size: var(--vgext-label-size, 12.5px);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--vg-fg-color, #1a1f24);
}
.vgext-dp__row select {
  flex: 1;
  min-width: 160px;
  font: inherit;
  font-size: 12px;
  height: var(--vgext-control-h, 28px);
  padding: 0 var(--vgext-field-px, 10px);
  border: 1px solid var(--vg-line-control, var(--vg-border-color, #c5d0d8));
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
  border-color: color-mix(in srgb, var(--vg-chrome-accent) 70%, var(--vg-border-color, #c5d0d8));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-chrome-accent) 16%, transparent);
}
/* Button ladder. Apply, Edit, Manage and Refresh used to render as four
 * bare uppercase words with no border, background or hover box — three of
 * them read as labels rather than controls, and nothing separated the one
 * that swaps the grid's data source from the one that only re-reads it.
 * Base is now the Secondary rung; .primary is the Primary rung. */
.vgext-dp__row button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--vgext-space-1, 4px);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  height: var(--vgext-control-h, 28px);
  padding: 0 var(--vgext-control-px, 13px);
  border: 1px solid var(--vg-border-color, #c5d0d8);
  border-radius: var(--vg-radius, 2px);
  background: transparent;
  color: var(--vg-fg-color, #1a1f24);
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--vgext-t, 120ms ease), background var(--vgext-t, 120ms ease), border-color var(--vgext-t, 120ms ease);
}
.vgext-dp__row button:hover:not(:disabled) {
  color: var(--vg-fg-color, #1a1f24);
  background: var(--vg-row-hover-bg, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 6%, transparent));
  border-color: var(--vg-chrome-accent);
}
.vgext-dp__row button:focus-visible {
  outline: 2px solid var(--vg-chrome-accent);
  outline-offset: -2px;
}
.vgext-dp__row button.quiet {
  border-color: transparent;
  background: transparent;
  color: var(--vg-muted-fg-color, #8a93a6);
}
.vgext-dp__row button.quiet:hover:not(:disabled) {
  color: var(--vg-fg-color, #1a1f24);
  border-color: transparent;
}
.vgext-dp__row button.primary {
  color: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
  background: var(--vg-primary-color, var(--vg-chrome-accent));
  border-color: var(--vg-primary-color, var(--vg-chrome-accent));
  font-weight: 600;
}
.vgext-dp__row button.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.vgext-dp__row button:disabled {
  opacity: 0.45;
  cursor: default;
}
/* Help sits under the label it explains and stops at a readable measure,
 * instead of running the full width of the drawer under the whole row. */
.vgext-dp__hint {
  font-size: var(--vgext-help-size, 11px);
  color: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
  line-height: 1.45;
  max-width: 62ch;
}
/* Live connection state. Read-only chips: a chip never appears above a
 * control that sets the same value. */
.vgext-dp__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vgext-space-2, 8px);
}
.vgext-dp__state {
  display: inline-flex;
  align-items: center;
  gap: var(--vgext-space-2, 8px);
  height: var(--vgext-chip-h, 20px);
  padding: 0 8px;
  border-radius: var(--vg-radius, 2px);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  background: color-mix(in srgb, var(--vg-fg-color, #1a1f24) 8%, transparent);
  color: var(--vg-fg-color, #1a1f24);
}
.vgext-dp__state.is-live { background: color-mix(in srgb, var(--vg-pos-color, #3FA266) 16%, transparent); }
.vgext-dp__state.is-stale { background: color-mix(in srgb, var(--vg-warning-color, #f0b429) 16%, transparent); }
.vgext-dp__state.is-error { background: color-mix(in srgb, var(--vg-neg-color, #e5646e) 16%, transparent); }
.vgext-dp__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--vgext-chip-h, 20px);
  padding: 0 8px;
  border-radius: var(--vg-radius, 2px);
  background: color-mix(in srgb, var(--vg-fg-color, #1a1f24) 6%, transparent);
  font-family: var(--vg-cell-font-family, ui-monospace, monospace);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.vgext-dp__chip-key { color: var(--vg-muted-fg-color, #8a93a6); }
.vgext-dp__chip-val { color: var(--vg-fg-color, #1a1f24); font-weight: 600; }
.vgext-dp__status-empty,
.vgext-dp__status-error {
  font-size: var(--vgext-help-size, 11px);
  line-height: 1.45;
}
.vgext-dp__status-empty { color: var(--vg-muted-fg-color, #8a93a6); }
.vgext-dp__status-error { color: var(--vg-neg-color, #e5646e); }
`;

let stylesInjected = false;
function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector('style[data-vgext-dp]');
  if (existing) {
    existing.textContent = DATA_PANEL_STYLE;
    stylesInjected = true;
    return;
  }
  if (stylesInjected) return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-vgext-dp', '');
  el.textContent = DATA_PANEL_STYLE;
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
      // One primary per surface, and the rest ranked by what they cost to
      // undo: Apply swaps the grid's data source (primary), Edit opens the
      // authoring surface (secondary), Manage browses the catalog (quiet).
      manageBtn.className = 'quiet';
      manageBtn.textContent = 'Manage…';
      manageBtn.title = 'Open the catalog editor (all providers)';
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.textContent = 'Refresh';
      row.append(lab, sel, applyBtn, editBtn, manageBtn, refreshBtn);
      root.appendChild(row);

      // Two sentences of prose used to carry what a field hint and a
      // button tooltip should, and the panel's most important line — the
      // live connection state — sat underneath them. The hint is now one
      // clause; the tooltips carry the rest; the state goes first.
      const hint = document.createElement('div');
      hint.className = 'vgext-dp__hint';
      hint.textContent = 'Connection, fields and columns are authored in the shared editor.';
      applyBtn.title = 'Attach the selected catalog provider to this grid';

      // ── Live connection state ────────────────────────────────────────
      // The panel whose whole subject is the data connection reported no
      // connection state at all: with the broker refused it looked exactly
      // like a quiet book. `getStatus()`/`onStatus()` already existed on the
      // provider — this just surfaces them, and keeps surfacing them.
      const statusRow = document.createElement('div');
      statusRow.className = 'vgext-dp__status';
      statusRow.setAttribute('role', 'status');
      // Directly under the section title, above the controls: the panel
      // whose whole subject is the data connection leads with the state of
      // that connection.
      root.insertBefore(statusRow, row);
      root.appendChild(hint);

      /** ProviderStatus → the chrome's three-colour state vocabulary. */
      const STATE_TONE: Record<string, 'live' | 'stale' | 'error' | 'idle'> = {
        ready: 'live',
        snapshot: 'stale',
        connecting: 'stale',
        idle: 'idle',
        error: 'error',
        disconnected: 'error',
      };
      const STATE_LABEL: Record<string, string> = {
        ready: 'Live',
        snapshot: 'Loading snapshot',
        connecting: 'Connecting',
        idle: 'Idle',
        error: 'Error',
        disconnected: 'Disconnected',
      };

      const chip = (key: string, value: string): HTMLElement => {
        const c = document.createElement('span');
        c.className = 'vgext-dp__chip';
        const k = document.createElement('span');
        k.className = 'vgext-dp__chip-key';
        k.textContent = key;
        const v = document.createElement('span');
        v.className = 'vgext-dp__chip-val';
        v.textContent = value;
        c.append(k, v);
        return c;
      };

      let offStatus: (() => void) | undefined;
      /** providerId → transport, harvested as the select is built. The
       *  catalog reads asynchronously, so the status paint — which runs on
       *  every tick of the connection — cannot ask it directly. */
      const providerTypeById = new Map<string, string>();

      const paintStatus = (status?: string, error?: string): void => {
        const provider = controller.getProvider();
        const activeId = controller.getActiveProviderId();
        statusRow.replaceChildren();
        if (!activeId || !provider) {
          const empty = document.createElement('span');
          empty.className = 'vgext-dp__status-empty';
          empty.textContent = 'No provider attached — choose one above and Apply.';
          statusRow.appendChild(empty);
          return;
        }
        let s = status;
        if (!s) {
          try { s = provider.getStatus(); } catch { s = undefined; }
        }
        const tone = STATE_TONE[s ?? ''] ?? 'idle';
        const state = document.createElement('span');
        state.className = `vgext-dp__state is-${tone}`;
        const dot = document.createElement('span');
        dot.className = 'vgext-state-dot';
        dot.dataset.state = tone;
        const label = document.createElement('span');
        label.textContent = STATE_LABEL[s ?? ''] ?? 'Unknown';
        state.append(dot, label);
        statusRow.appendChild(state);

        let rows = 0;
        try { rows = provider.getData().length; } catch { rows = 0; }
        statusRow.appendChild(chip('rows', rows.toLocaleString()));
        statusRow.appendChild(chip('provider', activeId));
        // Every ProviderStatus already mapped to a tone and a label; what
        // was missing was a place for each to say something useful. The
        // transport is what distinguishes an idle websocket from an idle
        // REST poll, and it is the first thing anyone asks about a feed.
        const providerType = providerTypeById.get(activeId);
        if (providerType) statusRow.appendChild(chip('type', providerType));
        if (error) {
          const err = document.createElement('span');
          err.className = 'vgext-dp__status-error';
          err.textContent = error;
          statusRow.appendChild(err);
        }
      };

      /** Re-point the live subscription at whatever provider is active now. */
      const bindStatus = (): void => {
        offStatus?.();
        offStatus = undefined;
        const provider = controller.getProvider();
        if (provider && typeof provider.onStatus === 'function') {
          try {
            offStatus = provider.onStatus((s, err) => paintStatus(s, err));
          } catch { /* provider without live status — polled paint still works */ }
        }
        paintStatus();
      };

      const catalog: ConfigBackend = controller.getCatalog();

      const rebuildSelect = async (): Promise<void> => {
        const list = await catalog.list();
        const active = controller.getActiveProviderId();
        sel.replaceChildren();
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '— None —';
        sel.appendChild(none);
        providerTypeById.clear();
        for (const p of list) {
          const opt = document.createElement('option');
          opt.value = p.providerId;
          opt.textContent = `${p.name} (${p.providerType})`;
          if (p.providerId === active) opt.selected = true;
          sel.appendChild(opt);
          if (p.providerType) providerTypeById.set(p.providerId, String(p.providerType));
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
            if (!id) {
              hint.textContent = 'Cleared active provider · selection saved for next load.';
            } else {
              const p = controller.getProvider();
              const status = p?.getStatus() ?? '—';
              const rowsHint = String(p?.getData().length ?? 0);
              hint.textContent =
                `Applied “${id}” · ${status} · ${rowsHint} rows · selection saved for next load.`;
            }
            bindStatus();
          } catch (err) {
            console.error('[velocity-grid-ext] Apply data provider failed', err);
            hint.textContent = err instanceof Error ? err.message : String(err);
            paintStatus('error', err instanceof Error ? err.message : String(err));
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

      const onFocus = (): void => { void rebuildSelect(); paintStatus(); };
      window.addEventListener('focus', onFocus);

      void rebuildSelect();
      bindStatus();

      return {
        destroy() {
          window.removeEventListener('focus', onFocus);
          offStatus?.();
          offStatus = undefined;
          host.replaceChildren();
        },
        refresh() {
          void rebuildSelect();
          bindStatus();
        },
      };
    },
  };
}

export { DataProviderController };
export type { DataProviderControllerOptions, DataProviderStateSlice } from './dataProviderController';
