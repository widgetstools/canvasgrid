// source string → CompiledCalc. Ships in Task 3.
import type { Schema } from '@cgrid/expression';
import type { CalcValidationError, CompiledCalc } from './types';

export function compileCalc(
  _source: string,
  _schema?: Schema,
): { ok: true; compiled: CompiledCalc } | { ok: false; error: CalcValidationError } {
  throw new Error('not-yet-implemented: compileCalc ships in Task 3');
}
