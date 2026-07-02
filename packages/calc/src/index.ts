// @cgrid/calc — public re-exports.
// See docs/superpowers/specs/2026-07-02-cycle-21d-calc-design.md §3.

export { CalcEngine } from './calcEngine';
export { compileCalc } from './compile';
export { registerAggregate, getAggregate, listAggregates } from './aggregates/registry';
export { wireIntoKernel } from './bridge';
export { transformAggregates } from './aggTransform';
export { evaluateCalcAst, INTERPRETER_SOURCE } from './workerProgram';

export type {
  CellDataType, CalculatedColumnDef, AggScope, AggSpec, CompiledCalc, CalcValidationError,
  Aggregate, ColumnOverride, ColumnTemplate, TypeDefaults, WireCalcOptions, Unsubscribe,
} from './types';
