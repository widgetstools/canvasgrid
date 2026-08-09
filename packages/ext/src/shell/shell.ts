import type {
  VelocityGridExtContext,
  SettingsModule,
  ToolbarItem,
  ToolbarItemInstance,
  ToolbarSlot,
  ModuleInstance,
  ModuleCategory,
} from '../extension/types';
import { lucideBundle } from '@wellsfargo-starui/velocity-grid/icons/lucide.generated';

/** Lucide name aliases for module.icon values that aren't 1:1 catalog keys. */
const MODULE_ICON_ALIAS: Record<string, string> = {
  sliders: 'sliders-horizontal',
  columns: 'columns-3',
  wand: 'sparkles',
};

/** Display order for Customize drawer category menus. */
const CATEGORY_ORDER: readonly ModuleCategory[] = [
  'layout',
  'data',
  'format',
  'editing',
  'workspace',
];

const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  layout: 'Layout',
  data: 'Data',
  format: 'Format',
  editing: 'Editing',
  workspace: 'Workspace',
};

interface ModuleNavGroup {
  id: string;
  label: string;
  modules: SettingsModule[];
}

/** Bucket registered modules into category dropdowns (empty groups dropped). */
export function groupModulesForNav(
  modules: Iterable<SettingsModule>,
): ModuleNavGroup[] {
  const byCat = new Map<string, SettingsModule[]>();
  for (const mod of modules) {
    const key = mod.category || 'workspace';
    const list = byCat.get(key);
    if (list) list.push(mod);
    else byCat.set(key, [mod]);
  }

  const groups: ModuleNavGroup[] = [];
  for (const id of CATEGORY_ORDER) {
    const members = byCat.get(id);
    if (!members?.length) continue;
    groups.push({ id, label: CATEGORY_LABELS[id], modules: members });
    byCat.delete(id);
  }
  // Unknown / future categories — keep reachable under their raw id.
  for (const [id, members] of byCat) {
    if (!members.length) continue;
    groups.push({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      modules: members,
    });
  }
  return groups;
}

function moduleIconSvg(name: string, size = 14): string {
  const key = MODULE_ICON_ALIAS[name] ?? name;
  const d = lucideBundle[key];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** The shell wraps the kernel canvas with a themed title bar + toggleable
 *  ribbon strip above it, and a right-side settings drawer overlaid on it:
 *
 *    ┌ .vgext-titlebar ─────────────────────────┐
 *    ├ .vgext-ribbon (optional) ────────────────┤
 *    │ .vgext-grid  ← caller mounts the VelocityGrid    │  .vgext-sheet
 *    │              here                         │  (drawer, right)
 *    └───────────────────────────────────────────┘
 *
 *  The title bar / ribbon reserve vertical space above the canvas (same as
 *  the kernel's rowGroupPanel/statusBar), so the viewport sizes correctly.
 *  The sheet is a fixed right drawer spanning the full viewport height —
 *  non-modal, so the data stays visible while a module is open. All chrome
 *  derives its palette from the grid's own `--vg-*` theme tokens
 *  (VelocityGridExt mirrors the theme class onto the shell root), so title
 *  bar + drawer read as one surface with the data.
 */
export class ShellLayout {
  readonly gridMount: HTMLElement;
  private titlebar: HTMLElement;
  private ribbon: HTMLElement;
  private sheet: HTMLElement;
  private modules = new Map<string, { module: SettingsModule; ctx: VelocityGridExtContext }>();
  private toolbarInstances: ToolbarItemInstance[] = [];
  private live: ModuleInstance | null = null;
  private activeId: string | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Tear down dropdown listeners for the sheet category nav. */
  private navCleanup: (() => void) | null = null;

  constructor(private root: HTMLElement) {
    injectShellStyles();
    root.classList.add('vgext-root');
    this.titlebar = el('vgext-titlebar');
    this.ribbon = el('vgext-ribbon');
    this.gridMount = el('vgext-grid');
    this.sheet = el('vgext-sheet');
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

  mountToolbarItem(item: ToolbarItem, ctx: VelocityGridExtContext): void {
    const host = el('vgext-toolbar-item');
    host.dataset.itemId = item.id;
    this.slotHost(item.slot).appendChild(host);
    this.toolbarInstances.push(item.render(host, ctx));
  }

  mountSettingsModule(module: SettingsModule, ctx: VelocityGridExtContext): void {
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
    this.navCleanup?.();
    this.navCleanup = null;
    this.sheet.replaceChildren();
    this.activeId = id;
    const entry = this.modules.get(id)!;
    const groups = groupModulesForNav([...this.modules.values()].map((m) => m.module));
    const activeGroup = groups.find((g) => g.modules.some((m) => m.id === id));

    // Drawer header: quiet eyebrow + module title + close.
    const header = el('vgext-sheet-header');
    const titles = el('vgext-sheet-titles');
    const eyebrow = el('vgext-sheet-eyebrow');
    eyebrow.textContent = activeGroup
      ? `Customize · ${activeGroup.label}`
      : 'Customize';
    const title = el('vgext-sheet-title');
    title.id = 'vgext-sheet-title';
    title.textContent = entry.module.title;
    titles.append(eyebrow, title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vgext-sheet-close';
    close.setAttribute('aria-label', 'Close settings');
    close.innerHTML = moduleIconSvg('x', 16) || '✕';
    close.addEventListener('click', () => this.closeSettings());
    header.append(titles, close);

    // Category dropdown menus — replaces the scrollable flat tab strip.
    const body = el('vgext-sheet-body');
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', 'vgext-sheet-title');
    if (this.modules.size > 1) {
      const wrap = el('vgext-sheet-nav-wrap');
      const nav = el('vgext-sheet-nav');
      nav.setAttribute('role', 'menubar');
      nav.setAttribute('aria-label', 'Settings categories');
      nav.setAttribute('data-testid', 'vgext-sheet-nav');

      for (const group of groups) {
        const containsActive = group.modules.some((m) => m.id === id);
        const groupEl = el('vgext-sheet-nav-group');
        groupEl.dataset.groupId = group.id;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'vgext-sheet-nav-group-trigger';
        trigger.setAttribute('role', 'menuitem');
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('data-testid', `vgext-sheet-nav-group-${group.id}`);
        trigger.dataset.groupId = group.id;
        if (containsActive) trigger.classList.add('is-active');
        const chevron = moduleIconSvg('chevron-down', 12);
        trigger.innerHTML =
          `<span class="vgext-sheet-nav-group-label">${group.label}</span>` +
          (chevron
            ? `<span class="vgext-sheet-nav-group-chevron" aria-hidden="true">${chevron}</span>`
            : '');

        const menu = el('vgext-sheet-nav-menu');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', group.label);
        menu.hidden = true;
        menu.setAttribute('data-testid', `vgext-sheet-nav-menu-${group.id}`);

        for (const mod of group.modules) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'vgext-sheet-nav-menu-item';
          item.setAttribute('role', 'menuitem');
          item.setAttribute('data-testid', `vgext-sheet-nav-item-${mod.id}`);
          item.dataset.moduleId = mod.id;
          if (mod.id === id) item.classList.add('is-active');
          const iconHtml = moduleIconSvg(mod.icon, 14);
          item.innerHTML =
            `${iconHtml ? `<span class="vgext-sheet-nav-icon">${iconHtml}</span>` : ''}` +
            `<span class="vgext-sheet-nav-label">${mod.title}</span>`;
          item.addEventListener('click', () => {
            if (mod.id === this.activeId) {
              closeAllMenus();
              return;
            }
            this.renderSheet(mod.id);
          });
          menu.appendChild(item);
        }

        groupEl.append(trigger, menu);
        nav.appendChild(groupEl);
      }

      const closeAllMenus = (): void => {
        for (const g of nav.querySelectorAll<HTMLElement>('.vgext-sheet-nav-group')) {
          g.classList.remove('is-open');
          const t = g.querySelector<HTMLButtonElement>('.vgext-sheet-nav-group-trigger');
          const m = g.querySelector<HTMLElement>('.vgext-sheet-nav-menu');
          if (t) t.setAttribute('aria-expanded', 'false');
          if (m) m.hidden = true;
        }
      };

      const onTriggerClick = (e: Event): void => {
        const triggerEl = (e.currentTarget as HTMLElement);
        const groupEl = triggerEl.closest<HTMLElement>('.vgext-sheet-nav-group');
        if (!groupEl) return;
        const wasOpen = groupEl.classList.contains('is-open');
        closeAllMenus();
        if (wasOpen) return;
        groupEl.classList.add('is-open');
        triggerEl.setAttribute('aria-expanded', 'true');
        const menu = groupEl.querySelector<HTMLElement>('.vgext-sheet-nav-menu');
        if (menu) menu.hidden = false;
      };

      for (const t of nav.querySelectorAll<HTMLButtonElement>('.vgext-sheet-nav-group-trigger')) {
        t.addEventListener('click', onTriggerClick);
      }

      const onDocPointer = (e: Event): void => {
        const target = e.target as Node | null;
        if (target && nav.contains(target)) return;
        closeAllMenus();
      };
      // Capture so we close before other handlers; ignore the opening click.
      requestAnimationFrame(() => {
        document.addEventListener('pointerdown', onDocPointer, true);
      });

      this.navCleanup = () => {
        document.removeEventListener('pointerdown', onDocPointer, true);
        for (const t of nav.querySelectorAll<HTMLButtonElement>('.vgext-sheet-nav-group-trigger')) {
          t.removeEventListener('click', onTriggerClick);
        }
      };

      wrap.appendChild(nav);
      this.sheet.append(header, wrap, body);
    } else {
      this.sheet.append(header, body);
    }

    // Footer: Discard reverts unsaved profile edits; Done closes the drawer.
    const footer = el('vgext-sheet-footer');
    const hint = el('vgext-sheet-footer-hint');
    hint.textContent = 'Save cards in each tab · Title-bar Save* persists the profile · Esc closes';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'vgext-sheet-footbtn ghost';
    discard.textContent = 'Discard';
    discard.title = 'Revert unsaved profile changes and close';
    discard.addEventListener('click', () => { void this.discardAndClose(); });
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'vgext-sheet-footbtn action';
    done.textContent = 'Done';
    done.setAttribute('data-testid', 'vgext-sheet-done');
    done.addEventListener('click', () => this.closeSettings());
    footer.append(hint, discard, done);
    this.sheet.append(footer);

    this.live = entry.module.mount(body, entry.ctx);
  }

  private profilesCtx(): VelocityGridExtContext | null {
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
      this.navCleanup?.();
      this.navCleanup = null;
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
    this.navCleanup?.();
    this.navCleanup = null;
    this.live?.destroy();
    this.live = null;
    for (const inst of this.toolbarInstances) inst?.destroy();
    this.toolbarInstances = [];
    this.modules.clear();
    this.root.replaceChildren();
    this.root.classList.remove('vgext-root');
  }
}

function el(cls: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
/** Get-or-create a stable named child of `parent`. */
function sub(parent: HTMLElement, name: string): HTMLElement {
  const key = `vgext-slot-${name}`;
  let found = parent.querySelector<HTMLElement>(`:scope > .${key}`);
  if (!found) { found = el(key); parent.appendChild(found); }
  return found;
}

/** Inject the shell chrome CSS once per document. Kept in JS (not a
 *  separate .css import) so `@wellsfargo-starui/velocity-grid-ext` stays source-direct and consumers
 *  don't need a second import. Every color derives from the grid's `--vg-*`
 *  theme tokens with a dark fallback, so the chrome matches the active
 *  theme and still looks intentional when no theme is set. */
function injectShellStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('vgext-shell-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'vgext-shell-styles';
    document.head.appendChild(style);
  }
  style.textContent = SHELL_CSS;
}

const SHELL_CSS = `
.vgext-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--vg-fg-color, #e5e9f0);
  /* Flat 2px corners for all chrome that reads --vg-radius (inputs, buttons,
     menus, etc.). Pills / switches / avatars hardcode their own radii. */
  --vg-radius: 2px;
  /* Inter everywhere — ride the theme's font token (kernel themes set
     --vg-font-family to the Inter stack); graceful system fallback. */
  font: 13px/1.4 var(--vg-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
/* Body-mounted popups sit outside .vgext-root — pin the same 2px radius. */
.vgext-menu,
.vgext-ip-panel {
  --vg-radius: 2px;
}
.vgext-titlebar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 8px;
  row-gap: 8px;
  min-height: 48px;
  height: auto;
  padding: 8px 14px;
  background: var(--vg-header-bg, var(--vg-popup-bg, #171c26));
  border-bottom: 1px solid var(--vg-border-color, #2a3140);
}
/* Left cluster shrinks into remaining space; basis forces the right
 * utilities onto a second row before either side can overflow/overlap. */
.vgext-titlebar > .vgext-slot-primary-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 280px;
}
.vgext-titlebar > .vgext-slot-primary-center {
  flex: 1 1 160px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.vgext-titlebar > .vgext-slot-primary-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-left: auto;
  flex: 0 1 auto;
  max-width: 100%;
}
.vgext-titlebar > .vgext-slot-primary-left > .vgext-toolbar-item[data-item-id="brand"] {
  flex: 0 0 auto;
}
.vgext-titlebar > .vgext-slot-primary-left > .vgext-toolbar-item[data-item-id="saved-filters"] {
  flex: 1 1 auto;
  min-width: 0;
}
.vgext-titlebar > .vgext-slot-primary-right > .vgext-toolbar-item {
  flex: 0 0 auto;
}
.vgext-ribbon:empty,
.vgext-ribbon[hidden] { display: none; }
.vgext-grid { flex: 1 1 auto; min-height: 0; position: relative; }

.vgext-toolbar-item { display: inline-flex; align-items: center; min-width: 0; }
.vgext-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--vg-radius, 2px);
  background: transparent;
  color: var(--vg-fg-color, #e5e9f0);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.vgext-btn:hover { background: var(--vg-row-alt-bg, rgba(255, 255, 255, 0.06)); }
.vgext-btn:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: 1px; }
.vgext-btn:disabled { color: var(--vg-muted-fg-color, #7f8798); cursor: default; opacity: 0.65; }
.vgext-btn:disabled:hover { background: transparent; }
/* Save button reflects a dirty profile — accent when actionable. */
.vgext-btn.vgext-save:not(:disabled) {
  background: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
  border-color: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
  color: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
}
.vgext-btn.vgext-save:not(:disabled):hover { filter: brightness(1.08); }

.vgext-sheet {
  /* Full viewport height — not clipped to the grid host / lab chrome box. */
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(680px, 92vw);
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 3.5%, transparent) 0,
      transparent 48px),
    var(--vg-popup-bg, #12161f);
  border-left: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 88%, transparent);
  box-shadow:
    -1px 0 0 color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 4%, transparent),
    -24px 0 48px rgba(0, 0, 0, 0.42);
  z-index: 200;
  transform: translateX(18px);
  opacity: 0;
  pointer-events: none;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease;
}
.vgext-sheet.is-open {
  transform: none;
  opacity: 1;
  pointer-events: auto;
}
.vgext-sheet[hidden] { display: none !important; }
.vgext-sheet-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 12px 10px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
}
.vgext-sheet-titles {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vgext-sheet-eyebrow {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--vg-muted-fg-color, #8a93a6) 92%, transparent);
}
.vgext-sheet-title {
  font-weight: 650;
  font-size: 15px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--vg-fg-color, #e5e9f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vgext-sheet-close {
  appearance: none;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--vg-radius, 2px);
  background: transparent;
  color: var(--vg-muted-fg-color, #8a93a6);
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.vgext-sheet-close:hover {
  background: var(--vg-row-alt-bg, rgba(255, 255, 255, 0.06));
  border-color: color-mix(in srgb, var(--vg-border-color, #2a3140) 80%, transparent);
  color: var(--vg-fg-color, #e5e9f0);
}
.vgext-sheet-close:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: 1px; }
/* Category menubar — few stable dropdowns instead of a long tab strip. */
.vgext-sheet-nav-wrap {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 0;
  min-width: 0;
  position: relative;
  z-index: 2;
  border-bottom: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 2%, transparent);
}
.vgext-sheet-nav {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
  padding: 6px 10px;
}
.vgext-sheet-nav-group {
  position: relative;
  flex: 0 0 auto;
}
.vgext-sheet-nav-group-trigger {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--vg-radius, 2px);
  background: transparent;
  color: var(--vg-muted-fg-color, #8a93a6);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}
.vgext-sheet-nav-group-chevron {
  display: inline-flex;
  opacity: 0.7;
  transition: transform 140ms ease, opacity 140ms ease;
}
.vgext-sheet-nav-group-trigger:hover,
.vgext-sheet-nav-group.is-open .vgext-sheet-nav-group-trigger {
  color: var(--vg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 5%, transparent);
  border-color: color-mix(in srgb, var(--vg-border-color, #2a3140) 70%, transparent);
}
.vgext-sheet-nav-group-trigger.is-active {
  color: var(--vg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 10%, transparent);
  border-color: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 35%, transparent);
}
.vgext-sheet-nav-group.is-open .vgext-sheet-nav-group-chevron {
  transform: rotate(180deg);
  opacity: 1;
}
.vgext-sheet-nav-group-trigger:focus-visible {
  outline: 2px solid var(--vg-accent-color, #4f9cf9);
  outline-offset: 1px;
}
.vgext-sheet-nav-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 200px;
  max-width: min(280px, 80vw);
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 90%, transparent);
  border-radius: var(--vg-radius, 2px);
  background: var(--vg-popup-bg, #12161f);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  z-index: 5;
}
.vgext-sheet-nav-menu[hidden] { display: none !important; }
.vgext-sheet-nav-menu-item {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--vg-radius, 2px);
  background: transparent;
  color: var(--vg-fg-color, #e5e9f0);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.vgext-sheet-nav-menu-item:hover {
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 6%, transparent);
}
.vgext-sheet-nav-menu-item.is-active {
  color: var(--vg-accent-color, #4f9cf9);
  background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 10%, transparent);
}
.vgext-sheet-nav-menu-item:focus-visible {
  outline: 2px solid var(--vg-accent-color, #4f9cf9);
  outline-offset: -2px;
}
.vgext-sheet-nav-icon {
  display: inline-flex;
  opacity: 0.75;
  flex: 0 0 auto;
}
.vgext-sheet-nav-menu-item.is-active .vgext-sheet-nav-icon,
.vgext-sheet-nav-menu-item:hover .vgext-sheet-nav-icon {
  opacity: 1;
}
.vgext-sheet-nav-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vgext-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px 16px 24px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--vg-muted-fg-color, #8a93a6) 35%, transparent) transparent;
}
/* Kernel tool panels (Options / Column Groups) fill the body edge-to-edge. */
.vgext-sheet-body:has(> .vgext-sheet-toolpanel) {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.vgext-sheet-toolpanel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.vgext-sheet-toolpanel > .vg-settings-panel,
.vgext-sheet-toolpanel > .vg-colgroups-panel {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.vgext-sheet-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 14px;
  border-top: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 2.5%, transparent);
}
.vgext-sheet-footer-hint {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 10px;
  font-weight: 550;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--vg-muted-fg-color, #8a93a6) 88%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vgext-sheet-footbtn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--vg-radius, 2px);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, filter 120ms ease;
}
.vgext-sheet-footbtn.ghost {
  background: transparent;
  color: var(--vg-muted-fg-color, #8a93a6);
}
.vgext-sheet-footbtn.ghost:hover {
  color: var(--vg-fg-color, #e5e9f0);
  background: var(--vg-row-alt-bg, rgba(255, 255, 255, 0.06));
}
.vgext-sheet-footbtn.action {
  background: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
  border-color: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
  color: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
}
.vgext-sheet-footbtn.action:hover { filter: brightness(1.08); }
.vgext-sheet-footbtn:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .vgext-sheet { transition: none; }
  .vgext-sheet-nav-group-chevron { transition: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .vgext-btn, .vgext-sheet-close, .vgext-sheet-nav-group-trigger, .vgext-sheet-nav-menu-item {
    transition-duration: 120ms;
  }
}
`;
