import type { VelocityGridExtension, VelocityGridExtContext, SettingsModule, ToolbarItem } from './types';
import { isSettingsModule, isToolbarItem } from './types';

/** How a consumer mutates the default bundle via `options.ext.extensions`. */
export type ExtensionSpec =
  | VelocityGridExtension
  | { remove: string }
  | { id: string; factory: () => VelocityGridExtension };

export class ExtensionRegistry {
  private map = new Map<string, VelocityGridExtension>();
  private order: string[] = [];

  register(ext: VelocityGridExtension): void {
    if (!this.map.has(ext.id)) this.order.push(ext.id);
    this.map.set(ext.id, ext);
  }

  remove(id: string): void {
    if (this.map.delete(id)) this.order = this.order.filter(x => x !== id);
  }

  has(id: string): boolean { return this.map.has(id); }
  get(id: string): VelocityGridExtension | undefined { return this.map.get(id); }
  all(): VelocityGridExtension[] { return this.order.map(id => this.map.get(id)!); }

  settingsModules(): SettingsModule[] { return this.all().filter(isSettingsModule); }
  toolbarItems(): ToolbarItem[] { return this.all().filter(isToolbarItem); }

  /** Apply a consumer override list on top of the current registry. */
  applySpecs(specs: ExtensionSpec[] | undefined): void {
    for (const s of specs ?? []) {
      if ('remove' in s) this.remove(s.remove);
      else if ('factory' in s) {
        const instance = s.factory();
        // The spec's own `id` is purely a lookup convenience — registration
        // always keys off the built instance's `id`. A mismatch is almost
        // always a copy/paste bug (wrong id in the spec, or the factory
        // returning the wrong extension), so warn instead of registering
        // something the caller didn't expect under a silently different id.
        if (instance.id !== s.id) {
          console.warn(
            `[velocity-grid-ext] extension spec id "${s.id}" does not match its `
            + `built instance id "${instance.id}" — registering under "${instance.id}"`,
          );
        }
        this.register(instance);
      } else this.register(s);
    }
  }

  /** Isolated so one extension's `init()` throwing can never prevent the
   *  others from initializing (mirrors `disposeAll`'s isolation below —
   *  same reasoning: a single broken extension must not take the whole
   *  shell down with it). */
  initAll(ctx: VelocityGridExtContext): void {
    for (const e of this.all()) {
      try {
        e.init(ctx);
      } catch (err) {
        console.warn(`[velocity-grid-ext] extension "${e.id}" threw during init()`, err);
      }
    }
  }
  /** Tears down every registered extension. Each `dispose()` is isolated in
   *  its own try/catch — a throwing extension is logged and skipped so it
   *  can never abort teardown for the rest of the registry (and, upstream,
   *  can never prevent the kernel Worker from being released). */
  disposeAll(): void {
    for (const e of this.all()) {
      try {
        e.dispose?.();
      } catch (err) {
        console.warn(`[velocity-grid-ext] extension "${e.id}" threw during dispose()`, err);
      }
    }
    this.map.clear();
    this.order = [];
  }
}
