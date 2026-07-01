# Cycle 21c — `@cgrid/format` (Unified Formatting DSL) — Design

**Status:** Draft — pending user review before writing implementation plan.
**Date:** 2026-07-01
**Predecessor:** [Cycle 21b `@cgrid/expression`](../plans/2026-07-01-cycle-21b-expression.md) (merged as PR #93)
**Parent brief:** [Cycle 21 modular monorepo + intrinsic features](../plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) §3.2, §4.3, §5, §7
**Successor cycles unblocked:** 21d (`@cgrid/calc`), 21e (`@cgrid/rules`), 21f (`@cgrid/renderers`), 21h (`@cgrid/export`), 21i (`@cgrid/customizer`)

---

## §1 Scope & non-goals

### 1.1 In scope — everything the parent brief specifies

Cycle 21c ships **all three DSL tiers** and **the kernel bridge** in a single landing. Non-deferral per the durable project principle: every feature the parent brief enumerates for `@cgrid/format` lands here. If a cycle looks large, we decompose into more tasks (~20 vs 21b's 5) — we do not push features to a follow-up cycle.

**`@cgrid/format` package:**

- **Tier 0 — pure Excel format codes.** Digit placeholders (`0`, `#`, `?`), decimal/group separators, `%`, quoted literals, escape sequences, section separator `;` (up to 4: positive/negative/zero/text), Excel named colors `[Red]`/`[Green]`/etc., Excel conditions `[>1000]`, Excel locale tags `[$-409]` (parsed as Intl hints), date/time tokens (`yyyy`, `mmm`, `dd`, `hh`, `AM/PM`).
- **Tier 1 — Tier 0 + expression brackets + icon references.** New bracket kinds: `[color=<expr>]`, `[bg=<expr>]`, `[weight=<expr>]`, `[style=<expr>]`, `[if <expr>]`, `{icon:<name>}`, `{icon:<name>|<expr>}` (dynamic name).
- **Tier 2 — composite ColDef.** New ColDef shape `type: 'composite'` + `fragments[]` array; each fragment carries text or expr + per-fragment `format` + per-fragment `style`.
- **Formatter template registry.** 9 built-in Intl-backed templates (Number, Currency, Percent, Date, Time, DateTime, RelativeTime, Abbreviated, Custom) + `registerFormatterTemplate` extension point.
- **Style resolution.** Per-row eval of Tier 1 bracket expressions produces `StyleObj` for `cellStyle` + `IconRef` for `cellIcon`. Uses `@cgrid/expression` for interior parse + eval.
- **Fragment resolution.** Per-row eval of composite fragments produces `ResolvedFragment[]` used by paint, tooltip, clipboard.
- **`wireIntoKernel(grid)` bridge.** Idempotent side-effect module that registers the format compiler into kernel's injection slot, registers the Lucide icon bundle, and auto-registers per-composite-column tooltip providers.

**`@cgrid/kernel` bridge (surgical additions):**

- **`valueFormatter` type broadening** — `string | ((params) => string)`. Backwards-compatible; existing function form works unchanged.
- **New ColDef fields** — `cellIcon`, `type: 'composite'`, `fragments`, `cellBackground`, `align`, `overflow`.
- **Format compiler injection slot** — `grid.registerFormatCompiler(fn)` / `getFormatCompiler()`; kernel never imports `@cgrid/format`; the DI slot uses structural type aliases.
- **ColDef-resolve step** — `compileFormatSlots` pass in `core/propertyChain.ts` derives `valueFormatter` fn, `cellStyle` fn (merged with any user-supplied `cellStyle`), and `cellIcon` fn from the format string / composite shape.
- **Icon registry** — `grid.registerIconSet(name, paths)` / `grid.resolveIcon(name)` backed by a Path2D map. Bundled `lucide.generated.ts` (all ~1500 icons as SVG path strings, lazy-`new Path2D` on first access). Kernel does not auto-register; format's bridge does.
- **Composite cell renderer** — new painter at `packages/kernel/src/renderer/cellRenderers/composite.ts`; layout pass measures fragments + handles ellipsis + alignment; draw pass renders per-fragment style + inline icons.
- **Tooltip provider hook** — `grid.registerTooltipProvider(colId, fn)` / `unregister`; feature-chain entry with debounced hover; rich payload `{ plain: string } | { html: string }`.
- **Multi-format clipboard** — extend copy path to write `ClipboardItem` with `text/plain` + `text/html` when the copied range contains composite cells; feature-detect fallback to `writeText`.
- **Paint integration for `cellIcon`** — byRows painter renders icons left of text with kerning; icons participate in text metrics.

### 1.2 Non-goals (explicit out-of-scope)

Called out so scope creep during implementation gets caught early:

- **Multi-line composite cells.** Row heights stay uniform; composite is single-line only. Locked by parent brief §5 DSL decision 1.
- **Composite cell editing.** Composite is a derived view. F2/dblclick on composite is a no-op. Users edit source columns directly. Locked by §5 DSL decision 4.
- **Rule reference resolution.** `rule:<ruleId>` inside a style expression is an honest structural reserve — parsed, `RuleRefNode` emitted, resolver returns `null`. `@cgrid/rules` (Cycle 21e) plugs the resolver. Mirrors 21b's `AggregateNode` pattern.
- **Aggregate-driven format strings.** `[color=[if [price] > AVG([price]) then "#0a7" else "#d33"]]` — the `AVG([price])` interior gets rejected at `expression.compile` with `not-yet-implemented` (already handled by 21b). Ships when `@cgrid/calc` (Cycle 21d) lands.
- **Server-side format evaluation.** Format runs on whatever thread the caller invokes it on. Parent brief §7 worker-only-evaluation is a *deployment policy* for downstream consumers (rules/calc/renderers deploy format to the worker); the package itself is thread-agnostic. Same posture as 21b.
- **Customizer editor UX for format strings.** Autocomplete, syntax highlighting, live preview belong to `@cgrid/customizer` (Cycle 21i). Format exposes `compileFormat` + `CompileFormatError` with `loc` info; customizer builds the UI on top.
- **Format-string round-trip / prettify.** No `formatToString(program)` inverse; compilation is one-way (parse-only). Editors save the source string, not the `FormatProgram`.
- **Alternate icon libraries beyond Lucide + Phosphor stub.** Bundle Lucide by default; expose `registerIconSet(name, paths)` for Phosphor or others. No bundled Phosphor — users opt in.
- **Runtime locale switching.** `compileFormat(source, { locale, currency })` locks locale at compile time. Runtime locale changes require re-resolving affected ColDefs. Add a `grid.setLocale(locale)` shortcut in a follow-up cycle if a real consumer needs it.
- **CSS-in-JS style output.** `StyleObj` uses simple string fields (color/background as CSS-format strings). No CSSVar interpolation, no theme-token indirection. Theme integration lands with `@cgrid/renderers` (Cycle 21f) design tokens.
- **Format performance benchmarks against 8ms/frame at 50k rows.** Deferred until Cycle 20 (excel-pivot) or Cycle 21f (renderers) actually exercises the hot path at scale. Format aims for correctness + reasonable per-cell allocation in 21c.

---

## §2 Architecture

### 2.1 Dependency-graph position

From parent brief §3.2:

```
kernel        (no cgrid deps)
expression    (no cgrid deps)
format        → expression                    ← this cycle
```

Kernel does **not** gain a `@cgrid/format` dep. Instead:

- Format declares `peerDependencies: { "@cgrid/kernel": "*" }`. The kernel bridge module (`src/bridge.ts`) imports kernel types + calls kernel APIs.
- Kernel exposes a **format-compiler injection slot** (`src/core/formatCompilerSlot.ts`) using structural type aliases — no import from format required.
- Format's `wireIntoKernel(grid)` calls kernel's `grid.registerFormatCompiler(compileFormat)` at grid-setup time.

This keeps the dep graph acyclic and lets consumers who don't use format ship without importing it (kernel-only apps are unaffected). ESLint `no-restricted-imports` rule enforces the boundary at CI time.

### 2.2 `@cgrid/format` source layout

```
packages/format/
├── src/
│   ├── types.ts                       — public types (FormatProgram, StyleObj, IconRef, Fragment, CompositeColDef, CompileFormatError, ...)
│   ├── tokenizer.ts                   — outer format-string tokenizer (Excel codes + semi-colon sections + Tier-1 brackets + {icon:} tokens)
│   ├── excel/
│   │   ├── parser.ts                  — Tier 0 parser (digit placeholders, sections, named colors, conditions, locale tags)
│   │   ├── evaluator.ts               — applies parsed Excel format to a number / date / string value
│   │   └── namedColors.ts             — [Red]/[Green]/... → hex map
│   ├── tier1/
│   │   ├── sugar.ts                   — canonicalizes 'if X then Y else Z' → '(X)?(Y):(Z)'; bare hex → string literal; rule:<id> → RuleRefNode placeholder
│   │   ├── parser.ts                  — parses Tier 1 brackets; delegates interior to expression.parse
│   │   └── resolver.ts                — evaluates style expressions via expression.evaluate; returns StyleObj
│   ├── tier2/
│   │   ├── compositeShape.ts          — CompositeColDef + Fragment + FragmentStyle types
│   │   └── fragmentResolver.ts        — resolves fragments (per-row); used by paint, tooltip, clipboard
│   ├── templates/
│   │   ├── registry.ts                — registerFormatterTemplate; built-in template registry
│   │   ├── number.ts, currency.ts, percent.ts, date.ts, time.ts, datetime.ts, relativeTime.ts, abbreviated.ts, custom.ts
│   │   └── intlCache.ts               — Intl.NumberFormat / Intl.DateTimeFormat LRU cache keyed by hash of (locale, options)
│   ├── compile.ts                     — compileFormat(source, opts) → FormatProgram; compileCompositeColDef(colDef, opts) → FormatProgram
│   ├── icons/
│   │   └── (thin re-export)           — bridges to kernel's icon registry; no icons live in this package
│   ├── bridge.ts                      — wireIntoKernel(grid, opts?) — registers format compiler + Lucide icon set + composite tooltip auto-wire
│   └── index.ts                       — public exports
├── tests/
│   ├── excel/parser.test.ts, evaluator.test.ts
│   ├── tier1/sugar.test.ts, parser.test.ts, resolver.test.ts
│   ├── tier2/fragmentResolver.test.ts
│   ├── templates/registry.test.ts, intlCache.test.ts
│   ├── compile.test.ts
│   ├── bridge.test.ts
│   └── fixtures/format-corpus.json    — ~80 golden format-string → expected {text, style, icon, fragments} entries
├── README.md
├── package.json                       — dependencies: { "@cgrid/expression": "*" }; peerDependencies: { "@cgrid/kernel": "*" }
└── tsconfig.json
```

### 2.3 `@cgrid/kernel` diff footprint

New files (isolated; no existing tests edited):

```
packages/kernel/src/
├── core/formatCompilerSlot.ts                        — DI slot: registerFormatCompiler / getFormatCompiler; structural type aliases
├── icons/
│   ├── registry.ts                                   — Map<setName, Map<iconName, string | Path2D>>; resolveIcon
│   ├── lucide.generated.ts                           — build-generated Path2D source strings for ~1500 Lucide icons (committed to git)
│   └── build-lucide.ts                               — build script; reads node_modules/lucide-static/icons/*.svg
├── renderer/cellRenderers/composite.ts               — composite painter (layout + draw)
├── interaction/features/tooltipProvider.ts           — per-column tooltip hook + hover debounce + rich payload
└── (extensions to existing files, listed below)
```

Touched existing files (surgical):

| File | Change |
|---|---|
| `types/column.ts` | `valueFormatter` type broadened; new fields `cellIcon`, `type: 'composite'`, `fragments`, `cellBackground`, `align`, `overflow` |
| `types.ts` | Structural aliases for format compiler DI (CompositeColDefShape, FormatProgramShape) |
| `types/api.ts` | Public `registerFormatCompiler`, `registerIconSet`, `resolveIcon`, `registerTooltipProvider`, `unregisterTooltipProvider` added |
| `cgrid.ts` | Wires new API methods to internal implementations |
| `core/propertyChain.ts` | `compileFormatSlots` pass runs at ColDef-resolve; `mergeCellStyle` helper |
| `renderer/painters/byRows.ts` | Icon inline rendering (left of text, tint respect, text-metrics inclusion) |
| `interaction/featureChain.ts` | TooltipProvider feature inserted ahead of OnHover, behind SparklineTooltip |
| `interaction/features/keyboardShortcuts.ts` | Copy path extended: ClipboardItem write when composite cells in range; feature-detect fallback |
| `interaction/features/keyboardShortcuts.ts` (new helper) | `serializeToHtml(rows)` for the copy path |

**All kernel changes guarded by the injection-slot pattern.** Apps that don't import `@cgrid/format` never call `registerFormatCompiler`; `getFormatCompiler()` returns null; `compileFormatSlots` is a pass-through; the icon registry is empty; `registerTooltipProvider` is a no-op cost until called. Behavior identical to today's kernel for such apps.

---

## §3 DSL grammar (Tier 0 / Tier 1 / Tier 2)

### 3.1 Tier 0 — pure Excel format codes

Excel-native. Format's `excel/parser.ts` handles this end-to-end; `@cgrid/expression` is not invoked.

**Supported tokens:**

- **Digit placeholders** — `0` (required digit), `#` (optional digit), `?` (space-padded optional)
- **Group + decimal** — `,` (thousands separator), `.` (decimal point)
- **Percent** — `%` (multiplies by 100)
- **Scaling** — trailing `,` before non-digit (K/M/B implicit; `#,##0,` → thousands, `#,##0,,` → millions)
- **Fixed characters** — `$`, `€`, `£`, `¥`, `-`, `+`, `(`, `)`, ` `, `/`, `:`
- **Quoted literals** — `"text"` — everything between quotes is a literal, no escaping needed inside
- **Escape** — `\c` (literal char)
- **Repeat/pad** — `*x` (repeat x to fill), `_x` (space width of x)
- **Date/time** — `yyyy`, `yy`, `mmmm`, `mmm`, `mm`, `m`, `dddd`, `ddd`, `dd`, `d`, `hh`, `h`, `nn` (minutes), `n`, `ss`, `s`, `AM/PM`, `am/pm`
- **Section separator** — `;` — up to 4 sections: `positive;negative;zero;text` (2 sections = pos/neg; 3 = pos/neg/zero; 4 = all)
- **Excel named colors** — `[Red]`, `[Green]`, `[Blue]`, `[Black]`, `[White]`, `[Yellow]`, `[Cyan]`, `[Magenta]` — resolve via `namedColors.ts` to hex
- **Excel conditions** — `[>1000]`, `[<=0]`, `[<>0]`, `[=0]` etc. inside a section header — routes value to that section
- **Locale tag** — `[$-409]` parsed and treated as a hint for Intl (translated to BCP-47 language tag: 0x409 → `en-US`)

Everything unrecognized falls through as a literal character.

### 3.2 Tier 1 — Tier 0 + expression brackets + icon references

Format's outer `tokenizer.ts` recognizes these new bracket kinds alongside Tier 0 tokens:

| Bracket | Interior | Compiles to |
|---|---|---|
| `[color=<expr>]` | Expression producing string | `StyleObj.color` per row |
| `[bg=<expr>]` | Expression producing string | `StyleObj.background` per row |
| `[weight=<expr>]` | Expression producing `'normal' \| 'bold' \| number` | `StyleObj.weight` per row |
| `[style=<expr>]` | Expression producing `'normal' \| 'italic'` | `StyleObj.italic` per row |
| `[if <expr>]` | Boolean expression | Section-selector; whole section applies only when true. Can also appear as an Excel section-header condition — Tier 1 `[if …]` generalizes Excel's numeric `[>1000]`/`[<=0]` to arbitrary expressions. Tier 0 evaluator routes to a section when its `[if …]` returns true, falling back to standard positive/negative/zero routing when no explicit condition matches |
| `{icon:<name>}` | Static identifier | Fixed icon token; resolved via kernel's icon registry at paint |
| `{icon:<name>|<expr>}` | Dynamic name via expression | Icon name computed per row from expression result |

**Style bracket precedence** — if a Tier 1 bracket appears alongside a Tier 0 `[Red]` in the same section, Tier 1 wins (per-row eval > static section color). Multiple style brackets in one section compose additively (last wins on a given channel).

### 3.3 Sugar canonicalization (before `expression.parse`)

`tier1/sugar.ts` transforms bracket interiors before handing off to `@cgrid/expression`:

1. **`if X then Y else Z`** → `(X) ? (Y) : (Z)`. Recognized only when the bracket interior begins with `if ` (space required). Nested `if/then/else` supported via recursive canonicalization. Rewrite happens at the string level before expression parse; expression sees only its native ternary syntax.
2. **Bare hex color tokens** `#0a7`, `#0af`, `#00aa77`, `#00aa77ff` (3/4/6/8-char hex) → converted to string literals `"#0a7"`, etc. Format's tokenizer recognizes `#[0-9a-fA-F]{3,8}` inside style-bracket interiors ONLY (`[color=…]`, `[bg=…]`, `[weight=…]`, `[style=…]`, `[if …]`) and rewrites in place before expression.parse. Not recognized inside `{icon:…}` interior (icon names are bare identifiers, not colors). Bare hex outside any bracket is treated as a literal character sequence.
3. **`rule:<ruleId>` token** inside a style bracket → parsed but reserved. `sugar.ts` recognizes the `rule:` prefix and emits a `RuleRefNode` placeholder in format's own AST (not expression's). At resolve time, `RuleRefNode` returns `null` (no color) with a debug breadcrumb `[cgrid.format] rule reference '<ruleId>' unresolved (ships in Cycle 21e)`. Downstream cycle plugs in a resolver.

**What canonicalization does NOT do:**

- Does not expand Excel format codes into expression syntax — Tier 0 remains its own code path.
- Does not merge Tier 0 and Tier 1 into a unified AST — `compile.ts` produces a `FormatProgram` containing both a Tier 0 execution plan and an array of Tier 1 style-expression closures.
- Does not unify `[Red]` (Tier 0 named color) with `[color=<expr>]` (Tier 1) — they're semantically different (whole-section color vs per-row eval).

### 3.4 Tier 2 — composite ColDef shape

Verbatim from parent brief §4.3:

```ts
export type CompositeColDef = ColDef & {
  type: 'composite';
  fragments: Fragment[];
  cellBackground?: string;              // Tier 1 format string; only bg=/if= brackets meaningful here
  align?: 'left' | 'center' | 'right';  // default 'left'
  overflow?: 'ellipsis' | 'clip';       // default 'ellipsis'
};

export type Fragment =
  | { text: string }
  | { expr: string; format?: string; style?: FragmentStyle };

export type FragmentStyle = {
  color?: string;       // literal hex, 'rule:<ruleId>' (reserved), or '[<expr>]' shorthand (auto-wraps into Tier 1 bracket)
  weight?: 'normal' | 'bold' | number;
  style?: 'normal' | 'italic';
  size?: number;        // px; must be ≤ row height
  background?: string;  // per-fragment background; rare
};
```

**Parent brief §5 DSL decisions (locked, restated for spec):**

1. **Single-line only.** Composite cells never wrap. Row heights uniform.
2. **Ellipsis + hover tooltip on overflow.** Kernel's new `registerTooltipProvider` hook auto-registered per composite column; tooltip returns concatenated fragment text.
3. **Multi-format clipboard.** Copy writes `text/plain` (concatenated fragment text, TSV per row) + `text/html` (styled `<span>` runs inside `<td>` cells inside `<table>` rows). Excel picks up the HTML with styling intact.
4. **Non-editable.** Composite is a derived view. F2/dblclick is a no-op on composite cells.

**Alignment behavior for `align: 'center'` with mixed-width fragments** — center the total width of visible fragments (post-ellipsis). Fragment order preserved; whitespace between fragments computed from cell padding.

### 3.5 Grammar reserves (honest structural reserves, mirror 21b's `AggregateNode`)

- **`rule:<ruleId>`** in any style expression → parsed, `RuleRefNode` emitted, resolver returns `null`. `@cgrid/rules` (Cycle 21e) plugs the resolver.
- **Aggregate function calls** inside Tier 1 interior (`SUM`, `AVG`, `RUNNING_SUM`, etc.) → `expression.compile` rejects with `not-yet-implemented` (already handled by 21b). Format surfaces the error with format-source loc translated from expression-source loc.

Both are honest reserves — the DSL grammar recognizes them, format's error surface documents them, downstream cycle plugs the resolver. Not deferral of the format DSL; deferral of the downstream package that supplies the referent.

---

## §4 Public API surface

### 4.1 `@cgrid/format` exports

```ts
// packages/format/src/index.ts

// Compilation entry points
export { compileFormat }         from './compile';
export { compileCompositeColDef } from './compile';

// Formatter template registry
export {
  registerFormatterTemplate,
  getFormatterTemplate,
  listFormatterTemplates,
} from './templates/registry';

// Kernel bridge (imports kernel; opt-in side-effect module)
export { wireIntoKernel } from './bridge';

// Public types
export type {
  FormatProgram,
  FormatSource,
  CompileFormatOptions,
  CompileFormatResult,
  CompileFormatError,
  FormatEvalContext,
  StyleObj,
  IconRef,
  ResolvedFragment,
  Fragment,
  FragmentStyle,
  CompositeColDef,
  FormatterTemplate,
  FormatterTemplateDef,
  FormatterTemplateContext,
  WireOptions,
} from './types';
```

### 4.2 `compileFormat` contract

Mirrors `expression.compile` semantics — returns a `Result`, never throws:

```ts
export function compileFormat(
  source: FormatSource,
  opts?: CompileFormatOptions
): CompileFormatResult;

export type FormatSource = string | CompositeColDef;

export interface CompileFormatOptions {
  locale?: string;                          // Intl locale; default 'en-US'
  currency?: string;                        // Intl currency; default 'USD'
  templates?: FormatterTemplateDef[];       // extension point; merged with built-ins
  builtins?: Record<string, BuiltinDef>;    // forwarded to expression.compile
}

export type CompileFormatResult =
  | { ok: true;  program: FormatProgram }
  | { ok: false; error: CompileFormatError };

export interface FormatProgram {
  // Text output — used by kernel's valueFormatter bridge.
  formatText: (ctx: FormatEvalContext) => string;

  // Style output — populated when Tier 1 style brackets were present.
  //   Returns { color?, background?, weight?, italic? } or null.
  //   Wired into kernel's cellStyle at ColDef-resolve time (merged with user's cellStyle).
  resolveStyle: (ctx: FormatEvalContext) => StyleObj | null;

  // Icon output — populated when {icon:name} or {icon:name|<expr>} tokens were present.
  //   Kernel's paint calls this to get an icon reference to draw.
  resolveIcon: (ctx: FormatEvalContext) => IconRef | null;

  // Fragment output — populated for composite programs.
  //   Returns resolved fragments used by paint, tooltip, clipboard.
  //   For non-composite programs, returns null.
  resolveFragments: (ctx: FormatEvalContext) => ResolvedFragment[] | null;

  // Debug — retained for customizer editor UX in later cycle.
  source: FormatSource;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
}

export interface FormatEvalContext {
  value: unknown;
  row: Record<string, unknown>;
  colId: string;
}

export interface StyleObj {
  color?: string;                          // resolved hex, e.g. '#0a7' or '#e53935'
  background?: string;
  weight?: 'normal' | 'bold' | number;
  italic?: boolean;
}

export interface IconRef {
  name: string;                            // key into kernel's icon registry
  color?: string;                          // optional tint; defaults to text color
  position?: 'leading' | 'trailing';       // default 'leading'
}

export interface ResolvedFragment {
  text: string;
  style: FragmentStyle;
  icon?: IconRef;
}

export interface CompileFormatError {
  kind: 'compile-format';
  code:
    | 'excel-parse'                        // Tier 0 syntax error
    | 'excel-section-count'                // too many ;-separated sections (>4)
    | 'tier1-parse'                        // Tier 1 bracket syntax error
    | 'expression-parse'                   // expression.parse failed inside a bracket
    | 'expression-compile'                 // expression.compile rejected the interior (e.g. aggregate reserve)
    | 'unknown-token'                      // e.g. {icon:} with empty name
    | 'not-yet-implemented';               // e.g. rule:<ruleId> (Cycle 21e reserve)
  message: string;
  loc: { start: number; end: number };     // char offsets into original source string
  cause?: { source: 'excel' | 'tier1' | 'expression'; inner: unknown };
}
```

### 4.3 Formatter template registry

```ts
export interface FormatterTemplateDef {
  name: string;
  factory: (params: FormatterTemplateContext) => (value: unknown) => string;
}

export interface FormatterTemplateContext {
  locale: string;
  currency?: string;
  digits?: number;
  useGrouping?: boolean;
  dateStyle?: 'short' | 'medium' | 'long' | 'full';
  timeStyle?: 'short' | 'medium' | 'long' | 'full';
}
```

**Built-in templates (9):**

| Name | Intl backing | Notes |
|---|---|---|
| `Number` | `Intl.NumberFormat({ minimumFractionDigits, maximumFractionDigits, useGrouping })` | Params derived from Excel digit placeholders |
| `Currency` | `Intl.NumberFormat({ style: 'currency', currency })` | `currency` from opts or DSL string |
| `Percent` | `Intl.NumberFormat({ style: 'percent', ... })` | Auto-multiplies by 100 |
| `Date` | `Intl.DateTimeFormat({ dateStyle })` | Params from `dateStyle` in DSL |
| `Time` | `Intl.DateTimeFormat({ timeStyle })` | |
| `DateTime` | `Intl.DateTimeFormat({ dateStyle, timeStyle })` | |
| `RelativeTime` | `Intl.RelativeTimeFormat` | `-3 → "3 days ago"`; unit + value from expression |
| `Abbreviated` | Custom | ≥1e9 → "1.23B", ≥1e6 → "4.56M", ≥1e3 → "7.89K"; digits controlled by params |
| `Custom` | Excel Tier 0 parser | Raw format string routed through Tier 0 |

**Intl formatter cache (`templates/intlCache.ts`).** All Intl instances cached in a `Map` keyed by hash of `(template, locale, currency, digits, useGrouping, dateStyle, timeStyle)`. LRU eviction at 500 entries (kicks LRU when full). Realistic ceiling — a real app has O(columns) unique format strings, not thousands.

### 4.4 Composite ColDef compilation

`compileCompositeColDef(colDef: CompositeColDef, opts?)` returns a `FormatProgram` whose:

- `resolveFragments` is populated (walks fragments; for each `expr` fragment, calls `expression.parse/compile/evaluate`; applies per-fragment `format` string via Tier 0/1 pipeline; resolves per-fragment style — auto-wrapping `[<expr>]` shorthand in `FragmentStyle.color`/`.background` into a Tier 1 bracket first).
- `formatText` returns concatenated fragment text (used as fallback tooltip payload + clipboard `text/plain` per fragment).
- `resolveStyle` evaluates `cellBackground` (if set) and returns `{ background }`.
- `resolveIcon` returns null (icons are per-fragment for composite; kernel's composite painter reads them from `resolveFragments`).

### 4.5 `wireIntoKernel(grid, opts?)` bridge

```ts
export function wireIntoKernel(grid: CGrid<any>, opts?: WireOptions): void;

export interface WireOptions {
  additionalIconSets?: Record<string, IconSet>;   // e.g. Phosphor
  compositeRenderer?: CompositeRenderer;          // override kernel's default
}
```

Bridge does:

1. **Register format compiler** — `grid.registerFormatCompiler(compileFormat)`.
2. **Register Lucide icon set** — `grid.registerIconSet('lucide', lucideBundle)` where `lucideBundle` is imported from kernel's `icons/lucide.generated.ts`.
3. **Register any extra icon sets** from `opts.additionalIconSets`.
4. **Auto-register composite tooltip providers.** Bridge subscribes to grid's ColDef-resolve event; for each composite ColDef, registers a tooltip provider that returns `{ plain: program.formatText(...) }`. Existing user-registered tooltip providers win (idempotent — no overwrite).
5. **Idempotency.** Bridge sets a marker (e.g. `grid.__formatBridgeWired = true`); re-calling is a no-op.

Consumers wire once at grid setup:

```ts
import { CGrid } from '@cgrid/kernel';
import { wireIntoKernel } from '@cgrid/format';

const grid = new CGrid({ ... });
wireIntoKernel(grid);
```

### 4.6 Type-only imports (dep-graph hygiene)

Kernel's `types/column.ts` imports `Fragment`, `IconRef`, `FragmentStyle` from `@cgrid/format` via `import type`:

```ts
import type { Fragment, IconRef, FragmentStyle } from '@cgrid/format';
```

Type-only imports don't create runtime dep-graph edges. TypeScript checks kernel's ColDef shapes against format's types; the compiled JS has no `@cgrid/format` import. Verified by lint rule + build-time check that kernel's `dist/*.js` never mentions `@cgrid/format`.

---

## §5 Kernel bridge (surgical additions)

### 5.1 ColDef type broadening

`packages/kernel/src/types/column.ts`:

```ts
import type { Fragment, IconRef, FragmentStyle } from '@cgrid/format';  // type-only

export interface CColDef<TRow, TValue = unknown> {
  // ... existing fields ...

  // BROADENED — was `(params) => string`, now accepts DSL string too.
  valueFormatter?: string | ((params: CValueFormatterParams<TRow, TValue>) => string);

  // NEW — icon slot; populated by format at ColDef-resolve when {icon:name} present.
  //   Function form for user-authored icons; string form is a static icon name.
  cellIcon?: string | ((params: CValueFormatterParams<TRow, TValue>) => IconRef | null);

  // NEW — composite discriminant + fields.
  type?: 'composite';
  fragments?: Fragment[];
  cellBackground?: string;
  align?: 'left' | 'center' | 'right';
  overflow?: 'ellipsis' | 'clip';
}
```

`ResolvedColDef` (post-resolve) narrows: `valueFormatter?: (params) => string`, `cellIcon?: (params) => IconRef | null`, `_compositeProgram?: FormatProgramShape` (internal, marked `@internal`).

### 5.2 Format-compiler injection slot

`packages/kernel/src/core/formatCompilerSlot.ts` (new):

```ts
// Kernel exposes an injection point; @cgrid/format registers itself.
// Kernel does NOT import @cgrid/format at runtime.

export interface CompositeColDefShape {
  type: 'composite';
  fragments: Array<{ text: string } | { expr: string; format?: string; style?: unknown }>;
  cellBackground?: string;
  align?: 'left' | 'center' | 'right';
  overflow?: 'ellipsis' | 'clip';
}

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

export type FormatCompiler = (
  source: string | CompositeColDefShape,
  opts?: unknown
) =>
  | { ok: true; program: FormatProgramShape }
  | { ok: false; error: { message: string; loc: { start: number; end: number } } };

let injectedCompiler: FormatCompiler | null = null;

export function registerFormatCompiler(fn: FormatCompiler): void {
  injectedCompiler = fn;
}

export function getFormatCompiler(): FormatCompiler | null {
  return injectedCompiler;
}
```

Kernel's public API exposes `grid.registerFormatCompiler(fn)` that forwards here.

### 5.3 ColDef-resolve step — `compileFormatSlots`

New pass in `packages/kernel/src/core/propertyChain.ts`, runs after property-chain merge and before returning `ResolvedColDef`:

```ts
function compileFormatSlots<TRow>(
  merged: CColDefLike<TRow>
): CColDefLike<TRow> {
  const compiler = getFormatCompiler();
  if (!compiler) return merged;                          // no format package loaded → no-op

  // Composite path
  if (merged.type === 'composite') {
    const res = compiler(merged as CompositeColDefShape);
    if (!res.ok) {
      warnOnce(`[cgrid.format] composite ColDef ${merged.colId} failed to compile: ${res.error.message}`);
      return merged;
    }
    return {
      ...merged,
      _compositeProgram: res.program,
      valueFormatter: (p) => res.program.formatText({ value: p.value, row: p.data, colId: p.colId }),
      cellStyle: mergeCellStyle(
        merged.cellStyle,
        (p) => res.program.resolveStyle({ value: p.value, row: p.data, colId: p.colId })
      ),
    };
  }

  // Tier 0/1 path — string valueFormatter
  if (typeof merged.valueFormatter === 'string') {
    const res = compiler(merged.valueFormatter);
    if (!res.ok) {
      warnOnce(`[cgrid.format] valueFormatter for ${merged.colId} failed to compile: ${res.error.message}`);
      return merged;                                      // string form kept but never invoked → falls through to raw value
    }
    return {
      ...merged,
      valueFormatter: (p) => res.program.formatText({ value: p.value, row: p.data, colId: p.colId }),
      cellStyle: mergeCellStyle(
        merged.cellStyle,
        (p) => res.program.resolveStyle({ value: p.value, row: p.data, colId: p.colId })
      ),
      cellIcon: (p) => res.program.resolveIcon({ value: p.value, row: p.data, colId: p.colId }),
    };
  }

  return merged;
}
```

**`mergeCellStyle` overlay ordering.** If the user already has a `cellStyle: fn`, the merged function calls format's style first, then overlays the user's fn. User wins on any explicit non-undefined field. No silent overwrite. Documented in kernel + format README.

**`warnOnce`.** Prefix `[cgrid.format]` (grep-friendly), failing colId included. `strictFormat: true` grid-option (future, see §7.3) can upgrade warn → throw.

### 5.4 Icon registry — `packages/kernel/src/icons/`

Files:

- `registry.ts` — `Map<setName, Map<iconName, string | Path2D>>`
- `lucide.generated.ts` — build-generated `lucideBundle: Record<string, string>` (~1500 Lucide icons as SVG path strings)
- `build-lucide.ts` — build script reading `node_modules/lucide-static/icons/*.svg`, emitting `lucide.generated.ts`

**Public API:**

```ts
grid.registerIconSet(name: string, paths: Record<string, string | Path2D>): void;
grid.resolveIcon(name: string, setHint?: string): Path2D | null;
```

Registry lookup order: exact `setHint` match first; then all registered sets in registration order. Cache: string-form paths become `Path2D` lazily on first `resolveIcon`, cached in the same map. Miss returns `null`; paint skips silently.

**Bundle-size posture.** Kernel does NOT auto-register Lucide — `lucide.generated.ts` is only imported from `packages/format/src/bridge.ts`. Apps that never call `wireIntoKernel` never import Lucide → tree-shaken away. Bundle target: kernel-only app absorbs ~1KB (registry infra); format-wired app absorbs ~30KB gzip for Lucide.

**`.generated.ts` file — committed to git.** Deterministic build output; PR reviewers see icon-set diffs; no accidental drift between local + CI.

### 5.5 Composite cell renderer — `packages/kernel/src/renderer/cellRenderers/composite.ts`

New painter. Registered via kernel's existing `registerCellRenderer('composite', painter)` API on grid init.

```ts
export const compositePainter: CellPainter = (ctx, cell) => {
  const program = cell.colDef._compositeProgram;
  if (!program) return;                                   // fallback to text (safety)

  const fragments = program.resolveFragments({ value: cell.value, row: cell.row, colId: cell.colId });
  if (!fragments || fragments.length === 0) return;

  // 1. Background — resolve cellBackground format if set (returns null for non-composite)
  const bg = program.resolveStyle({ value: null, row: cell.row, colId: cell.colId });
  if (bg?.background) fillRect(ctx, cell.rect, bg.background);

  // 2. Layout — measure each fragment, decide ellipsis, apply alignment
  const laidOut = layoutFragments(
    fragments,
    cell.rect,
    cell.colDef.align ?? 'left',
    cell.colDef.overflow ?? 'ellipsis',
  );

  // 3. Draw — each fragment with its style + icon
  for (const frag of laidOut) {
    if (frag.icon) drawIcon(ctx, frag.iconRect, frag.icon);
    drawText(ctx, frag.textRect, frag.text, frag.style);
  }
};
```

**Layout algorithm:**

- Measure each fragment left-to-right using shared `PainterCtx` text-metrics (same code paths as text/number painters).
- Icons take a fixed square width matching font ascent (approx line-height × 0.9).
- Sum widths; if total ≤ available width, apply alignment (left/center/right).
- If total > available width AND `overflow === 'ellipsis'` — truncate from the last fragment; append `…` glyph; truncation is character-boundary (measures until fitting).
- If `overflow === 'clip'` — draw all fragments; clip at cell right boundary via canvas clip region.

**Alignment for `align: 'center'` with mixed-width fragments** — center the total width of visible fragments (post-ellipsis) within the cell.

### 5.6 Tooltip provider hook — `packages/kernel/src/interaction/features/tooltipProvider.ts`

New feature in the feature chain (per Cycle 3 pattern).

**Public API:**

```ts
grid.registerTooltipProvider(
  colId: string,
  fn: (params: TooltipParams) => TooltipPayload | null
): void;
grid.unregisterTooltipProvider(colId: string): void;

interface TooltipParams {
  row: any;
  colId: string;
  rect: DOMRect;
}
type TooltipPayload = { plain: string } | { html: string };
```

**Feature-chain integration** — `TooltipProvider` sits between `SparklineTooltip` (existing, specialized) and `OnHover`. On mouseenter of a cell with a registered provider, feature debounces (~500ms), invokes provider, shows DOM tooltip using existing tooltip chrome tokens (`--cg-tooltip-bg`, `--cg-tooltip-fg`, `--cg-tooltip-border`).

**Auto-registration for composite** — during `compileFormatSlots`, if `type === 'composite'`, kernel auto-registers a tooltip provider for that `colId` that returns `{ plain: program.formatText(...) }`. Users can override with their own `registerTooltipProvider` — user registration wins. Auto-registration cleared on ColDef removal.

### 5.7 Multi-format clipboard — extend `interaction/features/keyboardShortcuts.ts`

Existing copy path uses `navigator.clipboard.writeText(text)`. Extended:

```ts
async function copySelectedRanges() {
  const rows = getSelectedRanges();
  const hasComposite = rows.some(r => r.colDefs.some(d => d.type === 'composite'));

  const plainText = serializeToTsv(rows);

  if (!hasComposite) {
    await navigator.clipboard.writeText(plainText);
    return;
  }

  if (typeof (navigator.clipboard as unknown as { write?: unknown }).write !== 'function') {
    // Feature-detect miss: Firefox <127, older Safari
    console.debug('[cgrid.clipboard] rich copy unavailable, using plain text');
    await navigator.clipboard.writeText(plainText);
    return;
  }

  const htmlText = serializeToHtml(rows);
  const item = new ClipboardItem({
    'text/plain': new Blob([plainText], { type: 'text/plain' }),
    'text/html':  new Blob([htmlText],  { type: 'text/html'  }),
  });
  await navigator.clipboard.write([item]);
}
```

**`serializeToHtml`** — emits `<table>` with per-row `<tr>` and per-cell `<td>`. Composite cells emit `<td>` containing styled `<span>` runs (one per fragment) with inline `style="color:...; font-weight:...;"`. Non-composite cells emit plain-text `<td>`. Excel Web / Desktop paste picks up the HTML with formatting intact.

### 5.8 Paint integration for `cellIcon`

Extend `packages/kernel/src/renderer/painters/byRows.ts`:

- After resolving `cellIcon` via `ResolvedColDef.cellIcon` (function form), draw the icon left of the text (or right if `position: 'trailing'`).
- Icon color: `IconRef.color` if set, else the computed text color from `cellStyle`.
- Text-metrics: icon width included in width budget for text (icon + gutter + text).
- Missing icon (`resolveIcon` on kernel's registry returns null): silent skip; text draws in the icon's space.

Existing non-icon columns (`cellIcon` undefined) unchanged.

### 5.9 What the bridge does NOT touch

- **Kernel's worker RPC** — format eval stays on the caller's thread. §7 worker-only-eval policy applies to downstream cycle consumers (rules, calc, renderers), not to format directly.
- **Kernel's data model, sort, filter, group, pivot** — untouched.
- **Existing painters** (text, number, boolean, checkbox, image, hyperlink) — untouched.
- **Existing `cellStyle` / `cellClass` / `cellClassRules`** behavior when `valueFormatter` is a function — behavior identical to today.

All kernel diffs are guarded by the injection-slot pattern.

---

## §6 Task decomposition preview (~20 tasks, single PR)

Branch: `cycle21c/format`. Single PR. Cadence: subagent-driven-development — one subagent per task, one commit, review-gated before proceeding.

Six phases, dependency-ordered. Detailed step lists live in the implementation plan (`docs/superpowers/plans/2026-07-01-cycle-21c-format.md`).

**Phase A — @cgrid/format package scaffold + shared types (1 task)**

1. Types + module skeletons + package.json wiring. Author `types.ts` with all shapes from §4. Skeleton every source file from §2.2 with `throw new Error('not-yet-implemented')` bodies. Wire `index.ts`. `@cgrid/format`'s `package.json` gains `peerDependencies: { "@cgrid/kernel": "*" }`. Typecheck + vacuous tests pass. Kernel + expression untouched.

**Phase B — Tier 0 Excel format code engine (3 tasks)**

2. Excel tokenizer + parser (`excel/parser.ts`). Handles digit placeholders, decimal/group, `%`, quoted literals, escapes, section separator, Excel named colors, condition brackets, locale tag. Golden AST corpus `tests/fixtures/excel-corpus.json` ≥40 canonical format strings.
3. Excel evaluator (`excel/evaluator.ts`). Applies parsed Excel format tree to number/date/string; handles section routing (positive/negative/zero/text + optional condition), digit padding, currency symbols, date formatting.
4. Formatter template registry + built-in templates. `templates/registry.ts` + 9 built-ins (Number/Currency/Percent/Date/Time/DateTime/RelativeTime/Abbreviated/Custom). `intlCache.ts` LRU. Excel evaluator wires into templates for Intl formatters.

**Phase C — Tier 1 brackets + expression integration (3 tasks)**

5. Tier 1 tokenizer + sugar canonicalization (`tokenizer.ts` extends + `tier1/sugar.ts`). Format's outer tokenizer identifies `[color=…]`, `[bg=…]`, `[weight=…]`, `[style=…]`, `[if …]`, `{icon:…}` as distinct tokens. Sugar transforms `if X then Y else Z` → ternary, bare hex → string literal, `rule:<ruleId>` → `RuleRefNode` placeholder.
6. Tier 1 parser + `expression.parse` integration (`tier1/parser.ts`). Delegates bracket interior to `expression.parse(canonicalizedInterior)`. Errors re-wrapped as `CompileFormatError { code: 'expression-parse' | 'expression-compile', cause }` with format-source loc translated from expression-source loc.
7. Tier 1 style resolver + icon token resolver (`tier1/resolver.ts`). Evaluates each style expression via `expression.evaluate`; produces `StyleObj`. Icon tokens produce `IconRef`. Wires into `FormatProgram.resolveStyle` + `FormatProgram.resolveIcon`.

**Phase D — Tier 2 composite (2 tasks)**

8. Composite ColDef shape + fragment resolver (`tier2/compositeShape.ts` + `tier2/fragmentResolver.ts`). Walks fragments; for each `expr`, calls `expression.parse/compile/evaluate`; applies per-fragment `format` string via Tier 0/1 pipeline; resolves per-fragment style (auto-wrapping `[<expr>]` shorthand into Tier 1 bracket).
9. Composite public API + `compileCompositeColDef`. Wires composite into `FormatProgram.resolveFragments`; `formatText` returns concatenated text (tooltip default + clipboard plain).

**Phase D→E — Intra-cycle self-review checkpoint**

Between Task 9 and Task 10, an intra-cycle code review runs on Phase A-D (format package internals, kernel untouched). Reviewer verifies:
- `wireIntoKernel` signature is final and stable
- `FormatProgram` public shape final (no field renames after Phase E starts)
- Composite ColDef shape matches parent brief §4.3 exactly
- No hidden coupling to kernel from format's `src/` beyond `bridge.ts`

Corrections land before Phase E starts. Cheap insurance; no schedule cost.

**Phase E — Kernel bridge + infrastructure (7 tasks)**

10. Kernel: format compiler injection slot. New `packages/kernel/src/core/formatCompilerSlot.ts`. `grid.registerFormatCompiler(fn)` API on `types/api.ts` + `cgrid.ts`. Structural type aliases so kernel doesn't import format. Unit tests use a fake compiler.
11. Kernel: ColDef type broadening + `compileFormatSlots` pass. `types/column.ts` broadening + type-only imports from `@cgrid/format`. `core/propertyChain.ts` gains `compileFormatSlots` at ColDef-resolve. `mergeCellStyle` helper. `warnOnce` on compile failure. Handles both string `valueFormatter` and `type: 'composite'`. **Existing 2326 kernel unit tests pass unchanged** (function-form `valueFormatter` still works identically).
12. Kernel: icon registry + Lucide build step. `packages/kernel/src/icons/registry.ts`. `packages/kernel/src/icons/build-lucide.ts` build script — generates `lucide.generated.ts` from `lucide-static/icons/*.svg`. Wire prebuild via package.json script. Registry API on grid: `grid.registerIconSet(name, paths)`, `grid.resolveIcon(name)`. Kernel does NOT auto-register Lucide.
13. Kernel: composite cell renderer. `packages/kernel/src/renderer/cellRenderers/composite.ts`. Layout pass (fragment measure + ellipsis + alignment), draw pass (per-fragment style + inline icons). Registered via existing `registerCellRenderer('composite', painter)` on grid init.
14. Kernel: tooltip provider hook. `packages/kernel/src/interaction/features/tooltipProvider.ts`. Feature chain integration. `grid.registerTooltipProvider(colId, fn)` + `unregister`. Debounced hover. Rich payload. Existing `SparklineTooltip` untouched.
15. Kernel: multi-format clipboard extension. Extend `interaction/features/keyboardShortcuts.ts` copy path. `serializeToHtml` helper for composite cells → styled `<span>` runs inside `<table>`. `ClipboardItem` write. Feature-detect fallback to `writeText`.
16. Kernel: paint integration for `cellIcon`. Wire the new ColDef `cellIcon` slot into the byRows painter — icon draws left of text with kerning, respects icon color tint from `IconRef.color`. Text metrics include icon width.

**Phase F — Format-package kernel bridge + demo + polish (4 tasks)**

17. Format: `wireIntoKernel(grid)` bridge. `packages/format/src/bridge.ts` — registers format compiler, registers Lucide icon set, auto-registers composite tooltip providers on ColDef resolve. Integration tests with a real `CGrid` fixture.
18. Format: showcase demo column. Add a Tier 0 + Tier 1 + Tier 2 blotter-style column set to `apps/cgrid-showcase/src/features/formatDSL.js`. Golden path: price + change + composite summary column with icons + conditional colors. E2E test (see §7.3).
19. Format: README + public API polish. Grammar cheat sheet, quickstart with `wireIntoKernel`, worked examples for each tier, migration note ("existing function-form `valueFormatter` keeps working unchanged").
20. Full monorepo verify + PR. Fresh install, typecheck, lint, unit tests (kernel + expression + format), E2E (showcase + positions), build. Push branch, open PR.

**Rough sizing (informational):**

| Phase | Tasks | Est LOC (src) | Est tests |
|---|---|---|---|
| A — scaffold | 1 | ~300 (types) | 0 |
| B — Tier 0 | 3 | ~800 | ~180 |
| C — Tier 1 | 3 | ~500 | ~120 |
| D — Tier 2 | 2 | ~350 | ~80 |
| E — kernel bridge | 7 | ~1200 | ~240 |
| F — bridge + demo + polish | 4 | ~300 | ~60 |
| **Total** | **20** | **~3450 src** | **~680 unit + 5-8 E2E** |

**Split-if-oversized rule** — if any Task's implementer PR exceeds ~500 LOC or ~150 lines of test, the reviewer flags for splitting. Likely split candidates: Task 5, 7, 11, 13, 15.

---

## §7 Testing strategy + verification gates

### 7.1 `@cgrid/format` unit tests

| File | Coverage target | Purpose |
|---|---|---|
| `tests/excel/parser.test.ts` | 90%+ lines | Every Excel token + section + condition + named color + locale tag |
| `tests/excel/evaluator.test.ts` | 90%+ lines | Section routing (positive/negative/zero/text), digit padding, currency, date formatting, edge cases (NaN, null, empty string, negative zero) |
| `tests/tier1/sugar.test.ts` | 95%+ lines | `if/then/else` → ternary rewrite (nested, non-matching, malformed); bare hex → string literal (3/4/6/8 char, invalid); `rule:<ruleId>` → `RuleRefNode` reserve |
| `tests/tier1/parser.test.ts` | 90%+ lines | Each bracket type; expression.parse error re-wrapping with loc translation; `{icon:name}` and `{icon:name|<expr>}` |
| `tests/tier1/resolver.test.ts` | 90%+ lines | Style eval per row; `StyleObj` shape; `IconRef` shape; `RuleRefNode` returns null (Cycle 21e reserve behavior) |
| `tests/tier2/fragmentResolver.test.ts` | 90%+ lines | Composite fragment resolution; per-fragment format + style; `[<expr>]` shorthand auto-wrap; cellBackground eval |
| `tests/templates/registry.test.ts` | 90%+ lines | All 9 built-in templates; Intl cache hit/miss/eviction |
| `tests/templates/intlCache.test.ts` | 95%+ lines | LRU eviction at ceiling; key hash correctness |
| `tests/compile.test.ts` | 85%+ lines | Public API round-trip — every tier + composite; error surfaces (excel-parse / tier1-parse / expression-parse / unknown-token / not-yet-implemented) |
| `tests/bridge.test.ts` | 80%+ lines | `wireIntoKernel(grid)` integration — uses a real `CGrid` fixture; verifies compiler registration, icon set registration, composite auto-tooltip |
| `tests/fixtures/format-corpus.json` | Golden regression | ~80 canonical format strings → expected `{text, style, icon, fragments}` outputs |

**Roughly ~680 unit tests total across the package.**

**Coverage bar rationale** — 85-95% per file. Vitest v8 provider. Composite renderer + bridge sit at 80-85% because canvas/DOM paths are harder to unit-test (E2E covers those).

### 7.2 `@cgrid/kernel` new-code unit tests

| File | Coverage target | Purpose |
|---|---|---|
| `tests/core/formatCompilerSlot.test.ts` | 90%+ | Register/get; nullable behavior; behavior identical when no compiler registered |
| `tests/core/propertyChain-compileFormatSlots.test.ts` | 90%+ | Compile pass for string valueFormatter + `type: 'composite'`; `warnOnce` on failure; `mergeCellStyle` overlay ordering (user wins) |
| `tests/icons/registry.test.ts` | 95%+ | `registerIconSet`, `resolveIcon` across sets; null on miss; Path2D lazy construction + cache |
| `tests/icons/lucide.generated.test.ts` | Smoke | Bundle exports ≥1000 icons; each has a valid path-data string |
| `tests/renderer/cellRenderers/composite.test.ts` | 85%+ | Layout (fragment widths, ellipsis, alignment); draw (per-fragment style + icons); overflow: 'clip' vs 'ellipsis'; empty fragments; missing program |
| `tests/interaction/features/tooltipProvider.test.ts` | 85%+ | Register/unregister; hover debounce; payload plain vs html; `SparklineTooltip` untouched |
| `tests/interaction/features/keyboardShortcuts-clipboard.test.ts` | 85%+ | Copy path branching — no composite → `writeText`; with composite → `ClipboardItem` write; feature-detect fallback; `serializeToHtml` output for known composite shapes |
| `tests/renderer/painters/byRows-cellIcon.test.ts` | 85%+ | Icon draws left of text; icon width in text metrics; `IconRef.color` tint; missing icon silent skip |

**Kernel baseline preservation** — existing 2326 kernel unit tests must remain at 2326/2326 pass. New tests are additive; no existing test edited unless a public contract genuinely changes (only `valueFormatter` type broadening touches a public contract, and it's a superset — existing tests still pass).

### 7.3 E2E — `apps/cgrid-showcase`

New E2E `apps/cgrid-showcase/e2e/formatDSL.spec.ts`:

- **Tier 0 verification** — column with `valueFormatter: '$#,##0.00;[Red]-$#,##0.00'` renders positive in default color, negative in red. Screenshot compare.
- **Tier 1 verification** — column with `valueFormatter: '[color=[[change]>0 ? "#0a7" : "#d33"]] $#,##0.00'` renders per-row color based on the `change` field.
- **Icon verification** — column with `{icon:trending-up}` prefix — icon renders left of number; tint respects text color.
- **Tier 2 composite** — a composite column with 3 fragments (symbol bold + price + change with icon). Verify:
  - Renders on canvas (screenshot compare)
  - Ellipsis when cell width shrinks (resize column, verify last fragment truncates)
  - Hover shows tooltip with concatenated full text
  - Copy (Ctrl+C over a composite range) puts both `text/plain` and `text/html` on the clipboard
- **Backwards-compat sanity** — existing `valueFormatter: fn` columns render identically to `main` (existing E2E baselines unchanged).

Rough count — ~5-8 new E2E specs.

### 7.4 E2E — `apps/cgrid-positions`

- **Format DSL in a real-time context** — one demo column upgraded to `valueFormatter: '[color=[[change]>0 ? "#0a7" : "#d33"]] $#,##0.00'`. Verify colors flip on tick without visible flicker; existing 262 positions E2E stay at 262/262.

### 7.5 Verification gates (Task 20)

- `npm --workspace @cgrid/format run typecheck` — clean
- `npm --workspace @cgrid/format run test` — 100% pass, coverage per §7.1
- `npm --workspace @cgrid/format run build` — echo no-op acceptable if scaffold not upgraded; otherwise clean
- `npm --workspace @cgrid/kernel run typecheck` — clean
- `npm --workspace @cgrid/kernel run test` — **2326 baseline + new tests, all pass**
- `npm --workspace @cgrid/expression run test` — **185/185 baseline (untouched)**
- Root `npm run lint` — clean
- Root `turbo typecheck` — full graph clean, no cycles
- Root `turbo build` — all packages build
- Showcase E2E — **98 baseline + new (5-8) tests, all pass**
- Positions E2E — **262 baseline + updated positions demo, all pass**
- Fresh install (`rm -rf node_modules && npm i`) — no warnings
- Bundle-size sanity — kernel-only app remains under +2% vs pre-cycle baseline (registry infra only); `@cgrid/format + wireIntoKernel` app absorbs ~30KB gzip for Lucide

### 7.6 Golden format corpus

`packages/format/tests/fixtures/format-corpus.json` — same pattern as expression's `ast-corpus.json`. Locks the output of ~80 canonical format strings covering:

- Every Tier 0 token + section combination (~30 entries)
- Every Tier 1 bracket kind × common expression shapes (~25 entries)
- Every composite fragment permutation (~15 entries)
- Cross-tier edge cases (Tier 1 inside Tier 0 sections, `rule:<ruleId>` reserve behavior, missing icon graceful) (~10 entries)

Any change to the tokenizer / parser / evaluator must update the corpus in the same commit. Reviewers inspect the corpus diff to see semantic shifts.

---

## §8 Risks + mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | `@cgrid/format` gains a `@cgrid/kernel` dep for the bridge → dep-graph cycle if kernel later imports format | Bridge imports kernel via `peerDependencies` only. Kernel never imports format (structural type aliases in DI slot). ESLint `no-restricted-imports` enforces boundary at CI |
| R2 | DSL grammar too permissive → downstream consumers hit surprises, especially at Tier 1 sugar boundaries (`if ... then ... else ...` swallowing unintended tokens) | Golden corpus locks every parse decision (~80 entries). Sugar canonicalization runs as a pre-pass with explicit tests for boundary cases. Reviewers inspect corpus diff each phase |
| R3 | Composite renderer performs poorly at scale (per-fragment text metrics + ellipsis) | Layout caches text-metric width per (font, char-set) at the painter level. Ellipsis truncation runs O(fragments) per cell, not O(chars). Performance measurement deferred (§1.2) but hot path is scoped to composite columns only |
| R4 | Multi-format clipboard `ClipboardItem` write fails in older Firefox / Safari builds | Feature-detect `navigator.clipboard.write` at copy time. Fall back to `writeText(plainText)` with debug breadcrumb. Composite rich copy is nice-to-have; plain text is guaranteed |
| R5 | Icon registry Lucide bundle bloats kernel for icon-less consumers | Kernel doesn't auto-register Lucide. `lucide.generated.ts` only imported from format's `bridge.ts`. Apps that never call `wireIntoKernel` never import Lucide → tree-shaken away |
| R6 | `warnOnce` on compile failure silently produces broken columns in dev if developer misses the console warning | `warnOnce` prefix `[cgrid.format]` — grep-friendly; failing colId included. Customizer editor (Cycle 21i) will surface UI errors. `strictFormat: true` grid-option can upgrade warn → throw (added if it comes up) |
| R7 | ColDef-resolve compilation runs eagerly for every column at grid init — could slow first-paint if 100+ columns each have format strings | Compilation is O(source-string-length) per ColDef. Realistic ceiling: 100 cols × ~50-char strings × ~µs each = <10ms total. Memoize by source string identity — same format string across columns compiles once |
| R8 | Cycle 21b's `EvalError` naming shadowing `globalThis.EvalError` propagates into format's error-handling code paths | Format catches `EvalError` via `error instanceof ExpressionEvalError` — imports expression's class explicitly. No global fallback. Documented in format README error section |
| R9 | Excel format code corner cases (accounting alignment `_(* #,##0_)`, thousands scaling via trailing comma, Excel year-1900 leap bug) | Golden corpus locks known-corner-case behavior. Follow LibreOffice / Google Sheets conventions where they diverge from Excel (leap-1900 → skip; documented explicitly) |
| R10 | `type: 'composite'` discriminant collides with future ColDef types (e.g. `type: 'group'`) | Kernel currently uses `type` for cell renderer keys. Grep confirms `type` is optional and lookup-based; no conflict. Documented in kernel README |
| R11 | Task decomposition too optimistic — 20 tasks × ~170 LOC average may over-run | Intra-cycle self-review at Phase D→E boundary. Split-if-oversized rule (>500 LOC or >150 test lines flags a split). Split candidates pre-identified (Task 5, 7, 11, 13, 15). Cycle 2 shipped 27 tasks fine |
| R12 | Format's `wireIntoKernel` runs at every grid-init — auto-registration side effects hard to reason about | Idempotent — re-calling is a no-op via `__formatBridgeWired` marker. Explicit — user chooses when/if. Tests cover multi-grid + multi-init scenarios |
| R13 | Kernel changes across 4 new subsystems (icons/composite/tooltip/clipboard) in one cycle risks regressions in unrelated kernel paths | Every kernel change guarded by injection-slot pattern — no format compiler registered → behavior identical to today. 2326 kernel unit tests + full E2E suites (98 showcase + 262 positions) are the safety net. Any baseline change is a hard fail |

---

## §9 Success criteria

- `packages/format/src/` has all files from §2.2 with real (non-throwing) implementations.
- `@cgrid/format` public API from §4 is exported from `index.ts`.
- All unit test files exist with the coverage from §7 met.
- `npm --workspace @cgrid/format run test` — 100% pass, no `.only` / `.skip` leaks.
- `npm --workspace @cgrid/kernel run test` — 2326 baseline preserved + new tests all pass.
- `npm --workspace @cgrid/expression run test` — 185/185 baseline preserved (expression untouched).
- Showcase E2E — 98 baseline + 5-8 new format-DSL specs all pass.
- Positions E2E — 262 baseline (with one column upgraded to DSL) all pass.
- Turbo graph clean; no dep cycles.
- A downstream consumer can:
  - Set `valueFormatter: '$#,##0.00'` on a ColDef and see currency formatting apply.
  - Set `valueFormatter: '[color=[[change]>0 ? "#0a7" : "#d33"]] $#,##0.00'` and see per-row color.
  - Set `valueFormatter: '{icon:trending-up} $#,##0.00'` and see an inline Lucide icon.
  - Author a `type: 'composite'` ColDef with 3 fragments and see them render + tooltip + copy correctly.
  - Continue using existing `valueFormatter: fn` columns identically (backwards-compat sanity).
- PR body links to this spec + parent brief §3.2 + §4.3 + §5 + §7.
- `.superpowers/sdd/progress.md` ends with `Cycle 21c status: COMPLETE.`

---

## §10 Resolved decisions (locked during brainstorming)

| Decision | Locked as |
|---|---|
| Cycle scope | All features (Tier 0/1/2 + kernel bridge + icons + tooltip + clipboard) ship in 21c. No deferral |
| Kernel bridge contract | `valueFormatter?: string \| ((params) => string)`. String form compiles at ColDef-resolve via `@cgrid/format`. Backwards-compatible superset |
| DSL composition with expression | Format handles brackets + sugar; interior handoff to `expression.parse`. Style eval calls `expression.evaluate` |
| Style channel | Piggyback existing `cellStyle` via `mergeCellStyle`; new `cellIcon` slot on ColDef; composite via `type: 'composite'` |
| Icon bundle | Full Lucide (~1500 icons) as Path2D source strings, tree-shakable. `lucide.generated.ts` committed to git |
| Landing strategy | Single PR (`cycle21c/format`), ~20 tasks, subagent-driven-development cadence, intra-cycle self-review at Phase D→E boundary |
| `rule:<ruleId>` | Honest structural reserve; parses; resolver returns null; Cycle 21e plugs in |
| Excel locale tag `[$-409]` | Parse-and-hint to Intl (translated to BCP-47) |
| Composite `align: 'center'` | Center total width of visible fragments (post-ellipsis) |
| `{icon:name|<expr>}` dynamic icon | Both static and dynamic paths ship |
| `.generated.ts` files | Committed to git (deterministic build; reviewer visibility) |
| `strictFormat` grid-option | Warn-only in 21c; add strict mode when a real consumer needs it |
| RelativeTime semantics | Follow `Intl.RelativeTimeFormat` API (`-3 → "3 days ago"`) |
| Customizer save format | Source string (deferred to Cycle 21i) |

---

## §11 Open questions (post-implementation, non-blocking)

1. **Format string comment syntax.** Do consumers want a `--` line-comment inside long format strings? Deferred until a real editor consumer authors non-trivial strings.
2. **Extension for style channels beyond color/bg/weight/style.** e.g. `[underline=<expr>]`, `[border=<expr>]`. Ship the initial four; add more when a real consumer needs them.
3. **Icon size override per token.** `{icon:trending-up|size:16}` — currently icon size is ascent-based. Add if a real UI needs non-default sizing.
4. **Clipboard `text/rtf` output.** Some legacy consumers prefer RTF over HTML. HTML is the primary path in 21c; RTF ships if a consumer requests.
5. **Format string interning.** For a table with 100 columns using 10 unique format strings, we compile 10 programs shared across ColDefs. Currently opt-in via consumer memoization; consider making it a `compileFormat` cache internally.
6. **Feature-detect `Path2D` in server-side rendering.** Node.js doesn't have Path2D; a future SSR consumer would need a polyfill. Not in scope for 21c (§1.2).

None block 21c landing.

---

## Summary

Cycle 21c ships `@cgrid/format` — the second feature-absorption cycle into the Cycle-21 monorepo scaffold, and the first that touches kernel. The unified formatting DSL lands in a single PR across ~20 tasks: Tier 0 Excel format codes, Tier 1 expression brackets + Lucide icons, Tier 2 composite ColDef shape, plus surgical kernel additions (format-compiler DI slot, ColDef-resolve step, icon registry, composite cell renderer, tooltip provider hook, multi-format clipboard).

Every kernel diff is guarded by an injection-slot pattern — apps that don't import `@cgrid/format` see byte-identical behavior. Format itself depends only on `@cgrid/expression` (Cycle 21b, merged as PR #93), keeping the dep graph acyclic. The 4 kernel subsystems (icons, composite, tooltip, clipboard) all ship together, because that's what the "no feature deferral" principle demands: features live in the plan because they're needed; decompose into more tasks rather than push features to follow-ups.

Roadmap position: 21c unblocks 21d (`@cgrid/calc` needs format templates for calc-column formatting), 21e (`@cgrid/rules` needs `rule:<ruleId>` resolution + format style channel), 21f (`@cgrid/renderers` needs Tier 2 composite + icon inline for rich blotter cells), 21h (`@cgrid/export` needs resolved formatters for visual XLSX/CSV mode), 21i (`@cgrid/customizer` needs `compileFormat` + `CompileFormatError.loc` for editor UX).
