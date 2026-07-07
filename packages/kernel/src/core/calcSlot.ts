// Kernel-side calc-provider dependency-injection slot.
//
// @cgrid/calc registers its provider via wireIntoKernel(); kernel consults
// it when resolving column defs (synthesized calc columns + override/template
// patches, Cycle 21d Task 9) and ships its worker program on register /
// column changes (Task 10). Kernel does NOT import @cgrid/calc at runtime —
// only structural types, exactly like core/ruleEngineSlot.ts.

/** Structural surface @cgrid/calc's bridge implements (Cycle 21d Task 14).
 *  Kernel never inspects the payloads beyond the documented keys. */
export interface CalcProviderShape {
  /** Plain CColDef-keyed records for every registered calculated column.
   *  Non-editable (`editable: false`), fieldless (colId-only), optional
   *  `position` insertion hint, `valueFormatter` may be a format-DSL
   *  string (compiled by the format slot inside resolveColDef). */
  synthesizedColDefs(): Array<Record<string, unknown>>;
  /** Folded override/template patch for a DATA column, or null when the
   *  column has no overrides. Keys are plain CColDef keys; the kernel
   *  spreads them over the user's def ({...def, ...patch}). */
  resolvedPatchFor(colId: string, cellDataType: 'text' | 'number'): Record<string, unknown> | null;
  /** Serialized worker calc program (setCalcProgram payload) or null when
   *  no calc column is registered. Opaque to the kernel type system. */
  workerProgram(): unknown | null;
  /** Subscribe to calc-column / override mutations; returns unsubscribe. */
  onColumnsChanged(fn: () => void): () => void;

  // ── Grid Layouts / Phase B (B3) — the shared styling-template library ──
  // CRUD, routed from the kernel's CGridApi template methods to the calc
  // engine. Optional so a minimal / pre-B3 provider (or a bare test double)
  // still registers — the kernel guards each call and degrades to a no-op /
  // empty list. The engine is Date-free, so name/save mutations take an
  // explicit `now` the kernel stamps.
  /** The host-authored template library (synthetic typeDefaults filtered).
   *  Records keyed as `ColumnTemplate` — the kernel treats them opaquely. */
  getTemplates?(): Array<Record<string, unknown>>;
  /** Create-or-replace a template by id (re-save preserves `createdAt`). */
  saveTemplate?(spec: {
    id: string; name: string; description?: string;
    overrides: Record<string, unknown>; now: number;
  }): void;
  /** Rename a template (grid-wide unique name enforced; throws on collision). */
  renameTemplate?(templateId: string, name: string, now: number): void;
  /** Delete a template from the library (assignments become dangling refs). */
  deleteTemplate?(templateId: string): void;
  /** Assign a template to a single column (appends to its chain). */
  applyTemplate?(colId: string, templateId: string): void;
  /** Unassign a template from a single column (library entry kept). */
  removeTemplate?(colId: string, templateId: string): void;
  /** Auto-template-on-edit (spec §3.1): merge an editable-attribute patch
   *  into the column's OWN template (create-if-absent) and assign it — a
   *  consumer edit forks to the column's own template, never mutating a
   *  shared one. `now` stamps the own template's timestamps. Returns `true`
   *  when the edit applied, `false` when it was rejected (e.g. a
   *  non-compiling format) — the caller gates its `templatesChanged` on it. */
  editColumn?(colId: string, patch: Record<string, unknown>, now: number): boolean;
}

let injectedProvider: CalcProviderShape | null = null;

export function registerCalcProvider(provider: CalcProviderShape): void {
  injectedProvider = provider;
}

export function getCalcProvider(): CalcProviderShape | null {
  return injectedProvider;
}

/** Test-only helper — not part of public API. */
export function _resetCalcProvider_forTests(): void {
  injectedProvider = null;
}

/** Fold the registered provider's synthesized defs + per-column patches
 *  into a column-def array. Pure; returns the input array UNCHANGED
 *  (same reference) when no provider is registered — the zero-diff path.
 *  Recurses into column-GROUP nodes (`{groupId, children}` — no colId/field
 *  of their own) so overrides reach nested leaves (a top-level-only walk
 *  silently skipped every grouped column — the "editColumn styles/formats
 *  never paint on grouped columns" bug). Unchanged nodes keep their
 *  reference: a group object is only re-created when a descendant actually
 *  changed, preserving the rebuild diff's zero-work path. */
export function foldCalcColumnDefs<T extends object>(
  defs: readonly T[],
): T[] {
  const provider = injectedProvider;
  if (provider === null) return defs as T[];

  const patchNode = (def: T): T => {
    const loose = def as {
      colId?: string; field?: unknown; cellDataType?: unknown; children?: readonly T[];
    };
    if (Array.isArray(loose.children)) {
      const children = loose.children.map(patchNode);
      const changed = children.some((c, i) => c !== loose.children![i]);
      return changed ? ({ ...def, children } as T) : def;
    }
    const colId = (loose.colId ?? loose.field) as string | undefined;
    if (colId === undefined) return def;
    const cellDataType: 'text' | 'number' = loose.cellDataType === 'number' ? 'number' : 'text';
    const patch = provider.resolvedPatchFor(colId, cellDataType);
    return patch === null ? def : { ...def, ...patch };
  };

  const patched = defs.map(patchNode);
  const synthesized = [...provider.synthesizedColDefs()]
    .sort((a, b) => ((a.position as number | undefined) ?? Number.POSITIVE_INFINITY)
      - ((b.position as number | undefined) ?? Number.POSITIVE_INFINITY));
  return synthesized.length === 0 ? patched : [...patched, ...synthesized as unknown as T[]];
}
