# 04 — alerts

> Fire notifications when grid data matches a rule. Pure logic module — UI lives in the host. Requires [expression engine](README.md#1-expression-engine).

## Purpose

Watch for events on the grid (cell value changes, row adds/removes, threshold crossings) and dispatch notifications to one or more channels — toast popups, a toolbar badge, OpenFin workspace notifications.

Example rules:
- "Toast when `[price] > 100` on the BTC row"
- "Critical alert when `[balance]` drops by more than 5% in either direction"
- "Info notification when a new row appears with `[type] = 'fill'`"

## Config schema

Three trigger families discriminated by `kind`:

```ts
type AlertTrigger =
  | { kind: 'dataChange'; expression: string; columnIds?: string[] }
  | { kind: 'relativeChange'; columnId: string; mode: 'PERCENT_CHANGE' | 'ABSOLUTE_CHANGE' | 'ANY_CHANGE'; threshold: number; direction: 'up' | 'down' | 'both' }
  | { kind: 'rowChange'; mode: 'ROW_ADDED' | 'ROW_REMOVED' };

interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  severity: 'info' | 'success' | 'warning' | 'critical';
  trigger: AlertTrigger;
  message: string;                  // template with {value}, {prev}, {rowId}, {column}
  channels: ('toast' | 'badge' | 'openfin')[];
  debounceMs?: number;              // per-rule debounce; falls back to settings.defaultDebounceMs
}

interface AlertsSettings {
  enabled: boolean;                       // global kill-switch
  defaultDebounceMs: number;
  maxNotificationsPerSecond: number;      // global token-bucket cap
  historyLimit: number;                   // max in-memory notifications
  enabledChannels: { toast, badge, openfin };
  evaluationMode: 'realtime' | 'throttled' | 'paused';
}

interface AlertsState {
  rules: AlertRule[];
  settings: AlertsSettings;
  history: AlertNotification[];           // NEVER persisted; session-only
}
```

## Runtime behavior

### Pure evaluators

Each trigger type has a corresponding pure function in `evaluator.ts`. They take a row context and return `AlertHit | null` — never throw:

```ts
function evaluateDataChangeRule(rule, rowCtx, engine): AlertHit | null { ... }
function computeRelativeChange(rule, oldValue, newValue): AlertHit | null { ... }
function detectRowChanges(rule, api): AlertHit[] { ... }
```

Hot path is branchless; one bad expression returns `null`, dispatcher skips it.

### Dispatcher (host responsibility)

The engine layer stops at evaluators. The host wires events:

```
on cellValueChanged →
  for each enabled rule of kind 'dataChange' or 'relativeChange':
    hit = evaluator(rule, ctx)
    if (hit && !debounced(rule.id)) notify(hit)

on rowDataChanged →
  for each enabled rule of kind 'rowChange':
    hits = detectRowChanges(rule, api)
    hits.forEach(notify)
```

### Throttling

Two levels:
1. **Per-rule debounce** (`rule.debounceMs`): the same rule won't fire twice within N ms for the same row.
2. **Global token bucket** (`settings.maxNotificationsPerSecond`): caps the firehose. Excess hits drop silently (or queue, depending on host policy).

### Evaluation modes

- `realtime`: evaluate on every `cellValueChanged` (default)
- `throttled`: batch evaluations per animation frame
- `paused`: stop new evaluations (rules can be edited without firing during config UI)

### Message templates

`renderMessage(rule.message, ctx)` substitutes `{value}`, `{prev}`, `{rowId}`, `{column}` placeholders at notification fire time. Cheap string replace, no Mustache/Handlebars dep.

## UI surface

None in engine. Host renders:
- Rules panel
- Rule editor (different forms per trigger kind)
- Toast container (positioned at corner of grid)
- Toolbar badge with unread count
- Notification history dropdown
- Settings dialog (channels, debounce, eval mode)

## Persistence

```ts
{
  rules: AlertRule[],
  settings: AlertsSettings,
  // history is always serialized as [] — clean slate on load
}
```

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/alerts/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/alerts/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/alerts/evaluator.ts](../../../starui/packages/shared/engine/src/customizer/modules/alerts/evaluator.ts)
- [../starui/packages/shared/engine/src/customizer/modules/alerts/transforms.ts](../../../starui/packages/shared/engine/src/customizer/modules/alerts/transforms.ts)

## Design decisions worth copying

- **Framework-free evaluators.** Pure `(rule, ctx) → hit | null` functions. No exceptions, no async, no I/O. Trivially testable.
- **Two-level throttling.** Per-rule debounce solves "same alert from same row spamming". Global token bucket solves "firehose during data burst". Need both.
- **History never persisted.** Notifications are a session artifact. Profile reload starts clean. Avoids stale unread badges on app restart.
- **Discriminated trigger union.** TypeScript can narrow `AlertRule<Extract<AlertTrigger, { kind: 'dataChange' }>>` so rule editors are type-safe per trigger kind.
- **Defensive deserialization.** Drop malformed rules silently. Severity/channels default safely. One bad rule doesn't fail the whole profile.
- **OpenFin bridge dynamic-imported.** Non-OpenFin builds don't bundle the SDK; the bridge becomes a silent no-op.

## cgrid translation

Mostly straightforward — alerts is decoupled from the grid by design:

1. **`cellValueChanged` event.** cgrid needs to emit this from the worker round-trip. Old + new values required (same gap as conditional-styling).
2. **`rowDataChanged` event.** Should already exist (calculated-columns invalidation, render dirty pass).
3. **No grid-side wiring.** Alerts evaluators are pure functions; the host calls them and routes hits. Drop in.
4. **OpenFin integration.** Out of scope for cgrid library; should live in the app shell that consumes cgrid.
