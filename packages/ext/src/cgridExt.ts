import { CGrid } from '@cgrid/kernel';
import type { CGridOptions, GridState } from '@cgrid/kernel';
import { ExtensionRegistry, type ExtensionSpec } from './extension/registry';
import { ShellLayout } from './shell/shell';
import { createExtContext } from './extension/context';
import { ProfilesController } from './profiles/controller';
import { LocalStorageProfileStore } from './profiles/localStorageStore';
import { isSettingsModule, isToolbarItem, type CgExtContext, type ProfileStore } from './extension/types';

export interface CGridExtOptions<TRow = any> extends CGridOptions<TRow> {
  ext?: {
    extensions?: ExtensionSpec[];
    profiles?: { store?: ProfileStore; initialId?: string };
    modules?: Record<string, unknown>;
  };
}

/** Batteries-included wrapper: owns a CGrid + an ExtensionRegistry, wires
 *  every extension to the kernel through a shared context, and lays the
 *  grid + tooling out via ShellLayout. */
export class CGridExt<TRow = any> {
  private _grid: CGrid<TRow>;
  private shell: ShellLayout;
  private registry = new ExtensionRegistry();
  private profiles: ProfilesController;
  private ctx: CgExtContext;

  constructor(container: HTMLElement, options: CGridExtOptions<TRow> = {} as any) {
    const { ext, ...gridOptions } = options;
    this.shell = new ShellLayout(container);
    this._grid = new CGrid<TRow>(this.shell.gridMount, gridOptions as CGridOptions<TRow>);

    const store = ext?.profiles?.store ?? new LocalStorageProfileStore();
    this.profiles = new ProfilesController(this._grid, store, {
      initialId: ext?.profiles?.initialId ?? 'default',
    });
    this.ctx = createExtContext(this._grid, this.profiles);

    // Default bundle is registered by subclass hook / Task 9 wiring first,
    // then consumer specs layer on top (add / remove / replace).
    this.registerDefaults();
    this.registry.applySpecs(ext?.extensions);

    this.registry.initAll(this.ctx);
    for (const e of this.registry.all()) {
      if (isSettingsModule(e)) this.shell.mountSettingsModule(e, this.ctx);
      else if (isToolbarItem(e)) this.shell.mountToolbarItem(e, this.ctx);
    }
  }

  /** Overridden/populated in Task 9 to register the built-in bundle. */
  protected registerDefaults(): void { /* bundle wired in Task 9 */ }

  get grid(): CGrid<TRow> { return this._grid; }

  setRowData(rows: TRow[]): void { this._grid.setRowData(rows); }
  getState(): GridState { return this._grid.getState(); }
  // Kernel `setState` is typed to take a full `GridState`, but at runtime
  // every field is optional — each step is a no-op when the snapshot omits
  // the corresponding slice (see cgrid.ts `setState` docblock, and the same
  // cast in extension/context.ts). Cast localized to this composition
  // boundary; `CGridExt.setState`'s own signature stays the accurate
  // `Partial<GridState>` contract for callers.
  setState(state: Partial<GridState>): void { this._grid.setState(state as GridState); }
  on(type: string, fn: (e: unknown) => void): () => void {
    return this._grid.addEventListener(type as any, fn as any);
  }

  openSettings(id?: string): void { this.shell.openSettings(id); }
  closeSettings(): void { this.shell.closeSettings(); }

  destroy(): void {
    this.registry.disposeAll();
    this.shell.destroy();
    this._grid.destroy();
  }
}
