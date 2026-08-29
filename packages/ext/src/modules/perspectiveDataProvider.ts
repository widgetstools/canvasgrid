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
import { DATA_PANEL_STYLE } from './dataProvider';

export type PerspectiveDataProviderModuleOptions = PerspectiveDataProviderControllerOptions & {
  controller?: PerspectiveDataProviderController;
};

/* Same chrome as the hub dataProviderModule — one shared stylesheet. */

let stylesInjected = false;
function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector('style[data-vgext-psp-dp]');
  if (existing) {
    existing.textContent = DATA_PANEL_STYLE;
    stylesInjected = true;
    return;
  }
  if (stylesInjected) return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-vgext-psp-dp', '');
  el.textContent = DATA_PANEL_STYLE;
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

      // ── Live feed state ──────────────────────────────────────────────
      // In SSRM an empty grid can mean loading, filtered to nothing, a dead
      // socket, or no provider applied — and the chrome rendered all four
      // identically. The book already publishes phase / size / rate; this
      // panel, whose subject IS the connection, now shows them.
      const statusRow = document.createElement('div');
      statusRow.className = 'vgext-dp__status';
      statusRow.setAttribute('role', 'status');
      root.appendChild(statusRow);

      /** BookPhase → the chrome's three-colour state vocabulary. */
      const PHASE_TONE: Record<string, 'live' | 'stale' | 'error' | 'idle'> = {
        live: 'live',
        snapshot: 'stale',
        connecting: 'stale',
        bootstrapping: 'stale',
        idle: 'idle',
        error: 'error',
        disconnected: 'error',
      };
      const PHASE_LABEL: Record<string, string> = {
        live: 'Live',
        snapshot: 'Loading snapshot',
        connecting: 'Connecting',
        bootstrapping: 'Starting engine',
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

      const paintStatus = (t?: { phase: string; bookSize: number; liveUpdatesPerSec: number; getRowsTotal: number } | null): void => {
        statusRow.replaceChildren();
        if (!controller.getActiveProviderId()) {
          const empty = document.createElement('span');
          empty.className = 'vgext-dp__status-empty';
          empty.textContent = 'No provider attached — choose one above and Apply.';
          statusRow.appendChild(empty);
          return;
        }
        const tone = PHASE_TONE[t?.phase ?? ''] ?? 'idle';
        const state = document.createElement('span');
        state.className = `vgext-dp__state is-${tone}`;
        const dot = document.createElement('span');
        dot.className = 'vgext-state-dot';
        dot.dataset.state = tone;
        const label = document.createElement('span');
        label.textContent = PHASE_LABEL[t?.phase ?? ''] ?? 'Waiting for feed';
        state.append(dot, label);
        statusRow.append(
          state,
          chip('book', (t?.bookSize ?? 0).toLocaleString()),
          chip('rows/s', (t?.liveUpdatesPerSec ?? 0).toLocaleString()),
          chip('getRows', (t?.getRowsTotal ?? 0).toLocaleString()),
        );
      };

      paintStatus(controller.getTelemetry());
      const offTelemetry = controller.subscribeTelemetry((t) => paintStatus(t));

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
          onSaved: (cfg) => {
            void rebuildSelect();
            ctx.profiles.markDirty();
            // C-m13 — the catalog write doesn't rebind the live View; Apply
            // must be re-run to pick up the edited config.
            if (cfg.providerId === controller.getActiveProviderId()) {
              hint.textContent =
                `Saved “${cfg.providerId}” · re-Apply to rebind the active provider with the new config.`;
            }
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
            paintStatus(controller.getTelemetry());
          } catch (err) {
            console.error('[velocity-grid-ext] Apply Perspective provider failed', err);
            hint.textContent = err instanceof Error ? err.message : String(err);
            paintStatus({ phase: 'error', bookSize: 0, liveUpdatesPerSec: 0, getRowsTotal: 0 });
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
          offTelemetry();
          host.replaceChildren();
        },
        refresh() {
          void rebuildSelect();
          paintStatus(controller.getTelemetry());
        },
      };
    },
  };
}

export { PerspectiveDataProviderController };
