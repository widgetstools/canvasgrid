# Cycle 21e — `@cgrid/rules` (Rule Engine + Conditional Styling + Alerts Core) — Design

**Date:** 2026-07-01
**Parent brief:** [Cycle 21 decision doc](../plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) §4.4
**Source requirements:** `docs/starui-customizer/03-conditional-styling.md`, `docs/starui-customizer/04-alerts.md`, `docs/starui-customizer-ui/04-conditional-styling.md`, `docs/starui-customizer-ui/05-alerts.md`
**Depends on:** `@cgrid/expression` (Cycle 21b, PR #93), `@cgrid/format` (Cycle 21c, PR #94)
**Peers (not blockers):** `@cgrid/calc` (Cycle 21d) — aggregate/`PREV()` expressions inside rule conditions stay reserved (`not-yet-implemented`) until 21d lands.

---

## §1 Scope & non-goals

### 1.1 In scope — everything the parent brief §4.4 specifies

1. **Rule types** — `ConditionalStyleRule`, `IndicatorRule`, `AlertRule`. Style/indicator rules share `{ id, name, enabled, priority, condition, scope }`; alert rules carry `{ severity, trigger, message, channels, debounceMs }`.
2. **Rule engine** — compiles conditions once via `@cgrid/expression`, evaluates per cell/row in priority order, folds style actions into a single per-cell result consumed by the kernel paint pipeline.
3. **Diff-aware conditions** — `[col.old]` / `[col.new]` references resolve against a tick-scoped diff map (AST-rewrite strategy, §3.4).
4. **Live match count** — `engine.matchCount(ruleId): number` over the full current dataset; full recount on rule change, incremental on transactions.
5. **Flash on activation** — per-rule `FlashConfig` (`fade`/`pulse`/`glow`, per-rule color + duration) driving kernel `flashCells` with new per-call overrides.
6. **Indicator badges** — per-rule Lucide icon + color + target (`cell` / `row-start` / `row-end`) + position (`before` / `after`), folded into the kernel `cellIcon` paint channel.
7. **Per-rule value formatter** — a matching style rule may attach a format-DSL string; matching cells render through that program instead of the ColDef formatter.
8. **`activeDurationMs` auto-expire** — a rule match can be time-boxed ("blink on change"); min-heap expiry scheduler with one coalesced timer; expiry repaints affected cells.
9. **Theme-aware styles** — `{ light?, dark? }` style slices; the kernel bridge passes the active theme kind into evaluation context.
10. **Alerts core** — three trigger kinds (`dataChange` expression, `relativeChange` percent/absolute/any + direction, `rowChange` added/removed), four severities, `{rule}/{rowId}/{column}/{value}/{prev}` message templating, per-rule debounce + global token bucket, `realtime`/`throttled`/`paused` evaluation modes, bounded history ring with unread count, `alerts.onAlert(fn): Unsubscribe`. Channel *routing* stays in host (§8 of parent brief) — cgrid emits `AlertEvent` with the rule's requested channels; it never renders a toast.
11. **`rule:<ruleId>` resolution in `@cgrid/format`** — the Cycle 21c reserve gets its resolver: `FormatEvalContext` gains an optional `resolveRuleRef` accessor; `tier1/resolver.ts` consults it for `RuleRefNode`s.
12. **Kernel bridge** — `wireIntoKernel(grid, opts?)` mirroring `@cgrid/format`'s bridge: rule-engine DI slot, event wiring, format rule-ref threading. Idempotent. Kernel never runtime-imports `@cgrid/rules`.
13. **Format double-eval memoization** — carried Minor from Cycle 21c final review: `formatText` + `resolveStyle` + `resolveIcon` each re-tokenize per paint; kernel memoizes per `(program, rowId, colId, value)` paint pass.
14. **Showcase demo + E2E** — conditional-styling feature page (rules over ticking data: styles, flash, indicators, match counts) and alerts feature page (all three trigger kinds, severity chips, history); Playwright specs for both.

### 1.2 Non-goals (explicit out-of-scope)

- **Customizer panels** (rule editor UI, alert editor UI) — Cycle 21i. This cycle ships the engine + demo wiring only.
- **Plus/minus nudge rules** (`docs/starui-customizer/14-plus-minus.md`) — keyboard-edit territory: `suppressKeyboardEvent` kernel hook + `@cgrid/edit` ops cycle. Not a `@cgrid/rules` concern despite the "rules" name in that doc.
- **Aggregate / `PREV()` conditions** — `SUM([x]) > 0` in a rule condition surfaces 21b's `not-yet-implemented` compile error verbatim; ships in Cycle 21d.
- **Worker-side rule evaluation + typed-array style channel** (parent §7.1) — same posture as Cycle 21c: L7 is a deployment policy on downstream consumers; this package is thread-agnostic. The style-channel rearchitecture is Cycle 20 capstone territory. Justification in §2.4.
- **Module-scoped state API** (`getModuleState('styling-rules')`, parent §4.1) — a kernel-wide refactor touching every module; not needed for rules to function. Engines expose serializable `getRules()/setRules()` + `getSettings()/setSettings()`; hosts persist those snapshots. When the module-state API lands (kernel cycle), rules registers as a module.
- **Alert channel routing** — toast/OS-notification/OpenFin rendering stays in host per parent §8.
- **Excel export of rule styles** — `@cgrid/export` (Cycle 21h) reads resolved rule styles then.

---

## §2 Architecture

### 2.1 Dependency-graph position

```
rules → kernel (peerDep, bridge-only runtime calls), expression (dep), format (dep)
```

- `@cgrid/rules` imports `@cgrid/expression` (parse/compile/evaluate/validate conditions) and `@cgrid/format` (compile per-rule `valueFormatter` strings) as real dependencies.
- `@cgrid/kernel` is a **peerDependency**: the bridge calls public grid registration APIs on an instance passed in; zero static kernel imports in `packages/rules/src/**` (structural interfaces only, mirroring `packages/format/src/bridge.ts:24-30`).
- `@cgrid/kernel` gains `@cgrid/rules` as **devDependency only** (type resolution for tests), zero runtime imports — DI slot with structural types, exactly like `core/formatCompilerSlot.ts`.

### 2.2 `@cgrid/rules` source layout

```
packages/rules/
  src/
    types.ts              — all public types (§4.1)
    conditionCompiler.ts  — condition string → CompiledCondition (parse, .old/.new AST rewrite, compile, cache)
    ruleEngine.ts         — RuleEngine class (§4.2)
    expiryHeap.ts         — min-heap of (deadline, rowId, colId?, ruleId) with coalesced timer
    matchCounter.ts       — full-scan + incremental count bookkeeping
    alerts/
      types.ts            — re-exported alert types (co-located for cohesion)
      messageTemplate.ts  — renderMessage(template, ctx) — {rule}/{rowId}/{column}/{value}/{prev}
      tokenBucket.ts      — global rate limiter (maxNotificationsPerSecond)
      alertsEngine.ts     — AlertsEngine class (§4.3)
    bridge.ts             — wireIntoKernel(grid, opts?) (§5)
    index.ts              — public re-exports (§4.1)
  tests/                  — mirrors src/ (vitest, node env, coverage-v8)
  vitest.config.ts
  package.json            — deps: @cgrid/expression, @cgrid/format; peer: @cgrid/kernel
  README.md
```

### 2.3 `@cgrid/kernel` diff footprint (surgical, all slot-gated)

New files:
- `src/core/ruleEngineSlot.ts` — DI slot: `registerRuleEngine(engine)`, `getRuleEngine()`, structural `RuleEngineShape` + `RuleCellPatchShape` type aliases.

Touched files:
- `src/core/propertyChain.ts` — `applyCellProps` folds the rule style patch between cellClassRules variants and function-form `cellStyle` (§5.2); rule `valueFormatter` override in the formatted-text path; format-program **memo** for the triple eval (§5.5).
- `src/renderer/painters/byRows.ts` — rule indicator icon fold into the `cellIcon` paint path; per-cell flash-color override consult (§5.3).
- `src/cgrid.ts` — `registerRuleEngine` public method; `rowsChanged` event emission from the `rowDataById` transaction sync (listener-gated, §5.1); `forEachRow(fn)` public iteration API; `getThemeKind()` accessor.
- `src/types/api.ts` / `src/types/event.ts` / `src/types/column.ts` — API + event type additions; `FlashCellsParams` gains `flashDuration? / color? / mode?` (the "reserved for a follow-up patch" comment at `types/column.ts:47-49` is this cycle).

`packages/format` touched files:
- `src/types.ts` — `FormatEvalContext.resolveRuleRef?: (ruleId: string) => string | null`.
- `src/tier1/resolver.ts` — `RuleRefNode` resolution via the accessor (null-safe when absent — existing behavior preserved).

### 2.4 Threading posture (mirrors Cycle 21c)

The kernel's worker owns the canonical data model, but main thread maintains a complete `rowDataById: Map<string, TRow>` mirror (`cgrid.ts:2648`, synced by `setRowData` + all transaction paths since Cycle 7 / Task 8). Format programs already evaluate main-side at paint over visible rows. Rules follow the same shape:

- **Styling** evaluates lazily at paint time for visible cells only (bounded by viewport, same cost class as format eval).
- **Match counts + alerts** evaluate eagerly over `rowDataById` / change records (main-side, off the paint path).
- The package itself is **thread-agnostic** — pure functions + plain-JSON rule defs (structuredClone-safe), so a future worker deployment (Cycle 20 style channel) can move evaluation without API change.

---

## §3 Rule model + condition semantics

### 3.1 Rule shapes (exact — plan Task 1 copies these verbatim)

```ts
import type { Loc } from '@cgrid/expression';

export type ThemeKind = 'light' | 'dark';

export interface StyleSlice {
  color?: string;
  backgroundColor?: string;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  borderColor?: string;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
}

/** Theme-aware style: `base` applies to both themes; `light`/`dark`
 *  slices override per-property on top of `base`. */
export interface ThemeAwareStyle {
  base?: StyleSlice;
  light?: StyleSlice;
  dark?: StyleSlice;
}

export interface FlashConfig {
  enabled: boolean;
  target: 'cell' | 'row';
  mode: 'fade' | 'pulse' | 'glow';
  /** CSS color; drives the kernel flash blend for this rule's activations. */
  color: string;
  durationMs: number;
}

export interface RuleIndicator {
  /** Lucide icon name resolved through the kernel icon registry. */
  iconName: string;
  color: string;
  target: 'cell' | 'row-start' | 'row-end';
  position: 'before' | 'after';
}

export type RuleScope =
  | { kind: 'cell'; columnIds: string[] }
  | { kind: 'row' };

export interface RuleBase {
  id: string;
  name: string;
  enabled: boolean;
  /** Lower applies first; later (higher) rules override per-property on conflict. */
  priority: number;
  /** Boolean expression over row fields; supports `[col]`, `[col.old]`, `[col.new]`. */
  condition: string;
  scope: RuleScope;
}

export interface ConditionalStyleRule extends RuleBase {
  kind: 'style';
  style: ThemeAwareStyle;
  flash?: FlashConfig;
  indicator?: RuleIndicator;
  /** Format-DSL string (any tier @cgrid/format compiles); matching cells
   *  render through this program instead of the ColDef formatter. */
  valueFormatter?: string;
  /** Auto-expire: the match stays active this long after activation, then
   *  drops (blink-on-change UX). Activation = condition transitions false→true
   *  for a (rowId, colId) via a change record. */
  activeDurationMs?: number;
}

export interface IndicatorRule extends RuleBase {
  kind: 'indicator';
  indicator: RuleIndicator;
}

export type StyleRule = ConditionalStyleRule | IndicatorRule;
```

### 3.2 Alert shapes

```ts
export type AlertSeverity = 'info' | 'success' | 'warning' | 'critical';
export type AlertChannel = 'toast' | 'badge' | 'openfin';

export type AlertTrigger =
  | { kind: 'dataChange'; expression: string; columnIds?: string[] }
  | {
      kind: 'relativeChange';
      columnId: string;
      mode: 'PERCENT_CHANGE' | 'ABSOLUTE_CHANGE' | 'ANY_CHANGE';
      /** Required for PERCENT_CHANGE (percent points) and ABSOLUTE_CHANGE; ignored for ANY_CHANGE. */
      threshold: number;
      direction: 'up' | 'down' | 'both';
    }
  | { kind: 'rowChange'; mode: 'ROW_ADDED' | 'ROW_REMOVED' };

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  severity: AlertSeverity;
  trigger: AlertTrigger;
  /** Template with {rule} {rowId} {column} {value} {prev} placeholders. */
  message: string;
  channels: AlertChannel[];
  /** Same rule won't fire twice for the same rowId within this window.
   *  0/undefined → settings.defaultDebounceMs. */
  debounceMs?: number;
}

export interface AlertEvent {
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  /** Rendered message (placeholders substituted). */
  message: string;
  rowId: string;
  /** Column that triggered (dataChange restricted / relativeChange); null for rowChange + unrestricted dataChange. */
  colId: string | null;
  value: unknown;
  prev: unknown;
  channels: AlertChannel[];
  /** Engine-assigned monotonic sequence (not wall-clock; hosts stamp their own). */
  seq: number;
}

export interface AlertsSettings {
  enabled: boolean;                       // global kill-switch
  defaultDebounceMs: number;              // default 1000
  maxNotificationsPerSecond: number;      // global token bucket, default 10
  historyLimit: number;                   // ring buffer cap, default 200
  enabledChannels: Record<AlertChannel, boolean>;
  evaluationMode: 'realtime' | 'throttled' | 'paused';
}
```

Defaults: `{ enabled: true, defaultDebounceMs: 1000, maxNotificationsPerSecond: 10, historyLimit: 200, enabledChannels: { toast: true, badge: true, openfin: true }, evaluationMode: 'realtime' }`.

### 3.3 Condition language

Conditions are `@cgrid/expression` boolean predicates. Compilation: `parse(condition)` → AST rewrite (§3.4) → `compile(ast)` → cached `Compiled`. Errors surface as `RuleValidationError { ruleId, code, message, loc }` where `code` is the underlying expression error code (`'parse' | 'unknown-fn' | 'arity' | 'not-yet-implemented'`). `setRules` never throws: invalid rules are skipped (treated as non-matching) and reported in the return value.

Truthiness: the compiled result is coerced with `res === true` — **strict boolean**. A condition returning a number/string does not match (documented; prevents accidental `[price]` "match everything nonzero" rules). `EvalError` thrown during evaluation → rule treated as non-matching for that cell (never breaks paint), error counted on the rule's `evalErrorCount` diagnostic.

### 3.4 Diff-aware references — `[col.old]` / `[col.new]`

`[price.old]` parses as `FieldNode { path: ['price', 'old'] }` — indistinguishable from a nested-object read. The condition compiler walks the AST post-parse and rewrites any `FieldNode` whose path is exactly `[<colId>, 'old']` or `[<colId>, 'new']` **when `<colId>` is a known column** (schema passed to the compiler):

- `['price', 'old']` → `['__cgridDiff', 'price', 'old']`
- `['price', 'new']` → `['price']` (current row value IS the new value)

At evaluation, the engine injects `__cgridDiff` into the eval row: `{ ...row, __cgridDiff: diffMapForRow }` where `diffMapForRow = { [colId]: { old: unknown } }`. Rows without a pending diff evaluate `[col.old]` to `null` (expression field reads are null-safe) — so `[price.old] != null AND [price] > [price.old]` is the canonical "went up this tick" condition.

The diff map is **tick-scoped** (parent §7.4): populated from change records, cleared after the transaction's repaint completes (macro-task flush). Rules whose conditions reference `.old` are flagged `diffAware: true` at compile; the engine only re-evaluates them against cells present in the current diff map (they can never match a quiescent cell).

### 3.5 Precedence + folding

Within rules: sort by `priority` ascending, stable by array order. Apply matching rules in that order; each matching rule's resolved `StyleSlice` merges per-property over the accumulated patch (later = higher priority number wins on conflicts — CSS-cascade semantics, verbatim from `starui-customizer/03-conditional-styling.md` "lower fires first"). Indicators: last matching indicator wins (one icon slot per cell). Value formatter: last matching rule with a `valueFormatter` wins.

Against the kernel style stack (`propertyChain.applyCellProps`), the folded rule patch applies **after** cellClassRules theme variants and **before** function-form `cellStyle`:

```
theme defaults → totals lift → static cellStyle → cellClass/cellClassRules variants
  → ★ rule-engine patch ★ → function-form cellStyle → textTransform
```

Rationale: rules are data-driven presentation and should beat declarative class styling, but an explicit per-cell `cellStyle` function is the app's last word (same reasoning that put format-derived styles below function-form `cellStyle` in 21c).

Scope semantics: `row` scope → the patch applies to every cell of a matching row (condition evaluated once per row, cached per paint pass). `cell` scope → condition evaluated per (row, colId ∈ columnIds); non-listed columns unaffected.

---

## §4 Public API surface

### 4.1 `@cgrid/rules` exports

```ts
// classes
export { RuleEngine } from './ruleEngine';
export { AlertsEngine } from './alerts/alertsEngine';
// bridge
export { wireIntoKernel } from './bridge';
// helpers (exported for customizer / tests)
export { compileCondition, validateRule } from './conditionCompiler';
export { renderMessage } from './alerts/messageTemplate';
// types
export type {
  ThemeKind, StyleSlice, ThemeAwareStyle, FlashConfig, RuleIndicator,
  RuleScope, RuleBase, ConditionalStyleRule, IndicatorRule, StyleRule,
  AlertSeverity, AlertChannel, AlertTrigger, AlertRule, AlertEvent, AlertsSettings,
  RuleEvalContext, RuleCellResult, RuleValidationError, SetRulesResult,
  ChangeRecord, RowChangeSet, WireRulesOptions, Unsubscribe,
} from './types';
```

### 4.2 `RuleEngine`

```ts
export interface RuleEvalContext {
  row: Record<string, unknown>;
  rowId: string;
  /** null → row-scope evaluation (no cell column). */
  colId: string | null;
  theme: ThemeKind;
}

export interface RuleCellResult {
  /** Matched rule ids in application order (priority asc). Empty array = no match. */
  matched: string[];
  /** Folded flat style for the active theme; null when no style rule matched. */
  style: StyleSlice | null;
  indicator: RuleIndicator | null;
  /** Compiled program from the winning rule's valueFormatter; null when none. */
  formatProgram: FormatProgram | null;
}

export interface RuleValidationError {
  ruleId: string;
  code: 'parse' | 'unknown-fn' | 'arity' | 'not-yet-implemented' | 'bad-shape' | 'format-compile';
  message: string;
  loc: Loc | null;
}

export interface SetRulesResult { ok: boolean; errors: RuleValidationError[]; }

export interface ChangeRecord {
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface RowChangeSet {
  added: Array<{ rowId: string; row: Record<string, unknown> }>;
  updated: Array<{ rowId: string; row: Record<string, unknown>; cells: ChangeRecord[] }>;
  removed: Array<{ rowId: string; row: Record<string, unknown> }>;
}

export type Unsubscribe = () => void;

export class RuleEngine {
  constructor(opts?: { schema?: import('@cgrid/expression').Schema });

  /** Replace the rule set. Invalid rules are skipped + reported; valid rules apply. */
  setRules(rules: StyleRule[]): SetRulesResult;
  getRules(): StyleRule[];

  /** Paint-path entry. Pure w.r.t. engine state; cheap when no rules target the cell. */
  evaluateCell(ctx: RuleEvalContext): RuleCellResult;

  /** Live "APP N" count over the dataset last supplied via recount/applyChanges. */
  matchCount(ruleId: string): number;

  /** rule:<ruleId> color accessor for @cgrid/format. Returns the rule's resolved
   *  `style.color` (theme-resolved) when the rule matches ctx, else null. */
  resolveRuleRef(ruleId: string, ctx: RuleEvalContext): string | null;

  /** Full-dataset scan (rule change / initial wire). Rebuilds all match counts. */
  recount(rows: Iterable<{ rowId: string; row: Record<string, unknown> }>): void;

  /** Transaction feed: updates diff map (tick-scoped), match counts (incremental),
   *  activeDuration activations, and returns flash directives for the bridge. */
  applyChanges(changes: RowChangeSet): FlashDirective[];

  /** Clears the tick-scoped diff map. Bridge calls after the post-transaction repaint. */
  endTick(): void;

  /** activeDurationMs expiries → bridge repaints those cells. */
  onExpire(fn: (cells: Array<{ rowId: string; colId: string | null }>) => void): Unsubscribe;

  /** Diagnostics for the customizer: eval errors per rule since last setRules. */
  evalErrorCount(ruleId: string): number;
}

export interface FlashDirective {
  rowId: string;
  colIds: string[] | null;   // null → whole row
  color: string;
  mode: 'fade' | 'pulse' | 'glow';
  durationMs: number;
}
```

`evaluateCell` hot-path guarantees: rules pre-indexed by colId (cell scope) and a row-scope list; per-paint-pass row-scope memo keyed `(rowId, dataVersion)`; zero allocation when no rule targets the cell (shared frozen `EMPTY_RESULT`).

### 4.3 `AlertsEngine`

```ts
export class AlertsEngine {
  constructor(opts?: { settings?: Partial<AlertsSettings>; schema?: import('@cgrid/expression').Schema });

  setRules(rules: AlertRule[]): SetRulesResult;
  getRules(): AlertRule[];
  getSettings(): AlertsSettings;
  setSettings(patch: Partial<AlertsSettings>): void;

  /** Transaction feed. Evaluates triggers over the change set, applies debounce +
   *  token bucket + channel enablement, emits AlertEvents to subscribers. */
  applyChanges(changes: RowChangeSet): void;

  onAlert(fn: (alert: AlertEvent) => void): Unsubscribe;

  /** Bounded history ring (settings.historyLimit), newest first. */
  getHistory(): AlertEvent[];
  unreadCount(): number;
  markAllRead(): void;

  /** throttled mode: bridge calls once per animation frame to flush the batch. */
  flushThrottled(): void;
}
```

Trigger semantics over a `RowChangeSet`:
- `dataChange`: for each updated row — if `columnIds` given, fire per changed cell whose colId ∈ columnIds and expression is true against the post-change row (colId on the event = that cell); else evaluate once per updated row (colId = null). Added rows also evaluate (a new row can immediately satisfy a data condition); removed rows never.
- `relativeChange`: for each `ChangeRecord` with `colId === trigger.columnId` and numeric old + new: `ANY_CHANGE` fires on any old ≠ new; `ABSOLUTE_CHANGE` on `|new − old| >= threshold`; `PERCENT_CHANGE` on `|new − old| / |old| * 100 >= threshold` (old = 0 → treated as no percent change). `direction` filters sign (`up`: new > old, `down`: new < old).
- `rowChange`: `ROW_ADDED` fires per added row; `ROW_REMOVED` per removed row (value = prev = null; colId = null).

Debounce key: `(ruleId, rowId)`. Token bucket: capacity = `maxNotificationsPerSecond`, refill continuous, excess drops silently (dropped count exposed as `droppedCount()` diagnostic). `evaluationMode`: `paused` → `applyChanges` is a no-op; `throttled` → change sets queue and coalesce until `flushThrottled()`; `realtime` → immediate. Events with all channels disabled are suppressed before debounce accounting.

### 4.4 Message templating

`renderMessage(template, ctx)` — single-pass string replace of `{rule}`, `{rowId}`, `{column}`, `{value}`, `{prev}`. Null/undefined render as `''`; non-string values via `String(...)`. Unknown placeholders pass through verbatim (no error). No expression evaluation inside templates (cheap by design, per StarUI doc 04).

---

## §5 Kernel bridge (surgical additions)

### 5.1 `rowsChanged` event (listener-gated)

New kernel event emitted wherever `rowDataById` syncs (`setRowData` full replace excluded; `applyTransaction` result path + async flush path + edit commit path included):

```ts
| {
    type: 'rowsChanged';
    added: Array<{ rowId: string; row: TRow }>;
    updated: Array<{ rowId: string; row: TRow; oldRow: TRow }>;
    removed: Array<{ rowId: string; row: TRow }>;
    source: 'transaction' | 'transactionAsync' | 'edit';
  }
```

Cost-gated: the old-row snapshot (shallow clone of the previous `rowDataById` entry before overwrite) is taken **only when at least one `rowsChanged` listener is registered** (`events.hasListener('rowsChanged')` — small addition to `TypedEventEmitter`). Zero overhead for non-rules apps. Cell-level diffing stays in `@cgrid/rules` (`diffRows(oldRow, row, watchedColIds)` — only columns any rule references are compared).

### 5.2 Rule style fold in `applyCellProps`

`core/ruleEngineSlot.ts` mirrors `formatCompilerSlot.ts`:

```ts
export interface RuleEngineShape {
  evaluateCell(ctx: { row: unknown; rowId: string; colId: string | null; theme: 'light' | 'dark' }): {
    matched: string[];
    style: {
      color?: string; backgroundColor?: string;
      fontWeight?: 'normal' | 'bold' | number; fontStyle?: 'normal' | 'italic';
      textDecoration?: string; borderColor?: string; borderStyle?: string;
    } | null;
    indicator: { iconName: string; color: string; target: string; position: string } | null;
    formatProgram: unknown | null;
  };
  resolveRuleRef(ruleId: string, ctx: { row: unknown; rowId: string; colId: string | null; theme: 'light' | 'dark' }): string | null;
}
export function registerRuleEngine(engine: RuleEngineShape): void;
export function getRuleEngine(): RuleEngineShape | null;
```

`applyCellProps` (data cells only — never headers/totals/group rows in this cycle) consults the slot at the fold point defined in §3.5, translating `StyleSlice` → paint slots: `color→fg`, `backgroundColor→bg`, `fontWeight/fontStyle→font` string rebuild, `textDecoration→content decoration`, `borderColor/borderStyle→border`. Slot absent (or `matched` empty) → byte-identical behavior to today.

### 5.3 Indicator + flash paint integration

- Indicator: when the rule result carries an indicator with `target: 'cell'`, byRows paints it through the existing `cellIcon` Path2D path (position `before`→leading, `after`→trailing), rule color. `row-start`/`row-end` targets resolve to the first/last visible data column of the matching row. ColDef `cellIcon` yields to the rule indicator when both present (rules are more specific).
- Flash: `FlashCellsParams` gains `{ flashDuration?: number; color?: string; mode?: 'fade' | 'pulse' | 'glow' }`. The bridge converts `FlashDirective[]` from `engine.applyChanges` into `grid.flashCells` calls. byRows consults a per-cell flash-override registry (populated by `flashCells` when `color`/`mode` present) instead of the global `theme.flashFromColor`; `pulse`/`glow` map to alpha curves (pulse: 2-cycle sine; glow: sustained plateau then fade) in the existing flash-alpha machinery.

### 5.4 `wireIntoKernel(grid, opts?)` in `@cgrid/rules`

```ts
export interface WireRulesOptions {
  rules?: StyleRule[];
  alertRules?: AlertRule[];
  alertsSettings?: Partial<AlertsSettings>;
  schema?: import('@cgrid/expression').Schema;
}
export function wireIntoKernel(
  grid: unknown,
  opts?: WireRulesOptions,
): { rules: RuleEngine; alerts: AlertsEngine };
```

Steps (idempotent via `__rulesBridgeWired`; re-call returns the existing engines):
1. Construct `RuleEngine` + `AlertsEngine` (seeded from opts).
2. `grid.registerRuleEngine(adapter)` — adapter threads `grid.getThemeKind()` into ctx.
3. Subscribe `rowsChanged` + `cellValueChanged`: build `RowChangeSet` (diff via watched columns; `source: 'edit'` rowsChanged skipped — `cellValueChanged` owns edits), feed both engines, issue flash directives via `grid.flashCells`, schedule `endTick()` post-repaint (microtask + rAF), `grid.refresh()` for indicator/count changes (kernel's rAF-coalesced repaint; no per-row `refreshCells` exists).
4. Seed match counts: `engine.recount(grid.forEachRow ...)` via the new iteration API.
5. Thread `resolveRuleRef` into format: the kernel paint path passes the rule slot's accessor into `FormatEvalContext` when building format eval contexts (kernel-side, since kernel owns the ctx construction — see §5.5).
6. `onExpire` → `grid.refresh()`.

### 5.5 Format integration + memoization

- `FormatEvalContext` gains `resolveRuleRef?: (ruleId: string) => string | null`. Kernel builds eval contexts in `propertyChain` (wrapped valueFormatter/cellStyle/cellIcon lambdas from `compileFormatSlots`); when the rule slot is registered, those contexts close over `(ruleId) => slot.resolveRuleRef(ruleId, cellCtx)`.
- `tier1/resolver.ts`: for each `RuleRefNode` in `Tier1Node.ruleRefs`, if `ctx.resolveRuleRef` present, the resolved color feeds the node's style channel (color or background per bracket key); absent → `null` (Cycle 21c behavior, existing test `tests/tier1/resolver.test.ts:74-83` updated to assert both branches).
- Memo (carried 21c Minor): `propertyChain` gains a per-cell format-eval memo — one `WeakMap<FormatProgramShape, { key: string; text; style; icon }>` keyed by `rowId\0colId\0String(value)\0theme`; `formatText`/`resolveStyle`/`resolveIcon` wrapper lambdas share a single underlying eval per paint pass. Invalidation: key mismatch (value/theme change) recomputes; rule-ref-dependent programs skip the memo (a matched-set change without value change must not serve stale colors — programs report `tiers.tier1 && hasRuleRefs` via a new `FormatProgramShape.hasRuleRefs?: boolean`).

---

## §6 Task decomposition preview (17 tasks, single PR, branch `cycle21e/rules`)

Phase A — scaffold: (1) types + skeletons + vitest config.
Phase B — engine core: (2) conditionCompiler + diff rewrite + validateRule, (3) RuleEngine evaluate/fold/theme, (4) matchCounter + recount/applyChanges + diff map, (5) expiryHeap + activeDuration + flash directives.
Phase C — alerts: (6) messageTemplate + tokenBucket + types, (7) AlertsEngine triggers + debounce + history, (8) evaluation modes + settings.
— intra-cycle self-review checkpoint —
Phase D — format plug-in: (9) FormatEvalContext.resolveRuleRef + tier1 resolver + hasRuleRefs.
Phase E — kernel: (10) ruleEngineSlot + registerRuleEngine + getThemeKind + forEachRow, (11) applyCellProps style fold, (12) rowsChanged event + emitter hasListener, (13) flash overrides (params + painter) , (14) indicator paint fold + rule valueFormatter override + format memo.
Phase F — bridge + demo + polish: (15) wireIntoKernel + integration tests, (16) showcase conditionalStyling + alerts features + E2E, (17) README + final verification gates.

## §7 Testing strategy + verification gates

- `@cgrid/rules` unit tests per module (vitest, node env): condition compile/rewrite table, fold precedence table, matchCount full+incremental parity (property: recount(rows) === counts after applyChanges stream), alert trigger matrix (3 kinds × direction × threshold edges), debounce/token-bucket timing (fake timers), template rendering, expiry heap ordering.
- Kernel new-code tests: slot registration, applyCellProps fold order (rule patch vs function cellStyle), rowsChanged gating (no listener → no snapshot; verified via spy on structuredClone/shallow copy path), flash param overrides, indicator paint config, memo correctness incl. hasRuleRefs bypass.
- Format tests: resolver with/without accessor; 21c reserve test updated, count `161 → 161+` (161 measured on `main` @ `28d2d5a`; the 158 in 21c's Task 20 notes predates its final-review commits).
- E2E: showcase `conditionalStyling.spec.ts` (rule styles visible on canvas via resolved-def assertions + screenshot probes, flash on tick, indicator icons, match-count text), `alerts.spec.ts` (toast-sim list driven by onAlert, severity filtering, debounce behavior under rapid ticks).
- Gates (Task 17): turbo typecheck 21/21 · lint clean · turbo build 13/13 · kernel `2399` baseline preserved + new (one known CPU-load-sensitive perf flake passes standalone) · format `161` baseline + new · expression `185/185` untouched · showcase E2E `109` baseline + new specs · kernel dist Δ < +2% · zero `@cgrid/rules` imports in kernel dist (grep) · no-restricted-syntax vocabulary clean.

## §8 Risks + mitigations

| Risk | Mitigation |
|---|---|
| Paint-path regression from rule eval | Slot-gated (null slot = today's code path); per-pass row-scope memo; rules indexed by colId; perf smoke vs 50k-row fixture in kernel tests |
| Diff-map lifecycle bugs (stale `.old` matches) | endTick() driven by bridge post-repaint hook; diff-aware rules only evaluated against diff-map members; tests for quiescent-cell behavior |
| `rowsChanged` snapshot cost on hot tick paths | Listener-gated; shallow clone only of updated rows; watched-column diffing in rules package |
| Rule-ref memo staleness | `hasRuleRefs` programs bypass memo (correctness over speed for that subset) |
| Flash mode/color plumbing destabilizes existing flash | New params optional; default path byte-identical; dedicated regression tests around `enableCellChangeFlash` |
| Alert storms on 60Hz ticks | Token bucket + per-rule debounce both default-on; `throttled` mode coalesces per frame |

## §9 Success criteria

1. All §1.1 features land in this cycle (no deferral); reserves honored (aggregates → 21d).
2. Apps not importing `@cgrid/rules`: byte-identical kernel behavior; all baselines green unmodified.
3. `rule:<ruleId>` in a composite fragment style resolves to live rule colors on a ticking grid (E2E-proven).
4. Alert pipeline: STOMP-driven relativeChange alerts render in the showcase demo with debounce visibly working.
5. Package is structuredClone-safe end-to-end (rules JSON, no closures in public types) — worker-ready for Cycle 20.

## §10 Resolved decisions (locked during design)

1. **21e = rules, not calc** — 21b/21c plan docs consistently reserve `rule:<ruleId>` for 21e and aggregates for 21d.
2. **Thread posture** — thread-agnostic package, main-side evaluation via kernel bridge (mirrors 21c L7 treatment); style channel deferred to Cycle 20.
3. **Diff refs via AST rewrite** (`__cgridDiff` injection), not row proxying — keeps expression package untouched.
4. **Strict-boolean condition truthiness** (`=== true`).
5. **Precedence**: priority asc, later overrides per-property; rule patch folds between cellClassRules and function cellStyle.
6. **IndicatorRule** = standalone badge rule (StarUI models indicators as a facet of style rules; parent brief names it a type — union covers both: `ConditionalStyleRule.indicator?` AND `IndicatorRule`).
7. **Plus/minus excluded** (edit-cycle scope).
8. **Module-state API excluded** (kernel-wide refactor; engines expose serializable state; documented non-goal, not layering violation — no kernel hook is being half-built).
9. **AlertEvent.seq not wall-clock** — engines stay Date-free (deterministic tests, workflow-resume-safe); hosts stamp receipt time.
10. **`rowsChanged` old-row capture listener-gated** — zero cost for non-rules apps.
