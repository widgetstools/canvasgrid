import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { darkTheme } from './theme';

const cols: ColDef[] = [{ field: 'placeholder', headerName: 'Placeholder' }];

export function App() {
  return (
    <div className="page">
      <div className="grid-wrap" data-testid="grid-wrap">
        <AgGridReact theme={darkTheme} columnDefs={cols} rowData={[]} />
      </div>
    </div>
  );
}
