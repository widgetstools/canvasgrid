import type { Schema, ValidationResult } from './types';

/**
 * Validate a source expression against a Schema — parse + compile + type check.
 *
 * Cycle 21b — Task 4 implements this. Task 1 ships only the signature.
 */
export function validate(_source: string, _schema: Schema): ValidationResult {
  throw new Error('validate: not implemented — landed in Cycle 21b Task 4');
}
