import type {
  CgExtContext, SettingsModule, ToolbarItem, ToolbarSlot, ModuleInstance,
} from '../extension/types';

/** The shell is a vertical stack of DOM strips wrapping the kernel canvas:
 *
 *    [ .cgext-titlebar ]   primary toolbar slots
 *    [ .cgext-ribbon   ]   toggleable ribbon sections
 *    [ .cgext-grid     ]   ← caller mounts the CGrid here
 *    [ .cgext-sheet    ]   settings drawer (hidden until opened)
 *
 *  Reserving the strips above the canvas is exactly how the kernel already
 *  handles rowGroupPanel/statusBar, so the canvas viewport sizes correctly.
 */
export class ShellLayout {
  readonly gridMount: HTMLElement;
  private titlebar: HTMLElement;
  private ribbon: HTMLElement;
  private sheet: HTMLElement;
  private modules = new Map<string, { module: SettingsModule; ctx: CgExtContext }>();
  private openModuleId: string | null = null;
  private live: ModuleInstance | null = null;

  constructor(private root: HTMLElement) {
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
    item.render(host, ctx);
  }

  mountSettingsModule(module: SettingsModule, ctx: CgExtContext): void {
    this.modules.set(module.id, { module, ctx });
  }

  openSettings(id?: string): void {
    const target = id ?? this.modules.keys().next().value;
    if (!target || !this.modules.has(target)) return;
    this.renderSheet(target);
    this.sheet.hidden = false;
    this.openModuleId = target;
  }

  private renderSheet(id: string): void {
    this.live?.destroy();
    this.sheet.replaceChildren();
    const body = sub(this.sheet, 'body');
    const entry = this.modules.get(id)!;
    this.live = entry.module.mount(body, entry.ctx);
  }

  closeSettings(): void {
    this.live?.destroy();
    this.live = null;
    this.sheet.hidden = true;
    this.openModuleId = null;
  }

  isSettingsOpen(): boolean { return !this.sheet.hidden; }

  destroy(): void {
    this.live?.destroy();
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
