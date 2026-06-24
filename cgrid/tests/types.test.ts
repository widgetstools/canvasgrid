import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  CGridOptions, CColDef, CColGroupDef, CGridApi, CGridEvent, CValueGetterParams,
  CValueFormatterParams, SortModel, FilterModel, GroupModel, TransactionResult,
} from '../src/types';

describe('public types', () => {
  it('CGridOptions requires getRowId', () => {
    type Required = CGridOptions<{ id: string }>['getRowId'];
    expectTypeOf<Required>().toBeFunction();
  });

  it('CColDef accepts field as keyof TRow', () => {
    interface Row { id: string; value: number }
    type Field = CColDef<Row>['field'];
    expectTypeOf<Field>().toEqualTypeOf<keyof Row & string | undefined>();
  });

  it('CGridOptions.columnDefs accepts CColGroupDef entries', () => {
    interface Row { a: number; b: number }
    const opts: CGridOptions<Row> = {
      columnDefs: [
        { field: 'a' },
        { children: [{ field: 'b' }] },
      ],
      getRowId: (r) => String(r.a),
    };
    expect(opts.columnDefs.length).toBe(2);
  });

  it('CColGroupDef.children is a required heterogeneous array', () => {
    type Children = CColGroupDef['children'];
    expectTypeOf<Children>().toEqualTypeOf<(CColDef | CColGroupDef)[]>();
  });

  it('CColDef.columnGroupShow is "open" | "closed" | null | undefined', () => {
    type V = CColDef['columnGroupShow'];
    expectTypeOf<V>().toEqualTypeOf<'open' | 'closed' | null | undefined>();
  });

  it('CGridEvent is a discriminated union on .type', () => {
    type T = CGridEvent['type'];
    expectTypeOf<T>().toEqualTypeOf<
      'gridReady' | 'cellClicked' | 'cellDoubleClicked' | 'cellFocused' |
      'cellValueChanged' | 'selectionChanged' | 'viewportChanged' |
      'modelUpdated' | 'sortChanged' | 'filterChanged' | 'columnResized' |
      'asyncTransactionsFlushed'
    >();
  });
});
