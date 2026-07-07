/**
 * Layout management for the CGridExt title bar — a dropdown listing the
 * kernel's named Grid Layouts (switch / rename / duplicate / export /
 * delete / save-new / bundle import-export) plus a dirty-aware
 * "update active layout" disk button.
 *
 * All state lives in the kernel: every mutation goes through the public
 * layout API and the UI re-syncs from the `layoutChanged` event — the
 * panel re-renders its list, the trigger re-labels, the disk clears.
 * Kernel throws (duplicate name, bad import, newer bundle version) are
 * caught at this boundary and surfaced inline.
 */
import type { ToolbarItem, CgExtContext } from '../extension/types';
import { menu, svg, iconButton } from './ui';

/** Kernel layout surface this module drives — structural subset of CGridApi
 *  so the module stays testable against a stub. */
interface LayoutGridSurface {
  getGridOption(key: string): unknown;
  getLayouts(): { id: string; name: string }[];
  getActiveLayoutId(): string;
  getActiveLayout(): { id: string; name: string };
  loadLayout(id: string): unknown;
  saveLayout(name: string, opts?: { activate?: boolean }): unknown;
  updateLayout(id?: string): unknown;
  deleteLayout(id: string): void;
  renameLayout(id: string, name: string): unknown;
  duplicateLayout(id: string, name: string, opts?: { activate?: boolean }): unknown;
  exportLayout(id: string): unknown;
  exportLayouts(): unknown;
  importLayout(layout: unknown, opts?: { overwrite?: boolean; activate?: boolean }): unknown;
  importLayouts(bundle: unknown, opts?: { mode?: 'replace' | 'merge'; overwrite?: boolean }): void;
  addEventListener(type: string, fn: (e: never) => void): () => void;
}
const surface = (ctx: CgExtContext): LayoutGridSurface => ctx.grid as unknown as LayoutGridSurface;

const DEFAULT_ID = 'default';

const I = {
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M20 6L9 17l-5-5',
  lock: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── trigger + panel ────────────────────────────────────────────────────────

export function layoutsItem(): ToolbarItem {
  return {
    id: 'layouts', kind: 'toolbar-item', slot: 'primary-right',
    init() {},
    render(host, ctx) {
      injectLayoutsMenuStyles();
      const grid = surface(ctx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cgext-profile';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML =
        `<span class="cgext-profile-avatar">${svg(I.user, 13)}</span>` +
        `<span class="cgext-profile-name"></span>` +
        `<span class="cgext-profile-caret">${svg(I.chevronDown, 13)}</span>`;
      const nameEl = btn.querySelector('.cgext-profile-name')!;
      const paint = () => {
        let name = 'Default';
        try { name = grid.getActiveLayout().name; } catch { /* pre-init grid */ }
        nameEl.textContent = name;
        btn.title = `Layout: ${name}`;
      };
      paint();

      let refreshOpenPanel: (() => void) | null = null;
      const m = menu(
        btn,
        () => {
          const { el, refresh } = buildPanel(ctx);
          refreshOpenPanel = refresh;
          return el;
        },
        (open) => {
          btn.setAttribute('aria-expanded', String(open));
          if (!open) refreshOpenPanel = null;
        },
      );
      btn.addEventListener('click', () => m.toggle());

      const off = grid.addEventListener('layoutChanged', () => {
        paint();
        refreshOpenPanel?.();
      });

      host.appendChild(btn);
      return { destroy() { off(); m.destroy(); host.replaceChildren(); } };
    },
  };
}

/** The dropdown panel. `refresh` re-renders the list + count and hides the
 *  error strip; the save-new input is left alone so typing survives
 *  unrelated layout events. */
function buildPanel(ctx: CgExtContext): { el: HTMLElement; refresh: () => void } {
  const grid = surface(ctx);
  const el = document.createElement('div');
  el.className = 'cgext-layouts';
  el.innerHTML =
    `<div class="cgext-layouts-head"><span>LAYOUTS</span><span class="cgext-layouts-count"></span></div>` +
    `<div class="cgext-layouts-list" role="menu"></div>` +
    `<div class="cgext-layouts-error" hidden></div>`;
  const listEl = el.querySelector<HTMLElement>('.cgext-layouts-list')!;
  const countEl = el.querySelector<HTMLElement>('.cgext-layouts-count')!;
  const errorEl = el.querySelector<HTMLElement>('.cgext-layouts-error')!;

  const showError = (message: string) => { errorEl.textContent = message; errorEl.hidden = false; };
  const refresh = () => {
    errorEl.hidden = true;
    countEl.textContent = String(grid.getLayouts().length);
    listEl.replaceChildren(); // rows land in Task 3
    void showError; // referenced by Task 3/4 row + footer handlers
  };
  refresh();
  return { el, refresh };
}

// ── styles ─────────────────────────────────────────────────────────────────

export function injectLayoutsMenuStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-layouts-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-layouts-styles';
  style.textContent = LAYOUTS_CSS;
  document.head.appendChild(style);
}

const LAYOUTS_CSS = `
.cgext-menu.cgext-layouts { width: 300px; padding: 0; }
.cgext-layouts-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px 8px;
  font-size: 11px; font-weight: 650; letter-spacing: 0.08em;
  color: var(--cg-muted-fg-color, #9aa4b6);
  border-bottom: 1px solid var(--cg-border-color, #2a3140);
}
.cgext-layouts-count { font-weight: 500; font-variant-numeric: tabular-nums; }
.cgext-layouts-list {
  max-height: 320px; overflow-y: auto;
  padding: 6px; display: flex; flex-direction: column; gap: 2px;
}
.cgext-layouts-row {
  position: relative; display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 7px; cursor: pointer;
  color: var(--cg-fg-color, #e5e9f0); font-size: 12.5px;
}
.cgext-layouts-row:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); }
.cgext-layouts-row.is-active { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 14%, transparent); }
.cgext-layouts-row.is-active::before {
  content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
  border-radius: 2px; background: var(--cg-accent-color, #4f9cf9);
}
.cgext-layouts-mark { width: 16px; display: inline-flex; justify-content: center; color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--cg-muted-fg-color, #9aa4b6); opacity: 0.6; }
.cgext-layouts-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.cgext-layouts-actions { display: none; align-items: center; gap: 2px; }
.cgext-layouts-row:hover .cgext-layouts-actions,
.cgext-layouts-row.is-active .cgext-layouts-actions,
.cgext-layouts-row:focus-within .cgext-layouts-actions { display: inline-flex; }
.cgext-layouts-act {
  appearance: none; border: none; background: transparent;
  width: 24px; height: 24px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--cg-muted-fg-color, #9aa4b6); cursor: pointer;
}
.cgext-layouts-act:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.08)); color: var(--cg-fg-color, #e5e9f0); }
.cgext-layouts-act:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-layouts-lock { width: 24px; display: inline-flex; justify-content: center; color: var(--cg-muted-fg-color, #9aa4b6); opacity: 0.7; }
.cgext-layouts-rename {
  flex: 1 1 auto; min-width: 0; height: 26px; padding: 0 8px;
  border: 1px solid var(--cg-accent-color, #4f9cf9); border-radius: 6px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.cgext-layouts-rename:focus { outline: none; }
.cgext-layouts-rename.is-error, .cgext-layouts-new input.is-error { border-color: var(--cg-neg-color, #e2606c); }
.cgext-layouts-error { margin: 6px 12px 0; font-size: 12px; color: var(--cg-neg-color, #e2606c); }
.cgext-layouts-new {
  display: flex; gap: 6px; padding: 10px 12px;
  border-top: 1px solid var(--cg-border-color, #2a3140); margin-top: 6px;
}
.cgext-layouts-new input {
  flex: 1 1 auto; min-width: 0; height: 28px; padding: 0 9px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 7px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.cgext-layouts-new input:focus { outline: none; border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-savenew {
  height: 28px; padding: 0 12px; white-space: nowrap;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 7px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px; font-weight: 550;
  cursor: pointer; transition: border-color 120ms ease;
}
.cgext-layouts-savenew:hover:not(:disabled) { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-savenew:disabled { opacity: 0.45; cursor: default; }
.cgext-layouts-foot { display: flex; gap: 8px; padding: 0 12px 12px; }
.cgext-layouts-foot button {
  flex: 1; height: 28px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 7px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px; font-weight: 550;
  cursor: pointer; transition: border-color 120ms ease;
}
.cgext-layouts-foot button:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-foot button svg { color: var(--cg-muted-fg-color, #9aa4b6); }
`;
