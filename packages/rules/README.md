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
    trigger: { kind: 'relativeChange', colId: 'price', mode: 'PERCENT_CHANGE', threshold: 5, direction: 'both' },
    message: '{rule}: {rowId} {prev} → {value}', channels: ['toast'],
  }],
});

alerts.onAlert((a) => showToast(a));   // channel ROUTING is yours
rules.matchCount('neg');               // live "N matches" count
```

`wireIntoKernel` is idempotent — re-calling on a wired grid returns the
SAME `{ rules, alerts }` object. Wire BEFORE issuing ColDefs that use
`rule:<id>` fragments so paint-time resolution is live from first frame.

**Wire-order caveat:** `wireIntoKernel` seeds match counts once, at
wire time, from whatever rows are in the grid at that moment
(`g.forEachRow` → `rules.recount(seed)`). If you call `setRowData()`
*after* wiring, match counts go stale — `setRowData` does not emit
`rowsChanged` by design, so the bridge has no signal to re-seed. Call
`rules.recount(rows)` yourself after any post-wire `setRowData()`:

```ts
grid.setRowData(nextRows);
rules.recount(nextRows.map((row) => ({ rowId: row.id, row })));
```

Subsequent incremental updates (transactions, edits) keep counts live
automatically via `rowsChanged` / `cellValueChanged`.

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
| `relativeChange` | `{ colId, mode: PERCENT_CHANGE\|ABSOLUTE_CHANGE\|ANY_CHANGE, threshold, direction }` | Numeric old→new move crossing the threshold in `direction` |
| `rowChange` | `{ mode: ROW_ADDED\|ROW_REMOVED }` | Per added/removed row |

Note the field-name asymmetry: `RuleScope` and the `dataChange` trigger
use plural `columnIds: string[]` (they scope over a set of columns),
while `relativeChange` uses singular `colId: string` (it watches
exactly one column). Both are the repo's mandated vocabulary — no
`columnId` singular identifiers anywhere in this package.

## Condition language

Conditions are `@wellsfargo-starui/velocity-grid-expression` predicates. There is **no infix
`AND`/`OR`** — boolean combination is the infix operators `&&` / `||`
(call-style `AND(...)`/`OR(...)` also exist as builtins). Equality is
`==`, not `=`. `[price.old]` / `[price.new]` are diff-aware:
`.old` resolves against the tick-scoped diff map (populated from
change records, cleared after the repaint); `.new` is the current row
value. Quiescent cells read `[col.old]` as `null`, so the canonical
"went up this tick" is:

```
[price.old] != null && [price] > [price.old]
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
