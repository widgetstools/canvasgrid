// ICellEditor interface — mirrors ag-grid's ICellEditor surface so app code
// that already knows the ag-grid contract can register custom editors against
// cgrid with zero renames. See docs/catalog/06-cell-editing.md lines 70-84.

export interface ICellEditorParams<TRow = unknown, TValue = unknown> {
  /** Read-only snapshot of the row at edit-start time. */
  data: TRow;
  /** Resolved colId of the cell being edited. */
  colId: string;
  /** Pre-edit value (from valueGetter or data[field]). */
  value: TValue | null | undefined;
  /** Raw key that started the edit (printable char from type-to-edit, or
   *  null when started via mouse / F2 / api). */
  charPress: string | null;
  /** Resolved CellEditorParams from CColDef.cellEditorParams. */
  params: Record<string, unknown>;
  /** Cell pixel bounds at edit-start time. Popup editors may ignore. */
  cellBounds: { x: number; y: number; w: number; h: number };
  /** Invoked by the editor (e.g. on Enter) to request commit. The host
   *  honors `isCancelAfterEnd()` then calls `getValue()`. */
  stopEditing: (cancel?: boolean) => void;
}

export interface ICellEditor<TRow = unknown, TValue = unknown> {
  /** Called once before getGui(). Stash params; do NOT mount DOM yet. */
  init(params: ICellEditorParams<TRow, TValue>): void;
  /** Returns the DOM element to mount as the editor body. Called once. */
  getGui(): HTMLElement;
  /** Returns the current value. Called by the host on commit. */
  getValue(): TValue | null | undefined;
  /** Called by the host on close (commit or cancel). Release DOM listeners. */
  destroy(): void;

  /** Optional hooks — see docs/catalog/06-cell-editing.md for semantics. */
  /** Return false to reject a commit: the host keeps the editor open and
   *  adds `cg-editor--invalid`, so a bad value never navigates away. When
   *  absent the value is always considered committable. */
  isValid?(): boolean;
  isPopup?(): boolean;
  getPopupPosition?(): 'over' | 'under';
  afterGuiAttached?(): void;
  isCancelBeforeStart?(): boolean;
  isCancelAfterEnd?(): boolean;
  focusIn?(): void;
  focusOut?(): void;
}

export type CellEditorCtor<TRow = unknown, TValue = unknown> = new () => ICellEditor<TRow, TValue>;
