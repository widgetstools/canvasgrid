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
}

function makeFakeGrid() {
  const providers: ProviderShape[] = [];
  return {
    registerCalcProvider(p: unknown) { providers.push(p as ProviderShape); },
    _providers: providers,
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

  it('is idempotent — re-calling returns the SAME { calc } object', () => {
    const grid = makeFakeGrid();
    const first = wireIntoKernel(grid, { calculatedColumns: [NOTIONAL] });
    const again = wireIntoKernel(grid);
    expect(again).toBe(first);
    expect(again.calc).toBe(first.calc);
    expect(grid._providers).toHaveLength(1);
  });
});
