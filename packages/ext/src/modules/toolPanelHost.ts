/**
 * Shared helpers for wrapping a kernel `ToolPanel` as an ext settings
 * module. Panels code against `CGridApi`; CGrid exposes the same methods
 * on the class, so we pass `ctx.grid` with a thin Proxy that marks the
 * active profile dirty on writes.
 */
import type { CGrid } from '@cgrid/kernel';
import type { ToolPanel } from '@cgrid/kernel';
import type { CgExtContext, ModuleInstance } from '../extension/types';

const WRITE_METHODS = new Set([
  'setGridOption',
  'updateGridOptions',
  'setThemeParams',
  'setSideBarVisible',
  'editColumn',
  'setColumnsPinned',
  'addValueColumn',
  'removeValueColumn',
  'setValueColumnAggFunc',
]);

/** API object suitable for `ToolPanel.init({ api })`. */
export function toolPanelApi(grid: CGrid, onDirty: () => void): unknown {
  return new Proxy(grid as object, {
    get(target, prop, receiver) {
      // makeApi-only helpers used by Grid Options density defaults.
      if (prop === 'getDefaultRowHeight') {
        return () => (grid as unknown as { theme?: { rowHeight?: number } }).theme?.rowHeight;
      }
      if (prop === 'getDefaultHeaderHeight') {
        return () => (grid as unknown as { theme?: { headerHeight?: number } }).theme?.headerHeight;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (WRITE_METHODS.has(String(prop))) {
        return (...args: unknown[]) => {
          const out = fn.apply(target, args);
          onDirty();
          return out;
        };
      }
      return fn.bind(target);
    },
  });
}

/** Mount a freshly constructed kernel tool panel into `host`. */
export function mountToolPanel(
  Panel: new () => ToolPanel,
  host: HTMLElement,
  ctx: CgExtContext,
  toolPanelParams?: Record<string, unknown>,
): ModuleInstance {
  host.classList.add('cgext-sheet-toolpanel');
  const panel = new Panel();
  panel.init({
    api: toolPanelApi(ctx.grid, () => ctx.profiles.markDirty()),
    toolPanelParams,
  });
  const gui = panel.getGui();
  host.appendChild(gui);
  return {
    destroy() {
      panel.destroy();
      host.replaceChildren();
      host.classList.remove('cgext-sheet-toolpanel');
    },
    refresh() { panel.refresh?.(); },
  };
}
