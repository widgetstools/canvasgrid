# Cycle 21e — `@wellsfargo-starui/velocity-grid-rules` (Rule Engine + Conditional Styling + Alerts Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@wellsfargo-starui/velocity-grid-rules` — condition-driven conditional styling (theme-aware styles, flash, indicator badges, per-rule value formatters, auto-expire), the alerts core (3 trigger kinds, severity, message templating, debounce + token bucket, history), live match counts — plus the kernel bridge and the `rule:<ruleId>` resolver that `@wellsfargo-starui/velocity-grid-format` reserved in Cycle 21c.

**Architecture:** Thread-agnostic engine package under `packages/rules/` depending on `@wellsfargo-starui/velocity-grid-expression` (condition compile/eval) and `@wellsfargo-starui/velocity-grid-format` (per-rule formatter compile), with `@wellsfargo-starui/velocity-grid` as peerDep touched only through public registration APIs from `bridge.ts`. Kernel gains a rule-engine DI slot (structural types, zero runtime imports — mirrors `core/formatCompilerSlot.ts`), a rule-patch fold point in `applyCellProps`, a listener-gated `rowsChanged` event off the `rowDataById` transaction sync, per-call flash overrides (`color`/`mode`/`flashDuration`), indicator paint fold, and a format-eval memo (carried 21c perf Minor). Conditions compile once via `expression.parse` → diff-aware AST rewrite (`[col.old]` → `__cgridDiff` injection) → `expression.compile`; styling evaluates lazily at paint for visible cells; match counts + alerts evaluate eagerly over change records on main. Full rationale: [design spec](../specs/2026-07-01-cycle-21e-rules-design.md).

**Tech Stack:** TypeScript 5.9 strict (extends repo `tsconfig.base.json`), Vitest 2.1 (node env + coverage-v8), turborepo (pipeline unchanged), npm workspaces, Playwright E2E in `apps/cgrid-showcase`.

## Global Constraints

Copied from the [Cycle 21e design spec](../specs/2026-07-01-cycle-21e-rules-design.md) and the parent Cycle 21 brief:

- **L1 (Cycle 21 §0) — No retroactive layering.** All kernel additions (slot, fold, rowsChanged, flash overrides, indicator paint, memo) land in this cycle. No hooks-only landings.
- **No feature deferral** (memory `feedback_no_feature_deferral.md`): every §1.1 spec feature lands this cycle. The only reserves are aggregate/`PREV()` rule conditions (Cycle 21d, already rejected by `@wellsfargo-starui/velocity-grid-expression` with `not-yet-implemented`). Plus/minus nudges and customizer panels are explicitly other cycles' features (spec §1.2), not deferrals from this one.
- **Dep-graph acyclic:** `@wellsfargo-starui/velocity-grid-rules` imports `@wellsfargo-starui/velocity-grid-expression` + `@wellsfargo-starui/velocity-grid-format` (deps) and calls `@wellsfargo-starui/velocity-grid` only via the grid instance passed to `wireIntoKernel` (peerDep; structural interfaces; zero static kernel imports in `packages/rules/src/**`). Kernel gets `@wellsfargo-starui/velocity-grid-rules` as devDependency ONLY (type resolution in tests); zero runtime imports — verified in Task 17 by grepping kernel dist.
- **Kernel behavioral compatibility:** apps that never call `wireIntoKernel` see byte-identical behavior. Kernel baseline `2399` unit tests remain PASS unmodified; new kernel tests add to that count.
- **Format baseline:** `packages/format` existing `161` tests stay green (161 measured on `main` @ `28d2d5a`; 21c's Task 20 note of 158 predates its final-review commits); Task 9 may UPDATE (not delete) the 21c reserve test `tests/tier1/resolver.test.ts` ("rule-ref node returns null") to cover both accessor-absent and accessor-present branches.
- **Expression untouched:** `packages/expression/**` not modified; `185/185` unchanged. The diff-aware rewrite happens in `@wellsfargo-starui/velocity-grid-rules` on the portable AST.
- **E2E baselines:** showcase `109` preserved + new `conditionalStyling`/`alerts` specs; positions `262` untouched (no positions changes this cycle beyond none).
- **rowId / colId vocabulary** (repo ESLint `no-restricted-syntax`): never `columnId`/`rowKey`/`columnKey` in new code. NOTE: the StarUI docs write `columnIds` in rule shapes — this plan's public types use `columnIds` on `RuleScope`/`AlertTrigger` ONLY as an array-of-colId field name; the linter rule targets `columnId` singular. Use `colId` for all singular identifiers.
- **CSP-safe:** no `new Function`/`eval` anywhere in `packages/rules/**` (closure composition via `@wellsfargo-starui/velocity-grid-expression`).
- **Date-free engines:** no `Date.now()` in `packages/rules/src/**` decision logic — engines take an injectable `now?: () => number` (default wraps `performance.now()` at the bridge layer) so tests are deterministic. `AlertEvent.seq` is a monotonic counter, not wall-clock.
- **Strict-boolean conditions:** a rule matches only when its compiled condition evaluates `=== true`.
- **One PR** for all 17 tasks. Feature branch `cycle21e/rules` off current `main`. Mirrors 21b/21c cadence.
- **Split-if-oversized:** implementer diff over ~500 LOC or ~150 test lines → reviewer flags mid-task split (pre-identified candidates: Task 3, 7, 14, 16).

## Preconditions (verified 2026-07-01)

- Cycle 21c merged (PR #94, `main` @ `28d2d5a`); Cycle 21b merged (PR #93).
- Baselines (measured on `main` @ `28d2d5a`, 2026-07-01): kernel `2399/2399` (one CPU-load-sensitive perf test can flake under parallel load; passes standalone), format `161/161`, expression `185/185` unit tests; showcase E2E `109`; turbo typecheck `21/21`, build `13/13`.
- `packages/rules/` scaffold present: `package.json` (deps kernel+expression+format — Task 1 corrects kernel to peerDep), `tsconfig.json`, `src/index.ts` (`export {};`), empty `tests/`.
- Design spec committed at `docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md`.
- Working tree has pre-existing untracked stragglers (`apps/cgrid-positions/src/*.js`, `apps/cgrid-showcase/src/**/*.js`, `packages/expression/coverage/`) — ignorable; do not touch except the specific showcase files Task 16 names.

## File Structure Overview

**`@wellsfargo-starui/velocity-grid-rules` — all new (except scaffold files overwritten):**

- `packages/rules/src/types.ts` — all public types (spec §3.1, §3.2, §4.2 verbatim).
- `packages/rules/src/conditionCompiler.ts` — `compileCondition`, `validateRule`, diff-aware AST rewrite, watched-column extraction.
- `packages/rules/src/ruleEngine.ts` — `RuleEngine` (evaluateCell fold, theme resolution, resolveRuleRef, rule indexes, row-scope memo).
- `packages/rules/src/matchCounter.ts` — full-scan + incremental match-count bookkeeping.
- `packages/rules/src/expiryHeap.ts` — min-heap of activation deadlines, coalesced timer, injectable clock.
- `packages/rules/src/alerts/messageTemplate.ts` — `renderMessage`.
- `packages/rules/src/alerts/tokenBucket.ts` — continuous-refill rate limiter.
- `packages/rules/src/alerts/alertsEngine.ts` — `AlertsEngine`.
- `packages/rules/src/bridge.ts` — `wireIntoKernel(grid, opts?)`.
- `packages/rules/src/index.ts` — public re-exports (spec §4.1 exact).
- `packages/rules/vitest.config.ts`, `packages/rules/README.md`.
- `packages/rules/tests/` — `conditionCompiler.test.ts`, `ruleEngine.test.ts`, `matchCounter.test.ts`, `expiryHeap.test.ts`, `alerts/messageTemplate.test.ts`, `alerts/tokenBucket.test.ts`, `alerts/alertsEngine.test.ts`, `bridge.test.ts`.

**`@wellsfargo-starui/velocity-grid-format` — touched (Task 9):**

- `packages/format/src/types.ts` — `FormatEvalContext.resolveRuleRef?`; `FormatProgram.hasRuleRefs?: boolean`.
- `packages/format/src/tier1/resolver.ts` — RuleRefNode resolution via accessor.
- `packages/format/src/tier2/fragmentResolver.ts` — forward `ctx.resolveRuleRef` into per-fragment contexts (composite fragments would otherwise drop the accessor).
- `packages/format/src/compile.ts` — surface `hasRuleRefs` on compiled programs (tier-1 brackets AND composite fragment channels/cellBackground).
- `packages/format/tests/tier1/resolver.test.ts` — reserve test updated + new accessor tests.

**`@wellsfargo-starui/velocity-grid` — new files:**

- `packages/kernel/src/core/ruleEngineSlot.ts` — DI slot + structural `RuleEngineShape`/`RuleCellPatchShape`.
- `packages/kernel/src/core/formatEvalMemo.ts` — per-cell format-eval memo (Task 14).

**`@wellsfargo-starui/velocity-grid` — touched existing files:**

- `packages/kernel/src/core/propertyChain.ts` — rule-patch fold in `applyCellProps` (after cellClassRules variants at ~line 730, before function-form `cellStyle` at ~line 733); rule `valueFormatter` override + memo wiring in `compileFormatSlots` wrappers (~lines 840–903); `resolveRuleRef` threading into `FormatEvalContext` construction.
- `packages/kernel/src/core/eventEmitter.ts` — `hasListener(type): boolean`.
- `packages/kernel/src/velocityGrid.ts` — `registerRuleEngine` method (next to `registerFormatCompiler` ~line 4826); `rowsChanged` emission in the `rowDataById` transaction sync (~lines 1974–1991) + async-flush and edit-commit paths; `forEachRow(fn)`; `getThemeKind()`.
- `packages/kernel/src/types/api.ts` — `registerRuleEngine`, `forEachRow`, `getThemeKind` on `VelocityGridApi`.
- `packages/kernel/src/types/event.ts` — `rowsChanged` event member.
- `packages/kernel/src/types/column.ts` — `FlashCellsParams` + `flashDuration?/color?/mode?` (the line 47–49 "reserved for a follow-up patch" comment is retired this cycle).
- `packages/kernel/src/core/flashRegistry.ts` + `src/core/flashAlphaMask.ts` + `src/renderer/painters/byRows.ts` — per-cell flash color/mode overrides (flash timing is main-side in `FlashRegistry` — no worker protocol change); indicator icon fold into the cellIcon paint path (~lines 505–640).
- `packages/kernel/src/worker/protocol.ts` (+ chunk producer) — `ViewportChunk.stringRowIds?: string[]` + a `stringRowIdAt` accessor: the paint path has no string rowId today (the legacy `rowIdAt` is a `row-${i}` stub, untouched); this field keys rule eval, flash overrides, and the format memo (Task 11).
- `packages/kernel/src/types/column.ts` + text/number cell renderers — minimal `textDecoration` paint channel (none exists today; rule styles need underline/line-through per no-deferral).
- `packages/kernel/src/core/editController.ts` (or its velocityGrid.ts commit-back seam) — edit commits bypass `rowDataById`; a listener-gated `mirrorEditCommit` wrapper freshens the mirror + emits `rowsChanged` with `source: 'edit'` (Task 12).
- `packages/kernel/package.json` — `@wellsfargo-starui/velocity-grid-rules` devDependency (type-only, for kernel tests that exercise the slot with real types).

**Files NOT modified (verify in Task 17):** `packages/expression/**`; root `package.json` / `turbo.json` / `tsconfig.base.json`; `eslint.config.mjs` (protected by config hook — boundary holds by inspection, as in 21c).

**Showcase app (Task 16):** — showcase sources are TypeScript (`src/main.ts`, `src/features/index.ts`); the untracked `src/features/*.js` files are `tsc -b` emit stragglers, never sources.

- `apps/cgrid-showcase/src/features/conditionalStyling.ts` — new feature page.
- `apps/cgrid-showcase/src/features/alerts.ts` — new feature page.
- `apps/cgrid-showcase/src/features/index.ts` — register both.
- `apps/cgrid-showcase/e2e/conditionalStyling.spec.ts`, `apps/cgrid-showcase/e2e/alerts.spec.ts` — new E2E specs (7 + 5 = 12 new; showcase E2E total 109 → 121).

---

## Phase A — `@wellsfargo-starui/velocity-grid-rules` scaffold + shared types (1 task)

---

### Task 1: Feature branch + package scaffold + all public types + module skeletons

**Files:**
- Modify: `packages/rules/package.json` (kernel dep → peerDep; add coverage script + devDep)
- Create: `packages/rules/vitest.config.ts`
- Create: `packages/rules/src/types.ts`
- Overwrite: `packages/rules/src/index.ts` (currently `export {};`)
- Create: `packages/rules/src/conditionCompiler.ts` (skeleton)
- Create: `packages/rules/src/ruleEngine.ts` (skeleton)
- Create: `packages/rules/src/matchCounter.ts` (skeleton)
- Create: `packages/rules/src/expiryHeap.ts` (skeleton)
- Create: `packages/rules/src/alerts/messageTemplate.ts` (skeleton)
- Create: `packages/rules/src/alerts/tokenBucket.ts` (skeleton)
- Create: `packages/rules/src/alerts/alertsEngine.ts` (skeleton)
- Create: `packages/rules/src/bridge.ts` (skeleton)
- Test: `packages/rules/tests/types.test.ts`

**Interfaces:**
- Consumes: `@wellsfargo-starui/velocity-grid-expression` types (`Loc`, `Schema`) — already exported from `packages/expression/src/index.ts`.
- Produces: every public type in the package, verbatim from spec §3.1/§3.2/§4.2 — ALL later tasks import from `./types`. Skeleton functions/classes that throw `new Error('not-yet-implemented: <name> ships in Task N')`.

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/develop/wfh/canvasgrid
git checkout main && git pull --ff-only
git checkout -b cycle21e/rules
```

- [ ] **Step 2: Update `packages/rules/package.json`**

Replace the whole file with (changes vs scaffold: kernel moved to `peerDependencies`, `test:coverage` script, `@vitest/coverage-v8` devDep — mirrors `packages/format/package.json` exactly):

```json
{
  "name": "@wellsfargo-starui/velocity-grid-rules",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "echo '@wellsfargo-starui/velocity-grid-rules is a scaffold — no build yet' && exit 0",
    "test": "vitest run --passWithNoTests",
    "test:coverage": "vitest run --coverage --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@wellsfargo-starui/velocity-grid-expression": "*",
    "@wellsfargo-starui/velocity-grid-format": "*"
  },
  "peerDependencies": {
    "@wellsfargo-starui/velocity-grid": "*"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.0",
    "typescript": "~5.9.3",
    "vitest": "^2.1.0"
  }
}
```

Run `npm install` at the repo root afterwards so the workspace lockfile picks up the dep moves.

- [ ] **Step 3: Create `packages/rules/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
```

- [ ] **Step 4: Create `packages/rules/src/types.ts`**

Copy the spec types verbatim (single authoritative file — spec §3.1, §3.2, §4.2):

```ts
// @wellsfargo-starui/velocity-grid-rules — public types.
// Authoritative reference: docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md
// §3.1 (rule shapes), §3.2 (alert shapes), §4.2 (engine contracts).

import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import type { FormatProgram } from '@wellsfargo-starui/velocity-grid-format';

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
  /** Format-DSL string (any tier @wellsfargo-starui/velocity-grid-format compiles); matching cells
   *  render through this program instead of the ColDef formatter. */
  valueFormatter?: string;
  /** Auto-expire: the match stays active this long after activation, then
   *  drops (blink-on-change UX). Activation = condition transitions
   *  false→true for a (rowId, colId) via a change record. */
  activeDurationMs?: number;
}

export interface IndicatorRule extends RuleBase {
  kind: 'indicator';
  indicator: RuleIndicator;
}

export type StyleRule = ConditionalStyleRule | IndicatorRule;

// ─── Alerts ────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'success' | 'warning' | 'critical';
export type AlertChannel = 'toast' | 'badge' | 'openfin';

export type AlertTrigger =
  | { kind: 'dataChange'; expression: string; columnIds?: string[] }
  | {
      kind: 'relativeChange';
      columnId: string;
      mode: 'PERCENT_CHANGE' | 'ABSOLUTE_CHANGE' | 'ANY_CHANGE';
      /** Required for PERCENT_CHANGE (percent points) and ABSOLUTE_CHANGE;
       *  ignored for ANY_CHANGE. */
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
  /** Column that triggered; null for rowChange + unrestricted dataChange. */
  colId: string | null;
  value: unknown;
  prev: unknown;
  channels: AlertChannel[];
  /** Engine-assigned monotonic sequence (not wall-clock; hosts stamp their own). */
  seq: number;
}

export interface AlertsSettings {
  enabled: boolean;
  defaultDebounceMs: number;
  maxNotificationsPerSecond: number;
  historyLimit: number;
  enabledChannels: Record<AlertChannel, boolean>;
  evaluationMode: 'realtime' | 'throttled' | 'paused';
}

export const DEFAULT_ALERTS_SETTINGS: AlertsSettings = {
  enabled: true,
  defaultDebounceMs: 1000,
  maxNotificationsPerSecond: 10,
  historyLimit: 200,
  enabledChannels: { toast: true, badge: true, openfin: true },
  evaluationMode: 'realtime',
};

// ─── Engine contracts ──────────────────────────────────────────────────

export interface RuleEvalContext {
  row: Record<string, unknown>;
  rowId: string;
  /** null → row-scope evaluation (no cell column). */
  colId: string | null;
  theme: ThemeKind;
}

export interface RuleCellResult {
  /** Matched rule ids in application order (priority asc). Empty = no match. */
  matched: string[];
  /** Folded flat style for the active theme; null when no style rule matched. */
  style: StyleSlice | null;
  indicator: RuleIndicator | null;
  /** Compiled program from the winning rule's valueFormatter; null when none. */
  formatProgram: FormatProgram | null;
}

export interface RuleValidationError {
  ruleId: string;
  code:
    | 'parse'
    | 'unknown-fn'
    | 'arity'
    | 'not-yet-implemented'
    | 'bad-shape'
    | 'format-compile';
  message: string;
  loc: Loc | null;
}

export interface SetRulesResult {
  ok: boolean;
  errors: RuleValidationError[];
}

export interface ChangeRecord {
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface RowChangeSet {
  added: Array<{ rowId: string; row: Record<string, unknown> }>;
  updated: Array<{
    rowId: string;
    row: Record<string, unknown>;
    cells: ChangeRecord[];
  }>;
  removed: Array<{ rowId: string; row: Record<string, unknown> }>;
}

export interface FlashDirective {
  rowId: string;
  /** null → whole row. */
  colIds: string[] | null;
  color: string;
  mode: 'fade' | 'pulse' | 'glow';
  durationMs: number;
}

export type Unsubscribe = () => void;

export interface WireRulesOptions {
  rules?: StyleRule[];
  alertRules?: AlertRule[];
  alertsSettings?: Partial<AlertsSettings>;
  schema?: import('@wellsfargo-starui/velocity-grid-expression').Schema;
}
```

- [ ] **Step 5: Create the module skeletons**

Every skeleton exports its final public signature and throws. `packages/rules/src/conditionCompiler.ts`:

```ts
// Condition string → CompiledCondition. Ships in Task 2.
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import type { RuleValidationError, StyleRule } from './types';

export interface CompiledCondition {
  /** Strict-boolean evaluation; `row` may carry a `__cgridDiff` injection. */
  matches(row: Record<string, unknown>): boolean;
  /** True when the condition references `[col.old]` — evaluated only against diff-map members. */
  diffAware: boolean;
  /** Column ids the condition reads (drives watched-column diffing). */
  watchedColIds: ReadonlySet<string>;
}

export function compileCondition(
  _condition: string,
  _ruleId: string,
  _schema?: Schema,
): { ok: true; compiled: CompiledCondition } | { ok: false; error: RuleValidationError } {
  throw new Error('not-yet-implemented: compileCondition ships in Task 2');
}

export function validateRule(
  _rule: StyleRule,
  _schema?: Schema,
): RuleValidationError[] {
  throw new Error('not-yet-implemented: validateRule ships in Task 2');
}
```

`packages/rules/src/ruleEngine.ts`:

```ts
// RuleEngine — evaluate/fold/counts. Ships in Tasks 3–5.
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import type {
  FlashDirective, RowChangeSet, RuleCellResult, RuleEvalContext,
  SetRulesResult, StyleRule, Unsubscribe,
} from './types';

export class RuleEngine {
  constructor(_opts?: { schema?: Schema; now?: () => number }) {
    throw new Error('not-yet-implemented: RuleEngine ships in Task 3');
  }
  setRules(_rules: StyleRule[]): SetRulesResult { throw new Error('not-yet-implemented'); }
  getRules(): StyleRule[] { throw new Error('not-yet-implemented'); }
  evaluateCell(_ctx: RuleEvalContext): RuleCellResult { throw new Error('not-yet-implemented'); }
  matchCount(_ruleId: string): number { throw new Error('not-yet-implemented'); }
  resolveRuleRef(_ruleId: string, _ctx: RuleEvalContext): string | null { throw new Error('not-yet-implemented'); }
  recount(_rows: Iterable<{ rowId: string; row: Record<string, unknown> }>): void { throw new Error('not-yet-implemented'); }
  applyChanges(_changes: RowChangeSet): FlashDirective[] { throw new Error('not-yet-implemented'); }
  endTick(): void { throw new Error('not-yet-implemented'); }
  onExpire(_fn: (cells: Array<{ rowId: string; colId: string | null }>) => void): Unsubscribe { throw new Error('not-yet-implemented'); }
  evalErrorCount(_ruleId: string): number { throw new Error('not-yet-implemented'); }
}
```

`packages/rules/src/matchCounter.ts`:

```ts
// Match-count bookkeeping. Ships in Task 4.
export class MatchCounter {
  constructor() { throw new Error('not-yet-implemented: MatchCounter ships in Task 4'); }
  count(_ruleId: string): number { throw new Error('not-yet-implemented'); }
  resetAll(): void { throw new Error('not-yet-implemented'); }
  setRowMatches(_ruleId: string, _rowId: string, _n: number): void { throw new Error('not-yet-implemented'); }
  dropRow(_rowId: string): void { throw new Error('not-yet-implemented'); }
}
```

`packages/rules/src/expiryHeap.ts`:

```ts
// Min-heap of activation deadlines with a single coalesced timer. Ships in Task 5.
export interface ExpiryEntry { deadline: number; rowId: string; colId: string | null; ruleId: string; }

export class ExpiryHeap {
  constructor(_opts: { now: () => number; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (h: unknown) => void }) {
    throw new Error('not-yet-implemented: ExpiryHeap ships in Task 5');
  }
  push(_e: ExpiryEntry): void { throw new Error('not-yet-implemented'); }
  /** Currently-active (unexpired) key check: `rowId\0colId\0ruleId`. */
  isActive(_rowId: string, _colId: string | null, _ruleId: string): boolean { throw new Error('not-yet-implemented'); }
  onExpire(_fn: (expired: ExpiryEntry[]) => void): () => void { throw new Error('not-yet-implemented'); }
  clear(): void { throw new Error('not-yet-implemented'); }
}
```

`packages/rules/src/alerts/messageTemplate.ts`:

```ts
// {rule}/{rowId}/{column}/{value}/{prev} template rendering. Ships in Task 6.
export interface MessageContext {
  rule: string; rowId: string; column: string | null; value: unknown; prev: unknown;
}
export function renderMessage(_template: string, _ctx: MessageContext): string {
  throw new Error('not-yet-implemented: renderMessage ships in Task 6');
}
```

`packages/rules/src/alerts/tokenBucket.ts`:

```ts
// Continuous-refill token bucket. Ships in Task 6.
export class TokenBucket {
  constructor(_opts: { capacityPerSecond: number; now: () => number }) {
    throw new Error('not-yet-implemented: TokenBucket ships in Task 6');
  }
  tryTake(): boolean { throw new Error('not-yet-implemented'); }
  setCapacity(_capacityPerSecond: number): void { throw new Error('not-yet-implemented'); }
}
```

`packages/rules/src/alerts/alertsEngine.ts`:

```ts
// AlertsEngine — triggers/debounce/history. Ships in Tasks 7–8.
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import type {
  AlertEvent, AlertRule, AlertsSettings, RowChangeSet, SetRulesResult, Unsubscribe,
} from '../types';

export class AlertsEngine {
  constructor(_opts?: { settings?: Partial<AlertsSettings>; schema?: Schema; now?: () => number }) {
    throw new Error('not-yet-implemented: AlertsEngine ships in Task 7');
  }
  setRules(_rules: AlertRule[]): SetRulesResult { throw new Error('not-yet-implemented'); }
  getRules(): AlertRule[] { throw new Error('not-yet-implemented'); }
  getSettings(): AlertsSettings { throw new Error('not-yet-implemented'); }
  setSettings(_patch: Partial<AlertsSettings>): void { throw new Error('not-yet-implemented'); }
  applyChanges(_changes: RowChangeSet): void { throw new Error('not-yet-implemented'); }
  onAlert(_fn: (alert: AlertEvent) => void): Unsubscribe { throw new Error('not-yet-implemented'); }
  getHistory(): AlertEvent[] { throw new Error('not-yet-implemented'); }
  unreadCount(): number { throw new Error('not-yet-implemented'); }
  markAllRead(): void { throw new Error('not-yet-implemented'); }
  flushThrottled(): void { throw new Error('not-yet-implemented'); }
  droppedCount(): number { throw new Error('not-yet-implemented'); }
}
```

`packages/rules/src/bridge.ts`:

```ts
// Kernel bridge. Ships in Task 15.
import type { WireRulesOptions } from './types';
import type { RuleEngine } from './ruleEngine';
import type { AlertsEngine } from './alerts/alertsEngine';

export function wireIntoKernel(
  _grid: unknown,
  _opts?: WireRulesOptions,
): { rules: RuleEngine; alerts: AlertsEngine } {
  throw new Error('not-yet-implemented: wireIntoKernel ships in Task 15');
}
```

- [ ] **Step 6: Overwrite `packages/rules/src/index.ts`**

```ts
// @wellsfargo-starui/velocity-grid-rules — public re-exports.
// See docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §4.1.

export { RuleEngine } from './ruleEngine';
export { AlertsEngine } from './alerts/alertsEngine';
export { wireIntoKernel } from './bridge';
export { compileCondition, validateRule } from './conditionCompiler';
export type { CompiledCondition } from './conditionCompiler';
export { renderMessage } from './alerts/messageTemplate';
export type { MessageContext } from './alerts/messageTemplate';
export { DEFAULT_ALERTS_SETTINGS } from './types';

export type {
  ThemeKind, StyleSlice, ThemeAwareStyle, FlashConfig, RuleIndicator,
  RuleScope, RuleBase, ConditionalStyleRule, IndicatorRule, StyleRule,
  AlertSeverity, AlertChannel, AlertTrigger, AlertRule, AlertEvent, AlertsSettings,
  RuleEvalContext, RuleCellResult, RuleValidationError, SetRulesResult,
  ChangeRecord, RowChangeSet, FlashDirective, WireRulesOptions, Unsubscribe,
} from './types';
```

- [ ] **Step 7: Write the type smoke test `packages/rules/tests/types.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERTS_SETTINGS,
  type AlertRule,
  type ConditionalStyleRule,
  type IndicatorRule,
  type RowChangeSet,
} from '../src/index';

describe('types', () => {
  it('rule shapes are plain JSON (structuredClone-safe)', () => {
    const style: ConditionalStyleRule = {
      kind: 'style', id: 'r1', name: 'Neg P&L', enabled: true, priority: 10,
      condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
      style: { base: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
      flash: { enabled: true, target: 'cell', mode: 'fade', color: '#c62828', durationMs: 800 },
      indicator: { iconName: 'trending-down', color: '#c62828', target: 'cell', position: 'after' },
      valueFormatter: '#,##0.00;[Red](#,##0.00)',
      activeDurationMs: 5000,
    };
    const indicator: IndicatorRule = {
      kind: 'indicator', id: 'r2', name: 'Fav', enabled: true, priority: 20,
      condition: '[fav] = true', scope: { kind: 'row' },
      indicator: { iconName: 'star', color: '#fbc02d', target: 'row-start', position: 'before' },
    };
    const alert: AlertRule = {
      id: 'a1', name: 'Big move', enabled: true, priority: 1, severity: 'warning',
      trigger: { kind: 'relativeChange', columnId: 'price', mode: 'PERCENT_CHANGE', threshold: 5, direction: 'both' },
      message: '{rule}: {column} moved {prev} → {value} on {rowId}',
      channels: ['toast', 'badge'],
    };
    for (const r of [style, indicator, alert]) {
      expect(structuredClone(r)).toEqual(r);
    }
  });

  it('DEFAULT_ALERTS_SETTINGS matches spec §3.2 defaults', () => {
    expect(DEFAULT_ALERTS_SETTINGS).toEqual({
      enabled: true,
      defaultDebounceMs: 1000,
      maxNotificationsPerSecond: 10,
      historyLimit: 200,
      enabledChannels: { toast: true, badge: true, openfin: true },
      evaluationMode: 'realtime',
    });
  });

  it('RowChangeSet shape round-trips', () => {
    const cs: RowChangeSet = {
      added: [{ rowId: 'x', row: { a: 1 } }],
      updated: [{ rowId: 'y', row: { a: 2 }, cells: [{ rowId: 'y', colId: 'a', oldValue: 1, newValue: 2 }] }],
      removed: [{ rowId: 'z', row: { a: 3 } }],
    };
    expect(structuredClone(cs)).toEqual(cs);
  });
});
```

- [ ] **Step 8: Run the test + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules
npx vitest run
npx tsc --noEmit
```

Expected: 3/3 PASS; typecheck clean (skeleton throws are reachable-code-safe because each throw precedes any return).

- [ ] **Step 9: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules package-lock.json
git commit -m "feat(rules): cycle 21e task 1 — package scaffold, public types, module skeletons"
```

---

## Phase B — Rule engine core (4 tasks)

---

### Task 2: Condition compiler — parse, diff-aware AST rewrite, validateRule

**Files:**
- Modify: `packages/rules/src/conditionCompiler.ts` (replace skeleton with real implementation)
- Test: `packages/rules/tests/conditionCompiler.test.ts` (new)

**Interfaces:**
- Consumes (from Task 1 / dependencies):
    - `./types`: `RuleValidationError`, `StyleRule`
    - `@wellsfargo-starui/velocity-grid-expression`: `parse(source) → ParseResult`, `compile(ast, opts?) → CompileResult`, `evaluate(compiled, { row }) → unknown` (throws `EvalError`), types `AstNode`, `FieldNode`, `Schema`
    - `@wellsfargo-starui/velocity-grid-format`: `compileFormat(source, opts?) → CompileFormatResult`
- Produces (for Tasks 3–5, 15):
    - `compileCondition(condition: string, ruleId: string, schema?: Schema, opts?: CompileConditionOptions): { ok: true; compiled: CompiledCondition } | { ok: false; error: RuleValidationError }` — the Task-1 skeleton signature extended with a fourth optional `opts` argument (skeleton-compatible: all existing 2- and 3-arg call sites keep working; this is the one permitted signature extension and it is shown in full below).
    - `CompileConditionOptions = { onEvalError?: () => void }` (module-level export; NOT re-exported from `index.ts` — engine-internal wiring).
    - `CompiledCondition = { matches(row): boolean; diffAware: boolean; watchedColIds: ReadonlySet<string> }` (unchanged from Task 1).
    - `validateRule(rule: StyleRule, schema?: Schema): RuleValidationError[]` (unchanged from Task 1).
    - `validateRuleShape(rule: StyleRule): RuleValidationError[]` — shape checks only, no compilation; used by `RuleEngine.setRules` (Task 3) so conditions/formatters are compiled exactly once. Module-level export, NOT re-exported from `index.ts`.
    - `DIFF_ROOT = '__cgridDiff'` const — the synthetic injection root Task 4's diff map targets.

Semantics locked by spec §3.3/§3.4, restated for the implementer:
- Rewrite `FieldNode` path `[colId, 'old']` → `['__cgridDiff', colId, 'old']` and `[colId, 'new']` → `[colId]`. With a `schema`, rewrite ONLY when `colId` is a known schema field (unknown heads stay nested-object reads). Without a schema, rewrite whenever the path is exactly 2 segments ending in `'old'`/`'new'`.
- `watchedColIds` = first path segment of every `FieldNode` (collected pre-rewrite), excluding `'__cgridDiff'`. `diffAware` = true iff at least one `.old` rewrite happened.
- Strict boolean: `matches` returns `evaluate(...) === true`. `EvalError` → `false` + `opts.onEvalError?.()`; any other throw propagates (programmer error, not data error).
- Error mapping: parse failure → code `'parse'`; compile failure codes pass through verbatim (`'unknown-fn' | 'arity' | 'not-yet-implemented'` — the latter is how reserved aggregates like `SUM([x]) > 0` surface, per spec §1.2).
- CSP-safe (closure composition only, no `new Function`/`eval`) and Date-free — the whole file has zero clock access.

- [ ] **Step 1: Write the failing test `packages/rules/tests/conditionCompiler.test.ts`**

Full test file (operator forms follow the spec §3.4 canonical example `[price.old] != null AND [price] > [price.old]` verbatim):

```ts
import { describe, expect, it } from 'vitest';
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { compileCondition, validateRule } from '../src/conditionCompiler';
import type { ConditionalStyleRule, IndicatorRule } from '../src/types';

const schema: Schema = { fields: { price: 'number', qty: 'number', sym: 'string' } };

function mustCompile(condition: string, sch?: Schema, onEvalError?: () => void) {
  const res = compileCondition(condition, 'r-test', sch, onEvalError ? { onEvalError } : undefined);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.compiled;
}

describe('compileCondition — plain conditions', () => {
  it.each([
    ['[price] > 100', { price: 150 }, true],
    ['[price] > 100', { price: 50 }, false],
    ['[qty] != 0 AND [price] > 100', { qty: 1, price: 150 }, true],
  ])('%s over %o → %s', (condition, row, expected) => {
    expect(mustCompile(condition).matches(row as Record<string, unknown>)).toBe(expected);
  });

  it('is strict-boolean: a bare field never matches, even when truthy', () => {
    const compiled = mustCompile('[price]');
    expect(compiled.matches({ price: 5 })).toBe(false);
    expect(compiled.matches({ price: 1 })).toBe(false);
  });
});

describe('compileCondition — [col.old]/[col.new] rewrite', () => {
  const wentUp = '[price.old] != null AND [price] > [price.old]';

  it('flags diffAware and reads old values from the __cgridDiff injection', () => {
    const compiled = mustCompile(wentUp, schema);
    expect(compiled.diffAware).toBe(true);
    expect(compiled.matches({ price: 105, __cgridDiff: { price: { old: 100 } } })).toBe(true);
    expect(compiled.matches({ price: 95, __cgridDiff: { price: { old: 100 } } })).toBe(false);
  });

  it('resolves [col.old] to null on quiescent rows (no diff injected)', () => {
    const compiled = mustCompile(wentUp, schema);
    expect(compiled.matches({ price: 105 })).toBe(false);
  });

  it('[col.new] rewrites to the current row value and is not diffAware by itself', () => {
    const compiled = mustCompile('[price.new] > 100', schema);
    expect(compiled.diffAware).toBe(false);
    expect(compiled.matches({ price: 150 })).toBe(true);
    expect(compiled.matches({ price: 50 })).toBe(false);
  });

  it('with a schema, unknown heads are NOT rewritten (stay nested-object reads)', () => {
    const compiled = mustCompile('[meta.old] == 1', schema); // 'meta' is not a schema field
    expect(compiled.diffAware).toBe(false);
    expect(compiled.matches({ meta: { old: 1 } })).toBe(true);
  });

  it('without a schema, any 2-segment .old path is rewritten', () => {
    const compiled = mustCompile('[meta.old] == 1'); // no schema
    expect(compiled.diffAware).toBe(true);
    expect(compiled.matches({ meta: { old: 1 } })).toBe(false); // nested read no longer applies
    expect(compiled.matches({ __cgridDiff: { meta: { old: 1 } } })).toBe(true);
  });
});

describe('compileCondition — watchedColIds', () => {
  it('collects the first path segment of every field read (incl. rewritten .old refs)', () => {
    const compiled = mustCompile('[price.old] != null AND [qty] > 0', schema);
    expect([...compiled.watchedColIds].sort()).toEqual(['price', 'qty']);
  });

  it('collects dot-path heads — nested reads watch the head colId', () => {
    const compiled = mustCompile('[trade.venue.fee] > 0');
    expect([...compiled.watchedColIds]).toEqual(['trade']); // 3 segments — never rewritten
    expect(compiled.diffAware).toBe(false);
  });

  it("never watches the '__cgridDiff' injection root itself", () => {
    const compiled = mustCompile('[__cgridDiff.price.old] != null');
    expect(compiled.watchedColIds.has('__cgridDiff')).toBe(false);
  });
});

describe('compileCondition — EvalError handling', () => {
  it('EvalError → non-matching + onEvalError callback fires once per occurrence', () => {
    let errs = 0;
    const compiled = mustCompile('[a] / [b] > 0', undefined, () => {
      errs += 1;
    });
    expect(compiled.matches({ a: 1, b: 0 })).toBe(false); // div-by-zero
    expect(errs).toBe(1);
    expect(compiled.matches({ a: 1, b: 2 })).toBe(true); // recovers on good data
    expect(errs).toBe(1);
  });
});

describe('compileCondition — reserved aggregates', () => {
  it("SUM([x]) > 0 surfaces 21b's not-yet-implemented compile error verbatim", () => {
    const res = compileCondition('SUM([x]) > 0', 'r-agg');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('not-yet-implemented');
    expect(res.error.ruleId).toBe('r-agg');
    expect(res.error.loc).not.toBeNull();
  });
});

describe('validateRule', () => {
  const base: ConditionalStyleRule = {
    kind: 'style',
    id: 'r1',
    name: 'Rule 1',
    enabled: true,
    priority: 10,
    condition: '[price] > 100',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { color: '#c62828' } },
  };

  it('accepts a well-formed style rule', () => {
    expect(validateRule(base, schema)).toEqual([]);
  });

  it.each([
    ['empty id', { ...base, id: '' }],
    ['empty name', { ...base, name: '' }],
    ['non-finite priority', { ...base, priority: Number.NaN }],
    ['blank condition', { ...base, condition: '   ' }],
    ['cell scope with empty columnIds', { ...base, scope: { kind: 'cell', columnIds: [] } as never }],
    ['style rule without style object', { ...base, style: null as never }],
  ])('%s → bad-shape', (_label, rule) => {
    const errors = validateRule(rule as ConditionalStyleRule, schema);
    expect(errors.some((e) => e.code === 'bad-shape')).toBe(true);
  });

  it('indicator rule without indicator object → bad-shape', () => {
    const rule: IndicatorRule = {
      kind: 'indicator',
      id: 'r2',
      name: 'Ind',
      enabled: true,
      priority: 1,
      condition: '[qty] > 0',
      scope: { kind: 'row' },
      indicator: null as never,
    };
    expect(validateRule(rule, schema).some((e) => e.code === 'bad-shape')).toBe(true);
  });

  it('unparseable condition → parse (single error, loc populated)', () => {
    const errors = validateRule({ ...base, condition: '[price] >' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('parse');
    expect(errors[0].ruleId).toBe('r1');
    expect(errors[0].loc).not.toBeNull();
  });

  it('uncompilable valueFormatter → format-compile', () => {
    const errors = validateRule({ ...base, valueFormatter: '[color=1+]' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('format-compile');
  });
});
```

(Note for the implementer: `'[color=1+]'` fails `compileFormat` because the tier-1 bracket interior `1+` fails `expression.parse` — any reliably-uncompilable format string works. If the expression package reports SUM as `'unknown-fn'` rather than `'not-yet-implemented'`, that is a deviation from spec §1.2 to raise with the reviewer — the passthrough mapping keeps the compiler honest either way.)

- [ ] **Step 2: Run to see it FAIL**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/conditionCompiler.test.ts
```

Expected: FAIL — all 24 tests throw `not-yet-implemented: compileCondition ships in Task 2` (or the `validateRule` variant) from the Task-1 skeletons.

- [ ] **Step 3: Implement — replace `packages/rules/src/conditionCompiler.ts`**

Full file:

```ts
// Condition string → CompiledCondition.
// parse → diff-aware AST rewrite ([col.old]/[col.new] → __cgridDiff
// injection) → compile → strict-boolean matcher.
//
// CSP-safe: closure composition via @wellsfargo-starui/velocity-grid-expression only — no new
// Function / eval anywhere in this package. Date-free: zero clock access.
//
// Authoritative reference:
// docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §3.3 + §3.4.

import { compile, evaluate, parse, EvalError } from '@wellsfargo-starui/velocity-grid-expression';
import type { AstNode, FieldNode, Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { compileFormat } from '@wellsfargo-starui/velocity-grid-format';
import type { RuleValidationError, StyleRule } from './types';

export interface CompiledCondition {
  /** Strict-boolean evaluation; `row` may carry a `__cgridDiff` injection. */
  matches(row: Record<string, unknown>): boolean;
  /** True when the condition references `[col.old]` — evaluated only against diff-map members. */
  diffAware: boolean;
  /** Column ids the condition reads (drives watched-column diffing). */
  watchedColIds: ReadonlySet<string>;
}

export interface CompileConditionOptions {
  /** Invoked once per occurrence when evaluation throws EvalError; the rule
   *  is treated as non-matching for that cell (never breaks paint). */
  onEvalError?: () => void;
}

/** The synthetic root the diff rewrite targets. RuleEngine injects it as
 *  `{ ...row, __cgridDiff: { [colId]: { old } } }` for diff-map rows (Task 4). */
export const DIFF_ROOT = '__cgridDiff';

interface RewriteState {
  diffAware: boolean;
  watched: Set<string>;
  schema: Schema | undefined;
}

function rewriteField(node: FieldNode, state: RewriteState): FieldNode {
  const head = node.path[0];
  if (head !== DIFF_ROOT) state.watched.add(head);
  if (node.path.length !== 2) return node;
  const tail = node.path[1];
  if (tail !== 'old' && tail !== 'new') return node;
  // With a schema, rewrite only when the head is a known field — a
  // 2-segment path over an unknown head stays a nested-object read.
  if (state.schema && !Object.prototype.hasOwnProperty.call(state.schema.fields, head)) {
    return node;
  }
  if (tail === 'old') {
    state.diffAware = true;
    return { ...node, path: [DIFF_ROOT, head, 'old'] };
  }
  // [col.new] — the current row value IS the new value (spec §3.4).
  return { ...node, path: [head] };
}

function rewriteNode(node: AstNode, state: RewriteState): AstNode {
  switch (node.kind) {
    case 'literal':
      return node;
    case 'field':
      return rewriteField(node, state);
    case 'unary':
      return { ...node, arg: rewriteNode(node.arg, state) };
    case 'binary':
      return {
        ...node,
        left: rewriteNode(node.left, state),
        right: rewriteNode(node.right, state),
      };
    case 'ternary':
      return {
        ...node,
        test: rewriteNode(node.test, state),
        consequent: rewriteNode(node.consequent, state),
        alternate: rewriteNode(node.alternate, state),
      };
    case 'call':
      return { ...node, args: node.args.map((a) => rewriteNode(a, state)) };
    case 'aggregate':
    case 'prev':
      // 21b's parser never emits these; if a future parse does, compile()
      // rejects them with 'not-yet-implemented' — pass through untouched.
      return node;
  }
}

export function compileCondition(
  condition: string,
  ruleId: string,
  schema?: Schema,
  opts?: CompileConditionOptions,
): { ok: true; compiled: CompiledCondition } | { ok: false; error: RuleValidationError } {
  const parsed = parse(condition);
  if (!parsed.ok) {
    return {
      ok: false,
      error: { ruleId, code: 'parse', message: parsed.error.message, loc: parsed.error.loc },
    };
  }
  const state: RewriteState = { diffAware: false, watched: new Set(), schema };
  const rewritten = rewriteNode(parsed.ast, state);
  const compiled = compile(rewritten);
  if (!compiled.ok) {
    // Compile codes pass through verbatim: 'unknown-fn' | 'arity' |
    // 'not-yet-implemented' (reserved aggregates/PREV — Cycle 21d).
    return {
      ok: false,
      error: {
        ruleId,
        code: compiled.error.code,
        message: compiled.error.message,
        loc: compiled.error.loc,
      },
    };
  }
  const program = compiled.compiled;
  const onEvalError = opts?.onEvalError;
  const matches = (row: Record<string, unknown>): boolean => {
    try {
      // Strict boolean (spec §3.3): a number/string result never matches.
      return evaluate(program, { row }) === true;
    } catch (err) {
      if (err instanceof EvalError) {
        onEvalError?.();
        return false; // non-matching — never breaks paint
      }
      throw err;
    }
  };
  return {
    ok: true,
    compiled: { matches, diffAware: state.diffAware, watchedColIds: state.watched },
  };
}

function shapeError(ruleId: string, message: string): RuleValidationError {
  return { ruleId, code: 'bad-shape', message, loc: null };
}

/**
 * Structural checks only — no condition/formatter compilation. Exported for
 * RuleEngine.setRules (Task 3), which compiles condition + valueFormatter
 * itself to keep the compiled artifacts; not re-exported from index.ts.
 */
export function validateRuleShape(rule: StyleRule): RuleValidationError[] {
  const errors: RuleValidationError[] = [];
  const ruleId = typeof rule.id === 'string' ? rule.id : '';
  if (typeof rule.id !== 'string' || rule.id.length === 0) {
    errors.push(shapeError(ruleId, 'rule.id must be a nonempty string'));
  }
  if (typeof rule.name !== 'string' || rule.name.length === 0) {
    errors.push(shapeError(ruleId, 'rule.name must be a nonempty string'));
  }
  if (typeof rule.priority !== 'number' || !Number.isFinite(rule.priority)) {
    errors.push(shapeError(ruleId, 'rule.priority must be a finite number'));
  }
  if (typeof rule.condition !== 'string' || rule.condition.trim().length === 0) {
    errors.push(shapeError(ruleId, 'rule.condition must be a nonempty string'));
  }
  const scope = rule.scope as unknown as { kind?: unknown; columnIds?: unknown };
  const scopeOk =
    typeof scope === 'object' &&
    scope !== null &&
    (scope.kind === 'row' ||
      (scope.kind === 'cell' &&
        Array.isArray(scope.columnIds) &&
        scope.columnIds.length > 0 &&
        scope.columnIds.every((colId) => typeof colId === 'string' && colId.length > 0)));
  if (!scopeOk) {
    errors.push(
      shapeError(
        ruleId,
        "rule.scope must be { kind: 'row' } or { kind: 'cell', columnIds: [nonempty colIds] }",
      ),
    );
  }
  if (rule.kind === 'style') {
    if (typeof rule.style !== 'object' || rule.style === null) {
      errors.push(shapeError(ruleId, 'style rules require a style object'));
    }
  } else if (rule.kind === 'indicator') {
    if (typeof rule.indicator !== 'object' || rule.indicator === null) {
      errors.push(shapeError(ruleId, 'indicator rules require an indicator object'));
    }
  } else {
    errors.push(
      shapeError(ruleId, `unknown rule kind '${String((rule as { kind?: unknown }).kind)}'`),
    );
  }
  return errors;
}

export function validateRule(rule: StyleRule, schema?: Schema): RuleValidationError[] {
  const errors = validateRuleShape(rule);
  if (rule.kind === 'style' && typeof rule.valueFormatter === 'string') {
    const fmt = compileFormat(rule.valueFormatter);
    if (!fmt.ok) {
      errors.push({
        ruleId: rule.id,
        code: 'format-compile',
        message: fmt.error.message,
        loc: fmt.error.loc,
      });
    }
  }
  if (typeof rule.condition === 'string' && rule.condition.trim().length > 0) {
    const cond = compileCondition(rule.condition, rule.id, schema);
    if (!cond.ok) errors.push(cond.error);
  }
  return errors;
}
```

- [ ] **Step 4: Run to see it PASS**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/conditionCompiler.test.ts
```

Expected: 24/24 PASS.

- [ ] **Step 5: Full package suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run && npx tsc --noEmit
```

Expected: 27/27 PASS (24 new + 3 Task-1 type tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "feat(rules): cycle 21e task 2 — condition compiler: diff-aware AST rewrite + validateRule"
```

---

### Task 3: RuleEngine — setRules, evaluateCell fold, theme resolution, resolveRuleRef

**Files:**
- Modify: `packages/rules/src/ruleEngine.ts` (replace skeleton; Tasks 4–5 methods keep their not-yet-implemented throws)
- Test: `packages/rules/tests/ruleEngine.test.ts` (new)

**Interfaces:**
- Consumes:
    - Task 2: `compileCondition(condition, ruleId, schema?, opts?)`, `CompiledCondition`, `validateRuleShape(rule)`
    - `@wellsfargo-starui/velocity-grid-format`: `compileFormat(source) → CompileFormatResult`, type `FormatProgram`
    - `./types`: `RuleCellResult`, `RuleEvalContext`, `RuleValidationError`, `SetRulesResult`, `StyleRule`, `StyleSlice`, `ThemeAwareStyle`, `ThemeKind`, `RuleIndicator`, `FlashDirective`, `RowChangeSet`, `Unsubscribe`
- Produces (for Tasks 4, 5, 9, 15):
    - Working `RuleEngine` constructor `(opts?: { schema?: Schema; now?: () => number })` — `now` accepted (contract stable) but only consumed from Task 5.
    - `setRules(rules: StyleRule[]): SetRulesResult` — compiles conditions + valueFormatters once; invalid rules skipped + reported (`ok === (errors.length === 0)`); rebuilds all indexes.
    - `getRules(): StyleRule[]` — the full supplied set (including skipped-invalid and disabled rules — the customizer needs them back for editing), fresh array each call.
    - `evaluateCell(ctx: RuleEvalContext): RuleCellResult` — spec §3.5 fold; shared frozen `EMPTY_RESULT` on no match (zero allocation).
    - `resolveRuleRef(ruleId: string, ctx: RuleEvalContext): string | null` — the `rule:<ruleId>` accessor Task 9 threads into `@wellsfargo-starui/velocity-grid-format`.
    - Internal seam for Task 4: `#ruleMatches(ir, ctx)` is the single matching gate used by both `evaluateCell` and `resolveRuleRef`.
    - `matchCount` / `recount` / `applyChanges` / `endTick` / `onExpire` / `evalErrorCount` still throw (Tasks 4–5).

Semantics locked by spec §3.5/§4.2, restated:
- Enabled+valid rules are pre-indexed: `#cellByColId` for cell scope, `#rowScope` list, all sorted priority ascending with array order as the stable tiebreak. Merged per-colId candidate lists are built lazily and cached until the next `setRules`.
- Fold: matching rules apply in priority order; each style rule's theme-resolved `StyleSlice` (base ⊕ light/dark slice, per-property) merges per-property over the accumulated patch (later = higher priority number wins). Last indicator wins; last `valueFormatter` wins → `formatProgram`.
- Row-scope conditions are memoized per row-object identity within a paint pass (`WeakMap<row, Map<ruleId, boolean>>` — a new row object, as kernel transactions produce, invalidates naturally; in-place row mutation bypasses invalidation, same caveat as kernel paint memos).
- `resolveRuleRef` matches at condition level (scope column targeting governs where the rule *paints*, not whether a format rule-ref may read its color); unknown/disabled/indicator-kind rules → `null`.
- Eval errors are counted into `#evalErrors` per ruleId already in this task (the compiler's `onEvalError` hook); the public `evalErrorCount` getter ships in Task 4.

- [ ] **Step 1: Write the failing test `packages/rules/tests/ruleEngine.test.ts`**

Full test file:

```ts
import { describe, expect, it } from 'vitest';
import { RuleEngine } from '../src/ruleEngine';
import type {
  ConditionalStyleRule,
  IndicatorRule,
  RuleEvalContext,
  StyleRule,
} from '../src/types';

// ─── Fixtures ───────────────────────────────────────────────────────────

function styleRule(
  over: Partial<ConditionalStyleRule> & Pick<ConditionalStyleRule, 'id' | 'priority'>,
): ConditionalStyleRule {
  return {
    kind: 'style',
    name: over.id,
    enabled: true,
    condition: '[pnl] < 0',
    scope: { kind: 'cell', columnIds: ['pnl'] },
    style: { base: { color: '#c62828' } },
    ...over,
  };
}

const rowRule: ConditionalStyleRule = {
  kind: 'style',
  id: 'row-hl',
  name: 'row-hl',
  enabled: true,
  priority: 5,
  condition: '[price] > 50',
  scope: { kind: 'row' },
  style: { base: { backgroundColor: '#e8f5e9' } },
};

function ctx(over?: Partial<RuleEvalContext>): RuleEvalContext {
  return { row: { pnl: -5, price: 100 }, rowId: 'row-1', colId: 'pnl', theme: 'light', ...over };
}

function engineWith(...rules: StyleRule[]): RuleEngine {
  const engine = new RuleEngine();
  engine.setRules(rules);
  return engine;
}

// ─── evaluateCell fold ──────────────────────────────────────────────────

describe('RuleEngine — evaluateCell fold', () => {
  it('later (higher) priority wins per-property; untouched properties survive', () => {
    const engine = engineWith(
      styleRule({ id: 'B', priority: 20, style: { base: { color: '#1565c0' } } }),
      styleRule({
        id: 'A',
        priority: 10,
        style: { base: { color: '#c62828', backgroundColor: '#ffebee' } },
      }),
    );
    const res = engine.evaluateCell(ctx());
    expect(res.matched).toEqual(['A', 'B']); // priority asc, not declaration order
    expect(res.style).toEqual({ color: '#1565c0', backgroundColor: '#ffebee' });
  });

  it('equal priority ties break by setRules array order (stable)', () => {
    const engine = engineWith(
      styleRule({ id: 'first', priority: 10, style: { base: { color: '#111111' } } }),
      styleRule({ id: 'second', priority: 10, style: { base: { color: '#222222' } } }),
    );
    const res = engine.evaluateCell(ctx());
    expect(res.matched).toEqual(['first', 'second']);
    expect(res.style!.color).toBe('#222222');
  });

  it('theme resolution: base ⊕ dark slice, per-property', () => {
    const engine = engineWith(
      styleRule({
        id: 'T',
        priority: 1,
        style: { base: { color: '#111111', fontWeight: 'bold' }, dark: { color: '#eeeeee' } },
      }),
    );
    expect(engine.evaluateCell(ctx({ theme: 'dark' })).style).toEqual({
      color: '#eeeeee',
      fontWeight: 'bold',
    });
    expect(engine.evaluateCell(ctx({ theme: 'light' })).style).toEqual({
      color: '#111111',
      fontWeight: 'bold',
    });
  });
});

// ─── Scope targeting ────────────────────────────────────────────────────

describe('RuleEngine — scope targeting', () => {
  it('cell-scope rules do not affect other columns', () => {
    const engine = engineWith(styleRule({ id: 'A', priority: 1 })); // columnIds: ['pnl']
    expect(engine.evaluateCell(ctx({ colId: 'price' })).matched).toEqual([]);
  });

  it('row-scope rules apply to every colId including null (row-scope eval)', () => {
    const engine = engineWith(rowRule);
    for (const colId of ['pnl', 'price', null]) {
      const res = engine.evaluateCell(ctx({ colId }));
      expect(res.matched).toEqual(['row-hl']);
      expect(res.style).toEqual({ backgroundColor: '#e8f5e9' });
    }
  });
});

// ─── setRules behavior ──────────────────────────────────────────────────

describe('RuleEngine — setRules', () => {
  it('disabled rules are validated but never match', () => {
    const engine = new RuleEngine();
    const res = engine.setRules([{ ...styleRule({ id: 'off', priority: 1 }), enabled: false }]);
    expect(res).toEqual({ ok: true, errors: [] });
    expect(engine.evaluateCell(ctx()).matched).toEqual([]);
  });

  it('invalid rules are skipped + reported; valid rules still apply', () => {
    const engine = new RuleEngine();
    const res = engine.setRules([
      styleRule({ id: 'broken', priority: 1, condition: '[pnl] <' }),
      styleRule({ id: 'good', priority: 2 }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ ruleId: 'broken', code: 'parse' });
    expect(engine.evaluateCell(ctx()).matched).toEqual(['good']);
  });

  it('getRules returns the full supplied set (serializable snapshot, fresh array)', () => {
    const rules: StyleRule[] = [
      styleRule({ id: 'A', priority: 1 }),
      { ...styleRule({ id: 'off', priority: 2 }), enabled: false },
    ];
    const engine = engineWith(...rules);
    expect(engine.getRules()).toEqual(rules);
    expect(engine.getRules()).not.toBe(rules);
  });
});

// ─── EMPTY_RESULT identity ──────────────────────────────────────────────

describe('RuleEngine — EMPTY_RESULT', () => {
  it('no-match calls return the shared frozen EMPTY_RESULT (zero allocation)', () => {
    const engine = engineWith(styleRule({ id: 'A', priority: 1 }));
    const r1 = engine.evaluateCell(ctx({ row: { pnl: 5 } })); // condition false
    const r2 = engine.evaluateCell(ctx({ row: { pnl: 7 }, rowId: 'row-2' }));
    const r3 = engine.evaluateCell(ctx({ colId: 'untargeted' })); // no candidates
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(Object.isFrozen(r1)).toBe(true);
    expect(r1.matched).toEqual([]);
  });
});

// ─── Per-rule valueFormatter ────────────────────────────────────────────

describe('RuleEngine — valueFormatter', () => {
  it("winning rule's valueFormatter compiles to a live FormatProgram", () => {
    const engine = engineWith(styleRule({ id: 'fmt', priority: 1, valueFormatter: '0.00%' }));
    const res = engine.evaluateCell(ctx());
    expect(res.formatProgram).not.toBeNull();
    expect(
      res.formatProgram!.formatText({ value: 0.1234, row: ctx().row, colId: 'pnl' }),
    ).toBe('12.34%');
  });
});

// ─── resolveRuleRef ─────────────────────────────────────────────────────

describe('RuleEngine — resolveRuleRef', () => {
  const themed = styleRule({
    id: 'ref',
    priority: 1,
    style: { base: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
  });

  it('matching + enabled → theme-resolved style.color', () => {
    const engine = engineWith(themed);
    expect(engine.resolveRuleRef('ref', ctx())).toBe('#c62828');
    expect(engine.resolveRuleRef('ref', ctx({ theme: 'dark' }))).toBe('#ef9a9a');
  });

  it('non-matching ctx → null', () => {
    expect(engineWith(themed).resolveRuleRef('ref', ctx({ row: { pnl: 5 } }))).toBeNull();
  });

  it('unknown ruleId → null', () => {
    expect(engineWith(themed).resolveRuleRef('nope', ctx())).toBeNull();
  });

  it('disabled rule → null', () => {
    expect(engineWith({ ...themed, enabled: false }).resolveRuleRef('ref', ctx())).toBeNull();
  });

  it('matching rule without a color channel → null', () => {
    const engine = engineWith(
      styleRule({ id: 'nc', priority: 1, style: { base: { fontWeight: 'bold' } } }),
    );
    expect(engine.resolveRuleRef('nc', ctx())).toBeNull();
  });

  it('indicator rules carry no style → null', () => {
    const ind: IndicatorRule = {
      kind: 'indicator',
      id: 'ind',
      name: 'ind',
      enabled: true,
      priority: 1,
      condition: '[pnl] < 0',
      scope: { kind: 'row' },
      indicator: { iconName: 'star', color: '#fbc02d', target: 'row-start', position: 'before' },
    };
    expect(engineWith(ind).resolveRuleRef('ind', ctx())).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it FAIL**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/ruleEngine.test.ts
```

Expected: FAIL — all 16 tests throw `not-yet-implemented: RuleEngine ships in Task 3` from the skeleton constructor.

- [ ] **Step 3: Implement — replace `packages/rules/src/ruleEngine.ts`**

Full file:

```ts
// RuleEngine — setRules compile + indexes, evaluateCell fold, theme
// resolution, resolveRuleRef. Match counts / transactions land in Task 4;
// expiry + flash directives in Task 5 (their methods still throw here).
//
// Authoritative reference:
// docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §3.5 + §4.2.

import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { compileFormat } from '@wellsfargo-starui/velocity-grid-format';
import type { FormatProgram } from '@wellsfargo-starui/velocity-grid-format';
import { compileCondition, validateRuleShape } from './conditionCompiler';
import type { CompiledCondition } from './conditionCompiler';
import type {
  FlashDirective,
  RowChangeSet,
  RuleCellResult,
  RuleEvalContext,
  RuleIndicator,
  RuleValidationError,
  SetRulesResult,
  StyleRule,
  StyleSlice,
  ThemeAwareStyle,
  ThemeKind,
  Unsubscribe,
} from './types';

interface IndexedRule {
  rule: StyleRule;
  condition: CompiledCondition;
  /** Compiled valueFormatter (style rules only); null when absent. */
  formatProgram: FormatProgram | null;
  /** Position in the setRules array — stable tiebreak for equal priority. */
  order: number;
}

function byPriority(a: IndexedRule, b: IndexedRule): number {
  return a.rule.priority - b.rule.priority || a.order - b.order;
}

/** base ⊕ theme slice, per-property (ThemeAwareStyle contract, spec §3.1). */
function resolveThemeStyle(style: ThemeAwareStyle, theme: ThemeKind): StyleSlice | null {
  const slice = theme === 'dark' ? style.dark : style.light;
  if (!style.base) return slice ?? null;
  if (!slice) return style.base;
  return { ...style.base, ...slice };
}

const EMPTY_MATCHED: string[] = [];
Object.freeze(EMPTY_MATCHED);

/** Shared zero-allocation result for cells no rule matches (spec §4.2). */
const EMPTY_RESULT: RuleCellResult = Object.freeze({
  matched: EMPTY_MATCHED,
  style: null,
  indicator: null,
  formatProgram: null,
});

export class RuleEngine {
  #schema: Schema | undefined;
  /** Full supplied set — incl. invalid + disabled (serializable snapshot). */
  #rules: StyleRule[] = [];
  /** Enabled, valid, compiled rules — priority asc, stable. */
  #indexed: IndexedRule[] = [];
  #byId = new Map<string, IndexedRule>();
  #cellByColId = new Map<string, IndexedRule[]>();
  #rowScope: IndexedRule[] = [];
  /** Lazily merged (row-scope + cell-scope) candidate lists per colId. */
  #mergedByColId = new Map<string, IndexedRule[]>();
  /** Row-scope condition memo, keyed by row object identity (paint pass). */
  #rowMemo = new WeakMap<Record<string, unknown>, Map<string, boolean>>();
  /** Eval errors per ruleId since last setRules (getter ships in Task 4). */
  #evalErrors = new Map<string, number>();

  constructor(opts?: { schema?: Schema; now?: () => number }) {
    this.#schema = opts?.schema;
    // opts.now is consumed by Task 5 (expiry heap); accepted from the first
    // shipped task so the constructor contract is stable.
  }

  /** Replace the rule set. Invalid rules are skipped + reported; valid rules apply. */
  setRules(rules: StyleRule[]): SetRulesResult {
    const errors: RuleValidationError[] = [];
    const indexed: IndexedRule[] = [];
    for (let order = 0; order < rules.length; order++) {
      const rule = rules[order];
      const ruleErrors = validateRuleShape(rule);
      let formatProgram: FormatProgram | null = null;
      if (rule.kind === 'style' && typeof rule.valueFormatter === 'string') {
        const fmt = compileFormat(rule.valueFormatter);
        if (fmt.ok) {
          formatProgram = fmt.program;
        } else {
          ruleErrors.push({
            ruleId: rule.id,
            code: 'format-compile',
            message: fmt.error.message,
            loc: fmt.error.loc,
          });
        }
      }
      let condition: CompiledCondition | null = null;
      if (typeof rule.condition === 'string' && rule.condition.trim().length > 0) {
        const res = compileCondition(rule.condition, rule.id, this.#schema, {
          onEvalError: () =>
            this.#evalErrors.set(rule.id, (this.#evalErrors.get(rule.id) ?? 0) + 1),
        });
        if (res.ok) condition = res.compiled;
        else ruleErrors.push(res.error);
      }
      if (ruleErrors.length > 0 || condition === null) {
        errors.push(...ruleErrors);
        continue; // invalid rule skipped; valid ones still apply
      }
      if (rule.enabled) indexed.push({ rule, condition, formatProgram, order });
    }
    indexed.sort(byPriority);

    this.#rules = rules.slice();
    this.#indexed = indexed;
    this.#byId = new Map(indexed.map((ir) => [ir.rule.id, ir]));
    this.#cellByColId = new Map();
    this.#rowScope = [];
    for (const ir of indexed) {
      if (ir.rule.scope.kind === 'row') {
        this.#rowScope.push(ir);
      } else {
        for (const colId of ir.rule.scope.columnIds) {
          let list = this.#cellByColId.get(colId);
          if (!list) {
            list = [];
            this.#cellByColId.set(colId, list);
          }
          list.push(ir);
        }
      }
    }
    this.#mergedByColId = new Map();
    this.#rowMemo = new WeakMap();
    this.#evalErrors = new Map();
    return { ok: errors.length === 0, errors };
  }

  getRules(): StyleRule[] {
    return this.#rules.slice();
  }

  /** Paint-path entry. Pure w.r.t. engine state; cheap when no rules target the cell. */
  evaluateCell(ctx: RuleEvalContext): RuleCellResult {
    const candidates = this.#candidatesFor(ctx.colId);
    if (candidates.length === 0) return EMPTY_RESULT;
    let matched: string[] | null = null;
    let style: StyleSlice | null = null;
    let indicator: RuleIndicator | null = null;
    let formatProgram: FormatProgram | null = null;
    for (const ir of candidates) {
      if (!this.#ruleMatches(ir, ctx)) continue;
      (matched ??= []).push(ir.rule.id);
      if (ir.rule.kind === 'style') {
        const slice = resolveThemeStyle(ir.rule.style, ctx.theme);
        if (slice) style = style ? { ...style, ...slice } : { ...slice };
        if (ir.rule.indicator) indicator = ir.rule.indicator;
        if (ir.formatProgram) formatProgram = ir.formatProgram;
      } else {
        indicator = ir.rule.indicator; // last matching indicator wins
      }
    }
    if (matched === null) return EMPTY_RESULT;
    return { matched, style, indicator, formatProgram };
  }

  /** rule:<ruleId> color accessor for @wellsfargo-starui/velocity-grid-format (Task 9 threads it).
   *  Condition-level match — scope column targeting governs where the rule
   *  paints, not whether a format rule-ref may read its color. */
  resolveRuleRef(ruleId: string, ctx: RuleEvalContext): string | null {
    const ir = this.#byId.get(ruleId); // only enabled+valid rules are indexed
    if (!ir || ir.rule.kind !== 'style') return null;
    if (!this.#ruleMatches(ir, ctx)) return null;
    const slice = resolveThemeStyle(ir.rule.style, ctx.theme);
    return slice?.color ?? null;
  }

  #candidatesFor(colId: string | null): IndexedRule[] {
    if (colId === null) return this.#rowScope;
    let merged = this.#mergedByColId.get(colId);
    if (merged === undefined) {
      const cell = this.#cellByColId.get(colId);
      if (!cell || cell.length === 0) merged = this.#rowScope;
      else if (this.#rowScope.length === 0) merged = cell;
      else merged = [...this.#rowScope, ...cell].sort(byPriority);
      this.#mergedByColId.set(colId, merged);
    }
    return merged;
  }

  /** Single matching gate for evaluateCell + resolveRuleRef.
   *  Task 4 reroutes this through the diff-map injection; Task 5 adds the
   *  activeDurationMs window check. */
  #ruleMatches(ir: IndexedRule, ctx: RuleEvalContext): boolean {
    if (ir.rule.scope.kind === 'row') {
      let memo = this.#rowMemo.get(ctx.row);
      if (!memo) {
        memo = new Map();
        this.#rowMemo.set(ctx.row, memo);
      }
      const hit = memo.get(ir.rule.id);
      if (hit !== undefined) return hit;
      const res = ir.condition.matches(ctx.row);
      memo.set(ir.rule.id, res);
      return res;
    }
    return ir.condition.matches(ctx.row);
  }

  // ─── Tasks 4–5 ─────────────────────────────────────────────────────────

  matchCount(_ruleId: string): number {
    throw new Error('not-yet-implemented: matchCount ships in Task 4');
  }
  recount(_rows: Iterable<{ rowId: string; row: Record<string, unknown> }>): void {
    throw new Error('not-yet-implemented: recount ships in Task 4');
  }
  applyChanges(_changes: RowChangeSet): FlashDirective[] {
    throw new Error('not-yet-implemented: applyChanges ships in Task 4');
  }
  endTick(): void {
    throw new Error('not-yet-implemented: endTick ships in Task 4');
  }
  onExpire(
    _fn: (cells: Array<{ rowId: string; colId: string | null }>) => void,
  ): Unsubscribe {
    throw new Error('not-yet-implemented: onExpire ships in Task 5');
  }
  evalErrorCount(_ruleId: string): number {
    throw new Error('not-yet-implemented: evalErrorCount ships in Task 4');
  }
}
```

- [ ] **Step 4: Run to see it PASS**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/ruleEngine.test.ts
```

Expected: 16/16 PASS.

- [ ] **Step 5: Full package suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run && npx tsc --noEmit
```

Expected: 43/43 PASS (3 types + 24 conditionCompiler + 16 ruleEngine); typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "feat(rules): cycle 21e task 3 — RuleEngine evaluateCell fold, theme resolution, resolveRuleRef"
```

---

### Task 4: Match counting + change application + tick-scoped diff map

**Files:**
- Modify: `packages/rules/src/matchCounter.ts` (replace skeleton)
- Modify: `packages/rules/src/ruleEngine.ts` (implement `recount` / `applyChanges` / `endTick` / `matchCount` / `evalErrorCount`)
- Test: `packages/rules/tests/matchCounter.test.ts` (new)
- Test: `packages/rules/tests/ruleEngine.test.ts` (extend)

**Interfaces:**
- Consumes:
    - Task 2: `CompiledCondition.diffAware`, `DIFF_ROOT` injection contract (`{ ...row, __cgridDiff: { [colId]: { old } } }`)
    - Task 3: `#indexed` / `#ruleMatches` seam, `#evalErrors` wiring
    - `./types`: `RowChangeSet`, `ChangeRecord`, `FlashDirective`, `ConditionalStyleRule`
- Produces (for Tasks 5, 15, 16):
    - `MatchCounter` — `count(ruleId): number`, `resetAll(): void`, `setRowMatches(ruleId, rowId, n): void` (adjusts the total by exactly `n − previous contribution`), `dropRow(rowId): void`. Signatures identical to the Task-1 skeleton.
    - `RuleEngine.recount(rows)` / `matchCount(ruleId)` / `evalErrorCount(ruleId)` — working.
    - `RuleEngine.applyChanges(changes): FlashDirective[]` — diff map + incremental counts + activation detection; returns `[]` in this task (Task 5 fills directives from the `#activations` seam).
    - `RuleEngine.endTick()` — clears the diff map + zeroes diff-aware contributions for affected rows.
    - Private seam for Task 5: `#activations: Array<{ rule: ConditionalStyleRule; rowId: string }>` populated per false→true transition, cleared at the end of every `applyChanges`.

Semantics locked/documented in this task:
- **Diff map** `#diffByRowId: Map<rowId, Record<colId, { old }>>` is tick-scoped (spec §3.4). When the same cell changes twice within one tick, the FIRST `oldValue` wins — `.old` means "value at tick start".
- **Diff injection at eval:** diff-aware conditions evaluate against `{ ...row, __cgridDiff: diffForRow }`; the merged object is cached per `(rowId, row-reference)` within the tick (`#mergedRowCache`), invalidated on update/removal/endTick. Diff-aware rules never match quiescent rows: no diff entry → no evaluation at all (spec §3.4 "can never match a quiescent cell"). Diff-aware rules skip the row-scope memo (they are the minority and their inputs are tick-scoped).
- **Contribution model:** per (rule, row) — row scope contributes 1 when matched; cell scope contributes `scope.columnIds.length` (the condition is row-level, so it matches all scoped cells or none). `matchCount` = sum of contributions. `matchCount` reflects *condition* matches; Task 5's activeDurationMs paint windows deliberately do not inflate counts (documented on `matchCount`).
- **Activation tracking:** only rules that consume activations are tracked — style rules with `flash?.enabled` or `activeDurationMs` set (`#activationTracked`). `#lastMatch: Map<ruleId, Set<rowId>>` stores ONLY currently-true pairs — memory bound O(tracked rules × matching rows). Detection is per (rule, rowId); expansion to colIds happens at directive/expiry time (equivalent to per-(rule,rowId,colId) detection because the condition is row-level). Added rows whose condition matches count as activations (false→true from absence); rows removed drop their `#lastMatch` entries.
- **endTick decay:** matches based on `.old` naturally decay at paint once the diff clears — their rewritten conditions read `[__cgridDiff.col.old]`, which resolves `null` after the clear (and the quiescent-row gate skips them entirely). Match counts are *eager* state though, so endTick force-recounts diff-aware rule contributions to 0 for the affected rows, and resets their `#lastMatch` entries so the next tick's change re-activates (each change flashes again).

- [ ] **Step 1: Write the failing test `packages/rules/tests/matchCounter.test.ts`**

Full test file:

```ts
import { describe, expect, it } from 'vitest';
import { MatchCounter } from '../src/matchCounter';

describe('MatchCounter', () => {
  it('starts at zero for unknown rules', () => {
    expect(new MatchCounter().count('nope')).toBe(0);
  });

  it('sums per-row contributions per rule', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 2);
    c.setRowMatches('r1', 'b', 1);
    c.setRowMatches('r2', 'a', 1);
    expect(c.count('r1')).toBe(3);
    expect(c.count('r2')).toBe(1);
  });

  it('re-setting a contribution adjusts the total exactly', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 2);
    c.setRowMatches('r1', 'a', 2); // no-op
    expect(c.count('r1')).toBe(2);
    c.setRowMatches('r1', 'a', 5);
    expect(c.count('r1')).toBe(5);
    c.setRowMatches('r1', 'a', 0);
    expect(c.count('r1')).toBe(0);
  });

  it('dropRow removes every rule contribution for that row (idempotent)', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 2);
    c.setRowMatches('r2', 'a', 1);
    c.setRowMatches('r1', 'b', 4);
    c.dropRow('a');
    expect(c.count('r1')).toBe(4);
    expect(c.count('r2')).toBe(0);
    c.dropRow('a'); // idempotent
    expect(c.count('r1')).toBe(4);
  });

  it('resetAll clears totals and contributions', () => {
    const c = new MatchCounter();
    c.setRowMatches('r1', 'a', 3);
    c.resetAll();
    expect(c.count('r1')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see it FAIL**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/matchCounter.test.ts
```

Expected: FAIL — all 5 tests throw `not-yet-implemented: MatchCounter ships in Task 4`.

- [ ] **Step 3: Implement — replace `packages/rules/src/matchCounter.ts`**

Full file:

```ts
// Match-count bookkeeping: per-rule totals + per-(rule,row) contribution
// map, so incremental updates and row removals adjust totals exactly.
//
// Authoritative reference: spec §1.1 item 4 (live match count).

export class MatchCounter {
  /** ruleId → total matched cells across the dataset. */
  #totals = new Map<string, number>();
  /** rowId → (ruleId → contribution). Zero contributions are not stored. */
  #byRow = new Map<string, Map<string, number>>();

  count(ruleId: string): number {
    return this.#totals.get(ruleId) ?? 0;
  }

  resetAll(): void {
    this.#totals.clear();
    this.#byRow.clear();
  }

  setRowMatches(ruleId: string, rowId: string, n: number): void {
    let rowMap = this.#byRow.get(rowId);
    const prev = rowMap?.get(ruleId) ?? 0;
    if (prev === n) return;
    if (n === 0) {
      rowMap!.delete(ruleId); // prev !== 0 implies rowMap exists
      if (rowMap!.size === 0) this.#byRow.delete(rowId);
    } else {
      if (!rowMap) {
        rowMap = new Map();
        this.#byRow.set(rowId, rowMap);
      }
      rowMap.set(ruleId, n);
    }
    this.#totals.set(ruleId, (this.#totals.get(ruleId) ?? 0) - prev + n);
  }

  dropRow(rowId: string): void {
    const rowMap = this.#byRow.get(rowId);
    if (!rowMap) return;
    for (const [ruleId, n] of rowMap) {
      this.#totals.set(ruleId, (this.#totals.get(ruleId) ?? 0) - n);
    }
    this.#byRow.delete(rowId);
  }
}
```

- [ ] **Step 4: Run to see it PASS**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/matchCounter.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Append the failing engine tests to `packages/rules/tests/ruleEngine.test.ts`**

Append these describe blocks (the `styleRule` / `ctx` fixtures at the top of the file are reused):

```ts
// ─── Task 4: match counting ─────────────────────────────────────────────

describe('RuleEngine — match counting (Task 4)', () => {
  const countRules: StyleRule[] = [
    styleRule({ id: 'neg', priority: 10 }), // [pnl] < 0, cell scope ['pnl']
    {
      kind: 'style',
      id: 'big',
      name: 'big',
      enabled: true,
      priority: 20,
      condition: '[price] > 100',
      scope: { kind: 'row' },
      style: { base: { backgroundColor: '#fff3e0' } },
    },
  ];
  const seedRows = [
    { rowId: 'a', row: { pnl: -1, price: 50 } },
    { rowId: 'b', row: { pnl: 3, price: 150 } },
    { rowId: 'c', row: { pnl: -9, price: 200 } },
  ];

  it('recount equals replaying the same rows as an applyChanges add stream (parity)', () => {
    const full = new RuleEngine();
    full.setRules(countRules);
    full.recount(seedRows);

    const incremental = new RuleEngine();
    incremental.setRules(countRules);
    for (const r of seedRows) {
      incremental.applyChanges({ added: [r], updated: [], removed: [] });
    }
    for (const ruleId of ['neg', 'big']) {
      expect(incremental.matchCount(ruleId)).toBe(full.matchCount(ruleId));
    }
    expect(full.matchCount('neg')).toBe(2); // rows a + c, one cell each
    expect(full.matchCount('big')).toBe(2); // rows b + c, row scope
  });

  it('removal decrements; update flips', () => {
    const engine = new RuleEngine();
    engine.setRules(countRules);
    engine.recount(seedRows);
    engine.applyChanges({ added: [], updated: [], removed: [{ rowId: 'c', row: seedRows[2].row }] });
    expect(engine.matchCount('neg')).toBe(1);
    expect(engine.matchCount('big')).toBe(1);
    engine.applyChanges({
      added: [],
      removed: [],
      updated: [
        {
          rowId: 'a',
          row: { pnl: 5, price: 50 },
          cells: [{ rowId: 'a', colId: 'pnl', oldValue: -1, newValue: 5 }],
        },
      ],
    });
    expect(engine.matchCount('neg')).toBe(0);
  });
});

// ─── Task 4: tick-scoped diff map ───────────────────────────────────────

describe('RuleEngine — tick-scoped diff map (Task 4)', () => {
  const tickRule: ConditionalStyleRule = {
    kind: 'style',
    id: 'up',
    name: 'up',
    enabled: true,
    priority: 10,
    condition: '[price.old] != null AND [price] > [price.old]',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { color: '#2e7d32' } },
  };

  it('[price.old] matches during the tick, stops after endTick; counts follow', () => {
    const engine = new RuleEngine();
    engine.setRules([tickRule]);
    const row = { price: 105 };
    engine.recount([{ rowId: 'a', row }]);
    expect(engine.matchCount('up')).toBe(0); // quiescent — diff-aware can't match

    engine.applyChanges({
      added: [],
      removed: [],
      updated: [
        { rowId: 'a', row, cells: [{ rowId: 'a', colId: 'price', oldValue: 100, newValue: 105 }] },
      ],
    });
    const during = engine.evaluateCell({ row, rowId: 'a', colId: 'price', theme: 'light' });
    expect(during.matched).toEqual(['up']);
    expect(engine.matchCount('up')).toBe(1);

    engine.endTick();
    const after = engine.evaluateCell({ row, rowId: 'a', colId: 'price', theme: 'light' });
    expect(after.matched).toEqual([]); // .old resolves null after the clear
    expect(engine.matchCount('up')).toBe(0); // eager counts force-recounted
  });

  it('evalErrorCount increments when a condition throws EvalError', () => {
    const engine = new RuleEngine();
    engine.setRules([
      {
        kind: 'style',
        id: 'div',
        name: 'div',
        enabled: true,
        priority: 1,
        condition: '[a] / [b] > 0',
        scope: { kind: 'row' },
        style: { base: { color: '#000000' } },
      },
    ]);
    expect(engine.evalErrorCount('div')).toBe(0);
    const res = engine.evaluateCell({ row: { a: 1, b: 0 }, rowId: 'x', colId: null, theme: 'light' });
    expect(res.matched).toEqual([]); // div-by-zero → non-matching
    expect(engine.evalErrorCount('div')).toBe(1);
  });
});
```

Run to see them FAIL:

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/ruleEngine.test.ts
```

Expected: 16 pass (Task 3), 4 FAIL with `not-yet-implemented: recount ships in Task 4` / `matchCount` / `applyChanges` / `evalErrorCount` throws.

- [ ] **Step 6: Implement the engine additions in `packages/rules/src/ruleEngine.ts`**

Add imports at the top of the file:

```ts
import { MatchCounter } from './matchCounter';
import type { ConditionalStyleRule } from './types'; // merge into the existing ./types import
```

Add fields after `#evalErrors`:

```ts
  #counter = new MatchCounter();
  /** Tick-scoped diff map: rowId → { [colId]: { old } } (spec §3.4).
   *  First oldValue of the tick wins — '.old' = value at tick start. */
  #diffByRowId = new Map<string, Record<string, { old: unknown }>>();
  /** Merged { ...row, __cgridDiff } per rowId within a tick. */
  #mergedRowCache = new Map<string, { source: Record<string, unknown>; merged: Record<string, unknown> }>();
  /** Style rules with flash?.enabled or activeDurationMs — the only
   *  consumers of activations. */
  #activationTracked: IndexedRule[] = [];
  /** Currently-true (rule → rows) pairs for activation-tracked rules only.
   *  Memory bound: O(tracked rules × matching rows). */
  #lastMatch = new Map<string, Set<string>>();
  /** Activations collected during applyChanges. Task 5 fills directives from these. */
  #activations: Array<{ rule: ConditionalStyleRule; rowId: string }> = [];
```

Replace the tail of `setRules` — everything from `indexed.sort(byPriority);` through the `return` — with (adds `#activationTracked` + transaction-state resets):

```ts
    indexed.sort(byPriority);

    this.#rules = rules.slice();
    this.#indexed = indexed;
    this.#byId = new Map(indexed.map((ir) => [ir.rule.id, ir]));
    this.#cellByColId = new Map();
    this.#rowScope = [];
    for (const ir of indexed) {
      if (ir.rule.scope.kind === 'row') {
        this.#rowScope.push(ir);
      } else {
        for (const colId of ir.rule.scope.columnIds) {
          let list = this.#cellByColId.get(colId);
          if (!list) {
            list = [];
            this.#cellByColId.set(colId, list);
          }
          list.push(ir);
        }
      }
    }
    this.#activationTracked = indexed.filter(
      (ir) =>
        ir.rule.kind === 'style' &&
        (ir.rule.flash?.enabled === true || ir.rule.activeDurationMs != null),
    );
    this.#mergedByColId = new Map();
    this.#rowMemo = new WeakMap();
    this.#evalErrors = new Map();
    this.#counter.resetAll(); // caller re-seeds via recount (bridge does, Task 15)
    this.#lastMatch = new Map();
    this.#activations = [];
    return { ok: errors.length === 0, errors };
```

Replace `#ruleMatches` with the diff-injecting pair (the paint gate delegates to a rowId/row-based matcher shared with counting):

```ts
  /** Single matching gate for evaluateCell + resolveRuleRef.
   *  Task 5 adds the activeDurationMs window check here. */
  #ruleMatches(ir: IndexedRule, ctx: RuleEvalContext): boolean {
    return this.#conditionMatches(ir, ctx.rowId, ctx.row);
  }

  /** Shared by the paint path and the eager counting path. */
  #conditionMatches(ir: IndexedRule, rowId: string, row: Record<string, unknown>): boolean {
    if (ir.condition.diffAware) {
      // Diff-aware rules never match quiescent rows (spec §3.4) and skip
      // the row-scope memo — their inputs are tick-scoped.
      const diff = this.#diffByRowId.get(rowId);
      if (diff === undefined) return false;
      return ir.condition.matches(this.#evalRow(rowId, row, diff));
    }
    if (ir.rule.scope.kind === 'row') {
      let memo = this.#rowMemo.get(row);
      if (!memo) {
        memo = new Map();
        this.#rowMemo.set(row, memo);
      }
      const hit = memo.get(ir.rule.id);
      if (hit !== undefined) return hit;
      const res = ir.condition.matches(row);
      memo.set(ir.rule.id, res);
      return res;
    }
    return ir.condition.matches(row);
  }

  /** { ...row, __cgridDiff } — built once per (rowId, row-reference) per tick. */
  #evalRow(
    rowId: string,
    row: Record<string, unknown>,
    diff: Record<string, { old: unknown }>,
  ): Record<string, unknown> {
    const cached = this.#mergedRowCache.get(rowId);
    if (cached && cached.source === row) return cached.merged;
    const merged = { ...row, __cgridDiff: diff };
    this.#mergedRowCache.set(rowId, { source: row, merged });
    return merged;
  }
```

Replace the `matchCount` / `recount` / `applyChanges` / `endTick` / `evalErrorCount` skeleton throws with:

```ts
  /** Live "APP N" count over the dataset last supplied via recount/applyChanges.
   *  Reflects CONDITION matches; Task 5's activeDurationMs paint windows do
   *  not inflate counts. */
  matchCount(ruleId: string): number {
    return this.#counter.count(ruleId);
  }

  evalErrorCount(ruleId: string): number {
    return this.#evalErrors.get(ruleId) ?? 0;
  }

  /** Full-dataset scan (rule change / initial wire). Rebuilds all match counts. */
  recount(rows: Iterable<{ rowId: string; row: Record<string, unknown> }>): void {
    this.#counter.resetAll();
    for (const { rowId, row } of rows) this.#recountRow(rowId, row);
  }

  #recountRow(rowId: string, row: Record<string, unknown>): void {
    for (const ir of this.#indexed) {
      this.#counter.setRowMatches(ir.rule.id, rowId, this.#contribution(ir, rowId, row));
    }
  }

  /** Cells this rule matches on this row: row scope → 1; cell scope → one
   *  per scoped colId (the condition is row-level — all or none). */
  #contribution(ir: IndexedRule, rowId: string, row: Record<string, unknown>): number {
    if (!this.#conditionMatches(ir, rowId, row)) return 0;
    return ir.rule.scope.kind === 'row' ? 1 : ir.rule.scope.columnIds.length;
  }

  /** Transaction feed: updates the tick-scoped diff map, match counts
   *  (incremental), and activation state. Flash directives land in Task 5. */
  applyChanges(changes: RowChangeSet): FlashDirective[] {
    // (a) Diff map — the '__cgridDiff' object the rewritten conditions read.
    // Shape: { [colId]: { old } }. First old of the tick wins.
    for (const u of changes.updated) {
      if (u.cells.length === 0) continue;
      let diff = this.#diffByRowId.get(u.rowId);
      if (!diff) {
        diff = {};
        this.#diffByRowId.set(u.rowId, diff);
      }
      for (const cell of u.cells) {
        if (!(cell.colId in diff)) diff[cell.colId] = { old: cell.oldValue };
      }
      this.#mergedRowCache.delete(u.rowId); // row reference changed — rebuild lazily
    }

    // (b) + (c) incremental recount with activation detection. Added rows
    // whose condition matches count as activations (false→true from absence).
    for (const a of changes.added) {
      this.#detectActivations(a.rowId, a.row);
      this.#recountRow(a.rowId, a.row);
    }
    for (const u of changes.updated) {
      this.#detectActivations(u.rowId, u.row);
      this.#recountRow(u.rowId, u.row);
    }
    for (const r of changes.removed) {
      this.#counter.dropRow(r.rowId);
      this.#diffByRowId.delete(r.rowId);
      this.#mergedRowCache.delete(r.rowId);
      for (const rowStates of this.#lastMatch.values()) rowStates.delete(r.rowId);
    }

    // Task 5 fills directives from #activations (flash + activeDurationMs).
    this.#activations.length = 0;
    return [];
  }

  #detectActivations(rowId: string, row: Record<string, unknown>): void {
    for (const ir of this.#activationTracked) {
      const matchesNow = this.#conditionMatches(ir, rowId, row);
      let rowStates = this.#lastMatch.get(ir.rule.id);
      const prev = rowStates?.has(rowId) === true;
      if (matchesNow && !prev) {
        // #activationTracked only holds style rules (see setRules filter).
        this.#activations.push({ rule: ir.rule as ConditionalStyleRule, rowId });
      }
      if (matchesNow) {
        if (!rowStates) {
          rowStates = new Set();
          this.#lastMatch.set(ir.rule.id, rowStates);
        }
        rowStates.add(rowId);
      } else {
        rowStates?.delete(rowId);
      }
    }
  }

  /** Clears the tick-scoped diff map. Bridge calls after the post-transaction
   *  repaint (Task 15). Paint-side, diff-aware matches decay naturally: their
   *  conditions read [col.old] → null once cleared (and the quiescent-row
   *  gate skips them). Counts are eager state, so force diff-aware
   *  contributions back to zero for affected rows; lastMatch resets so the
   *  next tick's change re-activates. */
  endTick(): void {
    if (this.#diffByRowId.size === 0) return;
    const affected = [...this.#diffByRowId.keys()];
    this.#diffByRowId.clear();
    this.#mergedRowCache.clear();
    for (const ir of this.#indexed) {
      if (!ir.condition.diffAware) continue;
      const rowStates = this.#lastMatch.get(ir.rule.id);
      for (const rowId of affected) {
        this.#counter.setRowMatches(ir.rule.id, rowId, 0);
        rowStates?.delete(rowId);
      }
    }
  }
```

- [ ] **Step 7: Run to see it PASS**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/ruleEngine.test.ts tests/matchCounter.test.ts
```

Expected: ruleEngine 20/20, matchCounter 5/5.

- [ ] **Step 8: Full package suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run && npx tsc --noEmit
```

Expected: 52/52 PASS (3 types + 24 conditionCompiler + 20 ruleEngine + 5 matchCounter); typecheck clean.

- [ ] **Step 9: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "feat(rules): cycle 21e task 4 — match counting, applyChanges, tick-scoped diff map"
```

---

### Task 5: Expiry heap, activeDurationMs, flash directives

**Files:**
- Modify: `packages/rules/src/expiryHeap.ts` (replace skeleton)
- Modify: `packages/rules/src/ruleEngine.ts` (constructor timers, `onExpire`, active-window matching, directive emission)
- Create: `packages/rules/tests/helpers/fakeClock.ts` (shared deterministic clock/timer harness — not matched by the `tests/**/*.test.ts` include, so it adds no test count)
- Test: `packages/rules/tests/expiryHeap.test.ts` (new)
- Test: `packages/rules/tests/ruleEngine.test.ts` (extend)

**Interfaces:**
- Consumes:
    - Task 4: `#activations` seam, `#activationTracked`, diff-map lifecycle
    - Task 1 skeleton: `ExpiryEntry = { deadline: number; rowId: string; colId: string | null; ruleId: string }`
- Produces (for Tasks 15, 16):
    - `ExpiryHeap` — binary min-heap on `deadline` with injectable `now`/`setTimer`/`clearTimer`, ONE pending timer armed for the heap top (re-armed on earlier push), `push(e)`, `isActive(rowId, colId, ruleId)` keyed `` `${rowId} ${colId ?? ''} ${ruleId}` ``, `onExpire(fn): () => void` batching all entries with `deadline <= now()`, `clear()`. Signatures identical to the Task-1 skeleton.
    - `RuleEngine` constructor — updated skeleton-compatible signature (existing `{ schema?, now? }` call sites keep working):
      ```ts
      constructor(opts?: {
        schema?: Schema;
        now?: () => number;                                   // default: () => globalThis.performance?.now() ?? 0
        setTimer?: (fn: () => void, ms: number) => unknown;   // default: setTimeout
        clearTimer?: (h: unknown) => void;                    // default: clearTimeout
      })
      ```
    - `RuleEngine.onExpire(fn): Unsubscribe` — heap expiries mapped to `{ rowId, colId }` cells for bridge repaint.
    - `RuleEngine.applyChanges` now returns real `FlashDirective[]`.

Semantics locked/documented in this task:
- **Default clock:** a lazy `performance.now` wrapper — NOT `Date.now()` (engines stay Date-free, Global Constraints; `?? 0` keeps exotic hosts safe). Timer defaults are `setTimeout`/`clearTimeout`; the bridge never needs to pass them, tests always do.
- **Re-push extends:** `#active` maps key → latest deadline; superseded heap entries are skipped lazily at flush (`#active.get(key) !== entry.deadline`), so extending a window never fires a spurious early expiry.
- **activeDurationMs matching:** a rule with `activeDurationMs` matches when (condition matches now) OR `isActive(rowId, activeColId, ruleId)` — the match stays active for the window after activation even though endTick cleared the tick's diff (spec §3.1 "blink-on-change"). `activeColId` is `null` for row-scope rules, the evaluated `ctx.colId` for cell scope (entries are pushed per scoped colId). After expiry the rule stops matching and `onExpire` notifies the affected cells for repaint. Windows do not inflate `matchCount` (documented in Task 4).
- **Flash directives:** emitted only for activations (false→true transitions — Task 4's seam guarantees a condition that stays true across ticks emits nothing). Cell target → `colIds` = the rule's matched cell set (`scope.columnIds` copy; whole row when the rule is row-scope); row target → `colIds: null`. Color/mode/duration come from the rule's `FlashConfig`.
- `setRules` clears the heap (replaced rules void their windows).

- [ ] **Step 1: Create the shared fake clock `packages/rules/tests/helpers/fakeClock.ts`**

```ts
// Deterministic clock + manual timer harness for expiry tests.
// Tests may use fake clocks; src stays Date-free (Global Constraints).

export interface FakeClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  /** Move time to `to`, then fire due timers in due-time order (timers
   *  re-armed during a flush that are still due also fire). */
  advance: (to: number) => void;
  pendingTimerCount: () => number;
}

export function makeClock(): FakeClock {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    advance: (to) => {
      now = to;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Number.POSITIVE_INFINITY;
        for (const [id, t] of timers) {
          if (t.at <= now && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const due = timers.get(dueId)!;
        timers.delete(dueId);
        due.fn();
      }
    },
    pendingTimerCount: () => timers.size,
  };
}
```

- [ ] **Step 2: Write the failing test `packages/rules/tests/expiryHeap.test.ts`**

Full test file:

```ts
import { describe, expect, it } from 'vitest';
import { ExpiryHeap, type ExpiryEntry } from '../src/expiryHeap';
import { makeClock } from './helpers/fakeClock';

function make() {
  const clock = makeClock();
  const heap = new ExpiryHeap({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const batches: string[][] = [];
  heap.onExpire((expired) => batches.push(expired.map((e) => e.ruleId)));
  return { clock, heap, batches };
}

function entry(deadline: number, ruleId: string): ExpiryEntry {
  return { deadline, rowId: 'row', colId: 'col', ruleId };
}

describe('ExpiryHeap', () => {
  it('expires in deadline order regardless of push order', () => {
    const { clock, heap, batches } = make();
    heap.push(entry(30, 'r30'));
    heap.push(entry(10, 'r10'));
    heap.push(entry(20, 'r20'));
    clock.advance(100);
    expect(batches).toEqual([['r10', 'r20', 'r30']]); // one batch, deadline order
    expect(clock.pendingTimerCount()).toBe(0); // heap drained — no timer armed
  });

  it('re-arms the single pending timer when an earlier deadline arrives', () => {
    const { clock, heap, batches } = make();
    heap.push(entry(50, 'late'));
    expect(clock.pendingTimerCount()).toBe(1);
    heap.push(entry(20, 'early'));
    expect(clock.pendingTimerCount()).toBe(1); // coalesced — re-armed, not added
    clock.advance(20);
    expect(batches).toEqual([['early']]);
    expect(clock.pendingTimerCount()).toBe(1); // re-armed for 'late'
    clock.advance(50);
    expect(batches).toEqual([['early'], ['late']]);
  });

  it('batches all entries whose deadline <= now() into one callback', () => {
    const { clock, heap, batches } = make();
    heap.push({ deadline: 10, rowId: 'a', colId: 'p', ruleId: 'x' });
    heap.push({ deadline: 10, rowId: 'b', colId: 'p', ruleId: 'y' });
    clock.advance(10);
    expect(batches).toHaveLength(1);
    expect([...batches[0]].sort()).toEqual(['x', 'y']);
  });

  it('isActive is true inside the window, false at/after the deadline; colId is part of the key', () => {
    const { clock, heap } = make();
    heap.push({ deadline: 100, rowId: 'a', colId: 'price', ruleId: 'r' });
    expect(heap.isActive('a', 'price', 'r')).toBe(true);
    expect(heap.isActive('a', null, 'r')).toBe(false); // different key
    clock.advance(99);
    expect(heap.isActive('a', 'price', 'r')).toBe(true);
    clock.advance(100);
    expect(heap.isActive('a', 'price', 'r')).toBe(false);
  });

  it('re-pushing a key extends its window without a spurious early expiry', () => {
    const { clock, heap, batches } = make();
    heap.push({ deadline: 50, rowId: 'a', colId: 'p', ruleId: 'r' });
    heap.push({ deadline: 150, rowId: 'a', colId: 'p', ruleId: 'r' });
    clock.advance(60); // stale 50-entry pops but is superseded — no event
    expect(batches).toEqual([]);
    expect(heap.isActive('a', 'p', 'r')).toBe(true);
    clock.advance(150);
    expect(batches).toEqual([['r']]); // exactly one expiry, at the extended deadline
    expect(heap.isActive('a', 'p', 'r')).toBe(false);
  });

  it('clear() cancels the timer, the active set, and pending entries', () => {
    const { clock, heap, batches } = make();
    heap.push({ deadline: 40, rowId: 'a', colId: 'p', ruleId: 'r' });
    heap.clear();
    expect(clock.pendingTimerCount()).toBe(0);
    expect(heap.isActive('a', 'p', 'r')).toBe(false);
    clock.advance(1000);
    expect(batches).toEqual([]);
  });

  it('onExpire unsubscribe stops notifications', () => {
    const clock = makeClock();
    const heap = new ExpiryHeap({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const seen: string[][] = [];
    const un = heap.onExpire((expired) => seen.push(expired.map((e) => e.ruleId)));
    un();
    heap.push(entry(10, 'r'));
    clock.advance(20);
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to see it FAIL**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/expiryHeap.test.ts
```

Expected: FAIL — all 7 tests throw `not-yet-implemented: ExpiryHeap ships in Task 5`.

- [ ] **Step 4: Implement — replace `packages/rules/src/expiryHeap.ts`**

Full file:

```ts
// Binary min-heap of activation deadlines with ONE coalesced timer armed
// for the heap top. Injectable clock + timer fns keep the package Date-free
// (Global Constraints) and the tests deterministic. Expired entries ship in
// batches: every entry whose deadline <= now() at flush time.
//
// Authoritative reference: spec §1.1 item 8 (activeDurationMs auto-expire).

export interface ExpiryEntry {
  deadline: number;
  rowId: string;
  colId: string | null;
  ruleId: string;
}

function keyOf(rowId: string, colId: string | null, ruleId: string): string {
  return `${rowId} ${colId ?? ''} ${ruleId}`;
}

export class ExpiryHeap {
  #heap: ExpiryEntry[] = [];
  /** key → latest deadline. Re-pushing a key extends its window; superseded
   *  heap entries are skipped lazily at flush (deadline mismatch). */
  #active = new Map<string, number>();
  #subs = new Set<(expired: ExpiryEntry[]) => void>();
  #now: () => number;
  #setTimer: (fn: () => void, ms: number) => unknown;
  #clearTimer: (h: unknown) => void;
  #timer: unknown = null;
  #armedFor: number | null = null;

  constructor(opts: {
    now: () => number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (h: unknown) => void;
  }) {
    this.#now = opts.now;
    this.#setTimer = opts.setTimer;
    this.#clearTimer = opts.clearTimer;
  }

  push(e: ExpiryEntry): void {
    this.#active.set(keyOf(e.rowId, e.colId, e.ruleId), e.deadline);
    this.#heap.push(e);
    this.#siftUp(this.#heap.length - 1);
    this.#arm();
  }

  /** Currently-active (unexpired) key check: `rowId colId ruleId`. */
  isActive(rowId: string, colId: string | null, ruleId: string): boolean {
    const deadline = this.#active.get(keyOf(rowId, colId, ruleId));
    return deadline !== undefined && deadline > this.#now();
  }

  onExpire(fn: (expired: ExpiryEntry[]) => void): () => void {
    this.#subs.add(fn);
    return () => {
      this.#subs.delete(fn);
    };
  }

  clear(): void {
    this.#heap.length = 0;
    this.#active.clear();
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    this.#armedFor = null;
  }

  #arm(): void {
    const top = this.#heap[0];
    if (top === undefined) {
      if (this.#timer !== null) {
        this.#clearTimer(this.#timer);
        this.#timer = null;
        this.#armedFor = null;
      }
      return;
    }
    if (this.#timer !== null && this.#armedFor !== null && this.#armedFor <= top.deadline) {
      return; // already armed at-or-before the top — coalesced
    }
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#armedFor = top.deadline;
    this.#timer = this.#setTimer(() => this.#flush(), Math.max(0, top.deadline - this.#now()));
  }

  #flush(): void {
    this.#timer = null;
    this.#armedFor = null;
    const now = this.#now();
    const expired: ExpiryEntry[] = [];
    while (this.#heap.length > 0 && this.#heap[0].deadline <= now) {
      const e = this.#pop();
      const key = keyOf(e.rowId, e.colId, e.ruleId);
      if (this.#active.get(key) === e.deadline) {
        this.#active.delete(key);
        expired.push(e);
      }
      // else: superseded by a later re-push — stale entry, skip silently.
    }
    if (expired.length > 0) {
      for (const fn of [...this.#subs]) fn(expired);
    }
    this.#arm();
  }

  #pop(): ExpiryEntry {
    const top = this.#heap[0];
    const last = this.#heap.pop()!;
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#siftDown(0);
    }
    return top;
  }

  #siftUp(i: number): void {
    const heap = this.#heap;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].deadline <= heap[i].deadline) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  #siftDown(i: number): void {
    const heap = this.#heap;
    const n = heap.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && heap[left].deadline < heap[smallest].deadline) smallest = left;
      if (right < n && heap[right].deadline < heap[smallest].deadline) smallest = right;
      if (smallest === i) break;
      [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
      i = smallest;
    }
  }
}
```

- [ ] **Step 5: Run to see it PASS**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/expiryHeap.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 6: Append the failing engine tests to `packages/rules/tests/ruleEngine.test.ts`**

Add the import at the top of the file:

```ts
import { makeClock } from './helpers/fakeClock';
```

Append these describe blocks:

```ts
// ─── Task 5: activeDurationMs + flash directives ────────────────────────

describe('RuleEngine — activeDurationMs (Task 5)', () => {
  const blinkRule: ConditionalStyleRule = {
    kind: 'style',
    id: 'blink',
    name: 'blink',
    enabled: true,
    priority: 1,
    condition: '[price.old] != null',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { backgroundColor: '#fff9c4' } },
    activeDurationMs: 1000,
  };
  const oneTick = (row: Record<string, unknown>) => ({
    added: [],
    removed: [],
    updated: [
      { rowId: 'a', row, cells: [{ rowId: 'a', colId: 'price', oldValue: 100, newValue: 105 }] },
    ],
  });

  it('match survives endTick for the window, then expires with onExpire cells', () => {
    const clock = makeClock();
    const engine = new RuleEngine({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    engine.setRules([blinkRule]);
    const expiries: Array<Array<{ rowId: string; colId: string | null }>> = [];
    engine.onExpire((cells) => expiries.push(cells));

    const row = { price: 105 };
    engine.applyChanges(oneTick(row));
    const cellCtx: RuleEvalContext = { row, rowId: 'a', colId: 'price', theme: 'light' };
    expect(engine.evaluateCell(cellCtx).matched).toEqual(['blink']);

    engine.endTick(); // diff cleared — the active window keeps it matched
    expect(engine.evaluateCell(cellCtx).matched).toEqual(['blink']);

    clock.advance(1000);
    expect(expiries).toEqual([[{ rowId: 'a', colId: 'price' }]]);
    expect(engine.evaluateCell(cellCtx).matched).toEqual([]);
  });

  it('onExpire unsubscribe stops notifications', () => {
    const clock = makeClock();
    const engine = new RuleEngine({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    engine.setRules([blinkRule]);
    const seen: unknown[] = [];
    const un = engine.onExpire((cells) => seen.push(cells));
    un();
    engine.applyChanges(oneTick({ price: 105 }));
    clock.advance(5000);
    expect(seen).toEqual([]);
  });
});

describe('RuleEngine — flash directives (Task 5)', () => {
  it('fire only on false→true transitions, with the rule flash config', () => {
    const engine = new RuleEngine();
    engine.setRules([
      {
        kind: 'style',
        id: 'hot',
        name: 'hot',
        enabled: true,
        priority: 1,
        condition: '[price] > 100',
        scope: { kind: 'cell', columnIds: ['price'] },
        style: { base: { color: '#e65100' } },
        flash: { enabled: true, target: 'cell', mode: 'pulse', color: '#ff6f00', durationMs: 600 },
      },
    ]);
    const tick = (price: number, oldValue: number) =>
      engine.applyChanges({
        added: [],
        removed: [],
        updated: [
          {
            rowId: 'a',
            row: { price },
            cells: [{ rowId: 'a', colId: 'price', oldValue, newValue: price }],
          },
        ],
      });

    const flash = { rowId: 'a', colIds: ['price'], color: '#ff6f00', mode: 'pulse', durationMs: 600 };
    expect(tick(150, 50)).toEqual([flash]); // false→true
    expect(tick(160, 150)).toEqual([]); // stays true — no re-flash
    expect(tick(50, 160)).toEqual([]); // true→false — no flash
    expect(tick(200, 50)).toEqual([flash]); // re-activation flashes again
  });

  it('row-target flash directive carries colIds: null', () => {
    const engine = new RuleEngine();
    engine.setRules([
      {
        kind: 'style',
        id: 'row-hot',
        name: 'row-hot',
        enabled: true,
        priority: 1,
        condition: '[price] > 100',
        scope: { kind: 'row' },
        style: { base: { color: '#e65100' } },
        flash: { enabled: true, target: 'row', mode: 'glow', color: '#ffa000', durationMs: 900 },
      },
    ]);
    const directives = engine.applyChanges({
      added: [{ rowId: 'a', row: { price: 150 } }], // added rows activate too
      updated: [],
      removed: [],
    });
    expect(directives).toEqual([
      { rowId: 'a', colIds: null, color: '#ffa000', mode: 'glow', durationMs: 900 },
    ]);
  });
});
```

Run to see them FAIL:

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/ruleEngine.test.ts
```

Expected: 20 pass (Tasks 3–4), 4 FAIL — the two activeDuration tests throw `not-yet-implemented: onExpire ships in Task 5`; the two flash tests fail on `expected [] to deeply equal [ { rowId: 'a', … } ]` (Task 4's `applyChanges` returns `[]`).

- [ ] **Step 7: Implement the engine additions in `packages/rules/src/ruleEngine.ts`**

Add the import:

```ts
import { ExpiryHeap } from './expiryHeap';
```

Replace the constructor and add the clock/expiry fields (replaces the Task-3 constructor and the `#schema` field declaration block):

```ts
  #schema: Schema | undefined;
  #now: () => number;
  #expiry: ExpiryHeap;
  #expireSubs = new Set<(cells: Array<{ rowId: string; colId: string | null }>) => void>();

  constructor(opts?: {
    schema?: Schema;
    /** Injectable clock. Default is a lazy performance.now wrapper — the
     *  engine stays Date-free (Global Constraints). */
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
  }) {
    this.#schema = opts?.schema;
    this.#now = opts?.now ?? (() => globalThis.performance?.now() ?? 0);
    this.#expiry = new ExpiryHeap({
      now: this.#now,
      setTimer: opts?.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts?.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    });
    this.#expiry.onExpire((expired) => {
      const cells = expired.map((e) => ({ rowId: e.rowId, colId: e.colId }));
      for (const fn of [...this.#expireSubs]) fn(cells);
    });
  }
```

In `setRules`, add one line next to the other transaction-state resets (after `this.#activations = [];`):

```ts
    this.#expiry.clear(); // replaced rules void their active windows
```

Replace `#ruleMatches` (adds the active-window check; `#conditionMatches` from Task 4 is unchanged):

```ts
  /** Single matching gate for evaluateCell + resolveRuleRef. An
   *  activeDurationMs rule stays matched for its window after activation,
   *  even once endTick cleared the tick's diff (spec §3.1 blink-on-change);
   *  after expiry it stops matching and onExpire notifies for repaint. */
  #ruleMatches(ir: IndexedRule, ctx: RuleEvalContext): boolean {
    if (ir.rule.kind === 'style' && ir.rule.activeDurationMs != null) {
      const activeColId = ir.rule.scope.kind === 'row' ? null : ctx.colId;
      if (this.#expiry.isActive(ctx.rowId, activeColId, ir.rule.id)) return true;
    }
    return this.#conditionMatches(ir, ctx.rowId, ctx.row);
  }
```

Replace the `onExpire` skeleton throw:

```ts
  /** activeDurationMs expiries → bridge repaints those cells. */
  onExpire(fn: (cells: Array<{ rowId: string; colId: string | null }>) => void): Unsubscribe {
    this.#expireSubs.add(fn);
    return () => {
      this.#expireSubs.delete(fn);
    };
  }
```

Replace the tail of `applyChanges` — the Task-4 seam (`// Task 5 fills directives from #activations…` through `return [];`) — with:

```ts
    // (d) activations → expiry entries + flash directives (spec §1.1 items 5+8).
    const directives: FlashDirective[] = [];
    for (const { rule, rowId } of this.#activations) {
      const scopedColIds = rule.scope.kind === 'row' ? null : rule.scope.columnIds;
      if (rule.activeDurationMs != null && rule.activeDurationMs > 0) {
        const deadline = this.#now() + rule.activeDurationMs;
        if (scopedColIds === null) {
          this.#expiry.push({ deadline, rowId, colId: null, ruleId: rule.id });
        } else {
          for (const colId of scopedColIds) {
            this.#expiry.push({ deadline, rowId, colId, ruleId: rule.id });
          }
        }
      }
      if (rule.flash?.enabled) {
        directives.push({
          rowId,
          // cell target → the rule's matched cell set; row target → whole row.
          colIds:
            rule.flash.target === 'row' || scopedColIds === null ? null : scopedColIds.slice(),
          color: rule.flash.color,
          mode: rule.flash.mode,
          durationMs: rule.flash.durationMs,
        });
      }
    }
    this.#activations.length = 0;
    return directives;
```

- [ ] **Step 8: Run to see it PASS**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/ruleEngine.test.ts
```

Expected: 24/24 PASS.

- [ ] **Step 9: Full package suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run && npx tsc --noEmit
```

Expected: 63/63 PASS (3 types + 24 conditionCompiler + 24 ruleEngine + 5 matchCounter + 7 expiryHeap); typecheck clean.

- [ ] **Step 10: Verify neighbor baselines untouched**

```bash
cd /Users/develop/wfh/canvasgrid
npm --workspace @wellsfargo-starui/velocity-grid-expression run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid-format run test 2>&1 | tail -5
```

Expected: expression 185/185, format 158/158 — Phase B touched neither package.

- [ ] **Step 11: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "feat(rules): cycle 21e task 5 — expiry heap, activeDurationMs windows, flash directives"
```

---


## Phase C — Alerts core (3 tasks)

---

### Task 6: Message templating + token bucket

**Files:**
- Modify: `packages/rules/src/alerts/messageTemplate.ts` (replace skeleton)
- Modify: `packages/rules/src/alerts/tokenBucket.ts` (replace skeleton)
- Test: `packages/rules/tests/alerts/messageTemplate.test.ts`
- Test: `packages/rules/tests/alerts/tokenBucket.test.ts`

**Interfaces:**
- Consumes (Task 1): the skeleton signatures — `MessageContext { rule; rowId; column; value; prev }`, `renderMessage(template: string, ctx: MessageContext): string`, `TokenBucket` ctor `{ capacityPerSecond: number; now: () => number }` with `tryTake(): boolean` + `setCapacity(capacityPerSecond: number): void`. Signatures unchanged; only the throwing bodies are replaced.
- Produces (for Task 7): `renderMessage` (the AlertsEngine pipeline's render step; already re-exported from `src/index.ts` by Task 1) and `TokenBucket` (the engine's global `maxNotificationsPerSecond` limiter; `setCapacity` is what Task 8's `setSettings` calls).

- [ ] **Step 1: Write the failing template tests**

Write `packages/rules/tests/alerts/messageTemplate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderMessage, type MessageContext } from '../../src/alerts/messageTemplate';

const ctx = (over?: Partial<MessageContext>): MessageContext => ({
  rule: 'Big move', rowId: 'AAPL', column: 'price', value: 105, prev: 100, ...over,
});

describe('renderMessage', () => {
  it('substitutes all five placeholders', () => {
    expect(renderMessage('{rule}: {column} {prev} -> {value} on {rowId}', ctx()))
      .toBe('Big move: price 100 -> 105 on AAPL');
  });

  it('null column renders as empty string', () => {
    expect(renderMessage('col=<{column}>', ctx({ column: null }))).toBe('col=<>');
  });

  it('null and undefined value/prev render as empty string', () => {
    expect(renderMessage('{value}|{prev}', ctx({ value: null, prev: undefined }))).toBe('|');
  });

  it('non-string values render via String(...)', () => {
    expect(renderMessage('{value} {prev}', ctx({ value: true, prev: 0 }))).toBe('true 0');
  });

  it('single pass: a value containing "{prev}" is NOT re-substituted', () => {
    expect(renderMessage('{value} / {prev}', ctx({ value: '{prev}', prev: 'OLD' })))
      .toBe('{prev} / OLD');
  });

  it('unknown placeholders pass through verbatim', () => {
    expect(renderMessage('{foo} {value} {}', ctx({ value: 5 }))).toBe('{foo} 5 {}');
  });

  it('repeated placeholders substitute every occurrence', () => {
    expect(renderMessage('{rowId}-{rowId}', ctx())).toBe('AAPL-AAPL');
  });

  it('template without placeholders returns unchanged', () => {
    expect(renderMessage('static text', ctx())).toBe('static text');
  });
});
```

- [ ] **Step 2: Write the failing bucket tests**

Write `packages/rules/tests/alerts/tokenBucket.test.ts` (fake injectable clock — no timers, no `Date`; advance amounts are chosen binary-exact so fractional refills sum without float error):

```ts
import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/alerts/tokenBucket';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('TokenBucket', () => {
  it('allows a burst of exactly `capacityPerSecond` takes, then runs dry', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 3, now: clock.now });
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('refills continuously with elapsed time', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    for (let i = 0; i < 4; i++) bucket.tryTake(); // drain
    expect(bucket.tryTake()).toBe(false);
    clock.advance(250); // 0.25 s × 4/s = exactly 1 token
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('a failed take does not lose accumulated fractional tokens', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    for (let i = 0; i < 4; i++) bucket.tryTake();
    clock.advance(125); // 0.5 tokens
    expect(bucket.tryTake()).toBe(false); // refills, fails, keeps the 0.5
    clock.advance(125); // +0.5 → 1.0
    expect(bucket.tryTake()).toBe(true);
  });

  it('never accumulates beyond capacity after long idle', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 2, now: clock.now });
    clock.advance(60_000);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('setCapacity lowers the rate and clamps stored tokens', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    bucket.setCapacity(2); // stored 4 → clamped to 2
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    clock.advance(500); // 0.5 s × 2/s = 1 token at the NEW rate
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('setCapacity mid-flight refills at the old rate up to the switch point', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    for (let i = 0; i < 4; i++) bucket.tryTake(); // drain at t=0
    clock.advance(250);    // 1 token accrues at 4/s
    bucket.setCapacity(1); // refill happens BEFORE the rate swap; 1 ≤ new cap 1 kept
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    clock.advance(1000);   // 1 token at 1/s
    expect(bucket.tryTake()).toBe(true);
  });

  it('raising capacity does not grant instant tokens', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 1, now: clock.now });
    bucket.tryTake(); // drain
    bucket.setCapacity(5);
    expect(bucket.tryTake()).toBe(false); // capacity is a cap, not a grant
    clock.advance(200); // 0.2 s × 5/s = 1 token
    expect(bucket.tryTake()).toBe(true);
  });
});
```

- [ ] **Step 3: Run both — confirm FAIL**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/alerts/messageTemplate.test.ts tests/alerts/tokenBucket.test.ts
```

Expected: 15 FAIL — every test hits `not-yet-implemented: renderMessage ships in Task 6` / `not-yet-implemented: TokenBucket ships in Task 6`.

- [ ] **Step 4: Implement `messageTemplate.ts`**

Replace `packages/rules/src/alerts/messageTemplate.ts`:

```ts
// {rule}/{rowId}/{column}/{value}/{prev} template rendering (spec §4.4).
// Single-pass String.replace with a callback: replacement text is never
// re-scanned, so values that themselves contain placeholder syntax are not
// re-substituted, and there is no regex/`$`-pattern injection surface (the
// pattern is a fixed literal; callback returns are inserted verbatim).

export interface MessageContext {
  rule: string;
  rowId: string;
  column: string | null;
  value: unknown;
  prev: unknown;
}

const PLACEHOLDER = /\{(rule|rowId|column|value|prev)\}/g;

function toText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function renderMessage(template: string, ctx: MessageContext): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    switch (key) {
      case 'rule': return toText(ctx.rule);
      case 'rowId': return toText(ctx.rowId);
      case 'column': return toText(ctx.column);
      case 'value': return toText(ctx.value);
      case 'prev': return toText(ctx.prev);
      /* v8 ignore next 2 -- the pattern only matches the five keys above */
      default: return match;
    }
  });
}
```

Unknown placeholders like `{foo}` never match `PLACEHOLDER`, so they survive verbatim by construction — no code path needed.

- [ ] **Step 5: Implement `tokenBucket.ts`**

Replace `packages/rules/src/alerts/tokenBucket.ts`:

```ts
// Continuous-refill token bucket — the global maxNotificationsPerSecond
// limiter (spec §4.3). `capacityPerSecond` doubles as burst capacity and
// refill rate (N tokens max, refilling at N/s). Date-free: callers inject
// `now` (ms) — the bridge (Task 15) supplies a performance.now() wrapper.

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private lastRefillMs: number;
  private readonly now: () => number;

  constructor(opts: { capacityPerSecond: number; now: () => number }) {
    this.capacity = opts.capacityPerSecond;
    this.tokens = opts.capacityPerSecond; // starts full — allows an initial burst
    this.now = opts.now;
    this.lastRefillMs = opts.now();
  }

  /** Refill by elapsed time, then take one token if at least one is stored. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Adjust capacity + refill rate. Refills at the OLD rate up to now, then
   *  clamps stored tokens to the new capacity (raising never grants tokens). */
  setCapacity(capacityPerSecond: number): void {
    this.refill();
    this.capacity = capacityPerSecond;
    if (this.tokens > capacityPerSecond) this.tokens = capacityPerSecond;
  }

  private refill(): void {
    const nowMs = this.now();
    const elapsedMs = nowMs - this.lastRefillMs;
    this.lastRefillMs = nowMs;
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.capacity);
  }
}
```

- [ ] **Step 6: Run both — confirm PASS, then full suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/alerts/messageTemplate.test.ts tests/alerts/tokenBucket.test.ts
```

Expected: 15/15 PASS (8 template + 7 bucket).

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run && npx tsc --noEmit
```

Expected: full package suite green (Phase A/B suites + the 15 new); typecheck clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "feat(rules): cycle 21e task 6 — message templating + token bucket"
```

---

### Task 7: AlertsEngine — triggers, debounce, history ring, onAlert

**Files:**
- Modify: `packages/rules/src/alerts/alertsEngine.ts` (replace skeleton; keep the exact Task 1 public signatures)
- Test: `packages/rules/tests/alerts/alertsEngine.test.ts`

**Interfaces:**
- Consumes: `@wellsfargo-starui/velocity-grid-expression` — `parse(src): ParseResult`, `compile(ast): CompileResult`, `evaluate(compiled, { row }): unknown` (throws `EvalError`), types `Compiled`/`Schema`; Task 1 types — `AlertRule`, `AlertEvent`, `AlertTrigger`, `AlertsSettings`, `DEFAULT_ALERTS_SETTINGS`, `RowChangeSet`, `RuleValidationError`, `SetRulesResult`, `Unsubscribe`; Task 6 — `renderMessage(template, ctx)`, `TokenBucket`. Deliberately reuses NOTHING from `conditionCompiler` — alert `dataChange` expressions are plain expressions with NO `.old`/`.new` rewrite (`relativeChange` covers deltas).
- Produces (for Tasks 8/15/16): `AlertsEngine` realtime-complete — `setRules(rules: AlertRule[]): SetRulesResult`, `getRules(): AlertRule[]`, `applyChanges(changes: RowChangeSet): void`, `onAlert(fn: (alert: AlertEvent) => void): Unsubscribe`, `getHistory(): AlertEvent[]`, `unreadCount(): number`, `markAllRead(): void`, `droppedCount(): number`, ctor `opts?: { settings?: Partial<AlertsSettings>; schema?: Schema; now?: () => number }`. `getSettings`/`setSettings`/`flushThrottled` keep throwing `not-yet-implemented … ships in Task 8`. Task 15's `wireIntoKernel` constructs this engine and feeds it `RowChangeSet`s off `rowsChanged`; Task 16's showcase subscribes `onAlert`.

**Locked decisions (documented in code + tests):**
- Unrestricted `dataChange` events carry `value: null, prev: null` (no single triggering cell — spec defines only `colId: null`).
- `AlertEvent.channels` = `rule.channels ∩ enabledChannels` — the host must never be handed a disabled channel to route to (spec §1.1 "requested channels" read as requested-and-enabled; all-disabled → suppressed before any accounting, spec §4.3).
- `columnIds: []` (present but empty) restricts literally → never fires; restricted rules never fire on added rows (adds carry no `ChangeRecord`s).
- Pipeline order is debounce → bucket (spec §4.3), so a bucket-dropped hit still stamps its debounce window — prevents retry storms; tested explicitly.
- `setRules` does not clear debounce stamps (re-setting the same rules must not reopen windows; stale keys are bounded and harmless).
- Restricted per-cell fires for the same rule+row within one tick collapse to the first cell via the `(ruleId, rowId)` debounce — direct consequence of the spec's debounce key.

- [ ] **Step 1: Write the failing engine tests**

Write `packages/rules/tests/alerts/alertsEngine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AlertsEngine } from '../../src/alerts/alertsEngine';
import type {
  AlertEvent, AlertRule, AlertsSettings, AlertTrigger, RowChangeSet,
} from '../../src/types';

// ── harness ─────────────────────────────────────────────────────────────

interface Clock { now: () => number; advance: (ms: number) => void; }
function fakeClock(start = 0): Clock {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function makeEngine(settings?: Partial<AlertsSettings>) {
  const clock = fakeClock();
  const engine = new AlertsEngine({ settings, now: clock.now });
  const events: AlertEvent[] = [];
  engine.onAlert((e) => events.push(e));
  return { engine, events, clock };
}

// Partial<AlertsSettings>['enabledChannels'] is a full Record; the engine
// merges per key at runtime, so tests may pass a partial record via cast.
const channels = (p: Partial<Record<'toast' | 'badge' | 'openfin', boolean>>) =>
  p as AlertsSettings['enabledChannels'];

function rule(over: Partial<AlertRule>): AlertRule {
  return {
    id: 'r1', name: 'Rule One', enabled: true, priority: 10, severity: 'info',
    trigger: { kind: 'rowChange', mode: 'ROW_ADDED' },
    message: '{rule} {rowId}', channels: ['toast'],
    ...over,
  };
}

const rel = (over?: Partial<Extract<AlertTrigger, { kind: 'relativeChange' }>>): AlertTrigger => ({
  kind: 'relativeChange', columnId: 'price', mode: 'ANY_CHANGE',
  threshold: 0, direction: 'both', ...over,
});

const EMPTY: RowChangeSet = { added: [], updated: [], removed: [] };

function updated(
  rowId: string,
  row: Record<string, unknown>,
  cells: Array<[colId: string, oldValue: unknown, newValue: unknown]>,
): RowChangeSet {
  return {
    ...EMPTY,
    updated: [{
      rowId, row,
      cells: cells.map(([colId, oldValue, newValue]) => ({ rowId, colId, oldValue, newValue })),
    }],
  };
}

const added = (...rows: Array<[rowId: string, row?: Record<string, unknown>]>): RowChangeSet =>
  ({ ...EMPTY, added: rows.map(([rowId, row]) => ({ rowId, row: row ?? {} })) });
const removed = (...rows: Array<[rowId: string, row?: Record<string, unknown>]>): RowChangeSet =>
  ({ ...EMPTY, removed: rows.map(([rowId, row]) => ({ rowId, row: row ?? {} })) });

// ── setRules validation ─────────────────────────────────────────────────

describe('AlertsEngine — setRules validation', () => {
  it('reports parse errors with loc, skips the rule, keeps valid rules', () => {
    const { engine, events } = makeEngine();
    const res = engine.setRules([
      rule({ id: 'bad', trigger: { kind: 'dataChange', expression: '[price] >' } }),
      rule({ id: 'good' }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ ruleId: 'bad', code: 'parse' });
    expect(res.errors[0].loc).not.toBeNull();
    expect(engine.getRules().map((r) => r.id)).toEqual(['good']);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(1); // the valid rule still fires
  });

  it('reports unknown-fn from expression compile', () => {
    const { engine } = makeEngine();
    const res = engine.setRules([
      rule({ id: 'fn', trigger: { kind: 'dataChange', expression: 'NOSUCH([a]) > 1' } }),
    ]);
    expect(res.errors[0]).toMatchObject({ ruleId: 'fn', code: 'unknown-fn' });
  });

  it('reports bad-shape (loc null) for unrecognized trigger kinds', () => {
    const { engine } = makeEngine();
    const res = engine.setRules([
      rule({ id: 'weird', trigger: { kind: 'nope' } as unknown as AlertTrigger }),
    ]);
    expect(res.errors[0]).toMatchObject({ ruleId: 'weird', code: 'bad-shape', loc: null });
    expect(engine.getRules()).toEqual([]);
  });

  it('getRules returns valid rules sorted by priority asc', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({ id: 'p20', priority: 20 }), rule({ id: 'p10', priority: 10 })]);
    expect(engine.getRules().map((r) => r.id)).toEqual(['p10', 'p20']);
  });

  it('rules fire in priority-asc order', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ id: 'second', priority: 20 }), rule({ id: 'first', priority: 10 })]);
    engine.applyChanges(added(['x']));
    expect(events.map((e) => e.ruleId)).toEqual(['first', 'second']);
  });
});

// ── dataChange trigger ──────────────────────────────────────────────────

describe('AlertsEngine — dataChange trigger', () => {
  it('restricted: fires per changed cell in columnIds with that colId + cell value/prev', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 100', columnIds: ['price', 'qty'] },
    })]);
    engine.applyChanges(updated('r1', { price: 150, qty: 5, note: 'x' },
      [['price', 90, 150], ['note', 'a', 'x']]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rowId: 'r1', colId: 'price', value: 150, prev: 90 });
  });

  it('restricted: two watched cells in one tick collapse to the first via (ruleId,rowId) debounce', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 100', columnIds: ['price', 'qty'] },
    })]);
    engine.applyChanges(updated('r1', { price: 150, qty: 9 },
      [['price', 90, 150], ['qty', 1, 9]]));
    expect(events).toHaveLength(1);
    expect(events[0].colId).toBe('price'); // first ChangeRecord wins; second is debounced
  });

  it('restricted: no fire when only unwatched columns changed', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 100', columnIds: ['price'] },
    })]);
    engine.applyChanges(updated('r1', { price: 150, note: 'b' }, [['note', 'a', 'b']]));
    expect(events).toHaveLength(0);
  });

  it('restricted: expression evaluates against the post-change row (any field)', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[qty] > 3', columnIds: ['price'] },
    })]);
    engine.applyChanges(updated('r1', { price: 2, qty: 5 }, [['price', 1, 2]]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ colId: 'price', value: 2, prev: 1 });
  });

  it('restricted: empty columnIds array restricts literally — never fires', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      trigger: { kind: 'dataChange', expression: '[price] > 0', columnIds: [] },
    })]);
    engine.applyChanges(updated('r1', { price: 150 }, [['price', 90, 150]]));
    expect(events).toHaveLength(0);
  });

  it('unrestricted: fires once per updated row AND once per added row, colId/value/prev null', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges({
      added: [{ rowId: 'n1', row: { price: 500 } }, { rowId: 'n2', row: { price: 50 } }],
      updated: [{ rowId: 'u1', row: { price: 150 }, cells: [{ rowId: 'u1', colId: 'price', oldValue: 90, newValue: 150 }] }],
      removed: [],
    });
    expect(events).toHaveLength(2); // u1 (updated) + n1 (added); n2 fails the condition
    for (const e of events) {
      expect(e.colId).toBeNull();
      expect(e.value).toBeNull();
      expect(e.prev).toBeNull();
    }
    expect(events.map((e) => e.rowId)).toEqual(['u1', 'n1']);
  });

  it('unrestricted: removed rows never evaluate', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges(removed(['gone', { price: 500 }]));
    expect(events).toHaveLength(0);
  });

  it('an EvalError during evaluation is treated as non-matching and never throws', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[a] / [b] > 1' } })]);
    expect(() =>
      engine.applyChanges(updated('x', { a: 1, b: 0 }, [['a', 0, 1]])), // div-by-zero
    ).not.toThrow();
    expect(events).toHaveLength(0);
  });
});

// ── relativeChange trigger ──────────────────────────────────────────────

describe('AlertsEngine — relativeChange trigger', () => {
  it('ANY_CHANGE fires on old !== new with cell value/prev; equal values do not fire', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel() })]);
    engine.applyChanges(updated('x', { price: 101 }, [['price', 100, 101]]));
    engine.applyChanges(updated('y', { price: 100 }, [['price', 100, 100]]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rowId: 'x', colId: 'price', value: 101, prev: 100 });
  });

  it('ABSOLUTE_CHANGE: threshold boundary equality fires; below does not', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel({ mode: 'ABSOLUTE_CHANGE', threshold: 5 }) })]);
    engine.applyChanges(updated('a', { price: 105 }, [['price', 100, 105]])); // |Δ| = 5 → fires
    engine.applyChanges(updated('b', { price: 104 }, [['price', 100, 104]])); // |Δ| = 4 → no
    expect(events.map((e) => e.rowId)).toEqual(['a']);
  });

  it('PERCENT_CHANGE: boundary fires; old = 0 never fires', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel({ mode: 'PERCENT_CHANGE', threshold: 5 }) })]);
    engine.applyChanges(updated('a', { price: 210 }, [['price', 200, 210]])); // 5% exactly → fires
    engine.applyChanges(updated('b', { price: 209 }, [['price', 200, 209]])); // 4.5% → no
    engine.applyChanges(updated('c', { price: 50 }, [['price', 0, 50]]));     // old 0 → no
    expect(events.map((e) => e.rowId)).toEqual(['a']);
  });

  it('direction filters sign: up ignores down-moves, down ignores up-moves, both takes either', () => {
    const { engine, events } = makeEngine();
    engine.setRules([
      rule({ id: 'up', priority: 1, trigger: rel({ direction: 'up' }) }),
      rule({ id: 'down', priority: 2, trigger: rel({ direction: 'down' }) }),
      rule({ id: 'both', priority: 3, trigger: rel({ direction: 'both' }) }),
    ]);
    engine.applyChanges(updated('rise', { price: 105 }, [['price', 100, 105]]));
    engine.applyChanges(updated('fall', { price: 95 }, [['price', 100, 95]]));
    expect(events.map((e) => `${e.ruleId}:${e.rowId}`))
      .toEqual(['up:rise', 'both:rise', 'down:fall', 'both:fall']);
  });

  it('non-numeric or non-finite old/new values skip the record', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel() })]);
    engine.applyChanges(updated('s', { price: 105 }, [['price', '100', 105]]));
    engine.applyChanges(updated('n', { price: 5 }, [['price', Number.NaN, 5]]));
    engine.applyChanges(updated('i', { price: 5 }, [['price', Number.POSITIVE_INFINITY, 5]]));
    engine.applyChanges(updated('u', { price: 5 }, [['price', null, 5]]));
    expect(events).toHaveLength(0);
  });

  it('only ChangeRecords whose colId matches trigger.columnId are considered', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: rel() })]);
    engine.applyChanges(updated('x', { qty: 10, price: 100 }, [['qty', 1, 10]]));
    expect(events).toHaveLength(0);
  });
});

// ── rowChange trigger ───────────────────────────────────────────────────

describe('AlertsEngine — rowChange trigger', () => {
  it('ROW_ADDED fires per added row with null colId/value/prev', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'rowChange', mode: 'ROW_ADDED' } })]);
    engine.applyChanges(added(['a'], ['b']));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.rowId)).toEqual(['a', 'b']);
    for (const e of events) {
      expect(e.colId).toBeNull();
      expect(e.value).toBeNull();
      expect(e.prev).toBeNull();
    }
  });

  it('ROW_REMOVED fires per removed row', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'rowChange', mode: 'ROW_REMOVED' } })]);
    engine.applyChanges(removed(['a']));
    expect(events.map((e) => e.rowId)).toEqual(['a']);
  });

  it('ROW_ADDED ignores updates and removals', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'rowChange', mode: 'ROW_ADDED' } })]);
    engine.applyChanges(updated('x', { price: 1 }, [['price', 0, 1]]));
    engine.applyChanges(removed(['y']));
    expect(events).toHaveLength(0);
  });
});

// ── pipeline: debounce ──────────────────────────────────────────────────

describe('AlertsEngine — debounce', () => {
  it('same rule + same row suppressed within the window; fires again after it elapses', () => {
    const { engine, events, clock } = makeEngine(); // defaultDebounceMs 1000
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges(updated('x', { price: 150 }, [['price', 90, 150]]));  // t=0 → fires
    clock.advance(500);
    engine.applyChanges(updated('x', { price: 160 }, [['price', 150, 160]])); // t=500 → suppressed
    expect(events).toHaveLength(1);
    clock.advance(500);
    engine.applyChanges(updated('x', { price: 170 }, [['price', 160, 170]])); // t=1000 → fires
    expect(events).toHaveLength(2);
  });

  it('different rows fire independently within the window', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ trigger: { kind: 'dataChange', expression: '[price] > 100' } })]);
    engine.applyChanges(updated('x', { price: 150 }, [['price', 90, 150]]));
    engine.applyChanges(updated('y', { price: 150 }, [['price', 90, 150]]));
    expect(events.map((e) => e.rowId)).toEqual(['x', 'y']);
  });

  it('per-rule debounceMs overrides the default; 0 falls back to defaultDebounceMs', () => {
    const { engine, events, clock } = makeEngine();
    engine.setRules([
      rule({ id: 'fast', priority: 1, debounceMs: 100 }),
      rule({ id: 'zero', priority: 2, debounceMs: 0 }),
    ]);
    engine.applyChanges(added(['x'])); // both fire at t=0
    expect(events).toHaveLength(2);
    clock.advance(100);
    engine.applyChanges(added(['x'])); // fast: 100 ≥ 100 → fires; zero: 100 < 1000 → suppressed
    expect(events.map((e) => e.ruleId)).toEqual(['fast', 'zero', 'fast']);
  });
});

// ── pipeline: channels ──────────────────────────────────────────────────

describe('AlertsEngine — channel filter', () => {
  it('all-channels-disabled events are suppressed and consume no bucket tokens', () => {
    const { engine, events } = makeEngine({
      maxNotificationsPerSecond: 2,
      enabledChannels: channels({ toast: false }),
    });
    engine.setRules([
      rule({ id: 'toastOnly', priority: 1, channels: ['toast'] }),
      rule({ id: 'badgeOnly', priority: 2, channels: ['badge'] }),
    ]);
    engine.applyChanges(added(['x'], ['y']));
    // toastOnly suppressed twice WITHOUT taking tokens → badgeOnly gets both.
    expect(events.map((e) => e.ruleId)).toEqual(['badgeOnly', 'badgeOnly']);
    expect(engine.droppedCount()).toBe(0);
  });

  it('event.channels is the enabled intersection of the rule channels', () => {
    const { engine, events } = makeEngine({ enabledChannels: channels({ toast: false }) });
    engine.setRules([rule({ channels: ['toast', 'badge'] })]);
    engine.applyChanges(added(['x']));
    expect(events[0].channels).toEqual(['badge']);
  });
});

// ── pipeline: token bucket ──────────────────────────────────────────────

describe('AlertsEngine — token bucket', () => {
  it('bucket exhaustion drops events, increments droppedCount, skips history + unread', () => {
    const { engine, events } = makeEngine({ maxNotificationsPerSecond: 2 });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c']));
    expect(events).toHaveLength(2);
    expect(engine.droppedCount()).toBe(1);
    expect(engine.getHistory()).toHaveLength(2);
    expect(engine.unreadCount()).toBe(2);
  });

  it('a dropped hit still consumed its debounce window; the bucket refills over time', () => {
    const { engine, events, clock } = makeEngine({ maxNotificationsPerSecond: 2 });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c'])); // c dropped at t=0, debounce stamped
    clock.advance(500);
    engine.applyChanges(added(['c'])); // t=500 < 1000 → debounced (not a bucket drop)
    expect(events).toHaveLength(2);
    expect(engine.droppedCount()).toBe(1);
    clock.advance(600);
    engine.applyChanges(added(['c'])); // t=1100: debounce clear, bucket refilled → fires
    expect(events.map((e) => e.rowId)).toEqual(['a', 'b', 'c']);
  });
});

// ── history + unread ────────────────────────────────────────────────────

describe('AlertsEngine — history ring + unread', () => {
  it('getHistory is newest-first and capped at historyLimit', () => {
    const { engine } = makeEngine({ historyLimit: 3 });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c'], ['d'], ['e']));
    const history = engine.getHistory();
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.rowId)).toEqual(['e', 'd', 'c']);
    expect(history.map((e) => e.seq)).toEqual([5, 4, 3]);
  });

  it('unreadCount counts emitted events; markAllRead resets; later alerts count again', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b']));
    expect(engine.unreadCount()).toBe(2);
    engine.markAllRead();
    expect(engine.unreadCount()).toBe(0);
    engine.applyChanges(added(['c']));
    expect(engine.unreadCount()).toBe(1);
  });
});

// ── events: message + seq ───────────────────────────────────────────────

describe('AlertsEngine — event assembly', () => {
  it('renders the message template end-to-end from the hit context', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({
      name: 'Big move',
      trigger: rel({ mode: 'PERCENT_CHANGE', threshold: 5 }),
      message: '{rule}: {column} moved {prev} -> {value} on {rowId}',
    })]);
    engine.applyChanges(updated('AAPL', { price: 210 }, [['price', 200, 210]]));
    expect(events[0].message).toBe('Big move: price moved 200 -> 210 on AAPL');
    expect(events[0].severity).toBe('info');
  });

  it('seq is a monotonic counter starting at 1', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c']));
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('onAlert unsubscribe stops delivery', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    const seen: AlertEvent[] = [];
    const off = engine.onAlert((e) => seen.push(e));
    engine.applyChanges(added(['a']));
    off();
    engine.applyChanges(added(['b']));
    expect(seen.map((e) => e.rowId)).toEqual(['a']);
  });
});

// ── gates ───────────────────────────────────────────────────────────────

describe('AlertsEngine — gates', () => {
  it('settings.enabled false → applyChanges is a no-op', () => {
    const { engine, events } = makeEngine({ enabled: false });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
    expect(engine.unreadCount()).toBe(0);
  });

  it('disabled rules never evaluate', () => {
    const { engine, events } = makeEngine();
    engine.setRules([rule({ enabled: false })]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/alerts/alertsEngine.test.ts
```

Expected: 36 FAIL — every test throws `not-yet-implemented: AlertsEngine ships in Task 7` from the skeleton constructor.

- [ ] **Step 3: Implement `alertsEngine.ts`**

Replace `packages/rules/src/alerts/alertsEngine.ts` (public signatures identical to the Task 1 skeleton; `getSettings`/`setSettings`/`flushThrottled` keep their Task-8 throws):

```ts
// AlertsEngine — trigger evaluation, debounce, token bucket, history ring.
// Spec: docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §4.3.
// Evaluation modes (throttled queue) + settings surface complete in Task 8.
import { compile, evaluate, parse, type Compiled, type Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { DEFAULT_ALERTS_SETTINGS } from '../types';
import type {
  AlertEvent, AlertRule, AlertsSettings, AlertTrigger,
  RowChangeSet, RuleValidationError, SetRulesResult, Unsubscribe,
} from '../types';
import { renderMessage } from './messageTemplate';
import { TokenBucket } from './tokenBucket';

interface CompiledAlertRule {
  rule: AlertRule;
  /** Compiled dataChange expression; null for relativeChange/rowChange. */
  compiled: Compiled | null;
}

/** One trigger match, pre-pipeline. */
interface AlertHit {
  rowId: string;
  colId: string | null;
  value: unknown;
  prev: unknown;
}

type RelativeChangeTrigger = Extract<AlertTrigger, { kind: 'relativeChange' }>;

function mergeSettings(
  base: AlertsSettings,
  patch: Partial<AlertsSettings> | undefined,
): AlertsSettings {
  if (!patch) return { ...base, enabledChannels: { ...base.enabledChannels } };
  return {
    ...base,
    ...patch,
    // Per-key channel merge: a partial record only overrides the keys given.
    enabledChannels: { ...base.enabledChannels, ...(patch.enabledChannels ?? {}) },
  };
}

function checkShape(rule: AlertRule): RuleValidationError | null {
  const bad = (message: string): RuleValidationError => ({
    ruleId: typeof (rule as { id?: unknown } | null)?.id === 'string' ? rule.id : '<unknown>',
    code: 'bad-shape',
    message,
    loc: null,
  });
  if (!rule || typeof rule !== 'object') return bad('rule must be an object');
  if (typeof rule.id !== 'string' || rule.id === '') return bad('rule.id must be a non-empty string');
  if (typeof rule.name !== 'string') return bad('rule.name must be a string');
  if (typeof rule.message !== 'string') return bad('rule.message must be a string');
  if (!Array.isArray(rule.channels)) return bad('rule.channels must be an array');
  const trigger = rule.trigger as AlertTrigger | undefined;
  if (!trigger || typeof trigger !== 'object') return bad('rule.trigger is required');
  switch (trigger.kind) {
    case 'dataChange':
      if (typeof trigger.expression !== 'string' || trigger.expression === '') {
        return bad('dataChange trigger requires an expression string');
      }
      return null;
    case 'relativeChange':
      if (typeof trigger.columnId !== 'string' || trigger.columnId === '') {
        return bad('relativeChange trigger requires columnId');
      }
      if (trigger.mode !== 'ANY_CHANGE' && trigger.mode !== 'ABSOLUTE_CHANGE' && trigger.mode !== 'PERCENT_CHANGE') {
        return bad('relativeChange mode must be PERCENT_CHANGE | ABSOLUTE_CHANGE | ANY_CHANGE');
      }
      if (trigger.mode !== 'ANY_CHANGE' && typeof trigger.threshold !== 'number') {
        return bad(`relativeChange ${trigger.mode} requires a numeric threshold`);
      }
      if (trigger.direction !== 'up' && trigger.direction !== 'down' && trigger.direction !== 'both') {
        return bad('relativeChange direction must be up | down | both');
      }
      return null;
    case 'rowChange':
      if (trigger.mode !== 'ROW_ADDED' && trigger.mode !== 'ROW_REMOVED') {
        return bad('rowChange mode must be ROW_ADDED | ROW_REMOVED');
      }
      return null;
    default:
      return bad('rule.trigger.kind must be dataChange | relativeChange | rowChange');
  }
}

function relativeChangeFires(trigger: RelativeChangeTrigger, oldV: number, newV: number): boolean {
  if (trigger.direction === 'up' && !(newV > oldV)) return false;
  if (trigger.direction === 'down' && !(newV < oldV)) return false;
  switch (trigger.mode) {
    case 'ANY_CHANGE':
      return oldV !== newV;
    case 'ABSOLUTE_CHANGE':
      return Math.abs(newV - oldV) >= trigger.threshold; // boundary equality fires
    case 'PERCENT_CHANGE':
      // old = 0 → percent change undefined → never fires (spec §4.3).
      return oldV !== 0 && (Math.abs(newV - oldV) / Math.abs(oldV)) * 100 >= trigger.threshold;
  }
}

export class AlertsEngine {
  private settings: AlertsSettings;
  private compiledRules: CompiledAlertRule[] = [];
  private readonly nowFn: () => number;
  private readonly bucket: TokenBucket;
  private readonly listeners = new Set<(alert: AlertEvent) => void>();
  /** Debounce stamps: `ruleId\u0000rowId` → last pass-through time (ms).
   *  Kept across setRules — re-setting rules must not reopen windows. */
  private readonly debounceLast = new Map<string, number>();
  private seqCounter = 0;
  private dropped = 0;
  private unread = 0;
  // History ring — O(1) push, no shifting. `ring` is a circular buffer of at
  // most settings.historyLimit events, stored oldest-first while filling
  // (append; oldest at index 0). Once full, `nextWrite` marks the oldest
  // slot, which each push overwrites in place. getHistory() walks backward
  // from the newest slot to materialize newest-first.
  private ring: AlertEvent[] = [];
  private nextWrite = 0;

  constructor(opts?: { settings?: Partial<AlertsSettings>; schema?: Schema; now?: () => number }) {
    this.settings = mergeSettings(DEFAULT_ALERTS_SETTINGS, opts?.settings);
    // Injectable clock (Global Constraints: Date-free engines). Default wraps
    // performance.now(); the bridge (Task 15) passes its own wrapper.
    this.nowFn = opts?.now ?? (() => performance.now());
    this.bucket = new TokenBucket({
      capacityPerSecond: this.settings.maxNotificationsPerSecond,
      now: this.nowFn,
    });
  }

  setRules(rules: AlertRule[]): SetRulesResult {
    const errors: RuleValidationError[] = [];
    const valid: CompiledAlertRule[] = [];
    for (const rule of rules) {
      const shapeError = checkShape(rule);
      if (shapeError) {
        errors.push(shapeError);
        continue;
      }
      let compiled: Compiled | null = null;
      if (rule.trigger.kind === 'dataChange') {
        // Plain expressions — deliberately NOT conditionCompiler: alert
        // conditions have no .old/.new rewrite (relativeChange covers deltas).
        const parsed = parse(rule.trigger.expression);
        if (!parsed.ok) {
          errors.push({ ruleId: rule.id, code: 'parse', message: parsed.error.message, loc: parsed.error.loc });
          continue;
        }
        const compiledResult = compile(parsed.ast);
        if (!compiledResult.ok) {
          errors.push({
            ruleId: rule.id,
            code: compiledResult.error.code, // 'unknown-fn' | 'arity' | 'not-yet-implemented'
            message: compiledResult.error.message,
            loc: compiledResult.error.loc,
          });
          continue;
        }
        compiled = compiledResult.compiled;
      }
      valid.push({ rule, compiled });
    }
    valid.sort((a, b) => a.rule.priority - b.rule.priority); // stable — array order breaks ties
    this.compiledRules = valid;
    return { ok: errors.length === 0, errors };
  }

  getRules(): AlertRule[] {
    return this.compiledRules.map((entry) => entry.rule);
  }

  getSettings(): AlertsSettings {
    throw new Error('not-yet-implemented: getSettings ships in Task 8');
  }

  setSettings(_patch: Partial<AlertsSettings>): void {
    throw new Error('not-yet-implemented: setSettings ships in Task 8');
  }

  applyChanges(changes: RowChangeSet): void {
    if (!this.settings.enabled) return;
    // Evaluation-mode seam — Task 8 adds the throttled queue + paused/mode
    // transitions. Until then, anything other than realtime does not process.
    if (this.settings.evaluationMode !== 'realtime') return;
    this.process(changes);
  }

  onAlert(fn: (alert: AlertEvent) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Newest-first snapshot of the bounded history ring. */
  getHistory(): AlertEvent[] {
    const n = this.ring.length;
    if (n === 0) return [];
    const newest = n < this.settings.historyLimit ? n - 1 : (this.nextWrite - 1 + n) % n;
    const out: AlertEvent[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.ring[(newest - i + n) % n];
    return out;
  }

  unreadCount(): number {
    return this.unread;
  }

  markAllRead(): void {
    this.unread = 0;
  }

  /** Token-bucket drops since construction (diagnostic, spec §4.3). */
  droppedCount(): number {
    return this.dropped;
  }

  flushThrottled(): void {
    throw new Error('not-yet-implemented: flushThrottled ships in Task 8');
  }

  // ── pipeline ─────────────────────────────────────────────────────────

  private process(changes: RowChangeSet): void {
    if (!this.settings.enabled) return; // re-checked for Task 8's flush path
    for (const entry of this.compiledRules) {
      if (!entry.rule.enabled) continue;
      for (const hit of this.evaluateTrigger(entry, changes)) {
        this.dispatch(entry.rule, hit);
      }
    }
  }

  private evaluateTrigger(entry: CompiledAlertRule, changes: RowChangeSet): AlertHit[] {
    const trigger = entry.rule.trigger;
    const hits: AlertHit[] = [];
    if (trigger.kind === 'dataChange') {
      const cond = entry.compiled as Compiled; // always set for validated dataChange rules
      if (trigger.columnIds !== undefined) {
        // Restricted: per changed cell in the listed columns; the event colId
        // is that cell's. NOTE: an empty columnIds array restricts to zero
        // columns (never fires), and added rows carry no ChangeRecords, so
        // restricted rules never fire on adds.
        const watched = new Set(trigger.columnIds);
        for (const upd of changes.updated) {
          for (const cell of upd.cells) {
            if (!watched.has(cell.colId)) continue;
            if (!this.matches(cond, upd.row)) continue;
            hits.push({ rowId: upd.rowId, colId: cell.colId, value: cell.newValue, prev: cell.oldValue });
          }
        }
      } else {
        // Unrestricted: once per updated row AND once per added row, against
        // the post-change row. No single triggering cell → colId/value/prev null.
        for (const upd of changes.updated) {
          if (this.matches(cond, upd.row)) hits.push({ rowId: upd.rowId, colId: null, value: null, prev: null });
        }
        for (const add of changes.added) {
          if (this.matches(cond, add.row)) hits.push({ rowId: add.rowId, colId: null, value: null, prev: null });
        }
      }
    } else if (trigger.kind === 'relativeChange') {
      for (const upd of changes.updated) {
        for (const cell of upd.cells) {
          if (cell.colId !== trigger.columnId) continue;
          const oldV = cell.oldValue;
          const newV = cell.newValue;
          if (typeof oldV !== 'number' || typeof newV !== 'number') continue;
          if (!Number.isFinite(oldV) || !Number.isFinite(newV)) continue;
          if (!relativeChangeFires(trigger, oldV, newV)) continue;
          hits.push({ rowId: upd.rowId, colId: cell.colId, value: newV, prev: oldV });
        }
      }
    } else {
      const source = trigger.mode === 'ROW_ADDED' ? changes.added : changes.removed;
      for (const rec of source) hits.push({ rowId: rec.rowId, colId: null, value: null, prev: null });
    }
    return hits;
  }

  /** Strict-boolean condition check. Evaluation errors (EvalError or anything
   *  else) → non-matching: evaluators never throw (StarUI doc 04). */
  private matches(cond: Compiled, row: Record<string, unknown>): boolean {
    try {
      return evaluate(cond, { row }) === true;
    } catch {
      return false;
    }
  }

  private dispatch(rule: AlertRule, hit: AlertHit): void {
    // 1. Channel filter — an event whose channels are all disabled is
    //    suppressed BEFORE any debounce/bucket accounting (spec §4.3). The
    //    emitted event carries the enabled intersection: the host must never
    //    be handed a disabled channel to route to.
    const channels = rule.channels.filter((c) => this.settings.enabledChannels[c]);
    if (channels.length === 0) return;

    // 2. Debounce on (ruleId, rowId). debounceMs 0/undefined falls back to
    //    defaultDebounceMs (spec §3.2 — hence `||`, not `??`). Passing the
    //    gate stamps the window even when the bucket then drops: pipeline
    //    order is debounce → bucket (spec §4.3), which prevents retry storms.
    const windowMs = rule.debounceMs || this.settings.defaultDebounceMs;
    const key = `${rule.id}\u0000${hit.rowId}`;
    const nowMs = this.nowFn();
    const last = this.debounceLast.get(key);
    if (last !== undefined && nowMs - last < windowMs) return;
    this.debounceLast.set(key, nowMs);

    // 3. Global token bucket.
    if (!this.bucket.tryTake()) {
      this.dropped += 1;
      return;
    }

    // 4. Render, record, emit.
    const message = renderMessage(rule.message, {
      rule: rule.name,
      rowId: hit.rowId,
      column: hit.colId,
      value: hit.value,
      prev: hit.prev,
    });
    const event: AlertEvent = {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      message,
      rowId: hit.rowId,
      colId: hit.colId,
      value: hit.value,
      prev: hit.prev,
      channels,
      seq: ++this.seqCounter, // monotonic, starts at 1; hosts stamp wall-clock
    };
    this.pushHistory(event);
    this.unread += 1;
    for (const fn of [...this.listeners]) fn(event);
  }

  private pushHistory(event: AlertEvent): void {
    const limit = this.settings.historyLimit;
    if (limit <= 0) return;
    if (this.ring.length < limit) {
      this.ring.push(event);
    } else {
      this.ring[this.nextWrite] = event;
      this.nextWrite = (this.nextWrite + 1) % limit;
    }
  }
}
```

- [ ] **Step 4: Run — confirm PASS, then full suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/alerts/alertsEngine.test.ts
```

Expected: 36/36 PASS.

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run && npx tsc --noEmit
```

Expected: full package suite green (Tasks 1–6 suites unchanged + 36 new); typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "feat(rules): cycle 21e task 7 — AlertsEngine triggers, debounce, history ring, onAlert"
```

---

### Task 8: Evaluation modes + settings surface

**Files:**
- Modify: `packages/rules/src/alerts/alertsEngine.ts` (implement `getSettings`/`setSettings`/`flushThrottled`, mode-aware `applyChanges`, throttled queue)
- Test: extend `packages/rules/tests/alerts/alertsEngine.test.ts`

**Interfaces:**
- Consumes (Task 7 internals): `mergeSettings`, `process(changes)`, the history ring (`ring`/`nextWrite`/`getHistory`), `TokenBucket.setCapacity`.
- Produces (for Tasks 15/16): the complete spec-§4.3 AlertsEngine surface — `getSettings(): AlertsSettings` (defensive copy), `setSettings(patch: Partial<AlertsSettings>): void`, `flushThrottled(): void`, and `applyChanges` honoring `realtime`/`throttled`/`paused`. Task 15's bridge calls `flushThrottled()` once per animation frame while `evaluationMode === 'throttled'`; Task 16's showcase settings chips drive `setSettings`.

**Locked decisions (documented in code + tests):**
- `paused` → `applyChanges` is a no-op; any previously queued throttled batch stays untouched (never dropped).
- Throttled coalescing = arrival-order concatenation into one pending `RowChangeSet`. Row-level squashing is deliberately NOT done — each queued update keeps its own `ChangeRecord`s so `relativeChange` deltas stay per-tick.
- Only the `throttled → realtime` transition auto-flushes (spec §4.3). `paused → realtime` does not; the host may call `flushThrottled()` explicitly.
- `flushThrottled()` while `settings.enabled === false` clears the queue without emitting (kill-switch wins).
- A `historyLimit` change rebuilds the ring keeping the newest events (spec is silent; keeping newest matches the badge/history UX).

- [ ] **Step 1: Write the failing mode/settings tests**

Append to `packages/rules/tests/alerts/alertsEngine.test.ts` (reuses the Task 7 harness — `makeEngine`, `rule`, `channels`, `added`):

```ts
// ── evaluation modes + settings (Task 8) ────────────────────────────────

describe('AlertsEngine — evaluation modes + settings', () => {
  it('getSettings returns merged defaults and a defensive copy', () => {
    const { engine } = makeEngine({ defaultDebounceMs: 50 });
    const s = engine.getSettings();
    expect(s.defaultDebounceMs).toBe(50);
    expect(s.historyLimit).toBe(200);
    s.enabled = false;               // mutating the copy…
    s.enabledChannels.toast = false; // …including the nested record…
    expect(engine.getSettings().enabled).toBe(true);              // …never leaks back
    expect(engine.getSettings().enabledChannels.toast).toBe(true);
  });

  it('setSettings shallow-merges scalars and merges enabledChannels per key', () => {
    const { engine } = makeEngine();
    engine.setSettings({ defaultDebounceMs: 5, enabledChannels: channels({ toast: false }) });
    const s = engine.getSettings();
    expect(s.defaultDebounceMs).toBe(5);
    expect(s.maxNotificationsPerSecond).toBe(10); // untouched scalar keeps its default
    expect(s.enabledChannels).toEqual({ toast: false, badge: true, openfin: true });
  });

  it('paused: applyChanges is a no-op', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'paused' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
    engine.flushThrottled(); // nothing was queued either
    expect(events).toHaveLength(0);
  });

  it('throttled: queues + coalesces; flushThrottled processes in arrival order then clears', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'throttled' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    engine.applyChanges(added(['y']));
    expect(events).toHaveLength(0);
    engine.flushThrottled();
    expect(events.map((e) => e.rowId)).toEqual(['x', 'y']); // arrival order preserved
    engine.flushThrottled(); // queue was cleared by the first flush
    expect(events).toHaveLength(2);
  });

  it('switching to paused leaves a previously queued throttled batch untouched', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'throttled' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));                 // queued
    engine.setSettings({ evaluationMode: 'paused' });
    engine.applyChanges(added(['y']));                 // no-op — NOT queued
    engine.setSettings({ evaluationMode: 'throttled' });
    engine.flushThrottled();
    expect(events.map((e) => e.rowId)).toEqual(['x']);
  });

  it('switching throttled → realtime flushes the queue immediately', () => {
    const { engine, events } = makeEngine({ evaluationMode: 'throttled' });
    engine.setRules([rule({})]);
    engine.applyChanges(added(['x']));
    expect(events).toHaveLength(0);
    engine.setSettings({ evaluationMode: 'realtime' });
    expect(events.map((e) => e.rowId)).toEqual(['x']); // flushed by the transition itself
    engine.applyChanges(added(['y']));                 // realtime processes directly
    expect(events).toHaveLength(2);
  });

  it('changing maxNotificationsPerSecond adjusts the live bucket (clamps stored tokens)', () => {
    const { engine, events } = makeEngine(); // default cap 10, bucket full
    engine.setRules([rule({})]);
    engine.setSettings({ maxNotificationsPerSecond: 1 });
    engine.applyChanges(added(['a'], ['b'])); // only 1 token survives the clamp
    expect(events).toHaveLength(1);
    expect(engine.droppedCount()).toBe(1);
  });

  it('channel-disabled suppression does not consume the debounce window', () => {
    const { engine, events } = makeEngine({ enabledChannels: channels({ toast: false }) });
    engine.setRules([rule({ channels: ['toast'] })]);
    engine.applyChanges(added(['x'])); // suppressed at the channel gate
    expect(events).toHaveLength(0);
    engine.setSettings({ enabledChannels: channels({ toast: true }) });
    engine.applyChanges(added(['x'])); // same rule + row, zero time elapsed
    expect(events).toHaveLength(1);    // fires — the suppressed hit never stamped debounce
  });

  it('lowering historyLimit keeps the newest events', () => {
    const { engine } = makeEngine();
    engine.setRules([rule({})]);
    engine.applyChanges(added(['a'], ['b'], ['c'], ['d'], ['e']));
    engine.setSettings({ historyLimit: 2 });
    expect(engine.getHistory().map((e) => e.rowId)).toEqual(['e', 'd']);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/alerts/alertsEngine.test.ts
```

Expected: 36 PASS (Task 7 baseline untouched) + 9 FAIL — the new tests throw `not-yet-implemented: getSettings ships in Task 8` / `setSettings` / `flushThrottled`.

- [ ] **Step 3: Implement the mode + settings surface**

Four targeted edits to `packages/rules/src/alerts/alertsEngine.ts`.

**(a)** Add the throttle queue field directly under `private nextWrite = 0;`:

```ts
  /** Throttled-mode queue: one coalesced RowChangeSet (arrival-order concat).
   *  Row-level squashing is deliberately NOT done — each queued update keeps
   *  its own ChangeRecords so relativeChange deltas stay per-tick. */
  private pending: RowChangeSet | null = null;
```

**(b)** Replace the two throwing settings methods:

```ts
  getSettings(): AlertsSettings {
    // Defensive copy — one level deep is the whole shape (scalars + the
    // enabledChannels record); callers can never mutate engine state.
    return { ...this.settings, enabledChannels: { ...this.settings.enabledChannels } };
  }

  setSettings(patch: Partial<AlertsSettings>): void {
    const prev = this.settings;
    const next = mergeSettings(prev, patch);
    if (next.historyLimit !== prev.historyLimit) {
      // Rebuild the ring at the new size keeping the newest events. Must run
      // BEFORE the settings swap: getHistory() reads prev.historyLimit.
      const kept = this.getHistory().slice(0, next.historyLimit);
      this.ring = kept.reverse(); // ring stores oldest-first
      this.nextWrite = 0;
    }
    this.settings = next;
    if (next.maxNotificationsPerSecond !== prev.maxNotificationsPerSecond) {
      this.bucket.setCapacity(next.maxNotificationsPerSecond);
    }
    if (prev.evaluationMode === 'throttled' && next.evaluationMode === 'realtime') {
      // The only auto-flushing transition (spec §4.3). paused transitions
      // never drop or flush the queue; paused → realtime leaves it for an
      // explicit flushThrottled().
      this.flushThrottled();
    }
  }
```

**(c)** Replace `applyChanges` (retiring the Task 7 seam):

```ts
  applyChanges(changes: RowChangeSet): void {
    if (!this.settings.enabled) return; // global kill-switch — nothing queues either
    switch (this.settings.evaluationMode) {
      case 'paused':
        return; // no-op — a queued throttled batch stays untouched
      case 'throttled':
        this.enqueue(changes);
        return;
      case 'realtime':
        this.process(changes);
        return;
    }
  }
```

**(d)** Replace the throwing `flushThrottled` and add `enqueue` next to `process`:

```ts
  /** Throttled mode: the bridge (Task 15) calls this once per animation
   *  frame. Processes the coalesced batch through the same pipeline, then
   *  clears. Safe to call in any mode (no-op when nothing is queued). */
  flushThrottled(): void {
    const batch = this.pending;
    this.pending = null;
    if (batch === null || !this.settings.enabled) return;
    this.process(batch);
  }

  private enqueue(changes: RowChangeSet): void {
    if (this.pending === null) {
      this.pending = {
        added: [...changes.added],
        updated: [...changes.updated],
        removed: [...changes.removed],
      };
      return;
    }
    this.pending.added.push(...changes.added);
    this.pending.updated.push(...changes.updated);
    this.pending.removed.push(...changes.removed);
  }
```

- [ ] **Step 4: Run — confirm PASS, then full suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run tests/alerts/alertsEngine.test.ts
```

Expected: 45/45 PASS (36 Task 7 + 9 new).

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules && npx vitest run && npx tsc --noEmit
```

Expected: full package suite green; typecheck clean. The alerts core is now spec-§4.3-complete — the intra-cycle self-review checkpoint follows before Phase D.

- [ ] **Step 5: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "feat(rules): cycle 21e task 8 — alert evaluation modes + settings surface"
```


## Phase C → D — Intra-cycle self-review checkpoint

Before any file outside `packages/rules/` is touched, the coordinating agent (NOT a subagent) verifies the engine layer against the spec. This is a read-and-check step; fixes happen inline before proceeding.

- [ ] **Checkpoint 1: Public surface lock.** `packages/rules/src/index.ts` exports exactly the spec §4.1 list; `RuleEngine` / `AlertsEngine` public method signatures match spec §4.2/§4.3 verbatim (arg names included).
- [ ] **Checkpoint 2: JSON-safety.** Every public type in `types.ts` is plain-JSON (no functions, no class instances in rule defs); `structuredClone` round-trip tests exist and pass.
- [ ] **Checkpoint 3: Date-free + CSP-safe.** `grep -rn "Date.now\|new Function\|eval(" packages/rules/src` → no matches (injectable `now` only).
- [ ] **Checkpoint 4: Diff-map lifecycle.** Confirm the Task 4 tests cover: match during tick → no match after `endTick()`; counts decay for diff-aware rules; `[col.new]` equals current value.
- [ ] **Checkpoint 5: Fold-precedence table.** Confirm Task 3's tests pin: priority asc application, later-overrides-per-property, theme slice override order (`base` → active theme slice), last-indicator-wins, last-formatter-wins.
- [ ] **Checkpoint 6: Alert pipeline order.** Confirm Task 7/8 tests pin the exact gate order: enabled → mode → channel filter → debounce → token bucket → render → history/emit (channel-suppressed events must not consume debounce or bucket).
- [ ] **Checkpoint 7: Package suite green.** `cd packages/rules && npx vitest run && npx tsc --noEmit` — all pass; note the test count in the progress file.

Deviations found here are fixed and committed as `fix(rules): cycle 21e checkpoint — <what>` before Phase D begins.

---


## Phase D — `@wellsfargo-starui/velocity-grid-format` rule-ref plug-in (1 task)

---

### Task 9: FormatEvalContext.resolveRuleRef + tier1 RuleRefNode resolution + hasRuleRefs

**Files:**
- Modify: `packages/format/src/types.ts` — `FormatEvalContext.resolveRuleRef?`, `FormatProgram.hasRuleRefs?`, retire the "Reserved" comment on `RuleRefNode`
- Modify: `packages/format/src/tier1/resolver.ts` — pure rule-ref brackets consult the accessor
- Modify: `packages/format/src/compile.ts` — set `hasRuleRefs` on both program paths (string + composite)
- Modify: `packages/format/src/tier2/fragmentResolver.ts` — forward `ctx.resolveRuleRef` into the per-fragment eval contexts (scope addition vs the spec's file list; without it, spec §9 criterion 3 — "`rule:<ruleId>` in a composite fragment style resolves to live rule colors" — cannot hold, because `resolveFragments` rebuilds `{ value, row, colId }` and would drop the accessor)
- Test: `packages/format/tests/tier1/resolver.test.ts` — UPDATE the 21c reserve test (same expectation, retitled; per plan constraints it may be updated, not deleted) + 5 new tests
- Test: `packages/format/tests/compile.test.ts` — 5 new tests (`hasRuleRefs`, round-trip, mixed bracket, composite shorthand)

**Interfaces:**
- Produces — the exact type additions Tasks 11/14/15 rely on:

```ts
// types.ts — FormatEvalContext gains (kernel Task 11/15 closes this over the current cell):
resolveRuleRef?: (ruleId: string) => string | null;

// types.ts — FormatProgram gains (kernel Task 14 reads this to bypass the format-eval memo):
hasRuleRefs?: boolean;   // present-and-true iff any tier-1 bracket carried a rule:<id>; key absent otherwise
```

- Consumes (all landed in Cycle 21c): `Tier1Node.ruleRefs: RuleRefNode[]` (`src/tier1/parser.ts:6-11`), `RuleRefNode` (`src/types.ts:134-139`), `canonicalize`'s `rule:<id> → 'null'` rewrite + `RuleRefNode` capture (`src/tier1/sugar.ts:30-41`).
- No changes to `@wellsfargo-starui/velocity-grid-expression`, the tokenizer, or the excel tiers. `evaluateIfSelector` stays untouched: `[if rule:<id>]` has `ast === null` and keeps returning `false` — the accessor never drives section selection.

**Verified current-source behavior (read 2026-07-01, `main` @ `28d2d5a`) — the implementation below is anchored to these facts:**

1. **`ast === null` occurs ONLY for whole-interior rule refs.** `parseTier1Brackets` (`src/tier1/parser.ts:25-28`) takes the pure-ref branch only when `sugar.canonicalized.trim() === 'null' && sugar.ruleRefs.length > 0` — i.e. the entire bracket interior was a single `rule:<id>` (e.g. `[color=rule:hot]`).
2. **Mixed interiors keep a real AST with the ref baked as literal `null`.** `sugar.ts:31-41` replaces every `rule:<id>` token with the string `null` inside the interior, so `[color=[x] > 0 ? rule:hot : "#d33"]` canonicalizes to `[x] > 0 ? null : "#d33"` and parses normally (`ast !== null`, `ruleRefs.length === 1`). The ref position evaluates to expression-`null` at runtime and is **never** accessor-resolved this cycle; when the ternary picks it, the channel contributes nothing (existing `evaluated === null → continue` path). `ruleRefs` is still recorded → `hasRuleRefs` is `true` for mixed brackets (conservative memo bypass — correct, just pessimistic). Tests below assert exactly this.
3. **Channel plumbing:** `resolveStyle` assigns per bracket key via the switch at `resolver.ts:58-71` — `color → StyleObj.color = String(v)`, `bg → StyleObj.background = String(v)`, `weight → normalizeWeight(v)`, `style → italic = (String(v) === 'italic')`. The accessor's resolved string feeds this same switch, so a pure rule-ref resolves the **color or background channel per its bracket key**; a (nonsensical) pure ref in `[weight=]`/`[style=]` degrades through the same coercions (`'normal'` / `italic:false`) — documented, not special-cased.
4. **Baseline is 161, not 158.** `npx vitest run` in `packages/format` on `main` @ `28d2d5a` reports `Test Files 11 passed / Tests 161 passed`. The plan header's `158` predates the 21c final-review commits. Constraint honored as: all 161 pre-task tests stay green unmodified, except the reserve test which is retitled with the identical `null` expectation.
5. **Composite path:** fragment-style `[<expr>]` shorthands compile through `parseTier1Brackets` per channel (`fragmentResolver.ts:112-133`, `extractDynamic`), so `style: { color: '[rule:hot]' }` yields a pure-ref `Tier1Node`. `resolveCellBackground` (`fragmentResolver.ts:188-191`) already passes the outer `ctx` straight through (accessor forwarded for free); only `resolveFragments` (`fragmentResolver.ts:156-181`) rebuilds contexts and needs the one-line forward. `exactOptionalPropertyTypes` is `false` in `tsconfig.base.json`, so plain `resolveRuleRef: ctx.resolveRuleRef` forwarding is type-clean.

- [ ] **Step 1: `packages/format/src/types.ts` — context accessor + program flag**

Edit 1 — `FormatEvalContext` (current source, lines 39-43):

```ts
export interface FormatEvalContext {
  value: unknown;
  row: Record<string, unknown>;
  colId: string;
}
```

Replace with:

```ts
export interface FormatEvalContext {
  value: unknown;
  row: Record<string, unknown>;
  colId: string;
  /** Cycle 21e rule-context accessor. When a rule engine is registered,
   *  the kernel closes this over the current cell (rowId/colId/theme):
   *  `resolveRuleRef(id)` returns rule `id`'s theme-resolved style color
   *  when the rule matches the cell, else null. Absent — or resolving
   *  null for every ref — a pure rule-ref bracket contributes null,
   *  exactly the Cycle 21c reserve behavior. */
  resolveRuleRef?: (ruleId: string) => string | null;
}
```

Edit 2 — `FormatProgram` (current source, lines 30-37):

```ts
export interface FormatProgram {
  formatText: (ctx: FormatEvalContext) => string;
  resolveStyle: (ctx: FormatEvalContext) => StyleObj | null;
  resolveIcon: (ctx: FormatEvalContext) => IconRef | null;
  resolveFragments: (ctx: FormatEvalContext) => ResolvedFragment[] | null;
  source: FormatSource;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
}
```

Replace with:

```ts
export interface FormatProgram {
  formatText: (ctx: FormatEvalContext) => string;
  resolveStyle: (ctx: FormatEvalContext) => StyleObj | null;
  resolveIcon: (ctx: FormatEvalContext) => IconRef | null;
  resolveFragments: (ctx: FormatEvalContext) => ResolvedFragment[] | null;
  source: FormatSource;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
  /** Cycle 21e: true when any tier-1 bracket — including fragment-style
   *  `[<expr>]` shorthands and composite cellBackground — contained a
   *  `rule:<id>` reference. The kernel uses this to bypass its per-cell
   *  format-eval memo (Task 14): a rule's matched set can change without
   *  the cell value changing, so memoized style would go stale. The key
   *  is absent for plain programs. */
  hasRuleRefs?: boolean;
}
```

Edit 3 — `RuleRefNode` doc comment (current source, line 134):

```ts
/** Reserved for Cycle 21e — rule reference in style expressions. */
```

Replace with:

```ts
/** Cycle 21e — rule reference in style expressions. Pure-ref brackets
 *  (whole interior is one `rule:<id>`) parse to `ast: null` and resolve
 *  through FormatEvalContext.resolveRuleRef; refs inside larger
 *  expressions are baked to literal `null` by tier1/sugar.ts. */
```

- [ ] **Step 2: `packages/format/src/tier1/resolver.ts` — accessor consult for pure rule-ref nodes**

One edit inside `resolveStyle`. Current source (lines 45-55):

```ts
  for (const node of nodes) {
    if (node.channel === 'if') continue;  // section selector, not a style channel
    if (node.ast === null) continue;      // pure rule-ref → resolver returns null contribution

    let evaluated: unknown;
    try {
      evaluated = evaluateExpression(getCompiled(node.ast), { row: ctx.row });
    } catch {
      continue;  // per-cell eval error — skip this channel
    }
    if (evaluated === null || evaluated === undefined) continue;
```

Replace with:

```ts
  for (const node of nodes) {
    if (node.channel === 'if') continue;  // section selector, not a style channel

    let evaluated: unknown;
    if (node.ast === null) {
      // Pure rule-ref bracket (Cycle 21e). Consult the optional accessor;
      // the FIRST non-null resolution feeds this bracket's channel via the
      // switch below (color or background per the bracket key). Accessor
      // absent, or every ref resolving null → null contribution — exact
      // Cycle 21c reserve behavior.
      if (ctx.resolveRuleRef === undefined) continue;
      evaluated = null;
      for (const ref of node.ruleRefs) {
        const resolved = ctx.resolveRuleRef(ref.ruleId) ?? null;
        if (resolved !== null) {
          evaluated = resolved;
          break;
        }
      }
    } else {
      try {
        evaluated = evaluateExpression(getCompiled(node.ast), { row: ctx.row });
      } catch {
        continue;  // per-cell eval error — skip this channel
      }
    }
    if (evaluated === null || evaluated === undefined) continue;
```

Notes: the shared `if (evaluated === null || ...) continue;` line and the channel switch below it are untouched — resolution flows through the existing per-key assignment (`color`/`bg`/`weight`/`style`). Accessor-absent path is byte-identical to today (`continue` before any allocation). `evaluateIfSelector` (lines 32-39) is deliberately NOT changed — `[if rule:<id>]` keeps returning `false`.

- [ ] **Step 3: `packages/format/src/compile.ts` — `hasRuleRefs` on the string path**

Current source (lines 100-106):

```ts
  const tier0 = excelTokens.length > 0;
  const tier1 = tier1Nodes.length > 0 || iconTokens.length > 0;
  const tier2 = false;

  const program: FormatProgram = {
    source,
    tiers: { tier0, tier1, tier2 },
```

Replace with:

```ts
  const tier0 = excelTokens.length > 0;
  const tier1 = tier1Nodes.length > 0 || iconTokens.length > 0;
  const tier2 = false;
  // Cycle 21e: any bracket that carried a rule:<id> — pure ([color=rule:hot],
  // ast === null, accessor-resolved) or mixed (ref baked to literal null by
  // sugar.ts). Kernel Task 14 uses this to bypass the format-eval memo.
  const hasRuleRefs = tier1Nodes.some((n) => n.ruleRefs.length > 0);

  const program: FormatProgram = {
    source,
    tiers: { tier0, tier1, tier2 },
    ...(hasRuleRefs ? { hasRuleRefs: true } : {}),
```

(The conditional spread keeps the key absent — not `false` — for plain programs, so `hasRuleRefs` tests can assert `toBeUndefined()` and structuredClone snapshots stay unchanged.)

- [ ] **Step 4: `packages/format/src/compile.ts` — `hasRuleRefs` on the composite path**

Current source (lines 131-137):

```ts
export function compileCompositeColDef(colDef: CompositeColDef, opts?: CompileFormatOptions): CompileFormatResult {
  const plan: CompiledFragmentPlan = compileFragments(colDef, opts);

  const program: FormatProgram = {
    source: colDef,
    tiers: { tier0: false, tier1: false, tier2: true },
```

Replace with:

```ts
export function compileCompositeColDef(colDef: CompositeColDef, opts?: CompileFormatOptions): CompileFormatResult {
  const plan: CompiledFragmentPlan = compileFragments(colDef, opts);

  // Cycle 21e: composite programs carry rule refs via fragment-style
  // [<expr>] shorthands (dynamic channels) and the cellBackground program.
  const nodesHaveRefs = (nodes: Tier1Node[] | null): boolean =>
    nodes !== null && nodes.some((n) => n.ruleRefs.length > 0);
  const hasRuleRefs =
    plan.fragments.some(
      (f) =>
        f.kind === 'expr' &&
        (nodesHaveRefs(f.dynamicColor) || nodesHaveRefs(f.dynamicBg) ||
         nodesHaveRefs(f.dynamicWeight) || nodesHaveRefs(f.dynamicItalic)),
    ) || nodesHaveRefs(plan.cellBackgroundProgram?.nodes ?? null);

  const program: FormatProgram = {
    source: colDef,
    tiers: { tier0: false, tier1: false, tier2: true },
    ...(hasRuleRefs ? { hasRuleRefs: true } : {}),
```

(`Tier1Node` is already imported in compile.ts — line 15: `import { parseTier1Brackets, type Tier1Node } from './tier1/parser';`. The `CompiledFragment` union isn't exported by name from fragmentResolver, but it flows structurally through the exported `CompiledFragmentPlan.fragments`, so the `f.kind === 'expr'` narrowing typechecks.)

- [ ] **Step 5: `packages/format/src/tier2/fragmentResolver.ts` — forward the accessor into per-fragment contexts**

`resolveFragments` currently rebuilds the eval context five times without the accessor. Current source (lines 156-181):

```ts
    const style: FragmentStyle = { ...frag.staticStyle };
    if (frag.dynamicColor) {
      const s = resolveStyle(frag.dynamicColor, { value, row: ctx.row, colId: ctx.colId });
      if (s?.color) style.color = s.color;
    }
    if (frag.dynamicBg) {
      const s = resolveStyle(frag.dynamicBg, { value, row: ctx.row, colId: ctx.colId });
      if (s?.background) style.background = s.background;
    }
    if (frag.dynamicWeight) {
      const s = resolveStyle(frag.dynamicWeight, { value, row: ctx.row, colId: ctx.colId });
      if (s?.weight !== undefined) style.weight = s.weight;
    }
    if (frag.dynamicItalic) {
      const s = resolveStyle(frag.dynamicItalic, { value, row: ctx.row, colId: ctx.colId });
      if (s?.italic !== undefined) style.style = s.italic ? 'italic' : 'normal';
    }

    // Icon extracted from per-fragment format string (spec §3.4 example).
    // Use the section-scoped icons so multi-section formats pick the correct icon.
    let icon: IconRef | undefined;
    const iconsForSection = frag.sectionIcons[sectionIndex] ?? frag.sectionIcons[0] ?? [];
    if (iconsForSection.length > 0) {
      const resolved = resolveIcon(iconsForSection, { value, row: ctx.row, colId: ctx.colId });
      if (resolved) icon = resolved;
    }
```

Replace with (single per-fragment context, accessor forwarded; `exactOptionalPropertyTypes` is `false` so the plain assignment is type-clean):

```ts
    // Per-fragment eval context: the fragment's own value, the outer row,
    // and (Cycle 21e) the rule-ref accessor forwarded from the outer ctx.
    const fragCtx: FormatEvalContext = {
      value,
      row: ctx.row,
      colId: ctx.colId,
      resolveRuleRef: ctx.resolveRuleRef,
    };

    const style: FragmentStyle = { ...frag.staticStyle };
    if (frag.dynamicColor) {
      const s = resolveStyle(frag.dynamicColor, fragCtx);
      if (s?.color) style.color = s.color;
    }
    if (frag.dynamicBg) {
      const s = resolveStyle(frag.dynamicBg, fragCtx);
      if (s?.background) style.background = s.background;
    }
    if (frag.dynamicWeight) {
      const s = resolveStyle(frag.dynamicWeight, fragCtx);
      if (s?.weight !== undefined) style.weight = s.weight;
    }
    if (frag.dynamicItalic) {
      const s = resolveStyle(frag.dynamicItalic, fragCtx);
      if (s?.italic !== undefined) style.style = s.italic ? 'italic' : 'normal';
    }

    // Icon extracted from per-fragment format string (spec §3.4 example).
    // Use the section-scoped icons so multi-section formats pick the correct icon.
    let icon: IconRef | undefined;
    const iconsForSection = frag.sectionIcons[sectionIndex] ?? frag.sectionIcons[0] ?? [];
    if (iconsForSection.length > 0) {
      const resolved = resolveIcon(iconsForSection, fragCtx);
      if (resolved) icon = resolved;
    }
```

No change to `resolveCellBackground` (lines 188-191) — it already forwards the outer `ctx` unmodified, so cellBackground rule refs resolve for free.

- [ ] **Step 6: `packages/format/tests/tier1/resolver.test.ts` — update the reserve test + add accessor tests**

Edit 6a — widen the import (current line 3):

```ts
import { resolveStyle, resolveIcon } from '../../src/tier1/resolver';
```

Replace with:

```ts
import { resolveStyle, resolveIcon, evaluateIfSelector } from '../../src/tier1/resolver';
```

Edit 6b — UPDATE (not delete) the 21c reserve test. Current source (lines 74-83):

```ts
  it('rule-ref node returns null (Cycle 21e reserve)', () => {
    const nodes: Tier1Node[] = [{
      channel: 'color',
      ast: null,
      ruleRefs: [{ kind: 'rule-ref', ruleId: 'up', loc: { start: 0, end: 7 } }],
      loc: { start: 0, end: 10 },
    }];
    const style = resolveStyle(nodes, { value: null, row: {}, colId: 'c' });
    expect(style).toBeNull();
  });
```

Replace with (identical expectation — accessor-absent branch must stay byte-identical to 21c):

```ts
  it('rule-ref node contributes null when ctx.resolveRuleRef is absent (accessor-absent branch — 21c behavior preserved)', () => {
    const nodes: Tier1Node[] = [{
      channel: 'color',
      ast: null,
      ruleRefs: [{ kind: 'rule-ref', ruleId: 'up', loc: { start: 0, end: 7 } }],
      loc: { start: 0, end: 10 },
    }];
    const style = resolveStyle(nodes, { value: null, row: {}, colId: 'c' });
    expect(style).toBeNull();
  });
```

Edit 6c — append a new describe block at the end of the file (after the `Tier 1 resolveIcon` describe):

```ts
describe('Tier 1 resolveStyle — rule refs (Cycle 21e)', () => {
  const pureRefNode = (channel: Tier1Node['channel'], ruleId: string): Tier1Node => ({
    channel,
    ast: null,
    ruleRefs: [{ kind: 'rule-ref', ruleId, loc: { start: 0, end: 5 + ruleId.length } }],
    loc: { start: 0, end: 10 },
  });

  it('accessor present: pure rule-ref resolves the color channel', () => {
    const style = resolveStyle([pureRefNode('color', 'hot')], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: (ruleId) => (ruleId === 'hot' ? '#ff0000' : null),
    });
    expect(style).toEqual({ color: '#ff0000' });
  });

  it('accessor present: pure rule-ref resolves the bg channel', () => {
    const style = resolveStyle([pureRefNode('bg', 'hot')], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: () => '#fff3e0',
    });
    expect(style).toEqual({ background: '#fff3e0' });
  });

  it('accessor returning null (rule not matched) → null style', () => {
    const style = resolveStyle([pureRefNode('color', 'hot')], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: () => null,
    });
    expect(style).toBeNull();
  });

  it('first non-null resolution wins across multiple rule refs, in order', () => {
    const node: Tier1Node = {
      channel: 'color',
      ast: null,
      ruleRefs: [
        { kind: 'rule-ref', ruleId: 'cold', loc: { start: 0, end: 9 } },
        { kind: 'rule-ref', ruleId: 'hot', loc: { start: 10, end: 18 } },
      ],
      loc: { start: 0, end: 20 },
    };
    const seen: string[] = [];
    const style = resolveStyle([node], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: (ruleId) => {
        seen.push(ruleId);
        return ruleId === 'hot' ? '#ff0000' : null;
      },
    });
    expect(style).toEqual({ color: '#ff0000' });
    expect(seen).toEqual(['cold', 'hot']);
  });

  it('[if rule:<id>] stays false — the accessor never drives section selection', () => {
    const node: Tier1Node = {
      channel: 'if',
      ast: null,
      ruleRefs: [{ kind: 'rule-ref', ruleId: 'hot', loc: { start: 0, end: 8 } }],
      loc: { start: 0, end: 12 },
    };
    const ctx = { value: null, row: {}, colId: 'c', resolveRuleRef: () => '#ff0000' };
    expect(evaluateIfSelector(node, ctx)).toBe(false);
    // resolveStyle also skips `if` nodes before any rule-ref consult.
    expect(resolveStyle([node], ctx)).toBeNull();
  });
});
```

- [ ] **Step 7: `packages/format/tests/compile.test.ts` — `hasRuleRefs` + public-API round-trips**

Edit 7a — the test file's existing imports (lines 1-3) already cover everything needed (`compileFormat`, `compileCompositeColDef`, `CompositeColDef`); no import change.

Edit 7b — append a new describe block at the end of the file:

```ts
describe('compileFormat — rule refs + hasRuleRefs (Cycle 21e)', () => {
  it('hasRuleRefs is true for formats whose tier-1 brackets contain rule:<id>', () => {
    const r = compileFormat('[color=rule:hot] $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.hasRuleRefs).toBe(true);
  });

  it('hasRuleRefs is undefined for plain formats (tier 0 and expression-only tier 1)', () => {
    const plain = compileFormat('0.00');
    expect(plain.ok).toBe(true);
    if (!plain.ok) throw new Error(plain.error.message);
    expect(plain.program.hasRuleRefs).toBeUndefined();

    const tier1 = compileFormat('[color=[change] > 0 ? "#0a7" : "#d33"] 0.00');
    expect(tier1.ok).toBe(true);
    if (!tier1.ok) throw new Error(tier1.error.message);
    expect(tier1.program.hasRuleRefs).toBeUndefined();
  });

  it('round-trip: [color=rule:hot] resolves through ctx.resolveRuleRef; absent accessor → 21c null contribution', () => {
    const r = compileFormat('[color=rule:hot] $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);

    // Accessor present + rule matched → live rule color.
    const style = r.program.resolveStyle({
      value: 1234.5, row: {}, colId: 'x',
      resolveRuleRef: (ruleId) => (ruleId === 'hot' ? '#ff0000' : null),
    });
    expect(style?.color).toBe('#ff0000');

    // Text path unaffected by the bracket.
    expect(r.program.formatText({ value: 1234.5, row: {}, colId: 'x' })).toBe('$1,234.50');

    // Accessor absent → exact Cycle 21c reserve behavior.
    expect(r.program.resolveStyle({ value: 1234.5, row: {}, colId: 'x' })?.color).toBeUndefined();
  });

  it('mixed bracket: rule:<id> inside a larger expression is baked to literal null (never accessor-resolved); hasRuleRefs still true', () => {
    // sugar.ts canonicalizes the interior to `[x] > 0 ? null : "#d33"` —
    // ast !== null, so the resolver takes the expression path; the ref
    // position contributes null even with an accessor present. Only
    // whole-interior refs ([color=rule:hot]) get ast === null + accessor
    // resolution. ruleRefs are still recorded → memo bypass stays correct.
    const r = compileFormat('[color=[x] > 0 ? rule:hot : "#d33"] 0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.hasRuleRefs).toBe(true);

    const resolveRuleRef = (): string => '#ff0000';
    // Ternary picks the rule-ref branch → baked null → no color contribution.
    expect(r.program.resolveStyle({ value: 1, row: { x: 5 }, colId: 'c', resolveRuleRef })?.color)
      .toBeUndefined();
    // Ternary picks the literal branch → normal expression result.
    expect(r.program.resolveStyle({ value: 1, row: { x: -5 }, colId: 'c', resolveRuleRef })?.color)
      .toBe('#d33');
  });

  it('composite fragment [rule:<id>] style shorthand resolves via the accessor; program reports hasRuleRefs', () => {
    const colDef: CompositeColDef = {
      colId: 'summary',
      type: 'composite',
      fragments: [{ expr: '[symbol]', style: { color: '[rule:hot]' } }],
    };
    const r = compileCompositeColDef(colDef);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.hasRuleRefs).toBe(true);

    const withAccessor = r.program.resolveFragments({
      value: null, row: { symbol: 'AAPL' }, colId: 'summary',
      resolveRuleRef: (ruleId) => (ruleId === 'hot' ? '#ff0000' : null),
    });
    expect(withAccessor?.[0]?.text).toBe('AAPL');
    expect(withAccessor?.[0]?.style.color).toBe('#ff0000');

    // Accessor absent → shorthand contributes nothing (21c behavior).
    const without = r.program.resolveFragments({ value: null, row: { symbol: 'AAPL' }, colId: 'summary' });
    expect(without?.[0]?.text).toBe('AAPL');
    expect(without?.[0]?.style.color).toBeUndefined();
  });
});
```

- [ ] **Step 8: Verify**

```bash
cd /Users/develop/wfh/canvasgrid/packages/format
npx vitest run
npx tsc --noEmit
```

Expected:

```
 Test Files  11 passed (11)
      Tests  171 passed (171)
```

and a clean (silent) `tsc --noEmit`.

Count accounting: pre-task baseline measured **161** on `main` @ `28d2d5a` (the plan header's `158` predates the 21c final-review commits — re-measure before starting; whatever the pre-task count is, this task adds exactly **+10**: 5 in `resolver.test.ts`, 5 in `compile.test.ts`; the reserve test is retitled in place, net zero). Every pre-existing test must pass unmodified — the accessor-absent path is byte-identical (`continue` before any new code executes).

- [ ] **Step 9: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/format
git commit -m "feat(format): cycle 21e task 9 — rule:<ruleId> resolver accessor + hasRuleRefs"
```


## Phase E — Kernel: slot, fold, events, flash, indicators, memo (5 tasks)

> **Reality notes for this phase (read before Task 10).** These plan tasks were written against the actual kernel sources on `main`; where the design spec guessed line numbers or mechanisms, the tasks below follow reality and say so:
>
> 1. **Flash timing is main-side, not worker-side.** `flashCells` → `workerCoord.flashCells(rowIds, colIds)` only resolves string→numeric rowIds and stages `pendingFlashes` worker-side; the *timing* (flashDuration/fadeDuration capture, alpha math) lives entirely in the main-thread `FlashRegistry` (`src/core/flashRegistry.ts:81-94, 156-168`). Per-call overrides therefore need **no protocol change** — they ride a main-side override map consumed when the worker's 1-bit `flashMask` is ingested (Task 13).
> 2. **The paint path has no string rowId today.** `chunk.rowIds` is numeric (worker-interned counter, `src/worker/dataPipeline.ts:218-226` — NOT a reproducible hash despite the protocol comment), and `cgrid.rowIdAt` is a stub returning `` `row-${rowIndex}` `` (`src/velocityGrid.ts:6622-6626`). Rule evaluation, flash overrides, and the format memo all need the real string rowId per visible row. Task 11 adds an optional `stringRowIds?: string[]` field to `ViewportChunk` — riding the structured-clone path exactly like `groupValue` (Cycle 15 precedent, see `collectViewportTransferables` comment at `src/worker/protocol.ts:700-703`). The `rowIdAt` stub is deliberately NOT changed (event payloads stay byte-identical).
> 3. **Row snapshots at paint are visible-columns-only** (`rowDataSnapshotAt`, `src/velocityGrid.ts:7406-7413`). Rule conditions must see full rows (hidden meta columns are common in blotters), so the fold's eval row comes from `rowDataById` via the new string rowId, with the snapshot as fallback (Task 11).
> 4. **The edit commit path never touches `rowDataById`.** `cellValueChanged` is emitted in `src/core/editController.ts` (~315, ~585), and its commit-back calls `this.workerCoord.applyTransaction(payload)` directly via the dep at `src/velocityGrid.ts:1524` — bypassing `updateRowDataCache`. Task 12's `source: 'edit'` emission therefore lives in that dep wrapper, fully listener-gated.
> 5. **`textDecoration` has no existing paint channel** (no key in `ColCellOverrides`, `src/types/cell.ts:111-168`; decorators are corner badges). Per the no-deferral rule, Task 11 adds a minimal `textDecoration` channel to `ColCellOverrides` + `CellPaintConfig` + the `textCell`/`numberCell` painters.
> 6. **The rule `valueFormatter` override cannot live in the `compileFormatSlots` wrapped lambda** — that lambda exists only for columns that declared a format string. The override folds into `applyCellProps` (Task 14) so it works on every column.
>
> Every task ends with a full kernel run; the `2399` baseline must stay green unmodified throughout.

---

### Task 10: Rule-engine DI slot + `registerRuleEngine` + `getThemeKind` + `forEachRow`

**Files:**
- Create: `packages/kernel/src/core/ruleEngineSlot.ts`
- Create: `packages/kernel/src/theming/themeKind.ts`
- Modify: `packages/kernel/src/velocityGrid.ts` (three methods + api literal entries)
- Modify: `packages/kernel/src/types/api.ts` (three `VelocityGridApi` signatures)
- Modify: `packages/kernel/package.json` (`@wellsfargo-starui/velocity-grid-rules` devDependency)
- Create: `packages/kernel/tests/core/ruleEngineSlot.test.ts`
- Create: `packages/kernel/tests/core/themeKind.test.ts`
- Create: `packages/kernel/tests/rulesKernelApi.test.ts`

**Interfaces:**
- Consumes: spec §5.2 structural shapes (`RuleEngineShape` with `evaluateCell` + `resolveRuleRef`) — copied verbatim below; nothing from `@wellsfargo-starui/velocity-grid-rules` at runtime (devDep is type-resolution only, for Task 15's bridge integration tests).
- Produces (for Tasks 11/13/14 kernel-side): `registerRuleEngine(engine)`, `getRuleEngine()`, `_resetRuleEngine_forTests()`, types `RuleEngineShape` / `RuleCellPatchShape` / `RuleEvalCtxShape`. Produces (for Task 15's `wireIntoKernel` in `@wellsfargo-starui/velocity-grid-rules`): `grid.registerRuleEngine(engine)`, `grid.forEachRow(fn)`, `grid.getThemeKind()` on both `VelocityGrid` and `VelocityGridApi`.

- [ ] **Step 1: Write the rule-engine slot module**

Create `packages/kernel/src/core/ruleEngineSlot.ts`, mirroring `formatCompilerSlot.ts` exactly (module-level nullable singleton + test-reset helper — the pattern at `src/core/formatCompilerSlot.ts:41-54`):

```ts
// Kernel-side rule-engine dependency-injection slot.
//
// @wellsfargo-starui/velocity-grid-rules registers its engine adapter via wireIntoKernel(); kernel
// consults the registered engine in propertyChain.applyCellProps (Cycle 21e
// Task 11) and threads resolveRuleRef into format-eval contexts (Task 14).
// Kernel does NOT import @wellsfargo-starui/velocity-grid-rules at runtime — only structural types,
// exactly like core/formatCompilerSlot.ts.

/** Evaluation context the kernel paint path supplies per data cell.
 *  Spec: docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §5.2. */
export interface RuleEvalCtxShape {
  row: unknown;
  rowId: string;
  /** null → row-scope evaluation (no cell column). */
  colId: string | null;
  theme: 'light' | 'dark';
}

/** Folded per-cell rule result. Structural mirror of @wellsfargo-starui/velocity-grid-rules'
 *  RuleCellResult (spec §4.2) — formatProgram stays `unknown` because
 *  kernel only forwards it into FormatProgramShape.formatText. */
export interface RuleCellPatchShape {
  matched: string[];
  style: {
    color?: string;
    backgroundColor?: string;
    fontWeight?: 'normal' | 'bold' | number;
    fontStyle?: 'normal' | 'italic';
    textDecoration?: string;
    borderColor?: string;
    borderStyle?: string;
  } | null;
  indicator: { iconName: string; color: string; target: string; position: string } | null;
  formatProgram: unknown | null;
}

export interface RuleEngineShape {
  evaluateCell(ctx: RuleEvalCtxShape): RuleCellPatchShape;
  resolveRuleRef(ruleId: string, ctx: RuleEvalCtxShape): string | null;
}

let injectedEngine: RuleEngineShape | null = null;

export function registerRuleEngine(engine: RuleEngineShape): void {
  injectedEngine = engine;
}

export function getRuleEngine(): RuleEngineShape | null {
  return injectedEngine;
}

/** Test-only helper — not part of public API. */
export function _resetRuleEngine_forTests(): void {
  injectedEngine = null;
}
```

- [ ] **Step 2: Write the theme-kind helper**

The kernel has NO stored theme "kind" — the design spec's assumption had to be resolved against reality. What actually exists: `setTheme(themeClass)` swaps a `vg-theme-*` class on the grid root (`src/velocityGrid.ts:4879-4887`), the shipped themes are `vg-theme-quartz`, `vg-theme-quartz-dark`, `vg-theme-high-contrast`, `vg-theme-high-contrast-dark`, and `vg-theme-auto` (OS-following via `@media (prefers-color-scheme: dark)`, `src/theming/tokens.css:416-425`), and `this.theme = this.cssReader.read()` re-resolves tokens (`ResolvedTheme` carries no kind flag). So `getThemeKind()` derives the kind from (a) the root's `vg-theme-*` class `-dark` suffix, (b) `matchMedia` for `vg-theme-auto`, (c) a bg-luminance fallback for custom themes.

Create `packages/kernel/src/theming/themeKind.ts`:

```ts
// Cycle 21e / Task 10 — derive a binary light/dark "kind" for the active
// theme. The kernel has no stored kind: shipped themes signal darkness by
// class-name convention (`vg-theme-quartz-dark`, `vg-theme-high-contrast-dark`),
// `vg-theme-auto` follows the OS preference, and custom themes fall back to
// the relative luminance of the resolved background color.

/** Parse `#rgb` / `#rrggbb` / `rgb(...)` / `rgba(...)` into [r,g,b] 0-255.
 *  Returns null for anything else (named colors, hsl — fallback = light). */
function parseColor(color: string): [number, number, number] | null {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** True when the color reads as dark (relative luminance < 0.5).
 *  Unparseable colors return false (treat as light — matches the
 *  kernel default theme). */
export function isDarkColor(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  // Perceptual luma (ITU-R BT.601) — good enough for a binary split.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/** Resolve the theme kind from the grid root's classList + resolved bg. */
export function resolveThemeKind(
  classList: Iterable<string>,
  resolvedBg: string,
): 'light' | 'dark' {
  let themeClass: string | undefined;
  for (const c of classList) {
    if (c.startsWith('vg-theme-')) { themeClass = c; break; }
  }
  if (themeClass === 'vg-theme-auto') {
    return typeof matchMedia === 'function'
      && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  if (themeClass !== undefined) {
    return themeClass.endsWith('-dark') ? 'dark' : 'light';
  }
  return isDarkColor(resolvedBg) ? 'dark' : 'light';
}
```

- [ ] **Step 3: Wire the three public methods in `velocityGrid.ts`**

Add the imports next to the existing slot import (`src/velocityGrid.ts:141` currently reads `registerFormatCompiler as slotRegisterFormatCompiler,` inside the `./core/formatCompilerSlot` import group):

```ts
import { registerRuleEngine as slotRegisterRuleEngine, type RuleEngineShape } from './core/ruleEngineSlot';
import { resolveThemeKind } from './theming/themeKind';
```

Add `registerRuleEngine` directly below the existing `registerFormatCompiler` method. Current code (`src/velocityGrid.ts:4822-4828`):

```ts
  /** Cycle 21c / Task 10 — register the @wellsfargo-starui/velocity-grid-format compiler into the
   *  kernel DI slot. Invoked by wireIntoKernel(grid) in @wellsfargo-starui/velocity-grid-format;
   *  kernel's compileFormatSlots pass (Task 11) calls getFormatCompiler()
   *  to obtain it. Apps that never call this see no behavior change. */
  registerFormatCompiler(fn: FormatCompiler): void {
    slotRegisterFormatCompiler(fn);
  }
```

Insert after it:

```ts
  /** Cycle 21e / Task 10 — register the @wellsfargo-starui/velocity-grid-rules engine adapter into
   *  the kernel DI slot. Invoked by wireIntoKernel(grid) in @wellsfargo-starui/velocity-grid-rules;
   *  kernel's applyCellProps fold (Task 11) calls getRuleEngine() to
   *  obtain it. Apps that never call this see no behavior change. */
  registerRuleEngine(engine: RuleEngineShape): void {
    slotRegisterRuleEngine(engine);
    this.cgridCanvas?.requestRepaint();
  }

  /** Cycle 21e / Task 10 — binary light/dark kind of the active theme.
   *  Derived from the root's `vg-theme-*` class (`-dark` suffix
   *  convention), `matchMedia` for `vg-theme-auto`, or the resolved
   *  `theme.bg` luminance for custom themes. */
  getThemeKind(): 'light' | 'dark' {
    return resolveThemeKind(Array.from(this.root.classList), this.theme.bg);
  }
```

Add `forEachRow` next to the existing `getTotalRowCount` — current code (`src/velocityGrid.ts:2978-2982`):

```ts
   *  main-thread `rowDataById` cache (populated by `setRowData` +
   ...
  getTotalRowCount(): number { return this.rowDataById.size; }
```

Insert after `getTotalRowCount`:

```ts
  /** Cycle 21e / Task 10 — iterate every row in the main-thread
   *  `rowDataById` mirror (setRowData + all transaction paths keep it in
   *  sync since Cycle 7 / Task 8). Insertion order. Used by
   *  @wellsfargo-starui/velocity-grid-rules' wireIntoKernel to seed match counts. */
  forEachRow(fn: (rowId: string, row: TRow) => void): void {
    for (const [rowId, row] of this.rowDataById) fn(rowId, row);
  }
```

Add the three api-literal entries next to the existing one at `src/velocityGrid.ts:5505` (`registerFormatCompiler: (fn) => this.registerFormatCompiler(fn),`):

```ts
      registerRuleEngine: (engine) => this.registerRuleEngine(engine),
      forEachRow: (fn) => this.forEachRow(fn),
      getThemeKind: () => this.getThemeKind(),
```

- [ ] **Step 4: Add the `VelocityGridApi` signatures in `types/api.ts`**

Directly below the existing `registerFormatCompiler` signature (`src/types/api.ts:403`):

```ts
  /** Cycle 21e / Task 10 — register the rule engine (supplied by
   *  @wellsfargo-starui/velocity-grid-rules' wireIntoKernel). Kernel consults it in the
   *  applyCellProps fold (Task 11). Apps that never call this see
   *  identical behavior to before. */
  registerRuleEngine(engine: import('../core/ruleEngineSlot').RuleEngineShape): void;

  /** Cycle 21e / Task 10 — iterate the main-thread row mirror
   *  (rowId → row, insertion order). */
  forEachRow(fn: (rowId: string, row: TRow) => void): void;

  /** Cycle 21e / Task 10 — binary light/dark kind of the active theme. */
  getThemeKind(): 'light' | 'dark';
```

- [ ] **Step 5: Add the `@wellsfargo-starui/velocity-grid-rules` devDependency**

In `packages/kernel/package.json`, `devDependencies` currently starts with `"@wellsfargo-starui/velocity-grid-format": "*",` — add alphabetically after it:

```json
    "@wellsfargo-starui/velocity-grid-rules": "*",
```

Run `npm install` at the repo root. (Type-resolution only — Task 17 greps kernel dist for zero `@wellsfargo-starui/velocity-grid-rules` runtime imports.)

- [ ] **Step 6: Slot + themeKind unit tests**

Create `packages/kernel/tests/core/ruleEngineSlot.test.ts` (mirrors `tests/core/formatCompilerSlot.test.ts`):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRuleEngine,
  getRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../../src/core/ruleEngineSlot';

const EMPTY = { matched: [], style: null, indicator: null, formatProgram: null };

describe('Kernel rule-engine slot', () => {
  beforeEach(() => _resetRuleEngine_forTests());

  it('returns null when no engine registered', () => {
    expect(getRuleEngine()).toBeNull();
  });

  it('stores and returns the registered engine', () => {
    const fake: RuleEngineShape = {
      evaluateCell: () => EMPTY,
      resolveRuleRef: () => null,
    };
    registerRuleEngine(fake);
    expect(getRuleEngine()).toBe(fake);
  });

  it('overwrites previous engine on re-register', () => {
    const first: RuleEngineShape = { evaluateCell: () => EMPTY, resolveRuleRef: () => null };
    const second: RuleEngineShape = { evaluateCell: () => EMPTY, resolveRuleRef: () => '#f00' };
    registerRuleEngine(first);
    registerRuleEngine(second);
    expect(getRuleEngine()).toBe(second);
  });

  it('reset helper clears the slot', () => {
    registerRuleEngine({ evaluateCell: () => EMPTY, resolveRuleRef: () => null });
    _resetRuleEngine_forTests();
    expect(getRuleEngine()).toBeNull();
  });
});
```

Create `packages/kernel/tests/core/themeKind.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isDarkColor, resolveThemeKind } from '../../src/theming/themeKind';

describe('isDarkColor', () => {
  it('classifies hex colors', () => {
    expect(isDarkColor('#ffffff')).toBe(false);
    expect(isDarkColor('#0b0e14')).toBe(true);
    expect(isDarkColor('#fff')).toBe(false);
    expect(isDarkColor('#111')).toBe(true);
  });
  it('classifies rgb()/rgba() colors', () => {
    expect(isDarkColor('rgb(255, 255, 255)')).toBe(false);
    expect(isDarkColor('rgba(20, 20, 24, 1)')).toBe(true);
  });
  it('unparseable colors read as light', () => {
    expect(isDarkColor('papayawhip')).toBe(false);
    expect(isDarkColor('')).toBe(false);
  });
});

describe('resolveThemeKind', () => {
  it('-dark suffixed theme classes are dark', () => {
    expect(resolveThemeKind(['vg-theme-quartz-dark'], '#fff')).toBe('dark');
    expect(resolveThemeKind(['vg-theme-high-contrast-dark'], '#fff')).toBe('dark');
  });
  it('non-dark theme classes are light regardless of bg', () => {
    expect(resolveThemeKind(['vg-theme-quartz'], '#000')).toBe('light');
    expect(resolveThemeKind(['vg-theme-high-contrast'], '#000')).toBe('light');
  });
  it('no vg-theme class falls back to bg luminance', () => {
    expect(resolveThemeKind(['my-custom-grid'], '#0b0e14')).toBe('dark');
    expect(resolveThemeKind([], '#ffffff')).toBe('light');
  });
  it('vg-theme-auto follows prefers-color-scheme (light default in happy-dom)', () => {
    expect(resolveThemeKind(['vg-theme-auto'], '#000')).toBe('light');
  });
});
```

- [ ] **Step 7: Real-grid fixture test for `forEachRow` + `getThemeKind`**

Create `packages/kernel/tests/rulesKernelApi.test.ts`. Reuse the `Worker` + canvas-context stubs from `tests/cgrid.integration.test.ts:1-36` verbatim (fake `Worker` class + `HTMLCanvasElement.prototype.getContext` stub). Key facts making this test synchronous: `applyTransaction` calls `updateRowDataCache(t)` BEFORE the worker round-trip (`src/velocityGrid.ts:1949`), so `rowDataById` — and therefore `forEachRow` — is populated even with a stubbed worker.

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

beforeAll(() => {
  // ── stubs copied from tests/cgrid.integration.test.ts ──
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

function makeGrid(themeClass = 'vg-theme-quartz') {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = themeClass;
  document.body.appendChild(container);
  return new VelocityGrid<{ id: string; px: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'px' }],
    getRowId: (r) => r.id,
    theme: themeClass,
  });
}

describe('VelocityGrid rules-facing API (Cycle 21e / Task 10)', () => {
  it('forEachRow iterates the rowDataById mirror in insertion order', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }, { id: 'b', px: 2 }] });
    grid.applyTransaction({ update: [{ id: 'a', px: 3 }] });
    const seen: Array<[string, number]> = [];
    grid.forEachRow((rowId, row) => seen.push([rowId, row.px]));
    expect(seen).toEqual([['a', 3], ['b', 2]]);
    grid.destroy();
  });

  it('forEachRow drops removed rows', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }, { id: 'b', px: 2 }] });
    grid.applyTransaction({ remove: [{ id: 'a', px: 1 }] });
    const ids: string[] = [];
    grid.forEachRow((rowId) => ids.push(rowId));
    expect(ids).toEqual(['b']);
    grid.destroy();
  });

  it('getThemeKind reads light from vg-theme-quartz and dark from vg-theme-quartz-dark', () => {
    const light = makeGrid('vg-theme-quartz');
    expect(light.getThemeKind()).toBe('light');
    light.destroy();
    const dark = makeGrid('vg-theme-quartz-dark');
    expect(dark.getThemeKind()).toBe('dark');
    dark.destroy();
  });

  it('setTheme flips getThemeKind at runtime', () => {
    const grid = makeGrid('vg-theme-quartz');
    grid.setTheme('vg-theme-quartz-dark');
    expect(grid.getThemeKind()).toBe('dark');
    grid.destroy();
  });

  it('registerRuleEngine round-trips through the slot', async () => {
    const { getRuleEngine, _resetRuleEngine_forTests } = await import('../src/core/ruleEngineSlot');
    _resetRuleEngine_forTests();
    const grid = makeGrid();
    const engine = {
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: () => null,
    };
    grid.registerRuleEngine(engine);
    expect(getRuleEngine()).toBe(engine);
    _resetRuleEngine_forTests();
    grid.destroy();
  });
});
```

Note: if the `VelocityGrid` constructor requires additional fixture plumbing that `tests/cgrid.integration.test.ts` performs beyond the two stubs (check its full body during implementation), copy that plumbing too — the fixture file is the authority.

- [ ] **Step 8: Run new tests + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run tests/core/ruleEngineSlot.test.ts tests/core/themeKind.test.ts tests/rulesKernelApi.test.ts
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx tsc --noEmit
```

Expected: all new tests PASS (4 + 7 + 5), typecheck clean.

- [ ] **Step 9: Full kernel baseline run**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run 2>&1 | tail -5
```

Expected: `2399` baseline + 16 new = **2415 PASS**, 0 failures.

- [ ] **Step 10: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/kernel/src/core/ruleEngineSlot.ts packages/kernel/src/theming/themeKind.ts packages/kernel/src/velocityGrid.ts packages/kernel/src/types/api.ts packages/kernel/package.json package-lock.json packages/kernel/tests/core/ruleEngineSlot.test.ts packages/kernel/tests/core/themeKind.test.ts packages/kernel/tests/rulesKernelApi.test.ts
git commit -m "feat(kernel): cycle 21e task 10 — rule-engine DI slot + registerRuleEngine + getThemeKind + forEachRow"
```

---

### Task 11: `applyCellProps` rule-patch fold (+ string rowId threading + textDecoration channel)

**Files:**
- Modify: `packages/kernel/src/worker/protocol.ts` (`ViewportChunk.stringRowIds?` + normalize)
- Modify: `packages/kernel/src/worker/viewportSlicer.ts` + `packages/kernel/src/worker/dataPipeline.ts` (populate `stringRowIds` at the two `store.getNumericId` slice sites)
- Modify: `packages/kernel/src/velocityGrid.ts` (`stringRowIdAt` accessor; Renderer deps `stringRowIdAt`/`getThemeKind`/`getRowDataById`; `getCellPaintedBg` threading)
- Modify: `packages/kernel/src/renderer/renderer.ts` + `packages/kernel/src/renderer/painters/types.ts` (PainterCtx fields)
- Modify: `packages/kernel/src/renderer/painters/byRows.ts` (per-row rowId/ruleRow resolution + ctx threading)
- Modify: `packages/kernel/src/core/propertyChain.ts` (fold + `ApplyCellPropsInput` fields)
- Modify: `packages/kernel/src/types/cell.ts` (`ColCellOverrides.textDecoration`)
- Modify: `packages/kernel/src/renderer/cellRenderers/registry.ts` (`CellPaintConfig.textDecoration` + `ruleIndicator`; textCell/numberCell decoration draw)
- Create: `packages/kernel/tests/core/propertyChain-ruleFold.test.ts`
- Create: `packages/kernel/tests/chunkStringRowIds.test.ts`

**Interfaces:**
- Consumes (Task 10): `getRuleEngine()`, `RuleEngineShape`, `RuleCellPatchShape`.
- Produces (Task 13): `chunk.stringRowIds` + `cgrid.stringRowIdAt(rowIndex)` (the string↔numeric join the flash-override registry needs). Produces (Task 14): `ApplyCellPropsInput.rowId/themeKind/ruleRow`, `CellPaintConfig.ruleIndicator` (stored by the fold, painted by Task 14), the single-`evaluateCell`-per-cell fold block Task 14 extends. Produces (Task 16 E2E): `getCellPaintedBg` reflecting rule styles.

- [ ] **Step 1: Add `stringRowIds` to the chunk (protocol)**

In `src/worker/protocol.ts`, the `ViewportChunk` interface currently has (line 163):

```ts
  rowIds: Uint32Array;                       // numeric row IDs (hashed)
```

Add directly below it:

```ts
  /** Cycle 21e / Task 11 — string rowId for each visible row, parallel to
   *  `rowIds`. Empty string for non-data entries (group / footer rows).
   *  Rides the structured-clone path like `groupValue` (a string[] is not
   *  transferable) — see collectViewportTransferables. Gives the main
   *  thread the worker's string↔numeric mapping for the rule-engine fold
   *  (evaluation ctx rowId) and per-cell flash overrides (Task 13).
   *  Optional: absent on chunks from older workers; normalizeViewportChunk
   *  substitutes per-row `''`. */
  stringRowIds?: string[];
```

In `normalizeViewportChunk` (line 722), the current fast-path check + fill:

```ts
export function normalizeViewportChunk(chunk: ViewportChunk): ViewportChunk {
  if (chunk.groupValue && chunk.groupChildCount && chunk.isExpanded && chunk.groupKey) {
    return chunk;
  }
```

becomes:

```ts
export function normalizeViewportChunk(chunk: ViewportChunk): ViewportChunk {
  if (chunk.groupValue && chunk.groupChildCount && chunk.isExpanded && chunk.groupKey && chunk.stringRowIds) {
    return chunk;
  }
```

and in the copy branch, next to `const groupKey = chunk.groupKey ?? ...`:

```ts
  const stringRowIds = chunk.stringRowIds ?? new Array<string>(rowCount).fill('');
```

with the return widened to `return { ...chunk, groupValue, groupChildCount, isExpanded, groupKey, stringRowIds };`.

`collectViewportTransferables` needs NO change (string[] is structured-clone, per its own Cycle 15 comment).

- [ ] **Step 2: Populate `stringRowIds` at both slice sites**

There are exactly two places that write `rowIds[i] = store.getNumericId(...)` — both already hold the string id:

(a) `src/worker/viewportSlicer.ts:258-260` (grouped slicer):

```ts
    const rowId = postFilterIds[entry.rowIndex];
    if (rowId === undefined) continue;
    rowIds[i] = store.getNumericId(rowId);
```

becomes:

```ts
    const rowId = postFilterIds[entry.rowIndex];
    if (rowId === undefined) continue;
    rowIds[i] = store.getNumericId(rowId);
    stringRowIds[i] = rowId;
```

with `const stringRowIds: string[] = new Array<string>(count).fill('');` declared next to the existing `const groupValue: string[] = new Array<string>(count).fill('');` (line 194), and `stringRowIds,` added to the chunk object literal next to `groupValue,` (line ~367).

(b) `src/worker/dataPipeline.ts:871` (flat slicer) — same three-line pattern: locate `rowIds[i] = this.store.getNumericId(id);`, add `stringRowIds[i] = id;`, declare the array parallel to `rowIds` in that function, and add `stringRowIds` to its returned chunk. Quote the surrounding function during implementation; the shape mirrors (a).

- [ ] **Step 3: `stringRowIdAt` accessor + Renderer deps in `velocityGrid.ts`**

Add next to the existing `rowIdAt` stub (`src/velocityGrid.ts:6622-6626` — which is deliberately left untouched so `cellClicked` etc. payloads stay byte-identical):

```ts
  /** Cycle 21e / Task 11 — real string rowId for a visible data row, from
   *  the chunk's `stringRowIds` mirror. Returns null for rows outside the
   *  chunk window and '' for non-data rows (group / footer). NOTE: the
   *  legacy `rowIdAt` stub above still feeds pointer-event payloads —
   *  changing it would alter existing event payloads; this accessor is
   *  additive and rules/flash-only. */
  private stringRowIdAt(rowIndex: number): string | null {
    if (!this.chunk) return null;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    return this.chunk.stringRowIds?.[localIndex] ?? null;
  }
```

In the `new Renderer({ ... })` options literal (`src/velocityGrid.ts:1006-1017`, next to `rowDataSnapshotAt: (rowIndex) => this.rowDataSnapshotAt(rowIndex),`), add:

```ts
      // Cycle 21e / Task 11 — rule-fold threading: string rowId per data
      // row, full-row lookup from the rowDataById mirror (the paint
      // snapshot is visible-columns-only), and the active theme kind.
      stringRowIdAt: (rowIndex) => this.stringRowIdAt(rowIndex),
      getRowDataById: (rowId) => this.rowDataById.get(rowId),
      getThemeKind: () => this.getThemeKind(),
```

- [ ] **Step 4: Thread through `Renderer` + `PainterCtx`**

In `src/renderer/painters/types.ts`, after `rowDataSnapshotAt` add:

```ts
  /** Cycle 21e / Task 11 — real string rowId for a visible data row
   *  (chunk `stringRowIds` mirror). `''`/null → row not rule-evaluable. */
  stringRowIdAt?: (rowIndex: number) => string | null;
  /** Cycle 21e / Task 11 — full row from the main-thread rowDataById
   *  mirror. The paint snapshot only covers visible columns; rule
   *  conditions must see hidden fields too. */
  getRowDataById?: (rowId: string) => unknown;
  /** Cycle 21e / Task 11 — active theme kind for rule eval contexts. */
  themeKind?: 'light' | 'dark';
```

In `src/renderer/renderer.ts`, add the matching `RendererOpts` fields (`stringRowIdAt?`, `getRowDataById?`, `getThemeKind?: () => 'light' | 'dark'`) and thread them in the `pctx` literal (lines 141-164, next to `rowDataSnapshotAt: this.opts.rowDataSnapshotAt,`):

```ts
      stringRowIdAt: this.opts.stringRowIdAt,
      getRowDataById: this.opts.getRowDataById,
      themeKind: this.opts.getThemeKind?.(),
```

- [ ] **Step 5: Resolve rowId + ruleRow once per data row in `byRows.ts`**

In `paintBand`, the current per-row snapshot block (`src/renderer/painters/byRows.ts:492-497`):

```ts
    // Compute rowData once per data row (not per cell) for use by
    // cellClassRules predicates and function-form cellStyle / cellClass.
    // Header rows don't need row data.
    const rowData: Record<string, unknown> | undefined = row.subgrid.isData
      ? rowDataSnapshotAt(row.localRowIndex)
      : undefined;
```

becomes:

```ts
    // Compute rowData once per data row (not per cell) for use by
    // cellClassRules predicates and function-form cellStyle / cellClass.
    // Header rows don't need row data.
    const rowData: Record<string, unknown> | undefined = row.subgrid.isData
      ? rowDataSnapshotAt(row.localRowIndex)
      : undefined;
    // Cycle 21e / Task 11 — rule-fold identity. `stringRowIds` is '' for
    // group/footer chunk entries, so `ruleRowId` is undefined exactly on
    // the rows the fold must skip. `ruleRow` prefers the full row from
    // the rowDataById mirror (hidden columns included) and falls back to
    // the visible-column snapshot.
    const ruleRowId: string | undefined = row.subgrid.isData
      ? (ctx.stringRowIdAt?.(row.localRowIndex) || undefined)
      : undefined;
    const ruleRow: Record<string, unknown> | undefined = ruleRowId !== undefined
      ? ((ctx.getRowDataById?.(ruleRowId) as Record<string, unknown> | undefined) ?? rowData)
      : undefined;
```

Add `stringRowIdAt`, `getRowDataById`, `themeKind` to the `PaintBandCtx` interface and to the `bandCtx` literal in `paintCellsByRows` (next to `rowDataSnapshotAt,` at line 257):

```ts
    stringRowIdAt: p.stringRowIdAt,
    getRowDataById: p.getRowDataById,
    themeKind: p.themeKind,
```

(destructure `stringRowIdAt`/`getRowDataById` is not needed inside `paintBand` — access via `ctx.` as shown; `themeKind` is read at the `applyCellProps` call). Then in the data-cell `applyCellProps` call (lines 591-640), add three fields after `rowIndex: row.subgrid.isData ? row.localRowIndex : 0,`:

```ts
        // Cycle 21e / Task 11 — rule-engine fold inputs. Undefined on
        // header / totals / pinned / group / footer rows.
        rowId: ruleRowId,
        ruleRow,
        themeKind: ctx.themeKind,
```

- [ ] **Step 6: `textDecoration` channel (types + painters)**

Reality check (spec §5.2 said "content decoration mechanism if one exists"): it does NOT exist — `ColCellOverrides` (`src/types/cell.ts:111-168`) has no textDecoration key and `CellDecorator` is corner badges. Per no-deferral, add the minimal channel:

In `src/types/cell.ts`, inside `ColCellOverrides` after `textTransform?: TextTransform;` add:

```ts
  /** Cycle 21e / Task 11 — underline / strike-through drawn by the text
   *  painters as a 1px line in the text color. `'none'` (default) draws
   *  nothing. Consumed by the built-in `textCell` / `numberCell`
   *  painters; custom painters may ignore it. */
  textDecoration?: 'none' | 'underline' | 'line-through';
```

In `src/renderer/cellRenderers/registry.ts`, add to `CellPaintConfig` (next to the Cycle 27 fields):

```ts
  /** Cycle 21e / Task 11 — see ColCellOverrides.textDecoration. */
  textDecoration?: 'none' | 'underline' | 'line-through';
  /** Cycle 21e / Task 11 — rule-engine indicator for this cell, stored by
   *  the applyCellProps fold; painted by byRows (Task 14). */
  ruleIndicator?: { iconName: string; color: string; target: string; position: string } | null;
```

Add a helper next to `applyLetterSpacing`:

```ts
/** Cycle 21e / Task 11 — draw underline / line-through for the default
 *  text path. 1px line in the current fg, sized by measureText. Called
 *  after fillText with the same x/alignment the text used. */
function paintTextDecoration(
  gc: CachedContext2D,
  p: CellPaintConfig,
  textX: number,
  cy: number,
): void {
  if (!p.textDecoration || p.textDecoration === 'none' || !p.valueFormatted) return;
  const w = gc.cache.measureText(p.valueFormatted).width;
  const x0 = p.halign === 'right' ? textX - w
    : p.halign === 'center' ? textX - w / 2
    : textX;
  const y = p.textDecoration === 'underline' ? cy + 2 : cy - 3;
  gc.cache.save();
  gc.cache.strokeStyle = p.fg;
  gc.cache.lineWidth = 1;
  gc.beginPath();
  gc.moveTo(x0, y);
  gc.lineTo(x0 + w, y);
  gc.stroke();
  gc.cache.restore();
}
```

In `textCell.paint`, the current default-text branch (`registry.ts:245-256`):

```ts
    if (p.content) {
      renderContentSlot(gc, p, p.content, cy, padLeft, padRight);
    } else if (p.halign === 'right') {
      gc.cache.textAlign = 'right';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - padRight, cy);
    } else if (p.halign === 'center') {
      gc.cache.textAlign = 'center';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w / 2, cy);
    } else {
      gc.cache.textAlign = 'left';
      gc.fillText(p.valueFormatted, p.bounds.x + padLeft, cy);
    }
```

becomes:

```ts
    if (p.content) {
      renderContentSlot(gc, p, p.content, cy, padLeft, padRight);
    } else if (p.halign === 'right') {
      gc.cache.textAlign = 'right';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - padRight, cy);
      paintTextDecoration(gc, p, p.bounds.x + p.bounds.w - padRight, cy);
    } else if (p.halign === 'center') {
      gc.cache.textAlign = 'center';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w / 2, cy);
      paintTextDecoration(gc, p, p.bounds.x + p.bounds.w / 2, cy);
    } else {
      gc.cache.textAlign = 'left';
      gc.fillText(p.valueFormatted, p.bounds.x + padLeft, cy);
      paintTextDecoration(gc, p, p.bounds.x + padLeft, cy);
    }
```

In `numberCell.paint` (`registry.ts:374-402`), the current tail:

```ts
    if (p.content) {
      renderContentSlot(gc, p, p.content, cy, padLeft, padRight);
    } else {
      gc.fillText(p.valueFormatted, x, cy);
    }
```

becomes:

```ts
    if (p.content) {
      renderContentSlot(gc, p, p.content, cy, padLeft, padRight);
    } else {
      gc.fillText(p.valueFormatted, x, cy);
      paintTextDecoration(gc, p, x, cy);
    }
```

- [ ] **Step 7: The fold in `applyCellProps`**

In `src/core/propertyChain.ts`:

(a) Import the slot next to the existing format-slot import (line 9):

```ts
import { getFormatCompiler, type CompositeColDefShape } from './formatCompilerSlot';
import { getRuleEngine } from './ruleEngineSlot';
```

(b) Extend `ApplyCellPropsInput` (after `headerCheckboxState` at line 345):

```ts
  /** Cycle 21e / Task 11 — string rowId of the data row. Undefined on
   *  header / totals / pinned / group / footer cells — exactly the cells
   *  the rule fold must skip. */
  rowId?: string;
  /** Cycle 21e / Task 11 — full row for rule-condition evaluation
   *  (rowDataById mirror; falls back to the visible-column snapshot). */
  ruleRow?: Record<string, unknown>;
  /** Cycle 21e / Task 11 — active theme kind for the rule eval ctx. */
  themeKind?: 'light' | 'dark';
```

(c) Add `target.textDecoration = undefined;` and `target.ruleIndicator = undefined;` to the Cycle 27 reset block. Current code (lines 580-587):

```ts
  target.valign = undefined;
  target.textTransform = undefined;
  target.letterSpacing = undefined;
  target.lineHeight = undefined;
  target.padding = undefined;
  target.border = undefined;
  target.content = undefined;
  target.decorators = undefined;
```

becomes the same list plus:

```ts
  target.textDecoration = undefined;
  // Cycle 21e / Task 11 — rule-fold outputs, reset per cell (the config
  // object is reused across the paint loop).
  target.ruleIndicator = undefined;
```

(d) The fold itself. Current code at the fold point — end of the data-cell `cellClassRules` branch through function-form `cellStyle` (lines 715-741):

```ts
    // 3b. cellClassRules — pre-compiled predicates, evaluated in order.
    if (colDef.cellClassRules) {
      for (const rule of colDef.cellClassRules) {
        let matched: boolean;
        try {
          matched = rule.predicate(callbackParams!);
        } catch {
          matched = false;
        }
        if (matched) {
          const patch = variantMap.get(rule.className);
          if (patch) applyOverridePatch(target, patch);
        }
      }
    }
  }

  // ── 4. Function-form cellStyle (highest precedence) ────────────────────
  if (colDef.cellStyleFn) {
    let patch: ColCellOverrides | null | undefined;
    try {
      patch = colDef.cellStyleFn(callbackParams!);
    } catch {
      patch = undefined;
    }
    if (patch) applyOverridePatch(target, patch);
  }
```

becomes:

```ts
    // 3b. cellClassRules — pre-compiled predicates, evaluated in order.
    if (colDef.cellClassRules) {
      for (const rule of colDef.cellClassRules) {
        let matched: boolean;
        try {
          matched = rule.predicate(callbackParams!);
        } catch {
          matched = false;
        }
        if (matched) {
          const patch = variantMap.get(rule.className);
          if (patch) applyOverridePatch(target, patch);
        }
      }
    }

    // ── 3.5. Cycle 21e / Task 11 — rule-engine fold ──────────────────────
    // DATA cells only: ctx.rowId is populated exclusively for data-leaf
    // rows (byRows threads '' → undefined for group/footer chunk entries;
    // header / totals / pinned / group-footer paths never set it), so the
    // single guard below is the data-cell discriminator. Slot empty or
    // `matched` empty → zero-diff behavior (spec §5.2).
    // Fold position per spec §3.5: AFTER cellClassRules variants, BEFORE
    // function-form cellStyle — rules beat declarative class styling; an
    // explicit per-cell cellStyle function stays the app's last word.
    const ruleEngine = getRuleEngine();
    if (ruleEngine !== null && ctx.rowId !== undefined) {
      let ruleResult: ReturnType<typeof ruleEngine.evaluateCell> | null = null;
      try {
        ruleResult = ruleEngine.evaluateCell({
          row: ctx.ruleRow ?? ctx.rowData ?? {},
          rowId: ctx.rowId,
          colId: colDef.colId,
          theme: ctx.themeKind ?? 'light',
        });
      } catch {
        ruleResult = null; // engine errors never break paint
      }
      if (ruleResult !== null && ruleResult.matched.length > 0) {
        const s = ruleResult.style;
        if (s !== null) {
          const patch: ColCellOverrides = {};
          if (s.color !== undefined) patch.fg = s.color;
          if (s.backgroundColor !== undefined) patch.bg = s.backgroundColor;
          // fontWeight / fontStyle ride composeFont via applyOverridePatch
          // — the same breakout-composition path Cycle 27 built; no manual
          // font-string rebuild needed.
          if (s.fontWeight !== undefined) patch.fontWeight = s.fontWeight as ColCellOverrides['fontWeight'];
          if (s.fontStyle !== undefined) patch.fontStyle = s.fontStyle;
          if (s.textDecoration !== undefined) {
            patch.textDecoration = s.textDecoration as ColCellOverrides['textDecoration'];
          }
          // borderColor/borderStyle → BorderSpec on all four sides.
          // borderStyle 'none' (or color absent) → no border patch.
          if (s.borderColor !== undefined && s.borderStyle !== 'none') {
            patch.border = {
              all: {
                width: 1,
                color: s.borderColor,
                style: (s.borderStyle ?? 'solid') as import('../types').BorderStyle,
              },
            };
          }
          applyOverridePatch(target, patch);
        }
        // Indicator + formatProgram are stored for the byRows paint path
        // (Cycle 21e / Task 14) — one evaluateCell per cell, consumed twice.
        target.ruleIndicator = ruleResult.indicator;
      }
    }
  }

  // ── 4. Function-form cellStyle (highest precedence) ────────────────────
  if (colDef.cellStyleFn) {
    let patch: ColCellOverrides | null | undefined;
    try {
      patch = colDef.cellStyleFn(callbackParams!);
    } catch {
      patch = undefined;
    }
    if (patch) applyOverridePatch(target, patch);
  }
```

Note the fold sits INSIDE the `else` (data-cell) branch — the header branch is untouched, which is the header/totals/group guard: headers take the `if (ctx.isHeader)` branch, and totals/pinned/group/footer rows never receive `ctx.rowId`.

(e) `BorderStyle` is exported from `src/types` (via `types/cell.ts`) — the inline `import('../types').BorderStyle` above avoids widening the top import list; alternatively add `BorderStyle` to the existing type import at line 1-6. Either is fine; keep whichever typechecks cleanest.

- [ ] **Step 8: Thread rule inputs into `getCellPaintedBg`** (E2E assertion surface — memory: E2E asserts via this API, `src/velocityGrid.ts:7584-7618`)

Current `applyCellProps` call there ends with:

```ts
      rowData,
      rowIndex,
    });
    return throwaway.bg;
```

becomes:

```ts
      rowData,
      rowIndex,
      // Cycle 21e / Task 11 — rule fold participates in the painted-bg
      // probe so E2E can assert rule styles without reading pixels.
      rowId: this.stringRowIdAt(rowIndex) || undefined,
      ruleRow: (() => {
        const id = this.stringRowIdAt(rowIndex);
        return id ? (this.rowDataById.get(id) as Record<string, unknown> | undefined) : undefined;
      })(),
      themeKind: this.getThemeKind(),
    });
    return throwaway.bg;
```

- [ ] **Step 9: Fold tests**

Create `packages/kernel/tests/core/propertyChain-ruleFold.test.ts`. Pattern: direct `applyCellProps` calls like `tests/core/propertyChain-compileFormatSlots.test.ts` uses `resolveColDefs`; build a minimal `CellPaintConfig` + theme (copy the `throwaway` config shape from `getCellPaintedBg` and the fake-theme literal from `tests/byRowsCellIcon.test.ts`, including `cellClassVariants: new Map([...])` where needed).

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyCellProps, resolveColDefs } from '../../src/core/propertyChain';
import {
  registerRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../../src/core/ruleEngineSlot';
import type { CellPaintConfig } from '../../src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../../src/theming/cssReader';

const theme = {
  font: '13px Inter', cellFont: '13px Inter', fg: '#111', bg: '#fff',
  headerBg: '#eee', headerFg: '#000', gridLineColor: '#ddd',
  flashFromColor: '#ffeb3b',
  cellClassVariants: new Map<string, Record<string, string>>([
    ['neg', { fg: '#c62828', bg: '#fff0f0' }],
  ]),
  headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

function freshConfig(): CellPaintConfig {
  return {
    value: '', valueFormatted: '',
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    font: '', fg: '', bg: '', borderColor: '',
    halign: 'left', prefillColor: '',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  };
}

function baseCtx(colDef: any, extra: Record<string, unknown> = {}) {
  return {
    theme, colDef, value: -5, valueFormatted: '-5',
    x: 0, y: 0, w: 100, h: 30, rowBg: '#fff', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    rowData: { px: -5 }, rowIndex: 0,
    rowId: 'r1', ruleRow: { px: -5, hidden: 'x' }, themeKind: 'light' as const,
    ...extra,
  };
}

const styleEngine = (style: Record<string, unknown>, matched = ['rule-1']): RuleEngineShape => ({
  evaluateCell: () => ({ matched, style: style as any, indicator: null, formatProgram: null }),
  resolveRuleRef: () => null,
});

describe('applyCellProps rule fold (Cycle 21e / Task 11)', () => {
  beforeEach(() => _resetRuleEngine_forTests());

  it('no engine registered → painted config identical to pre-change snapshot', () => {
    const [def] = resolveColDefs([{
      colId: 'px', cellDataType: 'number',
      cellClassRules: { neg: (p: any) => p.value < 0 },
      cellStyle: () => ({ fg: '#00f' }),
    }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    // Pre-21e semantics, encoded literally: cellClassRules variant fires
    // (fg #c62828 / bg #fff0f0), then function cellStyle wins on fg.
    expect(cfg.fg).toBe('#00f');
    expect(cfg.bg).toBe('#fff0f0');
    expect(cfg.ruleIndicator).toBeUndefined();
  });

  it('rule patch overrides cellClassRules variant', () => {
    registerRuleEngine(styleEngine({ color: '#8e24aa', backgroundColor: '#f3e5f5' }));
    const [def] = resolveColDefs([{
      colId: 'px', cellDataType: 'number',
      cellClassRules: { neg: (p: any) => p.value < 0 },
    }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.fg).toBe('#8e24aa');
    expect(cfg.bg).toBe('#f3e5f5');
  });

  it('function-form cellStyle overrides the rule patch', () => {
    registerRuleEngine(styleEngine({ color: '#8e24aa' }));
    const [def] = resolveColDefs([{
      colId: 'px', cellDataType: 'number',
      cellStyle: () => ({ fg: '#00f' }),
    }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.fg).toBe('#00f');
  });

  it('fontWeight/fontStyle compose into the font shorthand', () => {
    registerRuleEngine(styleEngine({ fontWeight: 'bold', fontStyle: 'italic' }));
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.font).toBe('italic bold 13px Inter');
  });

  it('textDecoration + border translate to paint slots', () => {
    registerRuleEngine(styleEngine({
      textDecoration: 'line-through', borderColor: '#c62828', borderStyle: 'dashed',
    }));
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.textDecoration).toBe('line-through');
    expect(cfg.border).toEqual({ all: { width: 1, color: '#c62828', style: 'dashed' } });
  });

  it('matched empty → zero diff', () => {
    registerRuleEngine(styleEngine({ color: '#8e24aa' }, []));
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const withEngine = freshConfig();
    applyCellProps(withEngine, baseCtx(def) as any);
    _resetRuleEngine_forTests();
    const without = freshConfig();
    applyCellProps(without, baseCtx(def) as any);
    expect(withEngine).toEqual(without);
  });

  it('rowId undefined (header/totals/group rows) → engine never consulted', () => {
    let calls = 0;
    registerRuleEngine({
      evaluateCell: () => { calls++; return { matched: [], style: null, indicator: null, formatProgram: null }; },
      resolveRuleRef: () => null,
    });
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    applyCellProps(freshConfig(), baseCtx(def, { rowId: undefined }) as any);
    applyCellProps(freshConfig(), baseCtx(def, { isHeader: true, rowId: undefined }) as any);
    applyCellProps(freshConfig(), baseCtx(def, { isTotals: true, rowId: undefined }) as any);
    expect(calls).toBe(0);
  });

  it('row-scope vs cell-scope: engine receives colId + full ruleRow (hidden fields)', () => {
    const seen: any[] = [];
    registerRuleEngine({
      evaluateCell: (c) => { seen.push(c); return { matched: [], style: null, indicator: null, formatProgram: null }; },
      resolveRuleRef: () => null,
    });
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    applyCellProps(freshConfig(), baseCtx(def) as any);
    expect(seen[0]).toEqual({
      row: { px: -5, hidden: 'x' }, rowId: 'r1', colId: 'px', theme: 'light',
    });
  });

  it('engine throw is swallowed (paint never breaks)', () => {
    registerRuleEngine({
      evaluateCell: () => { throw new Error('boom'); },
      resolveRuleRef: () => null,
    });
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const cfg = freshConfig();
    expect(() => applyCellProps(cfg, baseCtx(def) as any)).not.toThrow();
  });
});
```

- [ ] **Step 10: Chunk `stringRowIds` test**

Create `packages/kernel/tests/chunkStringRowIds.test.ts` exercising the slicers the same way `tests/dataPipelineFlash.test.ts` drives the worker pipeline (reuse its pipeline construction pattern): assert (a) a flat-data viewport chunk carries `stringRowIds` parallel to `rowIds` with the app's `getRowId` values, (b) a grouped viewport's group rows carry `''`, (c) `normalizeViewportChunk` fills `Array(rowCount).fill('')` for a chunk without the field and returns the same reference when all fields (incl. `stringRowIds`) are present.

- [ ] **Step 11: Run new tests + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run tests/core/propertyChain-ruleFold.test.ts tests/chunkStringRowIds.test.ts
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx tsc --noEmit
```

Expected: all new PASS; typecheck clean.

- [ ] **Step 12: Full kernel baseline run**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run 2>&1 | tail -5
```

Expected: 2399 baseline + Task 10's 16 + this task's new tests, 0 failures. Pay special attention to `propertyChain.test.ts`, `cellStyleExpansion.test.ts`, `cellBorders.test.ts`, `byRows.test.ts`, `chunkFormat.test.ts` — they cover the exact files touched.

- [ ] **Step 13: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/kernel/src packages/kernel/tests
git commit -m "feat(kernel): cycle 21e task 11 — applyCellProps rule-patch fold + chunk stringRowIds + textDecoration channel"
```

---

### Task 12: `rowsChanged` event + emitter `hasListener`

**Files:**
- Modify: `packages/kernel/src/core/eventEmitter.ts` (`hasListener`)
- Modify: `packages/kernel/src/types/event.ts` (`rowsChanged` union member)
- Modify: `packages/kernel/src/velocityGrid.ts` (`updateRowDataCache` source + emission; edit-commit dep wrapper)
- Modify: `packages/kernel/tests/eventEmitter.test.ts` (extend)
- Create: `packages/kernel/tests/rowsChangedEvent.test.ts`

**Interfaces:**
- Consumes: nothing new (pure kernel).
- Produces (Task 15): the `rowsChanged` event (`added/updated/removed/source`) that `wireIntoKernel` subscribes to build `RowChangeSet`s; `TypedEventEmitter.hasListener(type)`.

Reality vs spec §5.1, verified against sources:
- The "transaction sync method" is `updateRowDataCache` (`src/velocityGrid.ts:1974-1994`), called synchronously by BOTH `applyTransaction` (line 1949) and `applyTransactionAsync` (line 1963). **There is no separate main-side async-flush handler for `rowDataById`** — the async path mirrors rows at enqueue time (the worker batches internally). `source: 'transactionAsync'` therefore emits at `applyTransactionAsync()` call time; documented in the event doc-comment.
- The "edit commit path" does NOT go through `updateRowDataCache`: `EditController` commits via the dep `applyTransaction: (payload) => this.workerCoord.applyTransaction(payload)` (`src/velocityGrid.ts:1524`), which bypasses the mirror entirely (the `cellValueChanged` emission lives in `editController.ts:314-318` / `584-588`). The `'edit'` source is implemented by replacing that one-line dep with a wrapper. To preserve strict byte-identity, the wrapper is fully listener-gated — including its `rowDataById.set` freshening (documented below).
- `setRowData` (`src/velocityGrid.ts:1921-1923`) is untouched — full replace does not emit.

- [ ] **Step 1: `hasListener` on `TypedEventEmitter`**

`src/core/eventEmitter.ts` — after the `off` method (lines 19-24), insert:

```ts
  /** Cycle 21e / Task 12 — cheap probe used to cost-gate expensive
   *  payload construction (e.g. rowsChanged old-row snapshots). True
   *  only when at least one live handler is registered for `type` —
   *  an emptied Set (all handlers unsubscribed) reads false. */
  hasListener<T extends E['type']>(type: T): boolean {
    const set = this.handlers.get(type);
    return set !== undefined && set.size > 0;
  }
```

(The `size > 0` check matters: `on()`'s unsubscribe closure deletes from the Set but leaves the empty Set in the map — see `eventEmitter.ts:10-16`.)

- [ ] **Step 2: The event union member**

`src/types/event.ts` — insert directly after the `cellValueChanged` member (its closing `}` is at line 124, before `| CellEditingStartedEvent<TRow>`):

```ts
  /** Cycle 21e / Task 12 — one event per transaction that mutated the
   *  main-thread rowDataById mirror. Listener-gated: the `oldRow`
   *  shallow snapshot (and all payload arrays) are built ONLY when at
   *  least one listener is registered — zero overhead for non-rules
   *  apps. `setRowData` full replaces do NOT emit. `'transactionAsync'`
   *  emits at applyTransactionAsync() call time (the main-side mirror
   *  syncs at enqueue; the worker batches internally). `'edit'` emits
   *  from the editor commit-back path. */
  | {
      type: 'rowsChanged';
      added: Array<{ rowId: string; row: TRow }>;
      updated: Array<{ rowId: string; row: TRow; oldRow: TRow }>;
      removed: Array<{ rowId: string; row: TRow }>;
      source: 'transaction' | 'transactionAsync' | 'edit';
    }
```

- [ ] **Step 3: Gate + emit in `updateRowDataCache`**

Current code (`src/velocityGrid.ts:1974-1994`):

```ts
  /** Cycle 7 / Task 8 — keep `rowDataById` in sync with a transaction.
   *  add / update both write the row in place; remove drops the entry.
   *  Same `getRowId` derivation the worker uses so the keys line up
   *  across the two caches. Errors in `getRowId` skip the row silently. */
  private updateRowDataCache(t: Tx<TRow>): void {
    if (t.add) {
      for (const row of t.add) {
        try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip */ }
      }
    }
    if (t.update) {
      for (const row of t.update) {
        try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip */ }
      }
    }
    if (t.remove) {
      for (const row of t.remove) {
        try { this.rowDataById.delete(this.options.getRowId(row)); } catch { /* skip */ }
      }
    }
  }
```

Replacement (the no-listener path executes the exact same statements as today — no clones, no arrays):

```ts
  /** Cycle 7 / Task 8 — keep `rowDataById` in sync with a transaction.
   *  add / update both write the row in place; remove drops the entry.
   *  Same `getRowId` derivation the worker uses so the keys line up
   *  across the two caches. Errors in `getRowId` skip the row silently.
   *
   *  Cycle 21e / Task 12 — emits ONE `rowsChanged` per transaction when
   *  (and only when) a listener is registered. The old-row shallow
   *  snapshot (`{...prev}`) is captured BEFORE the overwrite. Fully
   *  listener-gated: without a listener this method is byte-identical
   *  to its pre-21e body. */
  private updateRowDataCache(t: Tx<TRow>, source: 'transaction' | 'transactionAsync'): void {
    if (!this.events.hasListener('rowsChanged')) {
      if (t.add) {
        for (const row of t.add) {
          try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip */ }
        }
      }
      if (t.update) {
        for (const row of t.update) {
          try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip */ }
        }
      }
      if (t.remove) {
        for (const row of t.remove) {
          try { this.rowDataById.delete(this.options.getRowId(row)); } catch { /* skip */ }
        }
      }
      return;
    }
    const added: Array<{ rowId: string; row: TRow }> = [];
    const updated: Array<{ rowId: string; row: TRow; oldRow: TRow }> = [];
    const removed: Array<{ rowId: string; row: TRow }> = [];
    if (t.add) {
      for (const row of t.add) {
        try {
          const rowId = this.options.getRowId(row);
          const prev = this.rowDataById.get(rowId);
          this.rowDataById.set(rowId, row);
          // A transaction "add" for an already-known rowId is an upsert —
          // report it as updated so listeners see the old row.
          if (prev !== undefined) updated.push({ rowId, row, oldRow: { ...prev } });
          else added.push({ rowId, row });
        } catch { /* skip */ }
      }
    }
    if (t.update) {
      for (const row of t.update) {
        try {
          const rowId = this.options.getRowId(row);
          const prev = this.rowDataById.get(rowId);
          this.rowDataById.set(rowId, row);
          if (prev !== undefined) updated.push({ rowId, row, oldRow: { ...prev } });
          else added.push({ rowId, row });
        } catch { /* skip */ }
      }
    }
    if (t.remove) {
      for (const row of t.remove) {
        try {
          const rowId = this.options.getRowId(row);
          const prev = this.rowDataById.get(rowId);
          this.rowDataById.delete(rowId);
          removed.push({ rowId, row: prev ?? row });
        } catch { /* skip */ }
      }
    }
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      this.events.emit({ type: 'rowsChanged', added, updated, removed, source });
    }
  }
```

Update the two call sites:
- `src/velocityGrid.ts:1949` — `this.updateRowDataCache(t);` → `this.updateRowDataCache(t, 'transaction');`
- `src/velocityGrid.ts:1963` — `this.updateRowDataCache(t);` → `this.updateRowDataCache(t, 'transactionAsync');`

- [ ] **Step 4: The edit-commit wrapper**

Add a private method near `updateRowDataCache`:

```ts
  /** Cycle 21e / Task 12 — mirror an editor commit-back into rowsChanged.
   *  The edit path historically bypasses updateRowDataCache (the dep at
   *  the EditController wiring calls workerCoord.applyTransaction
   *  directly), so `source: 'edit'` is produced here. Fully listener-
   *  gated, INCLUDING the rowDataById freshening: without a rowsChanged
   *  listener the mirror keeps its pre-21e (stale-after-edit) behavior
   *  and this method is a no-op — byte-identical for non-rules apps.
   *  With a listener, the mirror is updated so consecutive edits report
   *  correct oldRow values. */
  private mirrorEditCommit(update: TRow[] | undefined): void {
    if (!this.events.hasListener('rowsChanged')) return;
    if (!update || update.length === 0) return;
    const updated: Array<{ rowId: string; row: TRow; oldRow: TRow }> = [];
    for (const row of update) {
      try {
        const rowId = this.options.getRowId(row);
        const prev = this.rowDataById.get(rowId);
        this.rowDataById.set(rowId, row);
        updated.push({ rowId, row, oldRow: prev !== undefined ? { ...prev } : { ...row } });
      } catch { /* skip */ }
    }
    if (updated.length > 0) {
      this.events.emit({ type: 'rowsChanged', added: [], updated, removed: [], source: 'edit' });
    }
  }
```

Then change the EditController dep. Current code (`src/velocityGrid.ts:1524`):

```ts
        applyTransaction: (payload) => this.workerCoord.applyTransaction(payload),
```

becomes:

```ts
        applyTransaction: (payload) => {
          // Cycle 21e / Task 12 — rowsChanged (source 'edit'), listener-gated.
          this.mirrorEditCommit(payload.update as TRow[] | undefined);
          return this.workerCoord.applyTransaction(payload);
        },
```

- [ ] **Step 5: Emitter tests** — extend `packages/kernel/tests/eventEmitter.test.ts` (10 existing `it`s) with:

```ts
  it('hasListener reflects registration and unsubscription', () => {
    const ee = new TypedEventEmitter<Ev>();
    expect(ee.hasListener('foo')).toBe(false);
    const off = ee.on('foo', () => {});
    expect(ee.hasListener('foo')).toBe(true);
    expect(ee.hasListener('bar')).toBe(false);
    off();
    expect(ee.hasListener('foo')).toBe(false); // emptied Set reads false
  });
```

- [ ] **Step 6: Grid-level `rowsChanged` tests**

Create `packages/kernel/tests/rowsChangedEvent.test.ts` reusing the Task 10 fixture (Worker + canvas stubs, `makeGrid`). `updateRowDataCache` runs synchronously inside `applyTransaction`, so no worker round-trip is needed:

```ts
// (fixture: same beforeAll stubs + makeGrid as tests/rulesKernelApi.test.ts)

describe('rowsChanged event (Cycle 21e / Task 12)', () => {
  it('applyTransaction emits ONE event with source transaction, batching adds+updates+removes', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }, { id: 'b', px: 2 }] });
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    grid.applyTransaction({
      add: [{ id: 'c', px: 3 }],
      update: [{ id: 'a', px: 10 }, { id: 'b', px: 20 }],
      remove: [{ id: 'b', px: 2 }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('transaction');
    expect(events[0].added).toEqual([{ rowId: 'c', row: { id: 'c', px: 3 } }]);
    expect(events[0].updated).toEqual([
      { rowId: 'a', row: { id: 'a', px: 10 }, oldRow: { id: 'a', px: 1 } },
      { rowId: 'b', row: { id: 'b', px: 20 }, oldRow: { id: 'b', px: 2 } },
    ]);
    // remove ran after update in the same tx — prev is the just-updated row
    expect(events[0].removed).toEqual([{ rowId: 'b', row: { id: 'b', px: 20 } }]);
    grid.destroy();
  });

  it('applyTransactionAsync emits source transactionAsync at enqueue time', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }] });
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    grid.applyTransactionAsync({ update: [{ id: 'a', px: 2 }] });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('transactionAsync');
    grid.destroy();
  });

  it('edit commit path emits source edit via mirrorEditCommit', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }] });
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    (grid as any).mirrorEditCommit([{ id: 'a', px: 99 }]);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('edit');
    expect(events[0].updated[0].oldRow).toEqual({ id: 'a', px: 1 });
    // second edit sees the freshened mirror
    (grid as any).mirrorEditCommit([{ id: 'a', px: 100 }]);
    expect(events[1].updated[0].oldRow).toEqual({ id: 'a', px: 99 });
    grid.destroy();
  });

  it('setRowData full replace does NOT emit', () => {
    const grid = makeGrid();
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    grid.setRowData([{ id: 'a', px: 1 }]);
    expect(events).toHaveLength(0);
    grid.destroy();
  });

  it('gating: no listener → no clones (ownKeys-counting proxy)', () => {
    const grid = makeGrid();
    let ownKeysCalls = 0;
    const row = new Proxy({ id: 'a', px: 1 }, {
      ownKeys(t) { ownKeysCalls++; return Reflect.ownKeys(t); },
    });
    grid.applyTransaction({ add: [row] });
    // Update WITHOUT a listener: the stored proxy row must never be
    // spread ({...prev} triggers ownKeys).
    const before = ownKeysCalls;
    grid.applyTransaction({ update: [{ id: 'a', px: 2 }] });
    expect(ownKeysCalls).toBe(before);
    // Re-seed the proxy, attach a listener → the snapshot spread runs.
    grid.applyTransaction({ update: [row] });
    grid.on('rowsChanged', () => {});
    const mid = ownKeysCalls;
    grid.applyTransaction({ update: [{ id: 'a', px: 3 }] });
    expect(ownKeysCalls).toBeGreaterThan(mid);
    grid.destroy();
  });

  it('gating: unsubscribing restores the zero-cost path', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }] });
    const events: any[] = [];
    const off = grid.on('rowsChanged', (e) => events.push(e));
    grid.applyTransaction({ update: [{ id: 'a', px: 2 }] });
    off();
    grid.applyTransaction({ update: [{ id: 'a', px: 3 }] });
    expect(events).toHaveLength(1);
    grid.destroy();
  });
});
```

(Note `getRowId` reads only `r.id`, so the proxy's `get` trap firing for `id` lookups is expected; the assertion pins `ownKeys` — which ONLY the `{...prev}` snapshot spread triggers.)

- [ ] **Step 7: Run new tests + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run tests/eventEmitter.test.ts tests/rowsChangedEvent.test.ts
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx tsc --noEmit
```

- [ ] **Step 8: Full kernel baseline run**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run 2>&1 | tail -5
```

Expected: 2399 baseline + Tasks 10-11 new + this task's new, 0 failures (watch `commitBack.test.ts`, `editController.test.ts` — the dep wrapper must not change their behavior; it is gated off in all of them).

- [ ] **Step 9: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/kernel/src/core/eventEmitter.ts packages/kernel/src/types/event.ts packages/kernel/src/velocityGrid.ts packages/kernel/tests/eventEmitter.test.ts packages/kernel/tests/rowsChangedEvent.test.ts
git commit -m "feat(kernel): cycle 21e task 12 — rowsChanged event (listener-gated) + emitter hasListener"
```

---

### Task 13: Flash per-call overrides (params + registry + shaper + painter)

**Files:**
- Modify: `packages/kernel/src/types/column.ts` (`FlashCellsParams` — retire the reserved comment)
- Create: `packages/kernel/src/core/flashShaper.ts` (pure alpha curves)
- Modify: `packages/kernel/src/core/flashRegistry.ts` (entry color/mode/per-call durations; override-aware `ingestMask`; `getColor`)
- Modify: `packages/kernel/src/velocityGrid.ts` (override map in `flashCells`; ingest call site; tick-loop sweep; `cellAt` flashColor)
- Modify: `packages/kernel/src/renderer/painters/types.ts` + `src/renderer/painters/byRows.ts` (flashColor pass-through)
- Create: `packages/kernel/tests/core/flashShaper.test.ts`
- Create: `packages/kernel/tests/flashOverrides.test.ts`
- Modify: `packages/kernel/tests/flashRegistry.test.ts` (extend: override capture + shaped alpha)

**Interfaces:**
- Consumes (Task 11): `chunk.stringRowIds` (the string→numeric join at mask-ingest time).
- Produces (Task 15): `grid.flashCells({ rowIds, colIds?, flashDuration?, fadeDuration?, color?, mode? })` — the API `wireIntoKernel` drives from `FlashDirective[]`. Produces (internal): `shapeFlashAlpha(mode, elapsed, flashDuration, fadeDuration)`.

**Chosen design (documented tradeoff).** The prompt's fallback design is the correct one here, and it is not a compromise: the worker does NOT own flash timing. `flashCells` round-trips to the worker only to resolve string rowIds and stage `pendingFlashes`; the mask that comes back is 1 bit/cell (`viewportSlicer.ts:900-930`) and all timing lives in the main-side `FlashRegistry` (entries capture `getFlashDuration()`/`getFadeDuration()` at `flash()` time — `flashRegistry.ts:85-93`). So per-call duration/color/mode are implemented entirely main-side: `flashCells` records an override keyed by string rowId+colId; when the next chunk's mask is ingested, each set bit consults the override (joined via the chunk's new `stringRowIds`) and captures it INTO the `FlashEntry` — per-call durations then drive `tick()` pruning and `getAlpha` shaping natively. **No protocol change.** Limitation (inherent, documented): overrides apply to flashes that arrive via the mask after the `flashCells` call; the pre-existing one-frame latency of `flashCells` (see its doc comment, `velocityGrid.ts:6494-6499`) is unchanged.

- [ ] **Step 1: `FlashCellsParams`**

Current code (`src/types/column.ts:41-52`):

```ts
export interface FlashCellsParams {
  /** Row IDs to flash. Required; must be non-empty. */
  rowIds: string[];
  /** Column IDs to flash within each row. When omitted or empty,
   *  every column with a resolved field flashes. */
  colIds?: string[];
  /** Reserved for a follow-up patch — overrides the global
   *  `cellFlashDuration` for this batch. Cycle 4 ships the API
   *  surface; per-call overrides land when a use case lands. */
  flashDuration?: number;
  fadeDuration?: number;
}
```

becomes:

```ts
export interface FlashCellsParams {
  /** Row IDs to flash. Required; must be non-empty. */
  rowIds: string[];
  /** Column IDs to flash within each row. When omitted or empty,
   *  every column with a resolved field flashes. */
  colIds?: string[];
  /** Cycle 21e / Task 13 — per-call override of the global
   *  `cellFlashDuration` for this batch (the Cycle 4 reserve, now live). */
  flashDuration?: number;
  /** Cycle 21e / Task 13 — per-call override of `cellFadeDuration`. */
  fadeDuration?: number;
  /** Cycle 21e / Task 13 — per-call flash color; replaces the theme's
   *  `flashFromColor` blend for these cells only. */
  color?: string;
  /** Cycle 21e / Task 13 — alpha curve. `'fade'` (default) is the
   *  existing hold-then-linear-fade; `'pulse'` is a double sine²
   *  cycle over the full window; `'glow'` plateaus at full alpha for
   *  60% of the window then fades linearly. */
  mode?: 'fade' | 'pulse' | 'glow';
}
```

- [ ] **Step 2: The pure alpha shaper**

Create `packages/kernel/src/core/flashShaper.ts`:

```ts
// Cycle 21e / Task 13 — pure per-mode flash alpha curves. The 'fade'
// branch reproduces FlashRegistry.getAlpha's original math EXACTLY
// (hold at 1 during flashDuration, linear 1→0 across fadeDuration) so
// the default path stays byte-identical.

export type FlashMode = 'fade' | 'pulse' | 'glow';

export function shapeFlashAlpha(
  mode: FlashMode,
  elapsed: number,
  flashDuration: number,
  fadeDuration: number,
): number {
  if (elapsed < 0) return 0;
  const total = flashDuration + fadeDuration;
  switch (mode) {
    case 'pulse': {
      // Two full sin² peaks over the window: 0 at t=0, 1 at t=0.25T,
      // 0 at t=0.5T, 1 at t=0.75T, 0 at t=T.
      if (total <= 0 || elapsed >= total) return 0;
      const t = elapsed / total;
      const s = Math.sin(Math.PI * 2 * t);
      return s * s;
    }
    case 'glow': {
      // Plateau at 1 for the first 60% of the window, then linear fade.
      if (total <= 0 || elapsed >= total) return 0;
      const t = elapsed / total;
      return t <= 0.6 ? 1 : (1 - t) / 0.4;
    }
    case 'fade':
    default: {
      if (elapsed <= flashDuration) return 1;
      const fadeElapsed = elapsed - flashDuration;
      if (fadeElapsed >= fadeDuration) return 0;
      return 1 - fadeElapsed / fadeDuration;
    }
  }
}
```

- [ ] **Step 3: Override-aware `FlashRegistry`**

In `src/core/flashRegistry.ts`:

(a) Import the shaper and add the fields to `FlashEntry` (after `fadeDuration: number;` at line 40):

```ts
import { shapeFlashAlpha, type FlashMode } from './flashShaper';
```
```ts
  /** Cycle 21e / Task 13 — per-call color override; undefined → theme
   *  `flashFromColor` (unchanged default). */
  color?: string;
  /** Cycle 21e / Task 13 — alpha curve; undefined → 'fade' (unchanged). */
  mode?: FlashMode;
```

(b) Add the override shape + widen `flash()`. Current signature (line 81):

```ts
  flash(rowId: number, colId: string, now: number = performance.now()): void {
```

New module-level type + signature (body change shown in full):

```ts
/** Cycle 21e / Task 13 — per-call overrides captured into a FlashEntry
 *  at flash() time (same capture-at-start semantics as the durations). */
export interface FlashOverride {
  color?: string;
  mode?: FlashMode;
  flashDuration?: number;
  fadeDuration?: number;
}
```
```ts
  flash(rowId: number, colId: string, now: number = performance.now(), override?: FlashOverride): void {
    if (this.destroyed) return;
    if (!this.deps.getEnabled()) return;
    if (this.deps.getReducedMotion()) return;
    const flashDuration = override?.flashDuration ?? this.deps.getFlashDuration();
    const fadeDuration = override?.fadeDuration ?? this.deps.getFadeDuration();
    this.entries.set(key(rowId, colId), {
      rowId,
      colId,
      startedAt: now,
      flashDuration,
      fadeDuration,
      color: override?.color,
      mode: override?.mode,
    });
  }
```

(Per-call durations captured into the entry mean `tick()`'s prune condition `now > e.startedAt + e.flashDuration + e.fadeDuration` — line 144 — honors them with zero changes.)

(c) `ingestMask` gains the string join + override lookup. Current inner loop (lines 126-133):

```ts
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const bitIdx = r * colCount + c;
        const byte = mask[bitIdx >>> 3] ?? 0;
        if ((byte & (1 << (bitIdx & 7))) === 0) continue;
        this.flash(rowIds[r]!, colIds[c]!, now);
      }
    }
```

Widen the input type (add to the `ingestMask` param object type after `now?: number;`):

```ts
    /** Cycle 21e / Task 13 — string rowIds parallel to `rowIds` (from
     *  chunk.stringRowIds). Only needed when `getOverride` is set. */
    stringRowIds?: readonly string[];
    /** Cycle 21e / Task 13 — per-cell override lookup, keyed by string
     *  rowId + colId. Return undefined for "no override". */
    getOverride?: (stringRowId: string, colId: string) => FlashOverride | undefined;
```

and the loop becomes:

```ts
    const { stringRowIds, getOverride } = input;
    for (let r = 0; r < rowCount; r++) {
      const sid = getOverride && stringRowIds ? stringRowIds[r] ?? '' : '';
      for (let c = 0; c < colCount; c++) {
        const bitIdx = r * colCount + c;
        const byte = mask[bitIdx >>> 3] ?? 0;
        if ((byte & (1 << (bitIdx & 7))) === 0) continue;
        const colId = colIds[c]!;
        const override = getOverride && sid !== '' ? getOverride(sid, colId) : undefined;
        this.flash(rowIds[r]!, colId, now, override);
      }
    }
```

(d) `getAlpha` delegates the curve. Current tail (lines 160-168):

```ts
    const e = this.entries.get(key(rowId, colId));
    if (e === undefined) return 0;
    const elapsed = now - e.startedAt;
    if (elapsed < 0) return 0;
    if (elapsed <= e.flashDuration) return 1;
    const fadeElapsed = elapsed - e.flashDuration;
    if (fadeElapsed >= e.fadeDuration) return 0;
    return 1 - fadeElapsed / e.fadeDuration;
```

becomes:

```ts
    const e = this.entries.get(key(rowId, colId));
    if (e === undefined) return 0;
    const elapsed = now - e.startedAt;
    // Cycle 21e / Task 13 — mode-shaped curve. 'fade' (the default when
    // no per-call mode was captured) reproduces the original math
    // exactly; see flashShaper.ts.
    return shapeFlashAlpha(e.mode ?? 'fade', elapsed, e.flashDuration, e.fadeDuration);
```

(e) Add a color accessor after `getAlpha`:

```ts
  /** Cycle 21e / Task 13 — per-call color override for an active flash
   *  entry; undefined for the default theme blend. Callers pair this
   *  with a non-zero getAlpha. */
  getColor(rowId: number, colId: string): string | undefined {
    if (this.destroyed) return undefined;
    return this.entries.get(key(rowId, colId))?.color;
  }
```

- [ ] **Step 4: The main-side override map in `velocityGrid.ts`**

(a) Field, next to `private flashRegistry: FlashRegistry;` (line 637):

```ts
  /** Cycle 21e / Task 13 — per-call flashCells overrides awaiting the
   *  next mask ingest. Keyed `${stringRowId}\0${colId}`; the
   *  `\0*` colId wildcard covers "all columns" calls. `expiresAt`
   *  bounds staleness (worker round-trip grace included); swept in the
   *  flash tick loop + lazily on each flashCells call. */
  private flashOverrides = new Map<string, import('./core/flashRegistry').FlashOverride & { expiresAt: number }>();
```

(b) `flashCells` — current code (`src/velocityGrid.ts:6500-6515`) gains override registration before the worker call. Replace the body:

```ts
  flashCells(params: FlashCellsParams): void {
    if (this.destroyed) return;
    if (this.options.enableCellChangeFlash !== true) return;
    if (this.reducedMotion) return;
    if (!params.rowIds || params.rowIds.length === 0) return;
    const colIds = params.colIds ?? [];
    // Cycle 21e / Task 13 — stage per-call overrides for the mask-ingest
    // join. Zero entries (and zero cost) when no override field is set.
    if (params.color !== undefined || params.mode !== undefined
      || params.flashDuration !== undefined || params.fadeDuration !== undefined) {
      const now = performance.now();
      // Lazy sweep so abandoned overrides can't accumulate.
      for (const [k, v] of this.flashOverrides) {
        if (v.expiresAt <= now) this.flashOverrides.delete(k);
      }
      const flashDur = params.flashDuration ?? this.options.cellFlashDuration ?? 500;
      const fadeDur = params.fadeDuration ?? this.options.cellFadeDuration ?? 1000;
      const override = {
        color: params.color,
        mode: params.mode,
        flashDuration: params.flashDuration,
        fadeDuration: params.fadeDuration,
        // Grace for the worker round-trip + next chunk arrival.
        expiresAt: now + flashDur + fadeDur + 2000,
      };
      const colKeys = colIds.length > 0 ? colIds : ['*'];
      for (const rowId of params.rowIds) {
        for (const c of colKeys) {
          this.flashOverrides.set(`${rowId}\0${c}`, override);
        }
      }
    }
    this.workerCoord.flashCells(params.rowIds, colIds)
      .then(() => {
        if (this.destroyed) return;
        // Force a viewport refresh so the worker drains pendingFlashes
        // into the next chunk's flashMask without waiting for a scroll
        // or other natural trigger.
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] flashCells:', err); });
  }
```

(The default fallbacks `?? 500` / `?? 1000` mirror the tick loop's own defaults at `velocityGrid.ts:6479-6480`.)

(c) The ingest call site — current code (`src/velocityGrid.ts:6323-6330`):

```ts
    if (chunk.flashMask) {
      this.flashRegistry.ingestMask({
        rowIds: chunk.rowIds,
        colIds: cols,
        mask: chunk.flashMask,
      });
      this.startFlashTickLoop();
    }
```

becomes:

```ts
    if (chunk.flashMask) {
      // Cycle 21e / Task 13 — join per-call flashCells overrides by the
      // chunk's string rowIds. Zero-cost when the override map is empty
      // (the common case): no lookup closure is even passed.
      const hasOverrides = this.flashOverrides.size > 0;
      this.flashRegistry.ingestMask({
        rowIds: chunk.rowIds,
        colIds: cols,
        mask: chunk.flashMask,
        stringRowIds: hasOverrides ? chunk.stringRowIds : undefined,
        getOverride: hasOverrides
          ? (sid, colId) =>
              this.flashOverrides.get(`${sid}\0${colId}`)
                ?? this.flashOverrides.get(`${sid}\0*`)
          : undefined,
      });
      this.startFlashTickLoop();
    }
```

(d) Sweep in the tick loop — inside `startFlashTickLoop`'s `tick` (after the `groupFlashMap` pruning block at `velocityGrid.ts:6478-6486`), add:

```ts
      // Cycle 21e / Task 13 — expire staged flash overrides.
      if (this.flashOverrides.size > 0) {
        for (const [k, v] of this.flashOverrides) {
          if (v.expiresAt <= now) this.flashOverrides.delete(k);
        }
      }
```

- [ ] **Step 5: Color pass-through to the painter**

(a) `cellAt` — current flash read (`src/velocityGrid.ts:6525-6527`):

```ts
    const numericRowId = this.chunk.rowIds[localIndex]!;
    const flashAlpha = this.flashRegistry.getAlpha(numericRowId, colId, performance.now());
    const flash = flashAlpha > 0 ? flashAlpha : undefined;
```

becomes:

```ts
    const numericRowId = this.chunk.rowIds[localIndex]!;
    const flashAlpha = this.flashRegistry.getAlpha(numericRowId, colId, performance.now());
    const flash = flashAlpha > 0 ? flashAlpha : undefined;
    // Cycle 21e / Task 13 — per-call color override rides alongside the
    // alpha; undefined keeps the theme flashFromColor blend.
    const flashColor = flash !== undefined
      ? this.flashRegistry.getColor(numericRowId, colId)
      : undefined;
```

then add `flashColor` to every return object in `cellAt` that carries `flashAlpha: flash` (mechanical: `flashAlpha: flash` → `flashAlpha: flash, flashColor` at each of the ~10 return sites in `cellAt`, lines 6541-6619; the `gFlash` group-total returns keep `flashColor` too — group flashes have no overrides so it is undefined there). Update `cellAt`'s return type (line 6517) to `{ value: unknown; valueFormatted: string; flashAlpha?: number; flashColor?: string } | null`.

(b) `CellDataLookup` in `src/renderer/painters/types.ts:9-12`:

```ts
export type CellDataLookup = (
  rowIndex: number,
  colId: string,
) => { value: unknown; valueFormatted: string; flashAlpha?: number; flashColor?: string } | null;
```

(c) `byRows.ts` — in the data-cell read (line 533-537):

```ts
      } else if (row.subgrid.isData) {
        const cell = cellData(row.localRowIndex, col.colId);
        value = cell?.value ?? '';
        valueFormatted = cell?.valueFormatted ?? '';
        flashAlpha = cell?.flashAlpha;
      }
```

becomes:

```ts
      } else if (row.subgrid.isData) {
        const cell = cellData(row.localRowIndex, col.colId);
        value = cell?.value ?? '';
        valueFormatted = cell?.valueFormatted ?? '';
        flashAlpha = cell?.flashAlpha;
        flashColor = cell?.flashColor;
      }
```

with `let flashColor: string | undefined;` declared next to `let flashAlpha: number | undefined;` (line 505), and immediately after the `applyCellProps(config, { ... });` call (line 640) add:

```ts
      // Cycle 21e / Task 13 — per-call flash color override. applyCellProps
      // just reset flashFromColor to the theme value, so this is
      // self-clearing across the reused config object.
      if (flashColor !== undefined) config.flashFromColor = flashColor;
```

(All built-in painters already blend `p.flashFromColor` at `p.flashAlpha` — `registry.ts:220-229` — so no painter changes are needed.)

- [ ] **Step 6: Shaper + registry + integration tests**

Create `packages/kernel/tests/core/flashShaper.test.ts` — exact curve values:

```ts
import { describe, it, expect } from 'vitest';
import { shapeFlashAlpha } from '../../src/core/flashShaper';

// Window: flash 500ms + fade 1000ms → total 1500ms.
const F = 500, D = 1000, T = F + D;

describe('shapeFlashAlpha', () => {
  it('fade reproduces the original registry math exactly', () => {
    expect(shapeFlashAlpha('fade', 0, F, D)).toBe(1);          // t=0
    expect(shapeFlashAlpha('fade', F, F, D)).toBe(1);          // end of hold
    expect(shapeFlashAlpha('fade', F + D / 2, F, D)).toBe(0.5); // mid-fade
    expect(shapeFlashAlpha('fade', T, F, D)).toBe(0);          // t=1
    expect(shapeFlashAlpha('fade', -1, F, D)).toBe(0);
  });
  it('pulse: sin² double cycle — 0/1/0/1/0 at quarter points', () => {
    expect(shapeFlashAlpha('pulse', 0, F, D)).toBe(0);                       // t=0
    expect(shapeFlashAlpha('pulse', T * 0.25, F, D)).toBeCloseTo(1, 10);    // t=0.25
    expect(shapeFlashAlpha('pulse', T * 0.5, F, D)).toBeCloseTo(0, 10);     // t=0.5
    expect(shapeFlashAlpha('pulse', T * 0.75, F, D)).toBeCloseTo(1, 10);    // t=0.75
    expect(shapeFlashAlpha('pulse', T, F, D)).toBe(0);                       // t=1
  });
  it('glow: plateau 60% then linear fade', () => {
    expect(shapeFlashAlpha('glow', 0, F, D)).toBe(1);            // t=0
    expect(shapeFlashAlpha('glow', T * 0.5, F, D)).toBe(1);      // t=0.5 (plateau)
    expect(shapeFlashAlpha('glow', T * 0.6, F, D)).toBe(1);      // plateau edge
    expect(shapeFlashAlpha('glow', T * 0.8, F, D)).toBeCloseTo(0.5, 10);
    expect(shapeFlashAlpha('glow', T, F, D)).toBe(0);            // t=1
  });
  it('degenerate zero-length window is safe', () => {
    expect(shapeFlashAlpha('pulse', 0, 0, 0)).toBe(0);
    expect(shapeFlashAlpha('glow', 0, 0, 0)).toBe(0);
    expect(shapeFlashAlpha('fade', 0, 0, 0)).toBe(1); // original: elapsed<=flashDuration
  });
});
```

Extend `tests/flashRegistry.test.ts` (existing deps-stub pattern in that file):
- `flash(..., override)` captures per-call flashDuration/fadeDuration → `tick` prunes at the per-call window, not the global one.
- `getAlpha` on an entry with `mode: 'pulse'` at `startedAt + total*0.25` ≈ 1; with `mode: 'glow'` mid-window = 1.
- `getColor` returns the override color for the flashed cell and `undefined` otherwise.
- `ingestMask` with `stringRowIds` + `getOverride` applies the override only to matching bits; without `getOverride` behavior is unchanged (default path regression).

Create `tests/flashOverrides.test.ts` (grid fixture from Task 10) covering the `cgrid` layer: `flashCells({rowIds, color, mode})` with `enableCellChangeFlash: true` stages override-map entries (exact keys, wildcard `*` when colIds omitted); a second call with no override fields stages nothing (default path → registry untouched → byte-identical); expired entries are swept (fake `performance.now` via `vi.spyOn`).

- [ ] **Step 7: Run new tests + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run tests/core/flashShaper.test.ts tests/flashRegistry.test.ts tests/flashOverrides.test.ts tests/flashAlphaMask.test.ts tests/dataPipelineFlash.test.ts
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx tsc --noEmit
```

Expected: all PASS — `flashAlphaMask.test.ts` + `dataPipelineFlash.test.ts` are the regression canary for `enableCellChangeFlash` (spec §8 risk row).

- [ ] **Step 8: Full kernel baseline run**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run 2>&1 | tail -5
```

Expected: 2399 baseline + Tasks 10-12 new + this task's new, 0 failures.

- [ ] **Step 9: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/kernel/src packages/kernel/tests
git commit -m "feat(kernel): cycle 21e task 13 — flashCells per-call color/mode/duration overrides + alpha shaper"
```

---

### Task 14: Indicator paint fold + rule valueFormatter override + format-eval memo

**Files:**
- Modify: `packages/kernel/src/renderer/painters/byRows.ts` (indicator precedence in the 21c cellIcon block; first/last visible colId)
- Modify: `packages/kernel/src/core/propertyChain.ts` (rule formatProgram text override in the fold; memo-routed `compileFormatSlots` wrappers; rowId/themeKind on `callbackParams`)
- Modify: `packages/kernel/src/core/formatCompilerSlot.ts` (`FormatProgramShape.hasRuleRefs?` + `resolveRuleRef` in the eval-ctx type)
- Modify: `packages/kernel/src/types/column.ts` (`CValueFormatterParams` optional `rowId`/`themeKind`)
- Create: `packages/kernel/src/core/formatEvalMemo.ts`
- Create: `packages/kernel/tests/core/formatEvalMemo.test.ts`
- Create: `packages/kernel/tests/byRowsRuleIndicator.test.ts`
- Modify: `packages/kernel/tests/core/propertyChain-ruleFold.test.ts` (extend: formatter override)

**Interfaces:**
- Consumes (Task 10/11): `getRuleEngine()`, `CellPaintConfig.ruleIndicator` (stored by the Task 11 fold), `ApplyCellPropsInput.rowId/ruleRow/themeKind`. Consumes (Task 9, Phase D): `@wellsfargo-starui/velocity-grid-format`'s `FormatEvalContext.resolveRuleRef?: (ruleId: string) => string | null` and `FormatProgram.hasRuleRefs?: boolean` — mirrored here STRUCTURALLY in `FormatProgramShape` (kernel still imports nothing from `@wellsfargo-starui/velocity-grid-format` at runtime; the type-only `IconRef` import in `propertyChain.ts:41` stays type-only).
- Produces (Task 15/16): rule indicators painted through the icon registry with colDef-`cellIcon` precedence; per-rule `valueFormatter` rendering; `rule:<ruleId>` live colors inside format programs on a real grid (E2E §9.3); the 21c-carried memo (one program eval per cell per paint).

- [ ] **Step 1: Widen the structural `FormatProgramShape`**

Current code (`src/core/formatCompilerSlot.ts:19-32`):

```ts
export interface FormatProgramShape {
  formatText: (ctx: { value: unknown; row: unknown; colId: string }) => string;
  resolveStyle: (ctx: { value: unknown; row: unknown; colId: string }) =>
    | { color?: string; background?: string; weight?: string | number; italic?: boolean }
    | null;
  resolveIcon: (ctx: { value: unknown; row: unknown; colId: string }) =>
    | { name: string; color?: string; position?: 'leading' | 'trailing' }
    | null;
  resolveFragments: (ctx: { value: unknown; row: unknown; colId: string }) =>
    | Array<{ text: string; style: unknown; icon?: unknown }>
    | null;
  source: unknown;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
}
```

becomes (one shared ctx alias + the new flag; structurally identical for existing callers):

```ts
/** Cycle 21e / Task 14 — eval context accepted by format programs.
 *  `resolveRuleRef` is the rule:<ruleId> accessor (spec §5.5) — the
 *  kernel closes it over the rule slot + current cell; @wellsfargo-starui/velocity-grid-format's
 *  tier1 resolver consults it when present (Cycle 21e Task 9). */
export interface FormatEvalCtxShape {
  value: unknown;
  row: unknown;
  colId: string;
  resolveRuleRef?: (ruleId: string) => string | null;
}

export interface FormatProgramShape {
  formatText: (ctx: FormatEvalCtxShape) => string;
  resolveStyle: (ctx: FormatEvalCtxShape) =>
    | { color?: string; background?: string; weight?: string | number; italic?: boolean }
    | null;
  resolveIcon: (ctx: FormatEvalCtxShape) =>
    | { name: string; color?: string; position?: 'leading' | 'trailing' }
    | null;
  resolveFragments: (ctx: FormatEvalCtxShape) =>
    | Array<{ text: string; style: unknown; icon?: unknown }>
    | null;
  source: unknown;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
  /** Cycle 21e / Task 14 — true when the program contains rule:<ruleId>
   *  refs. Such programs bypass the format-eval memo (a matched-set
   *  change without a value change must not serve stale colors) and
   *  always receive a resolveRuleRef accessor. Set by @wellsfargo-starui/velocity-grid-format's
   *  compile() (Task 9); undefined (older compilers) → treated false. */
  hasRuleRefs?: boolean;
}
```

- [ ] **Step 2: Optional identity fields on `CValueFormatterParams`**

Current code (`src/types/column.ts:542-544`):

```ts
export interface CValueFormatterParams<TRow, TValue> {
  data: TRow; value: TValue; colId: string;
}
```

becomes:

```ts
export interface CValueFormatterParams<TRow, TValue> {
  data: TRow; value: TValue; colId: string;
  /** Cycle 21e / Task 14 — string rowId of the data row, when the call
   *  site knows it (paint path). Enables the format-eval memo + the
   *  rule:<ruleId> accessor; absent → memo bypass, no rule refs. */
  rowId?: string;
  /** Cycle 21e / Task 14 — active theme kind, when known. */
  themeKind?: 'light' | 'dark';
}
```

Both fields are optional — every existing caller (worker-independent: `pinnedCellLookup` at `velocityGrid.ts:5221`, `formatNumber`, tests) stays valid unchanged.

- [ ] **Step 3: The memo module**

Create `packages/kernel/src/core/formatEvalMemo.ts`:

```ts
// Cycle 21e / Task 14 — per-cell format-eval memo (the carried Cycle 21c
// perf Minor: formatText + resolveStyle + resolveIcon each re-ran the
// program per paint). One WeakMap entry per program holding the LAST
// cell's eval keyed `${rowId}\0${colId}\0${String(value)}\0${theme}`
// (spec §5.5) — the three compileFormatSlots wrapper lambdas for one cell
// run back-to-back in a paint pass, so a single-entry memo collapses the
// triple eval into one. Key mismatch (next cell / changed value / theme
// flip) recomputes.
//
// Bypass rules (correctness over speed):
//   - program.hasRuleRefs === true — a rule-match change without a value
//     change must not serve stale colors;
//   - p.rowId undefined — no cell identity (pinned rows, ad-hoc calls).

import { getRuleEngine } from './ruleEngineSlot';
import type { FormatEvalCtxShape, FormatProgramShape } from './formatCompilerSlot';

export interface FormatEvalResult {
  text: string;
  style: ReturnType<FormatProgramShape['resolveStyle']>;
  icon: ReturnType<FormatProgramShape['resolveIcon']>;
}

interface MemoEntry { key: string; result: FormatEvalResult; }

const memo = new WeakMap<FormatProgramShape, MemoEntry>();

/** Build the eval ctx, closing resolveRuleRef over the rule slot + the
 *  current cell (spec §5.5). The accessor is only attached when both an
 *  engine and a cell identity exist. */
function buildCtx(p: { value: unknown; data: unknown; colId: string; rowId?: string; themeKind?: 'light' | 'dark' }): FormatEvalCtxShape {
  const engine = getRuleEngine();
  if (engine === null || p.rowId === undefined) {
    return { value: p.value, row: p.data, colId: p.colId };
  }
  const cellCtx = {
    row: p.data,
    rowId: p.rowId,
    colId: p.colId,
    theme: p.themeKind ?? 'light',
  } as const;
  return {
    value: p.value,
    row: p.data,
    colId: p.colId,
    resolveRuleRef: (ruleId: string) => engine.resolveRuleRef(ruleId, cellCtx),
  };
}

/** Evaluate all three channels of a format program for one cell, memoised
 *  per (program, rowId, colId, value, theme). */
export function evalFormatProgram(
  program: FormatProgramShape,
  p: { value: unknown; data: unknown; colId: string; rowId?: string; themeKind?: 'light' | 'dark' },
): FormatEvalResult {
  const memoable = program.hasRuleRefs !== true && p.rowId !== undefined;
  if (memoable) {
    const key = `${p.rowId}\0${p.colId}\0${String(p.value)}\0${p.themeKind ?? 'light'}`;
    const hit = memo.get(program);
    if (hit !== undefined && hit.key === key) return hit.result;
    const ctx = buildCtx(p);
    const result: FormatEvalResult = {
      text: program.formatText(ctx),
      style: program.resolveStyle(ctx),
      icon: program.resolveIcon(ctx),
    };
    memo.set(program, { key, result });
    return result;
  }
  const ctx = buildCtx(p);
  return {
    text: program.formatText(ctx),
    style: program.resolveStyle(ctx),
    icon: program.resolveIcon(ctx),
  };
}

/** Test-only helper — WeakMap has no clear(); recreating is enough
 *  because tests use fresh program objects per case. Exported for
 *  symmetry with the slots; intentionally a no-op. */
export function _resetFormatEvalMemo_forTests(): void {
  /* WeakMap entries are keyed by program identity; fresh programs
     per test make explicit clearing unnecessary. */
}
```

- [ ] **Step 4: Route the `compileFormatSlots` wrappers through the memo**

In `src/core/propertyChain.ts`, the Tier 0/1 wrapped lambdas — current code (lines 883-899):

```ts
    const program = res.program;
    return {
      ...merged,
      valueFormatter: (p: CValueFormatterParams<TRow, unknown>) =>
        program.formatText({ value: p.value, row: p.data, colId: p.colId }),
      cellStyle: mergeCellStyle(
        typeof merged.cellStyle === 'function'
          ? (merged.cellStyle as (params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined)
          : undefined,
        (p: CValueFormatterParams<TRow, unknown>) => {
          const s = program.resolveStyle({ value: p.value, row: p.data, colId: p.colId });
          if (!s) return undefined;
          return styleObjToRecord(s);
        },
      ),
      cellIcon: (p: CValueFormatterParams<TRow, unknown>) =>
        program.resolveIcon({ value: p.value, row: p.data, colId: p.colId }) as import('@wellsfargo-starui/velocity-grid-format').IconRef | null,
    } as CColDef<TRow>;
```

becomes (all three share one `evalFormatProgram` call — the memo makes it one program eval per cell per paint):

```ts
    const program = res.program;
    return {
      ...merged,
      valueFormatter: (p: CValueFormatterParams<TRow, unknown>) =>
        evalFormatProgram(program, p).text,
      cellStyle: mergeCellStyle(
        typeof merged.cellStyle === 'function'
          ? (merged.cellStyle as (params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined)
          : undefined,
        (p: CValueFormatterParams<TRow, unknown>) => {
          const s = evalFormatProgram(program, p).style;
          if (!s) return undefined;
          return styleObjToRecord(s);
        },
      ),
      cellIcon: (p: CValueFormatterParams<TRow, unknown>) =>
        evalFormatProgram(program, p).icon as import('@wellsfargo-starui/velocity-grid-format').IconRef | null,
    } as CColDef<TRow>;
```

Apply the same two-lambda substitution in the composite branch (lines 856-871: `valueFormatter` → `.text`, the `cellStyle` merge fn → `.style`). Add the import next to the slot imports:

```ts
import { evalFormatProgram } from './formatEvalMemo';
```

Then thread identity into the paint-path callers:

(a) `applyCellProps`'s `callbackParams` literal — current code (lines 633-640):

```ts
  const callbackParams = needsCallbackParams
    ? {
        data: (ctx.rowData ?? {}) as Record<string, unknown>,
        value: ctx.value,
        colId: colDef.colId,
        rowIndex: ctx.rowIndex ?? 0,
      }
    : undefined;
```

becomes:

```ts
  const callbackParams = needsCallbackParams
    ? {
        data: (ctx.rowData ?? {}) as Record<string, unknown>,
        value: ctx.value,
        colId: colDef.colId,
        rowIndex: ctx.rowIndex ?? 0,
        // Cycle 21e / Task 14 — cell identity for the format-eval memo +
        // rule:<ruleId> accessor. Undefined off the data paint path.
        rowId: ctx.rowId,
        themeKind: ctx.themeKind,
      }
    : undefined;
```

(b) the `byRows.ts` cellIcon call — current code (line 678):

```ts
          iconRef = def.cellIcon({ value, data: (rowData ?? {}) as never, colId: col.colId });
```

becomes:

```ts
          iconRef = def.cellIcon({
            value, data: (rowData ?? {}) as never, colId: col.colId,
            rowId: ruleRowId, themeKind: ctx.themeKind,
          });
```

(`ruleRowId` and `ctx.themeKind` exist in scope from Task 11 Step 5.)

- [ ] **Step 5: Rule `valueFormatter` override in the fold**

Reality note: the spec/prompt placed this in "the compileFormatSlots wrapped valueFormatter lambda", but that lambda only exists for columns that declared a format string — a rule's `valueFormatter` must apply to ANY column. The correct single point is the Task 11 fold, which already holds the `RuleCellPatchShape` and runs before the textTransform step. In the fold block added in Task 11 Step 7(d), the tail currently reads:

```ts
        // Indicator + formatProgram are stored for the byRows paint path
        // (Cycle 21e / Task 14) — one evaluateCell per cell, consumed twice.
        target.ruleIndicator = ruleResult.indicator;
```

Extend it to:

```ts
        // Indicator + formatProgram are stored for the byRows paint path
        // (Cycle 21e / Task 14) — one evaluateCell per cell, consumed twice.
        target.ruleIndicator = ruleResult.indicator;
        // Cycle 21e / Task 14 — per-rule valueFormatter: the winning
        // rule's compiled program replaces the column's formatted text.
        // Lives here (not in the compileFormatSlots wrappers) so it works
        // on columns with NO format string of their own. Runs before the
        // textTransform step, matching the normal formatted-text flow.
        if (ruleResult.formatProgram !== null && ruleResult.formatProgram !== undefined) {
          try {
            const prog = ruleResult.formatProgram as import('./formatCompilerSlot').FormatProgramShape;
            target.valueFormatted = String(prog.formatText({
              value: ctx.value,
              row: ctx.ruleRow ?? ctx.rowData ?? {},
              colId: colDef.colId,
            }));
          } catch { /* formatter errors never break paint */ }
        }
```

- [ ] **Step 6: Indicator precedence + row-start/row-end in `byRows.ts`**

Design (matches the real code structure): the engine returns the indicator on every cell of a row-scope match; `applyCellProps` stored it on `config.ruleIndicator` (Task 11); byRows filters `row-start`/`row-end` to the first/last visible data column, which it alone knows. Compute once per paint in `paintCellsByRows`, right after the band split (after line 212 `else center.push(col);` block):

```ts
  // Cycle 21e / Task 14 — first/last visible data column across all
  // bands (left-pinned → center → right-pinned order) for row-start /
  // row-end rule indicators.
  const firstVisibleColId = (leftPinned[0] ?? center[0] ?? rightPinned[0])?.colId;
  const lastVisibleColId = (rightPinned[rightPinned.length - 1]
    ?? center[center.length - 1]
    ?? leftPinned[leftPinned.length - 1])?.colId;
```

Add both to `PaintBandCtx` + the `bandCtx` literal (`firstVisibleColId?: string; lastVisibleColId?: string;`).

Then extend the 21c cellIcon block. Current code (`byRows.ts:670-705`):

```ts
      let pendingIcon: PendingCellIcon | null = null;
      if (
        row.subgrid.isData
        && !isFooterRow[r]
        && typeof def.cellIcon === 'function'
      ) {
        let iconRef: { name: string; color?: string; position?: 'leading' | 'trailing' } | null = null;
        try {
          iconRef = def.cellIcon({ value, data: (rowData ?? {}) as never, colId: col.colId });
        } catch {
          iconRef = null;
        }
        if (iconRef && iconRef.name) {
```

becomes (rule indicator wins over colDef `cellIcon` — rules are more specific, spec §5.3; the shared slot-claim + draw machinery below the `if (iconRef && iconRef.name)` line is reused untouched):

```ts
      let pendingIcon: PendingCellIcon | null = null;
      // Cycle 21e / Task 14 — rule indicator resolution. `cell` targets
      // paint on the matching cell; `row-start` / `row-end` paint only on
      // the first / last visible data column of the matching row (the
      // engine returns the indicator on every cell of a row-scope match;
      // byRows owns column order, so the filter lives here).
      let ruleIconRef: { name: string; color?: string; position?: 'leading' | 'trailing' } | null = null;
      const ri = config.ruleIndicator;
      if (ri && row.subgrid.isData && !isFooterRow[r]) {
        const placed =
          ri.target === 'cell'
          || (ri.target === 'row-start' && col.colId === ctx.firstVisibleColId)
          || (ri.target === 'row-end' && col.colId === ctx.lastVisibleColId);
        if (placed) {
          ruleIconRef = {
            name: ri.iconName,
            color: ri.color,
            position: ri.position === 'after' ? 'trailing' : 'leading',
          };
        }
      }
      if (
        ruleIconRef !== null
        || (row.subgrid.isData
          && !isFooterRow[r]
          && typeof def.cellIcon === 'function')
      ) {
        let iconRef: { name: string; color?: string; position?: 'leading' | 'trailing' } | null = ruleIconRef;
        if (iconRef === null) {
          try {
            iconRef = def.cellIcon!({
              value, data: (rowData ?? {}) as never, colId: col.colId,
              rowId: ruleRowId, themeKind: ctx.themeKind,
            });
          } catch {
            iconRef = null;
          }
        }
        if (iconRef && iconRef.name) {
```

(the remainder of the block — `resolveIconPath`, slot sizing, padding shift, `pendingIcon` — is unchanged; the closing braces align 1:1 with the current code).

- [ ] **Step 7: Tests**

`tests/byRowsRuleIndicator.test.ts` — fixture copied from `tests/byRowsCellIcon.test.ts` (Path2D shim, fake gc, fake theme, `makeVs`, icon registry `registerIconSet` + `_resetIconRegistry_forTests`), plus `registerRuleEngine`/`_resetRuleEngine_forTests`:
- cell-target indicator strokes the registered Path2D with the rule color and shifts text padding (assert `stroke` called with the path + `strokeStyle` = rule color — same assertions the 21c test makes for `cellIcon`).
- rule indicator wins when the colDef also has `cellIcon` (engine indicator's icon painted, colDef's not).
- `row-start` paints only on the first visible column; `row-end` only on the last (two-column viewport; assert exactly one stroke each).
- no engine / `ruleIndicator` null → colDef `cellIcon` path unchanged (regression).

`tests/core/formatEvalMemo.test.ts`:
- counting program (increments per `formatText`/`resolveStyle`/`resolveIcon` call): calling the three wrapped lambdas from `resolveColDefs([{ colId, valueFormatter: '<compiled-by-fake>' }])` with identical `{value, data, colId, rowId: 'r1', themeKind: 'light'}` → each underlying fn called exactly once (memo hit for calls 2-3).
- key rotation: change `value` → recompute; change `rowId` → recompute; change `themeKind` → recompute.
- `hasRuleRefs: true` program → every call re-evals (counts equal call count).
- `rowId` absent → memo bypassed.
- `resolveRuleRef` reaches the program: register an engine whose `resolveRuleRef` returns `'#00c853'`; a stub program whose `resolveStyle` returns `{ color: ctx.resolveRuleRef?.('r-up') ?? undefined }`; assert the wrapped cellStyle yields `fg: '#00c853'` and that the accessor received the cell's ctx (capture `ruleId` + assert engine `resolveRuleRef` called with `{row, rowId: 'r1', colId, theme: 'light'}`).

Extend `tests/core/propertyChain-ruleFold.test.ts`:
- engine returning `formatProgram: { formatText: () => '▲ 42.00' , ... }` → `applyCellProps` leaves `cfg.valueFormatted === '▲ 42.00'` (and textTransform still applies after it when set).
- formatProgram throw → original `valueFormatted` preserved.

- [ ] **Step 8: Run new tests + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run tests/byRowsRuleIndicator.test.ts tests/core/formatEvalMemo.test.ts tests/core/propertyChain-ruleFold.test.ts tests/core/propertyChain-compileFormatSlots.test.ts tests/byRowsCellIcon.test.ts tests/compositeRenderer.test.ts
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx tsc --noEmit
```

Expected: all PASS — `propertyChain-compileFormatSlots.test.ts` + `byRowsCellIcon.test.ts` + `compositeRenderer.test.ts` are the 21c regression canaries for the wrapper rewrite.

- [ ] **Step 9: Full kernel baseline run + dist-size check**

```bash
cd /Users/develop/wfh/canvasgrid/packages/kernel && npx vitest run 2>&1 | tail -5
cd /Users/develop/wfh/canvasgrid/packages/kernel && npm run build && du -sk dist
```

Expected: 2399 baseline + all Phase E additions green; dist Δ vs `main` < +2% (Task 17 re-verifies; catching a blowout early is cheaper).

- [ ] **Step 10: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/kernel/src packages/kernel/tests
git commit -m "feat(kernel): cycle 21e task 14 — rule indicator paint fold + rule valueFormatter override + format-eval memo"
```


## Phase F — Bridge, demo, docs, verification (3 tasks)

---

### Task 15: `wireIntoKernel(grid, opts?)` — the rules bridge

**Files:**
- Modify: `packages/rules/src/bridge.ts` (replace the Task 1 skeleton)
- Modify: `packages/rules/src/types.ts` (`WireRulesOptions` gains `now?` + `scheduleAfterRepaint?` — injectable clock/scheduler so bridge tests are deterministic)
- Modify: `packages/rules/src/ruleEngine.ts` ONLY IF Phase B did not already expose `watchedColIds(): ReadonlySet<string>` (aggregation over compiled conditions' watched sets — see Step 1)
- Test: `packages/rules/tests/bridge.test.ts`

**Interfaces:**
- Consumes (Tasks 3–8): `RuleEngine` (`setRules`, `evaluateCell`, `resolveRuleRef`, `recount`, `applyChanges`, `endTick`, `onExpire`, `watchedColIds`), `AlertsEngine` (`setRules`, `setSettings`, `applyChanges`, `flushThrottled`).
- Consumes (kernel Tasks 10–13, via structural surface only): `registerRuleEngine`, `on('rowsChanged' | 'cellValueChanged')`, `flashCells` (with the new `color`/`mode`/`flashDuration` params), `refresh`, `forEachRow`, `getThemeKind`.
- Produces (Tasks 16, 17): `wireIntoKernel(grid, opts?) → { rules, alerts }`, exported helpers `diffRows` + `watchedColIdUnion`.

**Reality checks locked during drafting (deviations from spec §5.4 wording):**
1. **Kernel's repaint API is `refresh(): void`** (`packages/kernel/src/types/api.ts:292`) — there is no `refreshCells({rowIds})`. Expiry + indicator repaints go through `grid.refresh()` (rAF-coalesced full viewport repaint). The structural surface names `refresh`, not `refreshCells`.
2. **Edit dedupe:** kernel Task 12 emits `rowsChanged` with `source: 'edit'` on edit commits AND the pre-existing `cellValueChanged` fires for the same commit. The bridge subscribes to both (per spec §5.4 step 3) but the `rowsChanged` handler **skips `source === 'edit'`** — the `cellValueChanged` path owns edits (it carries the exact `oldValue`/`newValue` pair, no diffing needed). Handling both would double-feed every edit into counts, flash, and alerts.
3. **Which colIds get per-cell diffed** (the union passed to `diffRows`): style-rule `watchedColIds` ∪ alert `relativeChange` `columnId`s ∪ alert `dataChange` `columnIds` restrictions. **Unrestricted `dataChange` rules add nothing** — they evaluate the post-change ROW once per updated row (spec §4.3), so they need the row present in `updated`, not `ChangeRecord`s. Every updated row from `rowsChanged` enters `RowChangeSet.updated` regardless of whether any watched cell diffed; only its `cells` array is watched-restricted.
4. **`throttled` alerts flush:** spec §4.3 says "bridge calls once per animation frame". The bridge flushes via the same post-repaint scheduler that drives `endTick()` — one `flushThrottled()` per burst, not a free-running rAF loop.

- [ ] **Step 1: Verify `RuleEngine.watchedColIds()` exists**

```bash
grep -n "watchedColIds" /Users/develop/wfh/canvasgrid/packages/rules/src/ruleEngine.ts
```

If Phase B landed it (Task 3 compiles conditions with `CompiledCondition.watchedColIds`, so the per-rule sets exist), skip ahead. If the aggregate accessor is missing, add to `RuleEngine`:

```ts
  /** Union of every enabled rule's condition-referenced colIds plus
   *  cell-scope columnIds. The bridge diffs exactly these columns. */
  watchedColIds(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const compiled of this.compiledRules) {
      if (!compiled.rule.enabled) continue;
      for (const colId of compiled.condition.watchedColIds) out.add(colId);
      if (compiled.rule.scope.kind === 'cell') {
        for (const colId of compiled.rule.scope.columnIds) out.add(colId);
      }
    }
    return out;
  }
```

(Adjust the internal field names to whatever Task 3 shipped.) Add one unit test in `packages/rules/tests/ruleEngine.test.ts`:

```ts
  it('watchedColIds() unions condition references and cell-scope columnIds', () => {
    const engine = new RuleEngine();
    engine.setRules([
      { kind: 'style', id: 'r1', name: 'r1', enabled: true, priority: 1,
        condition: '[pnl] < 0 AND [qty] > 10', scope: { kind: 'cell', columnIds: ['pnl'] },
        style: { base: { color: '#c62828' } } },
      { kind: 'style', id: 'off', name: 'off', enabled: false, priority: 2,
        condition: '[hidden] = 1', scope: { kind: 'row' }, style: { base: {} } },
    ]);
    expect([...engine.watchedColIds()].sort()).toEqual(['pnl', 'qty']);
  });
```

- [ ] **Step 2: Extend `WireRulesOptions` in `packages/rules/src/types.ts`**

Replace the existing `WireRulesOptions` interface with:

```ts
export interface WireRulesOptions {
  rules?: StyleRule[];
  alertRules?: AlertRule[];
  alertsSettings?: Partial<AlertsSettings>;
  schema?: import('@wellsfargo-starui/velocity-grid-expression').Schema;
  /** Injectable clock for both engines. Default: `() => performance.now()`
   *  (the wall-clock wrap lives HERE, at the bridge layer — engines stay
   *  Date-free per the global constraint). */
  now?: () => number;
  /** Injectable post-repaint scheduler for `endTick()` / throttled-alert
   *  flushing. Default: requestAnimationFrame when available, else
   *  `setTimeout(fn, 0)` (node / vitest). */
  scheduleAfterRepaint?: (fn: () => void) => void;
}
```

- [ ] **Step 3: Write failing bridge tests `packages/rules/tests/bridge.test.ts`**

```ts
// Cycle 21e / Task 15 — wireIntoKernel bridge.
//
// Fake-grid fixture mirrors packages/format/tests/bridge.test.ts: a
// plain object recording registrations + calls, plus an event-emitter
// map so tests can fire rowsChanged / cellValueChanged by hand. The
// scheduler is injected manually so endTick timing is deterministic.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { wireIntoKernel, diffRows, watchedColIdUnion } from '../src/bridge';
import { RuleEngine } from '../src/ruleEngine';
import type {
  AlertEvent, AlertRule, ConditionalStyleRule, StyleRule,
} from '../src/types';

// ─── Fixtures ──────────────────────────────────────────────────────────

const FLASH_RULE: ConditionalStyleRule = {
  kind: 'style', id: 'up-tick', name: 'Price up-tick', enabled: true, priority: 10,
  condition: '[price.old] != null AND [price] > [price.old]',
  scope: { kind: 'cell', columnIds: ['price'] },
  style: { base: { color: '#16a34a' } },
  flash: { enabled: true, target: 'cell', mode: 'pulse', color: '#16a34a', durationMs: 600 },
};

const NEG_RULE: ConditionalStyleRule = {
  kind: 'style', id: 'neg-pnl', name: 'Negative P&L', enabled: true, priority: 20,
  condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
  style: { base: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
};

const PRICE_ALERT: AlertRule = {
  id: 'a-price', name: 'Price move', enabled: true, priority: 1, severity: 'warning',
  trigger: { kind: 'relativeChange', columnId: 'price', mode: 'ANY_CHANGE', threshold: 0, direction: 'both' },
  message: '{rule}: {rowId} {column} {prev} -> {value}',
  channels: ['toast'],
};

const ROW_ALERT: AlertRule = {
  id: 'a-row', name: 'Row watch', enabled: true, priority: 2, severity: 'info',
  // Unrestricted dataChange — evaluates the whole post-change row.
  trigger: { kind: 'dataChange', expression: '[qty] > 100' },
  message: '{rule}: {rowId}',
  channels: ['badge'],
};

// ─── Fake grid + manual scheduler ──────────────────────────────────────

function makeFakeGrid(rows: Array<{ rowId: string; row: Record<string, unknown> }> = []) {
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const calls = {
    engines: [] as unknown[],
    flashCells: [] as Array<Record<string, unknown>>,
    refresh: 0,
  };
  return {
    registerRuleEngine(engine: unknown) { calls.engines.push(engine); },
    on(type: string, fn: (e: unknown) => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
      return () => {};
    },
    flashCells(p: Record<string, unknown>) { calls.flashCells.push(p); },
    refresh() { calls.refresh += 1; },
    forEachRow(fn: (rowId: string, row: Record<string, unknown>) => void) {
      for (const r of rows) fn(r.rowId, r.row);
    },
    getThemeKind: (): 'light' | 'dark' => 'dark',
    emit(type: string, e: unknown) { for (const fn of handlers.get(type) ?? []) fn(e); },
    _calls: calls,
  };
}

function manualScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void): void => { queue.push(fn); },
    flush: (): void => { while (queue.length > 0) queue.shift()!(); },
    get pending(): number { return queue.length; },
  };
}

function wire(
  grid: ReturnType<typeof makeFakeGrid>,
  extra?: { rules?: StyleRule[]; alertRules?: AlertRule[] },
) {
  const sched = manualScheduler();
  const wired = wireIntoKernel(grid, {
    rules: extra?.rules ?? [FLASH_RULE, NEG_RULE],
    alertRules: extra?.alertRules ?? [PRICE_ALERT],
    now: () => 0,
    scheduleAfterRepaint: sched.schedule,
  });
  return { ...wired, sched };
}

const updatedEvent = (
  rowId: string,
  oldRow: Record<string, unknown>,
  row: Record<string, unknown>,
  source: 'transaction' | 'transactionAsync' | 'edit' = 'transaction',
) => ({ added: [], updated: [{ rowId, row, oldRow }], removed: [], source });

afterEach(() => { vi.useRealTimers(); });

// ─── Tests ─────────────────────────────────────────────────────────────

describe('wireIntoKernel', () => {
  it('registers exactly one rule-engine adapter and returns both engines', () => {
    const grid = makeFakeGrid();
    const { rules, alerts } = wire(grid);
    expect(grid._calls.engines).toHaveLength(1);
    expect(rules).toBeInstanceOf(RuleEngine);
    expect(alerts.getSettings().enabled).toBe(true);
  });

  it('seeds rules, alertRules, and alertsSettings from opts', () => {
    const grid = makeFakeGrid();
    const sched = manualScheduler();
    const { rules, alerts } = wireIntoKernel(grid, {
      rules: [NEG_RULE],
      alertRules: [PRICE_ALERT],
      alertsSettings: { defaultDebounceMs: 250, evaluationMode: 'realtime' },
      now: () => 0,
      scheduleAfterRepaint: sched.schedule,
    });
    expect(rules.getRules().map((r) => r.id)).toEqual(['neg-pnl']);
    expect(alerts.getRules().map((r) => r.id)).toEqual(['a-price']);
    expect(alerts.getSettings().defaultDebounceMs).toBe(250);
  });

  it('adapter threads grid.getThemeKind() into the eval ctx', () => {
    const grid = makeFakeGrid();
    wire(grid);
    const adapter = grid._calls.engines[0] as {
      evaluateCell(ctx: unknown): { style: { color?: string } | null };
    };
    // No theme in the kernel-side ctx — the adapter must fill 'dark'
    // from the fake grid, resolving NEG_RULE's dark slice.
    const res = adapter.evaluateCell({ row: { pnl: -5 }, rowId: 'r1', colId: 'pnl' });
    expect(res.style?.color).toBe('#ef9a9a');
  });

  it('seeds match counts from grid.forEachRow at wire time', () => {
    const grid = makeFakeGrid([
      { rowId: 'a', row: { pnl: -1, price: 10 } },
      { rowId: 'b', row: { pnl: 2, price: 20 } },
      { rowId: 'c', row: { pnl: -3, price: 30 } },
    ]);
    const { rules } = wire(grid);
    expect(rules.matchCount('neg-pnl')).toBe(2);
  });

  it('rowsChanged: flash directive reaches grid.flashCells with color/mode/flashDuration', () => {
    const grid = makeFakeGrid([{ rowId: 'a', row: { pnl: 1, price: 10 } }]);
    wire(grid);
    grid.emit('rowsChanged', updatedEvent('a', { pnl: 1, price: 10 }, { pnl: 1, price: 11 }));
    expect(grid._calls.flashCells).toHaveLength(1);
    expect(grid._calls.flashCells[0]).toEqual({
      rowIds: ['a'], colIds: ['price'], color: '#16a34a', mode: 'pulse', flashDuration: 600,
    });
  });

  it('rowsChanged: counts move incrementally and the alert emits end-to-end', () => {
    const grid = makeFakeGrid([{ rowId: 'a', row: { pnl: 1, price: 10 } }]);
    const { rules, alerts } = wire(grid);
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    expect(rules.matchCount('neg-pnl')).toBe(0);
    grid.emit('rowsChanged', updatedEvent('a', { pnl: 1, price: 10 }, { pnl: -4, price: 11 }));
    expect(rules.matchCount('neg-pnl')).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ruleId).toBe('a-price');
    expect(seen[0]!.message).toBe('Price move: a price 10 -> 11');
  });

  it('unrestricted dataChange alerts fire without any watched ChangeRecords', () => {
    const grid = makeFakeGrid();
    const { alerts } = wire(grid, { rules: [], alertRules: [ROW_ALERT] });
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    // qty is NOT in the watched union (no style rules; dataChange is
    // unrestricted) — the update row must still be evaluated.
    grid.emit('rowsChanged', updatedEvent('a', { qty: 50 }, { qty: 500 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.colId).toBeNull();
  });

  it('cellValueChanged builds a one-record change set (edit path)', () => {
    const grid = makeFakeGrid();
    const { alerts } = wire(grid);
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    grid.emit('cellValueChanged', {
      rowId: 'a', colId: 'price', oldValue: 10, newValue: 12,
      data: { pnl: 1, price: 12 }, source: 'edit',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prev).toBe(10);
    expect(seen[0]!.value).toBe(12);
  });

  it("rowsChanged with source 'edit' is skipped (cellValueChanged owns edits)", () => {
    const grid = makeFakeGrid();
    const { alerts } = wire(grid);
    const seen: AlertEvent[] = [];
    alerts.onAlert((a) => seen.push(a));
    grid.emit('rowsChanged', updatedEvent('a', { price: 10 }, { price: 12 }, 'edit'));
    expect(seen).toHaveLength(0);
    expect(grid._calls.flashCells).toHaveLength(0);
  });

  it('endTick is scheduled once per burst and clears the diff map', () => {
    const grid = makeFakeGrid();
    const { rules, sched } = wire(grid);
    grid.emit('rowsChanged', updatedEvent('a', { price: 10 }, { price: 11 }));
    grid.emit('rowsChanged', updatedEvent('b', { price: 20 }, { price: 21 }));
    expect(sched.pending).toBe(1); // coalesced
    // Diff-aware rule matches while the tick is open…
    const during = rules.evaluateCell({ row: { price: 11 }, rowId: 'a', colId: 'price', theme: 'dark' });
    expect(during.matched).toContain('up-tick');
    // …and goes quiescent after the post-repaint endTick.
    sched.flush();
    const after = rules.evaluateCell({ row: { price: 11 }, rowId: 'a', colId: 'price', theme: 'dark' });
    expect(after.matched).not.toContain('up-tick');
  });

  it('is idempotent — re-calling returns the SAME engines object', () => {
    const grid = makeFakeGrid();
    const first = wire(grid);
    const again = wireIntoKernel(grid);
    expect(again.rules).toBe(first.rules);
    expect(again.alerts).toBe(first.alerts);
    expect(grid._calls.engines).toHaveLength(1);
  });

  it('activeDurationMs expiry repaints via grid.refresh()', () => {
    vi.useFakeTimers();
    const grid = makeFakeGrid();
    const sched = manualScheduler();
    wireIntoKernel(grid, {
      rules: [{ ...FLASH_RULE, activeDurationMs: 500 }],
      now: () => Date.now(), // fake-timer-driven clock
      scheduleAfterRepaint: sched.schedule,
    });
    grid.emit('rowsChanged', updatedEvent('a', { price: 10 }, { price: 11 }));
    sched.flush();
    expect(grid._calls.refresh).toBe(0);
    vi.advanceTimersByTime(600);
    expect(grid._calls.refresh).toBeGreaterThanOrEqual(1);
  });
});

describe('diffRows', () => {
  it('diffs only watched colIds with Object.is semantics', () => {
    const cells = diffRows('r1',
      { price: 10, qty: 5, note: 'x' },
      { price: 11, qty: 5, note: 'y' },
      new Set(['price', 'qty']));
    expect(cells).toEqual([{ rowId: 'r1', colId: 'price', oldValue: 10, newValue: 11 }]);
  });

  it('treats NaN → NaN as unchanged (Object.is)', () => {
    expect(diffRows('r1', { v: NaN }, { v: NaN }, new Set(['v']))).toEqual([]);
  });
});

describe('watchedColIdUnion', () => {
  it('unions style watched sets, relativeChange columnId, and restricted dataChange columnIds', () => {
    const engine = new RuleEngine();
    engine.setRules([NEG_RULE]); // watches pnl
    const union = watchedColIdUnion(engine, [
      PRICE_ALERT, // relativeChange price
      { ...ROW_ALERT, trigger: { kind: 'dataChange', expression: '[fee] > 0', columnIds: ['fee'] } },
      { ...ROW_ALERT, id: 'a-unrestricted' }, // unrestricted — contributes nothing
      { ...PRICE_ALERT, id: 'a-off', enabled: false,
        trigger: { kind: 'relativeChange', columnId: 'hidden', mode: 'ANY_CHANGE', threshold: 0, direction: 'both' } },
    ]);
    expect([...union].sort()).toEqual(['fee', 'pnl', 'price']);
  });
});
```

Run (expected: FAIL — skeleton throws `not-yet-implemented`):

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules
npx vitest run tests/bridge.test.ts
```

- [ ] **Step 4: Implement `packages/rules/src/bridge.ts`**

Replace the skeleton with:

```ts
// Cycle 21e / Task 15 — the kernel bridge.
//
// `wireIntoKernel(grid, opts?)` wires @wellsfargo-starui/velocity-grid-rules' engines onto a
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
// Kernel never runtime-imports @wellsfargo-starui/velocity-grid-rules; this module reaches into
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
 *  ∪ alert relativeChange columnId   (needs old/new pairs)
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
      watched.add(t.columnId);
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
 * Wire @wellsfargo-starui/velocity-grid-rules into a VelocityGrid instance. Idempotent — re-calling on
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
```

- [ ] **Step 5: Run the suite + typecheck**

```bash
cd /Users/develop/wfh/canvasgrid/packages/rules
npx vitest run
npx tsc --noEmit
```

Expected: full rules suite PASS (Phase A–C baselines + 15 new bridge tests: 12 `wireIntoKernel` + 2 `diffRows` + 1 `watchedColIdUnion`); typecheck clean. If the expiry test's clock coordination differs from Task 5's final injectable-timer surface, adapt the test to that surface (fake timers + `now: () => Date.now()` is the default assumption).

- [ ] **Step 6: Verify zero static kernel imports**

```bash
grep -rn "from '@wellsfargo-starui/velocity-grid'" /Users/develop/wfh/canvasgrid/packages/rules/src/
```

Expected: no output (structural interfaces only — mirrors format's bridge).

- [ ] **Step 7: Commit**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules
git commit -m "$(cat <<'COMMIT_EOF'
feat(rules): cycle 21e task 15 — wireIntoKernel(grid, opts?) kernel bridge

- bridge.ts: constructs + seeds RuleEngine/AlertsEngine, registers the
  theme-threading adapter via grid.registerRuleEngine, subscribes
  rowsChanged (edit-source skipped) + cellValueChanged, watched-column
  diffing (diffRows/watchedColIdUnion exported), FlashDirective →
  grid.flashCells({color, mode, flashDuration}), coalesced post-repaint
  endTick + throttled-alert flush via injectable scheduler, match-count
  seeding via forEachRow, expiry → grid.refresh(). Idempotent via
  __rulesBridgeWired returning the SAME engines object.
- types.ts: WireRulesOptions gains now?/scheduleAfterRepaint? — the
  performance.now() wrap lives at the bridge layer; engines stay
  Date-free.
- Kernel repaint reality: public API is refresh() (types/api.ts:292),
  not refreshCells — expiry repaints use it.
- tests/bridge.test.ts: registration, seeding, theme threading,
  count seeding, flash params, end-to-end alert, unrestricted
  dataChange without watched records, cellValueChanged path, edit
  dedupe, coalesced endTick + diff-map clear, idempotency, expiry
  refresh, diffRows/watchedColIdUnion helpers.

Zero static @wellsfargo-starui/velocity-grid imports in packages/rules/src (grep-verified).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
COMMIT_EOF
)"
```

---

### Task 16: Showcase demo features + E2E

**Files:**
- Create: `apps/cgrid-showcase/src/features/conditionalStyling.ts`
- Create: `apps/cgrid-showcase/src/features/alerts.ts`
- Modify: `apps/cgrid-showcase/src/features/index.ts` (register both)
- Modify: `apps/cgrid-showcase/package.json` (add `"@wellsfargo-starui/velocity-grid-rules": "*"` dependency)
- Create: `apps/cgrid-showcase/e2e/conditionalStyling.spec.ts`
- Create: `apps/cgrid-showcase/e2e/alerts.spec.ts`

**Interfaces:**
- Consumes: `wireIntoKernel` from `@wellsfargo-starui/velocity-grid-rules` (Task 15), `wireIntoKernel` from `@wellsfargo-starui/velocity-grid-format` (21c), the full kernel Phase E surface (slot, flash overrides, indicator paint, `rowsChanged`).
- Produces: two demo pages + 12 new E2E tests (7 conditional-styling + 5 alerts) → showcase E2E total **109 baseline + 12 new = 121**.

**Reality checks (deviations from earlier drafts of this plan):**
1. **Showcase sources are TypeScript.** `index.html` loads `/src/main.ts`; the registration file is `src/features/index.ts` (typed `Feature` interface). The `src/features/*.js` files in the untracked-straggler list are `tsc -b` emit artifacts, NOT sources. This task creates `.ts` files and commits ONLY them (never the `.js` siblings) — exactly what 21c Task 18 actually did with `formatDSL.ts`.
2. **Feature contract** (from `features/index.ts`): `{ id, label, description, mount(gridHost, controls, theme): VelocityGrid }`. Controls use `.ctrl-btn` / `.ctrl-btn.primary` classes + `data-testid` attributes; ticking cleanup piggybacks on `grid.destroy()` (the `realtimeStomp.ts` pattern). Descriptions render into `#desc-bar`.
3. **Wiring order** (from `formatDSL.ts`): string/composite defs compile during column resolution, so construct the grid with the plain symbol column only, wire format + rules, THEN `updateGridOptions({ columnDefs })` + `setRowData`.
4. **E2E assertion mechanism** (from `formatDSL.spec.ts`): canvas text is not in the DOM — assert through `window.__cgrid` resolved defs and engine probes exposed on `window`; DOM assertions only for real DOM (controls, alert log, desc bar). Flash is proven by monkey-patching `grid.flashCells` in-page and asserting the recorded params (the bridge calls through the property at flash time).

- [ ] **Step 1: Add the `@wellsfargo-starui/velocity-grid-rules` dependency**

In `apps/cgrid-showcase/package.json`, add to `dependencies` (alongside `@wellsfargo-starui/velocity-grid-format`):

```json
    "@wellsfargo-starui/velocity-grid-rules": "*",
```

Then `npm install` at the repo root.

- [ ] **Step 2: Create `apps/cgrid-showcase/src/features/conditionalStyling.ts`**

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import type { RuleEngine, StyleRule } from '@wellsfargo-starui/velocity-grid-rules';
import type { Feature } from './index';

/**
 * Cycle 21e / Task 16 — Conditional styling demo.
 *
 * Four rules over a ticking equity blotter:
 *   • neg-pnl    — theme-aware cell color (light/dark slices).
 *   • big-qty    — row-scope threshold: bold + wash on block positions.
 *   • up-tick    — diff-aware ([price.old]) flash-on-change, pulse,
 *                  activeDurationMs auto-expire.
 *   • stale-row  — indicator badge (Lucide alert-triangle) at row start.
 *
 * The composite Summary column proves the Cycle 21c reserve: fragment
 * style color 'rule:neg-pnl' resolves to the LIVE rule color per row.
 * Match counts render as chips in the controls bar (engine.matchCount).
 */

interface BlotterRow {
  symbol: string;
  desk: string;
  price: number;
  pnl: number;
  qty: number;
  status: 'LIVE' | 'STALE';
}

const START_ROWS: BlotterRow[] = [
  { symbol: 'AAPL', desk: 'Equities', price: 150.25, pnl: 1250, qty: 300, status: 'LIVE' },
  { symbol: 'GOOG', desk: 'Equities', price: 2850.10, pnl: -840, qty: 120, status: 'LIVE' },
  { symbol: 'MSFT', desk: 'Equities', price: 305.50, pnl: 410, qty: 650, status: 'LIVE' },
  { symbol: 'AMZN', desk: 'Equities', price: 3320.00, pnl: -2150, qty: 80, status: 'STALE' },
  { symbol: 'TSLA', desk: 'Equities', price: 720.85, pnl: 95, qty: 900, status: 'LIVE' },
  { symbol: 'NVDA', desk: 'Equities', price: 495.20, pnl: 3120, qty: 540, status: 'LIVE' },
];

const RULES: StyleRule[] = [
  // Theme-aware negative-value coloring (cell scope).
  {
    kind: 'style', id: 'neg-pnl', name: 'Negative P&L', enabled: true, priority: 10,
    condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
    style: { light: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
  },
  // Row-scope threshold: block positions get bold + a subtle wash.
  {
    kind: 'style', id: 'big-qty', name: 'Block position', enabled: true, priority: 20,
    condition: '[qty] > 500', scope: { kind: 'row' },
    style: {
      base: { fontWeight: 'bold' },
      light: { backgroundColor: '#fff8e1' },
      dark: { backgroundColor: '#3a3320' },
    },
  },
  // Diff-aware flash-on-change: matches only inside the tick that
  // raised the price; pulse flash + 1.5s auto-expire.
  {
    kind: 'style', id: 'up-tick', name: 'Price up-tick', enabled: true, priority: 30,
    condition: '[price.old] != null AND [price] > [price.old]',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { color: '#16a34a' } },
    flash: { enabled: true, target: 'cell', mode: 'pulse', color: '#16a34a', durationMs: 600 },
    activeDurationMs: 1500,
  },
  // Indicator badge rule: stale rows carry a warning triangle.
  {
    kind: 'indicator', id: 'stale-row', name: 'Stale row', enabled: true, priority: 40,
    condition: '[status] = "STALE"', scope: { kind: 'row' },
    indicator: { iconName: 'alert-triangle', color: '#f59e0b', target: 'row-start', position: 'before' },
  },
];

const COLUMNS: CColDef<BlotterRow>[] = [
  { colId: 'symbol', field: 'symbol', headerName: 'Symbol', cellDataType: 'text', width: 100 },
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 110 },
  { colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number', width: 110, valueFormatter: '$#,##0.00' },
  { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 110, valueFormatter: '#,##0;-#,##0' },
  { colId: 'qty', field: 'qty', headerName: 'Qty', cellDataType: 'number', width: 90, valueFormatter: '#,##0' },
  { colId: 'status', field: 'status', headerName: 'Status', cellDataType: 'text', width: 90 },
  // Cycle 21c reserve, now live: 'rule:neg-pnl' resolves the fragment
  // color from the matching rule's theme-resolved style.color.
  {
    colId: 'summary', type: 'composite', headerName: 'Summary', width: 240,
    align: 'left', overflow: 'ellipsis',
    fragments: [
      { expr: '[symbol]', style: { weight: 'bold' } },
      { text: '  ' },
      { expr: '[pnl]', format: '+#,##0;-#,##0', style: { color: 'rule:neg-pnl' } },
    ],
  },
];

const RULE_CHIP_COLORS: Record<string, string> = {
  'neg-pnl': '#ef5350',
  'big-qty': '#f5b84a',
  'up-tick': '#22c55e',
  'stale-row': '#f59e0b',
};

export const conditionalStyling: Feature = {
  id: 'conditional-styling',
  label: 'Conditional Styling',
  description:
    'Cycle 21e — @wellsfargo-starui/velocity-grid-rules conditional styling. Theme-aware style ' +
    'rules ([pnl] < 0), a row-scope threshold rule ([qty] > 500), a ' +
    'diff-aware flash rule ([price.old] comparison, pulse, 1.5s ' +
    'auto-expire), an indicator badge for stale rows, and a composite ' +
    'column whose fragment color is rule:neg-pnl — the Cycle 21c ' +
    'reserve resolving live. Match counts update as the data ticks.',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<BlotterRow>(gridHost, {
      getRowId: (r) => r.symbol,
      columnDefs: [COLUMNS[0]!],
      theme,
      rowHeight: 32,
      headerHeight: 36,
    });

    // Wire format (composite compiler) AND rules BEFORE the full defs
    // resolve — same re-issue pattern as formatDSL.ts. Rule-driven
    // flash owns the flash channel, so enableCellChangeFlash stays off.
    wireFormat(grid);
    const { rules } = wireRules(grid, { rules: RULES });
    grid.updateGridOptions({ columnDefs: COLUMNS });
    grid.setRowData(START_ROWS);

    // E2E probe surface (mirrors window.__cgrid in main.ts).
    (window as unknown as { __cgridRules: RuleEngine }).__cgridRules = rules;

    // ─── Ticking mutator ─────────────────────────────────────────────
    const data = new Map(START_ROWS.map((r) => [r.symbol, { ...r }]));
    const round2 = (n: number): number => Math.round(n * 100) / 100;

    /** Deterministic single tick for the E2E: AAPL price UP (fires the
     *  up-tick flash rule) + GOOG pnl sign flip (moves the neg-pnl
     *  match count 2 → 1 → 2 → …). */
    const tickOnce = (): void => {
      const aapl = data.get('AAPL')!;
      aapl.price = round2(aapl.price + 1.25);
      const goog = data.get('GOOG')!;
      goog.pnl = -goog.pnl;
      grid.applyTransaction({ update: [{ ...aapl }, { ...goog }] });
      renderCounts();
    };

    const tickRandom = (): void => {
      const symbols = [...data.keys()];
      const updates: BlotterRow[] = [];
      for (let i = 0; i < 2; i += 1) {
        const row = data.get(symbols[Math.floor(Math.random() * symbols.length)]!)!;
        row.price = round2(Math.max(1, row.price * (1 + (Math.random() - 0.45) * 0.02)));
        row.pnl = Math.round(row.pnl + (Math.random() - 0.5) * 600);
        updates.push({ ...row });
      }
      grid.applyTransaction({ update: updates });
      renderCounts();
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const setTicking = (on: boolean): void => {
      if (on && timer === null) timer = setInterval(tickRandom, 600);
      if (!on && timer !== null) { clearInterval(timer); timer = null; }
      tickBtn.textContent = on ? 'Pause ticking' : 'Start ticking';
      tickBtn.classList.toggle('primary', !on);
    };

    // ─── Controls: tick buttons + live match-count chips ─────────────
    const tickBtn = document.createElement('button');
    tickBtn.className = 'ctrl-btn primary';
    tickBtn.setAttribute('data-testid', 'btn-cs-tick');
    tickBtn.addEventListener('click', () => setTicking(timer === null));

    const tickOnceBtn = document.createElement('button');
    tickOnceBtn.className = 'ctrl-btn';
    tickOnceBtn.textContent = 'Tick once';
    tickOnceBtn.setAttribute('data-testid', 'btn-cs-tick-once');
    tickOnceBtn.addEventListener('click', tickOnce);

    const chips = new Map<string, HTMLSpanElement>();
    for (const rule of RULES) {
      const chip = document.createElement('span');
      chip.className = 'ctrl-btn';
      chip.style.cursor = 'default';
      chip.style.borderLeft = `3px solid ${RULE_CHIP_COLORS[rule.id] ?? '#888'}`;
      chip.setAttribute('data-testid', `match-count-${rule.id}`);
      chips.set(rule.id, chip);
    }
    const renderCounts = (): void => {
      for (const [ruleId, chip] of chips) {
        const rule = RULES.find((r) => r.id === ruleId)!;
        chip.textContent = `${rule.name} · APP ${rules.matchCount(ruleId)}`;
      }
    };
    renderCounts();
    const countTimer = setInterval(renderCounts, 800);

    controls.append(tickBtn, tickOnceBtn, ...chips.values());
    setTicking(false);

    // Cleanup piggybacks on destroy (realtimeStomp.ts pattern).
    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      if (timer !== null) clearInterval(timer);
      clearInterval(countTimer);
      origDestroy();
    };

    return grid;
  },
};
```

- [ ] **Step 3: Create `apps/cgrid-showcase/src/features/alerts.ts`**

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import type { AlertRule, AlertSeverity, AlertsEngine } from '@wellsfargo-starui/velocity-grid-rules';
import type { Feature } from './index';

/**
 * Cycle 21e / Task 16 — Alerts core demo.
 *
 * Three alert rules, one per trigger kind:
 *   • price-move — relativeChange, PERCENT_CHANGE ≥ 1%, 1.5s debounce.
 *   • deep-loss  — dataChange restricted to [pnl], severity critical.
 *   • row-added  — rowChange ROW_ADDED, severity info.
 *
 * The on-page log is fed by alerts.onAlert (severity chip + rendered
 * message); the unread badge tracks unreadCount()/markAllRead(); the
 * mode select flips evaluationMode (realtime / throttled / paused).
 * Channel ROUTING stays in the host by design — this page IS the
 * host's toast/badge surface.
 */

interface BlotterRow {
  symbol: string;
  price: number;
  pnl: number;
  qty: number;
}

const START_ROWS: BlotterRow[] = [
  { symbol: 'AAPL', price: 150.25, pnl: 1250, qty: 300 },
  { symbol: 'GOOG', price: 2850.10, pnl: -840, qty: 120 },
  { symbol: 'MSFT', price: 305.50, pnl: 410, qty: 650 },
  { symbol: 'TSLA', price: 720.85, pnl: 95, qty: 900 },
];

const ALERT_RULES: AlertRule[] = [
  {
    id: 'price-move', name: 'Price move ≥ 1%', enabled: true, priority: 1, severity: 'warning',
    trigger: { kind: 'relativeChange', columnId: 'price', mode: 'PERCENT_CHANGE', threshold: 1, direction: 'both' },
    message: '{rule}: {rowId} {column} {prev} → {value}',
    channels: ['toast'],
    debounceMs: 1500,
  },
  {
    id: 'deep-loss', name: 'Deep loss', enabled: true, priority: 2, severity: 'critical',
    trigger: { kind: 'dataChange', expression: '[pnl] < -1000', columnIds: ['pnl'] },
    message: '{rule}: {rowId} P&L {value}',
    channels: ['toast', 'badge'],
  },
  {
    id: 'row-added', name: 'Row added', enabled: true, priority: 3, severity: 'info',
    trigger: { kind: 'rowChange', mode: 'ROW_ADDED' },
    message: '{rule}: {rowId} joined the blotter',
    channels: ['badge'],
  },
];

const COLUMNS: CColDef<BlotterRow>[] = [
  { colId: 'symbol', field: 'symbol', headerName: 'Symbol', cellDataType: 'text', width: 110 },
  { colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number', width: 120, valueFormatter: (p) => `$${Number(p.value).toFixed(2)}` },
  { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 110 },
  { colId: 'qty', field: 'qty', headerName: 'Qty', cellDataType: 'number', width: 90 },
];

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  info: '#3b82f6',
  success: '#16a34a',
  warning: '#f59e0b',
  critical: '#dc2626',
};

export const alertsFeature: Feature = {
  id: 'alerts',
  label: 'Alerts',
  description:
    'Cycle 21e — @wellsfargo-starui/velocity-grid-rules alerts core. Three trigger kinds ' +
    '(relativeChange 1% price moves with 1.5s debounce, dataChange ' +
    'deep-loss on [pnl], rowChange on adds), severity chips, message ' +
    'templating, unread badge with mark-all-read, and an evaluation ' +
    'mode switch (realtime / throttled / paused). Channel routing ' +
    'stays in the host — this log IS the host surface.',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<BlotterRow>(gridHost, {
      getRowId: (r) => r.symbol,
      columnDefs: COLUMNS,
      theme,
      rowHeight: 32,
      headerHeight: 36,
      enableCellChangeFlash: true,
    });
    grid.setRowData(START_ROWS);

    const { alerts } = wireRules(grid, {
      alertRules: ALERT_RULES,
      alertsSettings: { defaultDebounceMs: 1000 },
    });
    (window as unknown as { __cgridAlerts: AlertsEngine }).__cgridAlerts = alerts;

    // ─── Data mutators ───────────────────────────────────────────────
    const data = new Map(START_ROWS.map((r) => [r.symbol, { ...r }]));
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    let addSeq = 0;

    /** Deterministic tick: AAPL +2% (crosses the 1% threshold). */
    const tickOnce = (): void => {
      const aapl = data.get('AAPL')!;
      aapl.price = round2(aapl.price * 1.02);
      grid.applyTransaction({ update: [{ ...aapl }] });
    };
    /** Five rapid MSFT +2% moves — debounce collapses them to ONE alert. */
    const burst = (): void => {
      for (let i = 0; i < 5; i += 1) {
        const msft = data.get('MSFT')!;
        msft.price = round2(msft.price * 1.02);
        grid.applyTransaction({ update: [{ ...msft }] });
      }
    };
    const addRow = (): void => {
      addSeq += 1;
      const row: BlotterRow = { symbol: `POS${addSeq}`, price: 100, pnl: 0, qty: 10 };
      data.set(row.symbol, row);
      grid.applyTransaction({ add: [{ ...row }] });
    };

    // ─── Alert log + unread badge (host-side channel surface) ────────
    const log = document.createElement('div');
    log.setAttribute('data-testid', 'alert-log');
    log.style.cssText =
      'flex-basis:100%; max-height:150px; overflow-y:auto; display:flex; ' +
      'flex-direction:column; gap:4px; padding:6px 2px 2px;';

    const badge = document.createElement('span');
    badge.className = 'ctrl-btn';
    badge.style.cursor = 'default';
    badge.setAttribute('data-testid', 'alert-unread');

    const renderBadge = (): void => {
      const n = alerts.unreadCount();
      badge.textContent = `Unread: ${n}`;
      badge.style.background = n > 0 ? 'rgba(245,158,11,0.18)' : '';
    };
    renderBadge();

    alerts.onAlert((a) => {
      const entry = document.createElement('div');
      entry.className = 'alert-entry';
      entry.setAttribute('data-severity', a.severity);
      entry.setAttribute('data-rule-id', a.ruleId);
      entry.style.cssText =
        'display:flex; align-items:center; gap:8px; ' +
        'font:12px ui-monospace, SFMono-Regular, Menlo, monospace;';
      const chip = document.createElement('span');
      chip.textContent = a.severity.toUpperCase();
      chip.style.cssText =
        'padding:1px 8px; border-radius:9px; font-size:10px; font-weight:600; ' +
        `letter-spacing:0.4px; color:#fff; background:${SEVERITY_COLORS[a.severity]};`;
      const msg = document.createElement('span');
      msg.textContent = a.message;
      entry.append(chip, msg);
      log.prepend(entry);
      renderBadge();
    });

    // ─── Controls ────────────────────────────────────────────────────
    const mkBtn = (label: string, testid: string, fn: () => void, primary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = primary ? 'ctrl-btn primary' : 'ctrl-btn';
      b.textContent = label;
      b.setAttribute('data-testid', testid);
      b.addEventListener('click', fn);
      return b;
    };

    const modeSelect = document.createElement('select');
    modeSelect.className = 'ctrl-btn';
    modeSelect.setAttribute('data-testid', 'sel-alert-mode');
    for (const mode of ['realtime', 'throttled', 'paused'] as const) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = `Mode: ${mode}`;
      modeSelect.appendChild(opt);
    }
    modeSelect.addEventListener('change', () => {
      alerts.setSettings({ evaluationMode: modeSelect.value as 'realtime' | 'throttled' | 'paused' });
    });

    controls.append(
      mkBtn('Tick once (+2% AAPL)', 'btn-al-tick-once', tickOnce, true),
      mkBtn('Burst ×5 (MSFT)', 'btn-al-burst', burst),
      mkBtn('Add row', 'btn-al-add', addRow),
      modeSelect,
      mkBtn('Mark all read', 'btn-alert-read', () => { alerts.markAllRead(); renderBadge(); }),
      badge,
      log,
    );

    return grid;
  },
};
```

- [ ] **Step 4: Register both features in `apps/cgrid-showcase/src/features/index.ts`**

Add the imports after the `formatDSL` import:

```ts
import { conditionalStyling } from './conditionalStyling';
import { alertsFeature } from './alerts';
```

And append to the `FEATURES` array after `formatDSL`:

```ts
  conditionalStyling,
  alertsFeature,
];
```

Do NOT commit the emitted `.js` siblings — sources are `.ts`; the untracked `src/features/*.js` stragglers stay untracked.

- [ ] **Step 5: Manual smoke (UI quality gate)**

```bash
npm --workspace cgrid-showcase run dev
```

Open `http://localhost:5185/?feature=conditional-styling` and `?feature=alerts`. Verify against neighboring pages (formatDSL, realtimeStomp): controls are `.ctrl-btn` chips (no unstyled elements), match-count chips carry their rule-color left border, severity chips are legible pills in both themes (toggle ☀/☾ — neg-pnl color must flip `#c62828` ↔ `#ef9a9a`), the alert log scrolls, ticking flashes the price cell green with a pulse, AMZN carries the amber triangle indicator, and the Summary column's P&L fragment is red only on negative rows. Per the UI-quality memory: consult `docs/catalog/screenshots/` for the controls-bar conventions before deviating from the patterns above.

- [ ] **Step 6: Create `apps/cgrid-showcase/e2e/conditionalStyling.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 21e / Task 16 — Conditional styling feature.
//
// Cell paint is canvas-side, so rule assertions probe the engine that
// the painter consults (window.__cgridRules, the same instance the
// bridge registered) plus the resolved composite program — mirroring
// formatDSL.spec.ts's resolved-def strategy. Flash is proven by
// recording grid.flashCells params in-page.

test.describe('conditional styling (rules)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeature(page, 'conditional-styling');
  });

  test('mounts 6 rows, wires the rule engine, description mentions Cycle 21e', async ({ page }) => {
    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(rowCount).toBe(6);
    const wired = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      return { hasEngine: !!rules, ruleIds: rules?.getRules().map((r: any) => r.id) };
    });
    expect(wired.hasEngine).toBe(true);
    expect(wired.ruleIds).toEqual(['neg-pnl', 'big-qty', 'up-tick', 'stale-row']);
    await expect(page.locator('#desc-bar')).toContainText('Cycle 21e');
  });

  test('theme-aware negative P&L rule resolves per-theme colors', async ({ page }) => {
    const res = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      return {
        dark: rules.evaluateCell({ row: { pnl: -500 }, rowId: 'probe', colId: 'pnl', theme: 'dark' }),
        light: rules.evaluateCell({ row: { pnl: -500 }, rowId: 'probe', colId: 'pnl', theme: 'light' }),
        positive: rules.evaluateCell({ row: { pnl: 500 }, rowId: 'probe', colId: 'pnl', theme: 'dark' }),
      };
    });
    expect(res.dark.matched).toContain('neg-pnl');
    expect(res.dark.style.color).toBe('#ef9a9a');
    expect(res.light.style.color).toBe('#c62828');
    expect(res.positive.matched).not.toContain('neg-pnl');
  });

  test('row-scope threshold rule styles every cell of matching rows', async ({ page }) => {
    const res = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      const row = { symbol: 'TSLA', qty: 900, pnl: 95 };
      return {
        symbolCell: rules.evaluateCell({ row, rowId: 'TSLA', colId: 'symbol', theme: 'dark' }),
        small: rules.evaluateCell({ row: { qty: 80 }, rowId: 'AMZN', colId: 'symbol', theme: 'dark' }),
      };
    });
    expect(res.symbolCell.matched).toContain('big-qty');
    expect(res.symbolCell.style.fontWeight).toBe('bold');
    expect(res.symbolCell.style.backgroundColor).toBe('#3a3320');
    expect(res.small.matched).not.toContain('big-qty');
  });

  test('rule:neg-pnl composite fragment resolves the live rule color (21c reserve)', async ({ page }) => {
    const info = await page.evaluate(() => {
      const def = (window.__cgrid as any).columnDefsMap.get('summary');
      const program = def?._compositeProgram;
      const rules = (window as any).__cgridRules;
      const resolve = (row: Record<string, unknown>, rowId: string) => {
        const ctx = {
          value: null, row, colId: 'summary',
          resolveRuleRef: (id: string) =>
            rules.resolveRuleRef(id, { row, rowId, colId: 'summary', theme: 'dark' }),
        };
        return program?.resolveFragments(ctx);
      };
      return {
        hasRuleRefs: program?.hasRuleRefs === true,
        negColor: resolve({ symbol: 'GOOG', pnl: -840 }, 'GOOG')?.[2]?.style?.color ?? null,
        posColor: resolve({ symbol: 'AAPL', pnl: 1250 }, 'AAPL')?.[2]?.style?.color ?? null,
      };
    });
    expect(info.hasRuleRefs).toBe(true);
    expect(info.negColor).toBe('#ef9a9a'); // dark-theme rule color, live
    expect(info.posColor).toBeNull();      // rule not matching → no color
  });

  test('tick once — flash directive reaches grid.flashCells with rule color + mode', async ({ page }) => {
    await page.evaluate(() => {
      const grid = window.__cgrid as any;
      (window as any).__flashCalls = [];
      const orig = grid.flashCells.bind(grid);
      grid.flashCells = (p: unknown) => { (window as any).__flashCalls.push(p); orig(p); };
    });
    await page.getByTestId('btn-cs-tick-once').click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__flashCalls.length))
      .toBeGreaterThan(0);
    const call = await page.evaluate(() => (window as any).__flashCalls[0]);
    expect(call).toEqual({
      rowIds: ['AAPL'], colIds: ['price'],
      color: '#16a34a', mode: 'pulse', flashDuration: 600,
    });
  });

  test('match-count readout updates after a tick', async ({ page }) => {
    // Seeded: GOOG (-840) + AMZN (-2150) → APP 2.
    await expect(page.getByTestId('match-count-neg-pnl')).toHaveText('Negative P&L · APP 2');
    // Deterministic tick flips GOOG's pnl sign → APP 1.
    await page.getByTestId('btn-cs-tick-once').click();
    await expect(page.getByTestId('match-count-neg-pnl')).toHaveText('Negative P&L · APP 1');
  });

  test('indicator rule resolves a badge for STALE rows', async ({ page }) => {
    const res = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      return {
        stale: rules.evaluateCell({ row: { status: 'STALE' }, rowId: 'AMZN', colId: null, theme: 'dark' }),
        live: rules.evaluateCell({ row: { status: 'LIVE' }, rowId: 'AAPL', colId: null, theme: 'dark' }),
        iconResolvable: (window.__cgrid as any).resolveIcon('alert-triangle') !== null,
      };
    });
    expect(res.stale.indicator).toEqual({
      iconName: 'alert-triangle', color: '#f59e0b', target: 'row-start', position: 'before',
    });
    expect(res.live.indicator).toBeNull();
    expect(res.iconResolvable).toBe(true); // Lucide bundle loaded via format bridge
  });
});
```

- [ ] **Step 7: Create `apps/cgrid-showcase/e2e/alerts.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 21e / Task 16 — Alerts feature. The alert log is real DOM
// (the host-side channel surface), so these specs assert DOM directly.

const logEntries = (ruleId?: string): string =>
  ruleId
    ? `[data-testid="alert-log"] .alert-entry[data-rule-id="${ruleId}"]`
    : '[data-testid="alert-log"] .alert-entry';

test.describe('alerts (rules)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeature(page, 'alerts');
  });

  test('a tick produces a warning log entry with severity chip + templated message', async ({ page }) => {
    await page.getByTestId('btn-al-tick-once').click();
    const entry = page.locator(logEntries('price-move')).first();
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('data-severity', 'warning');
    await expect(entry).toContainText('WARNING');
    await expect(entry).toContainText('Price move ≥ 1%: AAPL price');
  });

  test('a burst of rapid ticks is debounced to a single entry per (rule, row)', async ({ page }) => {
    await page.getByTestId('btn-al-burst').click();
    // First MSFT move alerts immediately; the other four fall inside
    // the 1.5s debounce window for (price-move, MSFT).
    await expect(page.locator(logEntries('price-move'))).toHaveCount(1);
    await page.waitForTimeout(500); // debounce window still open
    await expect(page.locator(logEntries('price-move'))).toHaveCount(1);
  });

  test('paused evaluation mode stops new entries', async ({ page }) => {
    await page.getByTestId('sel-alert-mode').selectOption('paused');
    await page.getByTestId('btn-al-tick-once').click();
    await page.waitForTimeout(500);
    await expect(page.locator(logEntries())).toHaveCount(0);
    // Back to realtime — alerts flow again.
    await page.getByTestId('sel-alert-mode').selectOption('realtime');
    await page.getByTestId('btn-al-tick-once').click();
    await expect(page.locator(logEntries('price-move'))).toHaveCount(1);
  });

  test('adding a row fires the rowChange info alert', async ({ page }) => {
    await page.getByTestId('btn-al-add').click();
    const entry = page.locator(logEntries('row-added')).first();
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('data-severity', 'info');
    await expect(entry).toContainText('POS1 joined the blotter');
  });

  test('unread badge counts alerts and clears on mark-all-read', async ({ page }) => {
    await expect(page.getByTestId('alert-unread')).toHaveText('Unread: 0');
    await page.getByTestId('btn-al-tick-once').click();
    await expect(page.getByTestId('alert-unread')).toHaveText('Unread: 1');
    await page.getByTestId('btn-alert-read').click();
    await expect(page.getByTestId('alert-unread')).toHaveText('Unread: 0');
  });
});
```

- [ ] **Step 8: Run the E2E suite**

The playwright config (`baseURL: http://localhost:5185`) has no `webServer` block — start vite first, exactly as prior cycles did:

```bash
cd /Users/develop/wfh/canvasgrid
npm --workspace cgrid-showcase run dev &   # vite on :5185
sleep 3
npm --workspace cgrid-showcase run test:e2e 2>&1 | tail -10
```

Expected: **121 passed** (109 baseline + 7 conditionalStyling + 5 alerts). If a flash/debounce test flakes on timing, prefer `expect.poll` over raw waits and re-run before touching product code (systematic-debugging: understand before fixing).

- [ ] **Step 9: Typecheck the app**

```bash
npm --workspace cgrid-showcase run typecheck
```

Expected: clean.

- [ ] **Step 10: Commit (sources + specs ONLY — no emitted `.js`, no stragglers)**

```bash
cd /Users/develop/wfh/canvasgrid
git add apps/cgrid-showcase/src/features/conditionalStyling.ts \
        apps/cgrid-showcase/src/features/alerts.ts \
        apps/cgrid-showcase/src/features/index.ts \
        apps/cgrid-showcase/package.json \
        apps/cgrid-showcase/e2e/conditionalStyling.spec.ts \
        apps/cgrid-showcase/e2e/alerts.spec.ts \
        package-lock.json
git commit -m "$(cat <<'COMMIT_EOF'
feat(showcase): cycle 21e task 16 — conditional styling + alerts demos and E2E

- conditionalStyling.ts: ticking equity blotter with 4 rules —
  theme-aware neg-pnl color, row-scope big-qty threshold, diff-aware
  up-tick flash (pulse, activeDurationMs), stale-row indicator badge —
  plus a composite Summary column whose fragment color 'rule:neg-pnl'
  resolves the Cycle 21c reserve live, and match-count chips fed by
  engine.matchCount. Deterministic tick-once for the E2E.
- alerts.ts: one alert rule per trigger kind (relativeChange 1% with
  1.5s debounce, restricted dataChange deep-loss, rowChange add),
  onAlert-fed severity-chip log, unread badge (unreadCount /
  markAllRead), evaluationMode select. Channel routing stays host-side.
- e2e: 7 conditionalStyling + 5 alerts specs → showcase 109 → 121.
  Rule assertions probe window.__cgridRules / resolved composite
  program (canvas paint isn't DOM); flash proven via recorded
  grid.flashCells params; alert log asserted as real DOM.
- Sources are .ts (index.html → main.ts); emitted .js stragglers
  intentionally NOT committed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
COMMIT_EOF
)"
```

---

### Task 17: README + final verification gates + PR

**Files:**
- Create: `packages/rules/README.md`
- Modify: `packages/rules/package.json` — ONLY IF a real build step became necessary during the cycle. It should NOT have: the package ships as TS source (`main`/`exports` → `./src/index.ts`), exactly like `@wellsfargo-starui/velocity-grid-format`, and its `build` script stays the no-op echo. Leave untouched.
- Modify: `.superpowers/sdd/progress.md` (cycle ledger)

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: package docs + pushed branch `cycle21e/rules` + open GitHub PR.

- [ ] **Step 1: Write `packages/rules/README.md`**

```markdown
# `@wellsfargo-starui/velocity-grid-rules`

Rule engine for the cgrid monorepo — conditional styling, indicator
badges, flash-on-change, live match counts, and the alerts core.

- **Style rules** — theme-aware `{ base, light, dark }` style slices,
  per-rule flash config, per-rule value formatter, `activeDurationMs`
  auto-expire, cell or row scope.
- **Indicator rules** — Lucide badge per matching cell/row
  (`cell` / `row-start` / `row-end`).
- **Alerts** — three trigger kinds (`dataChange`, `relativeChange`,
  `rowChange`), four severities, message templating, per-rule debounce
  + global token bucket, bounded history with unread count.

**Status:** Cycle 21e — everything above shipped, including the kernel
bridge and the `rule:<ruleId>` resolver that `@wellsfargo-starui/velocity-grid-format` reserved
in Cycle 21c. Aggregate / `PREV()` rule conditions stay reserved
(`not-yet-implemented`) until `@wellsfargo-starui/velocity-grid-calc` (Cycle 21d). Full spec:
`docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md`.

## Quickstart

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';

const grid = new VelocityGrid(host, { /* ... */ });
wireFormat(grid);   // optional — needed for per-rule valueFormatter
                    // strings and rule:<id> composite fragments
const { rules, alerts } = wireRules(grid, {
  rules: [{
    kind: 'style', id: 'neg', name: 'Negative', enabled: true, priority: 10,
    condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
    style: { light: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
    flash: { enabled: true, target: 'cell', mode: 'fade', color: '#c62828', durationMs: 800 },
  }],
  alertRules: [{
    id: 'move', name: 'Price move', enabled: true, priority: 1, severity: 'warning',
    trigger: { kind: 'relativeChange', columnId: 'price', mode: 'PERCENT_CHANGE', threshold: 5, direction: 'both' },
    message: '{rule}: {rowId} {prev} → {value}', channels: ['toast'],
  }],
});

alerts.onAlert((a) => showToast(a));   // channel ROUTING is yours
rules.matchCount('neg');               // live "APP N" count
```

`wireIntoKernel` is idempotent — re-calling on a wired grid returns the
SAME `{ rules, alerts }` object. Wire BEFORE issuing ColDefs that use
`rule:<id>` fragments so paint-time resolution is live from first frame.

## Rule shapes cheat sheet

| Field | On | Meaning |
|---|---|---|
| `id` / `name` / `enabled` / `priority` | all rules | Lower priority applies first; later rules override per-property |
| `condition` | all rules | Boolean expression — `[col]`, `[col.old]`, `[col.new]` |
| `scope` | style/indicator | `{ kind: 'cell', columnIds: [...] }` or `{ kind: 'row' }` |
| `style` | `kind: 'style'` | `{ base?, light?, dark? }` — slices merge per-property over `base` |
| `flash` | `kind: 'style'` | `{ enabled, target, mode: 'fade'\|'pulse'\|'glow', color, durationMs }` |
| `indicator` | style + indicator | `{ iconName, color, target: 'cell'\|'row-start'\|'row-end', position }` |
| `valueFormatter` | `kind: 'style'` | Format-DSL string; matching cells render through it |
| `activeDurationMs` | `kind: 'style'` | Match auto-expires this long after a false→true activation |
| `trigger` | alert rules | `dataChange` / `relativeChange` / `rowChange` (see below) |
| `severity` / `message` / `channels` / `debounceMs` | alert rules | Severity chip, template, requested channels, per-(rule,row) debounce |

Alert triggers:

| Kind | Shape | Fires |
|---|---|---|
| `dataChange` | `{ expression, columnIds? }` | Expression true on post-change row; restricted form fires per changed cell in `columnIds` |
| `relativeChange` | `{ columnId, mode: PERCENT_CHANGE\|ABSOLUTE_CHANGE\|ANY_CHANGE, threshold, direction }` | Numeric old→new move crossing the threshold in `direction` |
| `rowChange` | `{ mode: ROW_ADDED\|ROW_REMOVED }` | Per added/removed row |

## Condition language

Conditions are `@wellsfargo-starui/velocity-grid-expression` predicates. `[price.old]` /
`[price.new]` are diff-aware: `.old` resolves against the tick-scoped
diff map (populated from change records, cleared after the repaint);
`.new` is the current row value. Quiescent cells read `[col.old]` as
`null`, so the canonical "went up this tick" is:

```
[price.old] != null AND [price] > [price.old]
```

Truthiness is **strict boolean** — a rule matches only when the
compiled condition evaluates `=== true`. `SUM(...)` / `PREV(...)`
inside a condition surfaces `@wellsfargo-starui/velocity-grid-expression`'s `not-yet-implemented`
error (→ Cycle 21d).

## Precedence

Rules sort by `priority` ascending (stable). Each matching rule's
theme-resolved `StyleSlice` merges per-property over the accumulated
patch — later (higher-priority-number) rules win conflicts. Last
matching indicator wins; last matching `valueFormatter` wins. Against
the kernel style stack the folded patch applies AFTER
cellClass/cellClassRules variants and BEFORE function-form `cellStyle`:

```
theme defaults → totals lift → static cellStyle → cellClassRules
  → ★ rule patch ★ → function-form cellStyle → textTransform
```

## Alerts pipeline

```
RowChangeSet → trigger evaluation → per-(rule,row) debounce
  → global token bucket (maxNotificationsPerSecond)
  → channel enablement → AlertEvent → onAlert subscribers + history ring
```

`evaluationMode`: `realtime` (immediate) / `throttled` (coalesced,
flushed post-repaint by the bridge) / `paused` (no-op). History is a
bounded ring (`historyLimit`, default 200) with `unreadCount()` /
`markAllRead()`. `AlertEvent.seq` is a monotonic counter — engines are
Date-free; hosts stamp wall-clock on receipt.

**What stays in the host:** channel ROUTING. cgrid emits `AlertEvent`
with the rule's requested `channels`; it never renders a toast, badge,
or OpenFin notification.

## Public API

```ts
export class RuleEngine   // setRules/getRules, evaluateCell, matchCount,
                          // resolveRuleRef, recount, applyChanges, endTick,
                          // onExpire, watchedColIds, evalErrorCount
export class AlertsEngine // setRules/getRules, get/setSettings, applyChanges,
                          // onAlert, getHistory, unreadCount, markAllRead,
                          // flushThrottled, droppedCount
export function wireIntoKernel(grid, opts?): { rules, alerts };
export function compileCondition(condition, ruleId, schema?);
export function validateRule(rule, schema?): RuleValidationError[];
export function renderMessage(template, ctx): string;
export const DEFAULT_ALERTS_SETTINGS;

export type ThemeKind, StyleSlice, ThemeAwareStyle, FlashConfig,
  RuleIndicator, RuleScope, RuleBase, ConditionalStyleRule,
  IndicatorRule, StyleRule, AlertSeverity, AlertChannel, AlertTrigger,
  AlertRule, AlertEvent, AlertsSettings, RuleEvalContext, RuleCellResult,
  RuleValidationError, SetRulesResult, ChangeRecord, RowChangeSet,
  FlashDirective, WireRulesOptions, Unsubscribe;
```

## Error surfaces

`setRules` never throws: invalid rules are skipped (treated as
non-matching) and reported via `SetRulesResult.errors`.
`RuleValidationError.code` is one of:

- `parse` — condition failed `expression.parse` (carries `loc`)
- `unknown-fn` / `arity` — expression compile rejections
- `not-yet-implemented` — aggregate/`PREV()` condition (→ Cycle 21d)
- `bad-shape` — structural rule validation failure
- `format-compile` — the rule's `valueFormatter` failed `compileFormat`

Runtime `EvalError`s never break paint — the rule is non-matching for
that cell and `evalErrorCount(ruleId)` increments.

## What's not in this cycle

- Aggregate / `PREV()` rule conditions — Cycle 21d (`@wellsfargo-starui/velocity-grid-calc`).
- Rule/alert editor panels — Cycle 21i (`@wellsfargo-starui/velocity-grid-customizer`).
- Plus/minus nudge rules — keyboard-edit cycle (`@wellsfargo-starui/velocity-grid-edit`).
- Worker-side rule evaluation / typed-array style channel — Cycle 20.
- Excel export of resolved rule styles — Cycle 21h (`@wellsfargo-starui/velocity-grid-export`).
```

- [ ] **Step 2: Commit the README**

```bash
cd /Users/develop/wfh/canvasgrid
git add packages/rules/README.md
git commit -m "$(cat <<'COMMIT_EOF'
docs(rules): cycle 21e task 17 — README with quickstart + rule cheat sheets

- packages/rules/README.md: quickstart (wire order incl. format for
  rule:<id> fragments), rule/trigger shape tables, condition language
  ([col.old]/[col.new], strict boolean, 21d aggregate reserve),
  precedence + kernel fold position, alerts pipeline diagram,
  host-owns-channel-routing note, public API, RuleValidationError
  codes, cycle reserves.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
COMMIT_EOF
)"
```

- [ ] **Step 3: Full typecheck across workspaces**

```bash
npx turbo typecheck 2>&1 | tail -5
```

Expected: `Tasks: 21 successful, 21 total`.

- [ ] **Step 4: Full lint (incl. vocabulary rule)**

```bash
npx turbo lint 2>&1 | tail -5
```

Expected: clean. The repo `no-restricted-syntax` vocabulary rule (no `columnId`/`rowKey`/`columnKey` singular identifiers) must pass over `packages/rules/**` and both new showcase features — the only sanctioned `columnId`(s) appearances are the `RuleScope.columnIds` / `AlertTrigger.columnIds` / `relativeChange.columnId` public field names fixed by the spec.

- [ ] **Step 5: Full build**

```bash
npx turbo build 2>&1 | tail -5
```

Expected: `Tasks: 13 successful, 13 total` (rules' build stays the scaffold no-op echo — package.json untouched).

- [ ] **Step 6: Unit suites — all four packages**

```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -3
npm --workspace @wellsfargo-starui/velocity-grid-format run test 2>&1 | tail -3
npm --workspace @wellsfargo-starui/velocity-grid-expression run test 2>&1 | tail -3
npm --workspace @wellsfargo-starui/velocity-grid-rules run test:coverage 2>&1 | tail -25
```

Expected:
- kernel: **baseline 2399 + N new, all PASS** (N = Phase E additions from Tasks 10–14; record the exact total in the ledger).
- format: **158 baseline + Task 9 additions, all PASS** (the 21c reserve test updated, not deleted).
- expression: **185/185** — untouched. Prove it structurally:

```bash
git diff main --stat -- packages/expression
```

Expected: empty output.
- rules: full suite PASS with coverage text summary showing every `src/**` module exercised (no 0% module; `src/index.ts` excluded by vitest config).

- [ ] **Step 7: Showcase E2E**

```bash
npm --workspace cgrid-showcase run dev &   # vite on :5185
sleep 3
npm --workspace cgrid-showcase run test:e2e 2>&1 | tail -5
```

Expected: **121 passed** (109 baseline + 12 new). Positions app untouched this cycle — its 262 suite is not re-run unless its workspace diff is non-empty (`git diff main --stat -- apps/cgrid-positions` → empty).

- [ ] **Step 8: Kernel dist size vs baseline**

```bash
npx turbo build --filter=@wellsfargo-starui/velocity-grid 2>&1 | tail -3
du -k packages/kernel/dist/velocity-grid.js
```

Expected: ≤ **777 KB** (Cycle 21a baseline 760.90 KB + 2% = 776.1 KB; `du -k` rounds to KiB blocks). If over: the rule slot/fold/flash additions should be a few KB — investigate before shipping.

- [ ] **Step 9: Boundary grep proofs**

```bash
grep -r "@wellsfargo-starui/velocity-grid-rules" packages/kernel/dist/ ; echo "exit=$?"
grep -rn "from '@wellsfargo-starui/velocity-grid'" packages/rules/src/ ; echo "exit=$?"
```

Expected: both greps print nothing, `exit=1` — kernel dist has zero rules imports (devDependency is type-only) and rules' src reaches kernel only structurally through the bridge surface.

- [ ] **Step 10: Working tree audit**

```bash
git status
git diff main --stat | tail -25
```

Expected: clean modulo the known pre-existing untracked stragglers (`apps/cgrid-positions/src/*.js`, `apps/cgrid-showcase/src/**/*.js` emit artifacts, `packages/expression/coverage/`). No `packages/expression` diffs; no root config diffs (`package.json` deps only via workspace lockfile, `turbo.json`/`tsconfig.base.json`/`eslint.config.mjs` untouched).

- [ ] **Step 11: Update `.superpowers/sdd/progress.md`**

Append task-completion lines for Tasks 15–17 to the Cycle 21e ledger (matching the 21c format), recording the exact kernel/format/rules test totals and the E2E `121`. Commit:

```bash
git add .superpowers/sdd/progress.md
git commit -m "chore(sdd): cycle 21e progress ledger update"
```

- [ ] **Step 12: Push branch + open PR**

```bash
git push -u origin cycle21e/rules
gh pr create --title "cycle 21e — @wellsfargo-starui/velocity-grid-rules conditional styling + alerts core + kernel bridge" --body "$(cat <<'PR_EOF'
## Summary

Cycle 21e ships `@wellsfargo-starui/velocity-grid-rules` — condition-driven conditional styling and the alerts core — plus the surgical kernel bridge and the `rule:<ruleId>` resolver that `@wellsfargo-starui/velocity-grid-format` reserved in Cycle 21c.

**Rule engine:**
- `ConditionalStyleRule` / `IndicatorRule` with theme-aware `{ base, light, dark }` style slices, CSS-cascade precedence (priority asc, later overrides per-property), cell/row scope.
- Diff-aware conditions — `[col.old]` / `[col.new]` via post-parse AST rewrite (`__cgridDiff` injection); tick-scoped diff map cleared post-repaint.
- Flash-on-activation (per-rule color + `fade`/`pulse`/`glow` + duration), indicator badges (Lucide, cell / row-start / row-end), per-rule value formatters (format-DSL), `activeDurationMs` auto-expire (min-heap, coalesced timer), live match counts (full recount + incremental).

**Alerts core:**
- Three trigger kinds (`dataChange` expression, `relativeChange` percent/absolute/any + direction, `rowChange`), four severities, `{rule}/{rowId}/{column}/{value}/{prev}` templating, per-(rule,row) debounce + global token bucket, `realtime`/`throttled`/`paused` modes, bounded history ring + unread count. Channel ROUTING stays in the host — cgrid emits `AlertEvent`, never renders a toast.

**Kernel additions (all DI-slot-gated — byte-identical behavior for apps that never wire rules):**
- Rule-engine slot (`registerRuleEngine`, structural types, zero runtime imports — mirrors `formatCompilerSlot`).
- Rule-patch fold in `applyCellProps` (after cellClassRules, before function-form `cellStyle`); rule `valueFormatter` override.
- Listener-gated `rowsChanged` event off the `rowDataById` transaction sync (old-row snapshot only when subscribed).
- `flashCells` per-call overrides (`color` / `mode` / `flashDuration` — the Cycle 4 "reserved" comment retired), indicator paint fold, `forEachRow` / `getThemeKind`.
- Format-eval memo (carried 21c perf Minor) with `hasRuleRefs` staleness bypass.

**Format plug-in:** `FormatEvalContext.resolveRuleRef` + tier-1 `RuleRefNode` resolution — `rule:<id>` composite fragments now resolve live rule colors (E2E-proven on a ticking grid).

**Bridge:** `wireIntoKernel(grid, opts?)` — engines seeded from opts, theme-threading adapter, watched-column diffing (`diffRows` over style watched sets ∪ alert relativeChange/restricted-dataChange colIds), FlashDirective → `flashCells`, coalesced post-repaint `endTick`, match-count seeding, expiry → `refresh()`. Idempotent; returns the same engines object on re-call.

**Showcase:** conditional-styling + alerts feature pages over ticking data; 12 new Playwright specs (109 → 121).

**Reserves honored:** aggregate/`PREV()` conditions → Cycle 21d; customizer panels → 21i; plus/minus nudges → edit cycle; worker style channel → Cycle 20.

## Related

- Spec: `docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-cycle-21e-rules.md`
- Predecessors: PR #93 (`@wellsfargo-starui/velocity-grid-expression`, 21b), PR #94 (`@wellsfargo-starui/velocity-grid-format`, 21c)

## Test plan

- [ ] `npm --workspace @wellsfargo-starui/velocity-grid-rules run test:coverage` — full suite + coverage, all PASS
- [ ] `npm --workspace @wellsfargo-starui/velocity-grid run test` — 2399 baseline preserved + new slot/fold/flash/event/memo tests
- [ ] `npm --workspace @wellsfargo-starui/velocity-grid-format run test` — 158 baseline + resolver-accessor tests
- [ ] `npm --workspace @wellsfargo-starui/velocity-grid-expression run test` — 185/185 (package untouched; `git diff main --stat -- packages/expression` empty)
- [ ] `npx turbo typecheck` 21/21 · `npx turbo lint` clean · `npx turbo build` 13/13
- [ ] Showcase E2E: 121/121 (109 baseline + 12 new)
- [ ] Kernel dist ≤ +2% vs 760.90 KB baseline; `grep -r "@wellsfargo-starui/velocity-grid-rules" packages/kernel/dist` → no matches
- [ ] Zero static kernel imports in `packages/rules/src` (structural bridge only)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PR_EOF
)"
```

Expected: PR opens; URL printed.

- [ ] **Step 13: Final self-review**

Walk `git diff main --stat` and confirm: no straggler `.js` emit artifacts or `coverage/` output committed; `packages/rules/package.json` unchanged since Task 1; every task landed as its own commit (reviewer can walk the branch); then return the PR URL.

