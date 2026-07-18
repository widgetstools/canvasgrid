import { CGrid } from '@cgrid/kernel';
import type { CGridOptions, GridState } from '@cgrid/kernel';
import { ExtensionRegistry, type ExtensionSpec } from './extension/registry';
import { ShellLayout } from './shell/shell';
import { createExtContext } from './extension/context';
import { ProfilesController } from './profiles/controller';
import { LocalStorageProfileStore } from './profiles/localStorageStore';
import { isSettingsModule, isToolbarItem, type CgExtContext, type ProfileStore } from './extension/types';
import { buildDefaultBundle } from './defaultBundle';

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
    // Mirror a string theme class onto the shell root so the kernel's
    // `--cg-*` theme tokens (defined on the grid's own `.cg-theme-*` element)
    // cascade to CGridExt's chrome (title bar, settings drawer) — otherwise
    // the chrome, a sibling of the grid, would fall back to its neutral dark
    // defaults instead of matching the active theme.
    if (typeof gridOptions.theme === 'string') {
      container.classList.add(gridOptions.theme);
    }
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

    // Seed / restore the active profile so the switcher is never empty and
    // `initialId` actually loads. Fire-and-forget — chrome re-syncs via
    // onListChange when the store settles.
    void this.profiles.bootstrap();
  }

  /** Registers the built-in bundle (settings launcher, save, grid options)
   *  before consumer specs layer on top. Runs after `this.ctx`/`this.shell`
   *  are assigned in the constructor, so both are safe to reference here. */
  protected registerDefaults(): void {
    for (const e of buildDefaultBundle()) this.registry.register(e);
    // Wire the settings launcher's event to the shell.
    this.ctx.events.on('open-settings', (e) =>
      this.shell.openSettings((e as { id?: string }).id));
  }

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

  /** Registry → shell → grid, in that order — but the kernel Worker MUST be
   *  released even if registry or shell teardown throws, so grid.destroy()
   *  runs in an outer `finally` (and shell.destroy() in an inner one). */
  destroy(): void {
    try {
      this.registry.disposeAll();
    } finally {
      try {
        this.shell.destroy();
      } finally {
        this._grid.destroy();
      }
    }
  }
}
