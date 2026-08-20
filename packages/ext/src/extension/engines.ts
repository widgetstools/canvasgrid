/**
 * D-F8 — engine dependency-injection slots on the ext context.
 *
 * ## The defect
 *
 * Modules used to discover their engine by casting the grid and reading a
 * dunder expando the engine's `wire*IntoKernel` had attached
 * (`__editBridgeWired` / `__calcBridgeWired` / `__rulesBridgeWired`), each
 * with its own missing-engine strategy: `columnSettings.applyCaption`
 * returned `undefined` (caption Save "succeeded", header never changed),
 * `alerts` swallowed a wire failure in a bare `catch {}`,
 * `conditionalStyling` returned `'—'`. Three strategies, one of them
 * silent.
 *
 * ## Why this is a live LOOKUP, not a snapshot
 *
 * The plan proposed the context read the markers ONCE at context creation.
 * That cannot work — engine registration is POST-CONSTRUCTION and is the
 * normal case, not the edge case:
 *
 *   - `VelocityGridExt`'s constructor builds the context (`createExtContext`)
 *     before it returns, so a host's `wireEditIntoKernel(ext.grid)` — the
 *     documented usage, see `apps/velocitygrid-ext-demo/src/main.ts` — necessarily
 *     runs AFTER the snapshot would have been taken. `edit` would be
 *     permanently `null` for every host.
 *   - `velocityGrid.ts`'s `registerRuleEngine` deliberately bumps the strip
 *     layout epoch precisely BECAUSE it expects late registration.
 *   - ext itself wires `calc` / `rules` lazily, from inside a module's
 *     `mount()`, which happens when the user opens the drawer.
 *
 * So every accessor here re-resolves at USE time. Nothing is cached.
 *
 * ## Why probing the grid is correctly attributable
 *
 * The kernel's `core/ruleEngineSlot.ts` holds its injected engine in a bare
 * module-level `let` — module-GLOBAL, so with two grids alive the last
 * `wireIntoKernel` wins and the kernel cannot attribute an engine to a grid.
 * That slot is a real (pre-existing, out-of-scope) sharp edge, but it is NOT
 * what ext reads. The three `__*BridgeWired` markers are OWN PROPERTIES OF
 * THE GRID INSTANCE (`packages/{edit,calc,rules}/src/bridge.ts` all do
 * `g.__xBridgeWired = handle` on the grid they were handed), so a probe of
 * THIS context's `grid` resolves THIS grid's engine and no other's.
 *
 * The marker probe is therefore kept — but it lives here, in exactly one
 * place, behind a typed accessor, instead of being re-derived by seven
 * modules. {@link ExtEngineSlots.register} is the real DI path on top of it:
 * whatever ext wires lazily (or a host/test injects explicitly) is recorded
 * and wins over the probe.
 */
import type { EditBridgeHandle } from '../edit/index';
import type { CalcEngine } from '@wellsfargo-starui/velocity-grid/calc';
import type { RuleEngine, AlertsEngine } from '@wellsfargo-starui/velocity-grid/rules';

/** The engines a module may ask the context for. */
export interface ExtEngineMap {
  edit: EditBridgeHandle;
  calc: CalcEngine;
  rules: RuleEngine;
  alerts: AlertsEngine;
}

export type ExtEngineName = keyof ExtEngineMap;

/** Human-facing engine label + the call that wires it — used by the shared
 *  `engineMissingNotice` empty state so every module says the same thing. */
export const ENGINE_WIRE_HINT: Record<ExtEngineName, { label: string; wire: string }> = {
  edit: { label: 'Edit', wire: 'wireEditIntoKernel(grid)' },
  calc: { label: 'Calc', wire: "wireIntoKernel(grid) from '@wellsfargo-starui/velocity-grid/calc'" },
  rules: { label: 'Rules', wire: "wireIntoKernel(grid) from '@wellsfargo-starui/velocity-grid/rules'" },
  alerts: { label: 'Alerts', wire: "wireIntoKernel(grid) from '@wellsfargo-starui/velocity-grid/rules'" },
};

export interface ExtEngineSlots {
  /**
   * Resolve `name` AS OF NOW — an explicitly registered engine if there is
   * one, otherwise the engine the corresponding `wire*IntoKernel` attached
   * to this context's grid. `null` when the engine is not wired.
   *
   * Callers must NOT cache the result across user interactions: an engine
   * wired after the module mounted is only visible to a fresh `get`.
   */
  get<K extends ExtEngineName>(name: K): ExtEngineMap[K] | null;
  /** Record an engine into the slot — used by ext's own lazy wiring and by
   *  hosts/tests that want to inject without touching the grid. Wins over
   *  the marker probe from here on. */
  register<K extends ExtEngineName>(name: K, engine: ExtEngineMap[K]): void;
}

/** The grid-attached markers, as the three bridges declare them. */
interface BridgeMarkers {
  __editBridgeWired?: EditBridgeHandle;
  __calcBridgeWired?: { calc: CalcEngine };
  __rulesBridgeWired?: { rules: RuleEngine; alerts: AlertsEngine };
}

function probe<K extends ExtEngineName>(grid: unknown, name: K): ExtEngineMap[K] | null {
  const g = grid as BridgeMarkers | null | undefined;
  if (!g) return null;
  switch (name) {
    case 'edit': return (g.__editBridgeWired ?? null) as ExtEngineMap[K] | null;
    case 'calc': return (g.__calcBridgeWired?.calc ?? null) as ExtEngineMap[K] | null;
    case 'rules': return (g.__rulesBridgeWired?.rules ?? null) as ExtEngineMap[K] | null;
    case 'alerts': return (g.__rulesBridgeWired?.alerts ?? null) as ExtEngineMap[K] | null;
    default: return null;
  }
}

/** Build the per-context engine slots over `grid`. One instance per
 *  `VelocityGridExtContext` — the registration map is NOT shared between
 *  grids. */
export function createEngineSlots(grid: unknown): ExtEngineSlots {
  const registered = new Map<ExtEngineName, unknown>();
  return {
    get<K extends ExtEngineName>(name: K): ExtEngineMap[K] | null {
      const explicit = registered.get(name);
      if (explicit != null) return explicit as ExtEngineMap[K];
      return probe(grid, name);
    },
    register<K extends ExtEngineName>(name: K, engine: ExtEngineMap[K]): void {
      registered.set(name, engine);
    },
  };
}
