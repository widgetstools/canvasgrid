# CGridExt — Format Picker for the Formatting Ribbon (+ format-DSL extensions)

- **Status:** Approved design; ready for implementation planning.
- **Date:** 2026-07-07
- **Reference UI:** user-supplied screenshots of starui's `FormatterPicker`
  (`/Users/develop/wfh/starui/packages/react-grid/grid/src/customizer/ui/FormatterPicker/`);
  the cgrid picker reaches feature/option parity with them, rebuilt plain-DOM.
- **Branch lineage:** continues `cgridext/ribbon-density` (ribbon + layouts toolbar live there).

## 1. Goal

Replace the ribbon `# Format` pill's `window.prompt()` with a full format-picker
dropdown matching the reference screenshots: CURRENT chip + clear, search,
data-type-aware category sidebar with counts, preset rows with live previews,
and a Custom tab (currency quick-insert, validated format input, Excel
reference sections). The `window.prompt` path is **deleted**.

**Decisions locked with the user:**

1. **Reach parity by extending `@cgrid/format` natively** (Phase A) so every
   preset in the screenshots is expressible as a plain, serializable format-DSL
   string — ticks, scientific, and the ƒ(x) text/bps presets included. No JS
   string is ever executed; ƒ(x) presets ride `@cgrid/expression`.
2. **Column-scoped apply**: picking a format applies to every column touched by
   the current selection (the ribbon's existing `targetCols()` rule), via
   `editColumn` own-templates — same path as the $/%/decimals buttons, so
   formats persist into layouts/exports unchanged.

## 2. Architecture

Two phases, one feature:

- **Phase A — `@cgrid/format` engine extensions.** Pure engine work; each
  extension lands with its own unit tests before any UI exists.
- **Phase B — the picker in `@cgrid/ext`.** Two new files:
  `toolbar/formatPresets.ts` (pure data + logic, no DOM) and
  `toolbar/formatPicker.ts` (plain-DOM panel; `menu()` helper from
  `toolbar/ui.ts`, `cgext-fmt-` class prefix, `--cg-*` tokens). `ribbon.ts`
  swaps the prompt handler for the panel. Lit stays customizer-only.

Because Phase A makes every preset a DSL string, the ext side needs **no
template union**: a preset is `{ id, category, label, hint?, format: string,
sample?: unknown }`; apply = existing `applyFormat(format)`; CURRENT matching =
trimmed string equality against the ribbon's existing `currentFormat()`.

## 3. Phase A — format-DSL extensions

### 3.1 Tick sections (fixed-income prices)

Format strings `TICK32`, `TICK32+`, `TICK64`, `TICK128`, `TICK256` (whole
section, case-sensitive) compile to tick formatters: integer handle + `-` +
tick count in the given denominator (`101-16` for 101.5 in 32nds), `+` variant
appends the half-tick marker (`101-16+`). The tick math is implemented inside
`@cgrid/format` (generalized denominator; the kernel's `formatPrice32` is not
imported — no kernel dependency from format — and stays untouched). Non-numeric
values format to `''` like other numeric sections.

### 3.2 Scientific notation

`0.00E+00` (and `E-00`) exponent tokens in number sections: mantissa digits per
the pattern's integer/decimal part, exponent zero-padded to the pattern's
width; `E+` always signs, `E-` signs only negatives (Excel semantics).

### 3.3 `=expr` value-formatter form

A format string beginning with `=` compiles the remainder with
`@cgrid/expression` (the engine already inside compileFormat's tier-1
brackets); the expression's result, stringified, IS the formatted output.
Eval context: `value` resolves to the cell's raw value; any other identifier
resolves to the row's fields; `value` wins a collision. Compile errors follow
the existing format-compile error path. String concatenation uses `+` (the
expression engine concatenates when both operands are strings — builtins below
return strings, and the presets are written so every concat is string+string).

**New expression builtins** (in `@cgrid/expression`, alongside UPPER/LOWER):
`TRIM(s)`, `TITLE(s)` (Title Case), `CAMEL(s)` (camelCase), `CAP(s)`
(capitalize first), `FIXED(n, dp)` (number → string with `dp` decimals, no
grouping). All total functions: null/invalid input → `''` (formatters must
never throw at paint time).

**ƒ(x) presets recast** (shown as `ƒ(x)` in the picker's code column):

| Preset | cgrid format string |
|---|---|
| Basis points | `=([value] >= 0 ? "+" : "") + FIXED([value] * 10000, 1) + " bp"` |
| UPPERCASE | `=UPPER([value])` |
| lowercase | `=LOWER([value])` |
| Title Case | `=TITLE([value])` |
| camelCase | `=CAMEL([value])` |
| Capitalize first | `=CAP([value])` |
| Trim whitespace | `=TRIM([value])` |
| Y / N (boolean) | `=[value] ? "Y" : "N"` |
| Check / — (boolean) | `=[value] ? "✓" : "—"` |

### 3.4 Verified-existing (test coverage only, no code expected)

Quoted literals (`"£"#,##0.00`, `@" units"`, `"PX "@`), conditions + colors
(`[>0][Green]▲0.00;[<0][Red]▼0.00;0.00`), and date/time tokens
(`yyyy-mm-dd hh:mm:ss`, `mm/dd/yy h:mm AM/PM`, `dd-mmm-yy`, `dd mmmm yyyy`)
get preset-catalog round-trip tests; any gap found is fixed in Phase A.

## 4. Phase B — preset catalog (`toolbar/formatPresets.ts`)

Pure data + logic, ported from starui and recast to DSL strings.

- **Types:** `FormatPreset { id, category, label, hint?, format, sample? }`;
  `FormatCategory = 'number' | 'currency' | 'percent' | 'negatives' |
  'conditional' | 'date' | 'tick' | 'text' | 'boolean'`.
- **Labels:** number→Number, currency→Currency, percent→Percent,
  negatives→"Negatives & P&L", conditional→Conditional, date→"Date & time",
  tick→Tick, text→Text, boolean→Boolean. `custom` is NOT a category — the UI
  appends the always-on `Custom #` tab.
- **`categoriesForDataType(dt)`** (first entry = default tab):
  number→`[number, negatives, conditional, tick, percent]`;
  date→`[date]`; text→`[text]`; boolean→`[boolean, text]`; unknown→`[number]`.
  (cgrid `cellDataType` is `'number' | 'text' | 'date' | 'boolean'` — the
  currency/percent-typed rails from starui collapse into the number rail,
  whose categories already include both.)
- **Presets:** the starui catalog's rows with formats mapped to cgrid DSL —
  Number 6 (Integer `#,##0`, 2/4 decimals, No thousands `0.00`, Scientific
  `0.00E+00`, Basis points ƒ(x)); Negatives & P&L 5 (Parens negative
  `#,##0.00;(#,##0.00)`, Red parens, Red negative, Green/Red (no sign),
  Green/Red $ (no sign)); Conditional 2 (Green up / red down
  `[>0][Green]▲0.00;[<0][Red]▼0.00;0.00`, Thresholds (100)
  `[>100][Red]0;[<=100][Green]0;0`); Tick 5 (`TICK32`, `TICK32+`, `TICK64`,
  `TICK128`, `TICK256`, hints `denom 32`… samples `101-16`…); Percent 3
  (`0.00%`, `0%`, Basis points ƒ(x)); Currency 12 (USD `$#,##0.00` … quoted
  `"£"`/`"¥"`/`"₹"`/`"CHF "` variants, parens/red negatives); Date & time 6
  (ISO, US, EU short `dd-mmm-yy`, Long `dd mmmm yyyy`, ISO with time, US
  short with AM/PM); Text 9 (pass-through `@`, the six ƒ(x) transforms,
  Prefix `"PX "@`, Suffix `@" units"`); Boolean 3 (ƒ(x)).
  Sidebar counts = full category size (starui behavior).
- **Samples:** number/currency 1234.5678, percent 0.1234, tick 101.5, date
  `new Date('2026-04-17T09:30:00Z')`, text `'sample'`, boolean `true` —
  per-preset `sample` overrides (e.g. bps 0.001234).
- **`filterPresets(presets, query)`**: trim+lowercase; empty → `[]` (signals
  "tabbed view"); else substring match over `label + hint + format`, catalog
  order preserved.
- **`applyCurrencySymbol(draft, symbol)`**: `$`/`€` bare; `"£"`/`"¥"`/`"₹"`/
  `"CHF "` quoted. Empty draft → `<symbol>#,##0.00`; existing currency token
  (regex `("£"|"¥"|"₹"|"[A-Z]{3} ?"|[$€])`) → replace all occurrences; else
  prepend.
- **Excel reference data**: 8 sections (Numbers & decimals 4, Currency 4,
  Percent & basis points 3, Negatives in parens / red 6, Dates & times 5,
  Conditional (directional) 2, Fixed-income tick 4, Scientific & custom text
  3) as `{ label, format, sample }` rows with **static** sample strings. Tick
  rows carry sentinel formats (`— use "32nds" preset —`) and are rendered
  disabled/informational — the real tick apply is the Tick category.

## 5. Phase B — panel UI (`toolbar/formatPicker.ts`)

`menu()`-anchored under the `# Format` pill, width ~440px, `.cgext-fmt-*`
classes, tokens + neutral-dark fallbacks, Escape closes (same pattern as the
layouts panel).

- **CURRENT row:** `CURRENT` caps label + dashed chip showing the live preview
  of the current format applied to the sample value (`—` + "No format applied"
  title when none) + a clear button (disabled when none) that removes the
  format from every target column's own template and stays open.
- **Search:** icon input, `placeholder="Search formats…"`. Non-blank query
  swaps the body for a flat result list (same row renderer); zero results show
  `No formats match "<q>". Try the Custom tab.`
- **Sidebar:** one tab per `categoriesForDataType(dataType)` entry showing the
  label + right-aligned mono count, active tab = accent text + left accent
  bar; then the always-on `Custom` tab with a `#` glyph instead of a count.
  Initial tab = the active preset's category, else the first category, and the
  Custom tab when the current format matches no preset.
- **Preset rows:** 2-col grid — left: bold label over mono code (the format
  string; `ƒ(x)` when it starts with `=`; `denom 32`-style text for ticks);
  right: **live preview** = compile the format via `@cgrid/format` and run it
  on `preset.sample ?? defaultSampleFor(dataType)` (compile/run errors → `·`).
  Hover tooltip `label · preview`. Active row (string-equal to CURRENT) gets
  the accent treatment. Click → `applyFormat(preset.format)`; panel closes
  (selection is a dismissal gesture, matching the layouts panel).
- **Custom tab:** `CUSTOM EXCEL FORMAT` heading; `SYMBOL` row of quick-insert
  buttons ($ € £ ¥ ₹ CHF) that transform the draft via `applyCurrencySymbol`
  and apply immediately (panel stays open); mono `#`-icon input live-validated
  by `compileFormat` (invalid → red border + title = compile error; valid
  non-empty → applied live); ✓ apply button (applies + closes, disabled while
  empty/invalid) and ✕ clear button (clears the draft + removes the format,
  stays open); below a hairline, the scrollable Excel reference — each row
  `label | mono code | sample + copy glyph`; clicking a copyable row copies
  the code to the clipboard AND applies it, then closes; tick sentinel rows
  are disabled.
- **Pill caption:** `# Format` becomes `# <active preset label>` when the
  current format matches a preset, `# <truncated code>` for a custom format
  (accent-tinted), plain `# Format` when none.
- **Data type:** first target column's `cellDataType` (default `number` when
  absent/unknown). No selection → the panel opens disabled with a "Select a
  cell or column first" hint row (same rule the ribbon's other format buttons
  follow via `targetCols()`).

## 6. Wiring changes (`ribbon.ts`)

- `r.fmtCode` click handler: **delete the `window.prompt` block**, open the
  picker panel instead.
- The picker consumes the ribbon's existing closures: `applyFormat(fmt)`,
  `currentFormat()`, `targetCols()`, plus a `clearFormat()` addition that
  issues `editColumn(colId, { format: null })` per target column. `format:
  null` → remove-from-own-template does **not** exist in calc yet (icons have
  it, `calcEngine.ts:377`; format goes straight to `compileFormat`) — Phase A
  adds it to `CalcEngine.editColumn`, mirroring the `cellIcon` null branch,
  with its own unit test.
- `refresh()` (ribbon state sync) also refreshes the pill caption.

## 7. Testing

- **Phase A (vitest, `packages/format`, `packages/expression`):** TDD per
  extension — tick denominators/halves/edge values (negative, 0, non-numeric),
  scientific patterns, `=expr` compile/eval incl. `value`-vs-row-field
  resolution and never-throw semantics, new builtins, and the §3.4 round-trip
  suite (every catalog preset compiles; spot-check formatted outputs match the
  screenshot samples: `1,235`, `(1,234.57)`, `101-16+`, `1.23E+03`,
  `12.34 bps`, `PX sample`, `2026-04-17 09:30:00`).
- **Phase B unit (vitest + happy-dom, `packages/ext`):** stub grid harness
  (reuse `FakeGrid` patterns) — categories per data type, counts, search flip
  + empty state, preset apply→`editColumn` call + close, CURRENT match +
  clear, custom input validation states, quick-insert transforms, reference
  row copy+apply (clipboard stubbed), tick sentinel rows disabled, destroy
  cleanup.
- **E2E (Playwright, ext demo):** open picker on a number column → Number
  category shown with counts → apply "2 decimals" → painted cell text changes
  → CURRENT chip + pill caption reflect it → persists across reload; custom
  format apply via input; clear restores default rendering; tick preset on the
  price column renders `NNN-NN`. Full demo suite green = done-gate; single
  batch closeout review + one fix wave per the standing rule.

## 8. Error handling

Format compile failures never escape: the custom input shows inline error
state; preset previews degrade to `·`; `applyFormat` failures (kernel throw)
surface via the input error/title, not the console alone. Clipboard write
failures degrade to apply-without-copy.

## 9. Out of scope

- Per-cell (range-scoped) formats — column-scoped only (locked decision).
- starui's `ValueFormatterTemplate` union / expression-policy machinery.
- The kernel column menu / customizer FormatterPicker port (Phase-3
  customizer work) — this feature is the ext ribbon surface only.
- Locale-aware currency/date rendering beyond what the DSL already does.
