// Public types for cgrid. Re-exported from src/cgrid.ts.
// See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md §9.
//
// Cycle 19 / Task 1 — this file is now a thin re-export façade. The
// actual type definitions live in `./types/*.ts`, grouped by domain
// (cell, column, filter, group, event, options, clipboard, api).
// Every `import { X } from '../types'` (or any other relative depth)
// keeps working through these re-exports.

// External module re-exports — the public surface keeps exporting these
// from `cgrid` so app code can `import { ICellEditor } from 'cgrid'`
// without reaching into interaction/*. These don't belong to any single
// domain file because they're not OUR types; they're the contracts the
// interaction subsystems own.
export type { ICellEditor, ICellEditorParams, CellEditorCtor } from './interaction/editors/iCellEditor';
// Cycle 10 / Task 1 — public context-menu surface. Re-exported from cgrid's
// root index alongside the rest of the public API.
export type {
  MenuItem,
  GetContextMenuItemsParams,
  GetContextMenuItemsCallback,
  GetMainMenuItemsParams,
  GetMainMenuItemsCallback,
} from './interaction/contextMenu/types';
// Cycle 11 / Task 1 — public tool-panel + side-bar surface.
export type {
  ToolPanel,
  ToolPanelComponent,
  ToolPanelParams,
  ToolPanelDef,
  SideBarDef,
  IToolPanelColumnCompParams,
  IToolPanelFiltersCompParams,
} from './interaction/toolPanels/types';
// Cycle 13 / Task 1 — public status-bar + status-panel surface.
export type {
  IStatusPanel,
  IStatusPanelComp,
  StatusPanelComponent,
  StatusPanelParams,
  StatusPanelDef,
  StatusPanelAlign,
  StatusBarDef,
  StatusBarPosition,
} from './interaction/statusBar/types';
// Cycle 13 / Task 3 — `agAggregationComponent` public params + the
// `AggFunc` union. Apps that restrict the agg panel via
// `statusPanelParams.aggFuncs` or supply a custom `valueFormatter`
// import these. The panel implementation lives at
// `interaction/statusBar/panels/aggregation.ts`.
export type { IAggregationStatusPanelParams } from './interaction/statusBar/panels/aggregation';
export type { AggFunc } from './interaction/statusBar/aggMath';

// Domain re-exports. Each `./types/<domain>` file owns a focused subset
// of the public type surface; this façade flattens them back into one
// import-able namespace.
export type {
  // cell.ts — cell-styling primitives
  VAlign,
  FontWeight,
  FontStyle,
  TextTransform,
  Padding,
  BorderStyle,
  BorderSide,
  BorderSpec,
  CellContent,
  DecoratorPosition,
  CellDecorator,
  ColCellOverrides,
  CellClassParams,
  CellClass,
  CellClassRules,
  CellStyleFunc,
  HeaderClass,
  HeaderStyleFunc,
} from './types/cell';

export type {
  // group.ts — agg + groupModel
  IAggFuncParams,
  IAggFunc,
  GroupModel,
} from './types/group';

export type {
  // filter.ts — filter models + params
  FilterModelEntryLegacy,
  CTextFilterOp,
  CNumberFilterOp,
  CDateFilterOp,
  CTextFilterModel,
  CNumberFilterModel,
  CDateFilterModel,
  CMultiConditionFilterModel,
  CSetFilterModel,
  CFilterModelEntry,
  FilterModelEntry,
  FilterModel,
  CFilterParams,
  CTextFilterParams,
  CSetFilterParams,
} from './types/filter';

export type {
  // column.ts — column model + sort + range + state + sizing
  GetRowHeightParams,
  EditableCallback,
  FlashCellsParams,
  SuppressKeyboardEventCallback,
  FillOperationParams,
  CColDef,
  CCellRendererSelectorParams,
  CCellRendererSelectorResult,
  CCellRendererSelector,
  CColGroupDef,
  CValueGetterParams,
  CValueFormatterParams,
  CValueParserParams,
  CValueSetterParams,
  SortModelEntry,
  SortModel,
  SelectionRange,
  CColumnState,
  CApplyColumnStateParams,
  ISizeColumnsToFitParams,
} from './types/column';

export type {
  // clipboard.ts — clipboard + export callbacks
  ProcessCellForClipboardParams,
  ProcessCellForClipboardCallback,
  ProcessCellFromClipboardParams,
  ProcessCellFromClipboardCallback,
  ExportCallback,
} from './types/clipboard';

export type {
  // event.ts — typed event union + per-event shapes
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  RowEditingStartedEvent,
  RowEditingStoppedEvent,
  RowValueChangedEvent,
  AggregationChangedSource,
  AggregationChangedEvent,
  CGridEvent,
} from './types/event';

export type {
  // options.ts — CGridOptions + CCellSelectionOptions
  CCellSelectionOptions,
  CGridOptions,
} from './types/options';

export type {
  // api.ts — CGridApi + transaction shapes
  Tx,
  TransactionResult,
  CGridApi,
} from './types/api';
