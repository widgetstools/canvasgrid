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
 *  (same reference) when no provider is registered — the zero-diff path. */
export function foldCalcColumnDefs<T extends object>(
  defs: readonly T[],
): T[] {
  const provider = injectedProvider;
  if (provider === null) return defs as T[];
  const patched = defs.map((def) => {
    const loose = def as { colId?: string; field?: unknown; cellDataType?: unknown };
    const colId = (loose.colId ?? loose.field) as string | undefined;
    if (colId === undefined) return def;
    const cellDataType: 'text' | 'number' = loose.cellDataType === 'number' ? 'number' : 'text';
    const patch = provider.resolvedPatchFor(colId, cellDataType);
    return patch === null ? def : { ...def, ...patch };
  });
  const synthesized = [...provider.synthesizedColDefs()]
    .sort((a, b) => ((a.position as number | undefined) ?? Number.POSITIVE_INFINITY)
      - ((b.position as number | undefined) ?? Number.POSITIVE_INFINITY));
  return synthesized.length === 0 ? patched : [...patched, ...synthesized as unknown as T[]];
}
