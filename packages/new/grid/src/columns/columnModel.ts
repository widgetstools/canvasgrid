import type { ColDef } from '../types/options';

export type ResolvedCol = {
  colId: string;
  field?: string;
  headerName: string;
  width: number;
  hide: boolean;
  pinned: 'left' | 'right' | null;
  sortable: boolean;
};

export class ColumnModel<T> {
  private cols: ResolvedCol[] = [];

  setColumnDefs(defs: ColDef<T>[]): void {
    this.cols = defs.map((d, i) => {
      const colId = d.colId ?? (d.field as string | undefined) ?? `col_${i}`;
      return {
        colId,
        field: d.field as string | undefined,
        headerName: d.headerName ?? colId,
        width: d.width ?? 120,
        hide: !!d.hide,
        pinned: d.pinned ?? null,
        sortable: d.sortable !== false,
      };
    });
  }

  getAll(): ResolvedCol[] {
    return this.cols.slice();
  }

  getVisible(): ResolvedCol[] {
    return this.cols.filter((c) => !c.hide);
  }

  getState(): Array<{ colId: string; hide?: boolean; width?: number; pinned?: string | null }> {
    return this.cols.map((c) => ({
      colId: c.colId,
      hide: c.hide,
      width: c.width,
      pinned: c.pinned,
    }));
  }

  applyState(state: Array<{
    colId: string;
    hide?: boolean;
    width?: number;
    pinned?: 'left' | 'right' | null;
    headerName?: string;
  }>): void {
    const byId = new Map(state.map((s) => [s.colId, s]));
    for (const c of this.cols) {
      const s = byId.get(c.colId);
      if (!s) continue;
      if (s.hide !== undefined) c.hide = s.hide;
      if (s.width !== undefined) c.width = s.width;
      if (s.pinned !== undefined) c.pinned = s.pinned;
      if (s.headerName !== undefined) c.headerName = s.headerName;
    }
  }

  totalWidth(): number {
    return this.getVisible().reduce((a, c) => a + c.width, 0);
  }
}
