// Worker-side calc program: self-contained AST interpreter + serialized payload builder.
// Ships in Tasks 4 (interpreter skeleton) / 10 (worker program assembly).
// See docs/superpowers/specs/2026-07-02-cycle-21d-calc-design.md §2 (two-stage CalcPass),
// §6.2 (visible→group scope promotion — Stage B, owned by Task 10).

/** A single compiled calculated column as handed to the worker program builder. */
export interface CompiledCalcColumn {
  colId: string;
  ast: unknown;
  prePass: Array<{ slot: number; fn: string; colId: string; scope: unknown }>;
  usesPrev: boolean;
  cellDataType: string;
}

/** Serialized payload the worker program consumes to evaluate calc columns per row/group. */
export interface WorkerCalcProgramPayload {
  columns: CompiledCalcColumn[];
  interpreterSource: string;
}

/**
 * Evaluate a (transformed) calc AST against a single row.
 * `aggSlots` holds the pre-pass aggregate results indexed by `AggSpec.slot`
 * (null when not yet resolved, e.g. mid Stage-A row-local pre-filter).
 * `prevLookup` resolves `PREV([col])` reads; null when the calc does not use PREV.
 */
export function evaluateCalcAst(
  _ast: unknown,
  _row: Record<string, unknown>,
  _aggSlots: ReadonlyArray<number | null>,
  _prevLookup: ((colId: string) => unknown) | null,
): unknown {
  throw new Error('not-yet-implemented: evaluateCalcAst ships in Task 4');
}

/** Self-contained interpreter source, serialized into the worker bundle (aggFunc precedent). */
export const INTERPRETER_SOURCE: string = '';

/** Build the serialized worker program payload for a set of compiled calc columns. */
export function buildWorkerCalcProgram(_cols: CompiledCalcColumn[]): WorkerCalcProgramPayload {
  throw new Error('not-yet-implemented: buildWorkerCalcProgram ships in Task 10');
}
