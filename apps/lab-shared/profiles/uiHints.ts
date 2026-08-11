/** Light post-profile UI cues (open panels / select ranges) — not module state. */

export interface HintGrid {
  setSideBarVisible?(show: boolean): void;
  openToolPanel?(id: string): void;
  addCellRange?(range: { rowStart: number; rowEnd: number; colIds: string[] }): void;
}

export function applyLabUiHints(featureId: string, mode: 'csrm', grid: HintGrid): void {
  void mode;
  const later = (fn: () => void) => requestAnimationFrame(() => setTimeout(fn, 60));

  later(() => {
    switch (featureId) {
      case 'overview':
        grid.setSideBarVisible?.(true);
        grid.openToolPanel?.('columns');
        break;
      case 'filters':
        grid.setSideBarVisible?.(true);
        grid.openToolPanel?.('filters');
        break;
      case 'formatting':
      case 'toolbar':
      case 'visual-excel':
        if (mode === 'csrm') {
          grid.addCellRange?.({ rowStart: 1, rowEnd: 4, colIds: ['bidPrice', 'midPrice', 'askPrice'] });
        } else {
          grid.addCellRange?.({ rowStart: 0, rowEnd: 3, colIds: ['price', 'notional', 'marketValue'] });
        }
        break;
      case 'bulk-update':
        grid.addCellRange?.({
          rowStart: 0,
          rowEnd: 6,
          colIds: [mode === 'csrm' ? 'trader' : 'trader'],
        });
        break;
      case 'plus-minus':
        grid.addCellRange?.({
          rowStart: 2,
          rowEnd: 2,
          colIds: [mode === 'csrm' ? 'bidPrice' : 'price'],
        });
        break;
      case 'shortcuts':
        grid.addCellRange?.({
          rowStart: 0,
          rowEnd: 4,
          colIds: [mode === 'csrm' ? 'quantityFace' : 'notional'],
        });
        break;
      case 'editing':
        grid.addCellRange?.({ rowStart: 0, rowEnd: 0, colIds: ['trader'] });
        break;
      default:
        break;
    }
  });
}
