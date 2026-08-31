/**
 * Grid column defs derived from the provider's `columnDefinitions`.
 *
 * Both demos build their columns from the CATALOG rather than hard-coding
 * them, so editing the Columns tab in the DataProvider editor and hitting
 * Apply is visible in the grid. Numeric columns get an aggFunc and the
 * pivot/group opt-ins, so grouping and pivot work without extra wiring.
 */
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import type { ColumnDefinition } from '@wellsfargo-starui/velocity-grid-data';

export function gridColumnsFrom(defs: readonly ColumnDefinition[]): CColDef[] {
  return defs.map((d) => {
    const numeric = d.cellDataType === 'number';
    return {
      colId: d.field,
      field: d.field,
      headerName: d.headerName ?? d.field,
      cellDataType: numeric ? 'number' : 'text',
      width: typeof d.width === 'number' ? d.width : undefined,
      filter: numeric ? 'number' : 'text',
      sortable: d.sortable !== false,
      // Dimensions can be grouped AND pivoted; measures aggregate. Both
      // opt-ins are required or the Columns panel's Row Groups / Column
      // Labels zones reject the drag.
      ...(numeric
        ? { aggFunc: 'sum', enableValue: true }
        : { enableRowGroup: true, enablePivot: true }),
    } as CColDef;
  });
}
