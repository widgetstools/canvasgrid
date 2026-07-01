import { describe, it, expect } from 'vitest';
import { resolveColDef } from '../src/core/propertyChain';

describe('resolveColDef', () => {
  it('uses field as colId default', () => {
    const r = resolveColDef({ field: 'price' });
    expect(r.colId).toBe('price');
  });

  it('explicit colId wins over field', () => {
    const r = resolveColDef({ colId: 'mid', field: 'price' });
    expect(r.colId).toBe('mid');
  });

  it('uses headerName default = field name', () => {
    const r = resolveColDef({ field: 'instrumentName' });
    expect(r.headerName).toBe('instrumentName');
  });

  it('defaults cellDataType to text', () => {
    expect(resolveColDef({ field: 'a' }).cellDataType).toBe('text');
  });

  it('defaults cellRenderer to type', () => {
    expect(resolveColDef({ field: 'a', type: 'number' }).cellRenderer).toBe('number');
    expect(resolveColDef({ field: 'a' }).cellRenderer).toBe('text');
  });

  it('explicit cellRenderer overrides type-default', () => {
    expect(resolveColDef({ field: 'a', cellRenderer: 'checkbox' }).cellRenderer).toBe('checkbox');
  });

  it("infers cellRenderer 'checkbox' when cellEditor is 'checkbox' and no explicit renderer set (boolean-column smart default)", () => {
    expect(resolveColDef({ field: 'confirmed', cellEditor: 'checkbox' }).cellRenderer)
      .toBe('checkbox');
  });

  it('explicit cellRenderer overrides the checkbox-editor smart default (opt-out path for text-formatted booleans)', () => {
    expect(resolveColDef({ field: 'confirmed', cellEditor: 'checkbox', cellRenderer: 'text' }).cellRenderer)
      .toBe('text');
  });

  it('inherits from defaultColDef', () => {
    const r = resolveColDef({ field: 'a' }, { sortable: false, minWidth: 100 });
    expect(r.sortable).toBe(false);
    expect(r.minWidth).toBe(100);
  });

  it('column-level overrides default', () => {
    const r = resolveColDef({ field: 'a', sortable: true }, { sortable: false });
    expect(r.sortable).toBe(true);
  });

  it('sortable/resizable default true', () => {
    const r = resolveColDef({ field: 'a' });
    expect(r.sortable).toBe(true);
    expect(r.resizable).toBe(true);
  });

  it('minWidth default 30, maxWidth default Infinity', () => {
    const r = resolveColDef({ field: 'a' });
    expect(r.minWidth).toBe(30);
    expect(r.maxWidth).toBe(Number.POSITIVE_INFINITY);
  });

  it('editable default false', () => {
    expect(resolveColDef({ field: 'a' }).editable).toBe(false);
  });

  it('throws when neither colId nor field given', () => {
    expect(() => resolveColDef({})).toThrow(/colId.*field/);
  });
});
