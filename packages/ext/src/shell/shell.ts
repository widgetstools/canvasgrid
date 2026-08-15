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
import { delegateProfiles } from '../extension/context';

/** Lucide name aliases for module.icon values that aren't 1:1 catalog keys. */
const MODULE_ICON_ALIAS: Record<string, string> = {
  sliders: 'sliders-horizontal',
  columns: 'columns-3',
  wand: 'sparkles',
};

/** Customize drawer top tabs — screenshot grammar (Cursor colors elsewhere). */
export type CustomizerTabId =
  | 'options'
  | 'columns'
  | 'styling'
  | 'editing'
  | 'data';

const TAB_ORDER: readonly CustomizerTabId[] = [
  'options',
  'columns',
  'styling',
  'editing',
  'data',
];

const TAB_LABELS: Record<CustomizerTabId, string> = {
  options: 'Options',
  columns: 'Columns',
  styling: 'Styling',
  editing: 'Editing',
  data: 'Data',
};

/** Prefer module id for COLUMNS vs OPTIONS; fall back to ModuleCategory. */
export function tabForModule(mod: SettingsModule): CustomizerTabId {
  switch (mod.id) {
    case 'grid-options':
      return 'options';
    case 'column-settings':
    case 'column-groups':
    case 'calculated-columns':
      return 'columns';
    case 'conditional-styling':
    case 'alerts':
      return 'styling';
    case 'data-provider':
    case 'perspective-data-provider':
    case 'expression-lab':
      return 'data';
    default:
      break;
  }
  const cat: ModuleCategory = mod.category || 'workspace';
  if (cat === 'format') return 'styling';
  if (cat === 'editing') return 'editing';
  if (cat === 'data') return 'data';
  if (cat === 'layout') return 'options';
  return 'options';
}

interface ModuleNavGroup {
  id: CustomizerTabId;
  label: string;
  modules: SettingsModule[];
}

/** Bucket registered modules into Options/Columns/Styling/Editing/Data tabs. */
export function groupModulesForNav(
  modules: Iterable<SettingsModule>,
): ModuleNavGroup[] {
  const byTab = new Map<CustomizerTabId, SettingsModule[]>();
  for (const mod of modules) {
    const key = tabForModule(mod);
    const list = byTab.get(key);
    if (list) list.push(mod);
    else byTab.set(key, [mod]);
  }

  const groups: ModuleNavGroup[] = [];
  for (const id of TAB_ORDER) {
    const members = byTab.get(id);
    if (!members?.length) continue;
    groups.push({ id, label: TAB_LABELS[id], modules: members });
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
  /** Last module opened per customize tab (restore on tab re-click). */
  private lastModuleByTab = new Map<CustomizerTabId, string>();
  /** Footer session/profile subscriptions for the open sheet. */
  private sheetUnsub: Array<() => void> = [];
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Drop the live pane and session listeners. Commit only when navigating
   *  between modules so a draft is not lost; Esc/X must not flush. */
  private detachSheet(opts: { commit: boolean }): void {
    if (opts.commit) {
      try { this.live?.commit?.(); } catch { /* draft flush is best-effort */ }
    }
    this.live?.destroy();
    this.live = null;
    for (const off of this.sheetUnsub) {
      try { off(); } catch { /* */ }
    }
    this.sheetUnsub = [];
  }

  private renderSheet(id: string): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.detachSheet({ commit: true });
    this.sheet.replaceChildren();
    this.activeId = id;
    const entry = this.modules.get(id)!;
    const groups = groupModulesForNav([...this.modules.values()].map((m) => m.module));
    const activeGroup = groups.find((g) => g.modules.some((m) => m.id === id));
    if (activeGroup) this.lastModuleByTab.set(activeGroup.id, id);

    // Drawer header: product label + module title + close.
    const header = el('vgext-sheet-header');
    const titles = el('vgext-sheet-titles');
    const eyebrow = el('vgext-sheet-eyebrow');
    eyebrow.textContent = 'Customize';
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

    const body = el('vgext-sheet-body');
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', 'vgext-sheet-title');

    if (this.modules.size > 1) {
      const wrap = el('vgext-sheet-nav-wrap');

      const nav = el('vgext-sheet-nav');
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-label', 'Settings categories');
      nav.setAttribute('data-testid', 'vgext-sheet-nav');

      for (const group of groups) {
        const containsActive = group.modules.some((m) => m.id === id);
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'vgext-sheet-nav-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', containsActive ? 'true' : 'false');
        tab.setAttribute('data-testid', `vgext-sheet-nav-tab-${group.id}`);
        tab.dataset.tabId = group.id;
        if (containsActive) tab.classList.add('is-active');
        tab.textContent = group.label;
        tab.addEventListener('click', () => {
          if (containsActive) return;
          const remembered = this.lastModuleByTab.get(group.id);
          const target =
            (remembered && group.modules.some((m) => m.id === remembered)
              ? remembered
              : group.modules[0]?.id) ?? null;
          if (target && target !== this.activeId) this.renderSheet(target);
        });
        nav.appendChild(tab);
      }

      const crumb = el('vgext-sheet-nav-crumb');
      crumb.setAttribute('data-testid', 'vgext-sheet-nav-crumb');
      const crumbCat = el('vgext-sheet-nav-crumb-cat');
      crumbCat.textContent = activeGroup?.label ?? 'Customize';
      const crumbSep = el('vgext-sheet-nav-crumb-sep');
      crumbSep.textContent = '·';
      crumbSep.setAttribute('aria-hidden', 'true');
      const crumbMod = el('vgext-sheet-nav-crumb-mod');
      crumbMod.textContent = entry.module.title;
      crumb.append(crumbCat, crumbSep, crumbMod);

      wrap.append(nav, crumb);
      this.sheet.append(header, wrap);

      // Sibling modules within the active tab (e.g. Column Settings / Groups).
      if (activeGroup && activeGroup.modules.length > 1) {
        const sub = el('vgext-sheet-subnav');
        sub.setAttribute('role', 'tablist');
        sub.setAttribute('aria-label', `${activeGroup.label} modules`);
        sub.setAttribute('data-testid', 'vgext-sheet-subnav');
        for (const mod of activeGroup.modules) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'vgext-sheet-subnav-tab';
          item.setAttribute('role', 'tab');
          item.setAttribute('aria-selected', mod.id === id ? 'true' : 'false');
          item.setAttribute('data-testid', `vgext-sheet-nav-item-${mod.id}`);
          item.dataset.moduleId = mod.id;
          if (mod.id === id) item.classList.add('is-active');
          item.textContent = mod.title;
          item.addEventListener('click', () => {
            if (mod.id !== this.activeId) this.renderSheet(mod.id);
          });
          sub.appendChild(item);
        }
        this.sheet.append(sub);
      }

      this.sheet.append(body);
    } else {
      this.sheet.append(header, body);
    }

    // Footer: live session status. Discard reverts; Done commits once.
    const footer = el('vgext-sheet-footer');
    const hint = el('vgext-sheet-footer-hint');
    const ctx = entry.ctx;
    const renderHint = (): void => {
      const n = ctx.session.pendingCount();
      const dirty = ctx.session.isDirty() || ctx.profiles.isDirty();
      hint.textContent = dirty
        ? `${Math.max(n, 1)} unsaved change${Math.max(n, 1) === 1 ? '' : 's'}`
        : 'All changes saved';
    };
    renderHint();
    this.sheetUnsub.push(ctx.session.onChange(renderHint));
    this.sheetUnsub.push(ctx.profiles.onDirtyChange(renderHint));
    const shortcuts = el('vgext-sheet-footer-keys');
    shortcuts.textContent = 'Esc · close';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'vgext-sheet-footbtn ghost';
    discard.textContent = 'Discard';
    discard.title = 'Revert unsaved changes and close';
    discard.addEventListener('click', () => { void this.discardAndClose(); });
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'vgext-sheet-footbtn action';
    done.textContent = 'Done';
    done.setAttribute('data-testid', 'vgext-sheet-done');
    done.addEventListener('click', () => { void this.commitAndClose(); });
    footer.append(hint, shortcuts, discard, done);
    this.sheet.append(footer);

    // `{ ...ctx.profiles }` would copy only own-enumerable properties —
    // ProfileController's real methods live on ProfilesController's
    // prototype, so a plain spread silently drops `isDirty`/`activeId`/
    // `saveAs`/`switchTo`/etc. and any module calling them would throw.
    // `delegateProfiles` keeps every member reachable (correctly bound to
    // the real controller — see its doc comment for why a naive
    // `Object.create` wrapper is unsafe here) and only overrides
    // `markDirty` to also stage the drawer session.
    const moduleCtx: VelocityGridExtContext = {
      ...ctx,
      profiles: delegateProfiles(ctx.profiles, {
        markDirty: () => {
          ctx.profiles.markDirty();
          ctx.session.stage(id);
        },
      }),
    };
    this.live = entry.module.mount(body, moduleCtx);
  }

  private profilesCtx(): VelocityGridExtContext | null {
    return this.modules.values().next().value?.ctx ?? null;
  }

  /** Persist staged drawer edits once, then close. */
  private async commitAndClose(): Promise<void> {
    try { this.live?.commit?.(); } catch { /* draft flush is best-effort */ }
    const ctx = this.profilesCtx();
    try {
      if (ctx?.profiles.isDirty() || ctx?.session.isDirty()) await ctx.profiles.save();
    } catch { /* store miss — still close */ }
    ctx?.session.clear();
    this.closeSettings();
  }

  /** Reload the active profile snapshot (if dirty), then close. */
  private async discardAndClose(): Promise<void> {
    const ctx = this.profilesCtx();
    try {
      if (ctx?.profiles.isDirty()) await ctx.profiles.discard();
    } catch { /* store miss — still close */ }
    ctx?.session.clear();
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
      this.closeTimer = null;
      this.detachSheet({ commit: false });
      this.activeId = null;
      this.sheet.hidden = true;
      this.sheet.replaceChildren();
    };
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !wasOpen) {
      finish();
      return;
    }
    this.closeTimer = setTimeout(finish, 180);
  }

  isSettingsOpen(): boolean { return !this.sheet.hidden; }

  destroy(): void {
    this.unbindEscape();
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.detachSheet({ commit: false });
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
.vgext-btn:focus-visible { outline: 2px solid var(--vg-chrome-accent); outline-offset: 1px; }
.vgext-btn:disabled { color: var(--vg-muted-fg-color, #7f8798); cursor: default; opacity: 0.65; }
.vgext-btn:disabled:hover { background: transparent; }
/* Save button reflects a dirty profile — accent when actionable. */
.vgext-btn.vgext-save:not(:disabled) {
  background: var(--vg-primary-color, var(--vg-chrome-accent));
  border-color: var(--vg-primary-color, var(--vg-chrome-accent));
  color: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
}
.vgext-btn.vgext-save:not(:disabled):hover { filter: brightness(1.08); }

.vgext-sheet {
  /* Full viewport height — not clipped to the grid host / lab chrome box. */
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(760px, 94vw);
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
.vgext-sheet-close:focus-visible { outline: 2px solid var(--vg-chrome-accent); outline-offset: 1px; }
/* Category underline tabs + right breadcrumb (screenshot grammar). */
.vgext-sheet-nav-wrap {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 12px;
  min-width: 0;
  position: relative;
  z-index: 2;
  border-bottom: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
  padding: 0 14px 0 10px;
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 2%, transparent);
}
.vgext-sheet-nav {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 0;
  min-width: 0;
  overflow-x: auto;
}
.vgext-sheet-nav-tab {
  appearance: none;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--vg-muted-fg-color, #8a93a6);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: inset 0 -2px 0 transparent;
  transition: color 140ms ease, box-shadow 140ms ease;
}
.vgext-sheet-nav-tab:hover {
  color: var(--vg-fg-color, #e5e9f0);
}
.vgext-sheet-nav-tab.is-active {
  color: var(--vg-fg-color, #e5e9f0);
  box-shadow: inset 0 -2px 0 var(--vg-chrome-accent);
}
.vgext-sheet-nav-tab:focus-visible {
  outline: 2px solid var(--vg-chrome-accent);
  outline-offset: -2px;
}
.vgext-sheet-nav-crumb {
  flex: 0 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 42%;
  margin-left: auto;
  padding: 0 2px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--vg-muted-fg-color, #8a93a6) 92%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vgext-sheet-nav-crumb-cat { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vgext-sheet-nav-crumb-sep { flex: 0 0 auto; opacity: 0.55; }
.vgext-sheet-nav-crumb-mod {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vg-fg-color, #e5e9f0);
}
.vgext-sheet-subnav {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: nowrap;
  gap: 0;
  min-width: 0;
  overflow-x: auto;
  padding: 0 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 70%, transparent);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 1.25%, transparent);
}
.vgext-sheet-subnav-tab {
  appearance: none;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 11px;
  border: none;
  background: transparent;
  color: var(--vg-muted-fg-color, #8a93a6);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  letter-spacing: 0.01em;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: inset 0 -2px 0 transparent;
  transition: color 120ms ease, box-shadow 120ms ease;
}
.vgext-sheet-subnav-tab:hover { color: var(--vg-fg-color, #e5e9f0); }
.vgext-sheet-subnav-tab.is-active {
  color: var(--vg-fg-color, #e5e9f0);
  box-shadow: inset 0 -2px 0 var(--vg-chrome-accent);
}
.vgext-sheet-subnav-tab:focus-visible {
  outline: 2px solid var(--vg-chrome-accent);
  outline-offset: -2px;
}
.vgext-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px 16px 24px;
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
.vgext-sheet-footer-keys {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--vg-muted-fg-color, #8a93a6) 72%, transparent);
  white-space: nowrap;
}
.vgext-sheet-footbtn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: var(--vg-radius, 2px);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
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
  background: var(--vg-chrome-accent);
  border-color: var(--vg-chrome-accent);
  color: var(--vg-checkbox-checked-fg, #FCFCFC);
  font-weight: 600;
}
.vgext-sheet-footbtn.action:hover { filter: brightness(1.08); }
.vgext-sheet-footbtn:focus-visible { outline: 2px solid var(--vg-chrome-accent); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .vgext-sheet { transition: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .vgext-btn, .vgext-sheet-close, .vgext-sheet-nav-tab, .vgext-sheet-subnav-tab {
    transition-duration: 120ms;
  }
}
`;
