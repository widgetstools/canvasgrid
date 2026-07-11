import type {
  CgExtContext, SettingsModule, ToolbarItem, ToolbarItemInstance, ToolbarSlot, ModuleInstance,
} from '../extension/types';

/** The shell wraps the kernel canvas with a themed title bar + toggleable
 *  ribbon strip above it, and a right-side settings drawer overlaid on it:
 *
 *    ┌ .cgext-titlebar ─────────────────────────┐
 *    ├ .cgext-ribbon (optional) ────────────────┤
 *    │ .cgext-grid  ← caller mounts the CGrid    │  .cgext-sheet
 *    │              here                         │  (drawer, right)
 *    └───────────────────────────────────────────┘
 *
 *  The title bar / ribbon reserve vertical space above the canvas (same as
 *  the kernel's rowGroupPanel/statusBar), so the viewport sizes correctly.
 *  The sheet is an absolutely-positioned drawer over the grid — non-modal,
 *  so the data stays visible while a module is open. All chrome derives its
 *  palette from the grid's own `--cg-*` theme tokens (CGridExt mirrors the
 *  theme class onto the shell root), so title bar + drawer read as one
 *  surface with the data.
 */
export class ShellLayout {
  readonly gridMount: HTMLElement;
  private titlebar: HTMLElement;
  private ribbon: HTMLElement;
  private sheet: HTMLElement;
  private modules = new Map<string, { module: SettingsModule; ctx: CgExtContext }>();
  private toolbarInstances: ToolbarItemInstance[] = [];
  private live: ModuleInstance | null = null;

  constructor(private root: HTMLElement) {
    injectShellStyles();
    root.classList.add('cgext-root');
    this.titlebar = el('cgext-titlebar');
    this.ribbon = el('cgext-ribbon');
    this.gridMount = el('cgext-grid');
    this.sheet = el('cgext-sheet');
    this.sheet.hidden = true;
    root.append(this.titlebar, this.ribbon, this.gridMount, this.sheet);
  }

  private slotHost(slot: ToolbarSlot): HTMLElement {
    if (slot.startsWith('ribbon.')) return sub(this.ribbon, `sec-${slot.slice(7)}`);
    return sub(this.titlebar, slot); // primary-left | primary-center | primary-right
  }

  mountToolbarItem(item: ToolbarItem, ctx: CgExtContext): void {
    const host = el('cgext-toolbar-item');
    host.dataset.itemId = item.id;
    this.slotHost(item.slot).appendChild(host);
    this.toolbarInstances.push(item.render(host, ctx));
  }

  mountSettingsModule(module: SettingsModule, ctx: CgExtContext): void {
    this.modules.set(module.id, { module, ctx });
  }

  openSettings(id?: string): void {
    const target = id ?? this.modules.keys().next().value;
    if (!target || !this.modules.has(target)) return;
    this.renderSheet(target);
    this.sheet.hidden = false;
  }

  private renderSheet(id: string): void {
    this.live?.destroy();
    this.sheet.replaceChildren();
    const entry = this.modules.get(id)!;

    // Drawer header: module title + close affordance.
    const header = el('cgext-sheet-header');
    const title = el('cgext-sheet-title');
    title.textContent = entry.module.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cgext-sheet-close';
    close.setAttribute('aria-label', 'Close settings');
    close.textContent = '✕';
    close.addEventListener('click', () => this.closeSettings());
    header.append(title, close);

    const body = el('cgext-sheet-body');
    this.sheet.append(header, body);
    this.live = entry.module.mount(body, entry.ctx);
  }

  closeSettings(): void {
    this.live?.destroy();
    this.live = null;
    this.sheet.hidden = true;
  }

  isSettingsOpen(): boolean { return !this.sheet.hidden; }

  destroy(): void {
    this.live?.destroy();
    this.live = null;
    for (const inst of this.toolbarInstances) inst?.destroy();
    this.toolbarInstances = [];
    this.modules.clear();
    this.root.replaceChildren();
    this.root.classList.remove('cgext-root');
  }
}

function el(cls: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
/** Get-or-create a stable named child of `parent`. */
function sub(parent: HTMLElement, name: string): HTMLElement {
  const key = `cgext-slot-${name}`;
  let found = parent.querySelector<HTMLElement>(`:scope > .${key}`);
  if (!found) { found = el(key); parent.appendChild(found); }
  return found;
}

/** Inject the shell chrome CSS once per document. Kept in JS (not a
 *  separate .css import) so `@cgrid/ext` stays source-direct and consumers
 *  don't need a second import. Every color derives from the grid's `--cg-*`
 *  theme tokens with a dark fallback, so the chrome matches the active
 *  theme and still looks intentional when no theme is set. */
function injectShellStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-shell-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-shell-styles';
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);
}

const SHELL_CSS = `
.cgext-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--cg-fg-color, #e5e9f0);
  /* Inter everywhere — ride the theme's font token (kernel themes set
     --cg-font-family to the Inter stack); graceful system fallback. */
  font: 13px/1.4 var(--cg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
.cgext-titlebar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  padding: 0 10px;
  background: var(--cg-header-bg, var(--cg-popup-bg, #171c26));
  border-bottom: 1px solid var(--cg-border-color, #2a3140);
}
.cgext-titlebar > .cgext-slot-primary-left { display: flex; align-items: center; gap: 6px; }
.cgext-titlebar > .cgext-slot-primary-center { flex: 1 1 auto; display: flex; justify-content: center; gap: 6px; }
.cgext-titlebar > .cgext-slot-primary-right { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.cgext-ribbon:empty { display: none; }
.cgext-grid { flex: 1 1 auto; min-height: 0; position: relative; }

.cgext-toolbar-item { display: inline-flex; align-items: center; }
.cgext-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 7px);
  background: transparent;
  color: var(--cg-fg-color, #e5e9f0);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.cgext-btn:hover { background: var(--cg-row-alt-bg, rgba(255, 255, 255, 0.06)); }
.cgext-btn:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-btn:disabled { color: var(--cg-muted-fg-color, #7f8798); cursor: default; opacity: 0.65; }
.cgext-btn:disabled:hover { background: transparent; }
/* Save button reflects a dirty profile — accent when actionable. */
.cgext-btn.cgext-save:not(:disabled) {
  background: var(--cg-accent-color, #4f9cf9);
  border-color: var(--cg-accent-color, #4f9cf9);
  color: #fff;
}
.cgext-btn.cgext-save:not(:disabled):hover { filter: brightness(1.08); }

.cgext-sheet {
  position: absolute;
  top: 44px;
  right: 0;
  bottom: 0;
  width: 340px;
  max-width: 92%;
  display: flex;
  flex-direction: column;
  background: var(--cg-popup-bg, #12161f);
  border-left: 1px solid var(--cg-border-color, #2a3140);
  box-shadow: -12px 0 28px rgba(0, 0, 0, 0.36);
  z-index: 30;
}
.cgext-sheet[hidden] { display: none; }
.cgext-sheet-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--cg-border-color, #2a3140);
}
.cgext-sheet-title {
  flex: 1 1 auto;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.01em;
  color: var(--cg-fg-color, #e5e9f0);
}
.cgext-sheet-close {
  appearance: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--cg-radius, 6px);
  background: transparent;
  color: var(--cg-muted-fg-color, #8a93a6);
  font-size: 13px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cgext-sheet-close:hover { background: var(--cg-row-alt-bg, rgba(255, 255, 255, 0.06)); color: var(--cg-fg-color, #e5e9f0); }
.cgext-sheet-close:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-sheet-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 4px; }

@media (prefers-reduced-motion: no-preference) {
  .cgext-btn, .cgext-sheet-close { transition-duration: 120ms; }
}
`;
