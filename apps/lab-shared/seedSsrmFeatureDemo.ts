import { MOCK_POSITION_COLUMNS, type MockPositionRow } from '@wellsfargo-starui/velocity-grid-perspective';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';

export interface SsrmDemoGrid {
  updateGridOptions(opts: Record<string, unknown>): void;
  setRowGroupColumns?(cols: string[]): void;
  setFilterModel?(f: Record<string, unknown>): void;
  setSideBarVisible?(show: boolean): void;
  openToolPanel?(id: string): void;
  addCellRange?(range: { rowStart: number; rowEnd: number; colIds: string[] }): void;
  setState?(state: unknown): void;
  refreshServerSide?(p?: { purge?: boolean }): void;
}

function cols(): CColDef<MockPositionRow>[] {
  return MOCK_POSITION_COLUMNS.map((c) => ({ ...c }));
}

function withPnlHeat(): CColDef<MockPositionRow>[] {
  return cols().map((c) => {
    if (c.field !== 'pnl' && c.field !== 'dailyPnl') return { ...c };
    return {
      ...c,
      cellStyle: ({ value }: { value: unknown }) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return undefined;
        if (n > 0) return { color: '#7dffa8', backgroundColor: 'rgba(40,120,70,0.35)', fontWeight: 600 };
        if (n < 0) return { color: '#ffb4b4', backgroundColor: 'rgba(140,40,40,0.4)', fontWeight: 600 };
        return undefined;
      },
    };
  });
}

/** Per-tab SSRM demos on MockSSRMDataProvider schema (desk/region/…). */
export function seedSsrmFeatureDemo(featureId: string, grid: SsrmDemoGrid): void {
  const later = (fn: () => void) => requestAnimationFrame(() => setTimeout(fn, 80));

  switch (featureId) {
    case 'overview':
      grid.updateGridOptions({ columnDefs: withPnlHeat(), groupDefaultExpanded: 0, enableCellChangeFlash: true });
      later(() => {
        grid.setRowGroupColumns?.(['desk']);
        grid.setSideBarVisible?.(true);
        grid.openToolPanel?.('columns');
      });
      break;
    case 'formatting':
    case 'toolbar':
    case 'visual-excel':
      grid.updateGridOptions({
        columnDefs: cols().map((c) => {
          if (c.field === 'price') return { ...c, cellStyle: { backgroundColor: 'rgba(50,120,100,0.35)', fontWeight: 600 } };
          if (c.field === 'notional') return { ...c, cellStyle: { backgroundColor: 'rgba(60,100,160,0.3)' } };
          return { ...c };
        }),
      });
      later(() => grid.addCellRange?.({ rowStart: 0, rowEnd: 3, colIds: ['price', 'notional', 'marketValue'] }));
      break;
    case 'renderers':
    case 'live':
      grid.updateGridOptions({ columnDefs: withPnlHeat(), enableCellChangeFlash: true, rowGroupPanelShow: 'never' });
      later(() => grid.setRowGroupColumns?.([]));
      break;
    case 'groups':
      grid.updateGridOptions({
        columnDefs: cols().map((c) => {
          if (c.field === 'desk') return { ...c, rowGroup: true, rowGroupIndex: 0, hide: true } as CColDef<MockPositionRow>;
          if (c.field === 'region') return { ...c, rowGroup: true, rowGroupIndex: 1, hide: true } as CColDef<MockPositionRow>;
          return { ...c };
        }),
        groupDefaultExpanded: 0,
        rowGroupPanelShow: 'always',
      });
      later(() => grid.setRowGroupColumns?.(['desk', 'region']));
      break;
    case 'filters':
      grid.updateGridOptions({ columnDefs: cols() });
      later(() => {
        grid.setSideBarVisible?.(true);
        grid.openToolPanel?.('filters');
        grid.setFilterModel?.({
          desk: { filterType: 'set', values: ['Rates', 'Credit'] },
        });
        try {
          grid.setState?.({
            modules: {
              'saved-filters': {
                version: 1,
                data: [
                  {
                    id: 'sf-rates',
                    label: 'Rates+Credit',
                    active: true,
                    filterModel: { desk: { filterType: 'set', values: ['Rates', 'Credit'] } },
                  },
                  {
                    id: 'sf-amer',
                    label: 'AMER',
                    active: false,
                    filterModel: { region: { filterType: 'set', values: ['AMER'] } },
                  },
                ],
              },
            },
          });
        } catch { /* ignore */ }
      });
      break;
    case 'editing':
    case 'bulk-update':
    case 'plus-minus':
    case 'shortcuts':
      grid.updateGridOptions({ columnDefs: cols(), rowGroupPanelShow: 'never', enableCellChangeFlash: false });
      later(() => {
        grid.setRowGroupColumns?.([]);
        const col =
          featureId === 'bulk-update' ? 'trader'
            : featureId === 'plus-minus' ? 'price'
              : featureId === 'shortcuts' ? 'notional'
                : 'ticker';
        grid.addCellRange?.({
          rowStart: 0,
          rowEnd: featureId === 'bulk-update' || featureId === 'shortcuts' ? 5 : 0,
          colIds: [col],
        });
      });
      break;
    case 'conditional':
    case 'alerts':
    case 'calc':
      grid.updateGridOptions({ columnDefs: withPnlHeat(), enableCellChangeFlash: true });
      later(() => grid.setRowGroupColumns?.(['desk']));
      break;
    case 'profiles':
      grid.updateGridOptions({
        columnDefs: cols().map((c, i) => {
          if (c.field === 'dailyPnl' || c.field === 'currency') return { ...c, hide: true };
          if (c.field === 'marketValue') return { ...c, pinned: 'right' as const };
          if (i > 8) return { ...c, hide: true };
          return { ...c };
        }),
      });
      break;
    default:
      grid.updateGridOptions({ columnDefs: withPnlHeat() });
      break;
  }
}
