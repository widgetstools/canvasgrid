import { CGrid, type AnyServerSideDatasource } from '@cgrid/kernel';

import { COLUMNS } from '../columns';

import type { PositionRow } from '../perspective/bootstrap';



export interface BlotterMount {

  root: HTMLElement;

  grid: CGrid<PositionRow>;

  destroy(): void;

}



export function mountBlotter(

  opts: {

    id: string;

    title: string;

    theme: string;

    datasource: AnyServerSideDatasource<PositionRow>;

    qualityMode: 'auto' | 'quality' | 'performance';

    engine: 'perspective' | 'legacy';

    enableCellChangeFlash?: boolean;

  },

): BlotterMount {

  const root = document.createElement('section');

  root.className = 'blotter';

  root.dataset.blotterId = opts.id;



  const head = document.createElement('header');

  head.className = 'blotter-head';

  const mode =

    opts.engine === 'perspective' ? 'SSRM · Perspective' : 'SSRM · legacy';

  head.innerHTML =

    `<span class="blotter-title">${opts.title}</span>` +

    `<span class="blotter-mode">${mode}</span>`;

  root.appendChild(head);



  const body = document.createElement('div');

  body.className = 'blotter-body';

  root.appendChild(body);



  const grid = new CGrid<PositionRow>(body, {

    getRowId: (r: PositionRow) => r.positionId,

    columnDefs: COLUMNS,

    theme: opts.theme,

    rowModelType: 'serverSide',

    serverSideDatasource: opts.datasource,

    cacheBlockSize: 100,

    maxConcurrentDatasourceRequests: 2,

    serverSideEnableClientSidePipeline: false,

    qualityMode: opts.qualityMode,

    deferAsyncTransactionsWhileScrolling: true,

    asyncTransactionConflate: true,

    asyncTransactionWaitMillis: 50,

    asyncTransactionThrottleMillis: 200,

    enableCellChangeFlash: opts.enableCellChangeFlash !== false,

    suppressAggFuncInHeader: true,

    rowGroupPanelShow: 'always',

    groupDefaultExpanded: 0,

    // Kernel-native pinned grand total (replaces the hand-rolled
    // pinnedBottomRowData + fetchGrandTotal plumbing in main.ts).
    grandTotalRow: 'pinnedBottom',

    autoGroupColumnDef: {
      cellRendererParams: {
        // Label the pinned grand-total row (kernel default is 'Total').
        totalValueGetter: (p: { isGrandTotal: boolean; value: string }) =>
          p.isGrandTotal ? 'Grand Total' : `Total ${p.value}`,
      },
    },

    groupDisplayType: 'singleColumn',

    rowBuffer: 5,

    statusBar: {

      statusPanels: [

        { statusPanel: 'agTotalAndFilteredRowCountComponent' },

        { statusPanel: 'agSelectedRowCountComponent' },

      ],

    },

  } as never);



  return {

    root,

    grid,

    destroy() {

      try { grid.destroy(); } catch { /* swallow */ }

      root.remove();

    },

  };

}


