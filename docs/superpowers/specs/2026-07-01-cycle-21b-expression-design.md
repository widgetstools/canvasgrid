# Cycle 21b — `@wellsfargo-starui/velocity-grid-expression` (Greenfield DSL) — Design

**Status:** Draft — pending user review before writing implementation plan.
**Date:** 2026-07-01
**Predecessor:** [Cycle 21a monorepo scaffold plan](../plans/2026-07-01-cycle-21a-monorepo-scaffold.md) (merged as PR #92)
**Parent brief:** [Cycle 21 modular monorepo + intrinsic features](../plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) §3.2, §4.2, §7
**Successor cycles unblocked:** 21c (`@wellsfargo-starui/velocity-grid-format`), 21d (`@wellsfargo-starui/velocity-grid-calc`), 21e (`@wellsfargo-starui/velocity-grid-rules`), 21f (`@wellsfargo-starui/velocity-grid-renderers`), 21g (`@wellsfargo-starui/velocity-grid-edit`), 21h (`@wellsfargo-starui/velocity-grid-export`), 21i (`@wellsfargo-starui/velocity-grid-customizer`)

---

## §1 Scope & non-goals

### In scope

- **Greenfield build** of `@wellsfargo-starui/velocity-grid-expression`. Kernel is *not* touched this cycle — no migration, no bridge, no consumer wiring. Grep of `packages/kernel/src` confirms there is no in-kernel expression engine to move; the nearest cousin is the floating-filter parser (235 LOC, filter-chip composition only) which stays where it is.
- **Row-local DSL only.** Field access (`[field.subfield]`), literals (number / string / boolean / null), arithmetic / comparison / logical / ternary operators, string concat, ~14 built-in functions:
    - Control: `IF`, `COALESCE`
    - Logical: `NOT`, `AND`, `OR`
    - Numeric: `ABS`, `ROUND`, `MIN`, `MAX`, `FLOOR`, `CEIL`
    - String: `LOWER`, `UPPER`, `LEN`
- **Full §4.2 public API surface, day one.** `parse`, `compile`, `evaluate`, `validate`, plus published types. Compiled representation is a **closure**, produced via recursive lambda composition (CSP-safe; no `new Function`).
- **AST future-proofing for aggregates + `prev()`.** The AST *schema* includes `AggregateNode` and `PrevNode` as reserved node kinds for Cycle 21d's post-compile transformation. 21b's parser never emits them; 21b's compiler rejects them if present. Aggregate + `PREV(...)` **syntax** in source is parsed as a normal `CallNode`; compile rejects by name with `CompileError { code: 'not-yet-implemented' }`. Downstream consumers get a stable AST + a clear error until 21d wires the evaluator.
- **Landing:** single PR (`cycle21b/expression`) with 5 sequential tasks via [superpowers:subagent-driven-development](../../../.superpowers/sdd/README.md). Each task = one subagent, one commit, review-gated. Mirrors Cycle 21a cadence.

### Out of scope (deferred to later cycles)

- Aggregate evaluation — `SUM`, `AVG`, `COUNT`, `MIN`, `MAX` (aggregate forms), `RUNNING_SUM`, `RUNNING_AVG`, `MOVING_AVG(n)`, `FIRST`, `LAST`, `DELTA_FROM_PREV`, `DELTA_FROM_FIRST`, `DELTA_FROM_LAST` → **Cycle 21d** (`@wellsfargo-starui/velocity-grid-calc`).
- Tick-scoped `prev()` snapshot semantics → **Cycle 21d** (needs the tick / transaction infrastructure calc will land).
- Any consumer wiring in kernel, format, rules, or calc → **their own cycles**.
- Performance benchmark harness / closure specialization → **deferred** until a real consumer (format or calc) exercises the hot path and we can measure against 8ms/frame at 50k rows.
- Localized error messages, LSP integration, source maps → **deferred** to customizer cycles.

### Non-goals

- No changes to `packages/kernel/**` this cycle.
- No worker-boundary enforcement inside the package. The §7 "worker-only expression evaluation" policy is a *deployment constraint* on downstream packages (format, rules, calc, customizer choose which thread to run eval on). The evaluator itself is thread-agnostic — it just takes an `EvalContext` and returns a value.

---

## §2 Architecture

### 2.1 Package boundary

`@wellsfargo-starui/velocity-grid-expression` is a **leaf** in the Cycle 21 §3.2 dependency graph (`expression (no cgrid deps)`). It has:

- **Zero cgrid dependencies.** No import from `@wellsfargo-starui/velocity-grid` or any other `@cgrid/*` package.
- **Zero runtime dependencies.** Pure TypeScript standard library.
- **Dev deps only:** `typescript ~5.9.3`, `vitest ^2.1.0` (already in scaffold).

This is intentional: expression is imported by every downstream package (format, rules, calc, renderers, edit, export, customizer, excel-pivot), so keeping it dependency-free maximizes their compositional freedom and minimizes rebuild churn.

### 2.2 Source layout

```
packages/expression/
├── src/
│   ├── types.ts        — public AST types + eval/compile/validate contracts + error types
│   ├── parse.ts        — tokenizer + Pratt-style recursive descent → AST
│   ├── compile.ts      — AST → Compiled closure; validates built-in names + arity; rejects aggregate/prev
│   ├── evaluate.ts     — thin wrapper around Compiled execution + eval-error boundary
│   ├── validate.ts     — parse + type-check pass over AST against a Schema; for future customizer editor
│   ├── builtins.ts     — the 14 built-in function definitions (name, arity, implementation)
│   └── index.ts        — public exports
├── tests/
│   ├── parse.test.ts
│   ├── compile.test.ts
│   ├── evaluate.test.ts
│   ├── validate.test.ts
│   ├── errors.test.ts
│   ├── postmessage-transferability.test.ts
│   └── fixtures/
│       └── ast-corpus.json   — golden ASTs for a canonical expression set
├── README.md
├── package.json
└── tsconfig.json
```

### 2.3 Thread-agnostic evaluator

The compiler produces a `Compiled = { ast: Ast; run: (ctx: EvalContext) => unknown }`. `run` is a closure that captures the compiled dispatch chain — it works in main-thread code, worker code, or a Node.js test environment identically.

The **transport unit** is the `Ast`, not the `Compiled`. `Ast` is a plain-JSON discriminated union, `structuredClone`-safe, `postMessage`-transferable. Typical use pattern in Cycle 21d+:

1. Main thread calls `parse(source)` → `Ast` (once, at column-def time).
2. Main thread `postMessage`s the `Ast` to worker.
3. Worker calls `compile(ast)` → `Compiled` (once, per column-def, cached).
4. Worker calls `evaluate(compiled, { row })` per cell per paint.

This split lets consumers cache `Compiled` on the hot thread while keeping the source-of-truth (the `Ast`) transferable. `parse` is main-thread-only in typical use because it's the expensive text operation, but nothing forbids running it on worker.

---

## §3 Grammar (v1, row-local)

Grammar is designed to feel familiar (Excel-adjacent + JS-adjacent) and to be a clean subset of what §5 / §7 need for format + rules + calc.

### 3.1 Lexical

- **Whitespace:** ignored between tokens (spaces, tabs, newlines).
- **Identifiers:** `[A-Za-z_][A-Za-z0-9_]*` for function names; convention: uppercase for built-ins (`IF`, `SUM`, mirrors Excel).
- **Field access:** `[` `path` `]` where `path` is one or more dotted segments: `[symbol]`, `[trade.price]`, `[book.bids.0.px]`. Numeric segments allowed (array index). Segments are strings in the AST.
- **Number literals:** integers (`42`), decimals (`3.14`), signed via unary minus (`-2.5` parses as `unary('-', literal(2.5))`), scientific (`1e6`, `1.5e-3`).
- **String literals:** double- or single-quoted; escape sequences `\n`, `\t`, `\\`, `\"`, `\'`.
- **Boolean literals:** `true`, `false`.
- **Null literal:** `null`.
- **Operators** (Pratt precedence, tight → loose):
    - Unary prefix: `!`, `-`
    - Multiplicative: `*`, `/`, `%`
    - Additive: `+` (numeric or string concat), `-`
    - Relational: `<`, `<=`, `>`, `>=`
    - Equality: `==`, `!=`
    - Logical AND: `&&`
    - Logical OR: `||`
    - Ternary: `? :`
- **Parentheses:** `( expr )` for grouping.
- **Function call:** `NAME ( arg1 , arg2 , ... )`. Trailing comma disallowed.
- **Comment syntax:** none in v1 (add if a consumer needs it).

### 3.2 Semantics

- **`+` overload:** if both operands are strings at eval time → concat; otherwise numeric add. Type errors bubble up as `EvalError`.
- **Truthiness:** JS semantics — `null`, `false`, `0`, `""`, `NaN` are falsy; everything else truthy.
- **Short-circuit:** `&&`, `||`, ternary all short-circuit at eval.
- **Null-safe field access:** `[a.b.c]` returns `null` (not throws) if any intermediate segment is `null` / `undefined`. Chosen to match user expectation for optional nested paths in row data.
- **Division by zero:** throws `EvalError` code `'div-by-zero'`. Consumers (customizer form validators, rules) can catch.

### 3.3 Aggregate + `prev()` future-proofing

Parser is **name-agnostic**: it produces a `CallNode` for every `NAME(...)` syntax, regardless of whether the name is a built-in, an aggregate, or `PREV`. The parser does not maintain a name registry.

The **compiler** owns the name-registry split:

- Known aggregate names — `SUM`, `AVG`, `COUNT`, `MIN`, `MAX`, `RUNNING_SUM`, `RUNNING_AVG`, `MOVING_AVG`, `FIRST`, `LAST`, `DELTA_FROM_PREV`, `DELTA_FROM_FIRST`, `DELTA_FROM_LAST` — return `CompileError { code: 'not-yet-implemented' }` in Cycle 21b.
- `PREV` — same treatment: `CompileError { code: 'not-yet-implemented' }`.
- Known built-in names — dispatch to `builtins.ts`.
- Anything else — `CompileError { code: 'unknown-fn' }`.

`AggregateNode` and `PrevNode` exist in the AST schema as **reserved node kinds** for Cycle 21d's compile-time AST transformation, which splits `[price] / SUM([price])` into a pre-pass (`AggregateNode` computing `SUM`) plus a per-row program (referencing the pre-computed scalar). 21b's parser never produces them; 21b's compiler never accepts them.

Consequence: when 21d lands, only `compile.ts` and `evaluate.ts` change to add aggregate + prev pathways. AST schema, `parse.ts`, and existing built-in dispatch stay constant. Downstream consumers (format, rules) built against 21b keep working.

---

## §4 AST shape

Discriminated union, plain JSON, no functions, `structuredClone`-safe.

```ts
export type Loc = { start: number; end: number };  // char offsets into source

export type BinaryOp =
  | '*' | '/' | '%' | '+' | '-'
  | '<' | '<=' | '>' | '>='
  | '==' | '!='
  | '&&' | '||';

export type UnaryOp = '!' | '-';

export type AstNode =
  | LiteralNode
  | FieldNode
  | UnaryNode
  | BinaryNode
  | TernaryNode
  | CallNode
  | AggregateNode   // reserved for Cycle 21d — 21b's parser never emits
  | PrevNode;       // reserved for Cycle 21d — 21b's parser never emits

export interface LiteralNode {
  kind: 'literal';
  value: string | number | boolean | null;
  loc: Loc;
}

export interface FieldNode {
  kind: 'field';
  path: string[];       // e.g. ['trade', 'price'] for [trade.price]
  loc: Loc;
}

export interface UnaryNode {
  kind: 'unary';
  op: UnaryOp;
  arg: AstNode;
  loc: Loc;
}

export interface BinaryNode {
  kind: 'binary';
  op: BinaryOp;
  left: AstNode;
  right: AstNode;
  loc: Loc;
}

export interface TernaryNode {
  kind: 'ternary';
  test: AstNode;
  consequent: AstNode;
  alternate: AstNode;
  loc: Loc;
}

export interface CallNode {
  kind: 'call';
  name: string;         // e.g. 'IF', 'ROUND'
  args: AstNode[];
  loc: Loc;
}

// Reserved for Cycle 21d's post-compile AST transformation.
// 21b's parser never emits these; 21b's compiler never accepts these.
export interface AggregateNode {
  kind: 'aggregate';
  name: string;         // e.g. 'SUM', 'RUNNING_AVG'
  args: AstNode[];
  loc: Loc;
}

// Reserved for Cycle 21d. Same status as AggregateNode.
export interface PrevNode {
  kind: 'prev';
  arg: AstNode;         // typically a FieldNode
  loc: Loc;
}

export type Ast = AstNode;   // alias for the root — same union
```

Every node carries a `loc` for editor tooltips + error underlines in customizer.

---

## §5 Public API

```ts
// packages/expression/src/index.ts

export { parse } from './parse';
export { compile } from './compile';
export { evaluate } from './evaluate';
export { validate } from './validate';

export type {
  Ast, AstNode, Loc, BinaryOp, UnaryOp,
  LiteralNode, FieldNode, UnaryNode, BinaryNode,
  TernaryNode, CallNode, AggregateNode, PrevNode,
} from './types';

export type {
  Compiled, CompileOptions,
  EvalContext, EvalError,
  ParseError, ParseResult,
  CompileError, CompileResult,
  ValidationError, ValidationResult, Schema, FieldType,
} from './types';
```

### 5.1 Function contracts

```ts
// parse
export function parse(source: string): ParseResult;

export type ParseResult =
  | { ok: true; ast: Ast }
  | { ok: false; error: ParseError };

export interface ParseError {
  kind: 'parse';
  message: string;      // human-readable, position-annotated in editor
  loc: Loc;
  hint?: string;        // suggestion, e.g. "did you mean '&&'?"
}
```

```ts
// compile
export function compile(ast: Ast, opts?: CompileOptions): CompileResult;

export interface CompileOptions {
  builtins?: Record<string, BuiltinDef>;  // extension point; default = 14 shipped
}

export interface BuiltinDef {
  arity: number | [min: number, max: number];  // [1, 3] means 1..3 args
  impl: (args: unknown[]) => unknown;
}

export type CompileResult =
  | { ok: true; compiled: Compiled }
  | { ok: false; error: CompileError };

export interface Compiled {
  ast: Ast;                                    // retained for debugging / customizer
  run: (ctx: EvalContext) => unknown;          // the closure
}

export interface CompileError {
  kind: 'compile';
  code: 'unknown-fn' | 'arity' | 'not-yet-implemented';
  message: string;
  loc: Loc;
}
```

```ts
// evaluate
export function evaluate(compiled: Compiled, ctx: EvalContext): unknown;

export interface EvalContext {
  row: Record<string, unknown>;   // row data; nested paths resolved via FieldNode.path
  // Future (Cycle 21d): aggregates?, snapshot?, ...
}

// EvalError is a thrown exception, not a return type.
export class EvalError extends Error {
  code: 'type-error' | 'null-field' | 'div-by-zero' | 'runtime';
  loc: Loc;
}
```

```ts
// validate
export function validate(source: string, schema: Schema): ValidationResult;

export type FieldType = 'number' | 'string' | 'boolean' | 'date' | 'unknown';

export interface Schema {
  fields: Record<string, FieldType>;   // dotted-path key → declared type
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];           // empty if ok
}

export interface ValidationError {
  kind: 'validate';
  code: 'parse' | 'compile' | 'unknown-field' | 'type-mismatch';
  message: string;
  loc: Loc;
}
```

### 5.2 Data flow

```
                    ┌──────────────────┐
   source: string   │      parse       │  → Ast   (portable, structuredClone-safe)
                    └──────────────────┘
                            │
                            ▼
                    ┌──────────────────┐
        Ast         │     compile      │  → Compiled { ast, run }
                    └──────────────────┘
                            │
                            ▼
                    ┌──────────────────┐
   { row, ... }     │     evaluate     │  → unknown  (or throws EvalError)
                    └──────────────────┘

  For customizer editor UX:
                    ┌──────────────────┐
  source + schema   │     validate     │  → ValidationResult { ok, errors[] }
                    └──────────────────┘
```

---

## §6 Error model

Three error surfaces, three conventions:

- **Parse errors** — returned in `ParseResult.error`. Never thrown. Consumer decides: surface to editor UI, or short-circuit.
- **Compile errors** — returned in `CompileResult.error`. Never thrown. Same rationale.
- **Eval errors** — thrown as `EvalError` (extends `Error`, so caller can `try/catch` conventionally). Thrown, not returned, because eval sits inside per-cell paint loops where an allocated result union per cell is wasteful.

Every error carries `loc: Loc` — the char range in the original source string. Editor integrations (future customizer) can highlight the exact substring.

Aggregate / `prev` rejection uses `CompileError { code: 'not-yet-implemented' }` so downstream code can pattern-match on the code and give users a Cycle-21d-aware hint ("aggregates ship in a later cycle") rather than a generic parse error.

---

## §7 Testing strategy

### 7.1 Framework

Vitest, per package (already in the scaffold's `package.json`). No new tooling.

### 7.2 Test files

| File                                 | Coverage target             | Purpose                                                                                 |
| ------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------- |
| `parse.test.ts`                      | 90%+ lines                  | Grammar corpus: every operator + precedence + literal type + field-path variant + error |
| `compile.test.ts`                    | 90%+ lines                  | Built-in dispatch + arity checks + `not-yet-implemented` for aggregates/prev            |
| `evaluate.test.ts`                   | 90%+ lines                  | Semantics: truthiness, short-circuit, null-safe access, div-by-zero, string concat      |
| `validate.test.ts`                   | 85%+ lines                  | Schema-driven customizer scenarios (unknown field, type mismatch)                       |
| `errors.test.ts`                     | Position accuracy per error | Loc `start/end` is correct for every error emitted                                      |
| `postmessage-transferability.test.ts` | AST round-trip              | `structuredClone(ast)` deep-equals original for every node kind in the corpus            |

### 7.3 Golden AST corpus

`packages/expression/tests/fixtures/ast-corpus.json` — locked ASTs for ~30 canonical expressions covering every node kind + precedence pairing. Any change to the parser must update the corpus in the same commit. Reviewers can inspect the corpus diff to see how output changed.

### 7.4 Verification gates (Task 5)

- `pnpm --filter @wellsfargo-starui/velocity-grid-expression typecheck` — clean
- `pnpm --filter @wellsfargo-starui/velocity-grid-expression test` — 100% pass, ≥90% line coverage on parse/compile/evaluate, ≥85% on validate
- `pnpm --filter @wellsfargo-starui/velocity-grid-expression build` — succeeds (Task 1 may keep the scaffold's `echo` no-op if types-only export is sufficient; Task 5 upgrades to a real build only if a bundled dist is needed by consumers this cycle — nobody consumes 21b yet, so no-op is acceptable)
- Root-level `pnpm lint` — clean (repo-wide ESLint flat config applies to `packages/expression/**`; no per-package lint script needed)
- **Kernel tests unaffected:** `pnpm --filter @wellsfargo-starui/velocity-grid test` still `2326/2326`
- **E2E unaffected:** showcase + positions E2E baselines unchanged (since kernel is untouched)
- **Turbo graph clean:** `pnpm typecheck` at repo root cleanly walks `expression → kernel` (both leaves), no cycles.

---

## §8 Task decomposition

Single feature branch `cycle21b/expression`, one PR, 5 sequential tasks. Each task owned by one subagent under [superpowers:subagent-driven-development](../../../.superpowers/sdd/README.md). Each ends with one commit + a code review before proceeding.

### Task 1 — Grammar spec + AST types + skeleton files

- Author `packages/expression/src/types.ts` with the full discriminated union from §4 + all error / result types from §5.1.
- Author skeleton `parse.ts`, `compile.ts`, `evaluate.ts`, `validate.ts`, `builtins.ts` — signatures only, throwing `new Error('not-yet-implemented')` from bodies.
- Wire `index.ts` to re-export types (no runtime behavior yet).
- `typecheck` must pass; `test` must pass (vacuously — no tests yet).
- **Commit:** `feat(expression): cycle 21b task 1 — AST types + module skeletons`

### Task 2 — Parser + golden AST corpus

- Implement `parse.ts`: tokenizer + Pratt-precedence recursive descent → `Ast`.
- Implement position tracking (`Loc { start, end }` on every node).
- Author `tests/parse.test.ts` covering every grammar production + every syntax error path.
- Author `tests/fixtures/ast-corpus.json` — ~30 canonical expressions → their expected ASTs.
- Author `tests/postmessage-transferability.test.ts` — every corpus entry round-trips through `structuredClone`.
- **Commit:** `feat(expression): cycle 21b task 2 — parser + golden AST corpus`

### Task 3 — Compiler + evaluator + built-ins

- Implement `builtins.ts` with the 14 built-ins from §1.
- Implement `compile.ts`: recursive AST walk → closure chain; validates `CallNode.name` against three lists — built-ins (dispatch), aggregates + `PREV` (emit `CompileError { code: 'not-yet-implemented' }`), unknown (emit `CompileError { code: 'unknown-fn' }`); validates arity for built-ins.
- Implement `evaluate.ts`: thin wrapper around `Compiled.run` with a `try/catch` that converts unexpected runtime errors into `EvalError { code: 'runtime' }`.
- Author `tests/compile.test.ts` — dispatch, arity, aggregate/prev rejection.
- Author `tests/evaluate.test.ts` — semantics table: truthiness, short-circuit, null-safe access, div-by-zero, string concat, ternary.
- **Commit:** `feat(expression): cycle 21b task 3 — compiler + closure-based evaluator + 14 built-ins`

### Task 4 — Validator + error accuracy

- Implement `validate.ts`: `parse` → if parse fails, return with `code: 'parse'`; else `compile` → if compile fails, return with `code: 'compile'`; else type-check field paths against the `Schema`, checking `unknown-field` + `type-mismatch`.
- Author `tests/validate.test.ts` — customizer-flavored scenarios (unknown field, wrong-type comparison, etc.).
- Author `tests/errors.test.ts` — for every error kind, assert `loc.start` / `loc.end` are the exact char range.
- **Commit:** `feat(expression): cycle 21b task 4 — validator + positioned error accuracy`

### Task 5 — Public API polish + monorepo verify + PR

- Finalize `packages/expression/src/index.ts` — the exact exports from §5.
- Author `packages/expression/README.md` — quickstart, grammar cheat sheet, examples.
- Run full monorepo verify (§7.4).
- Push branch, open PR, land after review.
- **Commit:** `chore(expression): cycle 21b task 5 — public exports + README + verify`

---

## §9 Risks + mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AST shape churns when Cycle 21d adds real aggregate eval                                    | Reserve `AggregateNode` + `PrevNode` in the schema **now** for 21d's post-compile transformation. 21d adds compiler branches + node emission, not new node kinds.    |
| Grammar too permissive → downstream consumers hit surprises                                 | Golden AST corpus locks every parse decision. Reviewer inspects corpus diff to sign off on grammar semantics.                                                        |
| Closure-based compile blocked by strict CSP in end-user deployments                         | Compile uses recursive lambda composition (regular closures), **not** `new Function` or `eval`. No CSP relaxation needed.                                            |
| `+` operator string/numeric overload confuses users                                         | Documented explicitly in README + tested; emit `EvalError { code: 'type-error' }` when operand types mix in unexpected ways (e.g. `[num] + null`).                    |
| Null-safe field access diverges from downstream expectations                                | Documented explicitly + tested; consumers can wrap with `COALESCE([a.b.c], defaultValue)` if strict access needed.                                                    |
| Adding validator scope creep — customizer isn't landed yet                                  | Validator stays minimal in 21b: parse-error, compile-error, unknown-field, type-mismatch. No autocomplete, no LSP, no source maps. Customizer cycle owns UX polish.  |
| Reviewer / subagent misreads grammar precedence table                                       | Test corpus includes precedence pairings (`a + b * c`, `!a && b`, etc.) with expected ASTs — parser can't ship wrong precedence and pass tests.                       |
| Task 3 too large (compiler + evaluator + 14 built-ins in one commit)                        | Task 3 is the biggest but each sub-piece is independently testable; if it grows past ~600 LOC or reviewer flags, split into 3a (compile + evaluate) and 3b (built-ins). |

---

## §10 Success criteria

- `packages/expression/src/` has all files from §2.2 with real (non-throwing) implementations.
- All 6 test files exist with the coverage from §7.2 met.
- `pnpm --filter @wellsfargo-starui/velocity-grid-expression test` — 100% pass, no `.only` / `.skip` leaks.
- Kernel tests + E2E suites unchanged from `main` baseline (`2326/2326` unit + `98/98` showcase + `262/262` positions).
- Public API from §5 is exported from `index.ts`; a downstream test consumer (added in a follow-up cycle) can `import { parse, compile, evaluate, validate } from '@wellsfargo-starui/velocity-grid-expression'` and get the exact shapes documented here.
- PR body links to this spec + to the Cycle 21 parent brief §3.2 + §4.2.
- `.superpowers/sdd/progress.md` ends with `Cycle 21b status: COMPLETE.`

---

## §11 Open questions (post-implementation, non-blocking)

1. **Comment syntax.** Do consumers want `--` line comments or `/* */` blocks? Deferred until a real consumer (customizer or docs sample) has authored non-trivial multi-line expressions.
2. **Custom function extension point.** `CompileOptions.builtins` allows in-code extension; do we also want a `.registerBuiltin(name, def)` global registry? Deferred — decide when the first non-generic consumer (renderers? calc?) needs it.
3. **Numeric type coercion policy.** Strict (`"1" + 1` → type-error) vs coercive (`"1" + 1 → "11"`, JS-like). Current design: **strict** on comparison, **JS-like** on `+`. Revisit if a downstream cycle finds this surprising.
4. **`prev()` arity in the future.** Spec §7 shows `prev()` with no args (implicit "same field"); we've drafted it as `PREV([field])` with explicit field. Confirm shape when Cycle 21d wires it.
5. **AST versioning.** If downstream storage (customizer save files) embeds ASTs, does the AST need a `version` tag for future migrations? Deferred until customizer has a save format.

None of these block Cycle 21b landing.
