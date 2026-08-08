// @wellsfargo-starui/velocity-grid-calc — public re-exports.
// See docs/superpowers/specs/2026-07-02-cycle-21d-calc-design.md §3.

export { CalcEngine, ownTemplateId, isOwnTemplateId, type ColumnEditPatch } from './calcEngine';
export { compileCalc } from './compile';
export { registerAggregate, getAggregate, listAggregates } from './aggregates/registry';
export { wireIntoKernel } from './bridge';
export { transformAggregates } from './aggTransform';
export { evaluateCalcAst, INTERPRETER_SOURCE, buildWorkerCalcProgram } from './workerProgram';

export type {
  CellDataType, CalculatedColumnDef, AggScope, AggSpec, CompiledCalc, CalcValidationError,
  Aggregate, ColumnOverride, ColumnTemplate, IconOverride, TypeDefaults, WireCalcOptions, Unsubscribe,
} from './types';
export type { CompiledCalcColumn, WorkerCalcProgramPayload } from './workerProgram';
