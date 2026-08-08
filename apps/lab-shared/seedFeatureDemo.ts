import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import type { LabRow } from './columns';
import {
  baseColumns,
  EDIT_COLUMNS,
  LIVE_COLUMNS,
  PRICING_COLUMNS,
} from './columns';

/** Minimal grid surface the seeder needs (VelocityGrid / VelocityGridExt.grid). */
export interface LabDemoGrid {
  updateGridOptions(opts: Record<string, unknown>): void;
  setRowGroupColumns?(cols: string[]): void;
  setFilterModel?(f: Record<string, unknown>): void;
  setSideBarVisible?(show: boolean): void;
  openToolPanel?(id: string): void;
  addCellRange?(range: { rowStart: number; rowEnd: number; colIds: string[] }): void;
  setState?(state: unknown): void;
  applyTransactionAsync?(tx: { update?: LabRow[] }): void;
  getDisplayedRowCount?(): number;
}

export interface SeedHandles {
  /** Return value of wireCalc — optional calculated-column registration. */
  calc?: {
    registerCalculatedColumn?(def: {
      colId: string;
      headerName: string;
      expression: string;
      cellDataType?: string;
      initialWidth?: number;
    }): { ok: boolean; errors: unknown[] };
  };
  /** Prefer re-wiring rules with seeds; this is a post-hoc setRules if available. */
  setStyleRules?: (rules: unknown[]) => void;
  setAlertRules?: (rules: unknown[]) => void;
}

function cloneCols(cols: CColDef<LabRow>[]): CColDef<LabRow>[] {
  return cols.map((c) => ({ ...c }));
}

function withPnlHeat(cols: CColDef<LabRow>[]): CColDef<LabRow>[] {
  return cols.map((c) => {
    if (c.field !== 'dailyPnL' && c.field !== 'unrealizedPnL' && c.field !== 'priceChangePct') {
      return { ...c };
    }
    return {
      ...c,
      cellStyle: ({ value }: { value: unknown }) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return undefined;
        if (n > 0) return { color: '#7dffa8', backgroundColor: 'rgba(40,120,70,0.35)', fontWeight: 600 };
        if (n < 0) return { color: '#ffb4b4', backgroundColor: 'rgba(140,40,40,0.4)', fontWeight: 600 };
        return { color: '#c8d0dc' };
      },
    };
  });
}

function withPricePaint(cols: CColDef<LabRow>[]): CColDef<LabRow>[] {
  return cols.map((c) => {
    if (c.field === 'bidPrice') {
      return { ...c, cellStyle: { backgroundColor: 'rgba(60,100,160,0.35)', fontWeight: 600 } };
    }
    if (c.field === 'askPrice') {
      return { ...c, cellStyle: { backgroundColor: 'rgba(140,80,40,0.35)', fontWeight: 600 } };
    }
    if (c.field === 'midPrice') {
      return { ...c, cellStyle: { backgroundColor: 'rgba(50,120,100,0.3)' } };
    }
    return { ...c };
  });
}

function groupedAssetSector(): CColDef<LabRow>[] {
  return cloneCols(baseColumns as CColDef<LabRow>[]).map((c) => {
    if (c.field === 'assetClass') {
      return { ...c, rowGroup: true, rowGroupIndex: 0, hide: true } as CColDef<LabRow>;
    }
    if (c.field === 'issuerSector') {
      return { ...c, rowGroup: true, rowGroupIndex: 1, hide: true } as CColDef<LabRow>;
    }
    return { ...c };
  });
}

/**
 * Apply a tab-specific demonstration so each lab feature looks and behaves
 * differently (columns, grouping, filters, styles, calc, selection).
 */
export function seedFeatureDemo(
  featureId: string,
  grid: LabDemoGrid,
  handles: SeedHandles = {},
): void {
  const afterLayout = (fn: () => void) => {
    requestAnimationFrame(() => setTimeout(fn, 50));
  };

  switch (featureId) {
    case 'overview': {
      grid.updateGridOptions({
        columnDefs: withPnlHeat(cloneCols(baseColumns as CColDef<LabRow>[])),
        groupDefaultExpanded: 1,
        enableCellChangeFlash: true,
      });
      afterLayout(() => {
        grid.setRowGroupColumns?.(['assetClass']);
        grid.setSideBarVisible?.(true);
        grid.openToolPanel?.('columns');
        grid.addCellRange?.({ rowStart: 0, rowEnd: 2, colIds: ['dailyPnL', 'ytdPnL'] });
      });
      break;
    }
    case 'formatting': {
      grid.updateGridOptions({
        columnDefs: withPricePaint(cloneCols(PRICING_COLUMNS)),
        enableCellChangeFlash: false,
      });
      afterLayout(() => {
        grid.addCellRange?.({ rowStart: 1, rowEnd: 4, colIds: ['bidPrice', 'midPrice', 'askPrice'] });
      });
      break;
    }
    case 'visual-excel': {
      grid.updateGridOptions({
        columnDefs: withPricePaint(withPnlHeat(cloneCols(PRICING_COLUMNS))),
        enableCellChangeFlash: false,
      });
      afterLayout(() => {
        grid.addCellRange?.({ rowStart: 0, rowEnd: 8, colIds: ['marketValue', 'unrealizedPnL', 'dailyPnL'] });
      });
      break;
    }
    case 'renderers': {
      grid.updateGridOptions({
        columnDefs: withPnlHeat(cloneCols(LIVE_COLUMNS)),
        enableCellChangeFlash: true,
        rowGroupPanelShow: 'never',
      });
      afterLayout(() => {
        grid.setRowGroupColumns?.([]);
      });
      break;
    }
    case 'toolbar': {
      grid.updateGridOptions({
        columnDefs: withPricePaint(cloneCols(PRICING_COLUMNS)),
      });
      afterLayout(() => {
        grid.addCellRange?.({ rowStart: 0, rowEnd: 5, colIds: ['yieldToMaturity', 'oas', 'dv01'] });
      });
      break;
    }
    case 'groups': {
      grid.updateGridOptions({
        columnDefs: groupedAssetSector(),
        groupDefaultExpanded: 0,
        rowGroupPanelShow: 'always',
        suppressAggFuncInHeader: true,
      });
      afterLayout(() => {
        grid.setRowGroupColumns?.(['assetClass', 'issuerSector']);
      });
      break;
    }
    case 'calc': {
      grid.updateGridOptions({
        columnDefs: cloneCols(PRICING_COLUMNS),
        enableCellChangeFlash: true,
      });
      try {
        handles.calc?.registerCalculatedColumn?.({
          colId: 'bidAskSpread',
          headerName: 'Bid/Ask Spr',
          expression: '[askPrice] - [bidPrice]',
          cellDataType: 'number',
          initialWidth: 110,
        });
        handles.calc?.registerCalculatedColumn?.({
          colId: 'pnlPerFace',
          headerName: 'PnL / Face',
          expression: '[dailyPnL] / [quantityFace]',
          cellDataType: 'number',
          initialWidth: 110,
        });
      } catch {
        /* calc may reject in edge cases */
      }
      break;
    }
    case 'conditional': {
      grid.updateGridOptions({
        columnDefs: cloneCols(LIVE_COLUMNS),
        enableCellChangeFlash: true,
      });
      handles.setStyleRules?.([
        {
          id: 'loss-row',
          name: 'Loss day (row)',
          kind: 'style',
          enabled: true,
          priority: 10,
          condition: '[dailyPnL] < 0',
          scope: { kind: 'row' },
          style: { base: { backgroundColor: 'rgba(160,40,40,0.22)' } },
        },
        {
          id: 'gain-pnl',
          name: 'Gain daily PnL',
          kind: 'style',
          enabled: true,
          priority: 20,
          condition: '[dailyPnL] > 0',
          scope: { kind: 'cell', columnIds: ['dailyPnL', 'unrealizedPnL'] },
          style: { base: { color: '#7dffa8', fontWeight: 'bold' } },
          flash: {
            enabled: true,
            target: 'cell',
            mode: 'fade',
            color: '#3dffa0',
            durationMs: 600,
          },
        },
      ]);
      break;
    }
    case 'filters': {
      grid.updateGridOptions({
        columnDefs: cloneCols(PRICING_COLUMNS),
        enableCellChangeFlash: false,
      });
      afterLayout(() => {
        grid.setSideBarVisible?.(true);
        grid.openToolPanel?.('filters');
        grid.setFilterModel?.({
          compositeRating: { filterType: 'set', values: ['AAA', 'AA', 'A'] },
        });
        try {
          grid.setState?.({
            modules: {
              'saved-filters': {
                version: 1,
                data: [
                  {
                    id: 'sf-ig',
                    label: 'IG (A+)',
                    active: true,
                    filterModel: {
                      compositeRating: { filterType: 'set', values: ['AAA', 'AA', 'A'] },
                    },
                  },
                  {
                    id: 'sf-usd',
                    label: 'USD only',
                    active: false,
                    filterModel: {
                      currency: { filterType: 'set', values: ['USD'] },
                    },
                  },
                  {
                    id: 'sf-fin',
                    label: 'Financials',
                    active: false,
                    filterModel: {
                      issuerSector: { filterType: 'text', type: 'equals', filter: 'Financials' },
                    },
                  },
                ],
              },
            },
          });
        } catch {
          /* module may not be registered yet */
        }
      });
      break;
    }
    case 'live': {
      grid.updateGridOptions({
        columnDefs: withPnlHeat(cloneCols(LIVE_COLUMNS)),
        enableCellChangeFlash: true,
        rowGroupPanelShow: 'never',
        sideBar: null,
      });
      afterLayout(() => grid.setRowGroupColumns?.([]));
      break;
    }
    case 'alerts': {
      grid.updateGridOptions({
        columnDefs: withPnlHeat(cloneCols(LIVE_COLUMNS)),
        enableCellChangeFlash: true,
      });
      handles.setAlertRules?.([
        {
          id: 'alert-big-move',
          name: 'Price move',
          enabled: true,
          priority: 10,
          severity: 'warning',
          trigger: {
            kind: 'relativeChange',
            colId: 'lastPrice',
            mode: 'ABSOLUTE_CHANGE',
            threshold: 0.15,
            direction: 'both',
          },
          message: '{rule}: {rowId} lastPrice {prev} → {value}',
          channels: ['toast', 'badge'],
          debounceMs: 1500,
        },
        {
          id: 'alert-loss',
          name: 'Daily loss',
          enabled: true,
          priority: 20,
          severity: 'critical',
          trigger: {
            kind: 'dataChange',
            expression: '[dailyPnL] < -20000',
            columnIds: ['dailyPnL'],
          },
          message: 'Loss spike on {rowId}: {value}',
          channels: ['toast', 'badge'],
          debounceMs: 2000,
        },
      ]);
      break;
    }
    case 'editing': {
      grid.updateGridOptions({
        columnDefs: cloneCols(EDIT_COLUMNS),
        enableCellChangeFlash: false,
        rowGroupPanelShow: 'never',
      });
      afterLayout(() => {
        grid.addCellRange?.({ rowStart: 0, rowEnd: 0, colIds: ['trader'] });
      });
      break;
    }
    case 'bulk-update': {
      grid.updateGridOptions({
        columnDefs: cloneCols(EDIT_COLUMNS),
        enableCellChangeFlash: false,
        rowGroupPanelShow: 'never',
      });
      afterLayout(() => {
        grid.addCellRange?.({ rowStart: 0, rowEnd: 6, colIds: ['trader'] });
      });
      break;
    }
    case 'plus-minus': {
      grid.updateGridOptions({
        columnDefs: cloneCols(EDIT_COLUMNS),
        enableCellChangeFlash: false,
        rowGroupPanelShow: 'never',
      });
      afterLayout(() => {
        grid.addCellRange?.({ rowStart: 2, rowEnd: 2, colIds: ['bidPrice'] });
      });
      break;
    }
    case 'shortcuts': {
      grid.updateGridOptions({
        columnDefs: cloneCols(EDIT_COLUMNS),
        enableCellChangeFlash: false,
        rowGroupPanelShow: 'never',
      });
      afterLayout(() => {
        grid.addCellRange?.({ rowStart: 0, rowEnd: 4, colIds: ['quantityFace'] });
      });
      break;
    }
    case 'profiles': {
      const cols = cloneCols(PRICING_COLUMNS).map((c, i) => {
        if (c.field === 'oas' || c.field === 'modifiedDuration') return { ...c, hide: true };
        if (c.field === 'marketValue') return { ...c, pinned: 'right' as const, width: 140 };
        if (i > 12) return { ...c, hide: true };
        return { ...c };
      });
      grid.updateGridOptions({
        columnDefs: cols,
        enableCellChangeFlash: false,
      });
      break;
    }
    default:
      break;
  }
}

/** Style / alert rule seeds for wireIntoKernel(opts) — used at wire time. */
export function rulesSeedForFeature(featureId: string): {
  rules?: unknown[];
  alertRules?: unknown[];
} {
  if (featureId === 'conditional') {
    return {
      rules: [
        {
          id: 'loss-row',
          name: 'Loss day (row)',
          kind: 'style',
          enabled: true,
          priority: 10,
          condition: '[dailyPnL] < 0',
          scope: { kind: 'row' },
          style: { base: { backgroundColor: 'rgba(160,40,40,0.22)' } },
        },
        {
          id: 'gain-pnl',
          name: 'Gain daily PnL',
          kind: 'style',
          enabled: true,
          priority: 20,
          condition: '[dailyPnL] > 0',
          scope: { kind: 'cell', columnIds: ['dailyPnL', 'unrealizedPnL'] },
          style: { base: { color: '#7dffa8', fontWeight: 'bold' } },
        },
      ],
    };
  }
  if (featureId === 'alerts') {
    return {
      alertRules: [
        {
          id: 'alert-big-move',
          name: 'Price move',
          enabled: true,
          priority: 10,
          severity: 'warning',
          trigger: {
            kind: 'relativeChange',
            colId: 'lastPrice',
            mode: 'ABSOLUTE_CHANGE',
            threshold: 0.15,
            direction: 'both',
          },
          message: '{rule}: {rowId} lastPrice {prev} → {value}',
          channels: ['toast', 'badge'],
          debounceMs: 1500,
        },
      ],
    };
  }
  return {};
}

export function calcSeedForFeature(featureId: string): {
  calculatedColumns?: Array<{
    colId: string;
    headerName: string;
    expression: string;
    cellDataType?: string;
    initialWidth?: number;
  }>;
} {
  if (featureId !== 'calc') return {};
  return {
    calculatedColumns: [
      {
        colId: 'bidAskSpread',
        headerName: 'Bid/Ask Spr',
        expression: '[askPrice] - [bidPrice]',
        cellDataType: 'number',
        initialWidth: 110,
      },
      {
        colId: 'pnlPerFace',
        headerName: 'PnL / Face',
        expression: '[dailyPnL] / [quantityFace]',
        cellDataType: 'number',
        initialWidth: 110,
      },
    ],
  };
}
