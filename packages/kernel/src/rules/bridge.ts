// Cycle 21e / Task 15 — the kernel bridge.
//
// `wireIntoKernel(grid, opts?)` wires @wellsfargo-starui/velocity-grid/rules' engines onto a
// VelocityGrid instance via kernel's PUBLIC registration APIs, mirroring
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
// Kernel never runtime-imports @wellsfargo-starui/velocity-grid/rules; this module reaches into
// kernel only through the grid surface passed in (structural types —
// zero static kernel imports). Idempotent per grid instance via a
// `__rulesBridgeWired` marker that stores — and re-returns — the SAME
// engines object.

import type {
  AlertRule, ChangeRecord, RowChangeSet, StyleRule, WireRulesOptions,
  AlertsSettings, AlertEvent,
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

/** Structural surface of the VelocityGrid instance (or VelocityGridApi) the bridge
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
  // Grid Layouts / Phase C (C1) — optional so a minimal grid surface (or a
  // pre-Grid-Layouts kernel) still wires; it just won't persist the rule set.
  registerStateModule?(module: StateModuleShape): () => void;
  notifyModuleStateChanged?(id: string): void;
  __rulesBridgeWired?: { rules: RuleEngine; alerts: AlertsEngine };
  // Public alerts CRUD (attached by wireIntoKernel — mirrors style-rule
  // VelocityGridApi surface without requiring a kernel bump for every host).
  getAlertRules?(): AlertRule[];
  addAlertRule?(rule: AlertRule): void;
  updateAlertRule?(id: string, patch: Partial<AlertRule>): void;
  deleteAlertRule?(id: string): void;
  getAlertsSettings?(): AlertsSettings;
  setAlertsSettings?(patch: Partial<AlertsSettings>): void;
  getAlertHistory?(): AlertEvent[];
  markAlertRead?(): void;
  clearAlertHistory?(): void;
  getAlertUnreadCount?(): number;
  onAlert?(fn: (alert: AlertEvent) => void): () => void;
  /**
   * Optional SSRM column-window hook (Perspective / sparse SSRM). Keeps
   * condition + alert watched cols in `columnKeys` so hydrate + paint
   * see fields referenced by rules even when scrolled out of the H-window.
   */
  setSsrmClientWatchedColumns?(ids: readonly string[]): void;
}

/** Structural mirror of kernel's `StateModule` (core/moduleState.ts) — a
 *  named, versioned, JSON-serializable slice folded into `GridState.modules`
 *  and ridden by getState/setState + persistState + layouts. Mirrors the
 *  calc bridge's StateModuleShape (packages/calc/src/bridge.ts). */
interface StateModuleShape {
  id: string;
  version: number;
  get(): unknown;
  set(data: unknown, version: number): void;
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
 * Wire @wellsfargo-starui/velocity-grid/rules into a VelocityGrid instance. Idempotent — re-calling on
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

  // setRules resets match counts and expects the caller to re-seed over the
  // current dataset — shared by the wire-time seed (step 4), the `rules`
  // state-module restore (step 6, C1), and the VelocityGridApi setRules op (C3).
  const reseedCounts = (): void => {
    const seed: Array<{ rowId: string; row: Record<string, unknown> }> = [];
    g.forEachRow((rowId, row) => seed.push({ rowId, row }));
    rules.recount(seed);
  };

  // Perspective SSRM activates expression-host column windowing; without
  // syncing watched cols, condition fields can be omitted from columnKeys
  // and paint-time evaluateCell sees incomplete rows.
  const syncSsrmWatchedColumns = (): void => {
    g.setSsrmClientWatchedColumns?.(
      [...watchedColIdUnion(rules, alerts.getRules())],
    );
  };

  // 2. Rule-engine adapter. Kernel's paint path supplies row/rowId/
  //    colId AND the per-frame theme kind (final-review fix: consume
  //    ctx.theme instead of calling grid.getThemeKind() per cell —
  //    classList allocation per visible cell at 60Hz). The grid call
  //    remains only as a fallback for callers that omit theme. Shape
  //    mirrors kernel's structural RuleEngineShape (core/ruleEngineSlot.ts).
  //    Grid Layouts / Phase C (C3) — getRules/setRules let the kernel's
  //    VelocityGridApi rule methods drive the engine's rule set imperatively
  //    (mirrors the calc provider's template ops); setRules re-seeds counts.
  g.registerRuleEngine({
    evaluateCell: (ctx: { row: Record<string, unknown>; rowId: string; colId: string | null; theme?: 'light' | 'dark' }) =>
      rules.evaluateCell({ row: ctx.row, rowId: ctx.rowId, colId: ctx.colId, theme: ctx.theme ?? g.getThemeKind() }),
    resolveRuleRef: (ruleId: string, ctx: { row: Record<string, unknown>; rowId: string; colId: string | null; theme?: 'light' | 'dark' }) =>
      rules.resolveRuleRef(ruleId, { row: ctx.row, rowId: ctx.rowId, colId: ctx.colId, theme: ctx.theme ?? g.getThemeKind() }),
    getRules: () => rules.getRules(),
    setRules: (next: StyleRule[]) => {
      for (const err of rules.setRules(Array.isArray(next) ? next : []).errors) {
        console.warn(`[cgrid/rules] skipped rule '${err.ruleId}': ${err.message}`);
      }
      reseedCounts();
      syncSsrmWatchedColumns();
      g.refresh();
    },
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

  // 4. Seed match counts from the current dataset (reseedCounts defined above).
  reseedCounts();
  syncSsrmWatchedColumns();

  // 5. activeDurationMs expiry → repaint so expired matches drop
  //    their styles. refresh() is rAF-coalesced in the kernel, so a
  //    batch of simultaneous expiries costs one repaint.
  rules.onExpire(() => g.refresh());

  // 6. Grid Layouts / Phase C (C1) — persist the conditional-styling rule
  //    set through the kernel module registry, so it rides getState/setState
  //    + persistState + layouts. LAYOUT-TIER: the id `rules` is NOT in the
  //    kernel's DEFAULT_GRID_LEVEL_MODULES → each layout owns its own rule
  //    set (spec §3.2/§6). REPLACE semantics — the snapshot fully defines the
  //    slice; on layout switch the kernel's clearAbsent path calls set(undefined)
  //    to drop the outgoing layout's rules. Mirrors the calc bridge's `calc`
  //    layout-tier module (Phase B / B1). Guarded so a grid surface without
  //    the registry simply doesn't persist rules. Alert rules stay grid-global
  //    (real-time notifications, opts-seeded) — not part of the layout model.
  g.registerStateModule?.({
    id: 'rules',
    version: 1,
    // getRules() is the full serializable set (incl. invalid + disabled).
    // Undefined → omitted from the snapshot (compact), matching the kernel's
    // empty-field convention and the calc bridge's modules.
    get: () => {
      const set = rules.getRules();
      return set.length > 0 ? set : undefined;
    },
    set: (data) => {
      const next = Array.isArray(data) ? (data as StyleRule[]) : [];
      // setRules never throws — invalid rules are skipped + reported; valid
      // ones apply (same surfacing as the opts seed above).
      for (const err of rules.setRules(next).errors) {
        console.warn(`[cgrid/rules] restore skipped rule '${err.ruleId}': ${err.message}`);
      }
      // setRules zeroed the counters — re-seed over the current dataset so the
      // live match counts reflect the restored rule set.
      reseedCounts();
      syncSsrmWatchedColumns();
    },
  });

  // 7. Dedicated `alerts` state module (Markets parity / worklog Phase 2) —
  //    rules + settings only. Notification history is session-only and MUST
  //    serialize as empty. Grid-level (see DEFAULT_GRID_LEVEL_MODULES) so
  //    layout switches do not wipe alert config.
  let alertsTouched =
    (opts?.alertRules?.length ?? 0) > 0
    || opts?.alertsSettings !== undefined;

  const notifyAlerts = (): void => {
    alertsTouched = true;
    g.notifyModuleStateChanged?.('alerts');
  };

  const replaceAlertRules = (next: AlertRule[]): void => {
    for (const err of alerts.setRules(next).errors) {
      console.warn(`[cgrid/rules] skipped alert rule '${err.ruleId}': ${err.message}`);
    }
    notifyAlerts();
    syncSsrmWatchedColumns();
  };

  g.getAlertRules = () => alerts.getRules();
  g.addAlertRule = (rule: AlertRule) => {
    const current = alerts.getRules();
    if (current.some((r) => r.id === rule.id)) return;
    replaceAlertRules([...current, rule]);
  };
  g.updateAlertRule = (id: string, patch: Partial<AlertRule>) => {
    const current = alerts.getRules();
    if (!current.some((r) => r.id === id)) return;
    replaceAlertRules(current.map((r) => (r.id === id ? { ...r, ...patch, id } : r)));
  };
  g.deleteAlertRule = (id: string) => {
    const current = alerts.getRules();
    const next = current.filter((r) => r.id !== id);
    if (next.length === current.length) return;
    replaceAlertRules(next);
  };
  g.getAlertsSettings = () => alerts.getSettings();
  g.setAlertsSettings = (patch) => {
    alerts.setSettings(patch);
    notifyAlerts();
  };
  g.getAlertHistory = () => alerts.getHistory();
  g.markAlertRead = () => { alerts.markAllRead(); };
  g.clearAlertHistory = () => { alerts.clearHistory(); };
  g.getAlertUnreadCount = () => alerts.unreadCount();
  g.onAlert = (fn) => alerts.onAlert(fn);

  g.registerStateModule?.({
    id: 'alerts',
    version: 1,
    get: () => {
      if (!alertsTouched && alerts.getRules().length === 0) return undefined;
      return {
        rules: alerts.getRules(),
        settings: alerts.getSettings(),
        history: [] as const,
      };
    },
    set: (data) => {
      const slice = (data && typeof data === 'object') ? data as {
        rules?: AlertRule[];
        settings?: Parameters<AlertsEngine['setSettings']>[0];
      } : null;
      if (slice?.settings) {
        alerts.setSettings(slice.settings);
        alertsTouched = true;
      }
      if (slice && Array.isArray(slice.rules)) {
        for (const err of alerts.setRules(slice.rules).errors) {
          console.warn(`[cgrid/rules] restore skipped alert '${err.ruleId}': ${err.message}`);
        }
        alertsTouched = true;
      } else if (data === undefined || data === null) {
        // Layout clearAbsent / empty restore — drop rules, keep settings.
        alerts.setRules([]);
      }
      // Never restore history — session-only.
      alerts.clearHistory();
      syncSsrmWatchedColumns();
    },
  });

  const wired = { rules, alerts };
  g.__rulesBridgeWired = wired;
  return wired;
}
