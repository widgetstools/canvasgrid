// Cycle 21e / Task 15 — the kernel bridge.
//
// `wireIntoKernel(grid, opts?)` wires @cgrid/rules' engines onto a
// CGrid instance via kernel's PUBLIC registration APIs, mirroring
// packages/format/src/bridge.ts:
//
//   1. constructs RuleEngine + AlertsEngine (seeded from opts),
//   2. registers the rule-engine adapter (grid.registerRuleEngine) —
//      the adapter threads grid.getThemeKind() into every eval ctx,
//   3. subscribes rowsChanged + cellValueChanged, builds RowChangeSets
//      (watched-column diffing), feeds both engines, converts
//      FlashDirectives into grid.flashCells calls, and schedules
//      engine.endTick() (+ throttled-alert flush) after the
//      post-transaction repaint,
//   4. seeds match counts from grid.forEachRow,
//   5. repaints on activeDurationMs expiry via grid.refresh().
//
// Kernel never runtime-imports @cgrid/rules; this module reaches into
// kernel only through the grid surface passed in (structural types —
// zero static kernel imports). Idempotent per grid instance via a
// `__rulesBridgeWired` marker that stores — and re-returns — the SAME
// engines object.

import type {
  AlertRule, ChangeRecord, RowChangeSet, WireRulesOptions,
} from './types';
import { RuleEngine } from './ruleEngine';
import { AlertsEngine } from './alerts/alertsEngine';

// ─── Kernel event payloads (structural mirrors of types/event.ts) ─────

interface RowsChangedEvent {
  added: Array<{ rowId: string; row: Record<string, unknown> }>;
  updated: Array<{
    rowId: string;
    row: Record<string, unknown>;
    oldRow: Record<string, unknown>;
  }>;
  removed: Array<{ rowId: string; row: Record<string, unknown> }>;
  source: 'transaction' | 'transactionAsync' | 'edit';
}

interface CellValueChangedEvent {
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
  data?: Record<string, unknown>;
}

/** Structural surface of the CGrid instance (or CGridApi) the bridge
 *  registers against. Type-only — no runtime kernel import; mirrors
 *  format's KernelGridSurface. NOTE: kernel's public repaint API is
 *  `refresh()` (types/api.ts:292) — there is no per-row refreshCells,
 *  so expiry repaints go through the rAF-coalesced full repaint. */
interface KernelGridSurface {
  registerRuleEngine(engine: unknown): void;
  on(type: string, handler: (event: never) => void): () => void;
  flashCells(params: {
    rowIds: string[];
    colIds?: string[];
    color?: string;
    mode?: 'fade' | 'pulse' | 'glow';
    flashDuration?: number;
  }): void;
  refresh(): void;
  forEachRow(fn: (rowId: string, row: Record<string, unknown>) => void): void;
  getThemeKind(): 'light' | 'dark';
  __rulesBridgeWired?: { rules: RuleEngine; alerts: AlertsEngine };
}

// ─── Exported helpers (unit-tested; also used by kernel test fixtures) ─

/** Cell-level diff of one updated row, restricted to the watched
 *  column union. Object.is semantics (NaN-safe, ±0 distinct). */
export function diffRows(
  rowId: string,
  oldRow: Record<string, unknown>,
  row: Record<string, unknown>,
  watched: ReadonlySet<string>,
): ChangeRecord[] {
  const cells: ChangeRecord[] = [];
  for (const colId of watched) {
    const oldValue = oldRow[colId];
    const newValue = row[colId];
    if (!Object.is(oldValue, newValue)) {
      cells.push({ rowId, colId, oldValue, newValue });
    }
  }
  return cells;
}

/** The colIds that need per-cell ChangeRecords:
 *
 *    style-rule watchedColIds        (diff-aware conditions + counts)
 *  ∪ alert relativeChange colId      (needs old/new pairs)
 *  ∪ alert dataChange columnIds      (restricted form fires per cell)
 *
 *  Unrestricted dataChange rules contribute NOTHING here: they
 *  evaluate the post-change ROW once per updated row (spec §4.3) —
 *  they need the row present in `updated`, not ChangeRecords, so no
 *  full-column diffing is ever forced. */
export function watchedColIdUnion(
  rules: RuleEngine,
  alertRules: AlertRule[],
): Set<string> {
  const watched = new Set<string>(rules.watchedColIds());
  for (const rule of alertRules) {
    if (!rule.enabled) continue;
    const t = rule.trigger;
    if (t.kind === 'relativeChange') {
      watched.add(t.colId);
    } else if (t.kind === 'dataChange' && t.columnIds) {
      for (const colId of t.columnIds) watched.add(colId);
    }
  }
  return watched;
}

// ─── Defaults ──────────────────────────────────────────────────────────

const defaultScheduler = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => fn());
  } else {
    setTimeout(fn, 0);
  }
};

const defaultNow = (): number => performance.now();

// ─── The bridge ────────────────────────────────────────────────────────

/**
 * Wire @cgrid/rules into a CGrid instance. Idempotent — re-calling on
 * an already-wired grid returns the SAME `{ rules, alerts }` object.
 */
export function wireIntoKernel(
  grid: unknown,
  opts?: WireRulesOptions,
): { rules: RuleEngine; alerts: AlertsEngine } {
  const g = grid as KernelGridSurface;
  if (g.__rulesBridgeWired) return g.__rulesBridgeWired;

  const now = opts?.now ?? defaultNow;
  const schedule = opts?.scheduleAfterRepaint ?? defaultScheduler;

  // 1. Engines, seeded from opts. setRules never throws — invalid
  //    rules are skipped + reported; the bridge surfaces skips on the
  //    console (hosts wanting SetRulesResult call setRules directly).
  const rules = new RuleEngine({ schema: opts?.schema, now });
  const alerts = new AlertsEngine({
    settings: opts?.alertsSettings,
    schema: opts?.schema,
    now,
  });
  if (opts?.rules) {
    for (const err of rules.setRules(opts.rules).errors) {
      console.warn(`[cgrid/rules] skipped rule '${err.ruleId}': ${err.message}`);
    }
  }
  if (opts?.alertRules) {
    for (const err of alerts.setRules(opts.alertRules).errors) {
      console.warn(`[cgrid/rules] skipped alert rule '${err.ruleId}': ${err.message}`);
    }
  }

  // 2. Rule-engine adapter. Kernel's paint path supplies row/rowId/
  //    colId; the LIVE theme comes from the grid so a theme flip never
  //    needs re-registration. Shape mirrors kernel's structural
  //    RuleEngineShape (core/ruleEngineSlot.ts, Task 10).
  g.registerRuleEngine({
    evaluateCell: (ctx: { row: Record<string, unknown>; rowId: string; colId: string | null }) =>
      rules.evaluateCell({ row: ctx.row, rowId: ctx.rowId, colId: ctx.colId, theme: g.getThemeKind() }),
    resolveRuleRef: (ruleId: string, ctx: { row: Record<string, unknown>; rowId: string; colId: string | null }) =>
      rules.resolveRuleRef(ruleId, { row: ctx.row, rowId: ctx.rowId, colId: ctx.colId, theme: g.getThemeKind() }),
  });

  // 3. Change feed. endTick is coalesced: one post-repaint callback
  //    per burst regardless of how many change sets arrive this tick.
  let endTickScheduled = false;
  const scheduleEndTick = (): void => {
    if (endTickScheduled) return;
    endTickScheduled = true;
    schedule(() => {
      endTickScheduled = false;
      rules.endTick();
      if (alerts.getSettings().evaluationMode === 'throttled') {
        alerts.flushThrottled();
      }
    });
  };

  const feed = (changes: RowChangeSet): void => {
    const directives = rules.applyChanges(changes);
    for (const d of directives) {
      g.flashCells({
        rowIds: [d.rowId],
        colIds: d.colIds ?? undefined, // null → whole row → omit
        color: d.color,
        mode: d.mode,
        flashDuration: d.durationMs,
      });
    }
    alerts.applyChanges(changes);
    scheduleEndTick();
  };

  // 3a. rowsChanged — transaction + async-flush paths. Edit commits
  //     are EXCLUDED here: the cellValueChanged path below owns them
  //     (exact oldValue/newValue, no diffing); handling both would
  //     double-feed every edit.
  //
  //     The SAME rowId can appear in multiple `updated` entries within
  //     one event (sequential diffs — the kernel may report an
  //     intermediate value as the 2nd entry's oldRow). Each entry gets
  //     its own diff against the watched-column union, and ALL
  //     resulting entries are concatenated in arrival order into
  //     RowChangeSet.updated — no per-rowId squashing, since alerts'
  //     relativeChange needs every intermediate old/new pair to
  //     compute deltas correctly.
  g.on('rowsChanged', ((e: unknown) => {
    const ev = e as RowsChangedEvent;
    if (ev.source === 'edit') return;
    const watched = watchedColIdUnion(rules, alerts.getRules());
    feed({
      added: ev.added,
      updated: ev.updated.map((u) => ({
        rowId: u.rowId,
        row: u.row,
        cells: diffRows(u.rowId, u.oldRow, u.row, watched),
      })),
      removed: ev.removed,
    });
  }) as never);

  // 3b. cellValueChanged — single-cell edit commits.
  g.on('cellValueChanged', ((e: unknown) => {
    const ev = e as CellValueChangedEvent;
    const row = ev.data ?? { [ev.colId]: ev.newValue };
    feed({
      added: [],
      updated: [{
        rowId: ev.rowId,
        row,
        cells: [{ rowId: ev.rowId, colId: ev.colId, oldValue: ev.oldValue, newValue: ev.newValue }],
      }],
      removed: [],
    });
  }) as never);

  // 4. Seed match counts from the current dataset.
  const seed: Array<{ rowId: string; row: Record<string, unknown> }> = [];
  g.forEachRow((rowId, row) => seed.push({ rowId, row }));
  rules.recount(seed);

  // 5. activeDurationMs expiry → repaint so expired matches drop
  //    their styles. refresh() is rAF-coalesced in the kernel, so a
  //    batch of simultaneous expiries costs one repaint.
  rules.onExpire(() => g.refresh());

  const wired = { rules, alerts };
  g.__rulesBridgeWired = wired;
  return wired;
}
