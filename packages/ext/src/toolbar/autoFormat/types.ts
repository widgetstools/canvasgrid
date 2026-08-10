/**
 * Types for the field-format catalog — FI/equity field names mapped to
 * native canvasgrid formatting (excel format strings, halign, typography).
 * Drives the title-bar "Auto format" action.
 */
export type AutoFormatAlignment = 'left' | 'center' | 'right';

export interface AutoFormatAssignment {
  /** Excel / velocity-grid-format DSL string (or undefined for style-only). */
  format?: string;
  alignment?: AutoFormatAlignment;
  bold?: boolean;
  headerName?: string;
}

export interface FieldFormatEntry {
  id: string;
  category: string;
  aliases?: readonly string[];
  suffixes?: readonly string[];
  format?: string;
  alignment?: AutoFormatAlignment;
  bold?: boolean;
  headerName?: string;
}

export interface AutoFormatColumn {
  colId: string;
  field?: string;
  headerName?: string;
  cellDataType?: string;
}
