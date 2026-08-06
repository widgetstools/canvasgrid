import type {
  CgExtContext, SettingsModule, ToolbarItem, ToolbarItemInstance, ToolbarSlot, ModuleInstance,
} from '../extension/types';
import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';

/** Lucide name aliases for module.icon values that aren't 1:1 catalog keys. */
const MODULE_ICON_ALIAS: Record<string, string> = {
  sliders: 'sliders-horizontal',
  columns: 'columns-3',
  wand: 'sparkles',
};

function moduleIconSvg(name: string, size = 14): string {
  const key = MODULE_ICON_ALIAS[name] ?? name;
  const d = lucideBundle[key];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

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
  private activeId: string | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private root: HTMLElement) {
    injectShellStyles();
    root.classList.add('cgext-root');
    this.titlebar = el('cgext-titlebar');
    this.ribbon = el('cgext-ribbon');
    this.gridMount = el('cgext-grid');
    this.sheet = el('cgext-sheet');
    this.sheet.hidden = true;
    this.sheet.setAttribute('aria-hidden', 'true');
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-modal', 'false');
    this.sheet.setAttribute('aria-label', 'Customize grid');
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
    this.sheet.setAttribute('aria-hidden', 'false');
    this.bindEscape();
    // Next frame so the entrance transition runs after display flips on.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.sheet.classList.add('is-open'));
    });
  }

  private renderSheet(id: string): void {
    this.live?.destroy();
    this.live = null;
    this.sheet.replaceChildren();
    this.activeId = id;
    const entry = this.modules.get(id)!;

    // Drawer header: quiet eyebrow + module title + close.
    const header = el('cgext-sheet-header');
    const titles = el('cgext-sheet-titles');
    const eyebrow = el('cgext-sheet-eyebrow');
    eyebrow.textContent = 'Customize';
    const title = el('cgext-sheet-title');
    title.id = 'cgext-sheet-title';
    title.textContent = entry.module.title;
    titles.append(eyebrow, title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cgext-sheet-close';
    close.setAttribute('aria-label', 'Close settings');
    close.innerHTML = moduleIconSvg('x', 16) || '✕';
    close.addEventListener('click', () => this.closeSettings());
    header.append(titles, close);

    // Module switcher — icon + label strip (not wrapping text pills).
    const body = el('cgext-sheet-body');
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', 'cgext-sheet-title');
    if (this.modules.size > 1) {
      const nav = el('cgext-sheet-nav');
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-label', 'Settings sections');
      for (const [mid, { module }] of this.modules) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'cgext-sheet-nav-item';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(mid === id));
        tab.title = module.title;
        if (mid === id) tab.classList.add('is-active');
        const iconHtml = moduleIconSvg(module.icon, 14);
        tab.innerHTML =
          `${iconHtml ? `<span class="cgext-sheet-nav-icon">${iconHtml}</span>` : ''}` +
          `<span class="cgext-sheet-nav-label">${module.title}</span>`;
        tab.addEventListener('click', () => {
          if (mid === this.activeId) return;
          this.renderSheet(mid);
        });
        nav.appendChild(tab);
      }
      this.sheet.append(header, nav, body);
    } else {
      this.sheet.append(header, body);
    }

    // Footer: Discard reverts unsaved profile edits; Done closes the drawer.
    const footer = el('cgext-sheet-footer');
    const hint = el('cgext-sheet-footer-hint');
    hint.textContent = 'Save cards in each tab · Title-bar Save* persists the profile · Esc closes';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'cgext-sheet-footbtn ghost';
    discard.textContent = 'Discard';
    discard.title = 'Revert unsaved profile changes and close';
    discard.addEventListener('click', () => { void this.discardAndClose(); });
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'cgext-sheet-footbtn action';
    done.textContent = 'Done';
    done.setAttribute('data-testid', 'cgext-sheet-done');
    done.addEventListener('click', () => this.closeSettings());
    footer.append(hint, discard, done);
    this.sheet.append(footer);

    this.live = entry.module.mount(body, entry.ctx);
  }

  private profilesCtx(): CgExtContext | null {
    return this.modules.values().next().value?.ctx ?? null;
  }

  /** Reload the active profile snapshot (if dirty), then close. */
  private async discardAndClose(): Promise<void> {
    const profiles = this.profilesCtx()?.profiles;
    try {
      if (profiles?.isDirty()) await profiles.discard();
    } catch { /* store miss — still close */ }
    this.closeSettings();
  }

  private bindEscape(): void {
    if (this.keyHandler) return;
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || this.sheet.hidden) return;
      this.closeSettings();
      e.preventDefault();
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  private unbindEscape(): void {
    if (!this.keyHandler) return;
    document.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  closeSettings(): void {
    this.unbindEscape();
    const wasOpen = this.sheet.classList.contains('is-open');
    this.sheet.classList.remove('is-open');
    this.sheet.setAttribute('aria-hidden', 'true');
    const finish = (): void => {
      this.live?.destroy();
      this.live = null;
      this.activeId = null;
      this.sheet.hidden = true;
      this.sheet.replaceChildren();
    };
    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !wasOpen) {
      finish();
      return;
    }
    window.setTimeout(finish, 180);
  }

  isSettingsOpen(): boolean { return !this.sheet.hidden; }

  destroy(): void {
    this.unbindEscape();
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
  let style = document.getElementById('cgext-shell-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'cgext-shell-styles';
    document.head.appendChild(style);
  }
  style.textContent = SHELL_CSS;
}

const SHELL_CSS = `
.cgext-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--cg-fg-color, #e5e9f0);
  /* Flat 2px corners for all chrome that reads --cg-radius (inputs, buttons,
     menus, etc.). Pills / switches / avatars hardcode their own radii. */
  --cg-radius: 2px;
  /* Inter everywhere — ride the theme's font token (kernel themes set
     --cg-font-family to the Inter stack); graceful system fallback. */
  font: 13px/1.4 var(--cg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
/* Body-mounted popups sit outside .cgext-root — pin the same 2px radius. */
.cgext-menu,
.cgext-ip-panel {
  --cg-radius: 2px;
}
.cgext-titlebar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 14px;
  background: var(--cg-header-bg, var(--cg-popup-bg, #171c26));
  border-bottom: 1px solid var(--cg-border-color, #2a3140);
}
.cgext-titlebar > .cgext-slot-primary-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cgext-titlebar > .cgext-slot-primary-center { flex: 1 1 auto; display: flex; justify-content: center; align-items: center; gap: 8px; min-width: 0; }
.cgext-titlebar > .cgext-slot-primary-right { margin-left: auto; display: flex; align-items: center; }
.cgext-ribbon:empty,
.cgext-ribbon[hidden] { display: none; }
.cgext-grid { flex: 1 1 auto; min-height: 0; position: relative; }

.cgext-toolbar-item { display: inline-flex; align-items: center; }
.cgext-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 2px);
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
  top: 48px;
  right: 0;
  bottom: 0;
  width: min(680px, 92%);
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 3.5%, transparent) 0,
      transparent 48px),
    var(--cg-popup-bg, #12161f);
  border-left: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 88%, transparent);
  box-shadow:
    -1px 0 0 color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 4%, transparent),
    -24px 0 48px rgba(0, 0, 0, 0.42);
  z-index: 30;
  transform: translateX(18px);
  opacity: 0;
  pointer-events: none;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease;
}
.cgext-sheet.is-open {
  transform: none;
  opacity: 1;
  pointer-events: auto;
}
.cgext-sheet[hidden] { display: none !important; }
.cgext-sheet-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 12px 10px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 85%, transparent);
}
.cgext-sheet-titles {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cgext-sheet-eyebrow {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--cg-muted-fg-color, #8a93a6) 92%, transparent);
}
.cgext-sheet-title {
  font-weight: 650;
  font-size: 15px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--cg-fg-color, #e5e9f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cgext-sheet-close {
  appearance: none;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 2px);
  background: transparent;
  color: var(--cg-muted-fg-color, #8a93a6);
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.cgext-sheet-close:hover {
  background: var(--cg-row-alt-bg, rgba(255, 255, 255, 0.06));
  border-color: color-mix(in srgb, var(--cg-border-color, #2a3140) 80%, transparent);
  color: var(--cg-fg-color, #e5e9f0);
}
.cgext-sheet-close:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-sheet-nav {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: nowrap;
  gap: 2px;
  padding: 8px 12px 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 85%, transparent);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 2%, transparent);
}
.cgext-sheet-nav-item {
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  border: none;
  border-radius: var(--cg-radius, 2px) var(--cg-radius, 2px) 0 0;
  background: transparent;
  color: var(--cg-muted-fg-color, #8a93a6);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  letter-spacing: 0.01em;
  white-space: nowrap;
  cursor: pointer;
  flex: 0 0 auto;
  transition: color 140ms ease, background 140ms ease;
}
.cgext-sheet-nav-item::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 2px;
  border-radius: 1px 1px 0 0;
  background: transparent;
  transition: background 140ms ease;
}
.cgext-sheet-nav-icon {
  display: inline-flex;
  opacity: 0.72;
  transition: opacity 140ms ease, color 140ms ease;
}
.cgext-sheet-nav-item:hover {
  color: var(--cg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 4%, transparent);
}
.cgext-sheet-nav-item:hover .cgext-sheet-nav-icon { opacity: 1; }
.cgext-sheet-nav-item.is-active {
  color: var(--cg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 8%, transparent);
}
.cgext-sheet-nav-item.is-active::after {
  background: var(--cg-accent-color, #4f9cf9);
}
.cgext-sheet-nav-item.is-active .cgext-sheet-nav-icon {
  opacity: 1;
  color: var(--cg-accent-color, #4f9cf9);
}
.cgext-sheet-nav-item:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: -2px; }
.cgext-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px 16px 24px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--cg-muted-fg-color, #8a93a6) 35%, transparent) transparent;
}
/* Kernel tool panels (Options / Column Groups) fill the body edge-to-edge. */
.cgext-sheet-body:has(> .cgext-sheet-toolpanel) {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.cgext-sheet-toolpanel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cgext-sheet-toolpanel > .cg-settings-panel,
.cgext-sheet-toolpanel > .cg-colgroups-panel {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.cgext-sheet-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 14px;
  border-top: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 85%, transparent);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 2.5%, transparent);
}
.cgext-sheet-footer-hint {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 10px;
  font-weight: 550;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--cg-muted-fg-color, #8a93a6) 88%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cgext-sheet-footbtn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 2px);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, filter 120ms ease;
}
.cgext-sheet-footbtn.ghost {
  background: transparent;
  color: var(--cg-muted-fg-color, #8a93a6);
}
.cgext-sheet-footbtn.ghost:hover {
  color: var(--cg-fg-color, #e5e9f0);
  background: var(--cg-row-alt-bg, rgba(255, 255, 255, 0.06));
}
.cgext-sheet-footbtn.action {
  background: var(--cg-accent-color, #4f9cf9);
  border-color: var(--cg-accent-color, #4f9cf9);
  color: #fff;
}
.cgext-sheet-footbtn.action:hover { filter: brightness(1.08); }
.cgext-sheet-footbtn:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .cgext-sheet { transition: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .cgext-btn, .cgext-sheet-close, .cgext-sheet-nav-item { transition-duration: 120ms; }
}
`;
