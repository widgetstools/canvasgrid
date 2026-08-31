import { describe, it, expect } from 'vitest';
import { toGridColumnDefs } from '../src/schema/gridColumnDefs';
import type { ColumnDefinition } from '../src/types/schema';

/**
 * Catalog column definitions → grid column defs.
 *
 * The bug this pins: neither of the two mappers that used to exist emitted
 * `enablePivot`, which is what the pivot panel checks before accepting a drop
 * (`isColumnPivotEnabled`, default `false`). A provider-driven grid therefore
 * refused every drag into Column Labels — invisibly, because the panel still
 * rendered and still said "Drag here to set column labels".
 *
 * It only showed up under VelocityGridExt because that is where these defs are
 * the ONLY defs. An app that hand-writes `columnDefs` sets the flags itself,
 * so the same feature worked or not depending on how the grid was mounted.
 */

const COLS: ColumnDefinition[] = [
  { field: 'positionId', cellDataType: 'text' },
  { field: 'desk', cellDataType: 'text' },
  { field: 'region', cellDataType: 'text' },
  { field: 'pnl', cellDataType: 'number' },
];

const byField = (defs: ReturnType<typeof toGridColumnDefs>) =>
  Object.fromEntries(defs.map((d) => [d.field, d]));

describe('capability flags', () => {
  it('makes every non-key dimension pivotable', () => {
    const d = byField(toGridColumnDefs(COLS, { keyColumn: 'positionId' }));
    expect(d.desk!.enablePivot).toBe(true);
    expect(d.region!.enablePivot).toBe(true);
  });

  it('makes dimensions groupable and measures aggregatable', () => {
    const d = byField(toGridColumnDefs(COLS, { keyColumn: 'positionId' }));
    expect(d.desk!.enableRowGroup).toBe(true);
    expect(d.pnl!.enableValue).toBe(true);
    expect(d.pnl!.aggFunc).toBe('sum');
    // A measure is not a dimension.
    expect(d.pnl!.enableRowGroup).toBeUndefined();
    expect(d.pnl!.enablePivot).toBeUndefined();
  });

  it('leaves the key column out of every role', () => {
    const d = byField(toGridColumnDefs(COLS, { keyColumn: 'positionId' }));
    // Pivoting by a unique id would mint one pivot column per row.
    expect(d.positionId!.enablePivot).toBeUndefined();
    expect(d.positionId!.enableRowGroup).toBeUndefined();
    expect(d.positionId!.enableValue).toBeUndefined();
  });

  it('honours the CONFIGURED key column, not a hard-coded positionId', () => {
    // The old SSRM mapper tested `d.field !== 'positionId'` literally, so a
    // provider keyed on anything else grouped by its own id.
    const d = byField(toGridColumnDefs(COLS, { keyColumn: 'desk' }));
    expect(d.desk!.enablePivot).toBeUndefined();
    expect(d.positionId!.enablePivot).toBe(true);
  });

  it('handles a composite key column', () => {
    const d = byField(toGridColumnDefs(COLS, { keyColumn: ['desk', 'region'] }));
    expect(d.desk!.enableRowGroup).toBeUndefined();
    expect(d.region!.enableRowGroup).toBeUndefined();
    expect(d.positionId!.enableRowGroup).toBe(true);
  });
});

describe('authored flags beat the heuristic', () => {
  it('opts a measure into pivoting', () => {
    const d = byField(toGridColumnDefs(
      [{ field: 'pnl', cellDataType: 'number', enablePivot: true }],
      { keyColumn: 'positionId' },
    ));
    expect(d.pnl!.enablePivot).toBe(true);
  });

  it('opts a dimension OUT of pivoting', () => {
    // The heuristic would say true; false must survive, which is why the
    // check is `!= null` rather than a truthiness test.
    const d = byField(toGridColumnDefs(
      [{ field: 'desk', cellDataType: 'text', enablePivot: false }],
      { keyColumn: 'positionId' },
    ));
    expect(d.desk!.enablePivot).toBe(false);
  });

  it('overrides the default aggregation', () => {
    const d = byField(toGridColumnDefs(
      [{ field: 'pnl', cellDataType: 'number', aggFunc: 'avg' }],
      { keyColumn: 'positionId' },
    ));
    expect(d.pnl!.aggFunc).toBe('avg');
  });

  it('can pivot the key column when explicitly told to', () => {
    const d = byField(toGridColumnDefs(
      [{ field: 'positionId', cellDataType: 'text', enablePivot: true }],
      { keyColumn: 'positionId' },
    ));
    expect(d.positionId!.enablePivot).toBe(true);
  });
});

describe('the rest of the mapping', () => {
  it('carries identity, geometry and filter shape', () => {
    const d = byField(toGridColumnDefs([
      { field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 150, filter: true, sortable: true },
      { field: 'pnl', cellDataType: 'number', filter: true },
    ], { keyColumn: 'positionId' }));

    expect(d.desk).toMatchObject({
      field: 'desk', colId: 'desk', headerName: 'Desk',
      width: 150, sortable: true, filter: 'set', floatingFilter: true,
    });
    // Numerics keep comparison/range filters, not a unique-value checklist.
    expect(d.pnl!.filter).toBe('number');
  });

  it('falls back to the field as the header', () => {
    expect(toGridColumnDefs([{ field: 'desk' }])[0]!.headerName).toBe('desk');
  });

  it('returns nothing for an empty catalog rather than inventing columns', () => {
    expect(toGridColumnDefs([])).toEqual([]);
    expect(toGridColumnDefs(undefined)).toEqual([]);
    expect(toGridColumnDefs(null)).toEqual([]);
  });

  it('treats a missing key column as "no key", not as positionId', () => {
    const d = byField(toGridColumnDefs(COLS));
    expect(d.positionId!.enablePivot).toBe(true);
  });
});
