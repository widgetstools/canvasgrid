/**
 * Cycle 11 / Task 1 — ToolPanelRegistry.
 *
 * Plain `Map<id, ctor>` wrapper that owns tool-panel component
 * registration. The VelocityGrid constructor seeds the built-in IDs
 * (`agColumnsToolPanel`, `agFiltersToolPanel`) via `seedBuiltIns()`
 * and then merges `VelocityGridOptions.components` entries on top — apps
 * can either add new IDs or override the built-in implementations
 * by registering against the same key.
 *
 * The registry is intentionally framework-agnostic: it knows nothing
 * about the side bar, VelocityGrid, or the catalog. The Task 2 side-bar
 * host consumes `resolve(id)` to instantiate panels on demand.
 *
 * Task 1 ships the built-ins as inert stubs (empty `<div>` GUI, no-op
 * `refresh` / `destroy`) so the registry surface is testable end-to-end.
 * Tasks 3 + 4 replace those stubs with the real Columns / Filters panel
 * classes via `register('agColumnsToolPanel', ColumnsToolPanel)`.
 */
import type { ToolPanel, ToolPanelComponent, ToolPanelParams } from './types';

/** Built-in stub panel. The class itself is the contract that future
 *  tasks (Tasks 3 + 4) replace via `register(id, RealCtor)`. */
class StubBuiltInPanel implements ToolPanel {
  private gui: HTMLDivElement = document.createElement('div');
  init(_params: ToolPanelParams): void {
    // No-op; the stub renders an empty root. The real panels land in
    // Tasks 3 + 4 and override this id via `registry.register`.
    this.gui.className = 'vg-tool-panel-stub';
  }
  getGui(): HTMLElement {
    return this.gui;
  }
  refresh(): void {
    // No-op for the stub.
  }
  destroy(): void {
    // No-op for the stub.
  }
}

export class ToolPanelRegistry {
  private components = new Map<string, ToolPanelComponent>();

  /** Register a tool-panel component under `id`. If `id` already has
   *  a registration (e.g. a built-in), the new ctor wins — apps
   *  override built-ins by registering against the same key. */
  register(id: string, ctor: ToolPanelComponent): void {
    this.components.set(id, ctor);
  }

  /** Look up the ctor for `id`. Returns `null` when no component
   *  has been registered against that key. */
  resolve(id: string): ToolPanelComponent | null {
    return this.components.get(id) ?? null;
  }

  /** Construct a panel for `id` and call `init(params)`. Returns the
   *  initialised instance, or `null` when `id` is unknown. The host
   *  is responsible for mounting `instance.getGui()` into the DOM. */
  instantiate(id: string, params: ToolPanelParams): ToolPanel | null {
    const Ctor = this.resolve(id);
    if (!Ctor) return null;
    const instance = new Ctor();
    instance.init(params);
    return instance;
  }

  /** Seed the built-in IDs with stub implementations. Called once at
   *  VelocityGrid construction BEFORE merging `VelocityGridOptions.components`, so
   *  app-supplied entries can override the stubs (and the future
   *  real implementations from Tasks 3 + 4). */
  seedBuiltIns(): void {
    if (!this.components.has('agColumnsToolPanel')) {
      this.components.set('agColumnsToolPanel', StubBuiltInPanel);
    }
    if (!this.components.has('agFiltersToolPanel')) {
      this.components.set('agFiltersToolPanel', StubBuiltInPanel);
    }
  }

  /** Every registered id. Order is insertion-order (Map semantics);
   *  callers that need a stable view should sort the result. */
  ids(): string[] {
    return Array.from(this.components.keys());
  }
}
