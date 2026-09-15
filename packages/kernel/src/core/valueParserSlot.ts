// Kernel-side value-parser dependency-injection slot.
//
// A package that wants to extend how a typed cell value is PARSED registers a
// contributor here; the colDef-resolve pass (`propertyChain`) wraps each
// resolved column's `valueParser` with it. The kernel imports nothing from
// that package — same shape as `formatCompilerSlot`, `calcSlot` and
// `ruleEngineSlot`.
//
// Why a slot and not a colDef rewrite: the obvious alternative is for the
// contributing package to transform `columnDefs` and push them back through
// `updateGridOptions`, which rebuilds the column tree and re-syncs the worker.
// ColDefs are CONTENDED — the format engine (`editColumn`) and the calc engine
// both write them — so last writer wins and a wrapper is silently dropped or
// applied twice. Wrapping during resolve has none of that: authored defs are
// never mutated, and a slot holds exactly one contributor.
//
// The contributor is consulted on EVERY resolve, and is expected to decide
// per-column whether it applies. It should gate its own behaviour at CALL
// time rather than at wrap time — a setting read inside the returned parser is
// live, where one read while wrapping would need a re-resolve on every toggle.

/** Params a value parser receives. Structurally the kernel's own
 *  `CValueParserParams`, restated so the slot carries no generic. */
export interface ValueParserParamsShape {
  newValue: unknown;
  oldValue?: unknown;
  data?: unknown;
  colDef?: unknown;
}

/** The column a contributor is being asked about. Enough to decide whether it
 *  applies — notably `cellDataType`, since a magnitude suffix means something
 *  on a number column and nothing on a string one. */
export interface ValueParserColumnShape {
  colId: string;
  field?: string;
  cellDataType?: string;
}

/**
 * Given a column and whatever parser it already has, return the parser it
 * should use.
 *
 * Returning `original` (or `undefined` when there was none) opts the column
 * out. A contributor that wraps MUST call `original` first and fall back to
 * its result, so an app's own `valueParser` keeps precedence over anything
 * the contributor adds.
 */
export type ValueParserContributor = (
  column: ValueParserColumnShape,
  original: ((params: ValueParserParamsShape) => unknown) | undefined,
) => ((params: ValueParserParamsShape) => unknown) | undefined;

let injected: ValueParserContributor | null = null;

export function registerValueParserContributor(fn: ValueParserContributor | null): void {
  injected = fn;
}

export function getValueParserContributor(): ValueParserContributor | null {
  return injected;
}

/** Test-only helper — not part of the public API. */
export function _resetValueParserContributor_forTests(): void {
  injected = null;
}
