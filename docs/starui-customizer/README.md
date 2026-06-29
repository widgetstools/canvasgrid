# StarUI Customizer Engine — cgrid Core API Spec

This folder documents the customization **engine layer** — features that live in cgrid core and define the public API surface that the customizer UI addon consumes. The companion folder [../starui-customizer-ui/](../starui-customizer-ui/) documents the addon itself.

Reference implementation: starui's `packages/shared/engine/src/customizer/modules/`. Links in this doc point there using relative paths (`../starui/...`) from the cgrid workspace root.

---

## Package architecture (read first)

The customizer ships as **two packages**:

| Package | Contains | Dependencies | License |
|---|---|---|---|
| **`cgrid`** (core) | Engine layer documented here: expression engine, format-string layer, edit journal, rule evaluators, calculated columns, serialize/deserialize, config management, data access. Plus the public API surface. | Vanilla TS, zero UI framework | MIT |
| **`@cgrid/customizer`** (addon) | UI editors documented in [../starui-customizer-ui/](../starui-customizer-ui/). Consumes `cgrid` strictly through its public API. | Lit + Web Awesome + `cgrid` | TBD (can be commercial — see AG Grid Enterprise model) |

**This doc covers the `cgrid` half.** The UI half lives in a sibling folder.

### Why the split

- **Bundle hygiene** — users who just want a grid don't pay for the customizer.
- **Forcing function for API design** — if the addon can't implement a feature using only the public API, that's a signal the API has a gap. Fix the gap rather than letting the addon reach into internals. This is the discipline that kept AG Grid Community's API clean for a decade.
- **Optionality** — future UI variants (React wrapper, vanilla DOM editors, headless drivers) sit alongside `@cgrid/customizer` without touching the core.
- **Independent release cadence** — the addon can iterate on UX without forcing a core release; the core can fix grid bugs without a UI version bump.

## Public API surface (the contract)

Define cgrid's public API explicitly as a re-export module **before** any addon work begins:

```ts
// cgrid/src/api.ts — the addon contract
export { ExpressionEngine } from './core/expression';
export { formatValue, parseExcelFormat } from './core/format';
export { EditJournal } from './core/editing';
export { serializeProfile, deserializeProfile } from './core/profile';
// types
export type {
  CellPatch, EditSource, ConditionalRule, CalculatedColumnDef,
  ColumnAssignment, ValueFormatterTemplate, ProfileState,
  // ... per-module config + result types
} from './core/types';
```

**Rule: anything not exported from `api.ts` is internal.** The addon imports only from `cgrid` (which re-exports `api.ts`). If `@cgrid/customizer` needs something that isn't exported, that's a signal to extend the API — not a signal to bypass it.

Enforce mechanically:
- TypeScript `paths` restriction so deep imports don't resolve from outside the cgrid package
- ESLint `no-restricted-imports` blocking `cgrid/src/**` and `cgrid/internal/**`
- CI runs the addon against the published cgrid artifact, not against source — accidental internal-import leaks fail the build

The 15 engine module docs in this folder describe both the internal logic AND the surface they need to expose. Treat them collectively as the spec for what `api.ts` re-exports.

---

## What "customizer" means

A *runtime configuration layer* sitting on top of the base grid. End users (not developers) author rules — calculated columns, conditional styling, alerts, keyboard nudges, column groups — through UI panels. The rules are persisted to a profile (JSON), restored on load, and re-applied to the grid as state mutations.

Two consequences shape the whole architecture:

1. **Rules are data, not code.** Conditions and formulas are *string expressions* compiled by a sandbox-safe evaluator — never `new Function()`. This is what makes the profile portable across sessions and users.
2. **The grid is the substrate, not the API.** Each module mutates `columnDefs`, `gridOptions`, `cellClassRules`, or CSS — the grid is not aware of "modules." All modules can be removed and the grid still works.

For cgrid this is a near-perfect fit because cgrid already uses callback-driven seams (`valueGetter`, `cellClassRules`, `cellStyle`, registries) — exactly the surfaces these modules write to.

---

## The 15 modules

| # | Module | Purpose | File |
|---|--------|---------|------|
| 1 | **editing-core** | Foundation: cell patches, undo/redo journal, transactional writes | [01-editing-core.md](01-editing-core.md) |
| 2 | **calculated-columns** | Virtual columns whose values come from expressions over row data | [02-calculated-columns.md](02-calculated-columns.md) |
| 3 | **conditional-styling** | Expression-driven cell/row styling, flash animations, badge indicators | [03-conditional-styling.md](03-conditional-styling.md) |
| 4 | **alerts** | Fire notifications on data change events that match a rule | [04-alerts.md](04-alerts.md) |
| 5 | **column-customization** | Per-column overrides (headers, filters, styling, editors) + global baselines | [05-column-customization.md](05-column-customization.md) |
| 6 | **column-groups** | Compose flat columns into nested named groups with expand/collapse memory | [06-column-groups.md](06-column-groups.md) |
| 7 | **column-templates** | Reusable bundles of column config that chain by ID | [07-column-templates.md](07-column-templates.md) |
| 8 | **general-settings** | ~80 grid-level options surfaced through a settings panel | [08-general-settings.md](08-general-settings.md) |
| 9 | **grid-state** | Capture & restore native grid state (sort/filter/scroll/viewport) | [09-grid-state.md](09-grid-state.md) |
| 10 | **visual-excel** | Translate on-screen styling into AG-Grid's `excelStyles` for XLSX export | [10-visual-excel.md](10-visual-excel.md) |
| 11 | **data-change-history** | Audit log + undo stack consumer that decides which edit sources to record | [11-data-change-history.md](11-data-change-history.md) |
| 12 | **smart-edit** | Multi-cell numeric ops (×, ÷, +, −, =) + K/M/B suffix parsing | [12-smart-edit.md](12-smart-edit.md) |
| 13 | **bulk-update** | Set all selected cells in a column to one value, optionally from a distinct-value picker | [13-bulk-update.md](13-bulk-update.md) |
| 14 | **plus-minus** | +/− keyboard nudges with per-column expression-gated rules | [14-plus-minus.md](14-plus-minus.md) |
| 15 | **shortcuts** | Single-letter keyboard shortcuts for numeric ops, scoped by column | [15-shortcuts.md](15-shortcuts.md) |

---

## Cross-cutting infrastructure

Five pieces of plumbing every module depends on. Build these first.

### 1. Expression engine

Custom-built, vanilla TS. Lives in [../starui/packages/shared/engine/src/expression/](../../../starui/packages/shared/engine/src/expression/).

- **Tokenizer → Parser → AST → Evaluator** pipeline. Not Excel syntax — uses bracketed column refs: `[price] * [quantity] - [discount]`.
- **~50 builtins** in `functions.ts`: math (`ABS`, `ROUND`, `MIN`, `MAX`, `MOD`, `POW`, `SQRT`), stats (`AVG`, `SUM`, `COUNT`, `MEDIAN`, `STDEV`), string (`CONCAT`, `LEN`, `LEFT`, `RIGHT`, `UPPER`, `LOWER`, `SUBSTR`), logical (`IF`, `AND`, `OR`, `NOT`, `SWITCH`), date (`NOW`, `TODAY`, `YEAR`, `MONTH`, `DAY`).
- **Compile-once cache** (FIFO, max 1000) keyed by expression string. Per-cell evaluation walks the cached AST — no re-parse.
- **Diff-aware refs**: `[col.old]`, `[col.new]` for change-driven rules (conditional-styling, alerts).
- **Silent error handling**: parse + runtime errors return `null`. One bad expression never crashes the grid.
- **Sandbox-safe**: no `eval`, no `new Function`. Walks the AST with a closure context that contains only the row data.

**cgrid build note**: This is a 500–1000 LOC piece of work. Start here. Everything else builds on it.

### 2. Format-string layer

Wraps the [`ssf`](https://github.com/SheetJS/ssf) library (SheetJS Spreadsheet Format, ~40 KB, Apache-2). See [../starui/packages/shared/engine/src/colDef/adapters/excelFormatter.ts](../../../starui/packages/shared/engine/src/colDef/adapters/excelFormatter.ts).

What it gives you:
- Excel-style format strings: `#,##0.00`, `$#,##0.00;[Red]-$#,##0.00`, `0.00%`, `yyyy-mm-dd`, `[h]:mm:ss`
- Conditional sections: `positive;negative;zero;text` — auto-routes value
- Color tags: `[Red]`, `[Green]`, `[Blue]` mapped to CSS variables
- Unicode auto-quoting: stops `▲`, `▼`, `—` from breaking format parsing
- Per-format cache; invalid formats fall back to identity + one-time console warn

**Three formatter modes** all modules consume via a `ValueFormatterTemplate` discriminated union:
- `{ kind: 'preset', preset: 'currency' | 'percent' | 'date' | ... }` — design-system presets
- `{ kind: 'excelFormat', format: '#,##0.00' }` — raw ssf format string
- `{ kind: 'expression', expression: 'CONCAT(value, " ms")' }` — expression-engine derived
- `{ kind: 'tick' }` — financial tick-size formatting

### 3. Edit journal (transactional writes)

Foundational layer at [../starui/packages/shared/engine/src/customizer/modules/editing-core/](../../../starui/packages/shared/engine/src/customizer/modules/editing-core/). All editing modules (smart-edit, bulk-update, plus-minus, shortcuts) generate `CellPatch[]` and feed them through the journal.

```ts
interface CellPatch {
  rowId: string;
  colId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}
```

Why this matters: undo/redo, audit trail, validation, and batch transactions all hang off this one shape. **Build this before any editing feature.**

Key behaviors:
- Dual-stack undo/redo (`past[]`, `future[]`); recording clears redo
- Cascade undo: `undoEntry(id)` undoes that entry AND everything after
- Monitor list (bounded audit log) separate from undo stack
- Validator composition: chain multiple validators with fail-fast on `invalid`
- Patches are aggregated into row-shaped objects for `applyTransactionAsync`-style batch writes

### 4. Profile / persistence system

Out of scope for these docs — but assumed by every module. Every module exports a `state.ts` with:
- Type definitions
- `INITIAL_<MODULE>` defaults
- `deserialize<Module>State()` defensive loader (drops malformed entries, fills missing fields, migrates schema versions)
- `<MODULE>_MODULE_ID` and `<MODULE>_SCHEMA_VERSION` constants

The host (MarketsGrid) wires modules into a Redux-like profile store. Each module's slice is independent; profile = bundle of slices keyed by module ID.

### 5. CSS injection helper

A `CssHandle` abstraction that lets modules inject scoped CSS rules with stable handles for later removal/update. Used heavily by conditional-styling, column-customization, and column-groups.

ColIds are encoded to CSS-safe form (`a.b.c` → `a_2eb_2ec`) via `cssEscapeColId()`. Shared utility, lives in column-customization.

---

## cgrid translation playbook

How each AG-Grid extension point used by starui maps onto cgrid's existing seams.

| AG-Grid surface | cgrid equivalent | Notes |
|---|---|---|
| `colDef.valueGetter` | `colDef.valueGetter` | Direct equivalent. Used by calculated-columns. |
| `colDef.valueFormatter` | `colDef.valueFormatter` | Direct equivalent. Used everywhere. |
| `colDef.cellClassRules` | Likely needs adding to cgrid | Per-cell class predicates by class name. Conditional-styling depends on it. |
| `colDef.cellStyle` (function) | Already supported | Per-cell style function. |
| `colDef.cellRenderer` (string registry) | `cellRendererRegistry` | Already present in cgrid. |
| `colDef.cellEditor` (string registry) | `cellEditorRegistry` | Already present. Column-customization needs editor-by-name lookup. |
| `colDef.filter` + `filterParams` | `filters/` system in cgrid | Column-customization maps user choices to filter configs. |
| `colDef.aggFunc` (string or function) | `aggFuncs` option | Calculated-columns passes user aggregation expressions through worker. |
| `colDef.suppressKeyboardEvent` | Needs hook in cgrid | plus-minus and shortcuts wrap this to suppress inline edit on hot keys. |
| `gridApi.applyTransactionAsync` | Worker-backed row update path | Edit journal writes go through this. |
| `gridApi.getState` / `setState` | grid-state capture/restore | cgrid needs equivalent serialization. |
| `cellValueChanged` event | Worker `rowsChanged` callback | Conditional-styling and alerts subscribe for diff-aware refs. |
| `columnGroupOpened` event | Header click handler | Column-groups tracks runtime expand state. |
| `excelStyles` config | Worker XLSX writer registry | visual-excel emits ExcelStyle[] for export pipeline. Already partly built. |

**Gaps cgrid will need to fill:**
1. `cellClassRules`-equivalent: a way to register class predicates by name and re-evaluate per cell. Conditional-styling is the biggest consumer.
2. `suppressKeyboardEvent`-equivalent: per-column key suppression so editing modules can claim keys before they trigger edit.
3. `rowClassRules`-equivalent: same but for whole rows. Conditional-styling row-scope rules need this.
4. Header CSS injection seam: starui paints header styles by injecting CSS classes onto `.ag-header-cell` elements. cgrid renders headers on canvas, so the equivalent is a header-cell style hook in the renderer.
5. **The big one** — diff/old/new value tracking. AG Grid emits `cellValueChanged` with old & new. cgrid's worker needs to surface the same diff so conditional rules and alerts can reference `[col.old]` / `[col.new]`.

---

## Architectural patterns shared across all modules

These show up over and over. Adopt them wholesale.

1. **Module shape**: each module is a folder with `state.ts` (types + initial state + deserializer), `transforms.ts` (grid integration), plus 0–N feature-specific files (evaluators, builders, helpers). No React/framework imports in the engine layer.

2. **Pure evaluators**: `evaluator.ts` / `resolveX.ts` / `buildY.ts` are stateless pure functions. No exceptions thrown — return `null` / `false` / no-op on failure.

3. **Compile-once, evaluate-many**: every expression-driven module parses once at module init and closes over the AST. Per-cell calls are cheap.

4. **Silent error handling**: a malformed rule must never crash the grid. Drop it, log a one-time warning, keep rendering.

5. **Defensive deserialization**: every `deserialize<Module>State()` merges partial input over defaults, drops unrecognized entries, migrates schema versions, and never throws on bad input.

6. **Memoization on transform output**: `applyAssignments()` and similar cache colDef arrays by signature. Prevents the grid's diff pipeline from firing on no-op re-renders.

7. **Theme-aware styling**: every visual override carries both `light` and `dark` slices. The transform picks the active slice at render time.

8. **Runtime state separate from config**: config persists; ephemeral state (timed-rule activations, viewport scroll, undo stack, alert history) lives in-memory and resets on profile load.

---

## Suggested build order for cgrid

Don't build these in module-number order. Build by dependency.

**Phase 0 — Foundation (no dependencies):**
- Expression engine (tokenizer + parser + evaluator + 50 builtins + compile cache)
- Format-string layer (ssf wrapper + ValueFormatterTemplate union)
- Edit journal (CellPatch + undo/redo stacks + transactional writer)
- CSS injection helper + colId encoding
- Profile/persistence wiring (per-module slice pattern)

**Phase 1 — Cheapest visible wins:**
- `general-settings` — surfaces existing cgrid options through a panel. No new runtime behavior.
- `grid-state` — serialize/deserialize what cgrid already tracks (column order, sort, filter, scroll).
- `column-customization` — per-column header/filter/editor overrides. Largest API surface; most user-visible.

**Phase 2 — Expression-driven (after Phase 0):**
- `calculated-columns` — single new column type backed by `valueGetter`. Showcases the expression engine.
- `conditional-styling` — needs `cellClassRules` / `rowClassRules` equivalent in cgrid (gap to close).
- `alerts` — pure evaluator. Notification routing is host-side.

**Phase 3 — Editing (after edit journal):**
- `smart-edit` — toolbar ops on numeric cells. Reuses expression engine for magnitude parsing.
- `bulk-update` — single-value bulk set with distinct-value picker.
- `plus-minus` — keyboard nudges + per-column expression-gated rules.
- `shortcuts` — letter-key bindings for numeric ops.
- `data-change-history` — settings-only consumer of the edit journal.

**Phase 4 — Composition / structure:**
- `column-templates` — reusable column-config bundles.
- `column-groups` — nested header tree with expand/collapse.

**Phase 5 — Export:**
- `visual-excel` — depends on column-customization and conditional-styling being in place. Wires their rules into the XLSX writer.

---

## What's NOT included

A few things StarUI has that aren't in the customizer modules:
- The **UI panels themselves** (React components for rule editors, settings panes, formatter toolbars). They live in a separate package — we'll need to build cgrid's equivalents from scratch in whatever UI framework the showcase chooses.
- **OpenFin bridges** (workspace notification routing, multi-window sync) — host-specific.
- **AG-Grid bug workarounds** that don't apply to cgrid (e.g., the `streamSafeMultiColumnFilter` synthetic kind exists to work around AG-Grid v35.1 set-filter validation crashes — irrelevant for cgrid).
