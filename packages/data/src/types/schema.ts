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
}

export interface SchemaConfig {
  inferredFields?: FieldInfo[];
  columnDefinitions?: ColumnDefinition[];
  /** When true, prune inbound rows to columnDefinitions + keyColumn paths. */
  projectFields?: boolean;
}
