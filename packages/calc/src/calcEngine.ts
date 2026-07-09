// CalcEngine — registered calculated columns + compiled-program store
// (this task), override/template stores + fold (Task 8).
//
// Date-free by contract (Global Constraints): the engine never reads a clock;
// template timestamps arrive via saveTemplate's `now` argument (Task 8).
//
// Cycle 21d / Task 12 review fix — calc-on-calc references are REJECTED.
// A calculated column's expression may only watch DATA fields (or unknown
// field names when no schema was given); it may never reference another
// calculated column's colId. `registerCalculatedColumn` checks BOTH
// directions, order-independently: (1) does the NEW column's
// `watchedColIds` include an ALREADY-registered calc colId, and (2) does
// an ALREADY-registered column's `watchedColIds` include the NEW column's
// colId (covers registering the referencing column FIRST, before the
// column it references exists). Both fail with `{ code: 'bad-shape',
// message: 'calculated columns cannot reference other calculated
// columns' }`. Rationale: the kernel's worker-side CalcPass (Stage A/B)
// has no defined evaluation ORDER between calc columns within a single
// pipeline pass — allowing a calc-on-calc reference would make the
// referencing column's value depend on iteration order (stale on one
// pass, fresh on the next), an undebuggable correctness hazard. Removing
// the referenced column (`removeCalculatedColumn`) lifts the restriction
// for a subsequent registration of the same expression, since the
// reference then resolves as an ordinary (unregistered) field name.

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
  IconOverride,
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

/** The stable id of a column's OWN auto-template (auto-template-on-edit,
 *  Phase B / B2). Namespaced so it can never collide with a host-authored
 *  template id — same collision-proofing as the typeDefaults synthetics. */
export function ownTemplateId(colId: string): string {
  return `__cgridOwn:${colId}`;
}

/** True for an own-template id minted by {@link ownTemplateId}. */
export function isOwnTemplateId(templateId: string): boolean {
  return templateId.startsWith('__cgridOwn:');
}

/** Editable scalar attributes an edit may write into a column's own template
 *  (spec §3.1 templatable set). `headerName` is EXCLUDED — caption is
 *  column-unique and never templated; `cellStyle` merges per-key separately. */
const EDITABLE_SCALAR_KEYS = [
  'format', 'cellRenderer', 'editable', 'hide', 'width',
  'floatingFilter', 'filter', 'enableRowGroup', 'enablePivot',
  'sortable', 'resizable', 'suppressAggFuncInHeader',
] as const;

/** The editable-attribute patch accepted by {@link CalcEngine.editColumn}. */
export type ColumnEditPatch = Partial<
  Pick<
    ColumnOverride,
    | 'cellRenderer' | 'editable' | 'hide' | 'width' | 'cellStyle' | 'headerStyle'
    | 'floatingFilter' | 'enableRowGroup' | 'enablePivot' | 'sortable' | 'resizable'
    | 'suppressAggFuncInHeader'
  >
> & {
  /** Format-DSL string → kernel compiler. `null` REMOVES the stored format
   *  from the column's own template (parity with cellIcon/headerIcon
   *  slot-clear); undefined leaves it untouched. Patch-side only — stored
   *  templates (`ColumnOverride.format`) never hold `null`. */
  format?: string | null;
  /** Static icon refs. `null` REMOVES the stored icon (a slot-clear from
   *  the toolbar); undefined leaves it untouched. */
  cellIcon?: IconOverride | null;
  headerIcon?: IconOverride | null;
  /** Filter type. `null` REMOVES the stored key (revert to the
   *  cellDataType default); undefined leaves it untouched. */
  filter?: 'text' | 'number' | 'date' | 'set' | null;
};

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

    // Task 12 review fix — calc columns cannot reference other calc
    // columns. Checked order-independently in BOTH directions: (a) does
    // THIS column's expression watch an already-registered calc colId,
    // and (b) does an already-registered column's expression watch THIS
    // colId (covers the case where the referencing column was
    // registered FIRST, before the column it references existed). A
    // calc-on-calc reference would require Stage A/B to sequence one
    // calc column's compute after another's within the same pipeline
    // pass — unsupported today; the kernel's CalcPass has no ordering
    // between calc columns, so silently allowing this would produce
    // stale/undefined reads depending on iteration order. See README.
    const referencedColId = [...compiledResult.compiled.watchedColIds].find((colId) => this.#calcCols.has(colId));
    if (referencedColId !== undefined) {
      return {
        ok: false,
        errors: [{
          colId: def.colId,
          code: 'bad-shape',
          message: 'calculated columns cannot reference other calculated columns',
          loc: null,
        }],
      };
    }
    for (const existing of this.#calcCols.values()) {
      if (existing.compiled.watchedColIds.has(def.colId)) {
        return {
          ok: false,
          errors: [{
            colId: def.colId,
            code: 'bad-shape',
            message: 'calculated columns cannot reference other calculated columns',
            loc: null,
          }],
        };
      }
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

  /** Drop the entire per-column override layer (Grid Layouts / Phase B, B4).
   *  The bridge's layout-tier `columnOverrides` state module calls this before
   *  re-applying a layout's overrides, giving REPLACE (not merge) restore
   *  semantics — switching layouts must not leak the outgoing layout's
   *  assignments. Like `applyOverrides`, does NOT self-notify (the bridge
   *  wraps it to trigger the kernel colDef rebuild). */
  clearOverrides(): void {
    this.#overrides.clear();
  }

  /**
   * Auto-template-on-edit (spec §3.1). Merge an editable-attribute patch into
   * the column's OWN template ({@link ownTemplateId}, name `<colId>_template`,
   * created on first edit) and ensure the column references it from
   * `templateIds`. The own template folds HIGHEST (see `resolvedPatchFor`), so
   * the edit wins over any applied shared template WITHOUT mutating that
   * shared template — a consumer edit forks to the column's own.
   *
   * `headerName` is intentionally not accepted (caption is column-unique).
   * Atomic: a non-compiling `format` leaves the own template untouched. Like
   * `applyOverrides`, this does NOT self-notify — the Task 14 bridge wraps it
   * to trigger the kernel colDef rebuild.
   */
  editColumn(
    colId: string,
    patch: ColumnEditPatch,
    opts: { now: number },
  ): { ok: boolean; errors: CalcValidationError[] } {
    if (typeof colId !== 'string' || colId.length === 0) {
      return { ok: false, errors: [{ colId: null, code: 'bad-shape', message: 'editColumn colId must be a non-empty string', loc: null }] };
    }
    if (patch.format !== undefined && patch.format !== null) {
      const fmt = compileFormat(patch.format);
      if (!fmt.ok) {
        return { ok: false, errors: [{ colId, code: 'format-compile', message: `edit format failed to compile: ${fmt.error.message}`, loc: null }] };
      }
    }

    // Merge the patch into the column's own template (create-if-absent).
    const ownId = ownTemplateId(colId);
    const existing = this.#templates.get(ownId);
    const overrides: ColumnTemplate['overrides'] = { ...(existing?.overrides ?? {}) };
    const target = overrides as Record<string, unknown>;
    for (const key of EDITABLE_SCALAR_KEYS) {
      const value = patch[key];
      // `!== undefined`, not truthiness — a DEFINED falsy (editable:false,
      // hide:false, width:0) must land.
      if (value !== undefined) target[key] = value;
    }
    // format — `null` → remove from the own template (parity with cellIcon).
    if (patch.format === null) delete target.format;
    // filter — `null` → remove from the own template (format parity).
    if (patch.filter === null) delete target.filter;
    if (patch.cellStyle !== undefined) {
      // Clone so a caller mutating a shared cellStyle object (or its nested
      // values) after the edit can't corrupt the stored own template (L3).
      overrides.cellStyle = structuredClone({ ...(overrides.cellStyle ?? {}), ...patch.cellStyle });
    }
    if (patch.headerStyle !== undefined) {
      // Same per-key merge + clone semantics as cellStyle.
      overrides.headerStyle = structuredClone({ ...(overrides.headerStyle ?? {}), ...patch.headerStyle });
    }
    // cellIcon / headerIcon — wholesale set, or `null` → remove (slot clear).
    if (patch.cellIcon !== undefined) {
      if (patch.cellIcon === null) delete overrides.cellIcon;
      else overrides.cellIcon = structuredClone(patch.cellIcon);
    }
    if (patch.headerIcon !== undefined) {
      if (patch.headerIcon === null) delete overrides.headerIcon;
      else overrides.headerIcon = structuredClone(patch.headerIcon);
    }
    this.#templates.set(ownId, {
      id: ownId,
      name: existing?.name ?? `${colId}_template`,
      overrides,
      createdAt: existing?.createdAt ?? opts.now,
      updatedAt: opts.now,
    });

    // Ensure the column references its own template (position is irrelevant —
    // `resolvedPatchFor` folds it highest regardless).
    const override = this.#overrides.get(colId);
    if (override === undefined) {
      this.#overrides.set(colId, { colId, templateIds: [ownId] });
    } else {
      const chain = override.templateIds ?? [];
      if (!chain.includes(ownId)) override.templateIds = [...chain, ownId];
    }
    return { ok: true, errors: [] };
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
    // Caption (`headerName`) is column-unique and NEVER templated (spec §3.1) —
    // strip it here so it can't ride a shared template onto multiple columns,
    // regardless of the entry path (API, bridge seed, module restore, import).
    const { headerName: _dropped, ...overrides } = template.overrides;
    this.#templates.set(template.id, structuredClone({
      ...template,
      overrides,
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

  /**
   * Rename a template's display name (Grid Layouts / Phase B, spec §8).
   * Enforces GRID-WIDE unique names (trimmed, case-insensitive) — `saveTemplate`
   * only guards unique ids, so this is the sole name-uniqueness gate. Preserves
   * `createdAt`, bumps `updatedAt` (caller stamps `now` — engine stays
   * Date-free). Renaming a template to its own current name is allowed.
   * Throws on: unknown id, empty/whitespace name, a name already used by
   * ANOTHER template. Does NOT self-notify — a rename changes no colDef output
   * (only metadata); the bridge wires the `templatesChanged` event.
   */
  renameTemplate(templateId: string, name: string, opts: { now: number }): void {
    const existing = this.#templates.get(templateId);
    if (existing === undefined) {
      throw new Error(`template '${templateId}' not found`);
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('template name must be a non-empty string');
    }
    const key = trimmed.toLowerCase();
    for (const [id, t] of this.#templates) {
      if (id !== templateId && t.name.trim().toLowerCase() === key) {
        throw new Error(`template name '${trimmed}' already in use`);
      }
    }
    this.#templates.set(templateId, {
      ...existing,
      name: trimmed,
      updatedAt: opts.now,
    });
  }

  /**
   * Unassign a template from a single column (Grid Layouts / Phase B, spec §8)
   * — the inverse of `applyTemplate(templateId, [colId])`. Drops `templateId`
   * from that column's `templateIds` chain; the removed template stays in the
   * library (this is not `deleteTemplate`). Removing the last template leaves
   * an EXPLICIT empty chain (`templateIds: []`), which opts the column OUT of
   * the typeDefault (per the `ColumnOverride.templateIds` contract) rather than
   * silently resurrecting it. No-op when the column has no override or the id
   * isn't in its chain. Like `applyTemplate`, does NOT self-notify — the bridge
   * triggers the kernel colDef rebuild.
   */
  removeTemplate(colId: string, templateId: string): void {
    const override = this.#overrides.get(colId);
    if (override === undefined) return;
    const chain = override.templateIds;
    if (chain === undefined || !chain.includes(templateId)) return;
    override.templateIds = chain.filter((id) => id !== templateId);
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
      // Auto-template-on-edit (B2): the column's OWN template always folds
      // HIGHEST, whatever its position in templateIds (e.g. a shared template
      // applied AFTER the edit must not override the edit).
      const ownIdx = chain.findIndex((t) => t.id === ownTemplateId(colId));
      if (ownIdx >= 0 && ownIdx !== chain.length - 1) {
        const [own] = chain.splice(ownIdx, 1);
        chain.push(own!);
      }
    }
    if (assignment === null && typeDefaultTemplate === null) return null;
    const merged = foldTemplateChain(typeDefaultTemplate, chain, assignment ?? { colId });
    const patch = overrideToKernelPatch(merged, { isCalcColumn: this.#calcCols.has(colId) });
    return Object.keys(patch).length > 0 ? patch : null;
  }
}
