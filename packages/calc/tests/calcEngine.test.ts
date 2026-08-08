import { describe, expect, it } from 'vitest';
import { CalcEngine } from '../src/calcEngine';
import { buildWorkerCalcProgram } from '../src/workerProgram';
import type { CalculatedColumnDef, CellDataType } from '../src/types';
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';

const SCHEMA: Schema = { fields: { price: 'number', qty: 'number', status: 'string' } };

function lineTotal(extra: Partial<CalculatedColumnDef> = {}): CalculatedColumnDef {
  return { colId: 'lineTotal', headerName: 'Line Total', expression: '[price] * [qty]', ...extra };
}

describe('CalcEngine — registerCalculatedColumn validation', () => {
  it('registers a row-local calculated column', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    const r = engine.registerCalculatedColumn(lineTotal());
    expect(r).toEqual({ ok: true, errors: [] });
    expect(engine.listCalculatedColumns().map((d) => d.colId)).toEqual(['lineTotal']);
  });

  it('rejects an empty colId as bad-shape and stores nothing', () => {
    const engine = new CalcEngine();
    const r = engine.registerCalculatedColumn(lineTotal({ colId: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.code).toBe('bad-shape');
    expect(engine.listCalculatedColumns()).toEqual([]);
  });

  it('rejects a duplicate calc colId as duplicate-colId', () => {
    const engine = new CalcEngine();
    expect(engine.registerCalculatedColumn(lineTotal()).ok).toBe(true);
    const r = engine.registerCalculatedColumn(lineTotal({ expression: '[price]' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]!).toMatchObject({ code: 'duplicate-colId', colId: 'lineTotal' });
    expect(engine.listCalculatedColumns()).toHaveLength(1);
  });

  it('rejects a colId colliding with a schema field as duplicate-colId', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    const r = engine.registerCalculatedColumn(lineTotal({ colId: 'price' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]!).toMatchObject({ code: 'duplicate-colId', colId: 'price' });
  });

  it('allows a field-shaped colId when no schema was given', () => {
    const engine = new CalcEngine();
    expect(engine.registerCalculatedColumn(lineTotal({ colId: 'price' })).ok).toBe(true);
  });

  it('passes compileCalc errors through with colId attached', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    const r = engine.registerCalculatedColumn(lineTotal({ expression: '[price] +' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.code).toBe('parse');
    expect(r.errors[0]!.colId).toBe('lineTotal');
    expect(engine.listCalculatedColumns()).toEqual([]);
  });

  it('rejects an invalid format string as format-compile and skips registration', () => {
    const engine = new CalcEngine();
    const fired: number[] = [];
    engine.onColumnsChanged(() => fired.push(1));
    const r = engine.registerCalculatedColumn(lineTotal({ format: '0;0;0;0;0' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: 'format-compile', colId: 'lineTotal', loc: null });
    expect(engine.listCalculatedColumns()).toEqual([]);
    expect(fired).toEqual([]);
  });

  it('accepts a valid format string', () => {
    const engine = new CalcEngine();
    expect(engine.registerCalculatedColumn(lineTotal({ format: '0.00' })).ok).toBe(true);
  });
});

describe('CalcEngine — registerCalculatedColumn rejects calc-on-calc references (Task 12 review fix)', () => {
  it('rejects registering a column whose expression references an ALREADY-registered calc colId', () => {
    const engine = new CalcEngine(); // no schema — checkField's unknown-field validation is a no-op
    expect(engine.registerCalculatedColumn(lineTotal()).ok).toBe(true); // lineTotal = [price] * [qty]
    const r = engine.registerCalculatedColumn({
      colId: 'lineTotalPlusOne',
      headerName: 'Line Total + 1',
      expression: '[lineTotal] + 1',
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!).toMatchObject({ colId: 'lineTotalPlusOne', code: 'bad-shape' });
    expect(r.errors[0]!.message).toBe('calculated columns cannot reference other calculated columns');
    expect(engine.listCalculatedColumns().map((d) => d.colId)).toEqual(['lineTotal']);
  });

  it('rejects registering a column whose expression references a calc colId that will be registered LATER (order-independent)', () => {
    const engine = new CalcEngine();
    // Register the referencing column FIRST — at this point 'lineTotal'
    // isn't registered yet, so a naive "check against ALREADY-registered
    // ids" implementation would let this through.
    const r1 = engine.registerCalculatedColumn({
      colId: 'lineTotalPlusOne',
      headerName: 'Line Total + 1',
      expression: '[lineTotal] + 1',
    });
    expect(r1.ok).toBe(true);
    // Now register 'lineTotal' — the order-independent check must catch
    // that an EARLIER-registered column already references this colId.
    const r2 = engine.registerCalculatedColumn(lineTotal());
    expect(r2.ok).toBe(false);
    expect(r2.errors[0]!).toMatchObject({ colId: 'lineTotal', code: 'bad-shape' });
    expect(r2.errors[0]!.message).toBe('calculated columns cannot reference other calculated columns');
    expect(engine.listCalculatedColumns().map((d) => d.colId)).toEqual(['lineTotalPlusOne']);
  });

  it('allows a calc column that references only data-schema fields', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    expect(engine.registerCalculatedColumn(lineTotal()).ok).toBe(true); // [price] * [qty] — data fields only
  });

  it('allows re-registering after removing the referenced calc column', () => {
    const engine = new CalcEngine();
    engine.registerCalculatedColumn(lineTotal());
    const blocked = engine.registerCalculatedColumn({
      colId: 'lineTotalPlusOne',
      headerName: 'Line Total + 1',
      expression: '[lineTotal] + 1',
    });
    expect(blocked.ok).toBe(false);
    engine.removeCalculatedColumn('lineTotal');
    const allowed = engine.registerCalculatedColumn({
      colId: 'lineTotalPlusOne',
      headerName: 'Line Total + 1',
      expression: '[lineTotal] + 1',
    });
    expect(allowed.ok).toBe(true); // 'lineTotal' is now just an ordinary (unregistered) field reference
  });
});

describe('CalcEngine — remove/list/compiledColumns', () => {
  it('removeCalculatedColumn removes; removing an unknown colId is a silent no-op', () => {
    const engine = new CalcEngine();
    engine.registerCalculatedColumn(lineTotal());
    engine.removeCalculatedColumn('lineTotal');
    expect(engine.listCalculatedColumns()).toEqual([]);
    expect(() => engine.removeCalculatedColumn('nope')).not.toThrow();
  });

  it('compiledColumns exposes { def, compiled } in registration order', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    engine.registerCalculatedColumn(lineTotal());
    engine.registerCalculatedColumn(lineTotal({ colId: 'unit', headerName: 'Unit', expression: '[price]' }));
    const cols = engine.compiledColumns();
    expect(cols.map((c) => c.def.colId)).toEqual(['lineTotal', 'unit']);
    expect(cols[0]!.compiled.watchedColIds.has('price')).toBe(true);
    expect(cols[0]!.compiled.watchedColIds.has('qty')).toBe(true);
    expect(Array.isArray(cols[0]!.compiled.prePass)).toBe(true);
    expect(cols[0]!.compiled.usesPrev).toBe(false);
  });

  it('listCalculatedColumns returns clones — mutating them does not touch the store', () => {
    const engine = new CalcEngine();
    engine.registerCalculatedColumn(lineTotal());
    engine.listCalculatedColumns()[0]!.headerName = 'HACKED';
    expect(engine.listCalculatedColumns()[0]!.headerName).toBe('Line Total');
  });

  it('compiledColumns returns defensive copies — mutating them does not touch the store', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    engine.registerCalculatedColumn(lineTotal());
    const stolen = engine.compiledColumns()[0]!;
    stolen.def.headerName = 'HACKED';
    (stolen.compiled.watchedColIds as Set<string>).add('hacked');
    (stolen.compiled.ast as { kind: string }).kind = 'hacked';
    const fresh = engine.compiledColumns()[0]!;
    expect(fresh.def.headerName).toBe('Line Total');
    expect(fresh.compiled.watchedColIds.has('hacked')).toBe(false);
    expect(fresh.compiled.ast.kind).not.toBe('hacked');
    expect(engine.listCalculatedColumns()[0]!.headerName).toBe('Line Total');
  });

  it('mutating a returned prePass does not corrupt subsequent buildWorkerCalcProgram output', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    engine.registerCalculatedColumn(lineTotal({ colId: 'share', expression: '[price] / SUM([price])' }));
    const stolen = engine.compiledColumns()[0]!;
    expect(stolen.compiled.prePass).toHaveLength(1);
    stolen.compiled.prePass[0]!.fn = 'HACKED';
    stolen.compiled.prePass[0]!.slot = 99;

    const program = buildWorkerCalcProgram(
      engine.compiledColumns().map((c) => ({
        colId: c.def.colId,
        ast: c.compiled.ast,
        prePass: c.compiled.prePass,
        cellDataType: c.compiled.cellDataType,
        usesPrev: c.compiled.usesPrev,
      })),
    );
    expect(program.columns[0]!.prePass).toEqual([
      { slot: 0, fn: 'SUM', colId: 'price', scope: { kind: 'visible' } },
    ]);
  });
});

describe('CalcEngine — synthesizedColDefs', () => {
  it('maps a fully-specified def to the exact kernel ColDef key set', () => {
    const engine = new CalcEngine();
    engine.registerCalculatedColumn(lineTotal({
      format: '0.00', initialWidth: 120, initialHide: true, initialPinned: 'right',
    }));
    expect(engine.synthesizedColDefs()).toEqual([{
      colId: 'lineTotal',
      headerName: 'Line Total',
      cellDataType: 'number',
      editable: false,
      __calcColumn: true,
      valueFormatter: '0.00',
      initialWidth: 120,
      initialHide: true,
      initialPinned: 'right',
    }]);
  });

  it('omits optional keys that are unset on the def', () => {
    const engine = new CalcEngine();
    engine.registerCalculatedColumn(lineTotal());
    const [colDef] = engine.synthesizedColDefs();
    for (const absent of ['valueFormatter', 'initialWidth', 'initialHide', 'initialPinned']) {
      expect(absent in colDef!).toBe(false);
    }
  });

  it('folds every CellDataType into the kernel binary type', () => {
    const folds: Array<[CellDataType | undefined, 'text' | 'number']> = [
      ['number', 'number'], ['currency', 'text'], ['percent', 'text'],
      ['date', 'text'], ['datetime', 'text'], ['string', 'text'],
      ['boolean', 'text'], [undefined, 'number'],
    ];
    const engine = new CalcEngine();
    folds.forEach(([cellDataType, _expected], i) => {
      engine.registerCalculatedColumn(lineTotal({ colId: `c${i}`, cellDataType }));
    });
    const byId = new Map(engine.synthesizedColDefs().map((d) => [d.colId, d.cellDataType]));
    folds.forEach(([, expected], i) => expect(byId.get(`c${i}`)).toBe(expected));
  });
});

describe('CalcEngine — onColumnsChanged', () => {
  it('fires on successful register and remove; not on failed register or unknown remove', () => {
    const engine = new CalcEngine();
    let count = 0;
    const off = engine.onColumnsChanged(() => { count += 1; });
    engine.registerCalculatedColumn(lineTotal());
    expect(count).toBe(1);
    engine.registerCalculatedColumn(lineTotal());          // duplicate → fails
    expect(count).toBe(1);
    engine.removeCalculatedColumn('nope');                 // unknown → no fire
    expect(count).toBe(1);
    engine.removeCalculatedColumn('lineTotal');
    expect(count).toBe(2);
    off();
    engine.registerCalculatedColumn(lineTotal());
    expect(count).toBe(2);
  });
});

describe('CalcEngine — structuredClone safety', () => {
  it('everything returned survives structuredClone', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    engine.registerCalculatedColumn(lineTotal({ format: '0.00', initialWidth: 100 }));
    expect(() => structuredClone(engine.listCalculatedColumns())).not.toThrow();
    expect(() => structuredClone(engine.synthesizedColDefs())).not.toThrow();
    const cloned = structuredClone(engine.compiledColumns()[0]!);
    expect(cloned.def.colId).toBe('lineTotal');
    expect(cloned.compiled.watchedColIds.has('price')).toBe(true);  // Set survives structuredClone
  });
});

// Engine-level suites — everything exercised via the CalcEngine surface only
// (foldTemplateChain / overrideToKernelPatch have their own unit files above).

describe('CalcEngine — applyOverrides/getOverrides', () => {
  it('stores overrides and returns clones', () => {
    const engine = new CalcEngine();
    const r = engine.applyOverrides([{ colId: 'px', headerName: 'Px', width: 100 }]);
    expect(r).toEqual({ ok: true, errors: [] });
    const out = engine.getOverrides();
    expect(out).toEqual([{ colId: 'px', headerName: 'Px', width: 100 }]);
    out[0]!.headerName = 'HACKED';
    expect(engine.getOverrides()[0]!.headerName).toBe('Px');
  });

  it('rejects an empty colId as bad-shape', () => {
    const engine = new CalcEngine();
    const r = engine.applyOverrides([{ colId: '', headerName: 'X' }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.code).toBe('bad-shape');
  });

  it('rejects an invalid format as format-compile and applies NOTHING (atomic)', () => {
    const engine = new CalcEngine();
    const r = engine.applyOverrides([
      { colId: 'ok', headerName: 'fine' },
      { colId: 'bad', format: '0;0;0;0;0' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: 'format-compile', colId: 'bad', loc: null });
    expect(engine.getOverrides()).toEqual([]);            // the valid one was NOT applied
  });

  it('upserts per colId — a later call replaces that colId wholesale, others untouched', () => {
    const engine = new CalcEngine();
    engine.applyOverrides([{ colId: 'a', headerName: 'A', width: 90 }, { colId: 'b', width: 50 }]);
    engine.applyOverrides([{ colId: 'a', headerName: 'A2' }]);
    const byId = new Map(engine.getOverrides().map((o) => [o.colId, o]));
    expect(byId.get('a')).toEqual({ colId: 'a', headerName: 'A2' });  // wholesale — width gone
    expect(byId.get('b')).toEqual({ colId: 'b', width: 50 });
  });
});

describe('CalcEngine — saveTemplate/listTemplates/deleteTemplate', () => {
  it('stamps createdAt/updatedAt from caller-supplied now (Date-free)', () => {
    const engine = new CalcEngine();
    engine.saveTemplate({ id: 'cur', name: 'Currency', overrides: { format: '0.00' }, now: 100 });
    expect(engine.listTemplates()).toEqual([{
      id: 'cur', name: 'Currency', overrides: { format: '0.00' }, createdAt: 100, updatedAt: 100,
    }]);
  });

  it('re-save of the same id preserves createdAt and bumps updatedAt', () => {
    const engine = new CalcEngine();
    engine.saveTemplate({ id: 'cur', name: 'Currency', overrides: { format: '0.00' }, now: 100 });
    engine.saveTemplate({ id: 'cur', name: 'Currency v2', overrides: { format: '0' }, now: 250 });
    const [t] = engine.listTemplates();
    expect(t!.createdAt).toBe(100);
    expect(t!.updatedAt).toBe(250);
    expect(t!.name).toBe('Currency v2');
  });

  it('throws on empty id or a format that does not compile', () => {
    const engine = new CalcEngine();
    expect(() => engine.saveTemplate({ id: '', name: 'x', overrides: {}, now: 1 })).toThrow();
    expect(() => engine.saveTemplate({
      id: 'bad', name: 'x', overrides: { format: '0;0;0;0;0' }, now: 1,
    })).toThrow(/format/);
  });

  it('deleteTemplate removes the template but never prunes assignment refs', () => {
    const engine = new CalcEngine();
    engine.saveTemplate({ id: 'cur', name: 'Currency', overrides: { format: '0.00' }, now: 1 });
    engine.applyTemplate('cur', ['px']);
    engine.deleteTemplate('cur');
    expect(engine.listTemplates()).toEqual([]);
    expect(engine.getOverrides()[0]!.templateIds).toEqual(['cur']);   // dangling ref kept
    expect(engine.resolvedPatchFor('px', 'number')).toBeNull();      // fold skips it silently
  });
});

describe('CalcEngine — applyTemplate', () => {
  it('creates a bare override where none exists', () => {
    const engine = new CalcEngine();
    engine.applyTemplate('cur', ['a', 'b']);
    expect(engine.getOverrides()).toEqual([
      { colId: 'a', templateIds: ['cur'] },
      { colId: 'b', templateIds: ['cur'] },
    ]);
  });

  it('appends to an existing chain and dedupes', () => {
    const engine = new CalcEngine();
    engine.applyOverrides([{ colId: 'a', headerName: 'A', templateIds: ['t1'] }]);
    engine.applyTemplate('cur', ['a']);
    engine.applyTemplate('cur', ['a']);                              // dedupe: no double entry
    expect(engine.getOverrides()[0]).toEqual({ colId: 'a', headerName: 'A', templateIds: ['t1', 'cur'] });
  });
});

describe('CalcEngine — resolvedPatchFor', () => {
  function seeded(): CalcEngine {
    const engine = new CalcEngine();
    engine.saveTemplate({
      id: 'num-default', name: 'Numeric default',
      overrides: { format: '0.00', cellStyle: { textAlign: 'right' } }, now: 1,
    });
    engine.saveTemplate({
      id: 'str-default', name: 'String default', overrides: { cellStyle: { textAlign: 'left' } }, now: 1,
    });
    engine.saveTemplate({
      id: 'hot', name: 'Highlight', overrides: { cellStyle: { color: 'orange' }, width: 110 }, now: 1,
    });
    engine.setTypeDefaults({ numeric: 'num-default', string: 'str-default', date: 'ghost-date', boolean: 'ghost-bool' });
    return engine;
  }

  it('templateIds undefined → typeDefault numeric bucket for kernel "number"', () => {
    const engine = seeded();
    expect(engine.resolvedPatchFor('price', 'number')).toEqual({
      valueFormatter: '0.00',
      cellStyle: { textAlign: 'right' },
    });
  });

  it('templateIds undefined → typeDefault string bucket for kernel "text"', () => {
    const engine = seeded();
    expect(engine.resolvedPatchFor('name', 'text')).toEqual({
      cellStyle: { textAlign: 'left' },
    });
  });

  it('date/boolean typeDefault buckets never leak into the two live buckets (honest limitation)', () => {
    const engine = new CalcEngine();
    engine.saveTemplate({ id: 'd', name: 'd', overrides: { width: 666 }, now: 1 });
    engine.setTypeDefaults({ date: 'd', boolean: 'd' });               // only unreachable buckets set
    expect(engine.resolvedPatchFor('anything', 'number')).toBeNull();
    expect(engine.resolvedPatchFor('anything', 'text')).toBeNull();
  });

  it('templateIds [] opts out of the typeDefault', () => {
    const engine = seeded();
    engine.applyOverrides([{ colId: 'price', headerName: 'Px', templateIds: [] }]);
    expect(engine.resolvedPatchFor('price', 'number')).toEqual({ headerName: 'Px' });
  });

  it('missing template ids in the chain are skipped silently', () => {
    const engine = seeded();
    engine.applyOverrides([{ colId: 'price', templateIds: ['no-such-tpl', 'hot'] }]);
    expect(engine.resolvedPatchFor('price', 'number')).toEqual({
      cellStyle: { color: 'orange' },
      width: 110,
    });
  });

  it('end-to-end fold: typeDefault < chain < assignment, styles merged per-key', () => {
    const engine = seeded();
    engine.applyOverrides([{
      colId: 'price', headerName: 'Px', width: 120, templateIds: undefined,
    }]);
    // templateIds undefined → numeric typeDefault still applies under the assignment
    expect(engine.resolvedPatchFor('price', 'number')).toEqual({
      headerName: 'Px',
      valueFormatter: '0.00',                 // from num-default (assignment silent)
      cellStyle: { textAlign: 'right' },      // per-key merge survives
      width: 120,                             // assignment wins
    });
  });

  it('pins calc columns non-editable even when an override says editable: true', () => {
    const engine = new CalcEngine({ schema: SCHEMA });
    engine.registerCalculatedColumn(lineTotal());
    engine.applyOverrides([{ colId: 'lineTotal', headerName: 'LT', editable: true }]);
    expect(engine.resolvedPatchFor('lineTotal', 'number')).toEqual({ headerName: 'LT' });
    // Same override on a data column keeps editable:
    engine.applyOverrides([{ colId: 'price', editable: true }]);
    expect(engine.resolvedPatchFor('price', 'number')).toEqual({ editable: true });
  });

  it('returns null when nothing applies', () => {
    const engine = new CalcEngine();
    expect(engine.resolvedPatchFor('price', 'number')).toBeNull();
  });
});
