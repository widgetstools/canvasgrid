// ColumnOverride → kernel column patch. Ships in Task 8.
import type { ColumnOverride } from './types';

export function overrideToKernelPatch(_override: ColumnOverride): Record<string, unknown> {
  throw new Error('not-yet-implemented: overrideToKernelPatch ships in Task 8');
}
