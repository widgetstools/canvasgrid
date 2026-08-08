# Cycle 21b — `@wellsfargo-starui/velocity-grid-expression` (Greenfield DSL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@wellsfargo-starui/velocity-grid-expression` — a greenfield row-local DSL package with the full `parse` / `compile` / `evaluate` / `validate` public API from Cycle 21 spec §4.2, using the empty scaffold landed in Cycle 21a.

**Architecture:** New leaf package under `packages/expression/`. Text source → `parse()` → JSON `Ast` (`structuredClone`-safe) → `compile()` → `Compiled` (closure via recursive lambda composition, CSP-safe, no `new Function`) → `evaluate()` (runs closure against row). AST schema reserves `AggregateNode` + `PrevNode` for Cycle 21d's post-compile transformation; 21b's parser never emits them and its compiler rejects them by name (`SUM`, `AVG`, `PREV`, etc.) with `CompileError { code: 'not-yet-implemented' }`. Zero cgrid dependencies. Kernel is untouched. Vitest per package; ESLint flat config already covers `packages/*/src/**` + `packages/*/tests/**` — no config edits needed.

**Tech Stack:** TypeScript 5.9 strict (extends repo `tsconfig.base.json`), Vitest 2.1 (test + coverage-v8), turborepo (task pipeline unchanged from 21a), npm workspaces.

## Global Constraints

Copied verbatim from [Cycle 21b design spec](../specs/2026-07-01-cycle-21b-expression-design.md) and the parent Cycle 21 brief:

- **L4 (spec §1):** Split BEFORE absorbing features. `@wellsfargo-starui/velocity-grid-expression` populated in this cycle, but downstream consumers (kernel, format, rules, calc, renderers, edit, export, customizer) are NOT touched.
- **L7 (spec §7):** Worker-only evaluation is a *deployment policy* on downstream packages. The expression package's evaluator is thread-agnostic — no worker/main enforcement inside the package.
- **Zero cgrid dependencies** (spec §2.1): `packages/expression/package.json` `dependencies` stays `{}`. No `import` from `@wellsfargo-starui/velocity-grid` or any other `@cgrid/*` package anywhere in `src/**` or `tests/**`.
- **CSP-safe compile** (spec §5.1, risk table): no `new Function`, no `eval`, no string-code execution. Compile is recursive lambda composition only.
- **AST is `structuredClone`-safe** (spec §2.3): no functions, no classes, no `undefined`, no `Symbol` in any AST node. All nodes are plain JSON discriminated union.
- **Every node carries `Loc { start: number; end: number }`** (spec §4): char offsets into original source; used for editor error underlines.
- **Kernel + E2E baselines unchanged** (spec §10): `packages/kernel` tests still `2326/2326`; showcase E2E still `98/98`; positions E2E still `262/262` (see `.superpowers/sdd/progress.md` for the Cycle 21a final baseline).
- **rowId / colId vocabulary** (repo ESLint `no-restricted-syntax` rule): if any identifier work happens (unlikely in this cycle), never use `columnId`, `rowKey`, `columnKey`. Row identity is `rowId`; column identity is `colId`.
- **One PR** for all 5 tasks. Feature branch `cycle21b/expression`. Mirrors Cycle 21a landing cadence.

## Preconditions (verified 2026-07-01)

- Cycle 21a merged (PR #92; commit `4f3829d` on `origin/main`).
- Local `main` synced to `origin/main` (this session verified `HEAD is now at 4f3829d`).
- `packages/expression/` scaffold present with `package.json`, `tsconfig.json`, `README.md`, `src/index.ts` (`export {}`), `tests/.gitkeep`.
- Design spec committed at `docs/superpowers/specs/2026-07-01-cycle-21b-expression-design.md` (commit `742e86a` on `main` this session).
- No open PRs.
- Working tree clean modulo this plan doc.

## File Structure Overview

**Files created (all under `packages/expression/`):**

- `src/types.ts` — public discriminated union (`Ast`, `AstNode`, all node interfaces), `Loc`, error types (`ParseError`, `CompileError`, `EvalError`, `ValidationError`), result types (`ParseResult`, `CompileResult`, `ValidationResult`), `Compiled`, `EvalContext`, `Schema`, `FieldType`, `BuiltinDef`, `CompileOptions`. Zero runtime.
- `src/parse.ts` — tokenizer + Pratt-precedence recursive descent → `Ast`.
- `src/compile.ts` — `Ast` → `Compiled` via recursive closure composition; validates built-in dispatch + arity + aggregate/prev rejection.
- `src/evaluate.ts` — thin `Compiled.run` wrapper with error boundary that converts unexpected exceptions to `EvalError { code: 'runtime' }`.
- `src/validate.ts` — `parse` → `compile` → schema type-check; returns `ValidationResult`.
- `src/builtins.ts` — the 14 built-in function definitions.
- `src/index.ts` — public re-exports (spec §5 exact).
- `tests/parse.test.ts` — per-production grammar tests + syntax-error tests.
- `tests/compile.test.ts` — dispatch, arity, aggregate/prev rejection.
- `tests/evaluate.test.ts` — semantics table (truthiness, short-circuit, null-safe field, div-by-zero, string concat).
- `tests/validate.test.ts` — schema-driven scenarios.
- `tests/errors.test.ts` — positional accuracy of every error kind.
- `tests/postmessage-transferability.test.ts` — corpus round-trips through `structuredClone`.
- `tests/fixtures/ast-corpus.json` — ~30 canonical expressions → expected ASTs.
- `vitest.config.ts` — Vitest config (Node env, coverage-v8 provider, include patterns).
- `README.md` — quickstart, grammar cheat sheet, error surfaces, examples.

**Files modified:**

- `packages/expression/package.json` — add `"test:coverage"` script + `@vitest/coverage-v8` devDep.
- `packages/expression/tsconfig.json` — widen `rootDir` to `.` so `tests/**/*` typechecks; add `resolveJsonModule` + `esModuleInterop` for the corpus import.

**Files NOT modified (verify at end of Task 5):**

- `packages/kernel/**` — untouched.
- Root `package.json`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs` — untouched.
- Any other `packages/*` — untouched.
- Any `apps/**` — untouched.

---

## Task 1: Preparation — feature branch, coverage tooling, AST types, module skeletons

**Files:**
- Create: `packages/expression/vitest.config.ts`
- Create: `packages/expression/src/types.ts`
- Overwrite: `packages/expression/src/index.ts` (currently `export {}`)
- Create: `packages/expression/src/parse.ts`
- Create: `packages/expression/src/compile.ts`
- Create: `packages/expression/src/evaluate.ts`
- Create: `packages/expression/src/validate.ts`
- Create: `packages/expression/src/builtins.ts`
- Modify: `packages/expression/package.json` (add coverage devDep + `test:coverage` script)
- Modify: `packages/expression/tsconfig.json` (widen rootDir + `resolveJsonModule` + `esModuleInterop`)

**Interfaces:**
- Produces (for Tasks 2–5):
    - `Loc = { start: number; end: number }`
    - `BinaryOp` string union: `'*' | '/' | '%' | '+' | '-' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||'`
    - `UnaryOp` string union: `'!' | '-'`
    - `AstNode` discriminated union with 8 kinds: `literal`, `field`, `unary`, `binary`, `ternary`, `call`, `aggregate` (reserved), `prev` (reserved). `Ast = AstNode`.
    - Signatures: `parse(source: string): ParseResult`, `compile(ast: Ast, opts?: CompileOptions): CompileResult`, `evaluate(compiled: Compiled, ctx: EvalContext): unknown`, `validate(source: string, schema: Schema): ValidationResult`.
    - `BuiltinDef = { arity: number | [number, number]; impl: (args: unknown[]) => unknown }`.
    - `CompileOptions = { builtins?: Record<string, BuiltinDef> }`.
    - `Compiled = { ast: Ast; run: (ctx: EvalContext) => unknown }`.
    - `EvalContext = { row: Record<string, unknown> }`.
    - Error classes/types: `EvalError extends Error` (class, with `code` + `loc` fields); `ParseError`, `CompileError`, `ValidationError` (plain interfaces).

- [ ] **Step 1: Sync main and create feature branch**

Run:
```bash
git fetch origin && git checkout main && git pull --ff-only && git checkout -b cycle21b/expression
```
Expected: local `main` at `origin/main`; new branch `cycle21b/expression` checked out.

- [ ] **Step 2: Confirm scaffold baseline**

Run:
```bash
ls packages/expression/src packages/expression/tests
cat packages/expression/src/index.ts
```
Expected: `src/` contains only `index.ts` with body `export {};`; `tests/` contains only `.gitkeep`.

- [ ] **Step 3: Install coverage-v8 as devDep in the expression package**

Run from repo root:
```bash
npm install --save-dev --workspace=@wellsfargo-starui/velocity-grid-expression @vitest/coverage-v8@^2.1.0
```
Expected: `packages/expression/package.json` now has `"@vitest/coverage-v8": "^2.1.0"` under `devDependencies`; root `package-lock.json` updated.

- [ ] **Step 4: Add `test:coverage` script to expression package.json**

Edit `packages/expression/package.json` — replace the `scripts` block:

```json
  "scripts": {
    "build": "echo '@wellsfargo-starui/velocity-grid-expression is a scaffold — no build yet' && exit 0",
    "test": "vitest run --passWithNoTests",
    "test:coverage": "vitest run --coverage --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 5: Test-infrastructure config — `vitest.config.ts` + tsconfig update**

Write `packages/expression/vitest.config.ts`:

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

Rationale: `environment: 'node'` (no DOM needed; the package is thread-agnostic and doesn't touch browser APIs). `include` mirrors kernel's convention. Coverage excludes `index.ts` because it's a pure re-export barrel with no branchable logic.

Then update `packages/expression/tsconfig.json` — Tasks 2 + 4 import a JSON corpus (`tests/fixtures/ast-corpus.json`); the scaffold tsconfig includes `tests/**/*` under typecheck, so we need `resolveJsonModule` and `esModuleInterop` on for `tsc --noEmit` to see the JSON module's type. Full replacement:

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

Two deltas vs the 21a scaffold: `rootDir` widens from `src` → `.` so `tests/**/*` under `include` isn't rejected by tsc's rootDir rule; `resolveJsonModule` + `esModuleInterop` added for the corpus import. `noEmit` is unchanged (no dist output).

- [ ] **Step 6: Write `src/types.ts` — the full public type surface**

Write `packages/expression/src/types.ts`:

```ts
// @wellsfargo-starui/velocity-grid-expression — public type surface.
//
// All types are plain TypeScript: discriminated unions for the AST,
// plain interfaces for results/errors. Nothing here is runtime; this
// file compiles to no JS output. See tests/postmessage-transferability
// for the AST's structuredClone contract.

// ─── Position ─────────────────────────────────────────────────────────

export interface Loc {
  /** Inclusive char offset into original source. */
  start: number;
  /** Exclusive char offset into original source. */
  end: number;
}

// ─── AST ──────────────────────────────────────────────────────────────

export type BinaryOp =
  | '*' | '/' | '%' | '+' | '-'
  | '<' | '<=' | '>' | '>='
  | '==' | '!='
  | '&&' | '||';

export type UnaryOp = '!' | '-';

export interface LiteralNode {
  kind: 'literal';
  value: string | number | boolean | null;
  loc: Loc;
}

export interface FieldNode {
  kind: 'field';
  /** Dotted segments; e.g. ['trade', 'price'] for `[trade.price]`. */
  path: string[];
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
  /** Function name as written; case-preserving. */
  name: string;
  args: AstNode[];
  loc: Loc;
}

/**
 * Reserved for Cycle 21d's post-compile AST transformation.
 * Cycle 21b's parser never emits AggregateNode; its compiler never accepts it.
 */
export interface AggregateNode {
  kind: 'aggregate';
  name: string;
  args: AstNode[];
  loc: Loc;
}

/** Reserved for Cycle 21d. Same status as AggregateNode. */
export interface PrevNode {
  kind: 'prev';
  arg: AstNode;
  loc: Loc;
}

export type AstNode =
  | LiteralNode
  | FieldNode
  | UnaryNode
  | BinaryNode
  | TernaryNode
  | CallNode
  | AggregateNode
  | PrevNode;

export type Ast = AstNode;

// ─── Parse ────────────────────────────────────────────────────────────

export interface ParseError {
  kind: 'parse';
  message: string;
  loc: Loc;
  hint?: string;
}

export type ParseResult =
  | { ok: true; ast: Ast }
  | { ok: false; error: ParseError };

// ─── Compile ──────────────────────────────────────────────────────────

export interface BuiltinDef {
  /** Exact arity, or [min, max] inclusive range. */
  arity: number | [min: number, max: number];
  impl: (args: unknown[]) => unknown;
}

export interface CompileOptions {
  builtins?: Record<string, BuiltinDef>;
}

export interface CompileError {
  kind: 'compile';
  code: 'unknown-fn' | 'arity' | 'not-yet-implemented';
  message: string;
  loc: Loc;
}

export interface Compiled {
  ast: Ast;
  run: (ctx: EvalContext) => unknown;
}

export type CompileResult =
  | { ok: true; compiled: Compiled }
  | { ok: false; error: CompileError };

// ─── Evaluate ─────────────────────────────────────────────────────────

export interface EvalContext {
  row: Record<string, unknown>;
}

export class EvalError extends Error {
  code: 'type-error' | 'null-field' | 'div-by-zero' | 'runtime';
  loc: Loc;

  constructor(
    code: 'type-error' | 'null-field' | 'div-by-zero' | 'runtime',
    message: string,
    loc: Loc,
  ) {
    super(message);
    this.name = 'EvalError';
    this.code = code;
    this.loc = loc;
  }
}

// ─── Validate ─────────────────────────────────────────────────────────

export type FieldType = 'number' | 'string' | 'boolean' | 'date' | 'unknown';

export interface Schema {
  fields: Record<string, FieldType>;
}

export interface ValidationError {
  kind: 'validate';
  code: 'parse' | 'compile' | 'unknown-field' | 'type-mismatch';
  message: string;
  loc: Loc;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}
```

- [ ] **Step 7: Write skeleton `src/parse.ts`**

Write `packages/expression/src/parse.ts`:

```ts
import type { ParseResult } from './types';

/**
 * Parse an expression source string into a portable AST.
 *
 * Cycle 21b — Task 2 implements this. Task 1 ships only the signature.
 */
export function parse(_source: string): ParseResult {
  throw new Error('parse: not implemented — landed in Cycle 21b Task 2');
}
```

- [ ] **Step 8: Write skeleton `src/compile.ts`**

Write `packages/expression/src/compile.ts`:

```ts
import type { Ast, CompileOptions, CompileResult } from './types';

/**
 * Compile a parsed AST into a callable Compiled closure.
 *
 * Cycle 21b — Task 3 implements this. Task 1 ships only the signature.
 */
export function compile(_ast: Ast, _opts?: CompileOptions): CompileResult {
  throw new Error('compile: not implemented — landed in Cycle 21b Task 3');
}
```

- [ ] **Step 9: Write skeleton `src/evaluate.ts`**

Write `packages/expression/src/evaluate.ts`:

```ts
import type { Compiled, EvalContext } from './types';

/**
 * Execute a Compiled expression against a row context.
 *
 * Cycle 21b — Task 3 implements this. Task 1 ships only the signature.
 */
export function evaluate(_compiled: Compiled, _ctx: EvalContext): unknown {
  throw new Error('evaluate: not implemented — landed in Cycle 21b Task 3');
}
```

- [ ] **Step 10: Write skeleton `src/validate.ts`**

Write `packages/expression/src/validate.ts`:

```ts
import type { Schema, ValidationResult } from './types';

/**
 * Validate a source expression against a Schema — parse + compile + type check.
 *
 * Cycle 21b — Task 4 implements this. Task 1 ships only the signature.
 */
export function validate(_source: string, _schema: Schema): ValidationResult {
  throw new Error('validate: not implemented — landed in Cycle 21b Task 4');
}
```

- [ ] **Step 11: Write skeleton `src/builtins.ts`**

Write `packages/expression/src/builtins.ts`:

```ts
import type { BuiltinDef } from './types';

/**
 * The 14 built-in functions shipped in Cycle 21b.
 * Cycle 21b — Task 3 populates this table. Task 1 exports the shape only.
 */
export const BUILTINS: Record<string, BuiltinDef> = {};
```

- [ ] **Step 12: Overwrite `src/index.ts` with the public re-exports**

Write `packages/expression/src/index.ts`:

```ts
// @wellsfargo-starui/velocity-grid-expression — public entrypoint.
// See docs/superpowers/specs/2026-07-01-cycle-21b-expression-design.md §5.

export { parse } from './parse';
export { compile } from './compile';
export { evaluate } from './evaluate';
export { validate } from './validate';

export type {
  Ast, AstNode, Loc, BinaryOp, UnaryOp,
  LiteralNode, FieldNode, UnaryNode, BinaryNode,
  TernaryNode, CallNode, AggregateNode, PrevNode,
  Compiled, CompileOptions, BuiltinDef,
  EvalContext,
  ParseError, ParseResult,
  CompileError, CompileResult,
  ValidationError, ValidationResult, Schema, FieldType,
} from './types';

export { EvalError } from './types';
```

- [ ] **Step 13: Verify typecheck passes**

Run from repo root:
```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-expression
```
Expected: no errors. `tsc --noEmit` completes cleanly.

Also run repo-wide to confirm no other package broke:
```bash
npx turbo run typecheck --filter=@wellsfargo-starui/velocity-grid-expression --filter=@wellsfargo-starui/velocity-grid
```
Expected: 2 successful tasks.

- [ ] **Step 14: Verify tests pass (vacuously — no tests authored yet)**

Run:
```bash
npm test --workspace=@wellsfargo-starui/velocity-grid-expression
```
Expected: `No test files found` warning; exit code 0 due to `--passWithNoTests`.

- [ ] **Step 15: Verify lint passes**

Run from repo root:
```bash
npm run lint
```
Expected: no errors. ESLint flat config already covers `packages/*/src/**/*.ts` — the new skeleton files fall under it.

- [ ] **Step 16: Commit**

Run from repo root:
```bash
git add packages/expression/
git status --short
```
Expected `git status` output — new/modified only under `packages/expression/`:
```
 M packages/expression/package.json
 M packages/expression/src/index.ts
 M packages/expression/tsconfig.json
?? packages/expression/src/builtins.ts
?? packages/expression/src/compile.ts
?? packages/expression/src/evaluate.ts
?? packages/expression/src/parse.ts
?? packages/expression/src/types.ts
?? packages/expression/src/validate.ts
?? packages/expression/vitest.config.ts
```
Plus `package-lock.json` from the coverage-v8 install (staged from repo root).

Run:
```bash
git add package-lock.json
git commit -m "$(cat <<'EOF'
feat(expression): cycle 21b task 1 — AST types + module skeletons

Types-only foundation for @wellsfargo-starui/velocity-grid-expression per Cycle 21b spec §4, §5.
Ships the full public discriminated union (Ast, AstNode + 8 node kinds
including reserved AggregateNode/PrevNode), Loc, ParseResult,
CompileResult, Compiled, EvalContext, EvalError, Schema,
ValidationResult, BuiltinDef, CompileOptions.

parse/compile/evaluate/validate implementations throw
"not implemented" — populated in Tasks 2/3/4. index.ts wires the
final public surface from §5.

vitest config + @vitest/coverage-v8 devDep added for the test suite
that Task 2 begins authoring. tsconfig widened (rootDir=".") and
`resolveJsonModule`/`esModuleInterop` enabled for the Task 2 JSON
corpus import.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit created; working tree clean.

---

## Task 2: Parser + golden AST corpus + parse tests

**Files:**
- Overwrite: `packages/expression/src/parse.ts` (replace skeleton throw with real implementation)
- Create: `packages/expression/tests/fixtures/ast-corpus.json`
- Create: `packages/expression/tests/parse.test.ts`
- Create: `packages/expression/tests/postmessage-transferability.test.ts`

**Interfaces:**
- Consumes (from Task 1): `Ast`, `AstNode`, `LiteralNode`, `FieldNode`, `UnaryNode`, `BinaryNode`, `TernaryNode`, `CallNode`, `Loc`, `BinaryOp`, `UnaryOp`, `ParseResult`, `ParseError`.
- Produces (for Tasks 3–4):
    - Working `parse(source: string): ParseResult`.
    - Grammar precedence, tight → loose: unary `!` / `-` > `*` / `/` / `%` > `+` / `-` > `<` / `<=` / `>` / `>=` > `==` / `!=` > `&&` > `||` > ternary `?:`.
    - Parser is **name-agnostic**: `NAME(args)` emits `CallNode` regardless of name (aggregate/prev/builtin split lives in compile.ts).
    - Field access syntax `[a.b.0.c]` produces `FieldNode { path: ['a', 'b', '0', 'c'], loc }`.
    - Unary minus wraps numeric literals: `-2.5` → `unary('-', literal(2.5))`.
    - `EvalError` unused by parse (parse never throws for eval-time issues).
    - Every AST node has correct `loc.start` / `loc.end` (char offsets into source, inclusive/exclusive respectively).

- [ ] **Step 1: Author `src/parse.ts` — tokenizer + Pratt parser**

Write `packages/expression/src/parse.ts` (full replacement):

```ts
import type {
  Ast, AstNode, BinaryOp, CallNode, FieldNode, LiteralNode,
  Loc, ParseError, ParseResult, TernaryNode, UnaryNode, UnaryOp, BinaryNode,
} from './types';

// ─── Tokens ───────────────────────────────────────────────────────────

type TokenKind =
  | 'number' | 'string' | 'bool' | 'null' | 'ident' | 'field'
  | 'lparen' | 'rparen' | 'comma' | 'question' | 'colon'
  | 'op'
  | 'eof';

interface Token {
  kind: TokenKind;
  /** Verbatim source slice; for 'field' this is the raw `[…]` including brackets. */
  text: string;
  /** For 'op', the exact operator (`&&`, `<=`, …); for 'field', the interior joined by '.'. */
  value?: string;
  start: number;
  end: number;
}

const OPS_MULTI = ['<=', '>=', '==', '!=', '&&', '||'] as const;
const OPS_SINGLE = ['*', '/', '%', '+', '-', '<', '>', '!'] as const;

function tokenize(src: string): { ok: true; tokens: Token[] } | { ok: false; error: ParseError } {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;

    // whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    const start = i;

    // field access [path.with.dots.0]
    if (c === '[') {
      let j = i + 1;
      while (j < n && src[j] !== ']') j++;
      if (j >= n) {
        return { ok: false, error: {
          kind: 'parse',
          message: 'Unterminated field reference: expected `]`',
          loc: { start, end: n },
        } };
      }
      const interior = src.slice(i + 1, j);
      if (interior.length === 0) {
        return { ok: false, error: {
          kind: 'parse',
          message: 'Empty field reference `[]`',
          loc: { start, end: j + 1 },
        } };
      }
      // basic validation — path segments are non-empty
      const segs = interior.split('.');
      if (segs.some((s) => s.length === 0)) {
        return { ok: false, error: {
          kind: 'parse',
          message: 'Empty path segment in field reference',
          loc: { start, end: j + 1 },
        } };
      }
      tokens.push({
        kind: 'field', text: src.slice(start, j + 1), value: interior,
        start, end: j + 1,
      });
      i = j + 1;
      continue;
    }

    // string literal
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) {
          const esc = src[j + 1]!;
          switch (esc) {
            case 'n': out += '\n'; break;
            case 't': out += '\t'; break;
            case 'r': out += '\r'; break;
            case '\\': out += '\\'; break;
            case '"': out += '"'; break;
            case "'": out += "'"; break;
            default: out += esc;
          }
          j += 2;
          continue;
        }
        out += src[j];
        j++;
      }
      if (j >= n) {
        return { ok: false, error: {
          kind: 'parse',
          message: `Unterminated string literal (missing ${quote})`,
          loc: { start, end: n },
        } };
      }
      tokens.push({
        kind: 'string', text: src.slice(start, j + 1), value: out,
        start, end: j + 1,
      });
      i = j + 1;
      continue;
    }

    // number literal — integer or decimal, optional scientific
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n && src[j]! >= '0' && src[j]! <= '9') j++;
      if (j < n && src[j] === '.') {
        j++;
        while (j < n && src[j]! >= '0' && src[j]! <= '9') j++;
      }
      if (j < n && (src[j] === 'e' || src[j] === 'E')) {
        j++;
        if (j < n && (src[j] === '+' || src[j] === '-')) j++;
        const expStart = j;
        while (j < n && src[j]! >= '0' && src[j]! <= '9') j++;
        if (j === expStart) {
          return { ok: false, error: {
            kind: 'parse',
            message: 'Invalid number: missing exponent digits',
            loc: { start, end: j },
          } };
        }
      }
      tokens.push({
        kind: 'number', text: src.slice(start, j), value: src.slice(start, j),
        start, end: j,
      });
      i = j;
      continue;
    }

    // identifier: keyword (true/false/null) or function name
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      let j = i;
      while (
        j < n && (
          (src[j]! >= 'A' && src[j]! <= 'Z') ||
          (src[j]! >= 'a' && src[j]! <= 'z') ||
          (src[j]! >= '0' && src[j]! <= '9') ||
          src[j] === '_'
        )
      ) j++;
      const word = src.slice(start, j);
      if (word === 'true' || word === 'false') {
        tokens.push({ kind: 'bool', text: word, value: word, start, end: j });
      } else if (word === 'null') {
        tokens.push({ kind: 'null', text: word, value: word, start, end: j });
      } else {
        tokens.push({ kind: 'ident', text: word, value: word, start, end: j });
      }
      i = j;
      continue;
    }

    // structural single chars
    if (c === '(') { tokens.push({ kind: 'lparen', text: '(', start, end: i + 1 }); i++; continue; }
    if (c === ')') { tokens.push({ kind: 'rparen', text: ')', start, end: i + 1 }); i++; continue; }
    if (c === ',') { tokens.push({ kind: 'comma', text: ',', start, end: i + 1 }); i++; continue; }
    if (c === '?') { tokens.push({ kind: 'question', text: '?', start, end: i + 1 }); i++; continue; }
    if (c === ':') { tokens.push({ kind: 'colon', text: ':', start, end: i + 1 }); i++; continue; }

    // multi-char operators first
    let matched = false;
    for (const op of OPS_MULTI) {
      if (src.slice(i, i + op.length) === op) {
        tokens.push({ kind: 'op', text: op, value: op, start, end: i + op.length });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // single-char operators
    for (const op of OPS_SINGLE) {
      if (c === op) {
        tokens.push({ kind: 'op', text: op, value: op, start, end: i + 1 });
        i++;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    return { ok: false, error: {
      kind: 'parse',
      message: `Unexpected character '${c}'`,
      loc: { start, end: i + 1 },
    } };
  }

  tokens.push({ kind: 'eof', text: '', start: n, end: n });
  return { ok: true, tokens };
}

// ─── Pratt parser ────────────────────────────────────────────────────

interface Cursor {
  toks: Token[];
  i: number;
}

function peek(c: Cursor): Token { return c.toks[c.i]!; }
function eat(c: Cursor): Token { return c.toks[c.i++]!; }

/** Binary operator precedence — higher binds tighter. */
const BIN_PREC: Record<BinaryOp, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

const BINARY_OPS: ReadonlySet<string> = new Set(Object.keys(BIN_PREC));

function parseExpr(c: Cursor, minPrec: number): AstNode | ParseError {
  let left = parseUnary(c);
  if (isParseError(left)) return left;

  while (true) {
    const tok = peek(c);

    // ternary
    if (tok.kind === 'question' && minPrec <= 0) {
      eat(c);
      const consequent = parseExpr(c, 0);
      if (isParseError(consequent)) return consequent;
      const colon = peek(c);
      if (colon.kind !== 'colon') {
        return { kind: 'parse', message: "Expected ':' in ternary", loc: locFrom(colon) };
      }
      eat(c);
      const alternate = parseExpr(c, 0);
      if (isParseError(alternate)) return alternate;
      const node: TernaryNode = {
        kind: 'ternary', test: left, consequent, alternate,
        loc: { start: (left as AstNode).loc.start, end: alternate.loc.end },
      };
      left = node;
      continue;
    }

    if (tok.kind !== 'op') break;
    const op = tok.value as BinaryOp;
    if (!BINARY_OPS.has(op)) break;
    const prec = BIN_PREC[op];
    if (prec < minPrec) break;

    eat(c);
    const right = parseExpr(c, prec + 1);
    if (isParseError(right)) return right;

    const node: BinaryNode = {
      kind: 'binary', op, left, right,
      loc: { start: (left as AstNode).loc.start, end: right.loc.end },
    };
    left = node;
  }

  return left;
}

function parseUnary(c: Cursor): AstNode | ParseError {
  const tok = peek(c);
  if (tok.kind === 'op' && (tok.value === '!' || tok.value === '-')) {
    const op = tok.value as UnaryOp;
    const start = tok.start;
    eat(c);
    const arg = parseUnary(c);
    if (isParseError(arg)) return arg;
    const node: UnaryNode = {
      kind: 'unary', op, arg,
      loc: { start, end: arg.loc.end },
    };
    return node;
  }
  return parsePrimary(c);
}

function parsePrimary(c: Cursor): AstNode | ParseError {
  const tok = peek(c);

  if (tok.kind === 'number') {
    eat(c);
    const num = Number(tok.value);
    const node: LiteralNode = {
      kind: 'literal', value: num,
      loc: { start: tok.start, end: tok.end },
    };
    return node;
  }

  if (tok.kind === 'string') {
    eat(c);
    const node: LiteralNode = {
      kind: 'literal', value: tok.value!,
      loc: { start: tok.start, end: tok.end },
    };
    return node;
  }

  if (tok.kind === 'bool') {
    eat(c);
    const node: LiteralNode = {
      kind: 'literal', value: tok.value === 'true',
      loc: { start: tok.start, end: tok.end },
    };
    return node;
  }

  if (tok.kind === 'null') {
    eat(c);
    const node: LiteralNode = {
      kind: 'literal', value: null,
      loc: { start: tok.start, end: tok.end },
    };
    return node;
  }

  if (tok.kind === 'field') {
    eat(c);
    const path = tok.value!.split('.');
    const node: FieldNode = {
      kind: 'field', path,
      loc: { start: tok.start, end: tok.end },
    };
    return node;
  }

  if (tok.kind === 'lparen') {
    eat(c);
    const inner = parseExpr(c, 0);
    if (isParseError(inner)) return inner;
    const rp = peek(c);
    if (rp.kind !== 'rparen') {
      return { kind: 'parse', message: "Expected ')'", loc: locFrom(rp) };
    }
    eat(c);
    return inner;
  }

  if (tok.kind === 'ident') {
    const name = tok.value!;
    const start = tok.start;
    eat(c);
    const lp = peek(c);
    if (lp.kind !== 'lparen') {
      return { kind: 'parse',
        message: `Bare identifier '${name}' — did you mean '[${name}]' for field access, or '${name}(...)' for a function call?`,
        loc: { start: tok.start, end: tok.end } };
    }
    eat(c);
    const args: AstNode[] = [];
    if (peek(c).kind !== 'rparen') {
      while (true) {
        const arg = parseExpr(c, 0);
        if (isParseError(arg)) return arg;
        args.push(arg);
        const next = peek(c);
        if (next.kind === 'comma') { eat(c); continue; }
        if (next.kind === 'rparen') break;
        return { kind: 'parse', message: "Expected ',' or ')' in argument list", loc: locFrom(next) };
      }
    }
    const rp = eat(c); // rparen
    const node: CallNode = {
      kind: 'call', name, args,
      loc: { start, end: rp.end },
    };
    return node;
  }

  return { kind: 'parse', message: `Unexpected token '${tok.text}'`, loc: locFrom(tok) };
}

function locFrom(tok: Token): Loc { return { start: tok.start, end: tok.end }; }

function isParseError(x: AstNode | ParseError): x is ParseError {
  return (x as ParseError).kind === 'parse';
}

// ─── Public entry ─────────────────────────────────────────────────────

export function parse(source: string): ParseResult {
  const lex = tokenize(source);
  if (!lex.ok) return { ok: false, error: lex.error };

  const c: Cursor = { toks: lex.tokens, i: 0 };
  const ast = parseExpr(c, 0);
  if (isParseError(ast)) return { ok: false, error: ast };

  const last = peek(c);
  if (last.kind !== 'eof') {
    return { ok: false, error: {
      kind: 'parse',
      message: `Unexpected trailing token '${last.text}'`,
      loc: locFrom(last),
    } };
  }
  return { ok: true, ast: ast as Ast };
}
```

- [ ] **Step 2: Author the golden AST corpus**

Write `packages/expression/tests/fixtures/ast-corpus.json`:

```json
[
  {
    "src": "42",
    "ast": { "kind": "literal", "value": 42, "loc": { "start": 0, "end": 2 } }
  },
  {
    "src": "3.14",
    "ast": { "kind": "literal", "value": 3.14, "loc": { "start": 0, "end": 4 } }
  },
  {
    "src": "1e6",
    "ast": { "kind": "literal", "value": 1000000, "loc": { "start": 0, "end": 3 } }
  },
  {
    "src": "\"hello\"",
    "ast": { "kind": "literal", "value": "hello", "loc": { "start": 0, "end": 7 } }
  },
  {
    "src": "true",
    "ast": { "kind": "literal", "value": true, "loc": { "start": 0, "end": 4 } }
  },
  {
    "src": "null",
    "ast": { "kind": "literal", "value": null, "loc": { "start": 0, "end": 4 } }
  },
  {
    "src": "[price]",
    "ast": { "kind": "field", "path": ["price"], "loc": { "start": 0, "end": 7 } }
  },
  {
    "src": "[trade.price]",
    "ast": { "kind": "field", "path": ["trade", "price"], "loc": { "start": 0, "end": 13 } }
  },
  {
    "src": "[book.bids.0.px]",
    "ast": { "kind": "field", "path": ["book", "bids", "0", "px"], "loc": { "start": 0, "end": 16 } }
  },
  {
    "src": "-5",
    "ast": {
      "kind": "unary", "op": "-",
      "arg": { "kind": "literal", "value": 5, "loc": { "start": 1, "end": 2 } },
      "loc": { "start": 0, "end": 2 }
    }
  },
  {
    "src": "!true",
    "ast": {
      "kind": "unary", "op": "!",
      "arg": { "kind": "literal", "value": true, "loc": { "start": 1, "end": 5 } },
      "loc": { "start": 0, "end": 5 }
    }
  },
  {
    "src": "1 + 2",
    "ast": {
      "kind": "binary", "op": "+",
      "left": { "kind": "literal", "value": 1, "loc": { "start": 0, "end": 1 } },
      "right": { "kind": "literal", "value": 2, "loc": { "start": 4, "end": 5 } },
      "loc": { "start": 0, "end": 5 }
    }
  },
  {
    "src": "1 + 2 * 3",
    "ast": {
      "kind": "binary", "op": "+",
      "left": { "kind": "literal", "value": 1, "loc": { "start": 0, "end": 1 } },
      "right": {
        "kind": "binary", "op": "*",
        "left": { "kind": "literal", "value": 2, "loc": { "start": 4, "end": 5 } },
        "right": { "kind": "literal", "value": 3, "loc": { "start": 8, "end": 9 } },
        "loc": { "start": 4, "end": 9 }
      },
      "loc": { "start": 0, "end": 9 }
    }
  },
  {
    "src": "(1 + 2) * 3",
    "ast": {
      "kind": "binary", "op": "*",
      "left": {
        "kind": "binary", "op": "+",
        "left": { "kind": "literal", "value": 1, "loc": { "start": 1, "end": 2 } },
        "right": { "kind": "literal", "value": 2, "loc": { "start": 5, "end": 6 } },
        "loc": { "start": 1, "end": 6 }
      },
      "right": { "kind": "literal", "value": 3, "loc": { "start": 10, "end": 11 } },
      "loc": { "start": 1, "end": 11 }
    }
  },
  {
    "src": "[a] < [b]",
    "ast": {
      "kind": "binary", "op": "<",
      "left": { "kind": "field", "path": ["a"], "loc": { "start": 0, "end": 3 } },
      "right": { "kind": "field", "path": ["b"], "loc": { "start": 6, "end": 9 } },
      "loc": { "start": 0, "end": 9 }
    }
  },
  {
    "src": "[a] == [b]",
    "ast": {
      "kind": "binary", "op": "==",
      "left": { "kind": "field", "path": ["a"], "loc": { "start": 0, "end": 3 } },
      "right": { "kind": "field", "path": ["b"], "loc": { "start": 7, "end": 10 } },
      "loc": { "start": 0, "end": 10 }
    }
  },
  {
    "src": "[a] && [b]",
    "ast": {
      "kind": "binary", "op": "&&",
      "left": { "kind": "field", "path": ["a"], "loc": { "start": 0, "end": 3 } },
      "right": { "kind": "field", "path": ["b"], "loc": { "start": 7, "end": 10 } },
      "loc": { "start": 0, "end": 10 }
    }
  },
  {
    "src": "[a] || [b] && [c]",
    "ast": {
      "kind": "binary", "op": "||",
      "left": { "kind": "field", "path": ["a"], "loc": { "start": 0, "end": 3 } },
      "right": {
        "kind": "binary", "op": "&&",
        "left": { "kind": "field", "path": ["b"], "loc": { "start": 7, "end": 10 } },
        "right": { "kind": "field", "path": ["c"], "loc": { "start": 14, "end": 17 } },
        "loc": { "start": 7, "end": 17 }
      },
      "loc": { "start": 0, "end": 17 }
    }
  },
  {
    "src": "[a] > 0 ? \"pos\" : \"neg\"",
    "ast": {
      "kind": "ternary",
      "test": {
        "kind": "binary", "op": ">",
        "left": { "kind": "field", "path": ["a"], "loc": { "start": 0, "end": 3 } },
        "right": { "kind": "literal", "value": 0, "loc": { "start": 6, "end": 7 } },
        "loc": { "start": 0, "end": 7 }
      },
      "consequent": { "kind": "literal", "value": "pos", "loc": { "start": 10, "end": 15 } },
      "alternate": { "kind": "literal", "value": "neg", "loc": { "start": 18, "end": 23 } },
      "loc": { "start": 0, "end": 23 }
    }
  },
  {
    "src": "IF([a] > 0, 1, -1)",
    "ast": {
      "kind": "call", "name": "IF",
      "args": [
        {
          "kind": "binary", "op": ">",
          "left": { "kind": "field", "path": ["a"], "loc": { "start": 3, "end": 6 } },
          "right": { "kind": "literal", "value": 0, "loc": { "start": 9, "end": 10 } },
          "loc": { "start": 3, "end": 10 }
        },
        { "kind": "literal", "value": 1, "loc": { "start": 12, "end": 13 } },
        {
          "kind": "unary", "op": "-",
          "arg": { "kind": "literal", "value": 1, "loc": { "start": 16, "end": 17 } },
          "loc": { "start": 15, "end": 17 }
        }
      ],
      "loc": { "start": 0, "end": 18 }
    }
  },
  {
    "src": "COALESCE([x], [y], 0)",
    "ast": {
      "kind": "call", "name": "COALESCE",
      "args": [
        { "kind": "field", "path": ["x"], "loc": { "start": 9, "end": 12 } },
        { "kind": "field", "path": ["y"], "loc": { "start": 14, "end": 17 } },
        { "kind": "literal", "value": 0, "loc": { "start": 19, "end": 20 } }
      ],
      "loc": { "start": 0, "end": 21 }
    }
  },
  {
    "src": "SUM([price])",
    "ast": {
      "kind": "call", "name": "SUM",
      "args": [
        { "kind": "field", "path": ["price"], "loc": { "start": 4, "end": 11 } }
      ],
      "loc": { "start": 0, "end": 12 }
    }
  },
  {
    "src": "PREV([price])",
    "ast": {
      "kind": "call", "name": "PREV",
      "args": [
        { "kind": "field", "path": ["price"], "loc": { "start": 5, "end": 12 } }
      ],
      "loc": { "start": 0, "end": 13 }
    }
  },
  {
    "src": "!([a] && [b])",
    "ast": {
      "kind": "unary", "op": "!",
      "arg": {
        "kind": "binary", "op": "&&",
        "left": { "kind": "field", "path": ["a"], "loc": { "start": 2, "end": 5 } },
        "right": { "kind": "field", "path": ["b"], "loc": { "start": 9, "end": 12 } },
        "loc": { "start": 2, "end": 12 }
      },
      "loc": { "start": 0, "end": 13 }
    }
  },
  {
    "src": "1 - 2 - 3",
    "ast": {
      "kind": "binary", "op": "-",
      "left": {
        "kind": "binary", "op": "-",
        "left": { "kind": "literal", "value": 1, "loc": { "start": 0, "end": 1 } },
        "right": { "kind": "literal", "value": 2, "loc": { "start": 4, "end": 5 } },
        "loc": { "start": 0, "end": 5 }
      },
      "right": { "kind": "literal", "value": 3, "loc": { "start": 8, "end": 9 } },
      "loc": { "start": 0, "end": 9 }
    }
  },
  {
    "src": "\"a\" + \"b\"",
    "ast": {
      "kind": "binary", "op": "+",
      "left": { "kind": "literal", "value": "a", "loc": { "start": 0, "end": 3 } },
      "right": { "kind": "literal", "value": "b", "loc": { "start": 6, "end": 9 } },
      "loc": { "start": 0, "end": 9 }
    }
  },
  {
    "src": "ROUND([x], 2)",
    "ast": {
      "kind": "call", "name": "ROUND",
      "args": [
        { "kind": "field", "path": ["x"], "loc": { "start": 6, "end": 9 } },
        { "kind": "literal", "value": 2, "loc": { "start": 11, "end": 12 } }
      ],
      "loc": { "start": 0, "end": 13 }
    }
  },
  {
    "src": "LEN(\"hello\")",
    "ast": {
      "kind": "call", "name": "LEN",
      "args": [
        { "kind": "literal", "value": "hello", "loc": { "start": 4, "end": 11 } }
      ],
      "loc": { "start": 0, "end": 12 }
    }
  },
  {
    "src": "1.5e-3 + 2",
    "ast": {
      "kind": "binary", "op": "+",
      "left": { "kind": "literal", "value": 0.0015, "loc": { "start": 0, "end": 6 } },
      "right": { "kind": "literal", "value": 2, "loc": { "start": 9, "end": 10 } },
      "loc": { "start": 0, "end": 10 }
    }
  }
]
```

That's 29 canonical expressions covering: number literals (int, decimal, scientific), string literals, booleans, null, field paths (single, dotted, indexed), unary ops, binary arithmetic + precedence, parentheses, comparison, equality, logical AND/OR with precedence, ternary, call, string concat, aggregate-syntax-as-call, prev-syntax-as-call, arity variations.

- [ ] **Step 3: Author `tests/parse.test.ts`**

Write `packages/expression/tests/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { Ast } from '../src/types';
import corpus from './fixtures/ast-corpus.json' with { type: 'json' };

interface CorpusEntry { src: string; ast: Ast }

describe('parse — golden AST corpus', () => {
  for (const entry of corpus as CorpusEntry[]) {
    it(`parses: ${entry.src}`, () => {
      const result = parse(entry.src);
      if (!result.ok) {
        throw new Error(`parse failed unexpectedly: ${result.error.message} @${result.error.loc.start}..${result.error.loc.end}`);
      }
      expect(result.ast).toEqual(entry.ast);
    });
  }
});

describe('parse — grammar coverage beyond corpus', () => {
  it('accepts left-associative multiplicative chain', () => {
    const r = parse('6 / 2 / 3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ((6/2)/3) not (6/(2/3))
    expect(r.ast.kind).toBe('binary');
    if (r.ast.kind !== 'binary') return;
    expect(r.ast.op).toBe('/');
    expect(r.ast.left.kind).toBe('binary');
  });

  it('accepts nested ternary (right-associative through recursion)', () => {
    const r = parse('[a] ? 1 : [b] ? 2 : 3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('ternary');
  });

  it('accepts zero-arg call', () => {
    const r = parse('NOW()');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('call');
    if (r.ast.kind !== 'call') return;
    expect(r.ast.args).toEqual([]);
  });

  it('accepts nested calls', () => {
    const r = parse('ROUND(ABS([x]), 2)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('call');
  });

  it('accepts string with escape sequences', () => {
    const r = parse('"a\\nb\\tc"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('literal');
    if (r.ast.kind !== 'literal') return;
    expect(r.ast.value).toBe('a\nb\tc');
  });

  it('accepts single-quoted strings', () => {
    const r = parse("'foo'");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('literal');
    if (r.ast.kind !== 'literal') return;
    expect(r.ast.value).toBe('foo');
  });

  it('accepts unary minus on parenthesised expr', () => {
    const r = parse('-(1 + 2)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('unary');
  });
});

describe('parse — syntax errors', () => {
  it('rejects unterminated string', () => {
    const r = parse('"foo');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Unterminated string/);
  });

  it('rejects unterminated field reference', () => {
    const r = parse('[foo');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Unterminated field/);
  });

  it('rejects empty field reference', () => {
    const r = parse('[]');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Empty field/);
  });

  it('rejects empty path segment', () => {
    const r = parse('[a..b]');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Empty path segment/);
  });

  it('rejects unmatched paren', () => {
    const r = parse('(1 + 2');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Expected '\)'/);
  });

  it('rejects ternary without colon', () => {
    const r = parse('[a] ? 1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Expected ':'/);
  });

  it('rejects bare identifier', () => {
    const r = parse('foo');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Bare identifier/);
  });

  it('rejects trailing garbage', () => {
    const r = parse('1 + 2 3');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/trailing token/);
  });

  it('rejects unexpected character', () => {
    const r = parse('@');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Unexpected character/);
  });

  it('rejects invalid number (missing exponent digits)', () => {
    const r = parse('1e');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/missing exponent/);
  });

  it('rejects invalid arg separator', () => {
    const r = parse('IF([a] 1)');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/','.*or.*'\)'/);
  });
});
```

- [ ] **Step 4: Author `tests/postmessage-transferability.test.ts`**

Write `packages/expression/tests/postmessage-transferability.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { Ast } from '../src/types';
import corpus from './fixtures/ast-corpus.json' with { type: 'json' };

interface CorpusEntry { src: string; ast: Ast }

describe('AST is structuredClone-safe (postMessage transport)', () => {
  for (const entry of corpus as CorpusEntry[]) {
    it(`round-trips: ${entry.src}`, () => {
      const result = parse(entry.src);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const cloned = structuredClone(result.ast);
      expect(cloned).toEqual(result.ast);
      // JSON-parity: no functions, no classes, no undefined
      const jsonRoundtrip = JSON.parse(JSON.stringify(result.ast));
      expect(jsonRoundtrip).toEqual(result.ast);
    });
  }
});
```

- [ ] **Step 5: Run parse + transferability tests**

Run:
```bash
npm test --workspace=@wellsfargo-starui/velocity-grid-expression
```
Expected: all tests pass. Roughly 29 (corpus) + ~19 (grammar + error) + 29 (transferability) ≈ 77 tests.

If any corpus assertion fails, the parser output diverged from the locked AST. Two remedies:
- Parser bug — fix `parse.ts` until the corpus matches.
- Corpus mismatch on a boundary token (e.g. `loc.end` off-by-one) — the corpus is truth; fix the parser to match.

Do NOT edit the corpus to make tests pass. The corpus locks grammar decisions; any change to it requires a design update.

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-expression && npm run lint
```
Expected: clean.

- [ ] **Step 7: Commit**

Run:
```bash
git add packages/expression/src/parse.ts packages/expression/tests/
git status --short
git commit -m "$(cat <<'EOF'
feat(expression): cycle 21b task 2 — parser + golden AST corpus

Recursive-descent tokenizer + Pratt precedence parser for the row-local
DSL. Grammar (tight → loose):
  unary !/-  >  * / %  >  + -  >  < <= > >=  >  == !=  >  &&  >  ||  >  ?:

Every AST node carries a Loc { start, end } for editor error underlines.
Parser is name-agnostic: NAME(args) always emits CallNode regardless of
whether the name is a built-in, aggregate, or PREV — compile.ts owns
the registry split.

Golden AST corpus (tests/fixtures/ast-corpus.json) — 29 canonical
expressions covering every node kind + precedence pairing. Any change
to parser output requires updating the corpus; reviewers can see the
grammar delta in one diff.

postmessage-transferability.test.ts verifies every corpus AST
structuredClone-round-trips + JSON-round-trips (contract for Cycle 21d's
main-to-worker transport).

Also 19 grammar-beyond-corpus tests + 11 syntax-error tests covering
every error path the tokenizer/parser can emit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Compiler + evaluator + built-ins + tests

**Files:**
- Overwrite: `packages/expression/src/builtins.ts` (populate the 14 built-ins)
- Overwrite: `packages/expression/src/compile.ts` (real closure-based compiler)
- Overwrite: `packages/expression/src/evaluate.ts` (thin error-boundary wrapper)
- Create: `packages/expression/tests/compile.test.ts`
- Create: `packages/expression/tests/evaluate.test.ts`

**Interfaces:**
- Consumes (from Tasks 1–2): all types, working `parse()`, `Ast`, `CallNode`, `Compiled`, `CompileResult`, `CompileError`, `EvalContext`, `EvalError`, `BuiltinDef`.
- Produces (for Tasks 4–5):
    - `compile(ast, opts?): CompileResult` — recursive AST walk → closure via lambda composition. Runtime-safe; no `new Function`, no `eval`.
    - `evaluate(compiled, ctx): unknown` — invokes `compiled.run(ctx)` inside `try/catch`; unexpected non-`EvalError` throws become `EvalError { code: 'runtime' }`.
    - `BUILTINS` registry with 14 entries. Each has `arity` (fixed or `[min, max]`) and `impl(args) => unknown`.
    - Compile behaviour on `CallNode`:
        - name in `BUILTINS` → dispatch, check arity → returns `Compiled`.
        - name in aggregate list (`SUM AVG COUNT MIN MAX RUNNING_SUM RUNNING_AVG MOVING_AVG FIRST LAST DELTA_FROM_PREV DELTA_FROM_FIRST DELTA_FROM_LAST`) → `CompileError { code: 'not-yet-implemented' }`.
        - name is `PREV` → `CompileError { code: 'not-yet-implemented' }`.
        - anything else → `CompileError { code: 'unknown-fn' }`.
    - Compile behaviour on `aggregate`/`prev` node kinds → `CompileError { code: 'not-yet-implemented' }` (defensive: 21b's parser never emits these; 21d will).

- [ ] **Step 1: Populate `src/builtins.ts` with the 14 built-ins**

Write `packages/expression/src/builtins.ts` (full replacement):

```ts
import type { BuiltinDef } from './types';

/**
 * 14 built-in functions shipped in Cycle 21b.
 * All are pure row-local — no aggregates, no stateful helpers.
 */
export const BUILTINS: Record<string, BuiltinDef> = {
  // ─── Control ─────────────────────────────────────────────────────
  IF: {
    arity: 3,
    impl: (args) => (isTruthy(args[0]) ? args[1] : args[2]),
  },
  COALESCE: {
    arity: [1, 32],
    impl: (args) => {
      for (const v of args) if (v !== null && v !== undefined) return v;
      return null;
    },
  },

  // ─── Logical ─────────────────────────────────────────────────────
  NOT: { arity: 1, impl: (args) => !isTruthy(args[0]) },
  AND: {
    arity: [1, 32],
    impl: (args) => args.every(isTruthy),
  },
  OR: {
    arity: [1, 32],
    impl: (args) => args.some(isTruthy),
  },

  // ─── Numeric ─────────────────────────────────────────────────────
  ABS: { arity: 1, impl: (args) => Math.abs(asNumber(args[0])) },
  ROUND: {
    arity: [1, 2],
    impl: (args) => {
      const n = asNumber(args[0]);
      const digits = args.length === 2 ? asNumber(args[1]) : 0;
      const p = Math.pow(10, digits);
      return Math.round(n * p) / p;
    },
  },
  MIN: {
    arity: [1, 32],
    impl: (args) => Math.min(...args.map(asNumber)),
  },
  MAX: {
    arity: [1, 32],
    impl: (args) => Math.max(...args.map(asNumber)),
  },
  FLOOR: { arity: 1, impl: (args) => Math.floor(asNumber(args[0])) },
  CEIL: { arity: 1, impl: (args) => Math.ceil(asNumber(args[0])) },

  // ─── String ──────────────────────────────────────────────────────
  LOWER: { arity: 1, impl: (args) => asString(args[0]).toLowerCase() },
  UPPER: { arity: 1, impl: (args) => asString(args[0]).toUpperCase() },
  LEN: { arity: 1, impl: (args) => asString(args[0]).length },
};

// ─── Coercion helpers (throw plain Error; compile.ts wraps into EvalError) ──

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  return Boolean(v);
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) throw new TypeError('expected number, got null');
  const n = Number(v);
  if (Number.isNaN(n)) throw new TypeError(`expected number, got ${typeof v}`);
  return n;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) throw new TypeError('expected string, got null');
  return String(v);
}

/**
 * The compile-time reserved list. Cycle 21b's compiler emits
 * `CompileError { code: 'not-yet-implemented' }` for any of these
 * plus `PREV`.
 */
export const AGGREGATE_NAMES: ReadonlySet<string> = new Set([
  'SUM', 'AVG', 'COUNT', 'MIN', 'MAX',
  'RUNNING_SUM', 'RUNNING_AVG', 'MOVING_AVG',
  'FIRST', 'LAST',
  'DELTA_FROM_PREV', 'DELTA_FROM_FIRST', 'DELTA_FROM_LAST',
]);
```

Note the naming collision: `MIN` and `MAX` appear in both `BUILTINS` (row-local variadic min/max of args) and `AGGREGATE_NAMES` (column-wide aggregate). In 21b the built-in wins — a call to `MIN(1, 2, 3)` compiles as the variadic built-in. Cycle 21d will disambiguate by arg shape (aggregate `MIN([field])` vs variadic `MIN(a, b, c)`).

- [ ] **Step 2: Write `src/compile.ts` — real recursive closure compiler**

Write `packages/expression/src/compile.ts` (full replacement):

```ts
import type {
  Ast, AstNode, BinaryNode, BinaryOp, CallNode, Compiled,
  CompileError, CompileOptions, CompileResult, EvalContext, FieldNode, Loc,
  TernaryNode, UnaryNode,
} from './types';
import { EvalError } from './types';
import { AGGREGATE_NAMES, BUILTINS } from './builtins';

type Runner = (ctx: EvalContext) => unknown;

export function compile(ast: Ast, opts?: CompileOptions): CompileResult {
  const builtins = { ...BUILTINS, ...(opts?.builtins ?? {}) };
  try {
    const run = compileNode(ast, builtins);
    return { ok: true, compiled: { ast, run } };
  } catch (e) {
    if (isCompileError(e)) return { ok: false, error: e };
    throw e;
  }
}

class CompileErrorThrowable extends Error implements CompileError {
  kind = 'compile' as const;
  code: CompileError['code'];
  loc: Loc;
  constructor(code: CompileError['code'], message: string, loc: Loc) {
    super(message);
    this.code = code;
    this.loc = loc;
  }
}

function isCompileError(e: unknown): e is CompileError {
  return typeof e === 'object' && e !== null && (e as { kind?: unknown }).kind === 'compile';
}

function throwCompile(code: CompileError['code'], message: string, loc: Loc): never {
  throw new CompileErrorThrowable(code, message, loc);
}

function compileNode(node: AstNode, builtins: Record<string, import('./types').BuiltinDef>): Runner {
  switch (node.kind) {
    case 'literal': {
      const v = node.value;
      return () => v;
    }
    case 'field': return compileField(node);
    case 'unary': return compileUnary(node, builtins);
    case 'binary': return compileBinary(node, builtins);
    case 'ternary': return compileTernary(node, builtins);
    case 'call': return compileCall(node, builtins);
    case 'aggregate':
    case 'prev':
      throwCompile(
        'not-yet-implemented',
        `${node.kind} nodes ship in Cycle 21d`,
        node.loc,
      );
  }
}

function compileField(node: FieldNode): Runner {
  const path = node.path;
  return (ctx) => {
    let cur: unknown = ctx.row;
    for (const seg of path) {
      if (cur === null || cur === undefined) return null;
      if (typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[seg];
    }
    return cur ?? null;
  };
}

function compileUnary(
  node: UnaryNode,
  builtins: Record<string, import('./types').BuiltinDef>,
): Runner {
  const inner = compileNode(node.arg, builtins);
  const loc = node.loc;
  if (node.op === '!') return (ctx) => !truthy(inner(ctx));
  // op === '-'
  return (ctx) => {
    const v = inner(ctx);
    if (typeof v !== 'number') {
      throw new EvalError('type-error', `unary '-' requires number, got ${describe(v)}`, loc);
    }
    return -v;
  };
}

function compileBinary(
  node: BinaryNode,
  builtins: Record<string, import('./types').BuiltinDef>,
): Runner {
  const l = compileNode(node.left, builtins);
  const r = compileNode(node.right, builtins);
  const op = node.op;
  const loc = node.loc;

  switch (op) {
    case '+': return (ctx) => {
      const lv = l(ctx); const rv = r(ctx);
      if (typeof lv === 'string' && typeof rv === 'string') return lv + rv;
      const ln = asNum(lv, loc); const rn = asNum(rv, loc);
      return ln + rn;
    };
    case '-': return (ctx) => asNum(l(ctx), loc) - asNum(r(ctx), loc);
    case '*': return (ctx) => asNum(l(ctx), loc) * asNum(r(ctx), loc);
    case '/': return (ctx) => {
      const ln = asNum(l(ctx), loc); const rn = asNum(r(ctx), loc);
      if (rn === 0) throw new EvalError('div-by-zero', 'division by zero', loc);
      return ln / rn;
    };
    case '%': return (ctx) => {
      const ln = asNum(l(ctx), loc); const rn = asNum(r(ctx), loc);
      if (rn === 0) throw new EvalError('div-by-zero', 'modulo by zero', loc);
      return ln % rn;
    };
    case '<': return (ctx) => cmp(l(ctx), r(ctx), loc) < 0;
    case '<=': return (ctx) => cmp(l(ctx), r(ctx), loc) <= 0;
    case '>': return (ctx) => cmp(l(ctx), r(ctx), loc) > 0;
    case '>=': return (ctx) => cmp(l(ctx), r(ctx), loc) >= 0;
    case '==': return (ctx) => eq(l(ctx), r(ctx));
    case '!=': return (ctx) => !eq(l(ctx), r(ctx));
    case '&&': return (ctx) => {
      const lv = l(ctx);
      if (!truthy(lv)) return lv;
      return r(ctx);
    };
    case '||': return (ctx) => {
      const lv = l(ctx);
      if (truthy(lv)) return lv;
      return r(ctx);
    };
  }
  // exhaustiveness — never reached
  throwCompile('unknown-fn', `unknown binary op ${String(op as BinaryOp)}`, loc);
}

function compileTernary(
  node: TernaryNode,
  builtins: Record<string, import('./types').BuiltinDef>,
): Runner {
  const test = compileNode(node.test, builtins);
  const cons = compileNode(node.consequent, builtins);
  const alt = compileNode(node.alternate, builtins);
  return (ctx) => (truthy(test(ctx)) ? cons(ctx) : alt(ctx));
}

function compileCall(
  node: CallNode,
  builtins: Record<string, import('./types').BuiltinDef>,
): Runner {
  const name = node.name;
  const loc = node.loc;

  const def = builtins[name];
  if (!def) {
    if (AGGREGATE_NAMES.has(name) || name === 'PREV') {
      throwCompile('not-yet-implemented',
        `${name} ships in Cycle 21d`, loc);
    }
    throwCompile('unknown-fn', `unknown function '${name}'`, loc);
  }

  const argCount = node.args.length;
  if (!checkArity(def.arity, argCount)) {
    throwCompile('arity',
      `${name} expects ${describeArity(def.arity)}, got ${argCount}`, loc);
  }

  const compiledArgs = node.args.map((a) => compileNode(a, builtins));
  const impl = def.impl;
  return (ctx) => {
    const values = compiledArgs.map((c) => c(ctx));
    try {
      return impl(values);
    } catch (e) {
      if (e instanceof EvalError) throw e;
      throw new EvalError('runtime',
        `${name}: ${(e as Error).message ?? 'runtime error'}`, loc);
    }
  };
}

function checkArity(arity: number | [number, number], n: number): boolean {
  if (typeof arity === 'number') return arity === n;
  return n >= arity[0] && n <= arity[1];
}

function describeArity(arity: number | [number, number]): string {
  if (typeof arity === 'number') return `${arity} arg${arity === 1 ? '' : 's'}`;
  return `${arity[0]}..${arity[1]} args`;
}

// ─── Runtime helpers ──────────────────────────────────────────────────

function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  return Boolean(v);
}

function asNum(v: unknown, loc: Loc): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) {
    throw new EvalError('null-field', 'expected number, got null', loc);
  }
  const n = Number(v);
  if (Number.isNaN(n)) throw new EvalError('type-error', `expected number, got ${describe(v)}`, loc);
  return n;
}

function cmp(l: unknown, r: unknown, loc: Loc): number {
  if (typeof l === 'number' && typeof r === 'number') return l - r;
  if (typeof l === 'string' && typeof r === 'string') return l < r ? -1 : l > r ? 1 : 0;
  throw new EvalError('type-error',
    `cannot compare ${describe(l)} and ${describe(r)}`, loc);
}

function eq(l: unknown, r: unknown): boolean {
  // strict — no coercion, but null == undefined
  if (l === null || l === undefined) return r === null || r === undefined;
  return l === r;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  return typeof v;
}
```

- [ ] **Step 3: Write `src/evaluate.ts` — thin error boundary**

Write `packages/expression/src/evaluate.ts` (full replacement):

```ts
import type { Compiled, EvalContext } from './types';
import { EvalError } from './types';

/**
 * Execute a Compiled expression against a row context.
 * Compiled.run may throw EvalError; unexpected non-EvalError throws
 * become EvalError { code: 'runtime' } anchored at the AST root loc.
 */
export function evaluate(compiled: Compiled, ctx: EvalContext): unknown {
  try {
    return compiled.run(ctx);
  } catch (e) {
    if (e instanceof EvalError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new EvalError('runtime', `unexpected runtime error: ${msg}`, compiled.ast.loc);
  }
}
```

- [ ] **Step 4: Author `tests/compile.test.ts`**

Write `packages/expression/tests/compile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile';
import { parse } from '../src/parse';
import type { Ast } from '../src/types';

function mustParse(src: string): Ast {
  const r = parse(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  return r.ast;
}

describe('compile — built-in dispatch', () => {
  it('compiles IF successfully', () => {
    const r = compile(mustParse('IF(true, 1, 2)'));
    expect(r.ok).toBe(true);
  });

  it('compiles nested built-ins', () => {
    const r = compile(mustParse('ROUND(ABS([x]), 2)'));
    expect(r.ok).toBe(true);
  });

  it('compiles all 14 built-ins', () => {
    const cases = [
      'IF(true, 1, 2)', 'COALESCE([a], [b], 0)',
      'NOT(true)', 'AND(true, false)', 'OR(true, false)',
      'ABS(-1)', 'ROUND(1.5)', 'ROUND(1.234, 2)',
      'MIN(1, 2, 3)', 'MAX(1, 2, 3)',
      'FLOOR(1.9)', 'CEIL(1.1)',
      'LOWER("A")', 'UPPER("a")', 'LEN("abc")',
    ];
    for (const src of cases) {
      const r = compile(mustParse(src));
      if (!r.ok) throw new Error(`compile failed for '${src}': ${r.error.message}`);
      expect(r.ok).toBe(true);
    }
  });
});

describe('compile — arity errors', () => {
  it('rejects IF with 2 args', () => {
    const r = compile(mustParse('IF(true, 1)'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
    expect(r.error.message).toMatch(/IF expects 3 args/);
  });

  it('rejects ABS with 0 args', () => {
    const r = compile(mustParse('ABS()'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
  });

  it('rejects ROUND with 3 args (max 2)', () => {
    const r = compile(mustParse('ROUND(1, 2, 3)'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
    expect(r.error.message).toMatch(/1..2 args/);
  });

  it('accepts variadic MIN with just 1 arg', () => {
    const r = compile(mustParse('MIN(1)'));
    expect(r.ok).toBe(true);
  });

  it('rejects variadic COALESCE with 0 args', () => {
    const r = compile(mustParse('COALESCE()'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
  });
});

describe('compile — unknown function', () => {
  it('rejects an unknown name', () => {
    const r = compile(mustParse('NOPE(1)'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unknown-fn');
    expect(r.error.message).toMatch(/unknown function 'NOPE'/);
  });
});

describe('compile — aggregate + PREV rejection (not-yet-implemented)', () => {
  const AGGS = [
    'SUM([x])', 'AVG([x])', 'COUNT([x])',
    'RUNNING_SUM([x])', 'RUNNING_AVG([x])', 'MOVING_AVG([x], 3)',
    'FIRST([x])', 'LAST([x])',
    'DELTA_FROM_PREV([x])', 'DELTA_FROM_FIRST([x])', 'DELTA_FROM_LAST([x])',
    'PREV([x])',
  ];
  for (const src of AGGS) {
    it(`rejects '${src}' with not-yet-implemented`, () => {
      const r = compile(mustParse(src));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('not-yet-implemented');
      expect(r.error.message).toMatch(/Cycle 21d/);
    });
  }

  it('MIN/MAX with args stay as built-in (do not trigger aggregate rejection)', () => {
    expect(compile(mustParse('MIN(1, 2, 3)')).ok).toBe(true);
    expect(compile(mustParse('MAX(1, 2)')).ok).toBe(true);
  });
});

describe('compile — custom built-ins via CompileOptions', () => {
  it('accepts custom function registered via opts.builtins', () => {
    const r = compile(mustParse('DOUBLE(3)'), {
      builtins: {
        DOUBLE: { arity: 1, impl: (args) => (args[0] as number) * 2 },
      },
    });
    expect(r.ok).toBe(true);
  });

  it('custom overrides built-in of same name', () => {
    const r = compile(mustParse('ABS(1)'), {
      builtins: {
        ABS: { arity: 1, impl: () => 'overridden' },
      },
    });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 5: Author `tests/evaluate.test.ts`**

Write `packages/expression/tests/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile';
import { evaluate } from '../src/evaluate';
import { parse } from '../src/parse';
import { EvalError } from '../src/types';

function evalStr(src: string, row: Record<string, unknown> = {}): unknown {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse: ${p.error.message}`);
  const c = compile(p.ast);
  if (!c.ok) throw new Error(`compile: ${c.error.message}`);
  return evaluate(c.compiled, { row });
}

describe('evaluate — literals + field access', () => {
  it('returns numeric literal', () => expect(evalStr('42')).toBe(42));
  it('returns string literal', () => expect(evalStr('"hi"')).toBe('hi'));
  it('returns boolean literal', () => expect(evalStr('true')).toBe(true));
  it('returns null literal', () => expect(evalStr('null')).toBeNull());

  it('resolves top-level field', () =>
    expect(evalStr('[price]', { price: 100 })).toBe(100));

  it('resolves nested field', () =>
    expect(evalStr('[trade.price]', { trade: { price: 100 } })).toBe(100));

  it('resolves array-index field', () =>
    expect(evalStr('[bids.0.px]', { bids: [{ px: 99 }] })).toBe(99));

  it('null-safe: returns null on missing intermediate', () =>
    expect(evalStr('[trade.price]', {})).toBeNull());

  it('null-safe: returns null on null intermediate', () =>
    expect(evalStr('[trade.price]', { trade: null })).toBeNull());
});

describe('evaluate — arithmetic', () => {
  it('adds numbers', () => expect(evalStr('1 + 2')).toBe(3));
  it('respects precedence', () => expect(evalStr('1 + 2 * 3')).toBe(7));
  it('respects parens', () => expect(evalStr('(1 + 2) * 3')).toBe(9));
  it('subtracts left-assoc', () => expect(evalStr('10 - 3 - 2')).toBe(5));
  it('divides', () => expect(evalStr('6 / 2')).toBe(3));
  it('modulos', () => expect(evalStr('7 % 3')).toBe(1));
  it('handles unary minus', () => expect(evalStr('-5')).toBe(-5));

  it('throws div-by-zero', () => {
    try {
      evalStr('1 / 0');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('div-by-zero');
    }
  });

  it('throws mod-by-zero', () => {
    try {
      evalStr('1 % 0');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('div-by-zero');
    }
  });
});

describe('evaluate — string concat via +', () => {
  it('concatenates two strings', () =>
    expect(evalStr('"a" + "b"')).toBe('ab'));

  it('treats string+number as type error', () => {
    try {
      evalStr('"a" + 1');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('type-error');
    }
  });
});

describe('evaluate — comparisons + equality', () => {
  it('<, <=, >, >= on numbers', () => {
    expect(evalStr('1 < 2')).toBe(true);
    expect(evalStr('2 <= 2')).toBe(true);
    expect(evalStr('3 > 2')).toBe(true);
    expect(evalStr('2 >= 2')).toBe(true);
    expect(evalStr('2 > 3')).toBe(false);
  });

  it('==, != strict, no coercion', () => {
    expect(evalStr('1 == 1')).toBe(true);
    expect(evalStr('1 != 2')).toBe(true);
    expect(evalStr('null == null')).toBe(true);
  });

  it('compares strings lexicographically', () => {
    expect(evalStr('"a" < "b"')).toBe(true);
    expect(evalStr('"b" > "a"')).toBe(true);
  });

  it('type-errors on cross-type comparison', () => {
    try {
      evalStr('1 < "a"');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('type-error');
    }
  });
});

describe('evaluate — logical + short-circuit', () => {
  it('&& returns first falsy', () =>
    expect(evalStr('false && [missing]')).toBe(false));

  it('&& returns last if all truthy', () =>
    expect(evalStr('1 && 2')).toBe(2));

  it('|| returns first truthy', () =>
    expect(evalStr('0 || 5')).toBe(5));

  it('|| returns last if all falsy', () =>
    expect(evalStr('0 || null')).toBeNull());

  it('short-circuits &&: right side not evaluated', () => {
    // If not short-circuiting, [zero] / 0 would throw div-by-zero.
    expect(evalStr('false && (1 / 0)')).toBe(false);
  });
});

describe('evaluate — ternary', () => {
  it('picks consequent when truthy', () =>
    expect(evalStr('true ? "yes" : "no"')).toBe('yes'));

  it('picks alternate when falsy', () =>
    expect(evalStr('null ? "yes" : "no"')).toBe('no'));

  it('short-circuits alternate', () => {
    // If not short-circuiting, 1/0 branch would throw.
    expect(evalStr('true ? 1 : (1/0)')).toBe(1);
  });
});

describe('evaluate — built-ins', () => {
  it('IF returns branch', () => {
    expect(evalStr('IF([x] > 0, "pos", "neg")', { x: 1 })).toBe('pos');
    expect(evalStr('IF([x] > 0, "pos", "neg")', { x: -1 })).toBe('neg');
  });

  it('COALESCE returns first non-null', () => {
    expect(evalStr('COALESCE(null, null, 42)')).toBe(42);
    expect(evalStr('COALESCE([a], [b], 0)', { b: 7 })).toBe(7);
  });

  it('NOT inverts truthiness', () => {
    expect(evalStr('NOT(true)')).toBe(false);
    expect(evalStr('NOT(null)')).toBe(true);
  });

  it('AND / OR variadic', () => {
    expect(evalStr('AND(true, true, true)')).toBe(true);
    expect(evalStr('AND(true, false, true)')).toBe(false);
    expect(evalStr('OR(false, false, true)')).toBe(true);
  });

  it('ABS, FLOOR, CEIL, ROUND', () => {
    expect(evalStr('ABS(-3.5)')).toBe(3.5);
    expect(evalStr('FLOOR(1.9)')).toBe(1);
    expect(evalStr('CEIL(1.1)')).toBe(2);
    expect(evalStr('ROUND(1.5)')).toBe(2);
    expect(evalStr('ROUND(1.2345, 2)')).toBe(1.23);
  });

  it('MIN, MAX variadic', () => {
    expect(evalStr('MIN(3, 1, 2)')).toBe(1);
    expect(evalStr('MAX(3, 1, 2)')).toBe(3);
  });

  it('LOWER, UPPER, LEN', () => {
    expect(evalStr('LOWER("ABC")')).toBe('abc');
    expect(evalStr('UPPER("abc")')).toBe('ABC');
    expect(evalStr('LEN("hello")')).toBe(5);
  });
});

describe('evaluate — error paths', () => {
  it('null-field error on unary - null', () => {
    try {
      evalStr('-[missing]', {});
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('null-field');
    }
  });

  it('runtime error wraps unexpected throws', () => {
    // A custom built-in that throws a non-EvalError, plain Error.
    const p = parse('BOOM()');
    if (!p.ok) throw new Error('parse');
    const c = compile(p.ast, {
      builtins: { BOOM: { arity: 0, impl: () => { throw new Error('kaboom'); } } },
    });
    if (!c.ok) throw new Error('compile');
    try {
      evaluate(c.compiled, { row: {} });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('runtime');
      expect((e as EvalError).message).toMatch(/kaboom/);
    }
  });
});
```

- [ ] **Step 6: Run all tests**

Run:
```bash
npm test --workspace=@wellsfargo-starui/velocity-grid-expression
```
Expected: all pass. Tally roughly 60 (compile) + 60 (evaluate) + 77 (task 2) ≈ 200 tests.

- [ ] **Step 7: Typecheck + lint**

Run:
```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-expression && npm run lint
```
Expected: clean.

- [ ] **Step 8: Commit**

Run:
```bash
git add packages/expression/src/builtins.ts packages/expression/src/compile.ts packages/expression/src/evaluate.ts packages/expression/tests/compile.test.ts packages/expression/tests/evaluate.test.ts
git status --short
git commit -m "$(cat <<'EOF'
feat(expression): cycle 21b task 3 — compiler + closure evaluator + 14 built-ins

Recursive AST-walk compiler produces a closure via lambda composition —
CSP-safe (no new Function, no eval). The 8 AST node kinds each emit a
minimal Runner closure; call nodes look up name in the built-in
registry (dispatch), the aggregate list (not-yet-implemented rejection),
or emit unknown-fn.

14 built-ins shipped:
  Control:   IF, COALESCE
  Logical:   NOT, AND, OR
  Numeric:   ABS, ROUND, MIN, MAX, FLOOR, CEIL
  String:    LOWER, UPPER, LEN

MIN/MAX have both a built-in (variadic) shape and are on the aggregate
name list. In 21b the built-in wins for any MIN(...)/MAX(...) call;
21d will disambiguate by arg shape.

evaluate() is a thin error-boundary wrapper: EvalError re-thrown as-is;
any other throw wraps into EvalError { code: 'runtime' } anchored at
the AST root loc.

Semantics locked in tests:
- + overload: both-strings → concat; else numeric add; mixed → type-error.
- Comparisons: numeric or same-string only; cross-type → type-error.
- Equality: strict === with null == undefined.
- Short-circuit on &&, ||, ternary.
- Null-safe field access (returns null through missing/null intermediates).
- Div-by-zero + mod-by-zero throw EvalError.
- Aggregate names + PREV rejected with not-yet-implemented + Cycle 21d hint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Validator + error positional accuracy

**Files:**
- Overwrite: `packages/expression/src/validate.ts` (real implementation)
- Create: `packages/expression/tests/validate.test.ts`
- Create: `packages/expression/tests/errors.test.ts`

**Interfaces:**
- Consumes (Tasks 1–3): `parse`, `compile`, all types, `AGGREGATE_NAMES` (from `builtins.ts`).
- Produces (Task 5):
    - Working `validate(source: string, schema: Schema): ValidationResult`.
    - Validation error codes: `'parse'` (source didn't parse), `'compile'` (parsed but compile rejected), `'unknown-field'` (field path not in schema), `'type-mismatch'` (comparison/arithmetic operands' schema types are incompatible).
    - Every emitted error carries `loc` corresponding to the offending source substring.

- [ ] **Step 1: Write `src/validate.ts` — parse + compile + schema check**

Write `packages/expression/src/validate.ts` (full replacement):

```ts
import { compile } from './compile';
import { parse } from './parse';
import type {
  AstNode, BinaryNode, FieldNode, Schema, ValidationError,
  ValidationResult, FieldType,
} from './types';

export function validate(source: string, schema: Schema): ValidationResult {
  const errors: ValidationError[] = [];

  const parsed = parse(source);
  if (!parsed.ok) {
    errors.push({
      kind: 'validate', code: 'parse',
      message: parsed.error.message, loc: parsed.error.loc,
    });
    return { ok: false, errors };
  }

  const compiled = compile(parsed.ast);
  if (!compiled.ok) {
    errors.push({
      kind: 'validate', code: 'compile',
      message: compiled.error.message, loc: compiled.error.loc,
    });
    return { ok: false, errors };
  }

  walk(parsed.ast, schema, errors);

  return { ok: errors.length === 0, errors };
}

function walk(node: AstNode, schema: Schema, errors: ValidationError[]): void {
  switch (node.kind) {
    case 'literal': return;
    case 'field': return checkField(node, schema, errors);
    case 'unary': return walk(node.arg, schema, errors);
    case 'binary': {
      walk(node.left, schema, errors);
      walk(node.right, schema, errors);
      checkBinaryTypes(node, schema, errors);
      return;
    }
    case 'ternary': {
      walk(node.test, schema, errors);
      walk(node.consequent, schema, errors);
      walk(node.alternate, schema, errors);
      return;
    }
    case 'call': {
      for (const a of node.args) walk(a, schema, errors);
      return;
    }
    case 'aggregate':
    case 'prev':
      // reserved; compile already rejected in this pass
      return;
  }
}

function checkField(node: FieldNode, schema: Schema, errors: ValidationError[]): void {
  const key = node.path.join('.');
  if (!(key in schema.fields)) {
    errors.push({
      kind: 'validate', code: 'unknown-field',
      message: `unknown field '${key}'`, loc: node.loc,
    });
  }
}

function checkBinaryTypes(node: BinaryNode, schema: Schema, errors: ValidationError[]): void {
  const op = node.op;
  if (op !== '<' && op !== '<=' && op !== '>' && op !== '>=') return;
  const lt = staticType(node.left, schema);
  const rt = staticType(node.right, schema);
  if (lt === 'unknown' || rt === 'unknown') return;
  const compatible = (
    (lt === 'number' && rt === 'number') ||
    (lt === 'string' && rt === 'string') ||
    (lt === 'date' && rt === 'date')
  );
  if (!compatible) {
    errors.push({
      kind: 'validate', code: 'type-mismatch',
      message: `cannot compare ${lt} and ${rt}`, loc: node.loc,
    });
  }
}

function staticType(node: AstNode, schema: Schema): FieldType {
  switch (node.kind) {
    case 'literal':
      if (typeof node.value === 'number') return 'number';
      if (typeof node.value === 'string') return 'string';
      if (typeof node.value === 'boolean') return 'boolean';
      return 'unknown';
    case 'field': {
      const key = node.path.join('.');
      return schema.fields[key] ?? 'unknown';
    }
    case 'unary':
      return node.op === '!' ? 'boolean' : 'number';
    case 'binary':
      if (node.op === '&&' || node.op === '||' ||
          node.op === '<' || node.op === '<=' || node.op === '>' || node.op === '>=' ||
          node.op === '==' || node.op === '!=') return 'boolean';
      return 'number';
    case 'ternary':
      return 'unknown';
    case 'call':
    case 'aggregate':
    case 'prev':
      return 'unknown';
  }
}
```

- [ ] **Step 2: Author `tests/validate.test.ts`**

Write `packages/expression/tests/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validate } from '../src/validate';
import type { Schema } from '../src/types';

const S: Schema = {
  fields: {
    'price': 'number',
    'symbol': 'string',
    'active': 'boolean',
    'trade.px': 'number',
    'trade.side': 'string',
  },
};

describe('validate — passthroughs', () => {
  it('ok on literal-only', () => {
    expect(validate('42', S)).toEqual({ ok: true, errors: [] });
  });

  it('ok on known field arithmetic', () => {
    expect(validate('[price] + 1', S)).toEqual({ ok: true, errors: [] });
  });

  it('ok on known field comparison', () => {
    expect(validate('[price] > 100', S)).toEqual({ ok: true, errors: [] });
  });

  it('ok on nested field', () => {
    expect(validate('[trade.px] > 0', S)).toEqual({ ok: true, errors: [] });
  });
});

describe('validate — parse errors surface with code=parse', () => {
  it('missing bracket', () => {
    const r = validate('[foo', S);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('parse');
  });

  it('unmatched paren', () => {
    const r = validate('(1 + 2', S);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('parse');
  });
});

describe('validate — compile errors surface with code=compile', () => {
  it('unknown function', () => {
    const r = validate('NOPE(1)', S);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('compile');
  });

  it('aggregate not-yet-implemented', () => {
    const r = validate('SUM([price])', S);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('compile');
    expect(r.errors[0]?.message).toMatch(/Cycle 21d/);
  });

  it('bad arity', () => {
    const r = validate('IF(1, 2)', S);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('compile');
  });
});

describe('validate — unknown-field', () => {
  it('flags a single unknown field', () => {
    const r = validate('[foo] > 0', S);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('unknown-field');
    expect(r.errors[0]?.message).toMatch(/unknown field 'foo'/);
  });

  it('flags nested unknown', () => {
    const r = validate('[trade.foo]', S);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('unknown-field');
    expect(r.errors[0]?.message).toMatch(/trade\.foo/);
  });

  it('collects multiple unknowns in one pass', () => {
    const r = validate('[foo] + [bar]', S);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.map((e) => e.code)).toEqual(['unknown-field', 'unknown-field']);
  });
});

describe('validate — type-mismatch on comparison', () => {
  it('flags number < string', () => {
    const r = validate('[price] < [symbol]', S);
    expect(r.ok).toBe(false);
    const tm = r.errors.find((e) => e.code === 'type-mismatch');
    expect(tm?.message).toMatch(/cannot compare number and string/);
  });

  it('allows string < string', () => {
    const r = validate('[symbol] < "Z"', S);
    expect(r.ok).toBe(true);
  });

  it('allows number vs unknown (no schema info)', () => {
    const r = validate('[price] < UNKNOWN_FN()', S);
    // compile will reject unknown-fn first — but we're testing that
    // when a subexpression yields 'unknown' we don't spuriously add
    // type-mismatch. compile short-circuits validate() before walk.
    expect(r.errors[0]?.code).toBe('compile');
  });

  it('does not flag equality comparisons across types', () => {
    // == and != are intentionally not type-checked (JS-strict semantics)
    const r = validate('[price] == [symbol]', S);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Author `tests/errors.test.ts` — positional accuracy across all error surfaces**

Write `packages/expression/tests/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile';
import { evaluate } from '../src/evaluate';
import { parse } from '../src/parse';
import { EvalError } from '../src/types';

describe('parse errors — loc points to the offending substring', () => {
  it('unterminated string starts at opening quote', () => {
    const src = '1 + "foo';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('unmatched paren points to eof or offending token', () => {
    const src = '(1 + 2';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(src.length);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('unexpected character points at exactly that char', () => {
    const src = '1 + @ + 2';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(5);
  });

  it('bare identifier loc covers the identifier', () => {
    const src = 'foo';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(0);
    expect(r.error.loc.end).toBe(3);
  });
});

describe('compile errors — loc points to the offending call', () => {
  it('unknown function loc covers full call expression', () => {
    const src = '1 + NOPE(1, 2)';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const r = compile(p.ast);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('arity error loc covers the offending call', () => {
    const src = '  IF(true, 1)';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const r = compile(p.ast);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(2);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('aggregate rejection loc covers the SUM(...) subtree', () => {
    const src = '2 * SUM([x])';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const r = compile(p.ast);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(src.length);
  });
});

describe('eval errors — loc anchors to the binary op that failed', () => {
  it('div-by-zero loc covers the division subtree', () => {
    const src = '[a] / [b]';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const c = compile(p.ast);
    if (!c.ok) throw new Error('compile');
    try {
      evaluate(c.compiled, { row: { a: 1, b: 0 } });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as EvalError;
      expect(err.code).toBe('div-by-zero');
      expect(err.loc.start).toBe(0);
      expect(err.loc.end).toBe(src.length);
    }
  });

  it('type-error on cross-type comparison anchors to the comparison', () => {
    const src = '[a] < [b]';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const c = compile(p.ast);
    if (!c.ok) throw new Error('compile');
    try {
      evaluate(c.compiled, { row: { a: 1, b: 'x' } });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as EvalError;
      expect(err.code).toBe('type-error');
      expect(err.loc.start).toBe(0);
      expect(err.loc.end).toBe(src.length);
    }
  });
});
```

- [ ] **Step 4: Run all tests**

Run:
```bash
npm test --workspace=@wellsfargo-starui/velocity-grid-expression
```
Expected: all pass. Tally now includes ~20 validate + ~11 errors additional.

- [ ] **Step 5: Coverage check**

Run:
```bash
npm run test:coverage --workspace=@wellsfargo-starui/velocity-grid-expression
```
Expected: coverage summary shows:
- `src/parse.ts` ≥ 90% lines
- `src/compile.ts` ≥ 90% lines
- `src/evaluate.ts` ≥ 90% lines
- `src/validate.ts` ≥ 85% lines
- `src/builtins.ts` ≥ 90% lines

If any file is below target, add targeted tests before Task 5. Do not commit skipped or `.only` tests.

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-expression && npm run lint
```
Expected: clean.

- [ ] **Step 7: Commit**

Run:
```bash
git add packages/expression/src/validate.ts packages/expression/tests/validate.test.ts packages/expression/tests/errors.test.ts
git commit -m "$(cat <<'EOF'
feat(expression): cycle 21b task 4 — validator + positional error accuracy

validate(source, schema) runs the pipeline in-order:
  1. parse — if fails, return with code='parse'.
  2. compile — if fails, return with code='compile' (aggregates + PREV
     surface here as compile error with Cycle 21d hint).
  3. schema walk — every FieldNode.path checked against Schema.fields;
     unknown → code='unknown-field'.
  4. static type check on relational ops (<, <=, >, >=); mismatched
     schema types → code='type-mismatch'. Equality (==/!=) intentionally
     not type-checked (JS-strict semantics).

errors.test.ts verifies every emitted error's loc precisely brackets
the offending source substring — parse errors, compile errors, and
eval errors all pass positional-accuracy assertions.

Validate multiple errors in one pass (collected, not fail-fast) so
customizer editors can surface every issue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Public API polish + README + monorepo verify + open PR

**Files:**
- Verify: `packages/expression/src/index.ts` (already written in Task 1 — sanity-check for accidental additions).
- Create: `packages/expression/README.md`.
- Verify: monorepo-wide gates from spec §7.4.
- Push branch, open PR.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: shippable package. No new API surface.

- [ ] **Step 1: Sanity-check `src/index.ts`**

Read `packages/expression/src/index.ts`. Confirm the exports match §5 of the spec verbatim:

```ts
// @wellsfargo-starui/velocity-grid-expression — public entrypoint.
// See docs/superpowers/specs/2026-07-01-cycle-21b-expression-design.md §5.

export { parse } from './parse';
export { compile } from './compile';
export { evaluate } from './evaluate';
export { validate } from './validate';

export type {
  Ast, AstNode, Loc, BinaryOp, UnaryOp,
  LiteralNode, FieldNode, UnaryNode, BinaryNode,
  TernaryNode, CallNode, AggregateNode, PrevNode,
  Compiled, CompileOptions, BuiltinDef,
  EvalContext,
  ParseError, ParseResult,
  CompileError, CompileResult,
  ValidationError, ValidationResult, Schema, FieldType,
} from './types';

export { EvalError } from './types';
```

If any drift, restore to this exact content. Nothing else in this file.

- [ ] **Step 2: Write `packages/expression/README.md`**

Write `packages/expression/README.md`:

```markdown
# `@wellsfargo-starui/velocity-grid-expression`

Row-local DSL parser, compiler, evaluator, and validator for the cgrid
monorepo. Zero cgrid dependencies. Thread-agnostic evaluator (spec §7's
"worker-only evaluation" is a deployment policy on downstream packages,
not a constraint of this one).

**Status:** Cycle 21b — parser + compiler + evaluator + validator all
shipped. Aggregate names (`SUM`, `AVG`, …) and `PREV(...)` parse
successfully but compile rejects them with a `not-yet-implemented`
code + Cycle 21d pointer. Full spec: `docs/superpowers/specs/2026-07-01-cycle-21b-expression-design.md`.

## Quickstart

```ts
import { parse, compile, evaluate, validate } from '@wellsfargo-starui/velocity-grid-expression';

// 1. Parse source → portable AST.
const parsed = parse('[price] > 100 && [symbol] == "AAPL"');
if (!parsed.ok) throw new Error(parsed.error.message);

// 2. Compile AST → closure.
const compiled = compile(parsed.ast);
if (!compiled.ok) throw new Error(compiled.error.message);

// 3. Evaluate against a row.
const result = evaluate(compiled.compiled, { row: { price: 150, symbol: 'AAPL' } });
console.log(result); // true

// 4. Validate against a schema (for customizer expression editors).
const check = validate(
  '[foo] > 0',
  { fields: { price: 'number', symbol: 'string' } },
);
console.log(check.ok, check.errors);
// false, [{ code: 'unknown-field', message: "unknown field 'foo'", loc: ... }]
```

## Grammar cheat sheet

- **Field access:** `[field]`, `[trade.price]`, `[book.bids.0.px]`
- **Literals:** `42`, `3.14`, `1e-3`, `"foo"`, `'bar'`, `true`, `false`, `null`
- **Unary:** `!x`, `-x`
- **Arithmetic:** `*` `/` `%` `+` `-` (`+` is string concat when both operands are strings)
- **Relational:** `<` `<=` `>` `>=`
- **Equality:** `==` `!=` (strict; `null == undefined`)
- **Logical:** `&&` `||` (short-circuit)
- **Ternary:** `test ? a : b`
- **Parens:** `(expr)`
- **Function call:** `NAME(a, b, c)`

**Built-ins (14):**
| Category  | Names                                           |
| --------- | ----------------------------------------------- |
| Control   | `IF(test, then, else)`, `COALESCE(a, b, ...)`   |
| Logical   | `NOT(x)`, `AND(a, b, ...)`, `OR(a, b, ...)`     |
| Numeric   | `ABS`, `ROUND(n [, digits])`, `MIN`, `MAX`, `FLOOR`, `CEIL` |
| String    | `LOWER`, `UPPER`, `LEN`                         |

**Reserved (compile-error until Cycle 21d):**
`SUM`, `AVG`, `COUNT`, `RUNNING_SUM`, `RUNNING_AVG`, `MOVING_AVG`,
`FIRST`, `LAST`, `DELTA_FROM_PREV`, `DELTA_FROM_FIRST`,
`DELTA_FROM_LAST`, `PREV`.

## Error surfaces

| API                 | Return                                    | Throw               |
| ------------------- | ----------------------------------------- | ------------------- |
| `parse(source)`     | `{ ok: true, ast } \| { ok: false, error }` | never             |
| `compile(ast, ?)`   | `{ ok: true, compiled } \| { ok: false, error }` | never          |
| `evaluate(c, ctx)`  | `unknown`                                 | `EvalError`         |
| `validate(src, s)`  | `{ ok, errors[] }`                        | never               |

Every error carries `loc: { start, end }` for editor error underlines.

## Design notes

- **Compiled is a closure, not code text.** `compile()` returns
  `{ ast, run: (ctx) => value }` where `run` is a recursive lambda
  chain — CSP-safe (no `new Function`, no `eval`).
- **AST is `structuredClone`-safe.** Discriminated union of plain
  objects, no functions, no classes. Main thread can `postMessage` the
  AST to worker for the worker-only-eval architecture (spec §7).
- **`AggregateNode` + `PrevNode`** exist in the type union but are
  reserved for Cycle 21d's post-compile transformation. Parser never
  emits them.
- **`+` overload:** both-string → concat; else numeric. Mixed types
  throw `EvalError { code: 'type-error' }`.
- **Field access is null-safe:** `[a.b.c]` returns `null` if any
  intermediate segment is `null`/`undefined`, not throws.

## Not shipped in this cycle

- Aggregate evaluation (SUM/AVG/COUNT/… → Cycle 21d, `@wellsfargo-starui/velocity-grid-calc`).
- Tick-scoped `prev()` snapshot semantics (→ Cycle 21d).
- Consumer wiring in kernel / format / rules (→ own cycles).
- Performance benchmarks against 8ms/frame at 50k rows (→ deferred).
```

- [ ] **Step 3: Run the full monorepo verification gate**

Run each of the following and confirm expected output before proceeding:

```bash
# Local: expression alone
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-expression
npm test --workspace=@wellsfargo-starui/velocity-grid-expression
npm run test:coverage --workspace=@wellsfargo-starui/velocity-grid-expression
```
Expected: all clean; coverage matches spec §7.4 targets.

```bash
# Repo-wide: turbo pipeline still walks cleanly
npx turbo run typecheck
npx turbo run test
```
Expected: all packages typecheck + test. `@wellsfargo-starui/velocity-grid` reports `2326/2326`; `@wellsfargo-starui/velocity-grid-expression` reports the new count; other 8 packages remain vacuous (`No test files found`).

```bash
# Kernel unchanged
git diff origin/main -- packages/kernel/
```
Expected: no output (kernel is untouched this cycle).

```bash
# Lint
npm run lint
```
Expected: clean.

```bash
# Build
npx turbo run build
```
Expected: kernel builds (Vite → `packages/kernel/dist/`); expression package emits its scaffold echo (no real build); other 8 packages emit their scaffold echos.

- [ ] **Step 4: E2E baselines (kernel-facing suites)**

Skip if wall-clock budget is tight; only run if reviewer flags a concern about hidden kernel touches:

```bash
# Showcase E2E
npm run e2e --workspace=cgrid-showcase
# Positions E2E
npm run e2e --workspace=cgrid-positions
```
Expected: `98/98` showcase; `262/262` positions — matches Cycle 21a final baseline.

Rationale for skipping-by-default: this cycle did not touch `packages/kernel/**` or any `apps/**` source; E2E is unchanged by construction. `git diff origin/main -- packages/kernel/ apps/` yielding empty output is stronger evidence than re-running.

- [ ] **Step 5: Commit the README + push**

Run:
```bash
git add packages/expression/README.md
# only README should be new — index.ts is already committed in Task 1
git status --short
git commit -m "$(cat <<'EOF'
docs(expression): cycle 21b task 5 — README

Grammar cheat sheet, quickstart, error-surface table, and a note on
what's deferred to Cycle 21d (aggregates + PREV). Publishes the
public API surface for downstream cycles to build against.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin cycle21b/expression
```
Expected: push succeeds; branch tracked to `origin/cycle21b/expression`.

- [ ] **Step 6: Open the PR**

Run from repo root:
```bash
gh pr create --title "cycle 21b — @wellsfargo-starui/velocity-grid-expression greenfield DSL (parse + compile + evaluate + validate)" --body "$(cat <<'EOF'
## Summary

- Ships `@wellsfargo-starui/velocity-grid-expression` — the DSL parser + compiler + evaluator + validator called for in Cycle 21 §3.2 + §4.2. First feature-absorption cycle after the 21a monorepo scaffold.
- Row-local grammar: field access, literals, arithmetic/comparison/logical/ternary operators, 14 built-in functions (`IF`, `COALESCE`, `NOT`, `AND`, `OR`, `ABS`, `ROUND`, `MIN`, `MAX`, `FLOOR`, `CEIL`, `LOWER`, `UPPER`, `LEN`).
- Aggregate names (`SUM`, `AVG`, etc.) + `PREV(...)` parse successfully but compile rejects with `code: 'not-yet-implemented'` + Cycle 21d hint. `AggregateNode` + `PrevNode` reserved in AST schema for 21d.
- Closure-based compile (recursive lambda composition) — CSP-safe; no `new Function`, no `eval`.
- AST is `structuredClone` + JSON-safe (verified per-corpus-entry in `postmessage-transferability.test.ts`) — the transport contract for main-to-worker migration in Cycle 21d.
- Zero cgrid dependencies. Kernel untouched (`git diff origin/main -- packages/kernel/` = empty).

## Spec + design

- Design: `docs/superpowers/specs/2026-07-01-cycle-21b-expression-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-cycle-21b-expression.md`
- Parent brief: `docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md` §3.2, §4.2, §7

## Test plan

- [ ] `npm test --workspace=@wellsfargo-starui/velocity-grid-expression` — all pass
- [ ] `npm run test:coverage --workspace=@wellsfargo-starui/velocity-grid-expression` — coverage per spec §7.4 (parse/compile/evaluate ≥ 90%; validate ≥ 85%)
- [ ] `npx turbo run typecheck` — clean across all 10 packages
- [ ] `npx turbo run test` — clean across all packages; `@wellsfargo-starui/velocity-grid` still `2326/2326`
- [ ] `npm run lint` — clean
- [ ] `git diff origin/main -- packages/kernel/ apps/` — empty (kernel + apps untouched)
- [ ] Golden AST corpus (`tests/fixtures/ast-corpus.json`) — 29 canonical expressions locked; any grammar change requires corpus update

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR URL printed. Copy the PR URL into `.superpowers/sdd/progress.md`.

- [ ] **Step 7: Update progress ledger**

Append to `.superpowers/sdd/progress.md`:

```
Task 5: complete — pushed cycle21b/expression to origin + opened PR
  PR: <url from Step 6>
  5 commits total for Cycle 21b (Task 1..5).
  Package @wellsfargo-starui/velocity-grid-expression fully populated:
    - Public API: parse + compile + evaluate + validate + all types
    - 14 built-ins (IF, COALESCE, NOT, AND, OR, ABS, ROUND, MIN, MAX,
      FLOOR, CEIL, LOWER, UPPER, LEN)
    - AggregateNode + PrevNode reserved in AST schema for Cycle 21d
    - Golden AST corpus locks 29 canonical expressions
    - postmessage-transferability contract verified
  Baselines held:
    - kernel tests: 2326/2326 (no diff on packages/kernel/**)
    - E2E: unchanged by construction (apps/ untouched)
Cycle 21b status: COMPLETE. Ready for review + merge.
```

Commit + push the progress update:
```bash
git add .superpowers/sdd/progress.md
git commit -m "chore(progress): cycle 21b — task 5 complete + ledger update"
git push
```

---

## Self-Review Notes (verified against spec 2026-07-01)

- **Spec §1 (Scope):** every "in scope" bullet has a task — types + skeletons (T1), parser + corpus (T2), compiler + evaluator + built-ins (T3), validator (T4), API polish + README + PR (T5). Non-goals reflected: no kernel edits, no worker-only enforcement inside package, no consumer wiring.
- **Spec §2 (Architecture):** file layout matches §2.2 exactly. Thread-agnostic evaluator per §2.3 (evaluate.ts takes `EvalContext`, no thread checks).
- **Spec §3 (Grammar):** every operator + literal type + field-path form covered by corpus entries (T2, Step 2) + evaluate tests (T3, Step 5). Precedence pairings encoded in corpus (`1 + 2 * 3`, `[a] || [b] && [c]`, `1 - 2 - 3`).
- **Spec §4 (AST):** every node kind in types.ts (T1, Step 6) and in the corpus (T2, Step 2).
- **Spec §5 (Public API):** index.ts export list in T1 Step 12 + T5 Step 1 matches §5 verbatim.
- **Spec §6 (Errors):** parse/compile return `ok`-union; eval throws `EvalError`. Verified in `errors.test.ts` (T4, Step 3) for all four error kinds.
- **Spec §7 (Testing):** all 6 test files created across T2–T4. Coverage targets checked in T4 Step 5 + T5 Step 3.
- **Spec §8 (Task decomposition):** exact 5-task split.
- **Placeholder scan:** no "TBD" / "add appropriate error handling" — every step has actual code or an exact command.
- **Type consistency:** `Compiled`, `EvalContext`, `EvalError`, `BuiltinDef`, `Ast`, `AstNode` used identically across T1 skeletons, T2 parser, T3 compiler, T4 validator. `AGGREGATE_NAMES` is the only cross-file name introduced after T1 (in T3's `builtins.ts`); T3 also uses it in `compile.ts`. `CompileErrorThrowable` class is T3-local (compile.ts internal); public `CompileError` interface stays in types.ts.

If a subagent finds a divergence during execution: fix the code, do NOT edit this plan.
