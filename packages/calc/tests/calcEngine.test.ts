import { describe, expect, it } from 'vitest';
import { CalcEngine } from '../src/calcEngine';
import { buildWorkerCalcProgram } from '../src/workerProgram';
import type { CalculatedColumnDef, CellDataType } from '../src/types';
import type { Schema } from '@cgrid/expression';

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
