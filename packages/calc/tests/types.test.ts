import { describe, expect, it } from 'vitest';
import type {
  AggScope,
  AggSpec,
  Aggregate,
  CalcValidationError,
  CalculatedColumnDef,
  CellDataType,
  ColumnOverride,
  ColumnTemplate,
  CompiledCalc,
  TypeDefaults,
  Unsubscribe,
  WireCalcOptions,
} from '../src/index';

describe('types', () => {
  it('CalculatedColumnDef round-trips through structuredClone', () => {
    const col: CalculatedColumnDef = {
      colId: 'pnlPct',
      headerName: 'PnL %',
      expression: '[pnl] / [notional]',
      format: '0.00%',
      cellDataType: 'percent',
      position: 3,
      initialWidth: 120,
      initialHide: false,
      initialPinned: 'right',
    };
    expect(structuredClone(col)).toEqual(col);
  });

  it('ColumnOverride round-trips through structuredClone', () => {
    const override: ColumnOverride = {
      colId: 'price',
      headerName: 'Price',
      format: '#,##0.00',
      cellStyle: { fontWeight: 'bold' },
      cellRenderer: 'currencyRenderer',
      editable: true,
      hide: false,
      width: 100,
      templateIds: ['tmpl-numeric'],
    };
    expect(structuredClone(override)).toEqual(override);
  });

  it('ColumnTemplate round-trips through structuredClone', () => {
    const template: ColumnTemplate = {
      id: 'tmpl-numeric',
      name: 'Numeric',
      description: 'Default numeric formatting',
      overrides: { format: '#,##0.00', editable: false },
      createdAt: 1000,
      updatedAt: 2000,
    };
    expect(structuredClone(template)).toEqual(template);
  });

  it('AggSpec round-trips through structuredClone for every AggScope kind', () => {
    const scopes: AggScope[] = [
      { kind: 'all' },
      { kind: 'visible' },
      { kind: 'group' },
      { kind: 'parent' },
    ];
    for (const scope of scopes) {
      const spec: AggSpec = { slot: 0, fn: 'SUM', colId: 'notional', scope };
      expect(structuredClone(spec)).toEqual(spec);
    }
  });

  it('CalcValidationError round-trips through structuredClone', () => {
    const err: CalcValidationError = {
      colId: 'pnlPct',
      code: 'unknown-fn',
      message: "unknown function 'FOO'",
      loc: { start: 0, end: 3 },
    };
    expect(structuredClone(err)).toEqual(err);
  });

  it('WireCalcOptions round-trips through structuredClone', () => {
    const opts: WireCalcOptions = {
      calculatedColumns: [
        { colId: 'pnlPct', headerName: 'PnL %', expression: '[pnl] / [notional]' },
      ],
      overrides: [{ colId: 'price', width: 100 }],
      templates: [
        { id: 'tmpl-numeric', name: 'Numeric', overrides: {}, createdAt: 0, updatedAt: 0 },
      ],
      typeDefaults: { numeric: '#,##0.00' },
      schema: undefined,
    };
    expect(structuredClone(opts)).toEqual(opts);
  });

  it('compile-time: every exported type is assignable', () => {
    const cellDataType: CellDataType = 'currency';
    const scope: AggScope = { kind: 'group' };
    const aggSpec: AggSpec = { slot: 0, fn: 'SUM', colId: 'x', scope };
    const compiled: CompiledCalc = {
      ast: { type: 'NumberLiteral', value: 1 } as unknown as CompiledCalc['ast'],
      prePass: [aggSpec],
      watchedColIds: new Set(['x']),
      usesPrev: false,
      cellDataType,
    };
    const validationError: CalcValidationError = {
      colId: null,
      code: 'bad-shape',
      message: "unknown field 'x'",
      loc: null,
    };
    const aggregate: Aggregate<number> = {
      init: () => 0,
      addRow: (state, value) => state + Number(value),
      removeRow: (state, value) => state - Number(value),
      updateRow: (state, oldValue, newValue) => state - Number(oldValue) + Number(newValue),
      finalize: (state) => state,
    };
    const override: ColumnOverride = { colId: 'x' };
    const template: ColumnTemplate = {
      id: 't1', name: 'T1', overrides: {}, createdAt: 0, updatedAt: 0,
    };
    const typeDefaults: TypeDefaults = { numeric: '0.00' };
    const wireOpts: WireCalcOptions = {};
    const unsubscribe: Unsubscribe = () => {};

    expect(cellDataType).toBe('currency');
    expect(compiled.prePass).toHaveLength(1);
    expect(validationError.code).toBe('bad-shape');
    expect(aggregate.finalize(aggregate.addRow(aggregate.init(), 5))).toBe(5);
    expect(override.colId).toBe('x');
    expect(template.id).toBe('t1');
    expect(typeDefaults.numeric).toBe('0.00');
    expect(wireOpts).toEqual({});
    expect(typeof unsubscribe).toBe('function');
  });
});
