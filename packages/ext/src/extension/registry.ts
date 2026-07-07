import type { CgExtension, CgExtContext, SettingsModule, ToolbarItem } from './types';
import { isSettingsModule, isToolbarItem } from './types';

/** How a consumer mutates the default bundle via `options.ext.extensions`. */
export type ExtensionSpec =
  | CgExtension
  | { remove: string }
  | { id: string; factory: () => CgExtension };

export class ExtensionRegistry {
  private map = new Map<string, CgExtension>();
  private order: string[] = [];

  register(ext: CgExtension): void {
    if (!this.map.has(ext.id)) this.order.push(ext.id);
    this.map.set(ext.id, ext);
  }

  remove(id: string): void {
    if (this.map.delete(id)) this.order = this.order.filter(x => x !== id);
  }

  has(id: string): boolean { return this.map.has(id); }
  get(id: string): CgExtension | undefined { return this.map.get(id); }
  all(): CgExtension[] { return this.order.map(id => this.map.get(id)!); }

  settingsModules(): SettingsModule[] { return this.all().filter(isSettingsModule); }
  toolbarItems(): ToolbarItem[] { return this.all().filter(isToolbarItem); }

  /** Apply a consumer override list on top of the current registry. */
  applySpecs(specs: ExtensionSpec[] | undefined): void {
    for (const s of specs ?? []) {
      if ('remove' in s) this.remove(s.remove);
      else if ('factory' in s) this.register(s.factory());
      else this.register(s);
    }
  }

  initAll(ctx: CgExtContext): void { for (const e of this.all()) e.init(ctx); }
  disposeAll(): void {
    for (const e of this.all()) e.dispose?.();
    this.map.clear();
    this.order = [];
  }
}
