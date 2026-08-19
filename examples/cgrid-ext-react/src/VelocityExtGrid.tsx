import { useEffect, useRef } from 'react';
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
} from '@wellsfargo-starui/velocity-grid-ext';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-edit';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import '@wellsfargo-starui/velocity-grid/style.css';
import { COLUMN_DEFS, seedRows, type PositionRow } from './seed';

export function VelocityExtGrid() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

    const ext = new VelocityGridExt<PositionRow>(host, {
      gridId: 'ext-react',
      getRowId: (row) => row.id,
      columnDefs: COLUMN_DEFS,
      defaultColDef: {
        resizable: true,
        sortable: true,
        editable: true,
        minWidth: 80,
      },
      theme: 'vg-theme-quartz',
      sideBar: { toolPanels: ['columns', 'filters'] },
      rowGroupPanelShow: 'always',
      rowData: seedRows(),
      cellSelection: { suppressHeader: true },
      ext: {
        extensions: [
          { remove: 'settings-launcher' },
          { remove: 'save' },
          ...titleBarExtensions({ name: 'React · Ext' }),
          ...ribbonExtensions({ edit: () => editHandle }),
        ],
      },
    });

    wireFormat(ext.grid);
    editHandle = wireEditIntoKernel(ext.grid);
    wireCalc(ext.grid);
    wireRules(ext.grid);
    ext.grid.updateGridOptions({ columnDefs: COLUMN_DEFS });

    return () => {
      ext.destroy();
    };
  }, []);

  return <div ref={hostRef} className="grid-host" />;
}
