/**
 * Cross-section pill drag routing.
 *
 * Five panel containers carry pills representing a column's role:
 *
 *   • top-strip Row Group panel  (`.cg-row-group-panel`)        — rowGroup
 *   • top-strip Pivot panel      (`.cg-pivot-panel`)            — pivot
 *   • columns side-panel rgz     (`.cg-columns-panel-rgz`)      — rowGroup
 *   • columns side-panel plz     (`.cg-columns-panel-plz`)      — pivot
 *   • columns side-panel valz    (`.cg-columns-panel-valz`)     — value
 *
 * Each one carries `data-cg-pill-role="rowGroup" | "pivot" | "value"` so a
 * single point-to-role hit test (`resolveDragTargetRole`) walks
 * `elementFromPoint` and finds the first ancestor with the marker.
 *
 * When a pill drag ends on a panel with a DIFFERENT role than its
 * source, `commitPanelMove` atomically removes the column from its
 * current role and adds it to the target role. Target role must accept
 * the column (per `enableRowGroup` / `enablePivot` / `enableValue`); if
 * it rejects, the move is a no-op so the user doesn't lose the column
 * via an accidental drop.
 */

export type PillPanelRole = 'rowGroup' | 'pivot' | 'value';

/** The cgrid surface `commitPanelMove` calls into. Kept narrow so the
 *  helper can be exercised with a mock api in unit tests. */
export interface PanelMoveApi {
  isColumnRowGroupEnabled(colId: string): boolean;
  isColumnPivotEnabled(colId: string): boolean;
  isColumnValueEnabled(colId: string): boolean;
  getRowGroupColumns(): string[];
  getPivotColumns(): string[];
  getValueColumns(): Array<{ colId: string }>;
  addRowGroupColumn(colId: string): void;
  removeRowGroupColumn(colId: string): void;
  addPivotColumn(colId: string): void;
  removePivotColumn(colId: string): void;
  addValueColumn(colId: string, aggFunc?: string): void;
  removeValueColumn(colId: string): void;
  /** Optional — resolves the default aggregation func for a column
   *  dropped onto the Values zone. Falls back to `'sum'` when absent. */
  getColumnDefaultAggFunc?(colId: string): string | undefined;
}

const DEFAULT_VALUE_AGG_FUNC = 'sum';

export function canAcceptInRole(api: PanelMoveApi, role: PillPanelRole, colId: string): boolean {
  if (role === 'rowGroup') return api.isColumnRowGroupEnabled(colId);
  if (role === 'pivot') return api.isColumnPivotEnabled(colId);
  return api.isColumnValueEnabled(colId);
}

/** Move a column from one role to another. Returns `true` on success,
 *  `false` when the source equals the target OR the target rejects.
 *  Rejection is silent — the source role is preserved so the user
 *  doesn't lose the column on an accidental drop. */
export function commitPanelMove(
  api: PanelMoveApi,
  fromRole: PillPanelRole,
  toRole: PillPanelRole,
  colId: string,
): boolean {
  if (fromRole === toRole) return false;
  if (!canAcceptInRole(api, toRole, colId)) return false;
  // Remove from source FIRST so the column doesn't transiently exist
  // in both roles (which can affect downstream listeners that fire on
  // role-list mutations).
  if (fromRole === 'rowGroup') api.removeRowGroupColumn(colId);
  else if (fromRole === 'pivot') api.removePivotColumn(colId);
  else api.removeValueColumn(colId);
  if (toRole === 'rowGroup') api.addRowGroupColumn(colId);
  else if (toRole === 'pivot') api.addPivotColumn(colId);
  else {
    const agg = api.getColumnDefaultAggFunc?.(colId) ?? DEFAULT_VALUE_AGG_FUNC;
    api.addValueColumn(colId, agg);
  }
  return true;
}

/** Hit-test a viewport-coord point to the panel role underneath it.
 *  Walks `elementFromPoint(x, y)` upward looking for the first ancestor
 *  with `data-cg-pill-role`. Returns `null` when no panel was hit. */
export function resolveDragTargetRole(
  clientX: number,
  clientY: number,
  doc?: Pick<Document, 'elementFromPoint'>,
): PillPanelRole | null {
  const d = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!d) return null;
  const el = d.elementFromPoint(clientX, clientY) as Element | null;
  if (!el) return null;
  const container = el.closest('[data-cg-pill-role]');
  if (!container) return null;
  const role = container.getAttribute('data-cg-pill-role');
  if (role === 'rowGroup' || role === 'pivot' || role === 'value') return role;
  return null;
}
