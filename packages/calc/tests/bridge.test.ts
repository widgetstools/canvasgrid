// Cycle 21d / Task 14 — wireIntoKernel bridge.
//
// Fake-grid fixture mirrors packages/rules/tests/bridge.test.ts, but
// smaller: calc needs NO grid events — the kernel calcSlot PULLS
// everything through the provider accessors — so the fixture only
// records registerCalcProvider calls. Real CalcEngine + compile
// pipeline (Phases B-D) run underneath; no engine mocking.
//
// CROSS-TASK CONTRACT verified against landed code (Step 1):
//   - CalcProviderShape (packages/kernel/src/core/calcSlot.ts):
//     synthesizedColDefs(), resolvedPatchFor(colId, cellDataType),
//     workerProgram(): unknown | null (NOT always-populated — null
//     when no calc column is registered), onColumnsChanged(fn).
//   - CalcEngine accessors (Tasks 7/8): synthesizedColDefs(),
//     compiledColumns(), onColumnsChanged() — the last fires ONLY on
//     successful register/remove (calcEngine.ts's own doc comment:
//     "No notification [on applyOverrides] — the Task 14 bridge
//     triggers the kernel colDef rebuild itself"). The bridge must
//     therefore also notify on override/template/typeDefaults
//     mutations, including when the HOST calls calc.applyOverrides(...)
//     directly post-wire (not just opts-seeding) — verified below.
//   - buildWorkerCalcProgram(cols, aggregates?) — Task 10's landed
//     arity takes aggregates as an optional second param.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { wireIntoKernel } from '../src/bridge';
import { CalcEngine } from '../src/calcEngine';
import type { CalculatedColumnDef, ColumnTemplate } from '../src/types';

// ─── Fixtures ──────────────────────────────────────────────────────────

const NOTIONAL: CalculatedColumnDef = {
  colId: 'notional', headerName: 'Notional', expression: '[qty] * [price]',
  format: '$#,##0', cellDataType: 'currency', initialWidth: 110,
};

const PCT: CalculatedColumnDef = {
  colId: 'pctOfGroup', headerName: '% of Group',
  expression: "[qty] / SUM([qty], 'group')", cellDataType: 'percent',
};

const BROKEN: CalculatedColumnDef = {
  colId: 'broken', headerName: 'Broken', expression: '[qty] +', // parse error
};

const TEMPLATE: ColumnTemplate = {
  id: 'compact', name: 'Compact', overrides: { width: 90 },
  createdAt: 1_000, updatedAt: 2_000,
};

// Structural mirror of kernel's CalcProviderShape (core/calcSlot.ts,
// Task 9) — CROSS-TASK CONTRACT: keep member names + return shapes
// identical to the landed slot type. workerProgram() is `unknown | null`.
interface ProviderShape {
  synthesizedColDefs(): Array<Record<string, unknown>>;
  resolvedPatchFor(colId: string, cellDataType: 'text' | 'number'): Record<string, unknown> | null;
  workerProgram(): {
    columns: Array<{ colId: string; ast: unknown; prePass: unknown[]; cellDataType: string }>;
    interpreterSource: string;
    aggregateSources: Array<{ name: string; source: string }>;
  } | null;
  onColumnsChanged(cb: () => void): () => void;
  // Grid Layouts / Phase B (B3) — template library CRUD.
  getTemplates(): ColumnTemplate[];
  saveTemplate(spec: {
    id: string; name: string; description?: string;
    overrides: ColumnTemplate['overrides']; now: number;
  }): void;
  renameTemplate(templateId: string, name: string, now: number): void;
  deleteTemplate(templateId: string): void;
  applyTemplate(colId: string, templateId: string): void;
  removeTemplate(colId: string, templateId: string): void;
}

interface StateModuleShape {
  id: string;
  version: number;
  get(): unknown;
  set(data: unknown, version: number): void;
}

function makeFakeGrid() {
  const providers: ProviderShape[] = [];
  const modules: StateModuleShape[] = [];
  return {
    registerCalcProvider(p: unknown) { providers.push(p as ProviderShape); },
    registerStateModule(m: unknown) { modules.push(m as StateModuleShape); return () => {}; },
    _providers: providers,
    _modules: modules,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

// ─── Tests ─────────────────────────────────────────────────────────────

describe('wireIntoKernel', () => {
  it('registers exactly one calc provider and returns the engine', () => {
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid, { calculatedColumns: [NOTIONAL] });
    expect(grid._providers).toHaveLength(1);
    expect(calc).toBeInstanceOf(CalcEngine);
    expect(calc.listCalculatedColumns().map((d) => d.colId)).toEqual(['notional']);
  });

  it('seeds calculatedColumns, overrides, templates, and typeDefaults from opts', () => {
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid, {
      calculatedColumns: [NOTIONAL, PCT],
      overrides: [{ colId: 'price', headerName: 'Px' }],
      templates: [TEMPLATE],
      typeDefaults: { numeric: '#,##0.00' },
    });
    expect(calc.listCalculatedColumns().map((d) => d.colId)).toEqual(['notional', 'pctOfGroup']);
    expect(calc.getOverrides()).toEqual([{ colId: 'price', headerName: 'Px' }]);
    expect(calc.listTemplates().map((t) => t.id)).toEqual(['compact']);
    // typeDefaults surface through the fold: a numeric data column with
    // no explicit override inherits the default format string.
    const patch = calc.resolvedPatchFor('someNumericCol', 'number');
    expect(patch).not.toBeNull();
    expect(JSON.stringify(patch)).toContain('#,##0.00');
  });

  it('skips invalid opts items with a console.warn, keeps valid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid, { calculatedColumns: [BROKEN, NOTIONAL] });
    expect(calc.listCalculatedColumns().map((d) => d.colId)).toEqual(['notional']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[cgrid/calc] skipped calculated column 'broken'"),
    );
  });

  it('provider accessors delegate to the engine', () => {
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid, { calculatedColumns: [NOTIONAL] });
    const provider = grid._providers[0]!;

    const defs = provider.synthesizedColDefs();
    expect(defs.map((d) => d.colId)).toEqual(['notional']);

    const spy = vi.spyOn(calc, 'resolvedPatchFor');
    provider.resolvedPatchFor('price', 'number');
    expect(spy).toHaveBeenCalledWith('price', 'number');
  });

  it('workerProgram() is null when no calc column is registered', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid);
    const payload = grid._providers[0]!.workerProgram();
    expect(payload).toBeNull();
  });

  it('workerProgram payload carries columns + interpreterSource + aggregateSources', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, { calculatedColumns: [NOTIONAL, PCT] });
    const payload = grid._providers[0]!.workerProgram();
    expect(payload).not.toBeNull();

    expect(payload!.columns.map((c) => c.colId)).toEqual(['notional', 'pctOfGroup']);
    for (const col of payload!.columns) {
      expect(col.ast).toBeTruthy();                       // portable JSON AST
      expect(Array.isArray(col.prePass)).toBe(true);
      expect(typeof col.cellDataType).toBe('string');
    }
    // Row-local column: empty pre-pass. Aggregate column: one AggSpec.
    expect(payload!.columns[0]!.prePass).toHaveLength(0);
    expect(payload!.columns[1]!.prePass).toHaveLength(1);

    expect(typeof payload!.interpreterSource).toBe('string');
    expect(payload!.interpreterSource).toContain('function'); // new Function-reconstructable

    const names = payload!.aggregateSources.map((a) => a.name);
    expect(names).toContain('SUM');
    for (const a of payload!.aggregateSources) {
      expect(typeof a.source).toBe('string');
      expect(a.source.length).toBeGreaterThan(0);
    }
  });

  it('onColumnsChanged relays engine column mutations to the kernel callback', () => {
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid, { calculatedColumns: [NOTIONAL] });
    const fired: number[] = [];
    grid._providers[0]!.onColumnsChanged(() => fired.push(1));

    calc.registerCalculatedColumn(PCT);
    expect(fired.length).toBeGreaterThan(0);

    // Override/template mutations change resolved defs → must also fire,
    // even though CalcEngine.applyOverrides itself does not notify
    // (calcEngine.ts: "the Task 14 bridge triggers the kernel colDef
    // rebuild itself") — the bridge wraps the returned calc's mutator
    // methods so a HOST calling calc.applyOverrides directly still
    // reaches the kernel callback.
    const before = fired.length;
    calc.applyOverrides([{ colId: 'qty', width: 80 }]);
    expect(fired.length).toBeGreaterThan(before);
  });

  it('onColumnsChanged fires on saveTemplate/applyTemplate/setTypeDefaults/deleteTemplate too', () => {
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid);
    const fired: number[] = [];
    grid._providers[0]!.onColumnsChanged(() => fired.push(1));

    calc.saveTemplate({ id: 't1', name: 'T1', overrides: { width: 80 }, now: 1 });
    expect(fired.length).toBe(1);

    calc.applyTemplate('t1', ['qty']);
    expect(fired.length).toBe(2);

    calc.setTypeDefaults({ numeric: '0.00' });
    expect(fired.length).toBe(3);

    calc.deleteTemplate('t1');
    expect(fired.length).toBe(4);
  });

  it('exposes template-library CRUD on the provider, delegating to the engine (Phase B / B3)', () => {
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid, { typeDefaults: { numeric: '#,##0' } });
    const provider = grid._providers[0]!;
    const fired: number[] = [];
    provider.onColumnsChanged(() => fired.push(1));

    // save → appears in getTemplates (synthetic typeDefaults filtered) + notifies
    provider.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' }, now: 1 });
    expect(provider.getTemplates().map((t) => t.id)).toEqual(['money']); // no __cgridTypeDefault:*
    expect(fired.length).toBe(1);

    // rename → name changes, NO rebuild notification (metadata only)
    provider.renameTemplate('money', 'Currency', 2);
    expect(provider.getTemplates()[0]!.name).toBe('Currency');
    expect(fired.length).toBe(1); // unchanged

    // apply(colId, tid) → engine.applyTemplate(tid, [colId]) + notifies
    provider.applyTemplate('px', 'money');
    expect(calc.getOverrides().find((o) => o.colId === 'px')!.templateIds).toEqual(['money']);
    expect(fired.length).toBe(2);

    // remove(colId, tid) → drops from chain (kept in library) + notifies
    provider.removeTemplate('px', 'money');
    expect(calc.getOverrides().find((o) => o.colId === 'px')!.templateIds).toEqual([]);
    expect(provider.getTemplates().map((t) => t.id)).toEqual(['money']); // still in library
    expect(fired.length).toBe(3);

    // delete → gone from library + notifies
    provider.deleteTemplate('money');
    expect(provider.getTemplates()).toEqual([]);
    expect(fired.length).toBe(4);
  });

  it('renameTemplate through the provider rejects a duplicate name', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid);
    const provider = grid._providers[0]!;
    provider.saveTemplate({ id: 'a', name: 'Alpha', overrides: {}, now: 1 });
    provider.saveTemplate({ id: 'b', name: 'Beta', overrides: {}, now: 1 });
    expect(() => provider.renameTemplate('b', 'alpha', 2)).toThrow(/in use/);
  });

  it('is idempotent — re-calling returns the SAME { calc } object', () => {
    const grid = makeFakeGrid();
    const first = wireIntoKernel(grid, { calculatedColumns: [NOTIONAL] });
    const again = wireIntoKernel(grid);
    expect(again).toBe(first);
    expect(again.calc).toBe(first.calc);
    expect(grid._providers).toHaveLength(1);
  });
});

// Grid Layouts — Phase B / B1: the calc bridge registers two kernel state
// modules so the template library + calc-column defs ride getState/setState +
// persistState + layouts. Tier is keyed off the module id in the kernel
// (`templates` is grid-tier, `calc` is layout-tier — see the kernel's
// DEFAULT_GRID_LEVEL_MODULES); here we prove the serialize/restore logic.
describe('wireIntoKernel — Grid Layouts state modules (Phase B / B1)', () => {
  function modulesOf(grid: ReturnType<typeof makeFakeGrid>): Map<string, StateModuleShape> {
    return new Map(grid._modules.map((m) => [m.id, m]));
  }

  it('registers `templates` (grid-tier) + `calc` + `columnOverrides` (layout-tier) modules that serialize the engine', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, { templates: [TEMPLATE], calculatedColumns: [NOTIONAL] });
    const mods = modulesOf(grid);
    expect([...mods.keys()].sort()).toEqual(['calc', 'columnOverrides', 'templates']);
    expect(mods.get('templates')!.get()).toEqual([expect.objectContaining({ id: 'compact', name: 'Compact', overrides: { width: 90 } })]);
    expect(mods.get('calc')!.get()).toEqual([expect.objectContaining({ colId: 'notional', expression: '[qty] * [price]' })]);
  });

  it('columnOverrides (layout-tier) round-trips template ASSIGNMENTS with REPLACE semantics (B4)', () => {
    const src = makeFakeGrid();
    const { calc } = wireIntoKernel(src, { templates: [TEMPLATE] });
    calc.applyTemplate('compact', ['px', 'qty']); // assign a data-col template
    const overridesData = modulesOf(src).get('columnOverrides')!.get();
    expect(overridesData).toEqual([
      expect.objectContaining({ colId: 'px', templateIds: ['compact'] }),
      expect.objectContaining({ colId: 'qty', templateIds: ['compact'] }),
    ]);

    // restore into a fresh engine that already has a STALE override → REPLACE
    const dest = makeFakeGrid();
    const { calc: calc2 } = wireIntoKernel(dest, {});
    calc2.applyOverrides([{ colId: 'stale', width: 10 }]);
    modulesOf(dest).get('columnOverrides')!.set(overridesData, 1);
    expect(calc2.getOverrides().map((o) => o.colId)).toEqual(['px', 'qty']); // 'stale' gone
  });

  it('columnOverrides get() is undefined when there are no overrides', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, {});
    expect(modulesOf(grid).get('columnOverrides')!.get()).toBeUndefined();
  });

  it('omits an empty module from the snapshot (get returns undefined)', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, {}); // nothing seeded
    const mods = modulesOf(grid);
    expect(mods.get('templates')!.get()).toBeUndefined();
    expect(mods.get('calc')!.get()).toBeUndefined();
  });

  it('does not surface the synthetic typeDefaults templates in the `templates` module', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid, { typeDefaults: { numeric: '#,##0' }, templates: [TEMPLATE] });
    const templates = modulesOf(grid).get('templates')!.get() as ColumnTemplate[];
    expect(templates.map((t) => t.id)).toEqual(['compact']); // no __cgridTypeDefault:*
  });

  it('round-trips the library + calc defs into a fresh engine via set()', () => {
    const src = makeFakeGrid();
    wireIntoKernel(src, { templates: [TEMPLATE], calculatedColumns: [NOTIONAL] });
    const srcMods = modulesOf(src);
    const templatesData = srcMods.get('templates')!.get();
    const calcData = srcMods.get('calc')!.get();

    const dest = makeFakeGrid();
    const { calc: calc2 } = wireIntoKernel(dest, {});
    const destMods = modulesOf(dest);
    destMods.get('templates')!.set(templatesData, 1);
    destMods.get('calc')!.set(calcData, 1);
    expect(calc2.listTemplates().map((t) => t.id)).toEqual(['compact']);
    expect(calc2.listCalculatedColumns().map((c) => c.colId)).toEqual(['notional']);
  });

  it('set() REPLACES the current library / calc defs (not a merge)', () => {
    const grid = makeFakeGrid();
    const { calc } = wireIntoKernel(grid, { templates: [TEMPLATE], calculatedColumns: [NOTIONAL] });
    const mods = modulesOf(grid);
    mods.get('templates')!.set([{ id: 'other', name: 'Other', overrides: {}, createdAt: 5, updatedAt: 5 }], 1);
    mods.get('calc')!.set([], 1);
    expect(calc.listTemplates().map((t) => t.id)).toEqual(['other']); // 'compact' dropped
    expect(calc.listCalculatedColumns()).toEqual([]); // 'notional' dropped
  });
});
