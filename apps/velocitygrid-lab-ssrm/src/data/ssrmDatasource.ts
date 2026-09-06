/**
 * A server-side datasource for the blotter, implemented against an in-memory
 * book.
 *
 * The book lives in this tab only because a lab has to open without a broker.
 * Everything above it is the real contract: the grid never asks for the book,
 * it asks three questions — what groups exist, what leaves sit under this one,
 * and what rows fill this flat window — and this module answers them the way a
 * server would, doing the filtering, sorting, grouping and aggregation itself.
 *
 * That is the point worth seeing. Swapping this for Perspective, or for an
 * HTTP endpoint, changes nothing above the datasource boundary; the grid's
 * behaviour is identical because the contract is.
 */
import type {
  IServerSideDatasourceV2,
  IServerSideGetGroupLeafIdsParams,
  IServerSideGetLeafRowsParams,
  IServerSideGetRowsParams,
  IServerSideGetSkeletonParams,
  SkeletonGroup,
} from '@wellsfargo-starui/velocity-grid';
import type { BlotterRow } from './domain';

/** Columns summed up the group tree — the same set the columns declare
 *  `aggFunc: 'sum'` on. Kept here rather than derived from the column defs so
 *  the "server" side does not depend on the client's view of the world. */
const SUM_FIELDS = [
  'quantityFace', 'marketValue', 'unrealizedPnL', 'dailyPnL', 'mtdPnL', 'ytdPnL',
] as const satisfies readonly (keyof BlotterRow)[];

/** Group-path segment separator. A value containing this character would
 *  collide with a deeper path, so it must be one no blotter field can hold. */
const PATH_SEP = String.fromCharCode(0);

export interface BlotterBook {
  rows(): readonly BlotterRow[];
  /** Latency the datasource simulates, so the lab shows what a real network
   *  feels like. Set to 0 in tests. */
  latencyMs: number;
}

type SortModel = { colId: string; direction?: 'asc' | 'desc'; sort?: 'asc' | 'desc' }[];
type FilterModel = Record<string, unknown>;

/** Read a field by runtime column id. `BlotterRow` has no index signature —
 *  deliberately, so a typo in a field name is a compile error everywhere else
 *  — so the one place that genuinely indexes by a runtime string does it here. */
const field = (row: BlotterRow, colId: string): unknown =>
  (row as unknown as Record<string, unknown>)[colId];

/** Minimal filter evaluation — enough for the filter kinds the lab's columns
 *  declare (text contains/equals, number comparisons, set membership). */
function matches(row: BlotterRow, model: FilterModel): boolean {
  for (const [colId, raw] of Object.entries(model ?? {})) {
    const f = raw as Record<string, unknown> | null;
    if (!f) continue;
    const value = field(row, colId);
    const type = String(f.filterType ?? '');

    if (type === 'set' || Array.isArray(f.values)) {
      const values = (f.values as unknown[]) ?? [];
      if (values.length && !values.map(String).includes(String(value))) return false;
      continue;
    }
    if (type === 'number') {
      const n = Number(value);
      const a = Number(f.filter);
      const b = Number(f.filterTo);
      switch (String(f.type)) {
        case 'equals': if (n !== a) return false; break;
        case 'notEqual': if (n === a) return false; break;
        case 'greaterThan': if (!(n > a)) return false; break;
        case 'greaterThanOrEqual': if (!(n >= a)) return false; break;
        case 'lessThan': if (!(n < a)) return false; break;
        case 'lessThanOrEqual': if (!(n <= a)) return false; break;
        case 'inRange': if (!(n >= a && n <= b)) return false; break;
        default: break;
      }
      continue;
    }
    const s = String(value ?? '').toLowerCase();
    const needle = String(f.filter ?? '').toLowerCase();
    if (!needle) continue;
    switch (String(f.type)) {
      case 'equals': if (s !== needle) return false; break;
      case 'notEqual': if (s === needle) return false; break;
      case 'startsWith': if (!s.startsWith(needle)) return false; break;
      case 'endsWith': if (!s.endsWith(needle)) return false; break;
      default: if (!s.includes(needle)) return false; break;
    }
  }
  return true;
}

function sorted(rows: BlotterRow[], model: SortModel): BlotterRow[] {
  if (!model?.length) return rows;
  const specs = model.map((s) => ({ colId: s.colId, dir: (s.direction ?? s.sort) === 'desc' ? -1 : 1 }));
  return [...rows].sort((a, b) => {
    for (const { colId, dir } of specs) {
      const av = field(a, colId);
      const bv = field(b, colId);
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

function aggregate(rows: readonly BlotterRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SUM_FIELDS) {
    let total = 0;
    for (const row of rows) total += Number(row[key]) || 0;
    out[key] = total;
  }
  return out;
}

export function createBlotterSsrmDatasource(book: BlotterBook): IServerSideDatasourceV2<BlotterRow> {
  const after = (fn: () => void): void => {
    if (book.latencyMs <= 0) { fn(); return; }
    setTimeout(fn, book.latencyMs);
  };

  const view = (filterModel: FilterModel, sortModel: SortModel) =>
    sorted(book.rows().filter((r) => matches(r, filterModel)), sortModel);

  const inGroup = (row: BlotterRow, groupPath: string[], rowGroupCols: string[]) =>
    groupPath.every((v, i) => String(field(row, rowGroupCols[i]!) ?? '') === v);

  return {
    /** Flat window — only called when no row grouping is active. */
    getRows(params: IServerSideGetRowsParams<BlotterRow>): void {
      const { startRow, endRow, filterModel, sortModel } = params.request as unknown as {
        startRow: number; endRow: number; filterModel: FilterModel; sortModel: SortModel;
      };
      after(() => {
        const rows = view(filterModel, sortModel);
        params.success({
          rowData: rows.slice(startRow, endRow),
          rowCount: rows.length,
          unfilteredRowCount: book.rows().length,
        });
      });
    },

    /**
     * Every group at every depth, in one reply. The kernel owns the flatten
     * index and the expansion state, so expansion never crosses this boundary
     * — which is why expanding a group costs no request at all.
     */
    getGroupSkeleton(params: IServerSideGetSkeletonParams): void {
      const { filterModel, sortModel, rowGroupCols } = params.request as unknown as {
        filterModel: FilterModel; sortModel: SortModel; rowGroupCols: string[];
      };
      after(() => {
        const rows = view(filterModel, sortModel);
        const buckets = new Map<string, { path: string[]; rows: BlotterRow[] }>();

        for (const row of rows) {
          const path: string[] = [];
          for (const colId of rowGroupCols) {
            path.push(String(field(row, colId) ?? ''));
            // Every prefix is a group, so three-level grouping produces rows
            // at depths 1, 2 and 3 — the kernel needs all of them to build the
            // tree, not only the leaves' immediate parents.
            const key = path.join(PATH_SEP);
            let bucket = buckets.get(key);
            if (!bucket) { bucket = { path: [...path], rows: [] }; buckets.set(key, bucket); }
            bucket.rows.push(row);
          }
        }

        const groups: SkeletonGroup[] = [...buckets.values()].map((b) => ({
          path: b.path,
          leafCount: b.rows.length,
          aggregates: aggregate(b.rows),
        }));

        // `path: []` carries the grand total, which is what feeds
        // `grandTotalRow` without a second query.
        groups.unshift({ path: [], leafCount: rows.length, aggregates: aggregate(rows) });

        params.success({ groups, unfilteredRowCount: book.rows().length });
      });
    },

    /** One window of leaves under one deepest-level group. */
    getLeafRows(params: IServerSideGetLeafRowsParams<BlotterRow>): void {
      const { groupPath, startRow, endRow, filterModel, sortModel, rowGroupCols } =
        params.request as unknown as {
          groupPath: string[]; startRow: number; endRow: number;
          filterModel: FilterModel; sortModel: SortModel; rowGroupCols: string[];
        };
      after(() => {
        const rows = view(filterModel, sortModel).filter((r) => inGroup(r, groupPath, rowGroupCols));
        params.success({ rowData: rows.slice(startRow, endRow) });
      });
    },

    /** Descendant leaf ids at any depth — enables group-checkbox selection
     *  over leaves that have never been loaded. */
    getGroupLeafIds(params: IServerSideGetGroupLeafIdsParams): void {
      const { groupPath, filterModel, sortModel, rowGroupCols } = params.request as unknown as {
        groupPath: string[]; filterModel: FilterModel; sortModel: SortModel; rowGroupCols: string[];
      };
      after(() => {
        const ids = view(filterModel, sortModel)
          .filter((r) => inGroup(r, groupPath, rowGroupCols))
          .map((r) => r.id);
        params.success({ ids });
      });
    },
  };
}
