import type { ViewportState } from '../../core/viewport';
import type { ResolvedTheme } from '../../theming/cssReader';
import type { ResolvedColDef } from '../../core/propertyChain';
import type { CellRendererRegistry } from '../cellRenderers/registry';

export type CellDataLookup = (
  rowIndex: number,
  colId: string,
) => { value: unknown; valueFormatted: string; flashAlpha?: number } | null;

export interface PainterCtx {
  viewport: ViewportState;
  theme: ResolvedTheme;
  columnDefs: Map<string, ResolvedColDef>;
  cellRenderers: CellRendererRegistry;
  cellData: CellDataLookup;
  selection: {
    focusedRowIndex: number | null;
    focusedColId: string | null;
    selectedRowIndices: Set<number>;
  };
}
