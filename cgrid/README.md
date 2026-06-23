# cgrid

A vanilla-TypeScript canvas-based grid library. No framework dependencies.

## Install

```bash
npm install cgrid
```

## Quickstart

```typescript
import { CGrid } from 'cgrid';

const grid = new CGrid<{ id: string; name: string; value: number }>(
  document.getElementById('grid')!,
  {
    columnDefs: [
      { field: 'id',    headerName: 'ID',    pinned: 'left', width: 100 },
      { field: 'name',  headerName: 'Name',  flex: 1 },
      { field: 'value', headerName: 'Value', type: 'number', width: 120, aggFunc: 'sum' },
    ],
    getRowId: (row) => row.id,
    rowSelection: 'multiple',
    theme: 'cg-theme-quartz',
  },
);

grid.on('gridReady', () => {
  grid.setRowData([{ id: 'a', name: 'Apple', value: 12.5 }]);
});

grid.on('cellClicked', (e) => console.log(e));
```

## Status

Foundation cycle complete. See:
- `docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md`
- `docs/superpowers/plans/2026-06-23-canvasgrid-foundation.md`
- `docs/superpowers/reports/2026-06-23-canvasgrid-foundation-dod.md`

Filtering UI, grouping, master/detail, charts, SSRM, and other feature parity
land in subsequent cycles (catalog areas 08, 09, 11, 13, 14, 15, 17, 18, 19,
24, 25). See spec §15.
