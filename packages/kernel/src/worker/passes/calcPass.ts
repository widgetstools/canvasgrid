// Cycle 21d / Task 10 — worker-side calc program store.
//
// Owns the reconstruction of the calculated-column interpreter + delta
// aggregate factories shipped from @cgrid/calc's bridge as source text
// (Function.prototype.toString() forms) via the setCalcProgram protocol
// message. Reconstruction mirrors the setAggFuncs / registerComparator
// `new Function` idiom in handlers/dataPipeline.ts — same CSP caveat,
// same "source is static, never user input" trust boundary.
//
// This store is consulted nowhere yet — CalcPass Stage A/B (per-row
// evaluation + aggregate cache) land in Tasks 11/12. The Task-11/12
// fields are declared now with inert defaults so the class shape is
// final; `resetCaches()` is a no-op until then, so installing a program
// costs nothing beyond the reconstruction itself.

import type { WorkerCalcProgram } from '../protocol';

export type CalcInterpreter = (
  ast: unknown,
  row: Record<string, unknown>,
  aggSlots: ReadonlyArray<number | null>,
  prevLookup: ((colId: string) => unknown) | null,
) => unknown;

export type CalcAggregateFactory = () => {
  init(): unknown;
  addRow(state: unknown, value: unknown): unknown;
  removeRow(state: unknown, value: unknown): unknown;
  updateRow(state: unknown, oldValue: unknown, newValue: unknown): unknown;
  finalize(state: unknown): number | null;
};

export class CalcProgramStore {
  private program: WorkerCalcProgram | null = null;
  private interp: CalcInterpreter | null = null;
  private factories = new Map<string, CalcAggregateFactory>();
  private colIndex = new Map<string, WorkerCalcProgram['columns'][number]>();

  /** Install / replace / remove (null) the program. Reconstructs the
   *  interpreter + aggregate factories via `new Function` (the
   *  setAggFuncs precedent in handlers/dataPipeline.ts) and probe-calls
   *  the interpreter with (null, {}, [], null) so a source with free
   *  variables fails HERE (error envelope) instead of mid-pass. Throws
   *  on any reconstruction failure; the handler converts to `error`. */
  install(program: WorkerCalcProgram | null): void {
    if (program === null) {
      this.program = null;
      this.interp = null;
      this.factories.clear();
      this.colIndex.clear();
      this.resetCaches();
      return;
    }
    const interp = rebuild('calc interpreter', program.interpreterSource) as CalcInterpreter;
    // Smoke eval — CROSS-TASK CONTRACT: evaluateCalcAst(null, {}, [], null)
    // returns null and must not throw (free-variable screen).
    interp(null, {}, [], null);
    const factories = new Map<string, CalcAggregateFactory>();
    for (const entry of program.aggregateSources) {
      factories.set(entry.name, rebuild(`calc aggregate '${entry.name}'`, entry.source) as CalcAggregateFactory);
    }
    this.program = program;
    this.interp = interp;
    this.factories = factories;
    this.colIndex = new Map(program.columns.map((c) => [c.colId, c]));
    this.resetCaches(); // full Stage A/B recompute on next pipeline pass (Task 11)
  }

  hasProgram(): boolean { return this.program !== null; }
  isCalcCol(colId: string): boolean { return this.colIndex.has(colId); }
  columnFor(colId: string): WorkerCalcProgram['columns'][number] | undefined { return this.colIndex.get(colId); }
  interpreter(): CalcInterpreter | null { return this.interp; }
  aggregateFactory(name: string): CalcAggregateFactory | undefined { return this.factories.get(name); }

  /** Tasks 11/12 fill these. */
  private resetCaches(): void { /* Stage A/B caches — Task 11/12 */ }
}

function rebuild(label: string, source: string): unknown {
  let fn: unknown;
  try {
    fn = new Function(`"use strict"; return (${source});`)();
  } catch (err) {
    throw new Error(`[cgrid] failed to deserialise ${label}: ${String((err as Error).message ?? err)}`);
  }
  if (typeof fn !== 'function') {
    throw new Error(`[cgrid] ${label} did not deserialise to a function`);
  }
  return fn;
}
