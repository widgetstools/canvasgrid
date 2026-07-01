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
 * Task 2 wired the real count-panel ctors into the four
 * `agTotal/agFiltered/agSelected/agTotalAndFiltered…` keys. Task 3
 * (this update) wires `agAggregationComponent` to `AgAggregationPanel`,
 * so every built-in key now resolves to a real implementation and the
 * stub is reserved for any future built-in that lands in flight.
 */
import { AgAggregationPanel } from './panels/aggregation';
import { COUNT_PANEL_CONSTRUCTORS } from './panels/counts';
import type { IStatusPanelComp, StatusPanelComponent, StatusPanelParams } from './types';

/** Built-in stub panel. Used for any built-in key that doesn't yet
 *  have a real implementation registered (Cycle 13 / Task 2 leaves
 *  only `agAggregationComponent` on the stub until Task 3 ships the
 *  real ctor). Renders an empty `<div>`; no events, no refresh side
 *  effects. */
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

/** Single source-of-truth map from built-in key → real implementation.
 *  Merges the count-panel map (Task 2) with `agAggregationComponent →
 *  AgAggregationPanel` (Task 3). Any key NOT present here falls through
 *  to `StubBuiltInStatusPanel` inside `seedBuiltIns()`. */
const BUILT_IN_STATUS_PANEL_CTORS: Record<string, StatusPanelComponent | undefined> = {
  ...(COUNT_PANEL_CONSTRUCTORS as Record<string, StatusPanelComponent>),
  agAggregationComponent: AgAggregationPanel,
};

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

  /** Seed the built-in keys with their real implementations (or the
   *  inert stub when a real ctor hasn't shipped yet). Called once at
   *  CGrid construction BEFORE merging `CGridOptions.components`, so
   *  app-supplied entries can still override either the real built-in
   *  or the stub by registering against the same key.
   *
   *  Task 2 — `agTotal/agFiltered/agSelected/agTotalAndFiltered…`
   *  resolve to the count-panel ctors from `panels/counts.ts`.
   *  Task 3 — `agAggregationComponent` resolves to `AgAggregationPanel`
   *  from `panels/aggregation.ts`. With both tasks landed, every
   *  built-in key resolves to a real implementation; the stub remains
   *  as a fallback for unforeseen additions to
   *  `BUILT_IN_STATUS_PANEL_KEYS`. */
  seedBuiltIns(): void {
    for (const key of BUILT_IN_STATUS_PANEL_KEYS) {
      if (this.components.has(key)) continue;
      const ctor = BUILT_IN_STATUS_PANEL_CTORS[key];
      this.components.set(key, ctor ?? StubBuiltInStatusPanel);
    }
  }

  /** Every registered key. Order is insertion-order (Map semantics);
   *  callers that need a stable view should sort the result. */
  keys(): string[] {
    return Array.from(this.components.keys());
  }
}
