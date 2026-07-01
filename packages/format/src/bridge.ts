import type { WireOptions } from './types';

/**
 * Wire @cgrid/format into a CGrid instance. Idempotent.
 *
 * grid is typed as `unknown` here to keep this signature import-safe
 * without a runtime dep on @cgrid/kernel. Task 17 tightens the signature
 * to the real CGrid type via a type-only import.
 */
export function wireIntoKernel(grid: unknown, opts?: WireOptions): void {
  throw new Error('not-yet-implemented: bridge.wireIntoKernel');
}
