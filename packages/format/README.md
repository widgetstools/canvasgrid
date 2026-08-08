# `@wellsfargo-starui/velocity-grid-format`

Unified formatting DSL for the cgrid monorepo. Three tiers, one parser,
one docs page.

- **Tier 0** — Pure Excel format codes (`$#,##0.00`, `#,##0.00;[Red]-#,##0.00`, `yyyy-mm-dd`).
- **Tier 1** — Excel + expression brackets (`[color=<expr>]`, `[bg=<expr>]`, `[weight=<expr>]`, `[style=<expr>]`, `[if <expr>]`) + Lucide icons (`{icon:trending-up}`).
- **Tier 2** — Composite ColDef with per-fragment `expr` + `format` + `style`.

**Status:** Cycle 21c — all three tiers shipped. `rule:<ruleId>` inside
style expressions is an honest structural reserve — parses, resolves to
`null` until `@wellsfargo-starui/velocity-grid-rules` (Cycle 21e) plugs the resolver in. Full spec:
`docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md`.

## Quickstart

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel } from '@wellsfargo-starui/velocity-grid-format';

// The compiler must be registered BEFORE columns with DSL strings
// resolve — construct, wire, then land the defs.
const grid = new VelocityGrid(host, { columnDefs: [], /* ... */ });
wireIntoKernel(grid);  // idempotent — call once per grid instance

grid.updateGridOptions({ columnDefs: [
  { colId: 'price', field: 'price', valueFormatter: '$#,##0.00' },      // Tier 0
  { colId: 'change', field: 'change',                                   // Tier 1
    valueFormatter: '[color=[change] > 0 ? "#0a7" : "#d33"] $#,##0.00' },
  { colId: 'summary', type: 'composite',                                // Tier 2
    fragments: [
      { expr: '[symbol]', style: { weight: 'bold' } },
      { text: '  ' },
      { expr: '[price]', format: '$#,##0.00' },
    ],
  },
] });
```

## Grammar cheat sheet

### Tier 0 — Excel format codes

| Element | Meaning |
|---|---|
| `0`, `#`, `?` | Digit placeholders — required, optional, space-padded |
| `,` | Thousands separator |
| `.` | Decimal point |
| `%` | Percent (multiplies by 100) |
| `;` | Section separator: `positive;negative;zero;text` (up to 4) |
| `[Red]`, `[Green]`, `[Blue]`, `[Black]`, `[White]`, `[Yellow]`, `[Cyan]`, `[Magenta]` | Named color for the section |
| `[>1000]`, `[<=0]`, `[<>0]`, `[=0]` | Section condition — route value here when condition matches |
| `[$-409]` | Excel locale tag — hint for Intl (`409` → `en-US`) |
| `"text"` | Quoted literal |
| `\c` | Escape single char |
| `yyyy`, `yy`, `mmmm`, `mmm`, `mm`, `m`, `dddd`, `ddd`, `dd`, `d`, `hh`, `h`, `nn`, `n`, `ss`, `s`, `AM/PM` | Date/time tokens |

### Tier 1 — expression brackets + icons

| Bracket | Interior | Effect |
|---|---|---|
| `[color=<expr>]` | Expression → string | `StyleObj.color` per row |
| `[bg=<expr>]` | Expression → string | `StyleObj.background` per row |
| `[weight=<expr>]` | Expression → `'normal' \| 'bold' \| number` | `StyleObj.weight` |
| `[style=<expr>]` | Expression → `'normal' \| 'italic'` | `StyleObj.italic` |
| `[if <expr>]` | Expression → boolean | Section-selector |
| `{icon:name}` | Static identifier | Fixed icon |
| `{icon:name\|<expr>}` | Dynamic name via expression | Icon name computed per row |

Field references inside expressions use single brackets — `[change]`
reads `row.change`. A complete Tier 1 formatter:

```
[color=[change] > 0 ? "#0a7" : "#d33"] $#,##0.00
{icon:trending-up|[change] > 0 ? "trending-up" : "trending-down"} $#,##0.00
```

**Sugar canonicalization** applied to bracket interiors before handoff to `@wellsfargo-starui/velocity-grid-expression`:

- `if X then Y else Z` → `(X) ? (Y) : (Z)` (recursive)
- Bare hex `#0a7`/`#00aa77`/`#00aa77ff` → string literal `"#..."`
- `rule:<id>` → `null` placeholder + reserved `RuleRefNode` for Cycle 21e

### Tier 2 — composite ColDef

```ts
{
  colId: 'summary',
  type: 'composite',
  fragments: [
    { text: 'literal ' },
    { expr: '[symbol]', style: { weight: 'bold' } },
    { expr: '[price]', format: '$#,##0.00' },
    // Dynamic fragment styles wrap the expression in [ ... ]:
    { expr: '[change]', format: '+0.00;-0.00',
      style: { color: '[[change] > 0 ? "#0a7" : "#d33"]' } },
  ],
  cellBackground: '[bg=[change] < 0 ? "#fee" : "transparent"]',
  align: 'left',        // 'left' | 'center' | 'right'
  overflow: 'ellipsis', // 'ellipsis' | 'clip'
}
```

Composite cells are:

- **Single-line only.** Row heights uniform.
- **Tooltip-ready.** Register a per-column provider via
  `grid.registerTooltipProvider(colId, fn)` — fires after a 500ms hover
  debounce with the row data; return `{ plain }` or `{ html }`.
- **Multi-format clipboard.** Copy writes `text/plain` (TSV) +
  `text/html` (styled `<span>` runs). Excel paste picks up formatting.
- **Non-editable.** Edit source columns directly.

## Backwards compatibility

**Existing `valueFormatter: (params) => string` columns work unchanged.**
The type broadening from `(params) => string` to `string | ((params) => string)`
is a superset — kernel's ColDef-resolve step detects string vs function
and only invokes the format compiler for the string form. Apps that
never call `wireIntoKernel` see zero behavior change (and pay zero
icon-bundle cost — the Lucide set loads via dynamic import only when
the bridge is wired).

## Public API

```ts
export function compileFormat(source, opts?): CompileFormatResult;
export function compileCompositeColDef(colDef, opts?): CompileFormatResult;
export function registerFormatterTemplate(def): void;
export function getFormatterTemplate(name): FormatterTemplateDef | undefined;
export function listFormatterTemplates(): string[];
export function wireIntoKernel(grid, opts?): void;

export type {
  Loc, FormatProgram, FormatSource, CompileFormatOptions,
  CompileFormatResult, CompileFormatError, FormatEvalContext,
  StyleObj, IconRef, ResolvedFragment, Fragment, FragmentStyle,
  CompositeColDef, FormatterTemplate, FormatterTemplateDef,
  FormatterTemplateContext, WireOptions, BuiltinDef,
};
```

## Error surfaces

`CompileFormatError.code` is one of:

- `excel-parse` — Tier 0 syntax error
- `excel-section-count` — too many ;-separated sections (>4)
- `tier1-parse` — Tier 1 bracket syntax error
- `expression-parse` — `expression.parse` failed inside a bracket
- `expression-compile` — `expression.compile` rejected the interior (e.g. aggregate function `SUM([price])` — ships in Cycle 21d via `@wellsfargo-starui/velocity-grid-calc`)
- `unknown-token` — unrecognized `{...}` token
- `not-yet-implemented` — reserved for future extension

Every error carries `loc: { start, end }` — char offsets into the
original format-string source. Downstream customizer editors (Cycle 21i)
use these for error underlines.

## What's not in this cycle

- `rule:<ruleId>` resolves to `null` — ships in Cycle 21e (`@wellsfargo-starui/velocity-grid-rules`).
- Aggregate expressions inside brackets — reject with `not-yet-implemented`; ships in Cycle 21d (`@wellsfargo-starui/velocity-grid-calc`).
- Customizer editor UX (autocomplete / live preview) — Cycle 21i.
- Format performance benchmarks at 60Hz × 50k rows — deferred to Cycle 20 (excel-pivot) exercise.
