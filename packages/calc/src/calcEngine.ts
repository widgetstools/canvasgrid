// CalcEngine — registered calculated columns + compiled-program store
// (this task), override/template stores + fold (Task 8).
//
// Date-free by contract (Global Constraints): the engine never reads a clock;
// template timestamps arrive via saveTemplate's `now` argument (Task 8).

import type { Schema } from '@cgrid/expression';
import { compileFormat } from '@cgrid/format';
import { compileCalc } from './compile';
import { foldTemplateChain } from './templates';
import { overrideToKernelPatch } from './overrides';
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
  #overrides = new Map<string, ColumnOverride>();     // keyed by colId, insertion-ordered
  #templates = new Map<string, ColumnTemplate>();     // keyed by template id
  #typeDefaults: TypeDefaults = {};

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
   * `compiled` (plain-JSON ast + prePass) to the worker.
   *
   * Every entry is a fully defensive copy — mutating a returned def, ast,
   * prePass, or watchedColIds never touches the store. Consequently object
   * identity is NOT stable across calls: consumers serialize the ast/prePass
   * JSON; nothing may rely on identity (evaluatePerRow's per-CompiledCalc
   * runner cache simply recompiles a fresh copy lazily, by design).
   */
  compiledColumns(): ReadonlyArray<{ def: CalculatedColumnDef; compiled: CompiledCalc }> {
    return Object.freeze(
      [...this.#calcCols.values()].map((entry) => ({
        def: structuredClone(entry.def),
        compiled: {
          ast: structuredClone(entry.compiled.ast),
          prePass: structuredClone(entry.compiled.prePass),
          watchedColIds: new Set(entry.compiled.watchedColIds),
          usesPrev: entry.compiled.usesPrev,
          cellDataType: entry.compiled.cellDataType,
        },
      })),
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

  /** Atomic per call: any invalid entry → nothing stored. Valid calls upsert
   *  per colId (that colId's override is replaced wholesale). No notification
   *  — the Task 14 bridge triggers the kernel colDef rebuild itself. */
  applyOverrides(overrides: ColumnOverride[]): { ok: boolean; errors: CalcValidationError[] } {
    const errors: CalcValidationError[] = [];
    for (const override of overrides) {
      if (typeof override.colId !== 'string' || override.colId.length === 0) {
        errors.push({
          colId: null,
          code: 'bad-shape',
          message: 'override colId must be a non-empty string',
          loc: null,
        });
        continue;
      }
      if (override.format !== undefined) {
        const fmt = compileFormat(override.format);
        if (!fmt.ok) {
          errors.push({
            colId: override.colId,
            code: 'format-compile',
            message: `override format failed to compile: ${fmt.error.message}`,
            loc: null,
          });
        }
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    for (const override of overrides) this.#overrides.set(override.colId, structuredClone(override));
    return { ok: true, errors: [] };
  }

  getOverrides(): ColumnOverride[] {
    return [...this.#overrides.values()].map((override) => structuredClone(override));
  }

  /** Date-free: the CALLER stamps `now`. Re-save of an existing id preserves
   *  createdAt and bumps updatedAt. Throws on host-authoring errors (empty id,
   *  non-compiling format) — void return per the locked spec §3 signature. */
  saveTemplate(spec: Omit<ColumnTemplate, 'createdAt' | 'updatedAt'> & { now: number }): void {
    const { now, ...template } = spec;
    if (typeof template.id !== 'string' || template.id.length === 0) {
      throw new Error('template id must be a non-empty string');
    }
    if (template.overrides.format !== undefined) {
      const fmt = compileFormat(template.overrides.format);
      if (!fmt.ok) {
        throw new Error(`template '${template.id}' format failed to compile: ${fmt.error.message}`);
      }
    }
    const existing = this.#templates.get(template.id);
    this.#templates.set(template.id, structuredClone({
      ...template,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }));
  }

  /** Sets templateIds on the columns' overrides — bare override created where
   *  none exists; existing chains get the id appended (dedup). NOTE (StarUI 07):
   *  a column whose templateIds was undefined becomes explicitly chained, so
   *  the typeDefault stops applying to it. Dangling ids are legal. */
  applyTemplate(templateId: string, colIds: string[]): void {
    for (const colId of colIds) {
      const existing = this.#overrides.get(colId);
      if (existing === undefined) {
        this.#overrides.set(colId, { colId, templateIds: [templateId] });
        continue;
      }
      const chain = existing.templateIds ?? [];
      if (!chain.includes(templateId)) existing.templateIds = [...chain, templateId];
    }
  }

  /** NO cascade (StarUI 07 lifecycle independence): assignment refs stay —
   *  the fold skips dangling ids; re-saving the template revives them. */
  deleteTemplate(templateId: string): void {
    this.#templates.delete(templateId);
  }

  listTemplates(): ColumnTemplate[] {
    return [...this.#templates.values()].map((template) => structuredClone(template));
  }

  setTypeDefaults(defaults: TypeDefaults): void {
    this.#typeDefaults = structuredClone(defaults);
  }

  /**
   * Folded per-column kernel patch (template chain + override), or null.
   * Called by the Task 9 kernel fold per column, pre-resolveColDefs.
   *
   * Two-bucket typeDefault degradation (LOCKED): `TypeDefaults` keeps StarUI's
   * four buckets, but this accessor takes the KERNEL cellDataType, which is
   * binary — 'number' → typeDefaults.numeric, 'text' → typeDefaults.string.
   * The date/boolean buckets are stored and preserved but unreachable until
   * the kernel grows date/boolean cell data types — an HONEST LIMITATION
   * documented here + README, not a silent drop.
   */
  resolvedPatchFor(colId: string, cellDataType: 'text' | 'number'): Record<string, unknown> | null {
    const assignment = this.#overrides.get(colId) ?? null;
    let typeDefaultTemplate: ColumnTemplate | null = null;
    let chain: ColumnTemplate[] = [];
    const templateIds = assignment?.templateIds;
    if (templateIds === undefined) {
      // undefined → typeDefault bucket applies ([] below opts out).
      const bucketId = cellDataType === 'number' ? this.#typeDefaults.numeric : this.#typeDefaults.string;
      typeDefaultTemplate = (bucketId !== undefined ? this.#templates.get(bucketId) : undefined) ?? null;
    } else {
      chain = templateIds
        .map((id) => this.#templates.get(id))
        .filter((template): template is ColumnTemplate => template !== undefined); // dangling ids skipped silently
    }
    if (assignment === null && typeDefaultTemplate === null) return null;
    const merged = foldTemplateChain(typeDefaultTemplate, chain, assignment ?? { colId });
    const patch = overrideToKernelPatch(merged, { isCalcColumn: this.#calcCols.has(colId) });
    return Object.keys(patch).length > 0 ? patch : null;
  }
}
