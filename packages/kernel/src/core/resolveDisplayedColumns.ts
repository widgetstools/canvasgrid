/**
 * The one place a displayed column tree is built.
 *
 * ## Why this exists
 *
 * Four separate places used to build a tree — the VelocityGrid constructor,
 * `rebuildColumns`, and the pivot engine's swap-in and swap-out — and each
 * merged a DIFFERENT subset of the inputs. That is the root of the recurring
 * "fixed it, it came back" class:
 *
 *  - `rebuildColumns` folded calc overrides and salvaged `width` off the
 *    previous tree, but not `hide` or `pinned`.
 *  - The pivot swap took neither: it built synthetic leaves from a handful of
 *    hard-coded properties and installed them over whatever was there.
 *  - `ColumnStateManager` had to apply column state twice, because the rebuild
 *    between its two passes discarded the first.
 *
 * Nothing was wrong with any one of them in isolation. They simply disagreed,
 * and which one ran last decided what you saw — so the same feature worked or
 * did not depending on the order you touched things in.
 *
 * This module makes the tree a pure function of its inputs, so "what should be
 * on screen" has exactly one answer and every mutation path is the same two
 * steps: change an input, re-resolve.
 *
 * ## The stages, in order
 *
 *   1. host `columnDefs`            — what the app declared
 *   2. + calc overrides / templates — `foldCalcColumnDefs`
 *   3. + live runtime state         — width / hide / pinned the user changed
 *   4. + pivot projection           — the cross-tab, built FROM stage 3
 *
 * Stage 4 CONSUMES stage 3 rather than replacing it, which is what lets a
 * format applied to a value column reach its pivot cells. Both trees come out
 * of every resolve, so pivot never has to save a copy of the primary tree to
 * restore later — it is simply recomputed.
 */
import type { CColDef, CColGroupDef } from '../types';
import { resolveColumnTree, type ColumnTree } from './columnTree';
import type { ResolvedColDef } from './propertyChain';
import { foldCalcColumnDefs } from './calcSlot';
import type { LiveColumnState, LiveColumnKey } from './liveColumnState';
import {
  synthesizePivotColumns,
  type PivotCellSpec,
  type PivotValueColumnSpec,
} from './pivotColumns';
import type { PivotKeyNode } from '../worker/passes/pivotPass';

/** Everything the pivot stage needs. `null` = not pivoting; stage 4 is skipped
 *  and the primary tree is what gets displayed. */
export interface PivotProjection<TRow> {
  keyTree: PivotKeyNode[];
  valueColumns: PivotValueColumnSpec[];
  pivotDefaultExpanded?: number;
  pivotRowTotals?: 'before' | 'after' | null;
  pivotColumnGroupTotals?: 'before' | 'after' | null;
  pivotGrandTotals?: boolean;
  processPivotResultColDef?: (colDef: CColDef<TRow>) => void;
  processPivotResultColGroupDef?: (groupDef: CColGroupDef<TRow>) => void;
}

export interface ResolveDisplayedColumnsInput<TRow> {
  hostDefs: readonly (CColDef<TRow> | CColGroupDef<TRow>)[];
  defaultColDef?: Partial<CColDef<TRow>>;
  columnTypes?: Record<string, Partial<CColDef<TRow>>>;
  /** Runtime width / hide / pinned. Omit to resolve declaration-only. */
  liveState?: LiveColumnState;
  /**
   * Per-property veto on the live value: `true` means something has
   * deliberately asked for a different value for that column and outranks what
   * the user did at runtime — an explicit calc override, or a host colDef whose
   * value CHANGED since the last resolve. A rebuild on its own is NOT such a
   * statement, which is why this is a predicate and not "does the def declare
   * the property".
   */
  liveStateVeto?: (colId: string, key: LiveColumnKey) => boolean;
  /** Synthesized group columns, re-registered so painter lookups by colId keep
   *  resolving after any resolve. */
  autoGroupColumns?: ReadonlyArray<ResolvedColDef<TRow>>;
  /** Stage 4. `null` when pivot is inactive. */
  pivot?: PivotProjection<TRow> | null;
}

export interface ResolveDisplayedColumnsResult<TRow> {
  /** What to paint: the pivot tree when pivoting, else the primary tree. */
  tree: ColumnTree;
  /**
   * The source columns, always — the pivot panel, `getColumnState`,
   * `workerColumns` and the revert path all need them while pivot is active.
   * Identical to `tree` when not pivoting (same reference).
   */
  primaryTree: ColumnTree;
  /** Leaf lookup for `tree`, including the auto-group columns. */
  defsMap: Map<string, ResolvedColDef<TRow>>;
  /** Synthetic colId → the pivot bucket it reads. Empty when not pivoting. */
  cellSpecById: Map<string, PivotCellSpec>;
  /** True when stage 4 ran and `tree` is the cross-tab. */
  pivoted: boolean;
}

const EMPTY_CELL_SPECS: Map<string, PivotCellSpec> = new Map();

export function resolveDisplayedColumns<TRow>(
  input: ResolveDisplayedColumnsInput<TRow>,
): ResolveDisplayedColumnsResult<TRow> {
  // ── 1 + 2: declaration, folded with calc overrides / templates ──────────
  const folded = foldCalcColumnDefs<CColDef<TRow> | CColGroupDef<TRow>>(
    input.hostDefs as (CColDef<TRow> | CColGroupDef<TRow>)[],
  );
  const primaryTree = resolveColumnTree<TRow>(
    folded,
    input.defaultColDef,
    input.columnTypes,
  );

  // ── 3: live runtime state ───────────────────────────────────────────────
  const primaryLeaves = primaryTree.leafById as Map<string, ResolvedColDef<TRow>>;
  if (input.liveState) {
    // Drop state for columns that no longer exist, so a colId that returns
    // later (a provider rebind, a pivot toggle) does not inherit a past life.
    input.liveState.prune(primaryLeaves.keys());
    input.liveState.applyTo(
      primaryLeaves.values() as unknown as Iterable<{ colId: string }>,
      input.liveStateVeto,
    );
  }

  const withAutoGroups = (
    map: Map<string, ResolvedColDef<TRow>>,
  ): Map<string, ResolvedColDef<TRow>> => {
    for (const col of input.autoGroupColumns ?? []) map.set(col.colId, col);
    return map;
  };

  // ── 4: pivot projection, built FROM the stage-3 leaves ──────────────────
  const pivot = input.pivot;
  if (!pivot || pivot.valueColumns.length === 0) {
    return {
      tree: primaryTree,
      primaryTree,
      defsMap: withAutoGroups(primaryLeaves),
      cellSpecById: EMPTY_CELL_SPECS,
      pivoted: false,
    };
  }

  const { defs, cellSpecById } = synthesizePivotColumns<TRow>({
    keyTree: pivot.keyTree,
    valueColumns: pivot.valueColumns,
    pivotDefaultExpanded: pivot.pivotDefaultExpanded,
    pivotRowTotals: pivot.pivotRowTotals,
    pivotColumnGroupTotals: pivot.pivotColumnGroupTotals,
    pivotGrandTotals: pivot.pivotGrandTotals,
    processPivotResultColDef: pivot.processPivotResultColDef,
    processPivotResultColGroupDef: pivot.processPivotResultColGroupDef,
  });
  const pivotTree = resolveColumnTree<TRow>(defs);

  return {
    tree: pivotTree,
    primaryTree,
    defsMap: withAutoGroups(pivotTree.leafById as Map<string, ResolvedColDef<TRow>>),
    cellSpecById,
    pivoted: true,
  };
}
