// CalcEngine — registered calculated columns + compiled-program store
// (this task), override/template stores + fold (Task 8).
//
// Date-free by contract (Global Constraints): the engine never reads a clock;
// template timestamps arrive via saveTemplate's `now` argument (Task 8).

import type { Schema } from '@cgrid/expression';
import { compileFormat } from '@cgrid/format';
import { compileCalc } from './compile';
import type {
  CalculatedColumnDef,
  CalcValidationError,
  CellDataType,
  ColumnOverride,
  ColumnTemplate,
  CompiledCalc,
  TypeDefaults,
  Unsubscribe,
} from './types';

interface StoredCalcColumn {
  def: CalculatedColumnDef;
  compiled: CompiledCalc;
}

/**
 * CellDataType → kernel binary cellDataType (LOCKED mapping, spec §1.1 item 8).
 *
 * 'number' → 'number'; everything else ('currency' | 'percent' | 'date' |
 * 'datetime' | 'string' | 'boolean') → 'text'; undefined → 'number' (spec §3
 * default). Deliberate degradation: the kernel's cellDataType is binary
 * (packages/kernel/src/types/column.ts:124) and only drives the default
 * renderer + halign — currency/percent presentation comes from the def's
 * format string via `valueFormatter`. Revisited when the kernel grows richer
 * cell data types; `CompiledCalc.cellDataType` keeps the full 7-value union.
 */
function kernelCellDataTypeOf(cellDataType: CellDataType | undefined): 'text' | 'number' {
  return (cellDataType ?? 'number') === 'number' ? 'number' : 'text';
}

export class CalcEngine {
  #schema: Schema | null;
  /** Insertion-ordered — registration order IS the accessor order. */
  #calcCols = new Map<string, StoredCalcColumn>();
  #columnListeners = new Set<() => void>();

  constructor(opts?: { schema?: Schema }) {
    this.#schema = opts?.schema ?? null;
  }

  registerCalculatedColumn(def: CalculatedColumnDef): { ok: boolean; errors: CalcValidationError[] } {
    if (typeof def.colId !== 'string' || def.colId.length === 0) {
      return {
        ok: false,
        errors: [{
          colId: null,
          code: 'bad-shape',
          message: 'calculated column colId must be a non-empty string',
          loc: null,
        }],
      };
    }
    const errors: CalcValidationError[] = [];
    if (this.#calcCols.has(def.colId)) {
      errors.push({
        colId: def.colId,
        code: 'duplicate-colId',
        message: `calculated column '${def.colId}' is already registered — remove it before re-registering`,
        loc: null,
      });
    }
    if (this.#schema !== null && Object.prototype.hasOwnProperty.call(this.#schema.fields, def.colId)) {
      errors.push({
        colId: def.colId,
        code: 'duplicate-colId',
        message: `calculated column '${def.colId}' collides with a data field`,
        loc: null,
      });
    }
    if (errors.length > 0) return { ok: false, errors };

    const compiledResult = compileCalc(def.expression, this.#schema ?? undefined);
    if (!compiledResult.ok) {
      // Pass the compile error through verbatim with the colId attached.
      return { ok: false, errors: [{ ...compiledResult.error, colId: def.colId }] };
    }

    if (def.format !== undefined) {
      const fmt = compileFormat(def.format);
      if (!fmt.ok) {
        // The format error's loc indexes the FORMAT string, not the calc
        // expression — CalcValidationError.loc stays null; offsets go in
        // the message.
        return {
          ok: false,
          errors: [{
            colId: def.colId,
            code: 'format-compile',
            message: `format string failed to compile: ${fmt.error.message}`,
            loc: null,
          }],
        };
      }
    }

    const compiled: CompiledCalc = {
      ...compiledResult.compiled,
      cellDataType: def.cellDataType ?? 'number',
    };
    this.#calcCols.set(def.colId, { def: structuredClone(def), compiled });
    this.#notifyColumnsChanged();
    return { ok: true, errors: [] };
  }

  removeCalculatedColumn(colId: string): void {
    if (this.#calcCols.delete(colId)) this.#notifyColumnsChanged();
  }

  listCalculatedColumns(): CalculatedColumnDef[] {
    return [...this.#calcCols.values()].map((entry) => structuredClone(entry.def));
  }

  /**
   * Registration-ordered `{ def, compiled }` pairs — same order as
   * `synthesizedColDefs()`, so the Task 14 bridge zips index `i` with
   * `compiledColumns()[i].def.position` for insertion hints and ships
   * `compiled` (plain-JSON ast + prePass) to the worker. Treat entries as
   * immutable — the array is frozen; the entries are the live store.
   */
  compiledColumns(): ReadonlyArray<{ def: CalculatedColumnDef; compiled: CompiledCalc }> {
    return Object.freeze(
      [...this.#calcCols.values()].map((entry) => ({ def: entry.def, compiled: entry.compiled })),
    );
  }

  /**
   * Kernel-ready plain-JSON ColDef objects for the calc-column synthesizer
   * slot (Task 9). Keys verified against packages/kernel/src/types/column.ts:
   * `colId` (:95), `headerName` (:97), `cellDataType` (:124), `valueFormatter`
   * string form (:126-128), `editable` (:272), `initialHide` (:427),
   * `initialPinned` (:432), `initialWidth` (:437). initial* (not live
   * hide/width/pinned) — synthesized defs are construction-time seeds and must
   * not clobber user resize/hide state on colDef rebuilds. `__calcColumn: true`
   * marks the column for the kernel fold + resolvedPatchFor (Task 8).
   */
  synthesizedColDefs(): Array<Record<string, unknown>> {
    return [...this.#calcCols.values()].map(({ def }) => {
      const colDef: Record<string, unknown> = {
        colId: def.colId,
        headerName: def.headerName,
        cellDataType: kernelCellDataTypeOf(def.cellDataType),
        editable: false,          // calc columns are derived — never editable
        __calcColumn: true,
      };
      if (def.format !== undefined) colDef.valueFormatter = def.format;
      if (def.initialWidth !== undefined) colDef.initialWidth = def.initialWidth;
      if (def.initialHide !== undefined) colDef.initialHide = def.initialHide;
      if (def.initialPinned !== undefined) colDef.initialPinned = def.initialPinned;
      return colDef;
    });
  }

  /** Fires synchronously after every successful register/remove — never on a
   *  failed register or an unknown-colId remove. */
  onColumnsChanged(fn: () => void): Unsubscribe {
    this.#columnListeners.add(fn);
    return () => {
      this.#columnListeners.delete(fn);
    };
  }

  #notifyColumnsChanged(): void {
    for (const fn of [...this.#columnListeners]) fn();
  }

  // ── Overrides + templates (Task 8) ─────────────────────────────────────

  applyOverrides(_overrides: ColumnOverride[]): { ok: boolean; errors: CalcValidationError[] } {
    throw new Error('not-yet-implemented: applyOverrides ships in Task 8');
  }

  getOverrides(): ColumnOverride[] {
    throw new Error('not-yet-implemented: getOverrides ships in Task 8');
  }

  saveTemplate(_spec: Omit<ColumnTemplate, 'createdAt' | 'updatedAt'> & { now: number }): void {
    throw new Error('not-yet-implemented: saveTemplate ships in Task 8');
  }

  applyTemplate(_templateId: string, _colIds: string[]): void {
    throw new Error('not-yet-implemented: applyTemplate ships in Task 8');
  }

  deleteTemplate(_templateId: string): void {
    throw new Error('not-yet-implemented: deleteTemplate ships in Task 8');
  }

  listTemplates(): ColumnTemplate[] {
    throw new Error('not-yet-implemented: listTemplates ships in Task 8');
  }

  setTypeDefaults(_defaults: TypeDefaults): void {
    throw new Error('not-yet-implemented: setTypeDefaults ships in Task 8');
  }

  resolvedPatchFor(_colId: string, _cellDataType: 'text' | 'number'): Record<string, unknown> | null {
    throw new Error('not-yet-implemented: resolvedPatchFor ships in Task 8');
  }
}
