import { defineChromeComponents } from '@cgrid/customizer';
import type { SettingsModule, CgExtContext, ModuleInstance } from '../extension/types';

/** Grid Options module — the spine's proof module. Reads/writes kernel
 *  options through the public `setGridOption`, marks the profile dirty on
 *  edit, and owns a `grid-options` state slice so its values persist with
 *  profiles. Built from @cgrid/customizer chrome (cgc-* controls). */
export function gridOptionsModule(): SettingsModule {
  // Touched values, mirrored into the state slice.
  const touched: Record<string, unknown> = {};

  return {
    id: 'grid-options',
    kind: 'settings-module',
    title: 'Grid Options',
    icon: 'sliders',
    category: 'layout',

    init(ctx: CgExtContext): void {
      defineChromeComponents(); // idempotent registration of cgc-* elements
      ctx.registerStateModule({
        id: 'grid-options',
        version: 1,
        get: () => (Object.keys(touched).length ? { ...touched } : undefined),
        set: (data) => {
          if (data && typeof data === 'object') {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
              touched[k] = v;
              ctx.grid.setGridOption(k as any, v as any);
            }
          }
        },
      });
    },

    mount(host: HTMLElement, ctx: CgExtContext): ModuleInstance {
      const band = document.createElement('cgc-band');
      band.setAttribute('band-title', 'Display');

      // Each control is wrapped in a `cgc-field`, which renders the visible
      // label (`.label-text`) and slots the control. The cgc-* controls have
      // no `label` property of their own — only `aria-label` — so the field
      // wrapper is how a human-readable label reaches the panel. `data-opt`
      // stays on the CONTROL (never the field) so the delegated `cgc-change`
      // handler resolves the option via `ev.target.closest('[data-opt]')`;
      // the event bubbles up through cgc-field to `host`.
      const rowHeightField = document.createElement('cgc-field');
      rowHeightField.setAttribute('label', 'Row height');
      const rowHeight = document.createElement('cgc-number');
      rowHeight.setAttribute('data-opt', 'rowHeight');
      rowHeight.setAttribute('aria-label', 'Row height');
      rowHeight.setAttribute('min', '16');
      rowHeightField.appendChild(rowHeight);

      const hoverField = document.createElement('cgc-field');
      hoverField.setAttribute('label', 'Row hover highlight');
      const hover = document.createElement('cgc-switch');
      hover.setAttribute('data-opt', 'suppressRowHoverHighlight');
      hover.setAttribute('aria-label', 'Row hover highlight');
      hoverField.appendChild(hover);

      band.append(rowHeightField, hoverField);
      host.appendChild(band);

      const onChange = (ev: Event) => {
        const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-opt]');
        if (!target) return;
        const opt = target.dataset.opt!;
        const value = (ev as CustomEvent).detail?.value;
        // suppressRowHoverHighlight switch is inverted vs the label meaning.
        const applied = opt === 'suppressRowHoverHighlight' ? !value : value;
        touched[opt] = applied;
        ctx.grid.setGridOption(opt as any, applied as any);
        ctx.profiles.markDirty();
      };
      host.addEventListener('cgc-change', onChange);

      return { destroy() { host.removeEventListener('cgc-change', onChange); host.replaceChildren(); } };
    },
  };
}
