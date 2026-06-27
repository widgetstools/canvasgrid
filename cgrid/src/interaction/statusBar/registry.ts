/**
 * Cycle 13 / Task 1 — StatusPanelRegistry.
 *
 * Plain `Map<key, ctor>` wrapper that owns status-panel component
 * registration. The CGrid constructor seeds the built-in keys
 * (`agTotalRowCountComponent`, …) via `seedBuiltIns()` and then merges
 * `CGridOptions.components` entries on top — apps add new keys or override
 * built-ins by registering against the same key. Same shape as
 * `ToolPanelRegistry` so a single `CGridOptions.components` channel feeds
 * both surfaces.
 *
 * Task 1 ships the built-ins as inert stubs (empty `<div>` GUI, no-op
 * `refresh` / `destroy`) so the registry surface is testable end-to-end
 * before Tasks 2 + 3 replace them with the real count + aggregation
 * implementations.
 */
import type { IStatusPanelComp, StatusPanelComponent, StatusPanelParams } from './types';

/** Built-in stub panel. The class itself is the contract that Tasks 2 + 3
 *  replace via `register(key, RealCtor)`. */
class StubBuiltInStatusPanel implements IStatusPanelComp {
  private gui: HTMLDivElement = document.createElement('div');
  init(_params: StatusPanelParams): void {
    this.gui.className = 'cg-status-panel-stub';
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

/** Canonical built-in keys. Exported so tests + downstream tasks reference
 *  the same strings the registry seeds with. */
export const BUILT_IN_STATUS_PANEL_KEYS = [
  'agTotalRowCountComponent',
  'agFilteredRowCountComponent',
  'agSelectedRowCountComponent',
  'agTotalAndFilteredRowCountComponent',
  'agAggregationComponent',
] as const;

export class StatusPanelRegistry {
  private components = new Map<string, StatusPanelComponent>();

  /** Register a status-panel component under `key`. If `key` already has
   *  a registration (e.g. a built-in stub), the new ctor wins — apps
   *  override built-ins by registering against the same key. */
  register(key: string, ctor: StatusPanelComponent): void {
    this.components.set(key, ctor);
  }

  /** Look up the ctor for `key`. Returns `null` when no component has
   *  been registered against that key. */
  resolve(key: string): StatusPanelComponent | null {
    return this.components.get(key) ?? null;
  }

  /** Construct a panel for `key` and call `init(params)`. Returns the
   *  initialised instance, or `null` when `key` is unknown. The host is
   *  responsible for mounting `instance.getGui()` into the DOM. */
  instantiate(key: string, params: StatusPanelParams): IStatusPanelComp | null {
    const Ctor = this.resolve(key);
    if (!Ctor) return null;
    const instance = new Ctor();
    instance.init(params);
    return instance;
  }

  /** Seed the built-in keys with stub implementations. Called once at
   *  CGrid construction BEFORE merging `CGridOptions.components`, so
   *  app-supplied entries can override the stubs (and the future real
   *  implementations from Tasks 2 + 3). */
  seedBuiltIns(): void {
    for (const key of BUILT_IN_STATUS_PANEL_KEYS) {
      if (!this.components.has(key)) {
        this.components.set(key, StubBuiltInStatusPanel);
      }
    }
  }

  /** Every registered key. Order is insertion-order (Map semantics);
   *  callers that need a stable view should sort the result. */
  keys(): string[] {
    return Array.from(this.components.keys());
  }
}
