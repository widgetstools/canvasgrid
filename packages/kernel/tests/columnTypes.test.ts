import { describe, it, expect } from 'vitest';
import { resolveColDef } from '../src/core/propertyChain';

/**
 * Cycle 6 / Task 6 — `columnTypes` templates + `CColDef.type: string | string[]`.
 *
 * `CGridOptions.columnTypes` declares named `Partial<CColDef>` bundles. A
 * column references one (or several) by name through its `type` field.
 * The merge order is `{ ...typeBundle1, ...typeBundle2, ...defaultColDef,
 * ...colDef }` left-to-right — the col's own properties always win.
 *
 * The old `type: 'text' | 'number'` literal-union usage still works through a
 * deprecation alias: when `type` is `'text'`/`'number'` AND `columnTypes`
 * carries no entry of that name, the value collapses into `cellDataType`.
 * Any other unknown type name throws a descriptive error.
 */
describe('columnTypes — resolveColDef merge', () => {
  it('single string type merges the bundle before defaultColDef', () => {
    const r = resolveColDef(
      { field: 'amount', type: 'money' },
      { resizable: false },
      { money: { cellDataType: 'number', minWidth: 90 } },
    );
    expect(r.cellDataType).toBe('number'); // from type bundle
    expect(r.minWidth).toBe(90);            // from type bundle
    expect(r.resizable).toBe(false);        // from defaultColDef (no override)
  });

  it('array type merges left-to-right; later types beat earlier ones', () => {
    const r = resolveColDef(
      { field: 'amount', type: ['a', 'b'] },
      {},
      {
        a: { cellDataType: 'text',   minWidth: 30,  maxWidth: 200 },
        b: { cellDataType: 'number',                 maxWidth: 500 },
      },
    );
    expect(r.cellDataType).toBe('number'); // b overrode a
    expect(r.minWidth).toBe(30);           // only a set it
    expect(r.maxWidth).toBe(500);          // b overrode a
  });

  it('column-level properties win over every type bundle', () => {
    const r = resolveColDef(
      { field: 'a', type: 'money', minWidth: 200, cellDataType: 'text' },
      {},
      { money: { minWidth: 90, cellDataType: 'number' } },
    );
    expect(r.minWidth).toBe(200);
    expect(r.cellDataType).toBe('text');
  });

  it('deprecation alias: type "text" with no bundle becomes cellDataType', () => {
    const r = resolveColDef({ field: 'a', type: 'text' }, {}, {});
    expect(r.cellDataType).toBe('text');
    expect(r.cellRenderer).toBe('text');
  });

  it('deprecation alias: type "number" with no bundle becomes cellDataType + cellRenderer', () => {
    const r = resolveColDef({ field: 'a', type: 'number' });
    expect(r.cellDataType).toBe('number');
    expect(r.cellRenderer).toBe('number');
  });

  it('unknown type name throws a descriptive error', () => {
    expect(() =>
      resolveColDef({ field: 'a', type: 'unknown-type-x' }, {}, { money: {} }),
    ).toThrow(/unknown column type/);
  });

  it('explicit columnTypes entry for "text"/"number" beats the deprecation alias', () => {
    const r = resolveColDef(
      { field: 'a', type: 'number' },
      {},
      { number: { minWidth: 999, cellDataType: 'text' } },
    );
    expect(r.cellDataType).toBe('text');  // bundle won (no alias triggered)
    expect(r.minWidth).toBe(999);
  });

  it('defaults cellDataType to "text" when no type / cellDataType is given', () => {
    const r = resolveColDef({ field: 'a' });
    expect(r.cellDataType).toBe('text');
  });
});
