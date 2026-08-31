import type { ColumnDefinition } from '../types/schema';

/**
 * The one place a catalog {@link ColumnDefinition} becomes a grid column def.
 *
 * There used to be two of these — one in `client/bind.ts` for CSRM, one in
 * `@wellsfargo-starui/velocity-grid-perspective` for SSRM — and they had
 * drifted. The Perspective mapper derived `enableRowGroup` / `enableValue`
 * from `cellDataType`; the CSRM one derived nothing at all. NEITHER emitted
 * `enablePivot`, which is what the pivot panel checks at drop time
 * (`isColumnPivotEnabled` → `PropertyChain.enablePivot`, default `false`), so
 * a provider-driven grid silently refused every drag into Column Labels.
 *
 * It only bit under VelocityGridExt because that is where provider-derived
 * defs are the ONLY defs: an app that hand-writes `columnDefs` sets the flags
 * itself and pivots fine. Same feature, two capability stories — so the fix is
 * one mapper, not two corrected ones.
 */

/** Grid-shaped column def. Structural on purpose: this package must not
 *  depend on the kernel's `CColDef`, and every consumer casts to its own. */
export interface GridColumnDef {
  field: string;
  colId: string;
  headerName: string;
  cellDataType?: 'number' | 'text';
  valueGetter?: string;
  width?: number;
  hide?: boolean;
  sortable?: boolean;
  resizable?: boolean;
  filter?: 'set' | 'number';
  floatingFilter?: boolean;
  enableRowGroup?: boolean;
  enablePivot?: boolean;
  enableValue?: boolean;
  aggFunc?: string;
}

export interface ToGridColumnDefsOptions {
  /**
   * The provider's key column(s). Key columns are identity, not analysis:
   * they are excluded from the dimension defaults so nobody groups or pivots
   * by a unique id and generates one pivot column per row. Authored flags
   * still win — this only shapes the DEFAULT.
   */
  keyColumn?: string | string[];
}

function keyFieldSet(keyColumn: string | string[] | undefined): Set<string> {
  if (typeof keyColumn === 'string' && keyColumn.trim()) return new Set([keyColumn.trim()]);
  if (Array.isArray(keyColumn)) {
    return new Set(keyColumn.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()));
  }
  return new Set();
}

/**
 * Map catalog column definitions onto grid column defs.
 *
 * Capability flags follow one rule: an authored value always wins, and only
 * an UNSET flag falls back to the type heuristic —
 *
 *   - number            → a measure: `enableValue`, `aggFunc: 'sum'`
 *   - anything else     → a dimension: `enableRowGroup` + `enablePivot`
 *   - a key column      → neither; it identifies rows, it does not describe them
 *
 * so `{ field: 'pnl', enablePivot: true }` in the catalog is honoured even
 * though the heuristic would not have offered it.
 */
export function toGridColumnDefs(
  cols: readonly ColumnDefinition[] | undefined | null,
  opts: ToGridColumnDefsOptions = {},
): GridColumnDef[] {
  if (!cols?.length) return [];
  const keys = keyFieldSet(opts.keyColumn);

  return cols.map((d) => {
    const def: GridColumnDef = {
      field: d.field,
      colId: d.field,
      headerName: d.headerName ?? d.field,
    };
    if (d.cellDataType === 'number' || d.cellDataType === 'text') def.cellDataType = d.cellDataType;
    if (typeof d.valueGetter === 'string' && d.valueGetter.trim()) def.valueGetter = d.valueGetter.trim();
    if (d.width != null) def.width = d.width;
    if (d.hide != null) def.hide = d.hide;
    if (d.sortable != null) def.sortable = d.sortable;
    if (d.resizable != null) def.resizable = d.resizable;
    if (d.filter === true) {
      // Text dimensions get the unique-value checklist; numerics keep
      // comparison / range floating filters.
      def.filter = d.cellDataType === 'number' ? 'number' : 'set';
      def.floatingFilter = true;
    }

    const isMeasure = d.cellDataType === 'number';
    const isKey = keys.has(d.field);
    const dimensionDefault = !isMeasure && !isKey;
    const measureDefault = isMeasure && !isKey;

    if (d.enableRowGroup != null) def.enableRowGroup = d.enableRowGroup;
    else if (dimensionDefault) def.enableRowGroup = true;

    if (d.enablePivot != null) def.enablePivot = d.enablePivot;
    else if (dimensionDefault) def.enablePivot = true;

    if (d.enableValue != null) def.enableValue = d.enableValue;
    else if (measureDefault) def.enableValue = true;

    if (typeof d.aggFunc === 'string' && d.aggFunc.trim()) def.aggFunc = d.aggFunc.trim();
    else if (measureDefault) def.aggFunc = 'sum';

    return def;
  });
}
