/**
 * Sparse SSRM v2 datasource — the kernel owns the tree shape (group
 * skeleton + flatten index); Perspective answers the two expansion-free
 * queries plus the flat window. Sort / filter / agg still run in
 * Perspective, never in the worker.
 */
import type {
  IServerSideDatasourceV2,
  IServerSideGetGroupLeafIdsParams,
  IServerSideGetLeafRowsParams,
  IServerSideGetRowsParams,
  IServerSideGetSkeletonParams,
} from '@wellsfargo-starui/velocity-grid';
import type { PerspectiveBook } from './book';

let warnedV1CompatGetRows = false;

export function createPerspectiveSsrmDatasource(
  book: PerspectiveBook,
  viewId: string,
): IServerSideDatasourceV2 {
  return {
    /** Flat fallback — a v2 kernel only calls this when no row grouping is
     *  active (grouping goes through getGroupSkeleton / getLeafRows). */
    getRows(params: IServerSideGetRowsParams): void {
      book.noteGetRowsStart(viewId);
      void (async () => {
        let served = 0;
        let ok = false;
        try {
          if (params.request.rowGroupCols.length > 0) {
            // A GROUPED getRows means a v1-era kernel is driving this v2
            // datasource (stale dev-server bundle / version skew). Serving
            // the flat window here silently painted flat rows under active
            // group chips — instead, serve the v1 flattened-tree window so
            // the grid still groups correctly, and say so once.
            if (!warnedV1CompatGetRows) {
              warnedV1CompatGetRows = true;
              console.warn(
                '[PerspectiveSsrmDatasource] grouped getRows received — a v1 SSRM kernel is '
                + 'driving this v2 datasource (stale @wellsfargo-starui/velocity-grid bundle? rebuild + hard reload). '
                + 'Serving v1 flattened-window compatibility.',
              );
            }
            const result = await book.getSsrmRows(viewId, {
              startRow: params.request.startRow,
              endRow: params.request.endRow,
              sortModel: params.request.sortModel,
              filterModel: params.request.filterModel,
              rowGroupCols: params.request.rowGroupCols,
              expandedGroupKeys: params.request.expandedGroupKeys,
              columnKeys: params.request.columnKeys,
            });
            served = result.rows.length;
            params.success({
              rowData: result.rows,
              rowCount: result.rowCount,
              groupKeys: result.groupKeys,
            });
            ok = true;
            return;
          }
          const result = await book.getFlatRows(viewId, {
            startRow: params.request.startRow,
            endRow: params.request.endRow,
            sortModel: params.request.sortModel,
            filterModel: params.request.filterModel,
            columnKeys: params.request.columnKeys,
          });
          served = result.rows.length;
          params.success({
            rowData: result.rows,
            rowCount: result.rowCount,
            // Backs the status bar's Total Rows. Counted alongside the
            // window under the same table lock, so it costs no extra round trip.
            unfilteredRowCount: result.unfilteredRowCount,
            grandTotals: result.grandTotals,
          });
          ok = true;
        } catch (err) {
          console.error('[PerspectiveSsrmDatasource] getRows', err);
          params.fail();
        } finally {
          book.noteGetRowsEnd(viewId, served, ok);
        }
      })();
    },

    getGroupSkeleton(params: IServerSideGetSkeletonParams): void {
      book.noteGetRowsStart(viewId);
      void (async () => {
        let served = 0;
        let ok = false;
        try {
          const groups = await book.getGroupSkeleton(viewId, params.request);
          served = groups.length;
          // One count per generation. The grouped path declares Total Rows
          // here rather than on every getLeafRows block, which would take the
          // table lock once per scroll block.
          params.success({ groups, unfilteredRowCount: await book.sharedTableSize() });
          ok = true;
        } catch (err) {
          console.error('[PerspectiveSsrmDatasource] getGroupSkeleton', err);
          params.fail();
        } finally {
          book.noteGetRowsEnd(viewId, served, ok);
        }
      })();
    },

    getLeafRows(params: IServerSideGetLeafRowsParams): void {
      book.noteGetRowsStart(viewId);
      void (async () => {
        let served = 0;
        let ok = false;
        try {
          const rows = await book.getLeafRows(viewId, params.request);
          served = rows.length;
          params.success({ rowData: rows });
          ok = true;
        } catch (err) {
          console.error('[PerspectiveSsrmDatasource] getLeafRows', err);
          params.fail();
        } finally {
          book.noteGetRowsEnd(viewId, served, ok);
        }
      })();
    },

    getGroupLeafIds(params: IServerSideGetGroupLeafIdsParams): void {
      void (async () => {
        try {
          const ids = await book.getGroupLeafIds(viewId, params.request);
          params.success({ ids });
        } catch (err) {
          console.error('[PerspectiveSsrmDatasource] getGroupLeafIds', err);
          params.fail();
        }
      })();
    },

    destroy() {
      void book.unregisterView(viewId);
    },
  };
}
