// CalcEngine — calculated columns + overrides/templates orchestration. Ships in Tasks 7-8.
import type { Schema } from '@cgrid/expression';
import type {
  CalcValidationError, CalculatedColumnDef, ColumnOverride, ColumnTemplate, TypeDefaults,
} from './types';

export class CalcEngine {
  constructor(_opts?: { schema?: Schema }) {
    throw new Error('not-yet-implemented: CalcEngine ships in Task 7');
  }
  registerCalculatedColumn(_def: CalculatedColumnDef): { ok: boolean; errors: CalcValidationError[] } {
    throw new Error('not-yet-implemented');
  }
  removeCalculatedColumn(_colId: string): void { throw new Error('not-yet-implemented'); }
  listCalculatedColumns(): CalculatedColumnDef[] { throw new Error('not-yet-implemented'); }
  applyOverrides(_overrides: ColumnOverride[]): { ok: boolean; errors: CalcValidationError[] } {
    throw new Error('not-yet-implemented');
  }
  getOverrides(): ColumnOverride[] { throw new Error('not-yet-implemented'); }
  saveTemplate(_spec: Omit<ColumnTemplate, 'createdAt' | 'updatedAt'> & { now: number }): void {
    throw new Error('not-yet-implemented');
  }
  applyTemplate(_templateId: string, _colIds: string[]): void { throw new Error('not-yet-implemented'); }
  deleteTemplate(_templateId: string): void { throw new Error('not-yet-implemented'); }
  listTemplates(): ColumnTemplate[] { throw new Error('not-yet-implemented'); }
  setTypeDefaults(_defaults: TypeDefaults): void { throw new Error('not-yet-implemented'); }
  /** Folded per-column patch (template chain + overrides) for the kernel. */
  resolvedPatchFor(_colId: string, _cellDataType: 'text' | 'number'): Record<string, unknown> | null {
    throw new Error('not-yet-implemented');
  }
}
