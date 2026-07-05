/**
 * Cycle 21i Phase 2 / T2 — module-state persistence registry.
 *
 * `GridState` (stateSnapshot.ts) covers the kernel's own models —
 * column geometry, filter/sort/group/pivot, selection, scroll — but
 * none of the engine-owned state that grows around the kernel:
 * rules, calculated columns, column formatting, edit journals,
 * saved filters. Before this registry, each engine needed its own
 * ad-hoc persist path (the Column Groups overlay from Cycle 21i
 * Task 6/8 was the first), and a template manager would have had to
 * serialize every engine separately.
 *
 * A `StateModule` is one named, versioned, JSON-serializable slice:
 *
 *   registerStateModule({ id: 'rules', version: 1,
 *     get: () => engine.serialize(),           // undefined → omitted
 *     set: (data, version) => engine.restore(data) })
 *
 * Slices fold into the snapshot under
 * `GridState.modules[id] = { version, data }` — the same per-module
 * `{version, data}` envelope shape the StarUI ConfigManager profile
 * bundle prescribes — and ride the existing `stateUpdated` →
 * persistState autosave path with zero extra plumbing. Restore is
 * graceful per-slice: an unknown module id or a throwing `set()`
 * skips THAT slice with a dev warning and the rest of the snapshot
 * still restores. `version` is handed back to `set()` verbatim as the
 * module's own migration hook — the registry never interprets it.
 *
 * Design: docs/superpowers/specs/2026-07-04-cycle-21i-phase2-design.md §T2.
 */

/** Per-module snapshot envelope. `version` is the module's OWN schema
 *  version (independent of `STATE_SCHEMA_VERSION`); `data` is the
 *  module's JSON-serializable slice. */
export interface ModuleStateEnvelope {
  version: number;
  data: unknown;
}

/** One registered slice of engine-owned persistable state. */
export interface StateModule {
  /** Stable identity — the key under `GridState.modules`. */
  id: string;
  /** Current schema version of this module's `data` shape. Stored in
   *  the envelope; handed back to `set()` on restore so the module
   *  can migrate older slices itself. */
  version: number;
  /** Serialize the live slice. Return `undefined` (or `null`) to omit
   *  the module from the snapshot entirely — keeps snapshots compact
   *  when the module carries no information (mirrors how empty
   *  kernel fields are omitted). Must be JSON-serializable. */
  get(): unknown;
  /** Restore a persisted slice. `version` is the envelope's stored
   *  version (may be older than `StateModule.version`). Throwing
   *  skips this slice only — the rest of the restore proceeds. */
  set(data: unknown, version: number): void;
}

export class ModuleStateRegistry {
  private modules = new Map<string, StateModule>();
  /** Slices restored (or migrated) before their module registered.
   *  Retained so (a) a LATE-registering module still receives its
   *  persisted state — engines commonly wire after the grid's async
   *  persistState restore has already run — and (b) `snapshot()`
   *  carries the slice through, so the next autosave can't silently
   *  erase state belonging to a module that never registered this
   *  session. Keyed by module id; replaced by live modules on
   *  registration. */
  private orphans = new Map<string, ModuleStateEnvelope>();

  constructor(
    /** Called by `notifyChanged` so the grid can fan a
     *  `moduleStateChanged` event into the stateUpdated bus (which
     *  drives the persistState autosave). */
    private onChanged?: (moduleId: string) => void,
  ) {}

  /** Register a module. Re-registering an id replaces the previous
   *  module with a dev warning (tolerates hot-reload double
   *  registration without silently keeping a stale closure). Returns
   *  an unregister function. */
  register(module: StateModule): () => void {
    if (this.modules.has(module.id)) {
      console.warn(`[cgrid] state module '${module.id}' re-registered — replacing the previous registration`);
    }
    this.modules.set(module.id, module);
    // Deliver state that was restored before this module existed —
    // the registry buffers unclaimed slices instead of dropping them.
    const orphan = this.orphans.get(module.id);
    if (orphan) {
      this.orphans.delete(module.id);
      try {
        module.set(orphan.data, orphan.version ?? 1);
      } catch (err) {
        console.warn(`[cgrid] state module '${module.id}': buffered restore failed — slice dropped`, err);
      }
    }
    return () => {
      if (this.modules.get(module.id) === module) this.modules.delete(module.id);
    };
  }

  /** Signal that a module's state changed so the autosave path runs.
   *  Kernel-internal modules whose mutations already emit a mapped
   *  grid event (e.g. `columnDefsChanged`) don't need to call this. */
  notifyChanged(moduleId: string): void {
    this.onChanged?.(moduleId);
  }

  /** Serialize every registered module. Modules whose `get()` returns
   *  `undefined`/`null` are omitted; a throwing `get()` omits that
   *  slice with a dev warning (one bad module never poisons the whole
   *  snapshot). Returns `undefined` when nothing carries state so the
   *  snapshot stays compact. */
  snapshot(): Record<string, ModuleStateEnvelope> | undefined {
    let out: Record<string, ModuleStateEnvelope> | undefined;
    // Unclaimed slices pass through verbatim so an autosave taken
    // before their module registers never erases persisted state.
    for (const [id, envelope] of this.orphans) {
      (out ??= {})[id] = envelope;
    }
    for (const [id, module] of this.modules) {
      try {
        const data = module.get();
        if (data === undefined || data === null) continue;
        (out ??= {})[id] = { version: module.version, data };
      } catch (err) {
        console.warn(`[cgrid] getState: state module '${id}' get() failed — slice omitted`, err);
      }
    }
    return out;
  }

  /** Clear registered modules whose id is NOT in `present` and NOT in
   *  `preserve` (Grid Layouts / Phase B). An exhaustive (layout-switch)
   *  restore calls this so a layout that OMITS a layout-tier slice clears
   *  the outgoing one — `present` = the ids the incoming snapshot carries,
   *  `preserve` = grid-tier ids (shared across layouts, must survive).
   *  "Clear" = `set(undefined)`, the documented empty-restore convention
   *  (modules treat a non-array / undefined payload as empty); a module that
   *  can't clear from `undefined` (e.g. `columnGroups`, which needs the flat
   *  defs) simply no-ops — unchanged from prior behavior. Graceful per-slice:
   *  a throwing clear warns and skips, others still clear. */
  clearAbsent(present: Set<string>, preserve: Set<string>): void {
    for (const [id, module] of this.modules) {
      if (present.has(id) || preserve.has(id)) continue;
      try {
        module.set(undefined, module.version);
      } catch (err) {
        console.warn(`[cgrid] exhaustive restore: clearing module '${id}' failed — slice left as-is`, err);
      }
    }
    // Drop buffered orphan slices too (a slice restored before its module
    // registered): otherwise a layout switch leaves the outgoing layout's
    // orphaned slice in the buffer, resurrecting it when the module finally
    // registers (L5).
    for (const id of [...this.orphans.keys()]) {
      if (!present.has(id) && !preserve.has(id)) this.orphans.delete(id);
    }
  }

  /** Restore persisted slices. Graceful per-slice: unknown ids and
   *  throwing `set()`s warn and skip; everything else applies. */
  restore(modules: Record<string, ModuleStateEnvelope>): void {
    for (const [id, envelope] of Object.entries(modules)) {
      const module = this.modules.get(id);
      if (!module) {
        // Buffer, don't drop — the owning engine may register later
        // (wireEditIntoKernel after an await is a supported pattern).
        this.orphans.set(id, envelope);
        continue;
      }
      try {
        module.set(envelope.data, envelope.version ?? 1);
      } catch (err) {
        console.warn(`[cgrid] setState: state module '${id}' restore failed — slice skipped`, err);
      }
    }
  }
}
