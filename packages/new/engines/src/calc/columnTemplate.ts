/**
 * Column override / template vocabulary.
 *
 * Data-only shapes: the calc engine stores and merges them, the grid resolves
 * them into `ResolvedColDef` slots, and neither side draws from them directly.
 */

/** Static icon reference. Structural twin of the format engine's `IconRef` —
 *  kept separate because calc holds data and never draws. */
export interface IconOverride {
  name?: string;
  emoji?: string;
  color?: string;
  position?: 'leading' | 'trailing';
}

export interface ColumnOverride {
  colId: string;
  headerName?: string;
  /** Format-DSL string, compiled by the grid's format compiler slot. */
  format?: string;
  /** `ColCellOverrides` vocabulary. */
  cellStyle?: Record<string, unknown>;
  headerStyle?: Record<string, unknown>;
  cellRenderer?: string;
  editable?: boolean;
  hide?: boolean;
  width?: number;
  cellIcon?: IconOverride;
  headerIcon?: IconOverride;
  /** Template chain refs. `undefined` → type default; `[]` → opt out. */
  templateIds?: string[];
  floatingFilter?: boolean;
  filter?: 'text' | 'number' | 'date' | 'set';
  enableRowGroup?: boolean;
  enablePivot?: boolean;
  sortable?: boolean;
  resizable?: boolean;
  suppressAggFuncInHeader?: boolean;
}

export interface ColumnTemplate {
  id: string;
  name: string;
  description?: string;
  overrides: Omit<ColumnOverride, 'colId' | 'templateIds'>;
  /** Host-stamped — the engine never calls `Date.now`. */
  createdAt: number;
  updatedAt: number;
}

export interface TypeDefaults {
  numeric?: string;
  date?: string;
  string?: string;
  boolean?: string;
}

/**
 * Patch form of `ColumnOverride`. Slots that a toolbar can clear accept `null`
 * to remove the stored value; `undefined` leaves the slot untouched. Stored
 * overrides never hold `null` — that distinction is patch-side only.
 */
export type ColumnEditPatch = Partial<
  Pick<
    ColumnOverride,
    | 'cellRenderer' | 'editable' | 'hide' | 'width' | 'cellStyle' | 'headerStyle'
    | 'floatingFilter' | 'enableRowGroup' | 'enablePivot' | 'sortable' | 'resizable'
    | 'suppressAggFuncInHeader'
  >
> & {
  format?: string | null;
  cellIcon?: IconOverride | null;
  headerIcon?: IconOverride | null;
  filter?: 'text' | 'number' | 'date' | 'set' | null;
};
