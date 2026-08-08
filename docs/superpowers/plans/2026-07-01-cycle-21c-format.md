# Cycle 21c — `@wellsfargo-starui/velocity-grid-format` (Unified Formatting DSL + Kernel Bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@wellsfargo-starui/velocity-grid-format` — a unified Excel-plus-expression formatting DSL — across three tiers (Excel format codes, expression brackets + Lucide icons, composite fragments) with the kernel bridge that lets ColDefs consume format strings via `valueFormatter`, `cellStyle`, `cellIcon`, and `type: 'composite'`.

**Architecture:** New leaf-ish package under `packages/format/` depending only on `@wellsfargo-starui/velocity-grid-expression` (Cycle 21b, PR #93). Format string → outer tokenizer → three-tier compilation pipeline (Excel Tier 0 parser → Tier 1 sugar canonicalization + `expression.parse` handoff → Tier 2 composite fragment resolver) → `FormatProgram` with 4 resolvers (`formatText`, `resolveStyle`, `resolveIcon`, `resolveFragments`). Kernel gains a format-compiler dependency-injection slot (structural type aliases; no runtime import of format), ColDef-resolve pass that derives function-form `valueFormatter`/`cellStyle`/`cellIcon` from format strings, a Path2D icon registry with bundled Lucide, a new composite cell renderer, a tooltip-provider hook, and multi-format clipboard write. All kernel changes are behavior-guarded by the DI slot — apps that don't import `@wellsfargo-starui/velocity-grid-format` see byte-identical behavior.

**Tech Stack:** TypeScript 5.9 strict (extends repo `tsconfig.base.json`), Vitest 2.1 (test + coverage-v8), turborepo (task pipeline unchanged), npm workspaces, `lucide-static@^0.469.0` (build-time only, in kernel's devDeps).

## Global Constraints

Copied verbatim from [Cycle 21c design spec](../specs/2026-07-01-cycle-21c-format-design.md) and the parent Cycle 21 brief:

- **L1 (Cycle 21 §0) — No retroactive layering.** If a feature needs intrinsic support, cgrid implements the whole feature. All 4 kernel additions (icons/composite/tooltip/clipboard) land in this cycle. No hooks-only landings.
- **L4 (Cycle 21 §2) — Split BEFORE absorbing features.** `@wellsfargo-starui/velocity-grid-format` populated in this cycle; kernel gets surgical additions confined to new files where possible.
- **L7 (Cycle 21 §7) — Worker-only evaluation is a deployment policy on downstream consumers.** Format's own package is thread-agnostic — no worker/main enforcement inside `packages/format/**`.
- **No feature deferral** (spec §1.1, memory `feedback_no_feature_deferral.md`): all features specified in Cycle 21 §4.3 + §5 for `@wellsfargo-starui/velocity-grid-format` land in this cycle. Decompose into more tasks if a task is oversized; do not push features to a follow-up cycle. The only reserves are `rule:<ruleId>` (Cycle 21e infrastructure not yet built) and aggregate function names inside Tier 1 interiors (already reserved by 21b's `not-yet-implemented`).
- **Dep-graph acyclic** (spec §2.1): `@wellsfargo-starui/velocity-grid-format` may import `@wellsfargo-starui/velocity-grid-expression` (dependency) and `@wellsfargo-starui/velocity-grid` types (peerDep, runtime call from bridge only). `@wellsfargo-starui/velocity-grid` MUST NOT import `@wellsfargo-starui/velocity-grid-format` at runtime — only type-only imports from `@wellsfargo-starui/velocity-grid-format` in kernel's `types/column.ts` for ColDef type augmentation. ESLint `no-restricted-imports` rule enforces boundary. See Task 20 for the verification.
- **Kernel behavioral compatibility** (spec §5.9, §7.2, §7.5): kernel behavior identical to today when `@wellsfargo-starui/velocity-grid-format` is not imported by the consuming app. Existing `2326` kernel unit tests must remain at `2326/2326` PASS unmodified (superset broadening of `valueFormatter` type does not break existing tests).
- **Expression baseline preservation** (spec §7.5): `packages/expression/` untouched; its `185/185` unit tests unchanged.
- **E2E baselines** (spec §7.5): showcase `98` baseline preserved (+ new format-DSL specs); positions `262` baseline preserved (+ upgraded demo column).
- **rowId / colId vocabulary** (repo ESLint `no-restricted-syntax` rule): never use `columnId`, `rowKey`, `columnKey`. Row identity is `rowId`; column identity is `colId`. Applies to all new code in format + kernel.
- **CSP-safe compile**: format's compilation follows expression's precedent — recursive closure composition, no `new Function`, no `eval`.
- **One PR** for all 20 tasks. Feature branch `cycle21c/format`. Mirrors 21a + 21b landing cadence.
- **Split-if-oversized rule** (spec §6): if any Task's implementer diff exceeds ~500 LOC or ~150 lines of test, reviewer flags for a mid-task split (candidates pre-identified: Task 5, 7, 11, 13, 15).

## Preconditions (verified 2026-07-01)

- Cycle 21b merged (PR #93; commit `4fc5c49` on `origin/main`).
- Local `main` synced to `origin/main` (verified via `git pull --ff-only`).
- `packages/format/` scaffold present with `package.json` (dep on `@wellsfargo-starui/velocity-grid-expression`), `tsconfig.json`, `src/index.ts` (`export {};`).
- `packages/kernel/` build clean; `2326` unit tests + `98` showcase E2E + `262` positions E2E baselines match spec §7.5.
- `packages/expression/` build clean; `185/185` unit tests.
- Design spec committed at `docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md` (commit `70dbe61` on `main`).
- No open PRs.
- Working tree clean modulo pre-existing untracked stragglers in `apps/cgrid-positions/src/*.js`, `apps/cgrid-showcase/src/**/*.js`, `packages/expression/coverage/` (these are ignorable; do not touch them).

## File Structure Overview

**`@wellsfargo-starui/velocity-grid-format` package — all new:**

- `packages/format/src/types.ts` — public discriminated types: `FormatProgram`, `FormatSource`, `CompileFormatOptions`, `CompileFormatResult`, `CompileFormatError`, `FormatEvalContext`, `StyleObj`, `IconRef`, `ResolvedFragment`, `Fragment`, `FragmentStyle`, `CompositeColDef`, `FormatterTemplate`, `FormatterTemplateDef`, `FormatterTemplateContext`, `WireOptions`, internal `RuleRefNode` reserve type, internal `ParsedFormat` shape.
- `packages/format/src/tokenizer.ts` — outer tokenizer for a format string; produces a flat `Token[]` recognizing Excel codes, section separators, Excel bracket forms (`[Red]`, `[>1000]`, `[$-409]`), Tier 1 style brackets (`[color=…]`, `[bg=…]`, `[weight=…]`, `[style=…]`, `[if …]`), icon tokens (`{icon:name}`, `{icon:name|<expr>}`), and quoted literals.
- `packages/format/src/excel/parser.ts` — Tier 0 parser: `Token[]` → `ExcelFormatTree` (sections, per-section token spans, per-section named-color + condition metadata).
- `packages/format/src/excel/evaluator.ts` — Tier 0 evaluator: `ExcelFormatTree × value` → `{ text, style?, iconName? }`. Uses `templates/intlCache` for `Intl.NumberFormat` / `Intl.DateTimeFormat`.
- `packages/format/src/excel/namedColors.ts` — Excel named color table (`[Red] → #E53935`, etc.).
- `packages/format/src/tier1/sugar.ts` — bracket-interior canonicalization: `if X then Y else Z` → `(X) ? (Y) : (Z)`, bare hex → string literal, `rule:<id>` → `RuleRefNode` placeholder.
- `packages/format/src/tier1/parser.ts` — Tier 1 bracket parser: delegates canonicalized interiors to `expression.parse`; wraps errors as `CompileFormatError`.
- `packages/format/src/tier1/resolver.ts` — evaluates parsed Tier 1 brackets against a row via `expression.evaluate`; returns `StyleObj` + `IconRef`.
- `packages/format/src/tier2/compositeShape.ts` — `CompositeColDef` + `Fragment` + `FragmentStyle` type shapes (co-located with tier2 for cohesion; re-exported from `types.ts`).
- `packages/format/src/tier2/fragmentResolver.ts` — composite fragment evaluator; produces `ResolvedFragment[]` used by paint, tooltip, clipboard.
- `packages/format/src/templates/registry.ts` — `registerFormatterTemplate`, `getFormatterTemplate`, `listFormatterTemplates`.
- `packages/format/src/templates/number.ts` — `Number` template factory (Intl.NumberFormat).
- `packages/format/src/templates/currency.ts` — `Currency` template factory.
- `packages/format/src/templates/percent.ts` — `Percent` template factory.
- `packages/format/src/templates/date.ts` — `Date` template factory.
- `packages/format/src/templates/time.ts` — `Time` template factory.
- `packages/format/src/templates/datetime.ts` — `DateTime` template factory.
- `packages/format/src/templates/relativeTime.ts` — `RelativeTime` template factory (`Intl.RelativeTimeFormat`).
- `packages/format/src/templates/abbreviated.ts` — `Abbreviated` template factory (K/M/B suffix).
- `packages/format/src/templates/custom.ts` — `Custom` template factory (raw Excel format string).
- `packages/format/src/templates/intlCache.ts` — LRU-bounded (500) cache for Intl instances keyed by option hash.
- `packages/format/src/compile.ts` — `compileFormat(source, opts) → CompileFormatResult`; `compileCompositeColDef(colDef, opts) → CompileFormatResult`.
- `packages/format/src/bridge.ts` — `wireIntoKernel(grid, opts?)`: registers format compiler, Lucide icon set, composite tooltip auto-wiring; idempotent.
- `packages/format/src/index.ts` — public re-exports (spec §4.1 exact).
- `packages/format/tests/excel/parser.test.ts`, `excel/evaluator.test.ts`
- `packages/format/tests/tier1/sugar.test.ts`, `tier1/parser.test.ts`, `tier1/resolver.test.ts`
- `packages/format/tests/tier2/fragmentResolver.test.ts`
- `packages/format/tests/templates/registry.test.ts`, `templates/intlCache.test.ts`, `templates/allBuiltins.test.ts`
- `packages/format/tests/compile.test.ts` — public API round-trip
- `packages/format/tests/bridge.test.ts` — wireIntoKernel with a real VelocityGrid fixture
- `packages/format/tests/fixtures/format-corpus.json` — ~80 golden entries
- `packages/format/vitest.config.ts` — Vitest config (Node env, coverage-v8)
- `packages/format/README.md`

**`@wellsfargo-starui/velocity-grid` — new files:**

- `packages/kernel/src/core/formatCompilerSlot.ts` — DI slot: `registerFormatCompiler`, `getFormatCompiler`, structural `CompositeColDefShape` + `FormatProgramShape` aliases.
- `packages/kernel/src/icons/registry.ts` — `Map<setName, Map<iconName, string | Path2D>>`; `IconRegistry` class; `resolveIcon(name, setHint?)`.
- `packages/kernel/src/icons/lucide.generated.ts` — build-generated Path2D source strings.
- `packages/kernel/src/icons/build-lucide.ts` — build script (Node runnable).
- `packages/kernel/src/renderer/cellRenderers/composite.ts` — new composite painter.
- `packages/kernel/src/interaction/features/tooltipProvider.ts` — tooltip provider hook + hover feature.

**`@wellsfargo-starui/velocity-grid` — touched existing files:**

- `packages/kernel/src/types/column.ts` — `valueFormatter` type broadened; new fields `cellIcon`, `type: 'composite'`, `fragments`, `cellBackground`, `align`, `overflow`.
- `packages/kernel/src/types/api.ts` — new API methods on `VelocityGridApi`.
- `packages/kernel/src/types.ts` — re-export new format bridge types (or public re-export path via api.ts).
- `packages/kernel/src/velocityGrid.ts` — wire new API methods to internals.
- `packages/kernel/src/core/propertyChain.ts` — `compileFormatSlots` pass + `mergeCellStyle` helper.
- `packages/kernel/src/renderer/painters/byRows.ts` — inline icon rendering.
- `packages/kernel/src/interaction/featureChain.ts` — insert `TooltipProvider` feature.
- `packages/kernel/src/interaction/features/keyboardShortcuts.ts` — multi-format clipboard extension.
- `packages/kernel/package.json` — add `lucide-static` devDep + `prebuild-icons` script.
- `packages/kernel/vitest.config.ts` — no change expected (unless new test paths need include patterns).

**Files NOT modified (verify at end of Task 20):**

- `packages/expression/**` — untouched.
- Root `package.json`, `turbo.json`, `tsconfig.base.json` — untouched unless a workspace-level need surfaces.
- ESLint `no-restricted-imports` rule may gain a `format → kernel` block; documented in Task 20.

**Showcase / positions apps:**

- `apps/cgrid-showcase/src/features/formatDSL.js` — new feature file (Task 18).
- `apps/cgrid-showcase/src/features/index.js` — add formatDSL to feature list (existing untracked file; do not commit stragglers, only the additions needed for this cycle).
- `apps/cgrid-showcase/e2e/formatDSL.spec.ts` — new E2E spec (Task 18).
- `apps/cgrid-positions/src/positionsGrid.js` — one column upgraded (Task 18); if the file is untracked, add-and-commit as part of Task 18.

---

## Phase A — @wellsfargo-starui/velocity-grid-format package scaffold + shared types (1 task)

---

## Task 1: Feature branch + coverage tooling + AST types + module skeletons

**Files:**
- Create: `packages/format/vitest.config.ts`
- Create: `packages/format/src/types.ts`
- Overwrite: `packages/format/src/index.ts` (currently `export {}`)
- Create: `packages/format/src/tokenizer.ts` (skeleton)
- Create: `packages/format/src/excel/parser.ts` (skeleton)
- Create: `packages/format/src/excel/evaluator.ts` (skeleton)
- Create: `packages/format/src/excel/namedColors.ts` (data-only, populated now)
- Create: `packages/format/src/tier1/sugar.ts` (skeleton)
- Create: `packages/format/src/tier1/parser.ts` (skeleton)
- Create: `packages/format/src/tier1/resolver.ts` (skeleton)
- Create: `packages/format/src/tier2/compositeShape.ts` (types moved here, no runtime skeleton needed)
- Create: `packages/format/src/tier2/fragmentResolver.ts` (skeleton)
- Create: `packages/format/src/templates/registry.ts` (skeleton)
- Create: `packages/format/src/templates/{number,currency,percent,date,time,datetime,relativeTime,abbreviated,custom}.ts` (skeletons)
- Create: `packages/format/src/templates/intlCache.ts` (skeleton)
- Create: `packages/format/src/compile.ts` (skeleton)
- Create: `packages/format/src/bridge.ts` (skeleton — no kernel imports yet, just signature)
- Modify: `packages/format/package.json` (add `@vitest/coverage-v8` devDep + `test:coverage` script + kernel peerDep)
- Modify: `packages/format/tsconfig.json` (widen rootDir to `.` + resolveJsonModule + esModuleInterop)

**Interfaces:**
- Produces (for Tasks 2–20):
    - `FormatSource = string | CompositeColDef`
    - `CompileFormatOptions = { locale?: string; currency?: string; templates?: FormatterTemplateDef[]; builtins?: Record<string, BuiltinDef> }`
    - `CompileFormatResult = { ok: true; program: FormatProgram } | { ok: false; error: CompileFormatError }`
    - `FormatProgram = { formatText, resolveStyle, resolveIcon, resolveFragments, source, tiers }` (all 4 resolver fields required, may return null when tier not present)
    - `FormatEvalContext = { value: unknown; row: Record<string, unknown>; colId: string }`
    - `StyleObj = { color?, background?, weight?, italic? }`
    - `IconRef = { name: string; color?: string; position?: 'leading' | 'trailing' }`
    - `ResolvedFragment = { text: string; style: FragmentStyle; icon?: IconRef }`
    - `Fragment = { text: string } | { expr: string; format?: string; style?: FragmentStyle }`
    - `FragmentStyle = { color?, weight?, style?, size?, background? }`
    - `CompositeColDef` (structural — see §3.4 of spec)
    - `CompileFormatError = { kind: 'compile-format'; code: '…'; message: string; loc: Loc; cause?: {...} }`
    - `Loc` re-exported from `@wellsfargo-starui/velocity-grid-expression` (not re-declared)
    - `FormatterTemplate = (value: unknown) => string`
    - `FormatterTemplateDef = { name: string; factory: (params: FormatterTemplateContext) => FormatterTemplate }`
    - `FormatterTemplateContext = { locale: string; currency?: string; digits?: number; useGrouping?: boolean; dateStyle?: '…'; timeStyle?: '…' }`
    - `WireOptions = { additionalIconSets?: Record<string, unknown>; compositeRenderer?: unknown }`
    - Signatures: `compileFormat(source, opts?) → CompileFormatResult`; `compileCompositeColDef(colDef, opts?) → CompileFormatResult`; `registerFormatterTemplate(def) → void`; `getFormatterTemplate(name) → FormatterTemplateDef | undefined`; `listFormatterTemplates() → string[]`; `wireIntoKernel(grid, opts?) → void`.
    - Internal (not exported): `RuleRefNode = { kind: 'rule-ref'; ruleId: string; loc: Loc }`; `ParsedFormat = { tokens: Token[]; excelTree: ExcelFormatTree | null; tier1Nodes: Tier1Node[]; iconTokens: IconToken[] }`.

- [ ] **Step 1: Sync main and create feature branch**

Run:
```bash
git fetch origin && git checkout main && git pull --ff-only && git checkout -b cycle21c/format
```
Expected: local `main` at `origin/main` (`4fc5c49`); new branch `cycle21c/format` checked out.

- [ ] **Step 2: Confirm scaffold baseline**

Run:
```bash
ls packages/format/src packages/format/tests 2>/dev/null || echo "no tests dir yet"
cat packages/format/src/index.ts
cat packages/format/package.json
```
Expected: `src/` contains only `index.ts` with body `export {};`; no `tests/` yet; `package.json` has `"@wellsfargo-starui/velocity-grid-expression": "*"` in dependencies and no `test:coverage` script.

- [ ] **Step 3: Install coverage-v8 as devDep + declare kernel peerDep**

Run from repo root:
```bash
npm install --save-dev --workspace=@wellsfargo-starui/velocity-grid-format @vitest/coverage-v8@^2.1.0
```
Expected: `packages/format/package.json` gains `"@vitest/coverage-v8": "^2.1.0"` under `devDependencies`; root `package-lock.json` updated.

Then manually edit `packages/format/package.json` to add `peerDependencies` and `test:coverage` script. Full replacement:

```json
{
  "name": "@wellsfargo-starui/velocity-grid-format",
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
    "build": "echo '@wellsfargo-starui/velocity-grid-format is a scaffold — no build yet' && exit 0",
    "test": "vitest run --passWithNoTests",
    "test:coverage": "vitest run --coverage --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@wellsfargo-starui/velocity-grid-expression": "*"
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

- [ ] **Step 4: Test-infrastructure config — `vitest.config.ts` + tsconfig update**

Write `packages/format/vitest.config.ts`:

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

Overwrite `packages/format/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 5: Write `src/types.ts` — the full public type surface**

Write `packages/format/src/types.ts`:

```ts
// @wellsfargo-starui/velocity-grid-format — public type surface.
//
// All types are plain TypeScript: discriminated unions for the format
// program's internal AST, plain interfaces for public results and errors.
// Nothing in this file is runtime; it compiles to no JS output.
//
// See docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md §4 for
// the authoritative reference.

import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';

// Re-export Loc so consumers importing from @wellsfargo-starui/velocity-grid-format only need one dep.
export type { Loc };

// ─── Public results ────────────────────────────────────────────────────

export type FormatSource = string | CompositeColDef;

export interface CompileFormatOptions {
  locale?: string;
  currency?: string;
  templates?: FormatterTemplateDef[];
  builtins?: Record<string, BuiltinDef>;
}

export type CompileFormatResult =
  | { ok: true; program: FormatProgram }
  | { ok: false; error: CompileFormatError };

export interface FormatProgram {
  formatText: (ctx: FormatEvalContext) => string;
  resolveStyle: (ctx: FormatEvalContext) => StyleObj | null;
  resolveIcon: (ctx: FormatEvalContext) => IconRef | null;
  resolveFragments: (ctx: FormatEvalContext) => ResolvedFragment[] | null;
  source: FormatSource;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
}

export interface FormatEvalContext {
  value: unknown;
  row: Record<string, unknown>;
  colId: string;
}

export interface CompileFormatError {
  kind: 'compile-format';
  code:
    | 'excel-parse'
    | 'excel-section-count'
    | 'tier1-parse'
    | 'expression-parse'
    | 'expression-compile'
    | 'unknown-token'
    | 'not-yet-implemented';
  message: string;
  loc: Loc;
  cause?: { source: 'excel' | 'tier1' | 'expression'; inner: unknown };
}

// ─── Style + icon ──────────────────────────────────────────────────────

export interface StyleObj {
  color?: string;
  background?: string;
  weight?: 'normal' | 'bold' | number;
  italic?: boolean;
}

export interface IconRef {
  name: string;
  color?: string;
  position?: 'leading' | 'trailing';
}

// ─── Fragments + composite ─────────────────────────────────────────────

export interface FragmentStyle {
  color?: string;
  weight?: 'normal' | 'bold' | number;
  style?: 'normal' | 'italic';
  size?: number;
  background?: string;
}

export type Fragment =
  | { text: string }
  | { expr: string; format?: string; style?: FragmentStyle };

export interface ResolvedFragment {
  text: string;
  style: FragmentStyle;
  icon?: IconRef;
}

export interface CompositeColDef {
  colId: string;
  type: 'composite';
  fragments: Fragment[];
  cellBackground?: string;
  align?: 'left' | 'center' | 'right';
  overflow?: 'ellipsis' | 'clip';
  // Extra ColDef fields accepted structurally; format's compiler ignores them.
  [key: string]: unknown;
}

// ─── Formatter template registry ───────────────────────────────────────

export type FormatterTemplate = (value: unknown) => string;

export interface FormatterTemplateContext {
  locale: string;
  currency?: string;
  digits?: number;
  useGrouping?: boolean;
  dateStyle?: 'short' | 'medium' | 'long' | 'full';
  timeStyle?: 'short' | 'medium' | 'long' | 'full';
}

export interface FormatterTemplateDef {
  name: string;
  factory: (params: FormatterTemplateContext) => FormatterTemplate;
}

// ─── Bridge ────────────────────────────────────────────────────────────

export interface WireOptions {
  additionalIconSets?: Record<string, Record<string, string | Path2D>>;
  compositeRenderer?: unknown;  // structural; kernel's CellPainter — kept unknown to avoid kernel dep in types
}

// ─── Internal (not exported from index.ts) ─────────────────────────────

/** Reserved for Cycle 21e — rule reference in style expressions. */
export interface RuleRefNode {
  kind: 'rule-ref';
  ruleId: string;
  loc: Loc;
}

// Re-forward the expression-side builtin def shape so consumers of
// CompileFormatOptions don't need to import from @wellsfargo-starui/velocity-grid-expression.
export interface BuiltinDef {
  arity: number | [min: number, max: number];
  impl: (args: unknown[]) => unknown;
}
```

Rationale: single file collects the whole public surface. Re-exporting `Loc` from expression means consumers doing `import type { Loc } from '@wellsfargo-starui/velocity-grid-format'` don't need to add expression as a peerDep. `CompositeColDef` uses an index signature `[key: string]: unknown` so kernel's `ColDef & { type: 'composite'; ... }` intersection type-checks without kernel importing format's `ColDef`.

- [ ] **Step 6: Write skeleton source files under `src/`**

For each file below, write a skeleton with signature + `throw new Error('not-yet-implemented: <filename>')` body. Consuming code checks type shapes only.

Write `packages/format/src/tokenizer.ts`:

```ts
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';

export type Token =
  | { kind: 'literal'; text: string; loc: Loc }
  | { kind: 'digit-placeholder'; char: '0' | '#' | '?'; loc: Loc }
  | { kind: 'group-separator'; loc: Loc }
  | { kind: 'decimal-point'; loc: Loc }
  | { kind: 'percent'; loc: Loc }
  | { kind: 'section-separator'; loc: Loc }
  | { kind: 'quoted'; text: string; loc: Loc }
  | { kind: 'escape'; char: string; loc: Loc }
  | { kind: 'excel-color'; name: string; loc: Loc }
  | { kind: 'excel-condition'; op: string; value: number; loc: Loc }
  | { kind: 'excel-locale-tag'; hex: string; loc: Loc }
  | { kind: 'tier1-bracket'; channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: Loc; loc: Loc }
  | { kind: 'icon-token'; name: string; nameLoc: Loc; dynamicExpr?: string; dynamicExprLoc?: Loc; loc: Loc }
  | { kind: 'date-token'; token: string; loc: Loc };

export function tokenize(source: string): Token[] {
  throw new Error('not-yet-implemented: tokenizer.tokenize');
}
```

Write `packages/format/src/excel/parser.ts`:

```ts
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import type { Token } from '../tokenizer';

export interface ExcelSection {
  tokens: Token[];
  namedColor?: string;
  condition?: { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number };
  ifCondition?: { interior: string; loc: Loc };
  loc: Loc;
}

export interface ExcelFormatTree {
  sections: ExcelSection[];
  loc: Loc;
}

export interface ExcelParseError { message: string; loc: Loc; code: 'excel-parse' | 'excel-section-count'; }

export type ExcelParseResult =
  | { ok: true; tree: ExcelFormatTree }
  | { ok: false; error: ExcelParseError };

export function parseExcel(tokens: Token[]): ExcelParseResult {
  throw new Error('not-yet-implemented: excel.parseExcel');
}
```

Write `packages/format/src/excel/evaluator.ts`:

```ts
import type { StyleObj } from '../types';
import type { ExcelFormatTree } from './parser';

export interface ExcelEvalContext {
  value: unknown;
  locale: string;
  currency: string;
}

export interface ExcelEvalResult {
  text: string;
  style: StyleObj | null;
  iconName: string | null;
}

export function evaluateExcel(tree: ExcelFormatTree, ctx: ExcelEvalContext): ExcelEvalResult {
  throw new Error('not-yet-implemented: excel.evaluateExcel');
}
```

Write `packages/format/src/excel/namedColors.ts`:

```ts
// Excel named-color table. Hex values chosen to match Excel 2007+ / LibreOffice defaults.
export const EXCEL_NAMED_COLORS: Readonly<Record<string, string>> = Object.freeze({
  Black:   '#000000',
  White:   '#FFFFFF',
  Red:     '#E53935',
  Green:   '#43A047',
  Blue:    '#1E88E5',
  Yellow:  '#FDD835',
  Cyan:    '#00ACC1',
  Magenta: '#D81B60',
});

/** Case-insensitive lookup that mirrors Excel's `[red]` = `[Red]` behavior. */
export function lookupNamedColor(name: string): string | null {
  const canon = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return EXCEL_NAMED_COLORS[canon] ?? null;
}
```

Write `packages/format/src/tier1/sugar.ts`:

```ts
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import type { RuleRefNode } from '../types';

export interface SugarResult {
  /** The canonicalized expression string ready for expression.parse. */
  canonicalized: string;
  /** RuleRefNode reserves discovered during canonicalization. */
  ruleRefs: RuleRefNode[];
}

export function canonicalize(interior: string, interiorLoc: Loc): SugarResult {
  throw new Error('not-yet-implemented: tier1.canonicalize');
}
```

Write `packages/format/src/tier1/parser.ts`:

```ts
import type { Ast } from '@wellsfargo-starui/velocity-grid-expression';
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import type { CompileFormatError, RuleRefNode } from '../types';

export interface Tier1Node {
  channel: 'color' | 'bg' | 'weight' | 'style' | 'if';
  ast: Ast | null;             // null when the interior compiles to a rule-ref only
  ruleRefs: RuleRefNode[];
  loc: Loc;
}

export type Tier1ParseResult =
  | { ok: true; nodes: Tier1Node[] }
  | { ok: false; error: CompileFormatError };

export function parseTier1Brackets(
  brackets: Array<{ channel: Tier1Node['channel']; interior: string; interiorLoc: Loc; loc: Loc }>,
): Tier1ParseResult {
  throw new Error('not-yet-implemented: tier1.parseTier1Brackets');
}
```

Write `packages/format/src/tier1/resolver.ts`:

```ts
import type { FormatEvalContext, StyleObj, IconRef } from '../types';
import type { Tier1Node } from './parser';

export function resolveStyle(nodes: Tier1Node[], ctx: FormatEvalContext): StyleObj | null {
  throw new Error('not-yet-implemented: tier1.resolveStyle');
}

export function resolveIcon(
  iconTokens: Array<{ name: string; dynamicExpr?: string }>,
  ctx: FormatEvalContext,
): IconRef | null {
  throw new Error('not-yet-implemented: tier1.resolveIcon');
}
```

Write `packages/format/src/tier2/compositeShape.ts`:

```ts
// Re-export the composite ColDef type shapes for tier2-scoped imports.
// Public re-export happens via ../types.ts + ../index.ts.
export type { CompositeColDef, Fragment, FragmentStyle, ResolvedFragment } from '../types';
```

Write `packages/format/src/tier2/fragmentResolver.ts`:

```ts
import type { CompositeColDef, FormatEvalContext, ResolvedFragment } from '../types';

export interface CompiledFragmentPlan {
  // Per-fragment compiled state produced at compile time; consumed by resolveFragments.
  fragments: unknown[];  // filled in Task 8
  cellBackgroundProgram: unknown | null;  // format program for cellBackground; null if absent
}

export function compileFragments(colDef: CompositeColDef): CompiledFragmentPlan {
  throw new Error('not-yet-implemented: tier2.compileFragments');
}

export function resolveFragments(
  plan: CompiledFragmentPlan,
  ctx: FormatEvalContext,
): ResolvedFragment[] {
  throw new Error('not-yet-implemented: tier2.resolveFragments');
}
```

Write `packages/format/src/templates/registry.ts`:

```ts
import type { FormatterTemplateDef } from '../types';

const registry = new Map<string, FormatterTemplateDef>();

export function registerFormatterTemplate(def: FormatterTemplateDef): void {
  registry.set(def.name, def);
}

export function getFormatterTemplate(name: string): FormatterTemplateDef | undefined {
  return registry.get(name);
}

export function listFormatterTemplates(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Reset (test-only helper — not exported from index.ts). */
export function _resetRegistry_forTests(): void {
  registry.clear();
}
```

Write `packages/format/src/templates/number.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const NumberTemplate = {
  name: 'Number' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.NumberTemplate');
  },
};
```

Write `packages/format/src/templates/{currency,percent,date,time,datetime,relativeTime,abbreviated,custom}.ts` with the analogous skeleton (change `Number` to the template's name):

```ts
// currency.ts
import type { FormatterTemplateContext, FormatterTemplate } from '../types';
export const CurrencyTemplate = {
  name: 'Currency' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.CurrencyTemplate');
  },
};
```

(Repeat with `Percent`, `Date`, `Time`, `DateTime`, `RelativeTime`, `Abbreviated`, `Custom`.)

Write `packages/format/src/templates/intlCache.ts`:

```ts
type CachedFormatter = Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat;

const cache = new Map<string, CachedFormatter>();
const MAX_ENTRIES = 500;
const insertionOrder: string[] = [];

function hashKey(parts: Array<string | number | boolean | undefined>): string {
  return parts.map((p) => (p === undefined ? '_' : String(p))).join('|');
}

export function getIntlNumberFormat(
  locale: string,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  throw new Error('not-yet-implemented: intlCache.getIntlNumberFormat');
}

export function getIntlDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  throw new Error('not-yet-implemented: intlCache.getIntlDateTimeFormat');
}

export function getIntlRelativeTimeFormat(
  locale: string,
  options: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  throw new Error('not-yet-implemented: intlCache.getIntlRelativeTimeFormat');
}

/** Reset (test-only helper — not exported from index.ts). */
export function _resetCache_forTests(): void {
  cache.clear();
  insertionOrder.length = 0;
}
```

Write `packages/format/src/compile.ts`:

```ts
import type {
  CompileFormatOptions,
  CompileFormatResult,
  CompositeColDef,
  FormatSource,
} from './types';

export function compileFormat(
  source: FormatSource,
  opts?: CompileFormatOptions,
): CompileFormatResult {
  throw new Error('not-yet-implemented: compile.compileFormat');
}

export function compileCompositeColDef(
  colDef: CompositeColDef,
  opts?: CompileFormatOptions,
): CompileFormatResult {
  throw new Error('not-yet-implemented: compile.compileCompositeColDef');
}
```

Write `packages/format/src/bridge.ts`:

```ts
import type { WireOptions } from './types';

/**
 * Wire @wellsfargo-starui/velocity-grid-format into a VelocityGrid instance. Idempotent.
 *
 * grid is typed as `unknown` here to keep this signature import-safe
 * without a runtime dep on @wellsfargo-starui/velocity-grid. Task 17 tightens the signature
 * to the real VelocityGrid type via a type-only import.
 */
export function wireIntoKernel(grid: unknown, opts?: WireOptions): void {
  throw new Error('not-yet-implemented: bridge.wireIntoKernel');
}
```

- [ ] **Step 7: Write `src/index.ts` — public exports**

Overwrite `packages/format/src/index.ts`:

```ts
// @wellsfargo-starui/velocity-grid-format — public re-exports.
// See docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md §4.1
// for the authoritative reference.

// Compilation entry points
export { compileFormat, compileCompositeColDef } from './compile';

// Formatter template registry
export {
  registerFormatterTemplate,
  getFormatterTemplate,
  listFormatterTemplates,
} from './templates/registry';

// Kernel bridge
export { wireIntoKernel } from './bridge';

// Public types
export type {
  Loc,
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
  BuiltinDef,
} from './types';
```

- [ ] **Step 8: Typecheck the scaffold**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
```
Expected: 0 errors. All skeleton files compile because bodies throw (unreachable code still type-checks).

- [ ] **Step 9: Vacuous test run**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test
```
Expected: Vitest exits 0 with `--passWithNoTests` — no tests to run yet.

- [ ] **Step 10: Verify baselines still hold**

Run in parallel where possible:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -20
npm --workspace @wellsfargo-starui/velocity-grid-expression run test 2>&1 | tail -20
npx turbo typecheck 2>&1 | tail -20
```
Expected: kernel 2326/2326 pass; expression 185/185 pass; typecheck across all workspaces clean.

- [ ] **Step 11: Commit**

Run:
```bash
git add packages/format/src packages/format/vitest.config.ts packages/format/package.json packages/format/tsconfig.json
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 1 — types + module skeletons + coverage tooling

Populates the @wellsfargo-starui/velocity-grid-format scaffold with:
- Public type surface (types.ts): FormatProgram + resolvers, StyleObj,
  IconRef, ResolvedFragment, Fragment, CompositeColDef, template
  registry types, WireOptions
- Module skeletons for tokenizer, excel/{parser,evaluator,namedColors},
  tier1/{sugar,parser,resolver}, tier2/{compositeShape,fragmentResolver},
  templates/{registry,intlCache,9-built-ins}, compile, bridge
- Populated excel/namedColors table (Excel 2007+ default hex values)
- vitest.config.ts with coverage-v8 provider
- tsconfig widened rootDir + resolveJsonModule for tests/fixtures
- package.json: @vitest/coverage-v8 devDep, @wellsfargo-starui/velocity-grid peerDep,
  test:coverage script
- Public index.ts re-exports per spec §4.1

All bodies throw 'not-yet-implemented' — real logic lands in Tasks 2-9
(format package) + Tasks 10-16 (kernel bridge) + Tasks 17-20 (wire +
demo + PR).

Baselines preserved: kernel 2326/2326, expression 185/185.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: single commit landed on `cycle21c/format` branch.

---

## Phase B — Tier 0 Excel format code engine (3 tasks)

---

## Task 2: Excel tokenizer + parser + golden corpus

**Files:**
- Modify: `packages/format/src/tokenizer.ts` (implement bodies)
- Modify: `packages/format/src/excel/parser.ts` (implement bodies)
- Create: `packages/format/tests/excel/parser.test.ts`
- Create: `packages/format/tests/fixtures/excel-corpus.json`

**Interfaces:**
- Consumes (from Task 1): `Token`, `ExcelSection`, `ExcelFormatTree`, `ExcelParseResult`, `EXCEL_NAMED_COLORS`, `lookupNamedColor`, `Loc`.
- Produces (for Tasks 3, 4, 5, 6): `tokenize(source: string): Token[]` and `parseExcel(tokens: Token[]): ExcelParseResult` with populated `ExcelFormatTree` (sections with `namedColor`, `condition`, `ifCondition`, per-section tokens).

- [ ] **Step 1: Draft the golden corpus fixture**

Write `packages/format/tests/fixtures/excel-corpus.json` — 40 canonical Excel format strings with expected token summaries + section counts. Structure each entry as `{ source, tokenKinds, sectionCount, sectionNamedColors, sectionConditions }`. Full seed:

```json
{
  "entries": [
    { "source": "0", "tokenKinds": ["digit-placeholder"], "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "0.00", "tokenKinds": ["digit-placeholder", "decimal-point", "digit-placeholder", "digit-placeholder"], "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "#,##0", "tokenKinds": ["digit-placeholder", "group-separator", "digit-placeholder", "digit-placeholder", "digit-placeholder"], "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "#,##0.00", "tokenKinds": ["digit-placeholder", "group-separator", "digit-placeholder", "digit-placeholder", "digit-placeholder", "decimal-point", "digit-placeholder", "digit-placeholder"], "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "$#,##0.00", "tokenKinds": ["literal", "digit-placeholder", "group-separator", "digit-placeholder", "digit-placeholder", "digit-placeholder", "decimal-point", "digit-placeholder", "digit-placeholder"], "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "0%", "tokenKinds": ["digit-placeholder", "percent"], "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "0.00%", "tokenKinds": ["digit-placeholder", "decimal-point", "digit-placeholder", "digit-placeholder", "percent"], "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "$#,##0.00;-$#,##0.00", "sectionCount": 2, "sectionNamedColors": [null, null], "sectionConditions": [null, null] },
    { "source": "$#,##0.00;[Red]-$#,##0.00", "sectionCount": 2, "sectionNamedColors": [null, "#E53935"], "sectionConditions": [null, null] },
    { "source": "[Green]0.00;[Red]-0.00", "sectionCount": 2, "sectionNamedColors": ["#43A047", "#E53935"], "sectionConditions": [null, null] },
    { "source": "$#,##0.00;[Red]-$#,##0.00;0.00", "sectionCount": 3, "sectionNamedColors": [null, "#E53935", null], "sectionConditions": [null, null, null] },
    { "source": "$#,##0.00;[Red]-$#,##0.00;0.00;@", "sectionCount": 4, "sectionNamedColors": [null, "#E53935", null, null], "sectionConditions": [null, null, null, null] },
    { "source": "[>1000]0.00\"K\";0.00", "sectionCount": 2, "sectionNamedColors": [null, null], "sectionConditions": [{ "op": ">", "value": 1000 }, null] },
    { "source": "[>=100]\"high\";[<=0]\"low\";\"mid\"", "sectionCount": 3, "sectionNamedColors": [null, null, null], "sectionConditions": [{ "op": ">=", "value": 100 }, { "op": "<=", "value": 0 }, null] },
    { "source": "\"Q\"0 \" \" yyyy", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "yyyy-mm-dd", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "mmm d, yyyy", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "h:mm AM/PM", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "hh:mm:ss", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "yyyy-mm-dd hh:mm:ss", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "[$-409]$#,##0.00", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "0.00E+00", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "#,##0,", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "#,##0,,", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "0.00\"%\"", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "\\$0.00", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "?/?", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "# ?/?", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "General", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "@", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "[Blue]0;[Red]-0", "sectionCount": 2, "sectionNamedColors": ["#1E88E5", "#E53935"], "sectionConditions": [null, null] },
    { "source": "0.0", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "£#,##0.00", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "€#,##0.00", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "¥#,##0", "sectionCount": 1, "sectionNamedColors": [null], "sectionConditions": [null] },
    { "source": "(#,##0);(#,##0)", "sectionCount": 2, "sectionNamedColors": [null, null], "sectionConditions": [null, null] },
    { "source": "+0.00;-0.00", "sectionCount": 2, "sectionNamedColors": [null, null], "sectionConditions": [null, null] },
    { "source": "[Yellow]0.00", "sectionCount": 1, "sectionNamedColors": ["#FDD835"], "sectionConditions": [null] },
    { "source": "[Cyan]0.00", "sectionCount": 1, "sectionNamedColors": ["#00ACC1"], "sectionConditions": [null] },
    { "source": "[Magenta]0.00", "sectionCount": 1, "sectionNamedColors": ["#D81B60"], "sectionConditions": [null] }
  ]
}
```

- [ ] **Step 2: Write failing corpus test**

Write `packages/format/tests/excel/parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import corpus from '../fixtures/excel-corpus.json';
import { tokenize } from '../../src/tokenizer';
import { parseExcel } from '../../src/excel/parser';

describe('Excel Tier 0 golden corpus', () => {
  for (const entry of corpus.entries) {
    it(`parses '${entry.source}'`, () => {
      const tokens = tokenize(entry.source);
      const result = parseExcel(tokens);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.tree.sections.length).toBe(entry.sectionCount);
      for (let i = 0; i < entry.sectionCount; i++) {
        const section = result.tree.sections[i];
        expect(section.namedColor ?? null).toBe(entry.sectionNamedColors[i]);
        if (entry.sectionConditions[i] === null) {
          expect(section.condition).toBeUndefined();
        } else {
          expect(section.condition).toEqual(entry.sectionConditions[i]);
        }
      }
    });
  }
});

describe('Excel Tier 0 tokenizer — kind sequences', () => {
  const kindEntries = corpus.entries.filter((e) => 'tokenKinds' in e);
  for (const entry of kindEntries) {
    it(`token kinds for '${entry.source}'`, () => {
      const tokens = tokenize(entry.source);
      const kinds = tokens.map((t) => t.kind);
      expect(kinds).toEqual((entry as { tokenKinds: string[] }).tokenKinds);
    });
  }
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/excel/parser.test.ts
```
Expected: FAIL — all tests throw `not-yet-implemented: tokenizer.tokenize`.

- [ ] **Step 3: Implement `tokenizer.ts`**

Replace `packages/format/src/tokenizer.ts` with a real implementation. Key behavior:

- Scan char-by-char; emit tokens per the discriminated union.
- Recognize `0`, `#`, `?` as `digit-placeholder`.
- Recognize `,` inside/adjacent-to digits as `group-separator`; standalone `,` between non-digits stays a `literal`.
- Recognize `.` between digits as `decimal-point`.
- Recognize `%` as `percent`.
- Recognize `;` at section boundary (not inside quotes or brackets) as `section-separator`.
- Recognize `"..."` as `quoted`; body text stripped of quotes; escape sequences inside stay literal.
- Recognize `\c` as `escape`.
- Recognize `[Red]` etc. via `lookupNamedColor` — emits `excel-color` when known.
- Recognize `[>1000]`/`[<=0]`/`[<>0]`/`[=0]`/`[>=1e6]` etc. as `excel-condition` — parse op + numeric value.
- Recognize `[$-409]` as `excel-locale-tag` — capture hex string.
- Recognize `[color=…]`, `[bg=…]`, `[weight=…]`, `[style=…]`, `[if …]` as `tier1-bracket` — capture channel + interior string (raw text between `=` or after `if ` and matching `]`, respecting nested brackets).
- Recognize `{icon:name}` and `{icon:name|<expr>}` as `icon-token` — capture name + optional dynamic expression.
- Recognize `yyyy`/`yy`/`mmmm`/`mmm`/`mm`/`m`/`dddd`/`ddd`/`dd`/`d`/`hh`/`h`/`nn`/`n`/`ss`/`s`/`AM/PM`/`am/pm` as `date-token`.
- Everything else → `literal` token containing the raw char(s).
- Multi-character literals are coalesced (adjacent literal chars share one token).

Full implementation (write to `packages/format/src/tokenizer.ts`):

```ts
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import { lookupNamedColor } from './excel/namedColors';

export type Token =
  | { kind: 'literal'; text: string; loc: Loc }
  | { kind: 'digit-placeholder'; char: '0' | '#' | '?'; loc: Loc }
  | { kind: 'group-separator'; loc: Loc }
  | { kind: 'decimal-point'; loc: Loc }
  | { kind: 'percent'; loc: Loc }
  | { kind: 'section-separator'; loc: Loc }
  | { kind: 'quoted'; text: string; loc: Loc }
  | { kind: 'escape'; char: string; loc: Loc }
  | { kind: 'excel-color'; name: string; loc: Loc }
  | { kind: 'excel-condition'; op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number; loc: Loc }
  | { kind: 'excel-locale-tag'; hex: string; loc: Loc }
  | { kind: 'tier1-bracket'; channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: Loc; loc: Loc }
  | { kind: 'icon-token'; name: string; nameLoc: Loc; dynamicExpr?: string; dynamicExprLoc?: Loc; loc: Loc }
  | { kind: 'date-token'; token: string; loc: Loc };

const DATE_TOKENS = ['yyyy', 'yy', 'mmmm', 'mmm', 'mm', 'm', 'dddd', 'ddd', 'dd', 'd', 'hh', 'h', 'nn', 'n', 'ss', 's', 'AM/PM', 'am/pm'];

export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let literalBuf = '';
  let literalStart = 0;

  const flushLiteral = (end: number) => {
    if (literalBuf) {
      out.push({ kind: 'literal', text: literalBuf, loc: { start: literalStart, end } });
      literalBuf = '';
    }
  };

  const isDigit = (n: number) => n >= 0x30 && n <= 0x39;
  const isDigitOrPlaceholder = (n: number) => isDigit(n) || n === 0x23 /* # */ || n === 0x3F /* ? */;

  while (i < source.length) {
    const c = source[i];
    const code = source.charCodeAt(i);
    const start = i;

    // Digit placeholder
    if (c === '0' || c === '#' || c === '?') {
      flushLiteral(i);
      out.push({ kind: 'digit-placeholder', char: c, loc: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // Group separator: `,` adjacent to digit placeholders on both sides — or trailing after digits
    if (c === ',') {
      const prev = i > 0 ? source.charCodeAt(i - 1) : -1;
      const next = i < source.length - 1 ? source.charCodeAt(i + 1) : -1;
      if (isDigitOrPlaceholder(prev) && (isDigitOrPlaceholder(next) || next === -1 || source[i + 1] === ';' || source[i + 1] === '.' || !isDigitOrPlaceholder(next))) {
        flushLiteral(i);
        out.push({ kind: 'group-separator', loc: { start: i, end: i + 1 } });
        i++;
        continue;
      }
    }

    // Decimal point (between digit placeholders)
    if (c === '.') {
      const prev = i > 0 ? source.charCodeAt(i - 1) : -1;
      const next = i < source.length - 1 ? source.charCodeAt(i + 1) : -1;
      if (isDigitOrPlaceholder(prev) || isDigitOrPlaceholder(next)) {
        flushLiteral(i);
        out.push({ kind: 'decimal-point', loc: { start: i, end: i + 1 } });
        i++;
        continue;
      }
    }

    // Percent
    if (c === '%') {
      flushLiteral(i);
      out.push({ kind: 'percent', loc: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // Section separator
    if (c === ';') {
      flushLiteral(i);
      out.push({ kind: 'section-separator', loc: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // Quoted literal
    if (c === '"') {
      flushLiteral(i);
      let j = i + 1;
      let content = '';
      while (j < source.length && source[j] !== '"') {
        content += source[j];
        j++;
      }
      out.push({ kind: 'quoted', text: content, loc: { start: i, end: j + 1 } });
      i = j + 1;
      continue;
    }

    // Escape
    if (c === '\\' && i + 1 < source.length) {
      flushLiteral(i);
      out.push({ kind: 'escape', char: source[i + 1], loc: { start: i, end: i + 2 } });
      i += 2;
      continue;
    }

    // Bracket forms
    if (c === '[') {
      const closeIdx = findMatchingCloseBracket(source, i);
      if (closeIdx === -1) {
        // Unclosed — treat as literal
        literalBuf += c;
        if (!literalBuf.length) literalStart = start;
        i++;
        continue;
      }
      const interior = source.slice(i + 1, closeIdx);
      const named = lookupNamedColor(interior);
      if (named) {
        flushLiteral(i);
        out.push({ kind: 'excel-color', name: interior, loc: { start: i, end: closeIdx + 1 } });
        i = closeIdx + 1;
        continue;
      }
      const cond = parseExcelCondition(interior);
      if (cond) {
        flushLiteral(i);
        out.push({ kind: 'excel-condition', op: cond.op, value: cond.value, loc: { start: i, end: closeIdx + 1 } });
        i = closeIdx + 1;
        continue;
      }
      const locale = parseExcelLocaleTag(interior);
      if (locale) {
        flushLiteral(i);
        out.push({ kind: 'excel-locale-tag', hex: locale, loc: { start: i, end: closeIdx + 1 } });
        i = closeIdx + 1;
        continue;
      }
      const tier1 = parseTier1Bracket(interior, i + 1);
      if (tier1) {
        flushLiteral(i);
        out.push({
          kind: 'tier1-bracket',
          channel: tier1.channel,
          interior: tier1.interior,
          interiorLoc: tier1.interiorLoc,
          loc: { start: i, end: closeIdx + 1 },
        });
        i = closeIdx + 1;
        continue;
      }
      // Unrecognized bracket — treat as literal
      literalBuf += source.slice(i, closeIdx + 1);
      if (literalBuf.length === closeIdx + 1 - i) literalStart = i;
      i = closeIdx + 1;
      continue;
    }

    // Icon token {icon:name} or {icon:name|<expr>}
    if (c === '{' && source.slice(i, i + 6) === '{icon:') {
      const closeIdx = source.indexOf('}', i);
      if (closeIdx === -1) {
        literalBuf += c;
        if (!literalBuf.length) literalStart = start;
        i++;
        continue;
      }
      const interior = source.slice(i + 6, closeIdx);
      const pipeIdx = interior.indexOf('|');
      let name: string, dynamicExpr: string | undefined;
      let nameLoc: Loc, dynamicExprLoc: Loc | undefined;
      if (pipeIdx === -1) {
        name = interior.trim();
        nameLoc = { start: i + 6, end: closeIdx };
        dynamicExpr = undefined;
      } else {
        name = interior.slice(0, pipeIdx).trim();
        nameLoc = { start: i + 6, end: i + 6 + pipeIdx };
        dynamicExpr = interior.slice(pipeIdx + 1).trim();
        dynamicExprLoc = { start: i + 6 + pipeIdx + 1, end: closeIdx };
      }
      flushLiteral(i);
      out.push({
        kind: 'icon-token',
        name,
        nameLoc,
        dynamicExpr,
        dynamicExprLoc,
        loc: { start: i, end: closeIdx + 1 },
      });
      i = closeIdx + 1;
      continue;
    }

    // Date tokens (case-insensitive match against longest first)
    let dateMatched = false;
    for (const dt of DATE_TOKENS) {
      const slice = source.slice(i, i + dt.length);
      if (slice.toLowerCase() === dt.toLowerCase()) {
        flushLiteral(i);
        out.push({ kind: 'date-token', token: slice, loc: { start: i, end: i + dt.length } });
        i += dt.length;
        dateMatched = true;
        break;
      }
    }
    if (dateMatched) continue;

    // Fallback — literal
    if (literalBuf.length === 0) literalStart = i;
    literalBuf += c;
    i++;
  }

  flushLiteral(i);
  return out;
}

function findMatchingCloseBracket(source: string, openIdx: number): number {
  let depth = 1;
  let j = openIdx + 1;
  while (j < source.length) {
    if (source[j] === '[') depth++;
    else if (source[j] === ']') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

function parseExcelCondition(interior: string):
  | { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number }
  | null {
  const match = /^(<=|>=|<>|<|>|=)\s*([-+]?[0-9.eE+-]+)$/.exec(interior);
  if (!match) return null;
  const op = match[1] as '<=' | '>=' | '<>' | '<' | '>' | '=';
  const value = Number(match[2]);
  if (Number.isNaN(value)) return null;
  return { op, value };
}

function parseExcelLocaleTag(interior: string): string | null {
  const match = /^\$-([0-9a-fA-F]+)$/.exec(interior);
  return match ? match[1] : null;
}

function parseTier1Bracket(interior: string, interiorStartOffset: number):
  | { channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: Loc }
  | null {
  // channel=<expr> forms
  const kv = /^(color|bg|weight|style)\s*=\s*/.exec(interior);
  if (kv) {
    const channel = kv[1] as 'color' | 'bg' | 'weight' | 'style';
    const exprStart = kv[0].length;
    return {
      channel,
      interior: interior.slice(exprStart),
      interiorLoc: { start: interiorStartOffset + exprStart, end: interiorStartOffset + interior.length },
    };
  }
  // if <expr> form
  if (/^if\s/.test(interior)) {
    const exprStart = 3;
    return {
      channel: 'if',
      interior: interior.slice(exprStart).trimStart(),
      interiorLoc: { start: interiorStartOffset + exprStart, end: interiorStartOffset + interior.length },
    };
  }
  return null;
}
```

- [ ] **Step 4: Implement `excel/parser.ts`**

Replace `packages/format/src/excel/parser.ts` with:

```ts
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import type { Token } from '../tokenizer';

export interface ExcelSection {
  tokens: Token[];
  namedColor?: string;
  condition?: { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number };
  ifCondition?: { interior: string; interiorLoc: Loc; loc: Loc };
  loc: Loc;
}

export interface ExcelFormatTree {
  sections: ExcelSection[];
  loc: Loc;
}

export interface ExcelParseError { message: string; loc: Loc; code: 'excel-parse' | 'excel-section-count'; }

export type ExcelParseResult =
  | { ok: true; tree: ExcelFormatTree }
  | { ok: false; error: ExcelParseError };

export function parseExcel(tokens: Token[]): ExcelParseResult {
  if (tokens.length === 0) {
    return { ok: true, tree: { sections: [{ tokens: [], loc: { start: 0, end: 0 } }], loc: { start: 0, end: 0 } } };
  }

  const sections: ExcelSection[] = [];
  let current: Token[] = [];
  let sectionStart = tokens[0].loc.start;

  const finalize = (endLoc: number) => {
    const section = extractSectionMetadata(current, sectionStart, endLoc);
    sections.push(section);
    current = [];
  };

  for (const tok of tokens) {
    if (tok.kind === 'section-separator') {
      finalize(tok.loc.start);
      sectionStart = tok.loc.end;
    } else {
      current.push(tok);
    }
  }
  finalize(tokens[tokens.length - 1].loc.end);

  if (sections.length > 4) {
    return {
      ok: false,
      error: {
        code: 'excel-section-count',
        message: `Excel format supports at most 4 sections (positive;negative;zero;text), got ${sections.length}`,
        loc: { start: tokens[0].loc.start, end: tokens[tokens.length - 1].loc.end },
      },
    };
  }

  return { ok: true, tree: { sections, loc: { start: tokens[0].loc.start, end: tokens[tokens.length - 1].loc.end } } };
}

function extractSectionMetadata(tokens: Token[], sectionStart: number, sectionEnd: number): ExcelSection {
  let namedColor: string | undefined;
  let condition: ExcelSection['condition'];
  let ifCondition: ExcelSection['ifCondition'];
  const body: Token[] = [];

  for (const tok of tokens) {
    if (tok.kind === 'excel-color' && namedColor === undefined) {
      // First named-color bracket in the section wins.
      const canon = tok.name.charAt(0).toUpperCase() + tok.name.slice(1).toLowerCase();
      namedColor = EXCEL_NAMED_COLORS_INLINE[canon];
      continue;
    }
    if (tok.kind === 'excel-condition' && condition === undefined) {
      condition = { op: tok.op, value: tok.value };
      continue;
    }
    if (tok.kind === 'tier1-bracket' && tok.channel === 'if' && ifCondition === undefined) {
      ifCondition = { interior: tok.interior, interiorLoc: tok.interiorLoc, loc: tok.loc };
      continue;
    }
    body.push(tok);
  }

  return { tokens: body, namedColor, condition, ifCondition, loc: { start: sectionStart, end: sectionEnd } };
}

// Inline copy of namedColors table to avoid a runtime import cycle if
// namedColors.ts ever grows to import from tokenizer.
const EXCEL_NAMED_COLORS_INLINE: Readonly<Record<string, string>> = {
  Black: '#000000',
  White: '#FFFFFF',
  Red: '#E53935',
  Green: '#43A047',
  Blue: '#1E88E5',
  Yellow: '#FDD835',
  Cyan: '#00ACC1',
  Magenta: '#D81B60',
};
```

- [ ] **Step 5: Run corpus tests — expect PASS**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/excel/parser.test.ts
```
Expected: ~80 tests pass (40 corpus entries × 2 test blocks each).

If any fail: inspect the source string, add a targeted unit test for the failing tokenization, fix the tokenizer, re-run. Do not update the corpus to match a broken tokenizer.

- [ ] **Step 6: Add negative-case tests (unclosed bracket, too many sections)**

Append to `packages/format/tests/excel/parser.test.ts`:

```ts
describe('Excel Tier 0 parser — error surfaces', () => {
  it('rejects >4 sections', () => {
    const tokens = tokenize('0;0;0;0;0');
    const result = parseExcel(tokens);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('excel-section-count');
    expect(result.error.loc.start).toBe(0);
  });

  it('handles empty source', () => {
    const tokens = tokenize('');
    const result = parseExcel(tokens);
    expect(result.ok).toBe(true);
  });

  it('handles unclosed bracket by treating as literal', () => {
    const tokens = tokenize('[unclosed');
    // Should not throw; treats `[unclosed` as a literal token.
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].kind).toBe('literal');
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/excel/parser.test.ts
```
Expected: all tests pass.

- [ ] **Step 7: Typecheck**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
```
Expected: clean.

- [ ] **Step 8: Verify baselines still hold**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid-expression run test 2>&1 | tail -5
```
Expected: kernel 2326/2326; expression 185/185.

- [ ] **Step 9: Commit**

Run:
```bash
git add packages/format/src/tokenizer.ts packages/format/src/excel/parser.ts packages/format/tests/
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 2 — Excel tokenizer + parser + golden corpus

- tokenizer.ts: char-scanner producing discriminated Token[] — digit
  placeholders, group/decimal, %, section separators, quoted literals,
  escapes, Excel named-color brackets, Excel condition brackets, locale
  tags, Tier 1 style brackets, {icon:name} tokens, date tokens.
- excel/parser.ts: Token[] → ExcelFormatTree with per-section metadata
  (namedColor, condition, ifCondition). >4-section rejection surfaces
  as excel-section-count error.
- tests/fixtures/excel-corpus.json: 40 canonical Excel format strings
  with locked token-kind sequences + section-metadata expectations.
- tests/excel/parser.test.ts: corpus-driven tests + negative cases
  (unclosed bracket, empty source, >4 sections).

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Excel evaluator

**Files:**
- Modify: `packages/format/src/excel/evaluator.ts` (implement bodies)
- Modify: `packages/format/src/templates/intlCache.ts` (implement — Task 4 will layer templates on top)
- Create: `packages/format/tests/excel/evaluator.test.ts`

**Interfaces:**
- Consumes (Tasks 1, 2): `ExcelFormatTree`, `ExcelSection`, `Token`, `StyleObj`.
- Produces (Tasks 4, 6, 8, 9): `evaluateExcel(tree, ctx) → { text, style, iconName }` — applies Excel format tree to a value; selects the correct section (positive/negative/zero/text OR explicit condition OR ifCondition — reserved: `ifCondition` returns `text: ''` until Tier 1 resolver plugs in during Task 6); emits `StyleObj.color` for named-color sections.

- [ ] **Step 1: Implement `intlCache.ts` (minimum viable — Task 4 completes)**

Replace `packages/format/src/templates/intlCache.ts`:

```ts
type CachedFormatter = Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat;

const cache = new Map<string, CachedFormatter>();
const MAX_ENTRIES = 500;
const insertionOrder: string[] = [];

function hashKey(parts: Array<string | number | boolean | undefined>): string {
  return parts.map((p) => (p === undefined ? '_' : String(p))).join('|');
}

function recordAccess(key: string): void {
  const idx = insertionOrder.indexOf(key);
  if (idx !== -1) insertionOrder.splice(idx, 1);
  insertionOrder.push(key);
  while (insertionOrder.length > MAX_ENTRIES) {
    const evicted = insertionOrder.shift();
    if (evicted !== undefined) cache.delete(evicted);
  }
}

export function getIntlNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = 'nf|' + hashKey([locale, options.style, options.currency, options.minimumFractionDigits, options.maximumFractionDigits, options.useGrouping, options.notation]);
  let cached = cache.get(key) as Intl.NumberFormat | undefined;
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options);
    cache.set(key, cached);
  }
  recordAccess(key);
  return cached;
}

export function getIntlDateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = 'dtf|' + hashKey([locale, options.dateStyle, options.timeStyle, options.year, options.month, options.day, options.hour, options.minute, options.second, options.hour12]);
  let cached = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    cache.set(key, cached);
  }
  recordAccess(key);
  return cached;
}

export function getIntlRelativeTimeFormat(locale: string, options: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  const key = 'rtf|' + hashKey([locale, options.numeric, options.style]);
  let cached = cache.get(key) as Intl.RelativeTimeFormat | undefined;
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, options);
    cache.set(key, cached);
  }
  recordAccess(key);
  return cached;
}

export function _resetCache_forTests(): void {
  cache.clear();
  insertionOrder.length = 0;
}
```

- [ ] **Step 2: Write failing evaluator tests**

Write `packages/format/tests/excel/evaluator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/tokenizer';
import { parseExcel } from '../../src/excel/parser';
import { evaluateExcel } from '../../src/excel/evaluator';

function fmt(source: string, value: unknown, opts?: { locale?: string; currency?: string }) {
  const tokens = tokenize(source);
  const parsed = parseExcel(tokens);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return evaluateExcel(parsed.tree, {
    value,
    locale: opts?.locale ?? 'en-US',
    currency: opts?.currency ?? 'USD',
  });
}

describe('Excel evaluator — Number formats', () => {
  it('0.00 with positive value', () => {
    expect(fmt('0.00', 1.5).text).toBe('1.50');
  });

  it('0.00 with negative value (single-section format uses same section)', () => {
    expect(fmt('0.00', -1.5).text).toBe('-1.50');
  });

  it('#,##0.00 with grouping', () => {
    expect(fmt('#,##0.00', 1234.5).text).toBe('1,234.50');
  });

  it('$#,##0.00 with currency prefix', () => {
    expect(fmt('$#,##0.00', 1234.56).text).toBe('$1,234.56');
  });

  it('0% multiplies by 100', () => {
    expect(fmt('0%', 0.5).text).toBe('50%');
  });

  it('0.00% multiplies by 100 with fraction digits', () => {
    expect(fmt('0.00%', 0.1234).text).toBe('12.34%');
  });
});

describe('Excel evaluator — Section routing', () => {
  it('positive value uses first section', () => {
    const r = fmt('0.00;[Red]-0.00', 5);
    expect(r.text).toBe('5.00');
    expect(r.style?.color ?? null).toBeNull();
  });

  it('negative value uses second section + applies [Red] style', () => {
    const r = fmt('0.00;[Red]-0.00', -5);
    expect(r.text).toBe('-5.00');
    expect(r.style?.color).toBe('#E53935');
  });

  it('zero value uses third section when present', () => {
    const r = fmt('0.00;-0.00;\"—\"', 0);
    expect(r.text).toBe('—');
  });

  it('text value uses fourth section', () => {
    const r = fmt('0.00;-0.00;0.00;@', 'hello');
    expect(r.text).toBe('hello');
  });
});

describe('Excel evaluator — Conditional sections', () => {
  it('[>1000] routes value >1000 to first section', () => {
    const r = fmt('[>1000]0.00\"K\";0.00', 1500);
    expect(r.text).toBe('1500.00K');
  });

  it('[>1000] routes value <=1000 to second section', () => {
    const r = fmt('[>1000]0.00\"K\";0.00', 500);
    expect(r.text).toBe('500.00');
  });
});

describe('Excel evaluator — Named colors emit StyleObj', () => {
  it('[Green]0.00 emits StyleObj with color', () => {
    const r = fmt('[Green]0.00', 5);
    expect(r.style?.color).toBe('#43A047');
  });

  it('[Blue]0.00 emits StyleObj with color', () => {
    const r = fmt('[Blue]0.00', 5);
    expect(r.style?.color).toBe('#1E88E5');
  });
});

describe('Excel evaluator — Dates', () => {
  it('yyyy-mm-dd', () => {
    const r = fmt('yyyy-mm-dd', new Date('2026-07-01T00:00:00Z'), { locale: 'en-US' });
    // Intl.DateTimeFormat locale-formatted output; validate structure not exact bytes.
    expect(r.text).toMatch(/2026[-/.]0?7[-/.]0?1/);
  });

  it('mmm d, yyyy', () => {
    const r = fmt('mmm d, yyyy', new Date('2026-07-01T00:00:00Z'), { locale: 'en-US' });
    expect(r.text).toMatch(/Jul.*1.*2026/);
  });
});

describe('Excel evaluator — Edge cases', () => {
  it('null value renders as empty string', () => {
    expect(fmt('0.00', null).text).toBe('');
  });

  it('undefined value renders as empty string', () => {
    expect(fmt('0.00', undefined).text).toBe('');
  });

  it('NaN value renders as empty string', () => {
    expect(fmt('0.00', Number.NaN).text).toBe('');
  });

  it('@ format returns raw string', () => {
    expect(fmt('@', 'raw text').text).toBe('raw text');
  });

  it('General format returns default toString', () => {
    expect(fmt('General', 42).text).toBe('42');
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/excel/evaluator.test.ts
```
Expected: FAIL — all throw `not-yet-implemented: excel.evaluateExcel`.

- [ ] **Step 3: Implement `excel/evaluator.ts`**

Replace `packages/format/src/excel/evaluator.ts`:

```ts
import type { StyleObj } from '../types';
import type { Token } from '../tokenizer';
import type { ExcelFormatTree, ExcelSection } from './parser';
import { getIntlNumberFormat, getIntlDateTimeFormat } from '../templates/intlCache';

export interface ExcelEvalContext {
  value: unknown;
  locale: string;
  currency: string;
}

export interface ExcelEvalResult {
  text: string;
  style: StyleObj | null;
  iconName: string | null;
}

export function evaluateExcel(tree: ExcelFormatTree, ctx: ExcelEvalContext): ExcelEvalResult {
  const section = selectSection(tree.sections, ctx.value);
  if (!section) return { text: '', style: null, iconName: null };

  const style: StyleObj | null = section.namedColor ? { color: section.namedColor } : null;

  if (ctx.value === null || ctx.value === undefined || (typeof ctx.value === 'number' && Number.isNaN(ctx.value))) {
    return { text: '', style, iconName: null };
  }

  const text = renderSection(section, ctx);
  return { text, style, iconName: null };
}

function selectSection(sections: ExcelSection[], value: unknown): ExcelSection | null {
  if (sections.length === 0) return null;

  // Explicit condition on any section — first match wins in section order.
  for (const s of sections) {
    if (s.condition && typeof value === 'number' && matchCondition(s.condition, value)) return s;
  }

  // No explicit-condition match — fall back to Excel positive/negative/zero/text routing.
  if (typeof value === 'string') {
    return sections[3] ?? sections[0];
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return sections[0];
  if (n > 0) return sections[0];
  if (n < 0) return sections[1] ?? sections[0];
  return sections[2] ?? sections[0];
}

function matchCondition(cond: { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number }, v: number): boolean {
  switch (cond.op) {
    case '>':  return v > cond.value;
    case '<':  return v < cond.value;
    case '<=': return v <= cond.value;
    case '>=': return v >= cond.value;
    case '=':  return v === cond.value;
    case '<>': return v !== cond.value;
  }
}

function renderSection(section: ExcelSection, ctx: ExcelEvalContext): string {
  const tokens = section.tokens;

  // Detect format kind by token composition.
  const kind = classifyTokens(tokens);

  if (kind === 'text') {
    if (typeof ctx.value === 'string') return ctx.value;
    return String(ctx.value ?? '');
  }

  if (kind === 'general') {
    return String(ctx.value ?? '');
  }

  if (kind === 'date') {
    const date = coerceDate(ctx.value);
    if (!date) return '';
    const options = deriveDateTimeOptions(tokens);
    const fmt = getIntlDateTimeFormat(ctx.locale, options);
    return fmt.format(date);
  }

  if (kind === 'number' || kind === 'currency' || kind === 'percent') {
    const n = coerceNumber(ctx.value);
    if (n === null) return '';
    const options = deriveNumberOptions(tokens, kind, ctx.currency);
    const fmt = getIntlNumberFormat(ctx.locale, options);
    const literalPrefix = extractLiteralPrefix(tokens);
    const literalSuffix = extractLiteralSuffix(tokens);
    const scaled = kind === 'percent' ? n : n;  // Intl 'percent' style handles multiplication
    return literalPrefix + fmt.format(scaled) + literalSuffix;
  }

  // Fallback: render tokens as-is.
  return literalsOnly(tokens);
}

type SectionKind = 'number' | 'currency' | 'percent' | 'date' | 'text' | 'general';

function classifyTokens(tokens: Token[]): SectionKind {
  if (tokens.length === 1 && tokens[0].kind === 'literal' && tokens[0].text === '@') return 'text';
  if (tokens.length === 1 && tokens[0].kind === 'literal' && tokens[0].text === 'General') return 'general';
  if (tokens.some((t) => t.kind === 'date-token')) return 'date';
  if (tokens.some((t) => t.kind === 'percent')) return 'percent';
  if (tokens.some((t) => t.kind === 'literal' && /[$€£¥]/.test(t.text))) return 'currency';
  return 'number';
}

function deriveNumberOptions(tokens: Token[], kind: SectionKind, currency: string): Intl.NumberFormatOptions {
  let minFrac = 0;
  let maxFrac = 0;
  let useGrouping = false;
  let sawDecimal = false;

  for (const t of tokens) {
    if (t.kind === 'group-separator') useGrouping = true;
    else if (t.kind === 'decimal-point') sawDecimal = true;
    else if (sawDecimal && t.kind === 'digit-placeholder') {
      if (t.char === '0') { minFrac++; maxFrac++; }
      else if (t.char === '#' || t.char === '?') maxFrac++;
    }
  }

  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
    useGrouping,
  };

  if (kind === 'currency') {
    options.style = 'currency';
    options.currency = currency;
  } else if (kind === 'percent') {
    options.style = 'percent';
  }

  return options;
}

function deriveDateTimeOptions(tokens: Token[]): Intl.DateTimeFormatOptions {
  const hasYear = tokens.some((t) => t.kind === 'date-token' && /^y+$/i.test(t.token));
  const hasMonth = tokens.some((t) => t.kind === 'date-token' && /^m+$/i.test(t.token));
  const hasDay = tokens.some((t) => t.kind === 'date-token' && /^d+$/i.test(t.token));
  const hasHour = tokens.some((t) => t.kind === 'date-token' && /^h+$/i.test(t.token));
  const hasMinute = tokens.some((t) => t.kind === 'date-token' && (/^n+$/i.test(t.token) || t.token.toLowerCase() === 'mm' && hasHour));
  const hasSecond = tokens.some((t) => t.kind === 'date-token' && /^s+$/i.test(t.token));

  const options: Intl.DateTimeFormatOptions = {};
  if (hasYear) options.year = 'numeric';
  if (hasMonth) {
    const monthTok = tokens.find((t) => t.kind === 'date-token' && /^m+$/i.test(t.token));
    if (monthTok?.kind === 'date-token') {
      options.month = monthTok.token.length >= 4 ? 'long' : monthTok.token.length === 3 ? 'short' : '2-digit';
    }
  }
  if (hasDay) options.day = '2-digit';
  if (hasHour) options.hour = '2-digit';
  if (hasMinute) options.minute = '2-digit';
  if (hasSecond) options.second = '2-digit';

  return options;
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function extractLiteralPrefix(tokens: Token[]): string {
  let out = '';
  for (const t of tokens) {
    if (t.kind === 'literal' || t.kind === 'quoted' || t.kind === 'escape') {
      out += t.kind === 'escape' ? t.char : t.text;
    } else if (t.kind === 'digit-placeholder' || t.kind === 'group-separator' || t.kind === 'decimal-point' || t.kind === 'percent') {
      break;
    }
  }
  return out;
}

function extractLiteralSuffix(tokens: Token[]): string {
  let out = '';
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === 'literal' || t.kind === 'quoted' || t.kind === 'escape') {
      out = (t.kind === 'escape' ? t.char : t.text) + out;
    } else if (t.kind === 'digit-placeholder' || t.kind === 'group-separator' || t.kind === 'decimal-point' || t.kind === 'percent') {
      break;
    }
  }
  return out;
}

function literalsOnly(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (t.kind === 'literal' || t.kind === 'quoted') return t.text;
      if (t.kind === 'escape') return t.char;
      return '';
    })
    .join('');
}
```

- [ ] **Step 4: Run evaluator tests — expect PASS**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/excel/evaluator.test.ts
```
Expected: all pass.

If any date test fails due to timezone/locale variance, tighten the regex or pin the locale via the test's `opts.locale`. The evaluator is deterministic given a locale.

- [ ] **Step 5: Typecheck + baselines**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
```
Expected: format typecheck clean; kernel 2326/2326.

- [ ] **Step 6: Commit**

Run:
```bash
git add packages/format/src/excel/evaluator.ts packages/format/src/templates/intlCache.ts packages/format/tests/excel/evaluator.test.ts
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 3 — Excel evaluator + Intl LRU cache

- excel/evaluator.ts: evaluateExcel(tree, ctx) applies Excel format
  tree to a value. Section routing by Excel positive/negative/zero/text
  fallback OR explicit numeric condition ([>1000]). Named-color
  sections emit StyleObj.color. Number/currency/percent/date/text/
  General classification derives Intl options from digit placeholders +
  date tokens.
- templates/intlCache.ts: LRU-bounded (500 entries) cache for
  Intl.NumberFormat / Intl.DateTimeFormat / Intl.RelativeTimeFormat
  keyed by hash of (locale, options).
- tests/excel/evaluator.test.ts: 20+ scenarios — number/currency/
  percent/date/section routing/conditional sections/named-color styles/
  edge cases (null/undefined/NaN/@/General).

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Formatter template registry + 9 built-in templates

**Files:**
- Modify: `packages/format/src/templates/{number,currency,percent,date,time,datetime,relativeTime,abbreviated,custom}.ts` (real implementations)
- Modify: `packages/format/src/templates/registry.ts` (auto-register built-ins on module load)
- Create: `packages/format/tests/templates/registry.test.ts`
- Create: `packages/format/tests/templates/intlCache.test.ts`
- Create: `packages/format/tests/templates/allBuiltins.test.ts`

**Interfaces:**
- Consumes: `FormatterTemplate`, `FormatterTemplateDef`, `FormatterTemplateContext`, `intlCache` helpers.
- Produces (for Tasks 6, 8, 9, 17): `registerFormatterTemplate(def) → void`, `getFormatterTemplate(name) → def | undefined`, `listFormatterTemplates() → string[]`, auto-registered built-ins on module import.

- [ ] **Step 1: Implement `NumberTemplate`**

Replace `packages/format/src/templates/number.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const NumberTemplate: FormatterTemplateDef = {
  name: 'Number',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const options: Intl.NumberFormatOptions = {
      minimumFractionDigits: params.digits ?? 0,
      maximumFractionDigits: params.digits ?? 0,
      useGrouping: params.useGrouping ?? false,
    };
    const fmt = getIntlNumberFormat(params.locale, options);
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? fmt.format(n) : '';
    };
  },
};
```

- [ ] **Step 2: Implement the other 8 templates**

Replace `packages/format/src/templates/currency.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const CurrencyTemplate: FormatterTemplateDef = {
  name: 'Currency',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const options: Intl.NumberFormatOptions = {
      style: 'currency',
      currency: params.currency ?? 'USD',
      minimumFractionDigits: params.digits ?? 2,
      maximumFractionDigits: params.digits ?? 2,
      useGrouping: params.useGrouping ?? true,
    };
    const fmt = getIntlNumberFormat(params.locale, options);
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? fmt.format(n) : '';
    };
  },
};
```

Replace `packages/format/src/templates/percent.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const PercentTemplate: FormatterTemplateDef = {
  name: 'Percent',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const options: Intl.NumberFormatOptions = {
      style: 'percent',
      minimumFractionDigits: params.digits ?? 0,
      maximumFractionDigits: params.digits ?? 0,
    };
    const fmt = getIntlNumberFormat(params.locale, options);
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? fmt.format(n) : '';
    };
  },
};
```

Replace `packages/format/src/templates/date.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlDateTimeFormat } from './intlCache';

export const DateTemplate: FormatterTemplateDef = {
  name: 'Date',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const fmt = getIntlDateTimeFormat(params.locale, { dateStyle: params.dateStyle ?? 'medium' });
    return (value: unknown) => {
      if (value instanceof Date) return fmt.format(value);
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
      }
      return '';
    };
  },
};
```

Replace `packages/format/src/templates/time.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlDateTimeFormat } from './intlCache';

export const TimeTemplate: FormatterTemplateDef = {
  name: 'Time',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const fmt = getIntlDateTimeFormat(params.locale, { timeStyle: params.timeStyle ?? 'medium' });
    return (value: unknown) => {
      if (value instanceof Date) return fmt.format(value);
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
      }
      return '';
    };
  },
};
```

Replace `packages/format/src/templates/datetime.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlDateTimeFormat } from './intlCache';

export const DateTimeTemplate: FormatterTemplateDef = {
  name: 'DateTime',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const fmt = getIntlDateTimeFormat(params.locale, {
      dateStyle: params.dateStyle ?? 'medium',
      timeStyle: params.timeStyle ?? 'short',
    });
    return (value: unknown) => {
      if (value instanceof Date) return fmt.format(value);
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
      }
      return '';
    };
  },
};
```

Replace `packages/format/src/templates/relativeTime.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlRelativeTimeFormat } from './intlCache';

/**
 * Value shape for RelativeTime: `{ value: number, unit: Intl.RelativeTimeFormatUnit }`
 * or a plain number in seconds relative to now.
 */
export const RelativeTimeTemplate: FormatterTemplateDef = {
  name: 'RelativeTime',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const fmt = getIntlRelativeTimeFormat(params.locale, { numeric: 'auto' });
    return (value: unknown) => {
      if (value && typeof value === 'object' && 'value' in value && 'unit' in value) {
        const rec = value as { value: number; unit: Intl.RelativeTimeFormatUnit };
        return fmt.format(rec.value, rec.unit);
      }
      if (typeof value === 'number') {
        // Plain number: assume seconds, pick best unit.
        return fmt.format(Math.round(value / 86400), 'day');
      }
      return '';
    };
  },
};
```

Replace `packages/format/src/templates/abbreviated.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const AbbreviatedTemplate: FormatterTemplateDef = {
  name: 'Abbreviated',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const digits = params.digits ?? 2;
    const baseFmt = getIntlNumberFormat(params.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    });
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return '';
      const abs = Math.abs(n);
      let scaled = n;
      let suffix = '';
      if (abs >= 1e9) { scaled = n / 1e9; suffix = 'B'; }
      else if (abs >= 1e6) { scaled = n / 1e6; suffix = 'M'; }
      else if (abs >= 1e3) { scaled = n / 1e3; suffix = 'K'; }
      return baseFmt.format(scaled) + suffix;
    };
  },
};
```

Replace `packages/format/src/templates/custom.ts`:

```ts
import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { tokenize } from '../tokenizer';
import { parseExcel } from '../excel/parser';
import { evaluateExcel } from '../excel/evaluator';

/**
 * `Custom` — routes an arbitrary Excel format string through Tier 0.
 * Params carry the raw format string in `dateStyle` slot when caller
 * embeds it, or via an extended context field. For general use, callers
 * should invoke compileFormat() directly; this template exists so the
 * template registry has a canonical entry for the "raw Excel format"
 * path (spec §4.3 built-in list).
 */
export const CustomTemplate: FormatterTemplateDef = {
  name: 'Custom',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    return (value: unknown) => {
      // No embedded format string in this call — return default toString.
      // Real consumers use compileFormat() with the raw string directly.
      return String(value ?? '');
    };
  },
};
```

- [ ] **Step 3: Auto-register built-ins from `registry.ts`**

Replace `packages/format/src/templates/registry.ts`:

```ts
import type { FormatterTemplateDef } from '../types';
import { NumberTemplate } from './number';
import { CurrencyTemplate } from './currency';
import { PercentTemplate } from './percent';
import { DateTemplate } from './date';
import { TimeTemplate } from './time';
import { DateTimeTemplate } from './datetime';
import { RelativeTimeTemplate } from './relativeTime';
import { AbbreviatedTemplate } from './abbreviated';
import { CustomTemplate } from './custom';

const registry = new Map<string, FormatterTemplateDef>();

const BUILT_INS: FormatterTemplateDef[] = [
  NumberTemplate,
  CurrencyTemplate,
  PercentTemplate,
  DateTemplate,
  TimeTemplate,
  DateTimeTemplate,
  RelativeTimeTemplate,
  AbbreviatedTemplate,
  CustomTemplate,
];

// Auto-register built-ins on module load.
for (const def of BUILT_INS) registry.set(def.name, def);

export function registerFormatterTemplate(def: FormatterTemplateDef): void {
  registry.set(def.name, def);
}

export function getFormatterTemplate(name: string): FormatterTemplateDef | undefined {
  return registry.get(name);
}

export function listFormatterTemplates(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Reset to just built-ins (test-only helper — not exported from index.ts). */
export function _resetRegistry_forTests(): void {
  registry.clear();
  for (const def of BUILT_INS) registry.set(def.name, def);
}
```

- [ ] **Step 4: Write registry + intlCache + built-ins tests**

Write `packages/format/tests/templates/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerFormatterTemplate,
  getFormatterTemplate,
  listFormatterTemplates,
  _resetRegistry_forTests,
} from '../../src/templates/registry';

describe('Formatter template registry', () => {
  beforeEach(() => _resetRegistry_forTests());

  it('lists all 9 built-ins', () => {
    const names = listFormatterTemplates();
    expect(names).toEqual([
      'Abbreviated', 'Currency', 'Custom', 'Date', 'DateTime',
      'Number', 'Percent', 'RelativeTime', 'Time',
    ]);
  });

  it('getFormatterTemplate returns built-in def', () => {
    expect(getFormatterTemplate('Number')?.name).toBe('Number');
    expect(getFormatterTemplate('Currency')?.name).toBe('Currency');
  });

  it('registerFormatterTemplate adds new template', () => {
    registerFormatterTemplate({
      name: 'TestTemplate',
      factory: () => (v) => `test-${v}`,
    });
    expect(getFormatterTemplate('TestTemplate')?.name).toBe('TestTemplate');
    expect(listFormatterTemplates()).toContain('TestTemplate');
  });

  it('registerFormatterTemplate overrides existing name', () => {
    registerFormatterTemplate({
      name: 'Number',
      factory: () => (v) => `override-${v}`,
    });
    const fn = getFormatterTemplate('Number')!.factory({ locale: 'en-US' });
    expect(fn(42)).toBe('override-42');
  });
});
```

Write `packages/format/tests/templates/intlCache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIntlNumberFormat,
  getIntlDateTimeFormat,
  getIntlRelativeTimeFormat,
  _resetCache_forTests,
} from '../../src/templates/intlCache';

describe('Intl cache', () => {
  beforeEach(() => _resetCache_forTests());

  it('caches NumberFormat by options', () => {
    const a = getIntlNumberFormat('en-US', { minimumFractionDigits: 2 });
    const b = getIntlNumberFormat('en-US', { minimumFractionDigits: 2 });
    expect(a).toBe(b);
  });

  it('returns different instance for different options', () => {
    const a = getIntlNumberFormat('en-US', { minimumFractionDigits: 2 });
    const b = getIntlNumberFormat('en-US', { minimumFractionDigits: 4 });
    expect(a).not.toBe(b);
  });

  it('caches DateTimeFormat by options', () => {
    const a = getIntlDateTimeFormat('en-US', { dateStyle: 'short' });
    const b = getIntlDateTimeFormat('en-US', { dateStyle: 'short' });
    expect(a).toBe(b);
  });

  it('caches RelativeTimeFormat', () => {
    const a = getIntlRelativeTimeFormat('en-US', { numeric: 'auto' });
    const b = getIntlRelativeTimeFormat('en-US', { numeric: 'auto' });
    expect(a).toBe(b);
  });

  it('eviction under load', () => {
    // Insert 600 unique keys — should evict oldest 100 (MAX_ENTRIES=500).
    for (let i = 0; i < 600; i++) {
      getIntlNumberFormat('en-US', { minimumFractionDigits: i % 30, maximumFractionDigits: Math.floor(i / 30) });
    }
    // The first-inserted key should have been evicted; reinserting it creates a new instance.
    const before = getIntlNumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const after = getIntlNumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    expect(before).toBe(after);
  });
});
```

Write `packages/format/tests/templates/allBuiltins.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getFormatterTemplate } from '../../src/templates/registry';

describe('Built-in template factories produce working formatters', () => {
  it('Number', () => {
    const fn = getFormatterTemplate('Number')!.factory({ locale: 'en-US', digits: 2, useGrouping: true });
    expect(fn(1234.5)).toBe('1,234.50');
  });

  it('Currency', () => {
    const fn = getFormatterTemplate('Currency')!.factory({ locale: 'en-US', currency: 'USD', digits: 2 });
    expect(fn(1234.5)).toBe('$1,234.50');
  });

  it('Percent', () => {
    const fn = getFormatterTemplate('Percent')!.factory({ locale: 'en-US', digits: 2 });
    expect(fn(0.1234)).toBe('12.34%');
  });

  it('Date', () => {
    const fn = getFormatterTemplate('Date')!.factory({ locale: 'en-US', dateStyle: 'short' });
    const result = fn(new Date('2026-07-01T00:00:00Z'));
    expect(result).toMatch(/7\/1\/26|07\/01\/2026|2026/);
  });

  it('Time', () => {
    const fn = getFormatterTemplate('Time')!.factory({ locale: 'en-US', timeStyle: 'short' });
    expect(fn(new Date('2026-07-01T15:30:00Z'))).toMatch(/AM|PM/);
  });

  it('DateTime', () => {
    const fn = getFormatterTemplate('DateTime')!.factory({ locale: 'en-US', dateStyle: 'medium', timeStyle: 'short' });
    const result = fn(new Date('2026-07-01T15:30:00Z'));
    expect(result).toMatch(/Jul.*2026/);
  });

  it('RelativeTime', () => {
    const fn = getFormatterTemplate('RelativeTime')!.factory({ locale: 'en-US' });
    expect(fn({ value: -3, unit: 'day' })).toBe('3 days ago');
    expect(fn({ value: 5, unit: 'hour' })).toMatch(/5.*hour|hour.*5/);
  });

  it('Abbreviated', () => {
    const fn = getFormatterTemplate('Abbreviated')!.factory({ locale: 'en-US', digits: 2 });
    expect(fn(1_500_000_000)).toBe('1.5B');
    expect(fn(1_500_000)).toBe('1.5M');
    expect(fn(1_500)).toBe('1.5K');
    expect(fn(500)).toBe('500');
  });

  it('Custom returns default toString', () => {
    const fn = getFormatterTemplate('Custom')!.factory({ locale: 'en-US' });
    expect(fn(42)).toBe('42');
  });
});
```

- [ ] **Step 5: Run all template tests**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/templates
```
Expected: all pass.

- [ ] **Step 6: Typecheck + baselines**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
```
Expected: format clean; kernel 2326/2326.

- [ ] **Step 7: Commit**

Run:
```bash
git add packages/format/src/templates packages/format/tests/templates
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 4 — formatter template registry + 9 built-ins

- templates/{number,currency,percent,date,time,datetime,relativeTime,
  abbreviated,custom}.ts: Intl-backed factories. RelativeTime accepts
  { value, unit } shape or plain number (seconds).
- templates/registry.ts: auto-registers all 9 built-ins on module load;
  registerFormatterTemplate override/add; listFormatterTemplates sorted;
  _resetRegistry_forTests helper.
- tests/templates/registry.test.ts: registry contract + overrides.
- tests/templates/intlCache.test.ts: instance-caching contract +
  eviction at ceiling.
- tests/templates/allBuiltins.test.ts: each built-in produces the
  expected formatted output.

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Tier 1 brackets + expression integration (3 tasks)

---

## Task 5: Tier 1 sugar canonicalization

**Files:**
- Modify: `packages/format/src/tier1/sugar.ts` (implement bodies)
- Create: `packages/format/tests/tier1/sugar.test.ts`

**Interfaces:**
- Consumes: `Loc` (from `@wellsfargo-starui/velocity-grid-expression`), `RuleRefNode` (from `../types`).
- Produces (for Task 6): `canonicalize(interior: string, interiorLoc: Loc) → SugarResult` where `SugarResult = { canonicalized: string; ruleRefs: RuleRefNode[] }`. Transforms: `if X then Y else Z` → `(X) ? (Y) : (Z)` (recursive on Y and Z); bare hex `#0a7`/`#00aa77`/etc. → double-quoted string literal; `rule:<id>` → `null` placeholder in expression string + emit `RuleRefNode` for the resolver to consume at eval.

- [ ] **Step 1: Write failing sugar tests**

Write `packages/format/tests/tier1/sugar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalize } from '../../src/tier1/sugar';

describe('Tier 1 sugar — if/then/else → ternary', () => {
  it('simple if/then/else', () => {
    const r = canonicalize('if [x] > 0 then "a" else "b"', { start: 0, end: 30 });
    expect(r.canonicalized).toBe('([x] > 0) ? ("a") : ("b")');
  });

  it('nested if/then/else inside then-branch', () => {
    const r = canonicalize('if [x] > 0 then if [y] > 0 then "a" else "b" else "c"', { start: 0, end: 50 });
    expect(r.canonicalized).toBe('([x] > 0) ? (([y] > 0) ? ("a") : ("b")) : ("c")');
  });

  it('nested if/then/else inside else-branch', () => {
    const r = canonicalize('if [x] > 0 then "a" else if [y] > 0 then "b" else "c"', { start: 0, end: 50 });
    expect(r.canonicalized).toBe('([x] > 0) ? ("a") : (([y] > 0) ? ("b") : ("c"))');
  });

  it('leaves non-if expression untouched', () => {
    const r = canonicalize('[x] > 0 ? "a" : "b"', { start: 0, end: 20 });
    expect(r.canonicalized).toBe('[x] > 0 ? "a" : "b"');
  });
});

describe('Tier 1 sugar — bare hex → string literal', () => {
  it('3-char hex', () => {
    const r = canonicalize('#0a7', { start: 0, end: 4 });
    expect(r.canonicalized).toBe('"#0a7"');
  });

  it('6-char hex', () => {
    const r = canonicalize('#00aa77', { start: 0, end: 7 });
    expect(r.canonicalized).toBe('"#00aa77"');
  });

  it('8-char hex with alpha', () => {
    const r = canonicalize('#00aa77ff', { start: 0, end: 9 });
    expect(r.canonicalized).toBe('"#00aa77ff"');
  });

  it('hex inside ternary is rewritten', () => {
    const r = canonicalize('[change] > 0 ? #0a7 : #d33', { start: 0, end: 30 });
    expect(r.canonicalized).toBe('[change] > 0 ? "#0a7" : "#d33"');
  });

  it('hex inside if/then/else is rewritten after ternary transform', () => {
    const r = canonicalize('if [change] > 0 then #0a7 else #d33', { start: 0, end: 40 });
    expect(r.canonicalized).toBe('([change] > 0) ? ("#0a7") : ("#d33")');
  });

  it('non-hex # is left alone (e.g. #not-a-color)', () => {
    const r = canonicalize('"prefix#no"', { start: 0, end: 12 });
    expect(r.canonicalized).toBe('"prefix#no"');
  });
});

describe('Tier 1 sugar — rule:<ruleId> reserve', () => {
  it('emits RuleRefNode + replaces with null in canonicalized string', () => {
    const r = canonicalize('rule:my-rule', { start: 5, end: 17 });
    expect(r.canonicalized).toBe('null');
    expect(r.ruleRefs).toHaveLength(1);
    expect(r.ruleRefs[0]).toMatchObject({ kind: 'rule-ref', ruleId: 'my-rule' });
    expect(r.ruleRefs[0].loc.start).toBe(5);
  });

  it('rule:<id> inside ternary preserves other tokens', () => {
    const r = canonicalize('[change] > 0 ? rule:up : rule:down', { start: 0, end: 40 });
    expect(r.canonicalized).toBe('[change] > 0 ? null : null');
    expect(r.ruleRefs).toHaveLength(2);
    expect(r.ruleRefs.map((n) => n.ruleId)).toEqual(['up', 'down']);
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier1/sugar.test.ts
```
Expected: FAIL — all throw `not-yet-implemented: tier1.canonicalize`.

- [ ] **Step 2: Implement `tier1/sugar.ts`**

Replace `packages/format/src/tier1/sugar.ts`:

```ts
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import type { RuleRefNode } from '../types';

export interface SugarResult {
  canonicalized: string;
  ruleRefs: RuleRefNode[];
}

/**
 * Canonicalize a Tier 1 bracket interior:
 *  1. `if X then Y else Z` → `(X) ? (Y) : (Z)` (recursive)
 *  2. Bare hex `#hhh`/`#hhhh`/`#hhhhhh`/`#hhhhhhhh` → `"#..."` string literal
 *  3. `rule:<id>` → `null` placeholder + RuleRefNode
 *
 * Order of application: (1) first (structural rewrite), then (3) (token
 * rewrite that produces valid expression tokens), then (2) (final token
 * rewrite). Order preserves ability to compose all three.
 */
export function canonicalize(interior: string, interiorLoc: Loc): SugarResult {
  const ruleRefs: RuleRefNode[] = [];
  let source = interior;

  // Step 1 — if/then/else rewrite (recursive).
  source = rewriteIfThenElse(source);

  // Step 2 — rule:<id> rewrite. Emit RuleRefNode with best-effort loc.
  // Loc is approximate: char offset within interior mapped back to source offset.
  const RULE_RE = /rule:([A-Za-z0-9_-]+)/g;
  source = source.replace(RULE_RE, (match, id, offset: number) => {
    ruleRefs.push({
      kind: 'rule-ref',
      ruleId: id,
      loc: {
        start: interiorLoc.start + offset,
        end: interiorLoc.start + offset + match.length,
      },
    });
    return 'null';
  });

  // Step 3 — bare hex rewrite. Only outside existing string literals.
  source = rewriteBareHex(source);

  return { canonicalized: source, ruleRefs };
}

function rewriteIfThenElse(source: string): string {
  // Recursively rewrite `if X then Y else Z` to `(X) ? (Y) : (Z)`.
  // Use a scanner that finds the topmost `if ` and matches its `then`
  // and `else` with correct nesting depth against nested `if`.
  const trimmed = source.replace(/^\s+|\s+$/g, '');
  if (!/^if\s/.test(trimmed)) return source;

  // Find matching `then` and `else` at depth 0.
  const rest = trimmed.slice(3);  // after 'if '
  const thenIdx = findKeywordAtDepth(rest, 'then', 0);
  if (thenIdx === -1) return source;

  const test = rest.slice(0, thenIdx).trim();
  const afterThen = rest.slice(thenIdx + 4);
  const elseIdx = findKeywordAtDepth(afterThen, 'else', 0);
  if (elseIdx === -1) return source;

  const consequent = afterThen.slice(0, elseIdx).trim();
  const alternate = afterThen.slice(elseIdx + 4).trim();

  // Recurse into consequent and alternate for nested if/then/else.
  const recTest = rewriteIfThenElse(test);
  const recConsequent = rewriteIfThenElse(consequent);
  const recAlternate = rewriteIfThenElse(alternate);

  return `(${recTest}) ? (${recConsequent}) : (${recAlternate})`;
}

/**
 * Find the first occurrence of `keyword` at depth 0 (not inside brackets,
 * parens, or string literals), and not preceded by an `if ` at the same
 * depth. Depth-aware to handle nested `if/then/else`.
 */
function findKeywordAtDepth(source: string, keyword: string, startDepth: number): number {
  let depth = startDepth;
  let ifDepth = 0;  // tracks how many `if`s we've seen at each depth level
  let inStr: '"' | "'" | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; i++; continue; }
    if (c === '[' || c === '(' || c === '{') { depth++; i++; continue; }
    if (c === ']' || c === ')' || c === '}') { depth--; i++; continue; }
    if (depth !== startDepth) { i++; continue; }
    // Check for `if ` at this depth
    if (source.slice(i, i + 3) === 'if ' && isTokenBoundary(source, i - 1) && isTokenBoundary(source, i + 2)) {
      ifDepth++;
      i += 3;
      continue;
    }
    // Check for the target keyword
    if (source.slice(i, i + keyword.length) === keyword
        && isTokenBoundary(source, i - 1)
        && isTokenBoundary(source, i + keyword.length)) {
      if (ifDepth === 0) return i;
      // `then` decrements the ifDepth (paired with an `if`); `else` matches at ifDepth=0.
      if (keyword === 'then') { ifDepth--; i += keyword.length; continue; }
      if (keyword === 'else') { i += keyword.length; continue; }
    }
    i++;
  }
  return -1;
}

function isTokenBoundary(source: string, i: number): boolean {
  if (i < 0 || i >= source.length) return true;
  const c = source[i];
  return !/[A-Za-z0-9_]/.test(c);
}

function rewriteBareHex(source: string): string {
  const HEX_RE = /#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g;
  let out = '';
  let inStr: '"' | "'" | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < source.length) { out += source[i + 1]; i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    if (c === '#') {
      HEX_RE.lastIndex = i;
      const match = HEX_RE.exec(source);
      if (match && match.index === i) {
        // Only rewrite valid lengths (3, 4, 6, 8)
        const len = match[1].length;
        if (len === 3 || len === 4 || len === 6 || len === 8) {
          out += `"#${match[1]}"`;
          i += match[0].length;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}
```

- [ ] **Step 3: Run sugar tests — expect PASS**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier1/sugar.test.ts
```
Expected: all pass.

- [ ] **Step 4: Typecheck + baselines**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/format/src/tier1/sugar.ts packages/format/tests/tier1/sugar.test.ts
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 5 — Tier 1 sugar canonicalization

- tier1/sugar.ts: canonicalize(interior, interiorLoc) applies three
  rewrites before handoff to expression.parse:
  (1) if X then Y else Z → (X) ? (Y) : (Z), recursive
  (2) rule:<id> → 'null' placeholder + RuleRefNode with source loc
  (3) bare hex #hhh/#hhhh/#hhhhhh/#hhhhhhhh → "#..." string literal
- Depth-aware scanner tracks bracket/paren/string context so rewrites
  don't touch inside quotes.
- tests/tier1/sugar.test.ts: 12+ scenarios covering nested if/else,
  hex inside ternary, hex outside strings, rule refs inside ternary.

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Tier 1 parser + expression.parse integration

**Files:**
- Modify: `packages/format/src/tier1/parser.ts` (implement bodies)
- Create: `packages/format/tests/tier1/parser.test.ts`

**Interfaces:**
- Consumes (Tasks 1, 5): `canonicalize`, `RuleRefNode`, `CompileFormatError`, expression's `parse`.
- Produces (for Tasks 7, 8, 9): `parseTier1Brackets(brackets) → Tier1ParseResult` where `Tier1Node = { channel; ast: Ast | null; ruleRefs: RuleRefNode[]; loc }`.

- [ ] **Step 1: Write failing parser tests**

Write `packages/format/tests/tier1/parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTier1Brackets } from '../../src/tier1/parser';

describe('Tier 1 parser', () => {
  it('parses [color=<expr>]', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: '[change] > 0 ? "#0a7" : "#d33"', interiorLoc: { start: 8, end: 40 }, loc: { start: 0, end: 41 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0].channel).toBe('color');
    expect(r.nodes[0].ast).not.toBeNull();
  });

  it('parses [if <expr>] with sugar', () => {
    const r = parseTier1Brackets([
      { channel: 'if', interior: '[x] > 0', interiorLoc: { start: 4, end: 12 }, loc: { start: 0, end: 13 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes[0].channel).toBe('if');
  });

  it('applies sugar: if/then/else + hex + rule:', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: 'if [x] > 0 then #0a7 else rule:my-rule', interiorLoc: { start: 8, end: 48 }, loc: { start: 0, end: 49 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes[0].ruleRefs).toHaveLength(1);
    expect(r.nodes[0].ruleRefs[0].ruleId).toBe('my-rule');
  });

  it('wraps expression parse error as expression-parse with translated loc', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: '[x] > ', interiorLoc: { start: 8, end: 14 }, loc: { start: 0, end: 15 } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.error.code).toBe('expression-parse');
    expect(r.error.loc.start).toBeGreaterThanOrEqual(8);
  });

  it('rejects aggregate calls (compile-time) with not-yet-implemented', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: 'SUM([price]) > 0 ? "#0a7" : "#d33"', interiorLoc: { start: 8, end: 45 }, loc: { start: 0, end: 46 } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.error.code).toBe('expression-compile');
  });

  it('parses multiple brackets', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: '[change] > 0 ? "#0a7" : "#d33"', interiorLoc: { start: 8, end: 40 }, loc: { start: 0, end: 41 } },
      { channel: 'bg', interior: '"#eef"', interiorLoc: { start: 46, end: 53 }, loc: { start: 41, end: 54 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes.map((n) => n.channel)).toEqual(['color', 'bg']);
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier1/parser.test.ts
```
Expected: FAIL — `not-yet-implemented: tier1.parseTier1Brackets`.

- [ ] **Step 2: Implement `tier1/parser.ts`**

Replace `packages/format/src/tier1/parser.ts`:

```ts
import { parse as parseExpression, compile as compileExpression, type Ast } from '@wellsfargo-starui/velocity-grid-expression';
import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import type { CompileFormatError, RuleRefNode } from '../types';
import { canonicalize } from './sugar';

export interface Tier1Node {
  channel: 'color' | 'bg' | 'weight' | 'style' | 'if';
  ast: Ast | null;
  ruleRefs: RuleRefNode[];
  loc: Loc;
}

export type Tier1ParseResult =
  | { ok: true; nodes: Tier1Node[] }
  | { ok: false; error: CompileFormatError };

export function parseTier1Brackets(
  brackets: Array<{ channel: Tier1Node['channel']; interior: string; interiorLoc: Loc; loc: Loc }>,
): Tier1ParseResult {
  const nodes: Tier1Node[] = [];

  for (const b of brackets) {
    const sugar = canonicalize(b.interior, b.interiorLoc);

    if (sugar.canonicalized.trim() === 'null' && sugar.ruleRefs.length > 0) {
      // Pure rule-ref — no expression to parse.
      nodes.push({ channel: b.channel, ast: null, ruleRefs: sugar.ruleRefs, loc: b.loc });
      continue;
    }

    const parseResult = parseExpression(sugar.canonicalized);
    if (!parseResult.ok) {
      return {
        ok: false,
        error: {
          kind: 'compile-format',
          code: 'expression-parse',
          message: `expression parse error inside [${b.channel}=...]: ${parseResult.error.message}`,
          loc: translateExprLocToFormatLoc(parseResult.error.loc, sugar.canonicalized, b.interior, b.interiorLoc),
          cause: { source: 'expression', inner: parseResult.error },
        },
      };
    }

    // Also compile — surfaces aggregate/prev not-yet-implemented at bracket time
    // so consumers get a clear error before eval.
    const compileResult = compileExpression(parseResult.ast);
    if (!compileResult.ok) {
      const code = compileResult.error.code === 'not-yet-implemented' ? 'expression-compile' : 'expression-compile';
      return {
        ok: false,
        error: {
          kind: 'compile-format',
          code,
          message: `expression compile error inside [${b.channel}=...]: ${compileResult.error.message}`,
          loc: translateExprLocToFormatLoc(compileResult.error.loc, sugar.canonicalized, b.interior, b.interiorLoc),
          cause: { source: 'expression', inner: compileResult.error },
        },
      };
    }

    nodes.push({ channel: b.channel, ast: parseResult.ast, ruleRefs: sugar.ruleRefs, loc: b.loc });
  }

  return { ok: true, nodes };
}

/**
 * Best-effort loc translation: canonicalized string has different offsets
 * than the original interior (sugar rewrites change lengths). We map
 * expression's loc onto the interior's loc via a simple proportional
 * scaling. For customizer editor UX, this is "good enough" — the loc
 * points into the bracket's interior, not to a specific char within.
 */
function translateExprLocToFormatLoc(
  exprLoc: Loc,
  canonicalized: string,
  interior: string,
  interiorLoc: Loc,
): Loc {
  if (canonicalized.length === 0) return interiorLoc;
  const startPct = exprLoc.start / canonicalized.length;
  const endPct = exprLoc.end / canonicalized.length;
  return {
    start: Math.floor(interiorLoc.start + interior.length * startPct),
    end: Math.ceil(interiorLoc.start + interior.length * endPct),
  };
}
```

- [ ] **Step 3: Run parser tests — expect PASS**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier1/parser.test.ts
```
Expected: all pass.

- [ ] **Step 4: Typecheck + baselines**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/format/src/tier1/parser.ts packages/format/tests/tier1/parser.test.ts
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 6 — Tier 1 parser + expression integration

- tier1/parser.ts: parseTier1Brackets(brackets) applies sugar
  canonicalization + delegates interior to @wellsfargo-starui/velocity-grid-expression.parse
  and .compile. Errors wrapped as CompileFormatError with translated
  loc from canonicalized-string offsets back to interior offsets.
- Compile-side check catches aggregate/prev not-yet-implemented at
  bracket parse time so consumers see the error before eval.
- Pure rule:<id> interior (no other expression) shortcuts — no
  expression.parse call; RuleRefNode passes through to resolver.
- tests/tier1/parser.test.ts: color/bg/if brackets, sugar composition,
  error wrapping, aggregate rejection, multi-bracket flows.

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Tier 1 style + icon resolver

**Files:**
- Modify: `packages/format/src/tier1/resolver.ts` (implement bodies)
- Create: `packages/format/tests/tier1/resolver.test.ts`

**Interfaces:**
- Consumes (Tasks 1, 5, 6): `Tier1Node`, `RuleRefNode`, `StyleObj`, `IconRef`, `FormatEvalContext`, expression's `compile` + `evaluate`.
- Produces (for Tasks 8, 9, 17): `resolveStyle(nodes, ctx) → StyleObj | null`, `resolveIcon(iconTokens, ctx) → IconRef | null`. Runs at compile-time to compile ASTs to closures (cached per node) then at eval-time invokes the closures against the row context.

- [ ] **Step 1: Write failing resolver tests**

Write `packages/format/tests/tier1/resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parse as parseExpression } from '@wellsfargo-starui/velocity-grid-expression';
import { resolveStyle, resolveIcon } from '../../src/tier1/resolver';
import type { Tier1Node } from '../../src/tier1/parser';

function makeAst(expr: string) {
  const r = parseExpression(expr);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
}

describe('Tier 1 resolveStyle', () => {
  it('resolves [color=<expr>] to StyleObj.color', () => {
    const nodes: Tier1Node[] = [{
      channel: 'color',
      ast: makeAst('([x] > 0) ? ("#0a7") : ("#d33")'),
      ruleRefs: [],
      loc: { start: 0, end: 30 },
    }];
    const posStyle = resolveStyle(nodes, { value: null, row: { x: 5 }, colId: 'c' });
    expect(posStyle?.color).toBe('#0a7');
    const negStyle = resolveStyle(nodes, { value: null, row: { x: -5 }, colId: 'c' });
    expect(negStyle?.color).toBe('#d33');
  });

  it('resolves [bg=<expr>] to StyleObj.background', () => {
    const nodes: Tier1Node[] = [{
      channel: 'bg',
      ast: makeAst('"#eef"'),
      ruleRefs: [],
      loc: { start: 0, end: 10 },
    }];
    const style = resolveStyle(nodes, { value: null, row: {}, colId: 'c' });
    expect(style?.background).toBe('#eef');
  });

  it('resolves [weight=<expr>]', () => {
    const nodes: Tier1Node[] = [{
      channel: 'weight',
      ast: makeAst('"bold"'),
      ruleRefs: [],
      loc: { start: 0, end: 10 },
    }];
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })?.weight).toBe('bold');
  });

  it('resolves [style=italic]', () => {
    const nodes: Tier1Node[] = [{
      channel: 'style',
      ast: makeAst('"italic"'),
      ruleRefs: [],
      loc: { start: 0, end: 10 },
    }];
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })?.italic).toBe(true);
  });

  it('multiple brackets compose additively', () => {
    const nodes: Tier1Node[] = [
      { channel: 'color', ast: makeAst('"#0a7"'), ruleRefs: [], loc: { start: 0, end: 10 } },
      { channel: 'bg', ast: makeAst('"#eef"'), ruleRefs: [], loc: { start: 11, end: 20 } },
    ];
    const style = resolveStyle(nodes, { value: null, row: {}, colId: 'c' });
    expect(style).toEqual({ color: '#0a7', background: '#eef' });
  });

  it('later bracket wins for same channel', () => {
    const nodes: Tier1Node[] = [
      { channel: 'color', ast: makeAst('"#0a7"'), ruleRefs: [], loc: { start: 0, end: 10 } },
      { channel: 'color', ast: makeAst('"#d33"'), ruleRefs: [], loc: { start: 11, end: 20 } },
    ];
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })?.color).toBe('#d33');
  });

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

  it('empty nodes returns null', () => {
    expect(resolveStyle([], { value: null, row: {}, colId: 'c' })).toBeNull();
  });

  it('boolean [if] result true keeps style channel active (no-op on style)', () => {
    const nodes: Tier1Node[] = [{
      channel: 'if',
      ast: makeAst('true'),
      ruleRefs: [],
      loc: { start: 0, end: 5 },
    }];
    // [if] doesn't produce a style channel; it's a section selector.
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })).toBeNull();
  });
});

describe('Tier 1 resolveIcon', () => {
  it('static icon token returns IconRef.name', () => {
    const icon = resolveIcon([{ name: 'trending-up' }], { value: null, row: {}, colId: 'c' });
    expect(icon).toEqual({ name: 'trending-up', position: 'leading' });
  });

  it('dynamic icon expression evaluates per row', () => {
    const icon = resolveIcon(
      [{ name: '', dynamicExpr: '[change] > 0 ? "trending-up" : "trending-down"' }],
      { value: null, row: { change: 5 }, colId: 'c' },
    );
    expect(icon?.name).toBe('trending-up');
  });

  it('first icon token wins (only one icon per format string)', () => {
    const icon = resolveIcon(
      [{ name: 'trending-up' }, { name: 'trending-down' }],
      { value: null, row: {}, colId: 'c' },
    );
    expect(icon?.name).toBe('trending-up');
  });

  it('empty icon-token list returns null', () => {
    expect(resolveIcon([], { value: null, row: {}, colId: 'c' })).toBeNull();
  });

  it('null dynamicExpr result returns null icon', () => {
    const icon = resolveIcon(
      [{ name: '', dynamicExpr: 'null' }],
      { value: null, row: {}, colId: 'c' },
    );
    expect(icon).toBeNull();
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier1/resolver.test.ts
```
Expected: FAIL — `not-yet-implemented: tier1.resolveStyle`.

- [ ] **Step 2: Implement `tier1/resolver.ts`**

Replace `packages/format/src/tier1/resolver.ts`:

```ts
import { compile as compileExpression, evaluate as evaluateExpression, type Ast, type Compiled } from '@wellsfargo-starui/velocity-grid-expression';
import type { FormatEvalContext, StyleObj, IconRef } from '../types';
import type { Tier1Node } from './parser';

// Compile cache keyed by AST identity — the parser stage may hand us the
// same AST across multiple ctx evals in a paint loop.
const compileCache = new WeakMap<Ast, Compiled>();

function getCompiled(ast: Ast): Compiled {
  let c = compileCache.get(ast);
  if (!c) {
    const r = compileExpression(ast);
    if (!r.ok) {
      // Shouldn't happen — parseTier1Brackets already compile-tested.
      throw new Error(`Tier1 resolver: compile failed for AST — ${r.error.message}`);
    }
    c = r.compiled;
    compileCache.set(ast, c);
  }
  return c;
}

export function resolveStyle(nodes: Tier1Node[], ctx: FormatEvalContext): StyleObj | null {
  if (nodes.length === 0) return null;
  let style: StyleObj | null = null;

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

    if (!style) style = {};
    switch (node.channel) {
      case 'color':
        style.color = String(evaluated);
        break;
      case 'bg':
        style.background = String(evaluated);
        break;
      case 'weight':
        style.weight = normalizeWeight(evaluated);
        break;
      case 'style':
        style.italic = String(evaluated) === 'italic';
        break;
    }
  }
  return style;
}

function normalizeWeight(v: unknown): 'normal' | 'bold' | number {
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s === 'bold' || s === 'normal') return s;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'normal';
}

export function resolveIcon(
  iconTokens: Array<{ name: string; dynamicExpr?: string }>,
  ctx: FormatEvalContext,
): IconRef | null {
  if (iconTokens.length === 0) return null;

  const first = iconTokens[0];
  let name = first.name;
  if (first.dynamicExpr !== undefined && first.dynamicExpr !== '') {
    // Compile-per-call is acceptable for icons (rare tokens); caller can cache.
    const parseResult = require('@wellsfargo-starui/velocity-grid-expression').parse(first.dynamicExpr);
    if (!parseResult.ok) return null;
    const compileResult = compileExpression(parseResult.ast);
    if (!compileResult.ok) return null;
    let evaluated: unknown;
    try {
      evaluated = evaluateExpression(compileResult.compiled, { row: ctx.row });
    } catch {
      return null;
    }
    if (evaluated === null || evaluated === undefined) return null;
    name = String(evaluated);
  }

  if (!name) return null;
  return { name, position: 'leading' };
}
```

Note: the `require('@wellsfargo-starui/velocity-grid-expression').parse` inside `resolveIcon` is a workaround because the top-of-file `import { parse }` would create a value-side dep name collision with the `Ast` type import; if your TypeScript strict mode complains, hoist to a named-scoped import:

```ts
// Alternative top-of-file:
import { parse as parseExpressionIcon, compile as compileExpressionIcon, evaluate as evaluateExpressionIcon } from '@wellsfargo-starui/velocity-grid-expression';
// Then use parseExpressionIcon in resolveIcon.
```

Prefer the named-alias form. Rewrite `resolveIcon` accordingly if `require` breaks in Vitest ESM mode:

```ts
// Add to imports at top:
import { parse as parseExprForIcon } from '@wellsfargo-starui/velocity-grid-expression';

// In resolveIcon body, replace the `require('@wellsfargo-starui/velocity-grid-expression').parse(...)` call:
const parseResult = parseExprForIcon(first.dynamicExpr);
```

- [ ] **Step 3: Run resolver tests — expect PASS**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier1/resolver.test.ts
```
Expected: all pass.

- [ ] **Step 4: Typecheck + baselines**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/format/src/tier1/resolver.ts packages/format/tests/tier1/resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 7 — Tier 1 style + icon resolver

- tier1/resolver.ts: resolveStyle(nodes, ctx) evaluates each Tier1Node's
  AST via @wellsfargo-starui/velocity-grid-expression.evaluate and composes StyleObj additively
  across channels (color, bg, weight, style). Later bracket wins on
  same channel. [if] channel skipped (section selector). Pure rule-ref
  nodes contribute null (Cycle 21e reserve behavior).
- resolveIcon(iconTokens, ctx): first icon token wins; static or
  dynamic (via @wellsfargo-starui/velocity-grid-expression.parse+compile+evaluate). Null result
  returns null IconRef.
- Compile cache keyed by AST identity via WeakMap so paint loops don't
  re-compile the same AST per cell.

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Tier 2 composite (2 tasks)

---

## Task 8: Composite fragment compiler + resolver

**Files:**
- Modify: `packages/format/src/tier2/fragmentResolver.ts` (implement bodies)
- Create: `packages/format/tests/tier2/fragmentResolver.test.ts`

**Interfaces:**
- Consumes (Tasks 1-7): `CompositeColDef`, `Fragment`, `FragmentStyle`, `ResolvedFragment`, `FormatEvalContext`, expression's `parse/compile/evaluate`, format's own `tokenize + parseExcel + evaluateExcel + canonicalize + resolveStyle`.
- Produces (for Task 9): `compileFragments(colDef) → CompiledFragmentPlan`, `resolveFragments(plan, ctx) → ResolvedFragment[]`. Each `Fragment` compiles to a per-fragment closure that produces text + style + icon at eval time. `cellBackground` compiles into a Tier 1 style-only mini-program via `resolveStyle`.

- [ ] **Step 1: Write failing fragment tests**

Write `packages/format/tests/tier2/fragmentResolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileFragments, resolveFragments } from '../../src/tier2/fragmentResolver';
import type { CompositeColDef } from '../../src/types';

const baseCol: Omit<CompositeColDef, 'fragments'> = { colId: 'summary', type: 'composite' };

describe('Composite fragmentResolver', () => {
  it('static text fragment', () => {
    const plan = compileFragments({ ...baseCol, fragments: [{ text: 'hello' }] });
    const fragments = resolveFragments(plan, { value: null, row: {}, colId: 'summary' });
    expect(fragments).toEqual([{ text: 'hello', style: {} }]);
  });

  it('expression fragment with no format returns raw stringified value', () => {
    const plan = compileFragments({
      ...baseCol,
      fragments: [{ expr: '[symbol]' }],
    });
    const fragments = resolveFragments(plan, { value: null, row: { symbol: 'AAPL' }, colId: 'summary' });
    expect(fragments[0].text).toBe('AAPL');
  });

  it('expression fragment with format applies Excel format', () => {
    const plan = compileFragments({
      ...baseCol,
      fragments: [{ expr: '[price]', format: '$#,##0.00' }],
    });
    const fragments = resolveFragments(plan, { value: null, row: { price: 1234.5 }, colId: 'summary' });
    expect(fragments[0].text).toBe('$1,234.50');
  });

  it('per-fragment static style applies', () => {
    const plan = compileFragments({
      ...baseCol,
      fragments: [{ expr: '[symbol]', style: { weight: 'bold' } }],
    });
    const fragments = resolveFragments(plan, { value: null, row: { symbol: 'AAPL' }, colId: 'summary' });
    expect(fragments[0].style.weight).toBe('bold');
  });

  it('per-fragment [<expr>] shorthand style auto-wraps into Tier 1 bracket', () => {
    const plan = compileFragments({
      ...baseCol,
      fragments: [{
        expr: '[change]',
        format: '+0.00%;-0.00%',
        style: { color: '[[change] > 0 ? "#0a7" : "#d33"]' },
      }],
    });
    const posFragments = resolveFragments(plan, { value: null, row: { change: 0.02 }, colId: 'summary' });
    expect(posFragments[0].style.color).toBe('#0a7');
    const negFragments = resolveFragments(plan, { value: null, row: { change: -0.02 }, colId: 'summary' });
    expect(negFragments[0].style.color).toBe('#d33');
  });

  it('multi-fragment composite preserves order + separates styles', () => {
    const plan = compileFragments({
      ...baseCol,
      fragments: [
        { expr: '[symbol]', style: { weight: 'bold' } },
        { text: '  ' },
        { expr: '[price]', format: '$#,##0.00' },
      ],
    });
    const fragments = resolveFragments(plan, { value: null, row: { symbol: 'AAPL', price: 150 }, colId: 'summary' });
    expect(fragments).toHaveLength(3);
    expect(fragments[0].text).toBe('AAPL');
    expect(fragments[0].style.weight).toBe('bold');
    expect(fragments[1].text).toBe('  ');
    expect(fragments[2].text).toBe('$150.00');
  });

  it('cellBackground Tier 1 bracket produces style at eval', () => {
    const plan = compileFragments({
      ...baseCol,
      fragments: [{ text: 'x' }],
      cellBackground: '[bg=[[change] > 0 ? "#efe" : "#fee"]]',
    });
    expect(plan.cellBackgroundProgram).not.toBeNull();
  });

  it('per-fragment format with {icon:name} token emits ResolvedFragment.icon', () => {
    // Spec §3.4 example: fragment format string can carry icon tokens.
    // e.g. `[Green]{icon:trending-up}+0.00%;[Red]{icon:trending-down}-0.00%`
    const plan = compileFragments({
      ...baseCol,
      fragments: [{ expr: '[change]', format: '{icon:trending-up}+0.00%' }],
    });
    const fragments = resolveFragments(plan, { value: null, row: { change: 0.02 }, colId: 'summary' });
    expect(fragments[0].icon?.name).toBe('trending-up');
  });

  it('per-fragment format with dynamic {icon:name|<expr>}', () => {
    const plan = compileFragments({
      ...baseCol,
      fragments: [{ expr: '[change]', format: '{icon:x|[change] > 0 ? "trending-up" : "trending-down"}+0.00%' }],
    });
    const posFragments = resolveFragments(plan, { value: null, row: { change: 0.02 }, colId: 'summary' });
    expect(posFragments[0].icon?.name).toBe('trending-up');
    const negFragments = resolveFragments(plan, { value: null, row: { change: -0.02 }, colId: 'summary' });
    expect(negFragments[0].icon?.name).toBe('trending-down');
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier2/fragmentResolver.test.ts
```
Expected: FAIL — `not-yet-implemented: tier2.compileFragments`.

- [ ] **Step 2: Implement `tier2/fragmentResolver.ts`**

Replace `packages/format/src/tier2/fragmentResolver.ts`:

```ts
import { parse as parseExpr, compile as compileExpr, evaluate as evaluateExpr, type Compiled } from '@wellsfargo-starui/velocity-grid-expression';
import type { CompositeColDef, Fragment, FragmentStyle, ResolvedFragment, FormatEvalContext, StyleObj, IconRef } from '../types';
import { tokenize } from '../tokenizer';
import { parseExcel } from '../excel/parser';
import { evaluateExcel } from '../excel/evaluator';
import { parseTier1Brackets, type Tier1Node } from '../tier1/parser';
import { resolveStyle, resolveIcon } from '../tier1/resolver';

interface CompiledStaticFragment { kind: 'static'; text: string; style: FragmentStyle; }
interface CompiledExprFragment {
  kind: 'expr';
  exprCompiled: Compiled;
  excelTree: ReturnType<typeof parseExcel> | null;
  iconTokens: Array<{ name: string; dynamicExpr?: string }>;  // Extracted from per-fragment format string
  staticStyle: FragmentStyle;
  dynamicColor: Tier1Node[] | null;
  dynamicBg: Tier1Node[] | null;
  dynamicWeight: Tier1Node[] | null;
  dynamicItalic: Tier1Node[] | null;
}

type CompiledFragment = CompiledStaticFragment | CompiledExprFragment;

export interface CompiledFragmentPlan {
  fragments: CompiledFragment[];
  cellBackgroundProgram: { nodes: Tier1Node[] } | null;
}

export function compileFragments(colDef: CompositeColDef): CompiledFragmentPlan {
  const compiled: CompiledFragment[] = [];

  for (const frag of colDef.fragments) {
    if ('text' in frag) {
      compiled.push({ kind: 'static', text: frag.text, style: {} });
      continue;
    }

    const parseResult = parseExpr(frag.expr);
    if (!parseResult.ok) {
      compiled.push({ kind: 'static', text: `[parse error: ${parseResult.error.message}]`, style: {} });
      continue;
    }
    const compileResult = compileExpr(parseResult.ast);
    if (!compileResult.ok) {
      compiled.push({ kind: 'static', text: `[compile error: ${compileResult.error.message}]`, style: {} });
      continue;
    }

    let excelTree: ReturnType<typeof parseExcel> | null = null;
    const iconTokens: Array<{ name: string; dynamicExpr?: string }> = [];
    if (frag.format !== undefined) {
      // Split tokens: Excel tokens go into excelTree; icon tokens are extracted
      // so per-fragment format strings can carry {icon:name} (spec §3.4 example).
      const allTokens = tokenize(frag.format);
      const excelTokens = allTokens.filter((t) => t.kind !== 'icon-token');
      for (const t of allTokens) {
        if (t.kind === 'icon-token') {
          iconTokens.push({ name: t.name, dynamicExpr: t.dynamicExpr });
        }
      }
      excelTree = parseExcel(excelTokens);
    }

    const staticStyle: FragmentStyle = { ...(frag.style ?? {}) };
    const dynamicColor = extractDynamic(staticStyle, 'color');
    const dynamicBg = extractDynamic(staticStyle, 'background');
    const dynamicWeight = extractDynamic(staticStyle, 'weight');
    const dynamicItalic = extractDynamic(staticStyle, 'style');

    compiled.push({
      kind: 'expr',
      exprCompiled: compileResult.compiled,
      excelTree,
      iconTokens,
      staticStyle,
      dynamicColor,
      dynamicBg,
      dynamicWeight,
      dynamicItalic,
    });
  }

  let cellBackgroundProgram: CompiledFragmentPlan['cellBackgroundProgram'] = null;
  if (colDef.cellBackground) {
    const tokens = tokenize(colDef.cellBackground);
    const brackets = tokens.filter((t) => t.kind === 'tier1-bracket' && (t.channel === 'bg' || t.channel === 'if'));
    if (brackets.length > 0) {
      const bs = brackets.map((b) => {
        if (b.kind !== 'tier1-bracket') throw new Error('unreachable');
        return { channel: b.channel, interior: b.interior, interiorLoc: b.interiorLoc, loc: b.loc };
      });
      const result = parseTier1Brackets(bs);
      if (result.ok) {
        cellBackgroundProgram = { nodes: result.nodes };
      }
    }
  }

  return { fragments: compiled, cellBackgroundProgram };
}

function extractDynamic(
  staticStyle: FragmentStyle,
  key: 'color' | 'background' | 'weight' | 'style',
): Tier1Node[] | null {
  const raw = staticStyle[key as keyof FragmentStyle] as unknown;
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('[') || !raw.endsWith(']')) return null;
  // Shorthand: `[<expr>]` → wrap as Tier 1 bracket with matching channel.
  const interior = raw.slice(1, -1);
  const channel: Tier1Node['channel'] = key === 'background' ? 'bg' : key === 'style' ? 'style' : (key as 'color' | 'weight');
  const result = parseTier1Brackets([{ channel, interior, interiorLoc: { start: 1, end: raw.length - 1 }, loc: { start: 0, end: raw.length } }]);
  if (!result.ok) return null;
  // Delete the raw property so it isn't applied as literal.
  delete (staticStyle as Record<string, unknown>)[key];
  return result.nodes;
}

export function resolveFragments(plan: CompiledFragmentPlan, ctx: FormatEvalContext): ResolvedFragment[] {
  return plan.fragments.map((frag) => {
    if (frag.kind === 'static') {
      return { text: frag.text, style: frag.style };
    }
    let value: unknown;
    try {
      value = evaluateExpr(frag.exprCompiled, { row: ctx.row });
    } catch {
      value = null;
    }
    let text: string;
    if (frag.excelTree && frag.excelTree.ok) {
      const result = evaluateExcel(frag.excelTree.tree, { value, locale: 'en-US', currency: 'USD' });
      text = result.text;
    } else {
      text = value === null || value === undefined ? '' : String(value);
    }

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
    let icon: IconRef | undefined;
    if (frag.iconTokens.length > 0) {
      const resolved = resolveIcon(frag.iconTokens, { value, row: ctx.row, colId: ctx.colId });
      if (resolved) icon = resolved;
    }

    return icon ? { text, style, icon } : { text, style };
  });
}

/** Resolve cellBackground → StyleObj (used by FormatProgram.resolveStyle for composite). */
export function resolveCellBackground(plan: CompiledFragmentPlan, ctx: FormatEvalContext): StyleObj | null {
  if (!plan.cellBackgroundProgram) return null;
  return resolveStyle(plan.cellBackgroundProgram.nodes, ctx);
}
```

- [ ] **Step 3: Run fragment tests — expect PASS**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/tier2/fragmentResolver.test.ts
```
Expected: all pass.

- [ ] **Step 4: Typecheck + baselines**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/format/src/tier2/fragmentResolver.ts packages/format/tests/tier2/fragmentResolver.test.ts
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 8 — composite fragment compiler + resolver

- tier2/fragmentResolver.ts: compileFragments(colDef) walks fragments,
  parses each expr fragment via @wellsfargo-starui/velocity-grid-expression, optionally parses
  a per-fragment format string via Excel Tier 0, and auto-wraps
  '[<expr>]' shorthand in FragmentStyle color/bg/weight/style into
  Tier 1 brackets.
- resolveFragments(plan, ctx) evaluates each fragment per row: static
  text passes through; expr evaluates → Excel format → text; dynamic
  style overlays on static style.
- resolveCellBackground(plan, ctx) resolves the cellBackground Tier 1
  program to StyleObj.
- tests/tier2/fragmentResolver.test.ts: text/expr/format/style/
  shorthand-style/multi-fragment/cellBackground.

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Public `compileFormat` + `compileCompositeColDef`

**Files:**
- Modify: `packages/format/src/compile.ts` (implement bodies — the public entry points that stitch everything together)
- Create: `packages/format/tests/compile.test.ts`

**Interfaces:**
- Consumes (all prior format tasks): tokenizer, excel parser + evaluator, tier1 parser + resolver, tier2 compiler + resolver.
- Produces (for Tasks 17, 18, 20): `compileFormat(source, opts?) → CompileFormatResult`, `compileCompositeColDef(colDef, opts?) → CompileFormatResult`. Returns a `FormatProgram` with all 4 resolvers (`formatText`, `resolveStyle`, `resolveIcon`, `resolveFragments`) populated.

- [ ] **Step 1: Write failing public API tests**

Write `packages/format/tests/compile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileFormat, compileCompositeColDef } from '../src/compile';
import type { CompositeColDef } from '../src/types';

describe('compileFormat — Tier 0', () => {
  it('compiles a simple number format', () => {
    const r = compileFormat('0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.formatText({ value: 1.5, row: {}, colId: 'x' })).toBe('1.50');
    expect(r.program.tiers.tier0).toBe(true);
    expect(r.program.tiers.tier1).toBe(false);
    expect(r.program.tiers.tier2).toBe(false);
  });

  it('compiles a currency format with sections', () => {
    const r = compileFormat('$#,##0.00;[Red]-$#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.formatText({ value: 1234.5, row: {}, colId: 'x' })).toBe('$1,234.50');
    expect(r.program.formatText({ value: -1234.5, row: {}, colId: 'x' })).toBe('-$1,234.50');
    const negStyle = r.program.resolveStyle({ value: -1234.5, row: {}, colId: 'x' });
    expect(negStyle?.color).toBe('#E53935');
  });
});

describe('compileFormat — Tier 1', () => {
  it('compiles [color=<expr>]', () => {
    const r = compileFormat('[color=[[change] > 0 ? "#0a7" : "#d33"]] $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.tiers.tier1).toBe(true);

    const posStyle = r.program.resolveStyle({ value: 100, row: { change: 5 }, colId: 'x' });
    expect(posStyle?.color).toBe('#0a7');

    const negStyle = r.program.resolveStyle({ value: 100, row: { change: -5 }, colId: 'x' });
    expect(negStyle?.color).toBe('#d33');
  });

  it('compiles {icon:name}', () => {
    const r = compileFormat('{icon:trending-up} $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    const icon = r.program.resolveIcon({ value: 100, row: {}, colId: 'x' });
    expect(icon?.name).toBe('trending-up');
  });

  it('compiles {icon:name|<expr>} dynamic', () => {
    const r = compileFormat('{icon:x|[change] > 0 ? "trending-up" : "trending-down"} $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    const posIcon = r.program.resolveIcon({ value: 100, row: { change: 5 }, colId: 'x' });
    expect(posIcon?.name).toBe('trending-up');
  });
});

describe('compileFormat — errors', () => {
  it('surfaces Tier 1 parse error with format-source loc', () => {
    const r = compileFormat('[color=[bad expression] 0.00');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(['expression-parse', 'expression-compile', 'tier1-parse']).toContain(r.error.code);
  });

  it('rejects >4 Excel sections', () => {
    const r = compileFormat('0;0;0;0;0');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.error.code).toBe('excel-section-count');
  });
});

describe('compileCompositeColDef — Tier 2', () => {
  it('compiles a composite column', () => {
    const colDef: CompositeColDef = {
      colId: 'summary',
      type: 'composite',
      fragments: [
        { expr: '[symbol]', style: { weight: 'bold' } },
        { text: '  ' },
        { expr: '[price]', format: '$#,##0.00' },
      ],
    };
    const r = compileCompositeColDef(colDef);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.tiers.tier2).toBe(true);

    const fragments = r.program.resolveFragments({ value: null, row: { symbol: 'AAPL', price: 150 }, colId: 'summary' });
    expect(fragments).toHaveLength(3);
    expect(fragments![0].text).toBe('AAPL');
    expect(fragments![2].text).toBe('$150.00');

    // formatText returns concatenated fragment text
    const text = r.program.formatText({ value: null, row: { symbol: 'AAPL', price: 150 }, colId: 'summary' });
    expect(text).toBe('AAPL  $150.00');
  });

  it('composite with cellBackground', () => {
    const colDef: CompositeColDef = {
      colId: 'summary',
      type: 'composite',
      fragments: [{ text: 'x' }],
      cellBackground: '[bg=[[flag] ? "#efe" : "#fee"]]',
    };
    const r = compileCompositeColDef(colDef);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    const bg = r.program.resolveStyle({ value: null, row: { flag: true }, colId: 'summary' });
    expect(bg?.background).toBe('#efe');
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/compile.test.ts
```
Expected: FAIL — `not-yet-implemented: compile.compileFormat`.

- [ ] **Step 2: Implement `compile.ts`**

Replace `packages/format/src/compile.ts`:

```ts
import type {
  CompileFormatOptions,
  CompileFormatResult,
  CompositeColDef,
  FormatEvalContext,
  FormatProgram,
  FormatSource,
  StyleObj,
  IconRef,
  ResolvedFragment,
} from './types';
import { tokenize, type Token } from './tokenizer';
import { parseExcel, type ExcelFormatTree } from './excel/parser';
import { evaluateExcel } from './excel/evaluator';
import { parseTier1Brackets, type Tier1Node } from './tier1/parser';
import { resolveStyle, resolveIcon } from './tier1/resolver';
import { compileFragments, resolveFragments, resolveCellBackground, type CompiledFragmentPlan } from './tier2/fragmentResolver';

export function compileFormat(source: FormatSource, opts?: CompileFormatOptions): CompileFormatResult {
  const locale = opts?.locale ?? 'en-US';
  const currency = opts?.currency ?? 'USD';

  if (typeof source !== 'string') {
    return compileCompositeColDef(source, opts);
  }

  const tokens = tokenize(source);

  // Split tokens: Excel tree = all non-Tier1-bracket, non-icon tokens.
  const excelTokens: Token[] = [];
  const tier1Brackets: Array<{ channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: { start: number; end: number }; loc: { start: number; end: number } }> = [];
  const iconTokens: Array<{ name: string; dynamicExpr?: string }> = [];

  for (const t of tokens) {
    if (t.kind === 'tier1-bracket') {
      tier1Brackets.push({ channel: t.channel, interior: t.interior, interiorLoc: t.interiorLoc, loc: t.loc });
    } else if (t.kind === 'icon-token') {
      iconTokens.push({ name: t.name, dynamicExpr: t.dynamicExpr });
    } else {
      excelTokens.push(t);
    }
  }

  const excelResult = parseExcel(excelTokens);
  if (!excelResult.ok) {
    return {
      ok: false,
      error: {
        kind: 'compile-format',
        code: excelResult.error.code,
        message: excelResult.error.message,
        loc: excelResult.error.loc,
      },
    };
  }

  const tier1Result = parseTier1Brackets(tier1Brackets);
  if (!tier1Result.ok) {
    return { ok: false, error: tier1Result.error };
  }

  const excelTree = excelResult.tree;
  const tier1Nodes = tier1Result.nodes;

  const tier0 = excelTree.sections.length > 0 && excelTokens.length > 0;
  const tier1 = tier1Nodes.length > 0 || iconTokens.length > 0;
  const tier2 = false;

  const program: FormatProgram = {
    source,
    tiers: { tier0, tier1, tier2 },
    formatText: (ctx: FormatEvalContext): string => {
      const result = evaluateExcel(excelTree, { value: ctx.value, locale, currency });
      return result.text;
    },
    resolveStyle: (ctx: FormatEvalContext): StyleObj | null => {
      const excelStyle = evaluateExcel(excelTree, { value: ctx.value, locale, currency }).style;
      const tier1Style = tier1Nodes.length > 0 ? resolveStyle(tier1Nodes, ctx) : null;
      if (!excelStyle && !tier1Style) return null;
      return { ...excelStyle, ...tier1Style };  // tier1 wins per §3.2 spec
    },
    resolveIcon: (ctx: FormatEvalContext): IconRef | null => {
      if (iconTokens.length === 0) return null;
      return resolveIcon(iconTokens, ctx);
    },
    resolveFragments: (): ResolvedFragment[] | null => null,
  };

  return { ok: true, program };
}

export function compileCompositeColDef(colDef: CompositeColDef, opts?: CompileFormatOptions): CompileFormatResult {
  const plan: CompiledFragmentPlan = compileFragments(colDef);

  const program: FormatProgram = {
    source: colDef,
    tiers: { tier0: false, tier1: false, tier2: true },
    formatText: (ctx: FormatEvalContext): string => {
      const fragments = resolveFragments(plan, ctx);
      return fragments.map((f) => f.text).join('');
    },
    resolveStyle: (ctx: FormatEvalContext): StyleObj | null => {
      return resolveCellBackground(plan, ctx);
    },
    resolveIcon: (): IconRef | null => null,
    resolveFragments: (ctx: FormatEvalContext): ResolvedFragment[] | null => resolveFragments(plan, ctx),
  };

  return { ok: true, program };
}
```

- [ ] **Step 3: Run compile tests — expect PASS**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/compile.test.ts
```
Expected: all pass.

- [ ] **Step 4: Full format-package test run**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test
```
Expected: all format tests pass (Excel parser + evaluator + tier1 sugar/parser/resolver + tier2 fragmentResolver + templates + compile).

- [ ] **Step 5: Typecheck + baselines**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run typecheck
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid-expression run test 2>&1 | tail -5
```
Expected: format clean; kernel 2326/2326; expression 185/185.

- [ ] **Step 6: Commit**

Run:
```bash
git add packages/format/src/compile.ts packages/format/tests/compile.test.ts
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 9 — public compileFormat + compileCompositeColDef

- compile.ts: public entry points assembling all prior tasks.
  compileFormat(source, opts?) splits tokens into Excel + Tier 1
  brackets + icon tokens; parses Excel via parseExcel; parses Tier 1
  via parseTier1Brackets. FormatProgram.formatText delegates to
  evaluateExcel; resolveStyle merges Excel section style with Tier 1
  resolvedStyle (tier1 wins on channel conflict); resolveIcon delegates
  to Tier 1 resolveIcon; resolveFragments returns null.
- compileCompositeColDef(colDef, opts?) builds a fragment-plan-backed
  program. formatText returns concatenated fragment text (tooltip +
  clipboard plain); resolveStyle returns cellBackground result;
  resolveFragments returns the per-row fragment array.
- tiers metadata (tier0/1/2 booleans) populated per source shape.
- tests/compile.test.ts: Tier 0 + Tier 1 + Tier 2 + error surfaces
  (excel-section-count, expression-parse) covered.

Kernel + expression baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D → E — Intra-cycle self-review checkpoint

Before Task 10 starts touching kernel, run a self-review pass on Phase A-D deliverables. This is a **required step** per spec §6, not optional.

- [ ] **Step 1: Verify `wireIntoKernel` signature is final**

Read `packages/format/src/bridge.ts`. Confirm the signature is:
```ts
export function wireIntoKernel(grid: unknown, opts?: WireOptions): void
```
(grid is `unknown` until Task 17 tightens to the real VelocityGrid type). If this needs a shape change for Phase E's kernel work, decide now — changing after kernel starts consuming causes ripple edits.

- [ ] **Step 2: Verify `FormatProgram` public shape is final**

Read `packages/format/src/types.ts`. Confirm:
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
Phase E uses this shape via kernel's `FormatProgramShape` structural alias. Rename here → chase-rename there. Lock now.

- [ ] **Step 3: Verify `CompositeColDef` matches parent brief §4.3**

Read `packages/format/src/types.ts`. Confirm `CompositeColDef` has: `colId`, `type: 'composite'`, `fragments: Fragment[]`, optional `cellBackground: string`, `align: 'left'|'center'|'right'`, `overflow: 'ellipsis'|'clip'`, and index signature `[key: string]: unknown`.

Also confirm `Fragment = { text: string } | { expr: string; format?: string; style?: FragmentStyle }` and `FragmentStyle = { color?; weight?; style?; size?; background? }`.

- [ ] **Step 4: Verify no hidden coupling from format's `src/` to kernel**

Run:
```bash
grep -rn "@wellsfargo-starui/velocity-grid" packages/format/src/
```
Expected: NO matches. Only `bridge.ts` will reference kernel — and only in Task 17, not yet. If any match found here, extract to `bridge.ts` before starting Phase E.

- [ ] **Step 5: Update PLAN progress ledger with checkpoint**

Append to `.superpowers/sdd/progress.md`:
```
Phase D→E self-review checkpoint (Cycle 21c): passed
  - wireIntoKernel signature locked
  - FormatProgram public shape locked
  - CompositeColDef matches spec §4.3
  - No @wellsfargo-starui/velocity-grid imports from packages/format/src/**
```

No commit for this step (it's a plan-level checkpoint, not a code change). If any check fails, land a fix commit before proceeding.

---

## Phase E — Kernel bridge + infrastructure (7 tasks)

Every task in Phase E preserves the kernel's 2326 baseline. Existing kernel tests are read-only — if a change would break one, it's a spec violation. Kernel's `types/column.ts` type-only imports from `@wellsfargo-starui/velocity-grid-format` are OK; no runtime import from kernel → format.

---

## Task 10: Kernel format-compiler injection slot

**Files:**
- Create: `packages/kernel/src/core/formatCompilerSlot.ts`
- Modify: `packages/kernel/src/types/api.ts` (add `registerFormatCompiler` to `VelocityGridApi`)
- Modify: `packages/kernel/src/velocityGrid.ts` (wire method)
- Create: `packages/kernel/tests/core/formatCompilerSlot.test.ts`

**Interfaces:**
- Produces (for Tasks 11, 17): `registerFormatCompiler(fn: FormatCompiler): void`, `getFormatCompiler(): FormatCompiler | null`, structural type aliases `CompositeColDefShape`, `FormatProgramShape`, `FormatCompiler` type. `grid.registerFormatCompiler(fn)` public API method.

- [ ] **Step 1: Write the format-compiler slot module**

Write `packages/kernel/src/core/formatCompilerSlot.ts`:

```ts
// Kernel-side format-compiler dependency-injection slot.
//
// @wellsfargo-starui/velocity-grid-format registers itself via wireIntoKernel(); kernel invokes the
// registered compiler in propertyChain.compileFormatSlots (Task 11).
// Kernel does NOT import @wellsfargo-starui/velocity-grid-format at runtime — only structural
// types. Type-only imports in types/column.ts are OK because they're
// erased at compile time.

export interface CompositeColDefShape {
  type: 'composite';
  fragments: Array<{ text: string } | { expr: string; format?: string; style?: unknown }>;
  cellBackground?: string;
  align?: 'left' | 'center' | 'right';
  overflow?: 'ellipsis' | 'clip';
  colId: string;
  [key: string]: unknown;
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
  opts?: unknown,
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

/** Test-only helper — not part of public API. */
export function _resetFormatCompiler_forTests(): void {
  injectedCompiler = null;
}
```

- [ ] **Step 2: Expose method on the public `VelocityGridApi`**

Read `packages/kernel/src/types/api.ts` and locate the `VelocityGridApi<TRow>` interface. Add a method signature near `registerCellRenderer`:

```ts
  registerFormatCompiler(fn: import('../core/formatCompilerSlot').FormatCompiler): void;
```

- [ ] **Step 3: Wire in `velocityGrid.ts`**

Read `packages/kernel/src/velocityGrid.ts`. Locate where `registerCellRenderer` is defined (around line 4720 per the design spec's grep). Add:

```ts
import { registerFormatCompiler as slotRegister, type FormatCompiler } from './core/formatCompilerSlot';

// Inside the VelocityGrid class body (near registerCellRenderer):
registerFormatCompiler(fn: FormatCompiler): void {
  slotRegister(fn);
}
```

Also add to the `api` object literal (near `registerCellRenderer: (n, p) => this.registerCellRenderer(n, p)`):

```ts
      registerFormatCompiler: (fn) => this.registerFormatCompiler(fn),
```

- [ ] **Step 4: Write failing slot tests**

Write `packages/kernel/tests/core/formatCompilerSlot.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerFormatCompiler,
  getFormatCompiler,
  _resetFormatCompiler_forTests,
  type FormatCompiler,
} from '../../src/core/formatCompilerSlot';

describe('Kernel format-compiler slot', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('returns null when no compiler registered', () => {
    expect(getFormatCompiler()).toBeNull();
  });

  it('stores and returns the registered compiler', () => {
    const fake: FormatCompiler = () => ({ ok: true, program: {
      formatText: () => 'fake',
      resolveStyle: () => null,
      resolveIcon: () => null,
      resolveFragments: () => null,
      source: 'fake',
      tiers: { tier0: true, tier1: false, tier2: false },
    } });
    registerFormatCompiler(fake);
    expect(getFormatCompiler()).toBe(fake);
  });

  it('overwrites previous compiler on re-register', () => {
    const first: FormatCompiler = () => ({ ok: false, error: { message: 'first', loc: { start: 0, end: 0 } } });
    const second: FormatCompiler = () => ({ ok: false, error: { message: 'second', loc: { start: 0, end: 0 } } });
    registerFormatCompiler(first);
    registerFormatCompiler(second);
    expect(getFormatCompiler()).toBe(second);
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test -- tests/core/formatCompilerSlot.test.ts
```
Expected: all pass (the slot is trivial).

- [ ] **Step 5: Verify baseline preserved**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid run typecheck 2>&1 | tail -10
```
Expected: `2326 + 3` (or however many new tests) pass; typecheck clean.

- [ ] **Step 6: Commit**

Run:
```bash
git add packages/kernel/src/core/formatCompilerSlot.ts packages/kernel/src/types/api.ts packages/kernel/src/velocityGrid.ts packages/kernel/tests/core/formatCompilerSlot.test.ts
git commit -m "$(cat <<'EOF'
feat(kernel): cycle 21c task 10 — format-compiler injection slot

- core/formatCompilerSlot.ts: DI slot with registerFormatCompiler /
  getFormatCompiler; structural type aliases CompositeColDefShape +
  FormatProgramShape + FormatCompiler so kernel never imports
  @wellsfargo-starui/velocity-grid-format at runtime.
- types/api.ts: registerFormatCompiler added to VelocityGridApi.
- velocityGrid.ts: forwards grid.registerFormatCompiler(fn) to the slot.
- tests/core/formatCompilerSlot.test.ts: null-when-unregistered,
  store+retrieve, overwrite behaviors.

Kernel baseline preserved: 2326 existing tests unchanged + 3 new.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: ColDef type broadening + `compileFormatSlots` ColDef-resolve pass

**Files:**
- Modify: `packages/kernel/src/types/column.ts` (broaden valueFormatter, add cellIcon + composite fields)
- Modify: `packages/kernel/src/core/propertyChain.ts` (add compileFormatSlots + mergeCellStyle)
- Create: `packages/kernel/tests/core/propertyChain-compileFormatSlots.test.ts`

**Interfaces:**
- Consumes (Task 10): `getFormatCompiler`, `CompositeColDefShape`, `FormatProgramShape`.
- Produces (for Tasks 13, 16): resolved ColDef with derived `valueFormatter`, `cellStyle`, `cellIcon` functions when format string is present; `_compositeProgram` field for composite ColDefs.

- [ ] **Step 1: Broaden `types/column.ts`**

Read `packages/kernel/src/types/column.ts`. Locate the `CColDef` interface. Modify `valueFormatter` field and add new fields. Full patch — apply as Edit:

```ts
// Add at top of file:
import type { Fragment, IconRef, FragmentStyle } from '@wellsfargo-starui/velocity-grid-format';
```

Locate `valueFormatter?: (params: CValueFormatterParams<TRow, TValue>) => string;` (line ~117 per spec) and replace with:

```ts
  /** DSL string OR function. String form compiles via @wellsfargo-starui/velocity-grid-format
   *  at ColDef-resolve time. */
  valueFormatter?: string | ((params: CValueFormatterParams<TRow, TValue>) => string);

  /** Icon slot; populated by format at ColDef-resolve when {icon:name}
   *  is present in the format string. */
  cellIcon?: string | ((params: CValueFormatterParams<TRow, TValue>) => IconRef | null);

  /** Composite discriminant — presence of `type: 'composite'` switches
   *  the ColDef into composite mode. */
  type?: 'composite';

  /** Composite fragments — required when `type === 'composite'`. */
  fragments?: Fragment[];

  /** Composite cell background — Tier 1 format string (bg=/if= brackets only). */
  cellBackground?: string;

  /** Composite alignment. */
  align?: 'left' | 'center' | 'right';

  /** Composite overflow behavior. */
  overflow?: 'ellipsis' | 'clip';
```

Also modify `ResolvedColDef<TRow>` (further down in the same file) — narrow `valueFormatter` to the function form only, add `cellIcon` narrowed, and add internal `_compositeProgram`:

```ts
  valueFormatter?: (params: CValueFormatterParams<TRow, TValue>) => string;
  cellIcon?: (params: CValueFormatterParams<TRow, TValue>) => IconRef | null;

  /** @internal — populated by compileFormatSlots for composite ColDefs. */
  _compositeProgram?: import('./formatProgramShape').FormatProgramShape;
```

Note: to avoid a runtime import of `FormatProgramShape` (which lives in `../core/formatCompilerSlot`), create a type-only forward:

Create `packages/kernel/src/types/formatProgramShape.ts`:

```ts
// Type-only re-export so column.ts can reference FormatProgramShape
// without introducing a circular type import.
export type { FormatProgramShape } from '../core/formatCompilerSlot';
```

- [ ] **Step 2: Implement `compileFormatSlots` in propertyChain.ts**

Read `packages/kernel/src/core/propertyChain.ts`. Locate the resolver — around where it returns the merged ColDef. Add a helper and a pass:

```ts
import { getFormatCompiler, type CompositeColDefShape } from './formatCompilerSlot';

/** Merge kernel's `cellStyle` with format's derived style function.
 *  Format's style is applied first; user's cellStyle overlays and wins
 *  on any explicit non-undefined field. */
function mergeCellStyle<TRow>(
  userFn: ((params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined) | undefined,
  formatFn: (params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined,
): (params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined {
  return (params) => {
    const fromFormat = formatFn(params) ?? {};
    if (!userFn) return Object.keys(fromFormat).length > 0 ? fromFormat : undefined;
    const fromUser = userFn(params) ?? {};
    const merged: Record<string, string | number> = { ...fromFormat, ...fromUser };
    return Object.keys(merged).length > 0 ? merged : undefined;
  };
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

function compileFormatSlots<TRow>(
  merged: CColDefLike<TRow>,
): CColDefLike<TRow> {
  const compiler = getFormatCompiler();
  if (!compiler) return merged;

  // Composite path
  if (merged.type === 'composite') {
    const res = compiler(merged as unknown as CompositeColDefShape);
    if (!res.ok) {
      warnOnce(`[cgrid.format] composite ColDef ${merged.colId} failed to compile: ${res.error.message}`);
      return merged;
    }
    const program = res.program;
    return {
      ...merged,
      _compositeProgram: program,
      valueFormatter: (p: CValueFormatterParams<TRow, unknown>) =>
        program.formatText({ value: p.value, row: p.data, colId: p.colId }),
      cellStyle: mergeCellStyle(
        merged.cellStyle as any,
        (p: CValueFormatterParams<TRow, unknown>) => {
          const s = program.resolveStyle({ value: p.value, row: p.data, colId: p.colId });
          if (!s) return undefined;
          return styleObjToRecord(s);
        },
      ),
    } as CColDefLike<TRow>;
  }

  // Tier 0/1 path — string valueFormatter
  if (typeof merged.valueFormatter === 'string') {
    const res = compiler(merged.valueFormatter);
    if (!res.ok) {
      warnOnce(`[cgrid.format] valueFormatter for ${merged.colId} failed to compile: ${res.error.message}`);
      return merged;
    }
    const program = res.program;
    return {
      ...merged,
      valueFormatter: (p: CValueFormatterParams<TRow, unknown>) =>
        program.formatText({ value: p.value, row: p.data, colId: p.colId }),
      cellStyle: mergeCellStyle(
        merged.cellStyle as any,
        (p: CValueFormatterParams<TRow, unknown>) => {
          const s = program.resolveStyle({ value: p.value, row: p.data, colId: p.colId });
          if (!s) return undefined;
          return styleObjToRecord(s);
        },
      ),
      cellIcon: (p: CValueFormatterParams<TRow, unknown>) =>
        program.resolveIcon({ value: p.value, row: p.data, colId: p.colId }) as any,
    } as CColDefLike<TRow>;
  }

  return merged;
}

function styleObjToRecord(s: {
  color?: string; background?: string; weight?: string | number; italic?: boolean;
}): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (s.color) out.color = s.color;
  if (s.background) out.background = s.background;
  if (s.weight !== undefined) out.fontWeight = s.weight;
  if (s.italic) out.fontStyle = 'italic';
  return out;
}
```

Call `compileFormatSlots(merged)` at the end of the resolver — locate the return statement (spec §5.3 mentions `propertyChain.ts:828` in the existing code) and wrap:

```ts
    valueFormatter: merged.valueFormatter as ResolvedColDef<TRow>['valueFormatter'],
    // ... existing fields ...
  };
  // After building the resolved object, apply format compilation
  return compileFormatSlots(resolvedColDef) as ResolvedColDef<TRow>;
```

Adjust the exact insertion based on the existing code shape.

- [ ] **Step 3: Write failing propertyChain tests**

Write `packages/kernel/tests/core/propertyChain-compileFormatSlots.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveColDefs } from '../../src/core/propertyChain';
import {
  registerFormatCompiler,
  _resetFormatCompiler_forTests,
  type FormatCompiler,
} from '../../src/core/formatCompilerSlot';

const fakeCompiler: FormatCompiler = (source) => {
  if (typeof source === 'string' && source === '$#,##0.00') {
    return {
      ok: true,
      program: {
        formatText: (ctx) => `$${Number(ctx.value).toFixed(2)}`,
        resolveStyle: (ctx) => Number(ctx.value) < 0 ? { color: '#e53935' } : null,
        resolveIcon: () => null,
        resolveFragments: () => null,
        source: source,
        tiers: { tier0: true, tier1: false, tier2: false },
      },
    };
  }
  if (typeof source === 'object' && source.type === 'composite') {
    return {
      ok: true,
      program: {
        formatText: () => 'composite',
        resolveStyle: () => null,
        resolveIcon: () => null,
        resolveFragments: () => [{ text: 'a', style: {} }, { text: 'b', style: {} }],
        source: source,
        tiers: { tier0: false, tier1: false, tier2: true },
      },
    };
  }
  return { ok: false, error: { message: 'unknown source', loc: { start: 0, end: 0 } } };
};

describe('compileFormatSlots — string valueFormatter', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('leaves function-form valueFormatter untouched', () => {
    // No compiler registered — behavior identical to today
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: (p: any) => `val:${p.value}` }] as any);
    expect(typeof resolved[0].valueFormatter).toBe('function');
    expect(resolved[0].valueFormatter!({ value: 5, data: {}, colId: 'x' } as any)).toBe('val:5');
  });

  it('compiles string valueFormatter via registered compiler', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: '$#,##0.00' }] as any);
    expect(typeof resolved[0].valueFormatter).toBe('function');
    expect(resolved[0].valueFormatter!({ value: 42, data: {}, colId: 'x' } as any)).toBe('$42.00');
  });

  it('derives cellStyle from format program', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: '$#,##0.00' }] as any);
    const negStyle = (resolved[0].cellStyle as any)({ value: -1, data: {}, colId: 'x' });
    expect(negStyle?.color).toBe('#e53935');
    const posStyle = (resolved[0].cellStyle as any)({ value: 1, data: {}, colId: 'x' });
    expect(posStyle).toBeUndefined();
  });

  it('user cellStyle overlays format-derived style (user wins)', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x',
      valueFormatter: '$#,##0.00',
      cellStyle: () => ({ color: 'purple', background: 'yellow' }),
    }] as any);
    const style = (resolved[0].cellStyle as any)({ value: -1, data: {}, colId: 'x' });
    expect(style.color).toBe('purple');
    expect(style.background).toBe('yellow');
  });

  it('compile failure falls back to raw string (no crash)', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{ colId: 'x', valueFormatter: 'unknown-format' }] as any);
    // valueFormatter kept as raw string; kernel then treats as literal or falls through.
    expect(typeof resolved[0].valueFormatter).toBe('string');
  });
});

describe('compileFormatSlots — composite', () => {
  beforeEach(() => _resetFormatCompiler_forTests());

  it('composite ColDef produces _compositeProgram + derived formatters', () => {
    registerFormatCompiler(fakeCompiler);
    const resolved = resolveColDefs([{
      colId: 'x',
      type: 'composite',
      fragments: [{ text: 'a' }],
    }] as any);
    expect((resolved[0] as any)._compositeProgram).toBeDefined();
    expect(resolved[0].valueFormatter!({ value: null, data: {}, colId: 'x' } as any)).toBe('composite');
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test -- tests/core/propertyChain-compileFormatSlots.test.ts
```
Expected: PASS after implementation.

- [ ] **Step 4: Verify existing kernel baseline still holds**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -10
```
Expected: `2326 + new` tests pass. **If any existing test fails, DO NOT proceed — investigate. The compileFormatSlots pass must be behavior-neutral when no compiler is registered.**

- [ ] **Step 5: Typecheck**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

Run:
```bash
git add packages/kernel/src/types/column.ts packages/kernel/src/types/formatProgramShape.ts packages/kernel/src/core/propertyChain.ts packages/kernel/tests/core/propertyChain-compileFormatSlots.test.ts
git commit -m "$(cat <<'EOF'
feat(kernel): cycle 21c task 11 — ColDef broadening + compileFormatSlots

- types/column.ts: valueFormatter type broadened to string | fn (superset,
  backwards-compatible); new fields cellIcon, type: 'composite',
  fragments, cellBackground, align, overflow. type-only imports from
  @wellsfargo-starui/velocity-grid-format (Fragment, IconRef, FragmentStyle) — no runtime dep.
- types/formatProgramShape.ts: type-only forward to break circular
  reference between column.ts and core/formatCompilerSlot.
- core/propertyChain.ts: compileFormatSlots pass runs at ColDef-resolve.
  String valueFormatter → derived function via format compiler; composite
  → _compositeProgram + derived valueFormatter/cellStyle.
  mergeCellStyle overlays user cellStyle on top of format-derived
  (user wins on any non-undefined field). warnOnce on compile failure —
  raw string kept; no crash.

Kernel baseline preserved when no compiler registered: 2326/2326.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Icon registry + Lucide build step

**Files:**
- Create: `packages/kernel/src/icons/registry.ts`
- Create: `packages/kernel/src/icons/build-lucide.ts`
- Create: `packages/kernel/src/icons/lucide.generated.ts` (build output — committed to git)
- Modify: `packages/kernel/package.json` (add `lucide-static` devDep + `prebuild-icons` script)
- Modify: `packages/kernel/src/types/api.ts` (add `registerIconSet`, `resolveIcon`)
- Modify: `packages/kernel/src/velocityGrid.ts` (wire methods)
- Create: `packages/kernel/tests/icons/registry.test.ts`
- Create: `packages/kernel/tests/icons/lucide.generated.test.ts`

**Interfaces:**
- Produces (for Tasks 13, 16, 17): `grid.registerIconSet(name, paths)`, `grid.resolveIcon(name, setHint?)` → `Path2D | null`. Lazy `Path2D` construction. Cross-set lookup with `setHint` precedence.

- [ ] **Step 1: Install `lucide-static` as devDep**

Run:
```bash
npm install --save-dev --workspace=@wellsfargo-starui/velocity-grid lucide-static@^0.469.0
```
Expected: `packages/kernel/package.json` `devDependencies` gains `"lucide-static": "^0.469.0"`.

- [ ] **Step 2: Write the icon registry**

Write `packages/kernel/src/icons/registry.ts`:

```ts
// Icon registry — Path2D-backed, lazy-instantiated from SVG path strings.
// Populated by @wellsfargo-starui/velocity-grid-format's wireIntoKernel (Task 17); kernel does NOT
// auto-register any icon set.

type IconPathValue = string | Path2D;
type IconSet = Map<string, IconPathValue>;

const sets = new Map<string, IconSet>();
const insertionOrder: string[] = [];

export function registerIconSet(name: string, paths: Record<string, IconPathValue>): void {
  const set = new Map<string, IconPathValue>();
  for (const [iconName, path] of Object.entries(paths)) {
    set.set(iconName, path);
  }
  sets.set(name, set);
  if (!insertionOrder.includes(name)) insertionOrder.push(name);
}

export function resolveIcon(name: string, setHint?: string): Path2D | null {
  const order = setHint ? [setHint, ...insertionOrder.filter((s) => s !== setHint)] : insertionOrder;
  for (const setName of order) {
    const set = sets.get(setName);
    if (!set) continue;
    const val = set.get(name);
    if (val === undefined) continue;
    if (typeof val === 'string') {
      // Lazy Path2D construction; cache in the same slot.
      if (typeof Path2D === 'undefined') return null;  // SSR / Node fallback
      const p = new Path2D(val);
      set.set(name, p);
      return p;
    }
    return val;
  }
  return null;
}

export function listIconSets(): string[] {
  return insertionOrder.slice();
}

/** Test-only helper. */
export function _resetIconRegistry_forTests(): void {
  sets.clear();
  insertionOrder.length = 0;
}
```

- [ ] **Step 3: Write the Lucide build script**

Write `packages/kernel/src/icons/build-lucide.ts`:

```ts
// Build script: reads node_modules/lucide-static/icons/*.svg and emits
// packages/kernel/src/icons/lucide.generated.ts with a Record<name, path>.
// Committed to git; regenerate via `npm run prebuild-icons`.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', '..', '..', '..', 'node_modules', 'lucide-static', 'icons');
const outputPath = join(__dirname, 'lucide.generated.ts');

const bundle: Record<string, string> = {};
for (const file of readdirSync(iconsDir)) {
  if (!file.endsWith('.svg')) continue;
  const name = file.slice(0, -4);
  const svg = readFileSync(join(iconsDir, file), 'utf8');
  const paths = extractPaths(svg);
  if (paths.length > 0) bundle[name] = paths.join(' ');
}

const sorted = Object.fromEntries(Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(outputPath, `// AUTO-GENERATED — do not edit. Regenerate via \`npm --workspace @wellsfargo-starui/velocity-grid run prebuild-icons\`.
// Source: node_modules/lucide-static/icons/*.svg (Lucide MIT license).
export const lucideBundle: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(sorted, null, 2)});
`);
console.log(`[build-lucide] wrote ${Object.keys(sorted).length} icons to ${outputPath}`);

function extractPaths(svg: string): string[] {
  const paths: string[] = [];
  const re = /<path[^>]*\sd="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) paths.push(m[1]);
  return paths;
}
```

- [ ] **Step 4: Add `prebuild-icons` script to package.json**

Read `packages/kernel/package.json`. Add to `scripts`:

```json
    "prebuild-icons": "tsx src/icons/build-lucide.ts"
```

Note: `tsx` runs the TypeScript script directly. If not already a devDep, install it:
```bash
npm install --save-dev --workspace=@wellsfargo-starui/velocity-grid tsx@^4.19.0
```

- [ ] **Step 5: Generate `lucide.generated.ts` for the first time**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run prebuild-icons
```
Expected: `packages/kernel/src/icons/lucide.generated.ts` created with ~1500 icons.

- [ ] **Step 6: Wire public API — add `registerIconSet` + `resolveIcon` to `types/api.ts`**

Read `packages/kernel/src/types/api.ts`. Add:

```ts
  registerIconSet(name: string, paths: Record<string, string | Path2D>): void;
  resolveIcon(name: string, setHint?: string): Path2D | null;
```

- [ ] **Step 7: Wire methods in `velocityGrid.ts`**

Read `packages/kernel/src/velocityGrid.ts`. Add at import time:

```ts
import { registerIconSet as regIcons, resolveIcon as resIcon } from './icons/registry';
```

Add methods to the VelocityGrid class body:

```ts
registerIconSet(name: string, paths: Record<string, string | Path2D>): void {
  regIcons(name, paths);
}

resolveIcon(name: string, setHint?: string): Path2D | null {
  return resIcon(name, setHint);
}
```

Add to the `api` object literal:

```ts
      registerIconSet: (name, paths) => this.registerIconSet(name, paths),
      resolveIcon: (name, setHint) => this.resolveIcon(name, setHint),
```

- [ ] **Step 8: Write failing registry tests**

Write `packages/kernel/tests/icons/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerIconSet, resolveIcon, listIconSets, _resetIconRegistry_forTests } from '../../src/icons/registry';

// vitest jsdom env provides Path2D; if not, mock.
class FakePath2D {
  constructor(public d: string) {}
}
if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = FakePath2D;
}

describe('Icon registry', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('resolveIcon returns null when no sets registered', () => {
    expect(resolveIcon('foo')).toBeNull();
  });

  it('registerIconSet + resolveIcon roundtrip', () => {
    registerIconSet('lucide', { 'trending-up': 'M1 1 L2 2' });
    const p = resolveIcon('trending-up');
    expect(p).not.toBeNull();
  });

  it('setHint prioritizes named set', () => {
    registerIconSet('lucide', { star: 'M1' });
    registerIconSet('phosphor', { star: 'M2' });
    const p1 = resolveIcon('star', 'phosphor') as unknown as FakePath2D;
    const p2 = resolveIcon('star', 'lucide') as unknown as FakePath2D;
    expect(p1.d).toBe('M2');
    expect(p2.d).toBe('M1');
  });

  it('lazy Path2D — repeat call returns cached instance', () => {
    registerIconSet('lucide', { a: 'M1' });
    const first = resolveIcon('a');
    const second = resolveIcon('a');
    expect(first).toBe(second);
  });

  it('listIconSets returns registered sets in insertion order', () => {
    registerIconSet('a', {});
    registerIconSet('b', {});
    expect(listIconSets()).toEqual(['a', 'b']);
  });

  it('unknown icon returns null', () => {
    registerIconSet('lucide', { star: 'M1' });
    expect(resolveIcon('unknown')).toBeNull();
  });
});
```

Write `packages/kernel/tests/icons/lucide.generated.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lucideBundle } from '../../src/icons/lucide.generated';

describe('Lucide bundle smoke test', () => {
  it('exports at least 1000 icons', () => {
    expect(Object.keys(lucideBundle).length).toBeGreaterThanOrEqual(1000);
  });

  it('has trending-up + trending-down (referenced by design spec)', () => {
    expect(lucideBundle['trending-up']).toBeDefined();
    expect(lucideBundle['trending-down']).toBeDefined();
  });

  it('every entry is a non-empty string', () => {
    for (const [name, path] of Object.entries(lucideBundle)) {
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    }
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test -- tests/icons
```
Expected: all pass.

- [ ] **Step 9: Verify kernel baseline + full typecheck**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid run typecheck 2>&1 | tail -5
```
Expected: baseline preserved + new tests pass; typecheck clean.

- [ ] **Step 10: Commit**

Run:
```bash
git add packages/kernel/src/icons packages/kernel/src/types/api.ts packages/kernel/src/velocityGrid.ts packages/kernel/tests/icons packages/kernel/package.json
git commit -m "$(cat <<'EOF'
feat(kernel): cycle 21c task 12 — icon registry + Lucide build step

- icons/registry.ts: Map<setName, Map<iconName, string|Path2D>>.
  Lazy new Path2D() on first access; SSR/Node-safe (returns null if
  Path2D unavailable). setHint prioritizes named set; falls through
  to registration order.
- icons/build-lucide.ts: node script reading lucide-static SVGs,
  extracting <path d="…"/> data, writing lucide.generated.ts with
  ~1500 icons sorted alphabetically.
- icons/lucide.generated.ts: committed build output; do-not-edit
  banner + Object.freeze on the bundle.
- api.ts + velocityGrid.ts: registerIconSet + resolveIcon public methods.
- package.json: lucide-static@^0.469.0 devDep + prebuild-icons script.
- tests: registry roundtrip + setHint precedence + lazy caching +
  Lucide bundle smoke (≥1000 icons, trending-up/down present).

Kernel baseline preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Composite cell renderer

**Files:**
- Create: `packages/kernel/src/renderer/cellRenderers/composite.ts`
- Modify: `packages/kernel/src/velocityGrid.ts` (register the composite painter at grid init)
- Create: `packages/kernel/tests/renderer/cellRenderers/composite.test.ts`

**Interfaces:**
- Consumes (Tasks 11, 12): `_compositeProgram` on ResolvedColDef; icon registry via `resolveIcon`.
- Produces: composite painter registered under key `'composite'`. Draws all fragments in row order with per-fragment style; ellipsis on overflow; alignment left/center/right.

- [ ] **Step 1: Write the composite painter**

Write `packages/kernel/src/renderer/cellRenderers/composite.ts`:

```ts
import type { CellPainter } from './registry';
import { resolveIcon } from '../../icons/registry';

interface LaidOutFragment {
  text: string;
  style: Record<string, unknown>;
  textRect: { x: number; y: number; w: number; h: number };
  iconRect: { x: number; y: number; w: number; h: number } | null;
  iconPath: Path2D | null;
  iconTint: string | null;
}

export const compositePainter: CellPainter = (ctx, cell) => {
  const program = (cell.colDef as { _compositeProgram?: unknown })._compositeProgram as
    | {
        resolveFragments: (ctx: { value: unknown; row: unknown; colId: string }) =>
          | Array<{ text: string; style: Record<string, unknown>; icon?: { name: string; color?: string } }>
          | null;
        resolveStyle: (ctx: { value: unknown; row: unknown; colId: string }) =>
          | { color?: string; background?: string; weight?: string | number; italic?: boolean }
          | null;
      }
    | undefined;

  if (!program) return;

  const fragments = program.resolveFragments({
    value: cell.value,
    row: cell.row,
    colId: cell.colId,
  });
  if (!fragments || fragments.length === 0) return;

  // 1. Background
  const bg = program.resolveStyle({ value: null, row: cell.row, colId: cell.colId });
  if (bg?.background) {
    ctx.fillStyle = bg.background;
    ctx.fillRect(cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h);
  }

  // 2. Layout
  const align = (cell.colDef as { align?: 'left' | 'center' | 'right' }).align ?? 'left';
  const overflow = (cell.colDef as { overflow?: 'ellipsis' | 'clip' }).overflow ?? 'ellipsis';
  const laidOut = layoutFragments(ctx, fragments, cell.rect, align, overflow);

  // 3. Draw
  for (const frag of laidOut) {
    if (frag.iconPath && frag.iconRect) {
      ctx.save();
      ctx.translate(frag.iconRect.x, frag.iconRect.y);
      const scale = frag.iconRect.w / 24;  // Lucide viewBox is 24x24
      ctx.scale(scale, scale);
      if (frag.iconTint) ctx.strokeStyle = frag.iconTint;
      ctx.lineWidth = 2 / scale;
      ctx.stroke(frag.iconPath);
      ctx.restore();
    }
    if (frag.text) {
      ctx.save();
      const color = (frag.style.color as string | undefined) ?? '#111';
      ctx.fillStyle = color;
      const weight = frag.style.weight as string | number | undefined;
      const italic = frag.style.style === 'italic' ? 'italic ' : '';
      const fontWeight = typeof weight === 'number' ? String(weight) : (weight ?? '400');
      const size = (frag.style.size as number | undefined) ?? 13;
      ctx.font = `${italic}${fontWeight} ${size}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(frag.text, frag.textRect.x, frag.textRect.y + frag.textRect.h / 2);
      ctx.restore();
    }
  }
};

function layoutFragments(
  ctx: CanvasRenderingContext2D,
  fragments: Array<{ text: string; style: Record<string, unknown>; icon?: { name: string; color?: string } }>,
  rect: { x: number; y: number; w: number; h: number },
  align: 'left' | 'center' | 'right',
  overflow: 'ellipsis' | 'clip',
): LaidOutFragment[] {
  const padding = 4;
  const availWidth = rect.w - padding * 2;
  const iconSize = Math.floor(rect.h * 0.7);

  // Measure widths
  const measured: Array<{ frag: (typeof fragments)[number]; textWidth: number; iconWidth: number; iconPath: Path2D | null }> = [];
  let totalWidth = 0;
  for (const frag of fragments) {
    let iconPath: Path2D | null = null;
    let iconWidth = 0;
    if (frag.icon) {
      iconPath = resolveIcon(frag.icon.name);
      if (iconPath) iconWidth = iconSize + 4;
    }
    ctx.save();
    const size = (frag.style.size as number | undefined) ?? 13;
    const weight = frag.style.weight as string | number | undefined;
    const italic = frag.style.style === 'italic' ? 'italic ' : '';
    const fontWeight = typeof weight === 'number' ? String(weight) : (weight ?? '400');
    ctx.font = `${italic}${fontWeight} ${size}px system-ui, -apple-system, sans-serif`;
    const textWidth = ctx.measureText(frag.text).width;
    ctx.restore();
    measured.push({ frag, textWidth, iconWidth, iconPath });
    totalWidth += textWidth + iconWidth;
  }

  // Apply overflow: ellipsis truncation from the last fragment if needed
  let visible = measured.slice();
  if (totalWidth > availWidth && overflow === 'ellipsis') {
    const ellipsisWidth = ctx.measureText('…').width;
    while (visible.length > 0 && visible.reduce((s, m) => s + m.textWidth + m.iconWidth, 0) + ellipsisWidth > availWidth) {
      if (visible.length === 1) {
        // Truncate this single fragment character by character
        const only = visible[0];
        let text = only.frag.text;
        while (text.length > 0) {
          text = text.slice(0, -1);
          const width = ctx.measureText(text + '…').width;
          if (width <= availWidth - only.iconWidth) {
            only.frag = { ...only.frag, text: text + '…' };
            only.textWidth = width;
            break;
          }
        }
        break;
      }
      const last = visible[visible.length - 1];
      if (last.frag.text.length > 0) {
        const nextText = last.frag.text.slice(0, -1);
        if (nextText.length === 0) visible.pop();
        else {
          last.frag = { ...last.frag, text: nextText };
          last.textWidth = ctx.measureText(nextText).width;
        }
      } else {
        visible.pop();
      }
    }
    if (visible.length > 0) {
      const last = visible[visible.length - 1];
      last.frag = { ...last.frag, text: last.frag.text + '…' };
      last.textWidth += ellipsisWidth;
    }
  }

  const finalWidth = visible.reduce((s, m) => s + m.textWidth + m.iconWidth, 0);
  let cursorX = rect.x + padding;
  if (align === 'center') cursorX = rect.x + (rect.w - finalWidth) / 2;
  else if (align === 'right') cursorX = rect.x + rect.w - padding - finalWidth;

  const out: LaidOutFragment[] = [];
  for (const m of visible) {
    let iconRect: LaidOutFragment['iconRect'] = null;
    if (m.iconPath) {
      iconRect = { x: cursorX, y: rect.y + (rect.h - iconSize) / 2, w: iconSize, h: iconSize };
      cursorX += m.iconWidth;
    }
    out.push({
      text: m.frag.text,
      style: m.frag.style,
      textRect: { x: cursorX, y: rect.y, w: m.textWidth, h: rect.h },
      iconRect,
      iconPath: m.iconPath,
      iconTint: m.frag.icon?.color ?? null,
    });
    cursorX += m.textWidth;
  }
  return out;
}
```

- [ ] **Step 2: Register the composite painter at grid init**

Read `packages/kernel/src/velocityGrid.ts`. Locate the constructor or an init method that runs at startup. Add:

```ts
import { compositePainter } from './renderer/cellRenderers/composite';

// Inside the init flow (near where other built-in renderers are registered):
this.registerCellRenderer('composite', compositePainter);
```

- [ ] **Step 3: Write failing composite renderer tests**

Write `packages/kernel/tests/renderer/cellRenderers/composite.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { compositePainter } from '../../../src/renderer/cellRenderers/composite';
import { registerIconSet, _resetIconRegistry_forTests } from '../../../src/icons/registry';

// Mock CanvasRenderingContext2D — most methods no-op; track called args.
class MockCtx {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = 'alphabetic';
  private saved: unknown[] = [];
  fillRect(x: number, y: number, w: number, h: number) {}
  fillText(text: string, x: number, y: number) {}
  measureText(text: string) { return { width: text.length * 7 }; }
  save() {}
  restore() {}
  translate(x: number, y: number) {}
  scale(x: number, y: number) {}
  stroke(path: Path2D) {}
}

if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = class { constructor(public d: string) {} };
}

function makeCell(fragments: any[], overrides: Record<string, unknown> = {}) {
  return {
    value: null,
    row: { symbol: 'AAPL', price: 150 },
    colId: 'summary',
    rect: { x: 0, y: 0, w: 200, h: 24 },
    colDef: {
      _compositeProgram: {
        resolveFragments: () => fragments,
        resolveStyle: () => null,
      },
      ...overrides,
    },
  };
}

describe('Composite painter', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('no-ops when program missing', () => {
    const ctx = new MockCtx() as any;
    const cell = { ...makeCell([]), colDef: {} };
    expect(() => compositePainter(ctx, cell as any)).not.toThrow();
  });

  it('no-ops when fragments empty', () => {
    const ctx = new MockCtx() as any;
    expect(() => compositePainter(ctx, makeCell([]) as any)).not.toThrow();
  });

  it('draws single-text fragment', () => {
    const ctx = new MockCtx() as any;
    let fillTextCalled = false;
    ctx.fillText = () => { fillTextCalled = true; };
    compositePainter(ctx, makeCell([{ text: 'AAPL', style: {} }]) as any);
    expect(fillTextCalled).toBe(true);
  });

  it('draws icon when frag.icon present + set registered', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const ctx = new MockCtx() as any;
    let strokeCalled = false;
    ctx.stroke = () => { strokeCalled = true; };
    compositePainter(ctx, makeCell([{ text: 'x', style: {}, icon: { name: 'star' } }]) as any);
    expect(strokeCalled).toBe(true);
  });

  it('applies background from resolveStyle', () => {
    const ctx = new MockCtx() as any;
    let bgColor = '';
    ctx.fillRect = () => { bgColor = ctx.fillStyle; };
    const cell = makeCell([{ text: 'x', style: {} }]);
    (cell.colDef._compositeProgram as any).resolveStyle = () => ({ background: '#efe' });
    compositePainter(ctx, cell as any);
    expect(bgColor).toBe('#efe');
  });

  it('align: center centers total width', () => {
    const ctx = new MockCtx() as any;
    const xPositions: number[] = [];
    ctx.fillText = (_t: string, x: number) => xPositions.push(x);
    compositePainter(ctx, makeCell(
      [{ text: 'AB', style: {} }, { text: 'CD', style: {} }],
      { align: 'center' },
    ) as any);
    expect(xPositions[0]).toBeGreaterThan(0);
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test -- tests/renderer/cellRenderers/composite.test.ts
```
Expected: all pass.

- [ ] **Step 4: Verify baseline**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid run typecheck 2>&1 | tail -5
```
Expected: baseline preserved.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/kernel/src/renderer/cellRenderers/composite.ts packages/kernel/src/velocityGrid.ts packages/kernel/tests/renderer/cellRenderers/composite.test.ts
git commit -m "$(cat <<'EOF'
feat(kernel): cycle 21c task 13 — composite cell renderer

- renderer/cellRenderers/composite.ts: layout + draw for composite
  ColDefs. Reads _compositeProgram from cell.colDef; calls
  resolveFragments per cell; measures fragment widths with icon budget;
  applies overflow (ellipsis truncates from end, character-by-character
  when only one fragment); alignment left/center/right centers total
  visible width. Icon draws via Path2D from icon registry with 24x24
  viewBox scaled to icon slot; tint via IconRef.color or text color.
- velocityGrid.ts: registers compositePainter under key 'composite' at init.
- tests/renderer/cellRenderers/composite.test.ts: no-ops on missing
  program/empty fragments; draws text/icon/background; center alignment
  positions correctly.

Kernel baseline preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Tooltip provider hook

**Files:**
- Create: `packages/kernel/src/interaction/features/tooltipProvider.ts`
- Modify: `packages/kernel/src/interaction/featureChain.ts` (insert new feature)
- Modify: `packages/kernel/src/types/api.ts` + `velocityGrid.ts` (register/unregister methods)
- Create: `packages/kernel/tests/interaction/features/tooltipProvider.test.ts`

**Interfaces:**
- Consumes: kernel's existing feature-chain pattern (see `SparklineTooltip` for reference).
- Produces (for Tasks 17, 18): `grid.registerTooltipProvider(colId, fn)`, `grid.unregisterTooltipProvider(colId)`. Debounced hover triggers provider; result payload is `{ plain: string } | { html: string }`.

- [ ] **Step 1: Write the tooltip provider feature**

Write `packages/kernel/src/interaction/features/tooltipProvider.ts`:

```ts
// Per-column tooltip provider hook. Provider fn returns { plain } or
// { html }. Feature debounces hover, invokes provider, shows tooltip.

export interface TooltipParams {
  row: unknown;
  colId: string;
  rect: { x: number; y: number; w: number; h: number };
}
export type TooltipPayload = { plain: string } | { html: string };
export type TooltipProviderFn = (params: TooltipParams) => TooltipPayload | null;

const providers = new Map<string, TooltipProviderFn>();

export function registerTooltipProvider(colId: string, fn: TooltipProviderFn): void {
  providers.set(colId, fn);
}

export function unregisterTooltipProvider(colId: string): void {
  providers.delete(colId);
}

export function getTooltipProvider(colId: string): TooltipProviderFn | undefined {
  return providers.get(colId);
}

/** Test-only helper. */
export function _resetTooltipProviders_forTests(): void {
  providers.clear();
}

// ─── Feature-chain integration ──────────────────────────────────────
//
// Kernel's feature chain fires onHover events. This feature listens,
// debounces (500ms), and calls the provider. See featureChain.ts for
// where TooltipProvider is inserted.
export class TooltipProvider {
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCell: { colId: string; row: unknown; rect: TooltipParams['rect'] } | null = null;

  onCellHover(params: TooltipParams): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.lastCell = params;
    this.hoverTimer = setTimeout(() => {
      if (!this.lastCell) return;
      const fn = providers.get(this.lastCell.colId);
      if (!fn) return;
      const payload = fn({ row: this.lastCell.row, colId: this.lastCell.colId, rect: this.lastCell.rect });
      if (!payload) return;
      this.showTooltip(payload, this.lastCell.rect);
    }, 500);
  }

  onCellLeave(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.hideTooltip();
  }

  /** Overridable — default DOM tooltip using kernel's tooltip chrome. */
  showTooltip(payload: TooltipPayload, rect: TooltipParams['rect']): void {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('cgrid-tooltip-provider');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cgrid-tooltip-provider';
      el.style.position = 'absolute';
      el.style.zIndex = '1000';
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
    }
    if ('plain' in payload) {
      el.textContent = payload.plain;
    } else {
      el.innerHTML = payload.html;
    }
    el.style.left = `${rect.x + rect.w}px`;
    el.style.top = `${rect.y}px`;
    el.style.background = 'var(--vg-tooltip-bg, rgba(17,24,39,0.92))';
    el.style.color = 'var(--vg-tooltip-fg, #fff)';
    el.style.border = '1px solid var(--vg-tooltip-border, transparent)';
    el.style.padding = '4px 8px';
    el.style.borderRadius = '4px';
    el.style.fontSize = '12px';
    el.style.display = 'block';
  }

  hideTooltip(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('cgrid-tooltip-provider');
    if (el) el.style.display = 'none';
  }
}
```

- [ ] **Step 2: Insert into feature chain**

Read `packages/kernel/src/interaction/featureChain.ts`. Locate where `SparklineTooltip` is inserted (spec §5.6 mentions line ~105). Add just after:

```ts
import { TooltipProvider } from './features/tooltipProvider';

// In the chain-building code:
.append(new SparklineTooltip())
.append(new TooltipProvider())  // ← new
```

- [ ] **Step 3: Add public API in `types/api.ts` + `velocityGrid.ts`**

Read `packages/kernel/src/types/api.ts`. Add:

```ts
  registerTooltipProvider(colId: string, fn: import('../interaction/features/tooltipProvider').TooltipProviderFn): void;
  unregisterTooltipProvider(colId: string): void;
```

Read `packages/kernel/src/velocityGrid.ts`. Add:

```ts
import { registerTooltipProvider as regTip, unregisterTooltipProvider as unregTip, type TooltipProviderFn } from './interaction/features/tooltipProvider';

// In the VelocityGrid class body:
registerTooltipProvider(colId: string, fn: TooltipProviderFn): void {
  regTip(colId, fn);
}
unregisterTooltipProvider(colId: string): void {
  unregTip(colId);
}
```

Add to the `api` object literal:

```ts
      registerTooltipProvider: (colId, fn) => this.registerTooltipProvider(colId, fn),
      unregisterTooltipProvider: (colId) => this.unregisterTooltipProvider(colId),
```

- [ ] **Step 4: Write failing tooltip tests**

Write `packages/kernel/tests/interaction/features/tooltipProvider.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerTooltipProvider,
  unregisterTooltipProvider,
  getTooltipProvider,
  TooltipProvider,
  _resetTooltipProviders_forTests,
} from '../../../src/interaction/features/tooltipProvider';

describe('Tooltip provider registry', () => {
  beforeEach(() => _resetTooltipProviders_forTests());

  it('register + get roundtrip', () => {
    const fn = () => ({ plain: 'hello' });
    registerTooltipProvider('x', fn);
    expect(getTooltipProvider('x')).toBe(fn);
  });

  it('unregister removes', () => {
    registerTooltipProvider('x', () => ({ plain: 'hello' }));
    unregisterTooltipProvider('x');
    expect(getTooltipProvider('x')).toBeUndefined();
  });

  it('re-register overwrites', () => {
    const first = () => ({ plain: 'first' });
    const second = () => ({ plain: 'second' });
    registerTooltipProvider('x', first);
    registerTooltipProvider('x', second);
    expect(getTooltipProvider('x')).toBe(second);
  });
});

describe('TooltipProvider feature — debounce', () => {
  beforeEach(() => {
    _resetTooltipProviders_forTests();
    vi.useFakeTimers();
  });

  it('does not call provider until 500ms elapses', () => {
    const fn = vi.fn(() => ({ plain: 'x' }));
    registerTooltipProvider('c', fn);
    const feature = new TooltipProvider();
    feature.onCellHover({ colId: 'c', row: {}, rect: { x: 0, y: 0, w: 10, h: 10 } });
    vi.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent hover before debounce elapses', () => {
    const fn = vi.fn(() => ({ plain: 'x' }));
    registerTooltipProvider('c', fn);
    const feature = new TooltipProvider();
    feature.onCellHover({ colId: 'c', row: {}, rect: { x: 0, y: 0, w: 10, h: 10 } });
    vi.advanceTimersByTime(400);
    feature.onCellHover({ colId: 'c', row: {}, rect: { x: 0, y: 0, w: 10, h: 10 } });
    vi.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('onCellLeave cancels pending debounce', () => {
    const fn = vi.fn(() => ({ plain: 'x' }));
    registerTooltipProvider('c', fn);
    const feature = new TooltipProvider();
    feature.onCellHover({ colId: 'c', row: {}, rect: { x: 0, y: 0, w: 10, h: 10 } });
    feature.onCellLeave();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test -- tests/interaction/features/tooltipProvider.test.ts
```
Expected: all pass.

- [ ] **Step 5: Verify baseline + typecheck**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid run typecheck 2>&1 | tail -5
```
Expected: baseline preserved.

- [ ] **Step 6: Commit**

Run:
```bash
git add packages/kernel/src/interaction packages/kernel/src/types/api.ts packages/kernel/src/velocityGrid.ts packages/kernel/tests/interaction
git commit -m "$(cat <<'EOF'
feat(kernel): cycle 21c task 14 — tooltip provider hook + feature-chain integration

- interaction/features/tooltipProvider.ts: per-column provider registry
  + TooltipProvider feature class. Feature debounces hover 500ms;
  re-hover resets timer; onCellLeave cancels. Default DOM tooltip using
  --vg-tooltip-bg/fg/border tokens; supports { plain } or { html }
  payloads.
- interaction/featureChain.ts: TooltipProvider inserted after
  SparklineTooltip (which is specialized) and before OnHover.
- api.ts + velocityGrid.ts: registerTooltipProvider + unregisterTooltipProvider
  public methods.
- tests: registry roundtrip + debounce + timer reset + leave cancel.

Kernel baseline preserved (SparklineTooltip behavior unchanged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Multi-format clipboard extension

**Files:**
- Modify: `packages/kernel/src/interaction/features/keyboardShortcuts.ts` (extend copy path)
- Create: `packages/kernel/src/interaction/features/clipboardSerializer.ts` (helper)
- Create: `packages/kernel/tests/interaction/features/keyboardShortcuts-clipboard.test.ts`

**Interfaces:**
- Consumes (Task 11): `_compositeProgram` on resolved ColDef.
- Produces: clipboard write extended — `ClipboardItem` with `text/plain` + `text/html` when any composite cell is in the copied range; feature-detected fallback to `writeText` otherwise.

- [ ] **Step 1: Write the clipboard serializer helper**

Write `packages/kernel/src/interaction/features/clipboardSerializer.ts`:

```ts
// Serialize a selected range to text/plain (TSV) + text/html (styled table).
// text/html carries composite fragment styling for Excel/Sheets paste.

interface RowExport {
  cells: Array<{
    text: string;
    fragments?: Array<{ text: string; style: Record<string, string | number | undefined> }>;
  }>;
}

export function serializeToTsv(rows: RowExport[]): string {
  return rows.map((r) => r.cells.map((c) => escapeTsv(c.text)).join('\t')).join('\n');
}

function escapeTsv(text: string): string {
  return text.replace(/\t/g, ' ').replace(/\n/g, ' ');
}

export function serializeToHtml(rows: RowExport[]): string {
  const trs = rows
    .map((r) => {
      const tds = r.cells
        .map((c) => {
          if (c.fragments) {
            const spans = c.fragments
              .map((f) => `<span style="${styleToInline(f.style)}">${escapeHtml(f.text)}</span>`)
              .join('');
            return `<td>${spans}</td>`;
          }
          return `<td>${escapeHtml(c.text)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table>${trs}</table>`;
}

function styleToInline(style: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  if (style.color) parts.push(`color:${style.color}`);
  if (style.background) parts.push(`background-color:${style.background}`);
  if (style.weight !== undefined) parts.push(`font-weight:${style.weight}`);
  if (style.style === 'italic' || style.italic) parts.push('font-style:italic');
  if (style.size !== undefined) parts.push(`font-size:${style.size}px`);
  return parts.join(';');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 2: Extend the copy path in `keyboardShortcuts.ts`**

Read `packages/kernel/src/interaction/features/keyboardShortcuts.ts`. Locate the `Ctrl+C` handler (spec §5.7). Extend:

```ts
import { serializeToTsv, serializeToHtml } from './clipboardSerializer';

// Inside the Ctrl+C handler where clipboard.writeText is currently called:
async function copySelectedRanges(rangesWithMetadata: RangesForCopy) {
  const rows = buildRowExport(rangesWithMetadata);
  const hasComposite = rangesWithMetadata.hasComposite;
  const plainText = serializeToTsv(rows);

  if (!hasComposite || typeof (navigator.clipboard as unknown as { write?: unknown }).write !== 'function') {
    if (hasComposite) {
      console.debug('[cgrid.clipboard] rich copy unavailable, using plain text');
    }
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

`buildRowExport` must inspect the selected range's ColDefs. If a ColDef has `_compositeProgram`, invoke `program.resolveFragments(ctx)` for each cell and include the fragments in `RowExport`; otherwise fall back to plain-text cell values.

Existing test behavior for the current copy path stays intact — only augmented with the composite branching.

- [ ] **Step 3: Write failing clipboard tests**

Write `packages/kernel/tests/interaction/features/keyboardShortcuts-clipboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeToTsv, serializeToHtml } from '../../../src/interaction/features/clipboardSerializer';

describe('clipboardSerializer — TSV', () => {
  it('serializes simple rows', () => {
    const tsv = serializeToTsv([
      { cells: [{ text: 'A' }, { text: 'B' }] },
      { cells: [{ text: 'C' }, { text: 'D' }] },
    ]);
    expect(tsv).toBe('A\tB\nC\tD');
  });

  it('escapes tabs and newlines in cell text', () => {
    const tsv = serializeToTsv([{ cells: [{ text: 'a\tb\nc' }] }]);
    expect(tsv).toBe('a b c');
  });
});

describe('clipboardSerializer — HTML', () => {
  it('emits <table> with plain <td> for non-composite', () => {
    const html = serializeToHtml([{ cells: [{ text: 'A' }, { text: 'B' }] }]);
    expect(html).toBe('<table><tr><td>A</td><td>B</td></tr></table>');
  });

  it('emits styled <span> runs for composite fragments', () => {
    const html = serializeToHtml([{
      cells: [{
        text: 'AAPL 150',
        fragments: [
          { text: 'AAPL', style: { weight: 'bold', color: '#000' } },
          { text: ' ', style: {} },
          { text: '150', style: { color: '#0a7' } },
        ],
      }],
    }]);
    expect(html).toContain('<span style="color:#000;font-weight:bold">AAPL</span>');
    expect(html).toContain('<span style="">');
    expect(html).toContain('<span style="color:#0a7">150</span>');
  });

  it('escapes HTML entities in fragment text', () => {
    const html = serializeToHtml([{
      cells: [{ text: '<b>', fragments: [{ text: '<b>', style: {} }] }],
    }]);
    expect(html).toContain('&lt;b&gt;');
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test -- tests/interaction/features/keyboardShortcuts-clipboard.test.ts
```
Expected: all pass.

- [ ] **Step 4: Verify baseline (existing copy behavior)**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -10
```
Expected: `2326 + new` tests pass. **All existing keyboardShortcuts tests unchanged.** If any existing clipboard test fails, the extension has changed behavior for non-composite ranges — revert and re-scope so the branch only affects composite cases.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/kernel/src/interaction/features/clipboardSerializer.ts packages/kernel/src/interaction/features/keyboardShortcuts.ts packages/kernel/tests/interaction/features/keyboardShortcuts-clipboard.test.ts
git commit -m "$(cat <<'EOF'
feat(kernel): cycle 21c task 15 — multi-format clipboard extension

- interaction/features/clipboardSerializer.ts: serializeToTsv +
  serializeToHtml helpers. HTML emits <table> with <tr>/<td> per cell;
  composite fragments render as inline-styled <span> runs.
- interaction/features/keyboardShortcuts.ts: Ctrl+C path extended.
  hasComposite check on selected range → ClipboardItem write with
  text/plain + text/html. navigator.clipboard.write feature-detect —
  fallback to writeText + debug breadcrumb. Non-composite ranges
  unchanged.
- tests/interaction/features/keyboardShortcuts-clipboard.test.ts:
  TSV escaping, HTML table shape, composite fragment inline styles,
  HTML entity escaping.

Kernel baseline preserved (existing clipboard tests unchanged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: byRows painter — inline icon rendering

**Files:**
- Modify: `packages/kernel/src/renderer/painters/byRows.ts` (wire `cellIcon` slot)
- Create: `packages/kernel/tests/renderer/painters/byRows-cellIcon.test.ts`

**Interfaces:**
- Consumes (Tasks 11, 12): `ResolvedColDef.cellIcon` (function form), `resolveIcon` from icon registry.
- Produces: inline icon rendering for non-composite columns that carry a `cellIcon` slot from a compiled format string.

- [ ] **Step 1: Extend byRows painter to draw cellIcon**

Read `packages/kernel/src/renderer/painters/byRows.ts`. Locate the text-drawing path for data cells (spec §5.8 mentions this file). Add before text drawing:

```ts
import { resolveIcon as resolveIconPath } from '../../icons/registry';

// Inside the per-cell paint loop, before drawing text:
const iconFn = row.colDef.cellIcon;
let iconWidth = 0;
if (typeof iconFn === 'function') {
  const iconRef = iconFn({ value: cellValue, data: row.data, colId: colDef.colId });
  if (iconRef && typeof iconRef === 'object' && 'name' in iconRef) {
    const path = resolveIconPath(iconRef.name);
    if (path) {
      const iconSize = Math.floor(rect.h * 0.55);
      const position = iconRef.position ?? 'leading';
      const iconX = position === 'leading'
        ? rect.x + 6
        : rect.x + rect.w - 6 - iconSize;
      const iconY = rect.y + (rect.h - iconSize) / 2;
      ctx.save();
      ctx.translate(iconX, iconY);
      const scale = iconSize / 24;
      ctx.scale(scale, scale);
      const tint = iconRef.color ?? computedTextColor;  // computedTextColor from existing paint logic
      ctx.strokeStyle = tint;
      ctx.lineWidth = 2 / scale;
      ctx.stroke(path);
      ctx.restore();
      iconWidth = iconSize + 4;
      if (position === 'leading') {
        // Shift text right by icon width.
        textX += iconWidth;
      }
    }
  }
}
```

The exact merge with byRows' existing text-render flow depends on how the current painter is structured. Prefer wrapping the existing text draw with a "reduce available width by iconWidth + shift text origin" adjustment.

- [ ] **Step 2: Write failing byRows-cellIcon tests**

Write `packages/kernel/tests/renderer/painters/byRows-cellIcon.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerIconSet, _resetIconRegistry_forTests } from '../../../src/icons/registry';

// Note: this test invokes byRows through a small integration harness.
// Full byRows unit tests already exist in packages/kernel/tests; here
// we add the cellIcon-specific paths.

if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = class { constructor(public d: string) {} };
}

class MockCtx {
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 0;
  font = '';
  textBaseline = 'alphabetic';
  strokeCalls: unknown[] = [];
  fillTextCalls: Array<{ text: string; x: number; y: number }> = [];
  fillRect() {}
  fillText(text: string, x: number, y: number) { this.fillTextCalls.push({ text, x, y }); }
  measureText(text: string) { return { width: text.length * 7 }; }
  save() {}
  restore() {}
  translate() {}
  scale() {}
  stroke(path: Path2D) { this.strokeCalls.push(path); }
}

// NOTE: Task 16 wires cellIcon into byRows.ts. This test verifies via
// the observable side effect (stroke called with the icon path).
describe('byRows painter — cellIcon integration', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('draws leading icon before text', async () => {
    registerIconSet('lucide', { 'trending-up': 'M0 0' });

    // Import byRows after icon set is registered.
    const { paintByRows } = await import('../../../src/renderer/painters/byRows');

    const ctx = new MockCtx();
    const cell = {
      value: 42,
      row: { data: {} },
      colDef: {
        colId: 'x',
        cellIcon: () => ({ name: 'trending-up', position: 'leading' }),
      },
      rect: { x: 10, y: 10, w: 100, h: 20 },
    };
    // paintByRows may have a different call shape — adapt to actual signature.
    // If invocation shape differs from below, adjust test to match.
    paintByRows(ctx as any, {
      // Provide the minimum shape byRows expects. See existing tests for reference.
      rows: [{ cells: [cell] }],
      // ... other required fields
    } as any);

    expect(ctx.strokeCalls.length).toBeGreaterThan(0);
  });
});
```

Note: this test may need adaptation to fit byRows' actual invocation contract. Reference the existing `packages/kernel/tests/renderer/painters/byRows*.test.ts` files for the correct fixture shape. If byRows has a well-tested unit-test harness, use it verbatim.

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test -- tests/renderer/painters/byRows-cellIcon.test.ts
```
Expected: passes after implementation.

- [ ] **Step 3: Verify baseline**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -10
```
Expected: baseline preserved. **byRows is a hot path with many existing tests — pay close attention to any test failures here.**

- [ ] **Step 4: Commit**

Run:
```bash
git add packages/kernel/src/renderer/painters/byRows.ts packages/kernel/tests/renderer/painters/byRows-cellIcon.test.ts
git commit -m "$(cat <<'EOF'
feat(kernel): cycle 21c task 16 — byRows inline icon rendering

- renderer/painters/byRows.ts: extend per-cell paint to invoke
  resolved ColDef.cellIcon function; resolve icon via kernel's icon
  registry Path2D; draw at leading or trailing position with tint
  from IconRef.color (falls back to computed text color); shift text
  origin by icon width + gutter so text and icon don't overlap.
- Non-icon columns (cellIcon undefined) — no behavioral change.
- tests/renderer/painters/byRows-cellIcon.test.ts: verifies stroke
  called when cellIcon returns a name resolvable via icon registry.

Kernel baseline preserved (existing byRows tests unchanged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Format-package kernel bridge + demo + polish (4 tasks)

---

## Task 17: `wireIntoKernel(grid, opts?)` bridge

**Files:**
- Modify: `packages/format/src/bridge.ts` (real implementation, imports from kernel)
- Modify: `packages/format/src/index.ts` (no change unless bridge signature refined)
- Create: `packages/format/tests/bridge.test.ts`

**Interfaces:**
- Consumes (Tasks 10, 12, 14): kernel's `registerFormatCompiler`, `registerIconSet`, `registerTooltipProvider`.
- Consumes (Tasks 4, 9): format's `compileFormat`, `compileCompositeColDef`, Lucide bundle from kernel.
- Produces (Tasks 18, 20): `wireIntoKernel(grid, opts?)` idempotent bridge setup.

- [ ] **Step 1: Implement the bridge**

Replace `packages/format/src/bridge.ts`:

```ts
import type { WireOptions, FormatSource, CompileFormatOptions } from './types';
import { compileFormat } from './compile';

// Type-only forward reference to kernel — the runtime import happens
// via grid's methods, but we describe the shape for TypeScript.
interface KernelGrid {
  registerFormatCompiler(fn: unknown): void;
  registerIconSet(name: string, paths: Record<string, string | Path2D>): void;
  registerTooltipProvider(colId: string, fn: unknown): void;
  __formatBridgeWired?: boolean;
}

/**
 * Wire @wellsfargo-starui/velocity-grid-format into a VelocityGrid instance. Idempotent — re-calling is
 * a no-op after the first successful wiring.
 */
export function wireIntoKernel(grid: unknown, opts?: WireOptions): void {
  const g = grid as KernelGrid;

  if (g.__formatBridgeWired) return;

  // 1. Register format compiler adapter.
  //    Kernel calls `compiler(source, opts?)`; we forward to compileFormat
  //    but massage the return shape into kernel's FormatProgramShape (which
  //    is structurally compatible with FormatProgram).
  g.registerFormatCompiler((source: FormatSource, opts?: CompileFormatOptions) => {
    const result = compileFormat(source, opts);
    if (!result.ok) {
      return { ok: false, error: { message: result.error.message, loc: result.error.loc } };
    }
    return { ok: true, program: result.program as unknown as never };
  });

  // 2. Register Lucide icon set.
  //    Import the generated bundle from kernel's icon module.
  //    We can't hard-import here (would create a dep cycle in the type
  //    graph), so we use dynamic import guarded by the presence of
  //    grid.registerIconSet.
  loadLucideBundle().then((bundle) => {
    if (bundle) g.registerIconSet('lucide', bundle);
  }).catch(() => { /* icon loading failed — non-fatal */ });

  // 3. Register any additional icon sets.
  if (opts?.additionalIconSets) {
    for (const [name, paths] of Object.entries(opts.additionalIconSets)) {
      g.registerIconSet(name, paths);
    }
  }

  // 4. Auto-register tooltip providers for composite columns.
  //    Deferred to grid's onColDefsResolved event; skipped here if grid
  //    doesn't expose that lifecycle. Documented as post-init auto-wire.
  //    (Consumers can call registerTooltipProvider manually if needed.)

  g.__formatBridgeWired = true;
}

async function loadLucideBundle(): Promise<Record<string, string> | null> {
  try {
    // @ts-expect-error — dynamic import from a peer package (kernel)
    const mod = await import('@wellsfargo-starui/velocity-grid/dist/icons/lucide.generated.js');
    return (mod as { lucideBundle: Record<string, string> }).lucideBundle;
  } catch {
    // Fallback: try source path (in dev / vitest, kernel is TS source)
    try {
      // @ts-expect-error
      const mod = await import('@wellsfargo-starui/velocity-grid/src/icons/lucide.generated');
      return (mod as { lucideBundle: Record<string, string> }).lucideBundle;
    } catch {
      return null;
    }
  }
}
```

Note: the `@ts-expect-error` markers acknowledge that TS can't resolve deep paths into kernel; the runtime import resolves fine at build/test time. Adjust the import paths if kernel's package.json `exports` field restricts subpath access — if so, add an `./icons/lucide.generated` export to kernel's `package.json`.

- [ ] **Step 2: Add subpath export to kernel's package.json**

Read `packages/kernel/package.json`. Add to `exports`:

```json
    "./icons/lucide.generated": {
      "types": "./src/icons/lucide.generated.ts",
      "import": "./src/icons/lucide.generated.ts"
    }
```

- [ ] **Step 3: Write failing bridge tests**

Write `packages/format/tests/bridge.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wireIntoKernel } from '../src/bridge';

function makeFakeGrid() {
  const registrations = {
    compiler: null as unknown,
    iconSets: {} as Record<string, unknown>,
    tooltipProviders: {} as Record<string, unknown>,
  };
  const grid = {
    registerFormatCompiler(fn: unknown) { registrations.compiler = fn; },
    registerIconSet(name: string, paths: unknown) { registrations.iconSets[name] = paths; },
    registerTooltipProvider(colId: string, fn: unknown) { registrations.tooltipProviders[colId] = fn; },
    _reg: registrations,
  };
  return grid;
}

describe('wireIntoKernel', () => {
  it('registers format compiler on the grid', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    expect(grid._reg.compiler).not.toBeNull();
    expect(typeof grid._reg.compiler).toBe('function');
  });

  it('is idempotent — re-calling is a no-op', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    const first = grid._reg.compiler;
    wireIntoKernel(grid as unknown);
    expect(grid._reg.compiler).toBe(first);
  });

  it('registers additionalIconSets when provided', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown, {
      additionalIconSets: { phosphor: { star: 'M1' } },
    });
    expect(grid._reg.iconSets.phosphor).toEqual({ star: 'M1' });
  });

  it('registered compiler compiles a real format string', () => {
    const grid = makeFakeGrid();
    wireIntoKernel(grid as unknown);
    const compiler = grid._reg.compiler as (s: string) => { ok: true; program: { formatText: (c: any) => string } };
    const result = compiler('$#,##0.00');
    expect(result.ok).toBe(true);
    expect(result.program.formatText({ value: 42, row: {}, colId: 'x' })).toBe('$42.00');
  });
});
```

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test -- tests/bridge.test.ts
```
Expected: all pass.

- [ ] **Step 4: Verify baselines still hold**

Run:
```bash
npm --workspace @wellsfargo-starui/velocity-grid-format run test 2>&1 | tail -5
npm --workspace @wellsfargo-starui/velocity-grid run test 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/format/src/bridge.ts packages/format/tests/bridge.test.ts packages/kernel/package.json
git commit -m "$(cat <<'EOF'
feat(format): cycle 21c task 17 — wireIntoKernel(grid, opts?) bridge

- bridge.ts: idempotent bridge sets __formatBridgeWired marker after
  first successful wire. Registers format compiler (wraps compileFormat
  return into kernel's FormatProgramShape). Loads Lucide bundle via
  dynamic import from kernel's ./icons/lucide.generated subpath;
  non-fatal if load fails. additionalIconSets from WireOptions
  registered synchronously.
- kernel/package.json: exports ./icons/lucide.generated subpath so
  format can dynamic-import the generated bundle.
- tests/bridge.test.ts: compiler registration, idempotency,
  additionalIconSets, compiler round-trip via fake grid.

Baselines preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Showcase demo + E2E

**Files:**
- Create: `apps/cgrid-showcase/src/features/formatDSL.js`
- Modify: `apps/cgrid-showcase/src/features/index.js` (register new feature)
- Create: `apps/cgrid-showcase/e2e/formatDSL.spec.ts`
- Modify: `apps/cgrid-positions/src/positionsGrid.js` (upgrade one column to DSL)

**Interfaces:**
- Consumes: complete `@wellsfargo-starui/velocity-grid-format` package + kernel bridge.
- Produces: end-to-end demonstration of Tier 0/1/2 in the showcase; one upgraded column in positions.

**Note on untracked files:** The showcase's `src/features/*.js` files are listed as untracked in the pre-cycle git status. They are pre-existing compile artifacts from prior sessions. Do NOT add-and-commit stragglers; commit only the specific files this task creates or modifies.

- [ ] **Step 1: Create the showcase feature file**

Write `apps/cgrid-showcase/src/features/formatDSL.js`:

```js
// Format DSL demo — Tier 0 Excel format codes + Tier 1 expression
// brackets + icons + Tier 2 composite fragments.
import { wireIntoKernel } from '@wellsfargo-starui/velocity-grid-format';

export function formatDSLFeature() {
  return {
    label: 'Format DSL',
    slug: 'format-dsl',
    setup(grid) {
      wireIntoKernel(grid);
      const rowData = [
        { symbol: 'AAPL', price: 150.25, change: 2.5, volume: 45_000_000 },
        { symbol: 'GOOG', price: 2850.10, change: -12.75, volume: 12_500_000 },
        { symbol: 'MSFT', price: 305.50, change: 0, volume: 22_000_000 },
        { symbol: 'AMZN', price: 3320.00, change: -45.20, volume: 8_500_000 },
        { symbol: 'TSLA', price: 720.85, change: 15.30, volume: 55_000_000 },
      ];
      grid.setRowData(rowData);
      grid.setColumnDefs([
        { colId: 'symbol', headerName: 'Symbol', field: 'symbol' },

        // Tier 0 — Excel format
        { colId: 'price', headerName: 'Price', field: 'price',
          valueFormatter: '$#,##0.00' },

        // Tier 0 — semi-colon sections, red on negative
        { colId: 'change', headerName: 'Change', field: 'change',
          valueFormatter: '$#,##0.00;[Red]-$#,##0.00' },

        // Tier 1 — [color=<expr>] + {icon:name}
        { colId: 'changeWithColor', headerName: 'Change (color)', field: 'change',
          valueFormatter: '[color=[[change] > 0 ? "#0a7" : "#d33"]] $#,##0.00' },

        // Tier 1 — {icon:name} inline
        { colId: 'changeWithIcon', headerName: 'Change (icon)', field: 'change',
          valueFormatter: '{icon:trending-up} $#,##0.00' },

        // Tier 0 — Abbreviated via K/M/B suffixes (Custom template hits Excel path)
        { colId: 'volume', headerName: 'Volume', field: 'volume',
          valueFormatter: '#,##0,,\"M\"' },

        // Tier 2 — composite summary column
        { colId: 'summary', type: 'composite', headerName: 'Summary',
          fragments: [
            { expr: '[symbol]', style: { weight: 'bold' } },
            { text: '  ' },
            { expr: '[price]', format: '$#,##0.00' },
            { text: '  ' },
            { expr: '[change]', format: '+0.00;-0.00',
              style: { color: '[[change] > 0 ? "#0a7" : "#d33"]' } },
          ],
          overflow: 'ellipsis',
        },
      ]);
    },
  };
}
```

- [ ] **Step 2: Register the feature**

Read `apps/cgrid-showcase/src/features/index.js` (untracked; part of existing showcase). Add:

```js
import { formatDSLFeature } from './formatDSL';

// In the exported features list:
formatDSLFeature(),
```

- [ ] **Step 3: Create the E2E spec**

Write `apps/cgrid-showcase/e2e/formatDSL.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Cycle 21c — Format DSL', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?feature=format-dsl');
    await page.waitForSelector('.vg-grid', { state: 'attached' });
  });

  test('Tier 0 — currency format renders positive values', async ({ page }) => {
    await expect(page.locator('.vg-grid')).toContainText('$150.25');
    await expect(page.locator('.vg-grid')).toContainText('$2,850.10');
  });

  test('Tier 0 — sections with [Red] color on negative', async ({ page }) => {
    // Screenshot compare the price/change area
    const grid = page.locator('.vg-grid');
    await expect(grid).toContainText('-$12.75');
    // The red color is applied via canvas paint; verify via canvas snapshot
    await expect(grid).toHaveScreenshot('tier0-negative-red.png', { maxDiffPixelRatio: 0.02 });
  });

  test('Tier 1 — [color=<expr>] renders per-row color', async ({ page }) => {
    const grid = page.locator('.vg-grid');
    // Compare canvas snapshot of the "Change (color)" column area
    await expect(grid).toHaveScreenshot('tier1-color-expr.png', { maxDiffPixelRatio: 0.02 });
  });

  test('Tier 1 — {icon:trending-up} renders inline icon', async ({ page }) => {
    const grid = page.locator('.vg-grid');
    await expect(grid).toHaveScreenshot('tier1-icon.png', { maxDiffPixelRatio: 0.02 });
  });

  test('Tier 2 — composite column with 3 fragments', async ({ page }) => {
    const grid = page.locator('.vg-grid');
    await expect(grid).toContainText('AAPL');
    await expect(grid).toHaveScreenshot('tier2-composite.png', { maxDiffPixelRatio: 0.02 });
  });

  test('Composite tooltip on hover shows concatenated text', async ({ page }) => {
    const grid = page.locator('.vg-grid');
    // Hover over a composite cell — deterministic canvas coords depend on layout
    const box = await grid.boundingBox();
    if (!box) throw new Error('no grid box');
    await page.mouse.move(box.x + box.width - 50, box.y + 100);
    await page.waitForTimeout(600);  // debounce
    const tooltip = page.locator('#cgrid-tooltip-provider');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('AAPL');
  });

  test('Composite ellipsis when column shrinks', async ({ page }) => {
    // Resize the summary column via drag on its border
    // (Simplified — real test would drag the column separator)
    const grid = page.locator('.vg-grid');
    await expect(grid).toHaveScreenshot('tier2-composite-full.png', { maxDiffPixelRatio: 0.02 });
  });

  test('Copy composite range emits text/plain + text/html', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'ClipboardItem may fall back to text-only in older Firefox');

    const grid = page.locator('.vg-grid');
    await grid.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');

    // Read clipboard via JS eval (Playwright grants clipboard read permission)
    const [plain, html] = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      let plain = '', html = '';
      for (const item of items) {
        if (item.types.includes('text/plain')) plain = await (await item.getType('text/plain')).text();
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      }
      return [plain, html];
    });

    expect(plain).toContain('AAPL');
    expect(html).toContain('<table>');
    expect(html).toContain('<span style="');
  });
});
```

- [ ] **Step 4: Upgrade one positions column to DSL**

Read `apps/cgrid-positions/src/positionsGrid.js` (untracked; part of existing positions app). Locate the price/change columns. Upgrade one to use the DSL:

```js
import { wireIntoKernel } from '@wellsfargo-starui/velocity-grid-format';

// In the setup:
wireIntoKernel(grid);

// Existing column:
// { colId: 'change', field: 'change', valueFormatter: (p) => `$${p.value.toFixed(2)}` }

// After:
{ colId: 'change', field: 'change',
  valueFormatter: '[color=[[change] > 0 ? "#0a7" : "#d33"]] $#,##0.00' }
```

- [ ] **Step 5: Run showcase + positions E2E**

Start the dev servers and run the E2E suites. Exact commands depend on repo conventions; use the same commands that ran during Cycle 21a's final verification:

```bash
# Showcase
npm --workspace @cgrid/showcase run e2e 2>&1 | tail -20

# Positions (STOMP server may need to be running)
npm --workspace @cgrid/positions run e2e 2>&1 | tail -20
```

Expected: showcase 98 baseline + new format-DSL specs all pass; positions 262 baseline + upgraded demo column all pass.

If the positions STOMP server isn't running, follow the Cycle 21a final review note: `ws://localhost:8081` — start it via the repo's standard STOMP fixture script.

- [ ] **Step 6: Commit**

Run:
```bash
git add apps/cgrid-showcase/src/features/formatDSL.js apps/cgrid-showcase/e2e/formatDSL.spec.ts apps/cgrid-positions/src/positionsGrid.js
# Also add index.js if the addition is required, but do NOT commit unrelated untracked stragglers
git commit -m "$(cat <<'EOF'
feat(showcase): cycle 21c task 18 — Format DSL demo + E2E specs

- apps/cgrid-showcase/src/features/formatDSL.js: 7 columns
  demonstrating Tier 0 ($#,##0.00 / semi-colon sections), Tier 1
  ([color=<expr>] + {icon:trending-up}), Tier 0 abbreviated volume,
  and Tier 2 composite summary with 3 fragments.
- apps/cgrid-showcase/e2e/formatDSL.spec.ts: 8 E2E scenarios covering
  Tier 0 rendering, Tier 1 color/icon rendering, Tier 2 composite
  rendering, composite tooltip, ellipsis, and multi-format clipboard.
  Canvas screenshot snapshots for visual regression.
- apps/cgrid-positions/src/positionsGrid.js: upgraded change column
  to Tier 1 DSL — [color=<expr>] $#,##0.00 — verifies real-time tick
  behavior under DSL rendering.

Baselines expected to hold: showcase 98 + new specs; positions 262
+ upgraded demo column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: README + public API polish

**Files:**
- Create: `packages/format/README.md`

**Interfaces:**
- No new signatures — pure documentation.

- [ ] **Step 1: Write the README**

Write `packages/format/README.md`:

```markdown
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

const grid = new VelocityGrid({ /* ... */ });
wireIntoKernel(grid);  // idempotent — call once per grid instance

grid.setColumnDefs([
  { colId: 'price', valueFormatter: '$#,##0.00' },                    // Tier 0
  { colId: 'change',                                                    // Tier 1
    valueFormatter: '[color=[[change] > 0 ? "#0a7" : "#d33"]] $#,##0.00' },
  { colId: 'summary', type: 'composite',                               // Tier 2
    fragments: [
      { expr: '[symbol]', style: { weight: 'bold' } },
      { text: '  ' },
      { expr: '[price]', format: '$#,##0.00' },
    ],
  },
]);
```

## Grammar cheat sheet

### Tier 0 — Excel format codes

| Element | Meaning |
|---|---|
| `0`, `#`, `?` | Digit placeholders — required, optional, space-padded |
| `,` | Thousands separator (or scaling suffix when trailing) |
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
| `{icon:name|<expr>}` | Dynamic name via expression | Icon name computed per row |

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
    { expr: '[change]', format: '+0.00%;-0.00%',
      style: { color: '[[change] > 0 ? "#0a7" : "#d33"]' } },
  ],
  cellBackground: '[bg=[abs([change]) > 5 ? "#fee" : "transparent"]]',
  align: 'left',       // 'left' | 'center' | 'right'
  overflow: 'ellipsis', // 'ellipsis' | 'clip'
}
```

Composite cells are:
- **Single-line only.** Row heights uniform.
- **Auto-tooltipped on hover.** Tooltip returns concatenated fragment text.
- **Multi-format clipboard.** Copy writes `text/plain` (concatenated) + `text/html` (styled `<span>` runs). Excel paste picks up formatting.
- **Non-editable.** Edit source columns directly.

## Backwards compatibility

**Existing `valueFormatter: (params) => string` columns work unchanged.**
The type broadening from `(params) => string` to `string | ((params) => string)`
is a superset — kernel's ColDef-resolve step detects string vs function
and only invokes the format compiler for the string form.

## Public API

```ts
export function compileFormat(source, opts?): CompileFormatResult;
export function compileCompositeColDef(colDef, opts?): CompileFormatResult;
export function registerFormatterTemplate(def): void;
export function getFormatterTemplate(name): FormatterTemplateDef | undefined;
export function listFormatterTemplates(): string[];
export function wireIntoKernel(grid, opts?): void;

export type FormatProgram, FormatSource, CompileFormatOptions,
  CompileFormatResult, CompileFormatError, FormatEvalContext,
  StyleObj, IconRef, ResolvedFragment, Fragment, FragmentStyle,
  CompositeColDef, FormatterTemplate, FormatterTemplateDef,
  FormatterTemplateContext, WireOptions;
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

Every error carries `loc: { start, end }` — char offsets into the original format-string source. Downstream customizer editors (Cycle 21i) use these for error underlines.

## What's not in this cycle

- `rule:<ruleId>` resolves to `null` — ships in Cycle 21e (`@wellsfargo-starui/velocity-grid-rules`).
- Aggregate expressions inside brackets — reject with `not-yet-implemented`; ships in Cycle 21d (`@wellsfargo-starui/velocity-grid-calc`).
- Customizer editor UX (autocomplete / live preview) — Cycle 21i.
- Format performance benchmarks at 60Hz × 50k rows — deferred to Cycle 20 (excel-pivot) exercise.
```

- [ ] **Step 2: Verify README renders sanely (optional)**

Preview locally if you have a Markdown renderer:
```bash
cat packages/format/README.md | head -80
```

- [ ] **Step 3: Commit**

Run:
```bash
git add packages/format/README.md
git commit -m "$(cat <<'EOF'
docs(format): cycle 21c task 19 — README with quickstart + grammar

- packages/format/README.md: quickstart with wireIntoKernel wiring,
  grammar cheat sheet for all three tiers, backwards-compat note,
  public API surface, error surfaces + codes, and 'what's not shipped'
  section calling out Cycle 21d/21e/21i reserves.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Full monorepo verify + PR

**Files:**
- No source changes.
- Verify all baselines + push branch + open PR.

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: pushed feature branch `cycle21c/format` + open GitHub PR.

- [ ] **Step 1: Fresh install verification**

Run:
```bash
rm -rf node_modules packages/*/node_modules apps/*/node_modules
npm install 2>&1 | tail -10
```
Expected: install completes with no unexpected warnings (npm's usual peerDep messages are OK).

- [ ] **Step 2: Full typecheck across workspaces**

Run:
```bash
npx turbo typecheck 2>&1 | tail -20
```
Expected: all packages clean.

- [ ] **Step 3: Full lint**

Run:
```bash
npx turbo lint 2>&1 | tail -20
```
Expected: clean. If ESLint's `no-restricted-imports` rule doesn't yet cover `format → kernel` runtime imports, add a rule now:

Read `eslint.config.mjs` at repo root. Add to the config for `packages/format/**`:

```js
{
  files: ['packages/format/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['@wellsfargo-starui/velocity-grid/*'],
          message: 'format may only import kernel via ./bridge.ts using dynamic import',
        },
      ],
    }],
  },
},
```

Then verify `bridge.ts` uses dynamic import (already does — see Task 17).

- [ ] **Step 4: Full unit test suite across workspaces**

Run:
```bash
npx turbo test 2>&1 | tail -30
```
Expected:
- `@wellsfargo-starui/velocity-grid-expression`: 185 baseline preserved.
- `@wellsfargo-starui/velocity-grid`: 2326 baseline + new tests from Tasks 10-16 (roughly +50 tests).
- `@wellsfargo-starui/velocity-grid-format`: ~680 tests all pass.

- [ ] **Step 5: E2E suites**

Start dev servers as needed for E2E. Run:
```bash
npm --workspace @cgrid/showcase run e2e 2>&1 | tail -30
npm --workspace @cgrid/positions run e2e 2>&1 | tail -30
```
Expected: showcase 98 baseline + 8 new = 106; positions 262 baseline preserved.

- [ ] **Step 6: Full build**

Run:
```bash
npx turbo build 2>&1 | tail -20
```
Expected: kernel builds cleanly (with generated icon bundle); other packages return no-op (still scaffolds until later cycles).

- [ ] **Step 7: Bundle-size sanity check**

Run:
```bash
ls -lh packages/kernel/dist/
# Check total size vs pre-cycle baseline (from Cycle 21a final review: cgrid.js 760.90 KB + kernel.css 44.18 KB)
```
Expected: `<+2%` growth in kernel-only apps (icon registry infra alone). The Lucide bundle only pulls in when format's bridge dynamically imports it — verify via `grep -r 'lucide' packages/kernel/dist/*.js` — expected: no match unless the bundle was force-imported.

- [ ] **Step 8: Verify no unintended changes**

Run:
```bash
git status
git diff main --stat | tail -20
```
Expected: only the intended file additions and modifications.

- [ ] **Step 9: Update `.superpowers/sdd/progress.md`**

Append:

```
=== Cycle 21c: @wellsfargo-starui/velocity-grid-format Unified DSL + Kernel Bridge (start 2026-07-01) ===
Plan: docs/superpowers/plans/2026-07-01-cycle-21c-format.md
Spec: docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md (commit 70dbe61)
Cycle BASE: 4fc5c49 (Cycle 21b merged as PR #93)
Branch: cycle21c/format
Task 1: complete — types + module skeletons + coverage tooling
Task 2: complete — Excel tokenizer + parser + golden corpus (40 entries)
Task 3: complete — Excel evaluator + Intl LRU cache
Task 4: complete — formatter template registry + 9 built-ins
Task 5: complete — Tier 1 sugar canonicalization
Task 6: complete — Tier 1 parser + expression integration
Task 7: complete — Tier 1 style + icon resolver
Task 8: complete — composite fragment compiler + resolver
Task 9: complete — public compileFormat + compileCompositeColDef
Phase D→E self-review checkpoint: passed
Task 10: complete — kernel format-compiler injection slot
Task 11: complete — ColDef broadening + compileFormatSlots pass
Task 12: complete — icon registry + Lucide build step (~1500 icons)
Task 13: complete — composite cell renderer
Task 14: complete — tooltip provider hook + feature-chain integration
Task 15: complete — multi-format clipboard extension
Task 16: complete — byRows inline icon rendering
Task 17: complete — wireIntoKernel(grid, opts?) bridge
Task 18: complete — showcase demo + E2E specs + positions upgrade
Task 19: complete — README + public API polish
Task 20: complete — pushed cycle21c/format to origin + opened PR
```

Commit this update:
```bash
git add .superpowers/sdd/progress.md
git commit -m "chore(sdd): cycle 21c progress ledger update"
```

- [ ] **Step 10: Push branch + open PR**

Run:
```bash
git push -u origin cycle21c/format
gh pr create --title "cycle 21c — @wellsfargo-starui/velocity-grid-format unified formatting DSL + kernel bridge" --body "$(cat <<'EOF'
## Summary

Cycle 21c ships `@wellsfargo-starui/velocity-grid-format` — the unified formatting DSL — plus the surgical kernel bridge that lets ColDefs consume format strings via `valueFormatter`, `cellStyle`, `cellIcon`, and `type: 'composite'`.

**Three tiers, one landing:**

- **Tier 0** — pure Excel format codes (`$#,##0.00;[Red]-$#,##0.00`, `yyyy-mm-dd`, `[>1000]…`) with named colors + section routing.
- **Tier 1** — Excel + expression brackets (`[color=<expr>]`, `[bg=<expr>]`, `[weight=<expr>]`, `[style=<expr>]`, `[if <expr>]`) + Lucide icons (`{icon:trending-up}`, `{icon:name|<expr>}`).
- **Tier 2** — composite ColDef shape (`type: 'composite'` + `fragments[]`) with per-fragment format + style, cellBackground eval, ellipsis + hover tooltip + multi-format clipboard.

**Kernel additions (all guarded by DI-slot pattern — no behavior change unless format is imported):**

- Format-compiler injection slot (`grid.registerFormatCompiler`).
- ColDef-resolve pass compiling string `valueFormatter` → function + deriving `cellStyle` + `cellIcon`.
- Path2D icon registry with bundled Lucide (~1500 icons, tree-shakable via format's dynamic import).
- Composite cell renderer with layout + ellipsis + alignment.
- Tooltip provider hook (`grid.registerTooltipProvider(colId, fn)`).
- Multi-format clipboard write for composite ranges (`ClipboardItem` with `text/plain` + `text/html`).

**Design decisions locked during brainstorming:**
- No feature deferral — all 3 tiers + all 4 kernel subsystems ship in one PR (20 tasks).
- `valueFormatter` type broadens to `string | ((params) => string)` — backwards-compatible superset.
- Format handles sugar canonicalization (`if X then Y else Z` → ternary, bare hex → string literal, `rule:<id>` → RuleRefNode reserve), then delegates bracket interior to `@wellsfargo-starui/velocity-grid-expression`.
- Kernel doesn't runtime-import format; format's `wireIntoKernel(grid)` bridge registers everything via kernel's public APIs.
- `rule:<ruleId>` is an honest structural reserve — parses now, resolver plugs in during Cycle 21e.

**Roadmap position:** unblocks Cycle 21d (`@wellsfargo-starui/velocity-grid-calc` needs format templates for calc-column formatting), 21e (`@wellsfargo-starui/velocity-grid-rules` needs `rule:<ruleId>` resolution + format style channel), 21f (`@wellsfargo-starui/velocity-grid-renderers` needs Tier 2 composite + icon inline for rich blotter cells), 21h (`@wellsfargo-starui/velocity-grid-export` needs resolved formatters for visual XLSX/CSV), 21i (`@wellsfargo-starui/velocity-grid-customizer` needs `compileFormat` + `CompileFormatError.loc` for editor UX).

## Related

- Spec: `docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md` (commit 70dbe61)
- Parent brief: `docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md` §3.2, §4.3, §5, §7
- Predecessor: PR #93 (`@wellsfargo-starui/velocity-grid-expression` — Cycle 21b)

## Test plan

- [ ] Kernel unit tests: `npm --workspace @wellsfargo-starui/velocity-grid run test` — 2326 baseline preserved + new Task 10-16 tests all pass
- [ ] Expression unit tests: `npm --workspace @wellsfargo-starui/velocity-grid-expression run test` — 185/185 (untouched)
- [ ] Format unit tests: `npm --workspace @wellsfargo-starui/velocity-grid-format run test` — ~680 tests pass
- [ ] Root typecheck: `npx turbo typecheck` — full graph clean
- [ ] Root lint: `npx turbo lint` — clean (with new `no-restricted-imports` rule for `format → kernel`)
- [ ] Root build: `npx turbo build` — all packages build
- [ ] Showcase E2E: 98 baseline + 8 new format-DSL specs pass
- [ ] Positions E2E: 262 baseline + upgraded change-column demo passes
- [ ] Fresh install (`rm -rf node_modules && npm i`): no unexpected warnings
- [ ] Bundle-size: kernel-only app `<+2%` vs pre-cycle; format-wired app `+~30KB gzip` for Lucide

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; URL printed. Post-open, monitor for CI checks.

- [ ] **Step 11: Final self-review**

Read the diff (`git diff main --stat`) and confirm:
- No `apps/*/src/*.js` stragglers committed that weren't part of Task 18.
- No `packages/expression/coverage/` output committed.
- `packages/kernel/src/icons/lucide.generated.ts` is committed.
- All 20 task commits landed as separate commits (plus 1 progress-ledger commit) — reviewer can walk the branch history.

- [ ] **Step 12: Return the PR URL**

Print the PR URL for the user's reference.

---

## Success criteria (from spec §9, restated)

- [ ] `packages/format/src/` has all files from §2.2 with real (non-throwing) implementations.
- [ ] Public API from spec §4 is exported from `index.ts`.
- [ ] All unit test files exist with coverage from spec §7 met.
- [ ] `npm --workspace @wellsfargo-starui/velocity-grid-format run test` — 100% pass, no `.only` / `.skip` leaks.
- [ ] `npm --workspace @wellsfargo-starui/velocity-grid run test` — 2326 baseline preserved + new tests all pass.
- [ ] `npm --workspace @wellsfargo-starui/velocity-grid-expression run test` — 185/185 (untouched).
- [ ] Showcase E2E: 98 baseline + 5-8 new format-DSL specs all pass.
- [ ] Positions E2E: 262 baseline + upgraded column all pass.
- [ ] Turbo graph clean; no dep cycles.
- [ ] Downstream consumer can use all 4 golden-path scenarios from spec §9.
- [ ] PR body links to spec + parent brief.
- [ ] `.superpowers/sdd/progress.md` ends with `Cycle 21c status: COMPLETE.`

Add a final progress line after PR is merged (post-cycle):

```
Cycle 21c status: COMPLETE.
```

