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
