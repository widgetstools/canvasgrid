// Kernel bridge. Ships in Task 14.
import type { WireCalcOptions } from './types';
import type { CalcEngine } from './calcEngine';

export function wireIntoKernel(
  _grid: unknown,
  _opts?: WireCalcOptions,
): { calc: CalcEngine } {
  throw new Error('not-yet-implemented: wireIntoKernel ships in Task 14');
}
