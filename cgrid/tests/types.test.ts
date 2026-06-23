import { describe, it, expectTypeOf } from 'vitest';
import type {
  CGridOptions, CColDef, CGridApi, CGridEvent, CValueGetterParams,
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
