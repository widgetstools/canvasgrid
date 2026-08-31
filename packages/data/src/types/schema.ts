/** Inferred field metadata from scanning sample rows. */
export interface FieldInfo {
  path: string;
  inferredType: 'text' | 'number' | 'boolean' | 'date' | 'object' | 'unknown';
  nullRatio: number;
  samples: unknown[];
}

/** Authored column definition provided to the grid. */
export interface ColumnDefinition {
  field: string;
  headerName?: string;
  cellDataType?: 'text' | 'number' | 'boolean' | 'date';
  filter?: boolean;
  sortable?: boolean;
  resizable?: boolean;
  /**
   * Expression-form valueGetter (`[ask] - [bid]`, `IF([qty] > 0, [pnl], 0)`).
   * Mapped onto VelocityGrid `colDef.valueGetter` for CSRM and SSRM.
   */
  valueGetter?: string;
  width?: number;
  hide?: boolean;
  /**
   * Capability flags — what the column may be dragged into. Each is
   * optional and OVERRIDES the type heuristic in `toGridColumnDefs`, which
   * otherwise treats numerics as measures and everything else (bar the key
   * column) as dimensions.
   *
   * `enablePivot` in particular is what the pivot panel checks before
   * accepting a drop into Column Labels; a column without it cannot be
   * pivoted no matter what the panel shows.
   */
  enableRowGroup?: boolean;
  enablePivot?: boolean;
  enableValue?: boolean;
  /** Default aggregation when used as a value column (e.g. `'sum'`). */
  aggFunc?: string;
}

export interface SchemaConfig {
  inferredFields?: FieldInfo[];
  columnDefinitions?: ColumnDefinition[];
  /** When true, prune inbound rows to columnDefinitions + keyColumn paths. */
  projectFields?: boolean;
}
