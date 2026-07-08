# CGridExt Format Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ribbon `# Format` pill's `window.prompt()` with a full format-picker dropdown (categories, search, live previews, Custom tab) at parity with the reference screenshots, backed by native `@cgrid/format` DSL extensions (ticks, scientific, `=expr`).

**Architecture:** Phase A (Tasks 1-5) extends the format/expression/calc engines so every preset is a plain serializable DSL string. Phase B (Tasks 6-9) ports the starui preset catalog as pure data and builds the plain-DOM panel in `@cgrid/ext`, wiring it into `ribbon.ts` in place of the prompt. Task 10 is the E2E gate.

**Tech Stack:** TypeScript; vitest (format/expression/calc/ext unit suites, happy-dom for ext); plain DOM + injected CSS with `--cg-*` tokens; Playwright E2E in `apps/cgrid-ext-demo`.

**Spec:** `docs/superpowers/specs/2026-07-07-ext-format-picker-design.md`

## Global Constraints

- No JS string is ever executed (`new Function`/`eval` forbidden) — ƒ(x) presets ride `@cgrid/expression`.
- Formatters never throw at paint time: eval errors → `''`; preview errors → `·`.
- Column-scoped apply via the ribbon's existing `targetCols()` / `applyFormat()` → `editColumn` own-templates.
- Plain DOM in ext (Lit is customizer-only); `cgext-fmt-` class prefix; all colors from `--cg-*` tokens with the title bar's neutral-dark fallbacks; panel width 440px.
- The `window.prompt` block in `ribbon.ts` is DELETED (spec §1).
- Working branch: `cgridext/ribbon-density`. Commit after every task.
- Suites: `cd packages/<pkg> && npx vitest run` (+ `npx tsc --noEmit`). The ext demo consumes the kernel's BUILT dist — `@cgrid/format`/`@cgrid/calc`/`@cgrid/expression` resolve source-direct, but if the demo behaves stale, `cd packages/kernel && npm run build` and clear `apps/cgrid-ext-demo/node_modules/.vite`.
- E2E: `cd apps/cgrid-ext-demo && npx playwright test` (server :5188; kill stale servers first; kill automation processes after).

---

### Task 1: Tick sections in `@cgrid/format` (`TICK32`/`TICK32+`/`TICK64`/`TICK128`/`TICK256`)

**Files:**
- Create: `packages/format/src/excel/tick.ts`
- Modify: `packages/format/src/compile.ts` (early branch in `compileFormat`, before `tokenize` at :27)
- Test: `packages/format/tests/excel/tick.test.ts`

**Interfaces:**
- Produces: `formatTick(value: unknown, denom: 32 | 64 | 128 | 256, halves: boolean): string` (exported from `excel/tick.ts`); format strings `TICK32`, `TICK32+`, `TICK64`, `TICK128`, `TICK256` compile via `compileFormat` into programs whose `formatText` renders tick notation. Tasks 6/10 rely on these exact five strings.

**Semantics (fixed-income eighths convention):** round the absolute value to the nearest `1/denom` (`1/64` for `TICK32+`), then render `[sign]WHOLE-TT[tail]` where `TT` = whole 32nds zero-padded to 2, and `tail` = the sub-32nd remainder expressed in eighths-of-a-32nd as a single digit (`1`–`7`, omitted when 0). `TICK32` has no tail (pure 32nds). `TICK32+` renders the half-32nd as `+` instead of `4`. Examples: `101.5`→`101-16` (all denoms); `101.515625`→`101-16+` (TICK32+), `101-164` (TICK64); `101.5078125`→`101-162` (TICK128); `101.50390625`→`101-161` (TICK256); `-101.5`→`-101-16`; non-numeric/null → `''`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/format/tests/excel/tick.test.ts
import { describe, it, expect } from 'vitest';
import { formatTick } from '../../src/excel/tick';
import { compileFormat } from '../../src/compile';

const run = (fmt: string, value: unknown): string => {
  const r = compileFormat(fmt);
  if (!r.ok) throw new Error(r.error.message);
  return r.program.formatText({ value, row: {}, colId: 'c' });
};

describe('formatTick', () => {
  it('renders whole 32nds', () => {
    expect(formatTick(101.5, 32, false)).toBe('101-16');
    expect(formatTick(101, 32, false)).toBe('101-00');
    expect(formatTick(99.96875, 32, false)).toBe('99-31');
  });
  it('rounds to the nearest tick', () => {
    expect(formatTick(101.5001, 32, false)).toBe('101-16');
    expect(formatTick(101.51, 32, false)).toBe('101-16'); // 16.32/32 rounds down
    expect(formatTick(101.516, 32, false)).toBe('101-17'); // 16.5+ rounds up
  });
  it('TICK32+ marks the half-tick with +', () => {
    expect(formatTick(101.5, 32, true)).toBe('101-16');
    expect(formatTick(101.515625, 32, true)).toBe('101-16+'); // 33/64
  });
  it('finer denominations append the eighths digit', () => {
    expect(formatTick(101.515625, 64, false)).toBe('101-164');   // 33/64 = 16/32 + 4/8
    expect(formatTick(101.5078125, 128, false)).toBe('101-162'); // 16/32 + 2/8
    expect(formatTick(101.50390625, 256, false)).toBe('101-161');// 16/32 + 1/8
    expect(formatTick(101.5, 256, false)).toBe('101-16');        // zero tail omitted
  });
  it('carries a round-up across the handle', () => {
    expect(formatTick(101.999, 32, false)).toBe('102-00'); // 31.968/32 → 32 → carry
  });
  it('handles sign and junk', () => {
    expect(formatTick(-101.5, 32, false)).toBe('-101-16');
    expect(formatTick(null, 32, false)).toBe('');
    expect(formatTick('abc', 32, false)).toBe('');
  });
});

describe('TICK format strings via compileFormat', () => {
  it('compiles all five tokens', () => {
    expect(run('TICK32', 101.5)).toBe('101-16');
    expect(run('TICK32+', 101.515625)).toBe('101-16+');
    expect(run('TICK64', 101.515625)).toBe('101-164');
    expect(run('TICK128', 101.5078125)).toBe('101-162');
    expect(run('TICK256', 101.50390625)).toBe('101-161');
  });
  it('is whole-string only — embedded TICK32 stays a literal format', () => {
    const r = compileFormat('"TICK32"');
    expect(r.ok).toBe(true);
  });
  it('tick programs style/icon resolve to null', () => {
    const r = compileFormat('TICK32');
    if (!r.ok) throw new Error('compile failed');
    expect(r.program.resolveStyle({ value: 1, row: {}, colId: 'c' })).toBeNull();
    expect(r.program.resolveIcon({ value: 1, row: {}, colId: 'c' })).toBeNull();
    expect(r.program.tiers).toEqual({ tier0: true, tier1: false, tier2: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/format && npx vitest run tests/excel/tick.test.ts`
Expected: FAIL — `Cannot find module '../../src/excel/tick'`.

- [ ] **Step 3: Implement `packages/format/src/excel/tick.ts`**

```ts
/**
 * Fixed-income tick formatting — bond prices quoted in 32nds with the
 * sub-32nd remainder as an eighths digit (market "101-162" convention;
 * the half-32nd renders as `+` in the TICK32+ style). The math is owned
 * here, NOT imported from the kernel's price32 editor — @cgrid/format
 * has no kernel dependency.
 */
export function formatTick(
  value: unknown,
  denom: 32 | 64 | 128 | 256,
  halves: boolean,
): string {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // TICK32+ quotes in half-32nds (1/64) even though the base is 32.
  const quant = halves ? 64 : denom;
  const units = Math.round(abs * quant);         // price in 1/quant units
  const whole = Math.floor(units / quant);
  const rem = units - whole * quant;             // 0..quant-1 sub-handle units
  const perTick = quant / 32;                    // units per 32nd
  const ticks = Math.floor(rem / perTick);       // 0..31
  const sub = rem - ticks * perTick;             // 0..perTick-1
  const eighths = sub * (8 / perTick);           // integer 0..7
  let tail = '';
  if (eighths > 0) tail = halves ? '+' : String(eighths);
  return `${sign}${whole}-${String(ticks).padStart(2, '0')}${tail}`;
}

/** `TICK32` `TICK32+` `TICK64` `TICK128` `TICK256` — whole-string tick tokens. */
export const TICK_FORMAT_RE = /^TICK(32\+?|64|128|256)$/;

export function parseTickFormat(source: string): { denom: 32 | 64 | 128 | 256; halves: boolean } | null {
  const m = TICK_FORMAT_RE.exec(source.trim());
  if (!m) return null;
  const halves = m[1] === '32+';
  const denom = Number(m[1]!.replace('+', '')) as 32 | 64 | 128 | 256;
  return { denom, halves };
}
```

- [ ] **Step 4: Add the compile branch in `compile.ts`**

Immediately after the `if (typeof source !== 'string')` block (:23-25), before `tokenize`:

```ts
  // Fixed-income tick tokens — whole-string sections (spec §3.1). Handled
  // before tokenization: `TICK32` would otherwise lex as literals.
  const tick = parseTickFormat(source);
  if (tick) {
    const program: FormatProgram = {
      source,
      tiers: { tier0: true, tier1: false, tier2: false },
      formatText: (ctx: FormatEvalContext): string => formatTick(ctx.value, tick.denom, tick.halves),
      resolveStyle: (): StyleObj | null => null,
      resolveIcon: (): IconRef | null => null,
      resolveFragments: (): ResolvedFragment[] | null => null,
    };
    return { ok: true, program };
  }
```

Add the import: `import { formatTick, parseTickFormat } from './excel/tick';`

- [ ] **Step 5: Verify green + full suite**

Run: `cd packages/format && npx vitest run tests/excel/tick.test.ts && npx vitest run && npx tsc --noEmit`
Expected: new tests pass; full format suite unchanged-green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/format/src/excel/tick.ts packages/format/src/compile.ts packages/format/tests/excel/tick.test.ts
git commit -m "feat(format): TICK32/TICK32+/TICK64/TICK128/TICK256 tick sections — 32nds + eighths-digit convention"
```

---

### Task 2: Scientific notation (`0.00E+00`) in number sections

**Files:**
- Modify: `packages/format/src/tokenizer.ts` (new `exponent` token)
- Modify: `packages/format/src/excel/evaluator.ts` (`classifyTokens` + `formatNumber`)
- Test: `packages/format/tests/excel/scientific.test.ts`

**Interfaces:**
- Produces: `Token` union gains `{ kind: 'exponent'; sign: '+' | '-'; digits: number; loc: Loc }`; format strings containing `E+00`/`E-0` etc. render scientific notation. Task 6's `Scientific` preset (`0.00E+00`) relies on it.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/format/tests/excel/scientific.test.ts
import { describe, it, expect } from 'vitest';
import { compileFormat } from '../../src/compile';

const run = (fmt: string, value: unknown): string => {
  const r = compileFormat(fmt);
  if (!r.ok) throw new Error(r.error.message);
  return r.program.formatText({ value, row: {}, colId: 'c' });
};

describe('scientific notation', () => {
  it('formats 0.00E+00 with signed, zero-padded exponent', () => {
    expect(run('0.00E+00', 1234.5678)).toBe('1.23E+03');
    expect(run('0.00E+00', 0.00123)).toBe('1.23E-03');
    expect(run('0.00E+00', 0)).toBe('0.00E+00');
  });
  it('mantissa decimals follow the pattern', () => {
    expect(run('0.0E+00', 1234.5678)).toBe('1.2E+03');
    expect(run('0E+00', 1234.5678)).toBe('1E+03');
  });
  it('E- signs only negative exponents', () => {
    expect(run('0.00E-00', 1234.5678)).toBe('1.23E03');
    expect(run('0.00E-00', 0.00123)).toBe('1.23E-03');
  });
  it('exponent pads to the pattern width', () => {
    expect(run('0.00E+0', 1234.5678)).toBe('1.23E+3');
    expect(run('0.00E+000', 1234.5678)).toBe('1.23E+003');
  });
  it('negatives keep the mantissa sign', () => {
    expect(run('0.00E+00', -1234.5678)).toBe('-1.23E+03');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/format && npx vitest run tests/excel/scientific.test.ts`
Expected: FAIL — output like `1.23E+03` not produced (the `E`, `+` lex as literals today, e.g. `1,235E+00`-style garbage or literal passthrough).

- [ ] **Step 3: Tokenizer — add the `exponent` token**

In `packages/format/src/tokenizer.ts`: add to the `Token` union
```ts
  | { kind: 'exponent'; sign: '+' | '-'; digits: number; loc: Loc }
```
and in the main scan loop, BEFORE the date-token/literal fallthrough for the letter `E`, match `/^E([+-])(0+)/` at the current position (uppercase only — Excel's canonical form):

```ts
    // Scientific exponent marker: E+00 / E-0 …
    if (ch === 'E') {
      const m = /^E([+-])(0+)/.exec(source.slice(i));
      if (m) {
        tokens.push({
          kind: 'exponent',
          sign: m[1] as '+' | '-',
          digits: m[2]!.length,
          loc: { start: i, end: i + m[0].length },
        });
        i += m[0].length;
        continue;
      }
    }
```

(Adapt variable names to the tokenizer's actual loop — it iterates an index over `source`; place this alongside the other multi-char matches such as `AM/PM`, BEFORE single-char literal emission.)

- [ ] **Step 4: Evaluator — scientific path**

In `packages/format/src/excel/evaluator.ts`:

1. `classifyTokens` (:135): count `exponent` as a numeric signal — extend `hasNumericTokens`:
```ts
  const hasNumericTokens = tokens.some(
    (t) =>
      t.kind === 'digit-placeholder' ||
      t.kind === 'group-separator' ||
      t.kind === 'decimal-point' ||
      t.kind === 'percent' ||
      t.kind === 'exponent',
  );
```
2. `formatNumber` (:280): before the plain-number path, branch on an exponent token:
```ts
  const expTok = tokens.find((t) => t.kind === 'exponent');
  if (expTok && expTok.kind === 'exponent') {
    return formatScientific(tokens, expTok, n);
  }
```
3. New helper (below `formatNumber`):
```ts
function formatScientific(
  tokens: Token[],
  expTok: { sign: '+' | '-'; digits: number },
  n: number,
): string {
  // Mantissa fraction digits come from the pattern before the exponent.
  const expIdx = tokens.findIndex((t) => t.kind === 'exponent');
  const mantissaTokens = tokens.slice(0, expIdx);
  let frac = 0;
  let sawDecimal = false;
  for (const t of mantissaTokens) {
    if (t.kind === 'decimal-point') sawDecimal = true;
    else if (sawDecimal && t.kind === 'digit-placeholder') frac++;
  }
  const s = n.toExponential(frac); // e.g. "1.23e+3" / "-1.23e-3"
  const m = /^(-?[0-9.]+)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[3]!.padStart(expTok.digits, '0');
  const signStr = m[2] === '-' ? '-' : expTok.sign === '+' ? '+' : '';
  return `${m[1]}E${signStr}${digits}`;
}
```

- [ ] **Step 5: Verify green + full suite**

Run: `cd packages/format && npx vitest run tests/excel/scientific.test.ts && npx vitest run && npx tsc --noEmit`
Expected: 5 new pass; full suite green (no existing format uses a bare `E+` sequence); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/format/src/tokenizer.ts packages/format/src/excel/evaluator.ts packages/format/tests/excel/scientific.test.ts
git commit -m "feat(format): scientific-notation sections — E+00/E-00 exponent tokens with Excel sign semantics"
```

---

### Task 3: New expression builtins — `TRIM` `TITLE` `CAMEL` `CAP` `FIXED`

**Files:**
- Modify: `packages/expression/src/builtins.ts` (BUILTINS map — `LOWER`/`UPPER` live at :55-56)
- Test: `packages/expression/tests/builtins.test.ts` (append; if the file doesn't exist, create it with this describe block)

**Interfaces:**
- Produces: builtins callable from any expression: `TRIM(s)`, `TITLE(s)`, `CAMEL(s)`, `CAP(s)` → string; `FIXED(n, dp)` → string (no grouping). ALL are total: null/undefined/invalid input → `''` (never throw — spec §3.3). Task 6's ƒ(x) presets call them.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/expression/tests/builtins.test.ts (append or create)
import { describe, it, expect } from 'vitest';
import { parse, compile, evaluate } from '../src';

const evalExpr = (src: string, row: Record<string, unknown> = {}): unknown => {
  const p = parse(src);
  if (!p.ok) throw new Error(p.error.message);
  const c = compile(p.ast);
  if (!c.ok) throw new Error(c.error.message);
  return evaluate(c.compiled, { row });
};

describe('string/number builtins (format-picker set)', () => {
  it('TRIM', () => {
    expect(evalExpr('TRIM(x)', { x: '  hi  ' })).toBe('hi');
    expect(evalExpr('TRIM(x)', { x: null })).toBe('');
  });
  it('TITLE', () => {
    expect(evalExpr('TITLE(x)', { x: 'hello world' })).toBe('Hello World');
    expect(evalExpr('TITLE(x)', { x: 'MIXED case-words' })).toBe('Mixed Case-Words');
    expect(evalExpr('TITLE(x)', { x: null })).toBe('');
  });
  it('CAMEL', () => {
    expect(evalExpr('CAMEL(x)', { x: 'hello world' })).toBe('helloWorld');
    expect(evalExpr('CAMEL(x)', { x: 'Foo_bar-baz' })).toBe('fooBarBaz');
    expect(evalExpr('CAMEL(x)', { x: null })).toBe('');
  });
  it('CAP', () => {
    expect(evalExpr('CAP(x)', { x: 'sample' })).toBe('Sample');
    expect(evalExpr('CAP(x)', { x: '' })).toBe('');
    expect(evalExpr('CAP(x)', { x: null })).toBe('');
  });
  it('FIXED', () => {
    expect(evalExpr('FIXED(x, 1)', { x: 12.34 })).toBe('12.3');
    expect(evalExpr('FIXED(x, 0)', { x: 1234.5678 })).toBe('1235');
    expect(evalExpr('FIXED(x, 2)', { x: null })).toBe('');
    expect(evalExpr('FIXED(x, 2)', { x: 'junk' })).toBe('');
  });
  it('composes with + string concat (bps shape)', () => {
    expect(evalExpr('(x >= 0 ? "+" : "") + FIXED(x * 10000, 1) + " bp"', { x: 0.001234 })).toBe('+12.3 bp');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/expression && npx vitest run tests/builtins.test.ts`
Expected: FAIL — `unknown function: TRIM` (compile error thrown by the harness).

- [ ] **Step 3: Implement in `builtins.ts`**

Add below `UPPER` (:56), matching the existing `{ arity, impl }` shape. Null-tolerance is explicit — do NOT route through `asString`/`asNumber` if those throw on null:

```ts
  TRIM: { arity: 1, impl: (args) => (args[0] == null ? '' : String(args[0]).trim()) },
  TITLE: {
    arity: 1,
    impl: (args) =>
      args[0] == null
        ? ''
        : String(args[0])
            .toLowerCase()
            .replace(/(^|[\s\-_])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()),
  },
  CAMEL: {
    arity: 1,
    impl: (args) => {
      if (args[0] == null) return '';
      const parts = String(args[0]).trim().split(/[\s\-_]+/).filter(Boolean);
      return parts
        .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
        .join('');
    },
  },
  CAP: {
    arity: 1,
    impl: (args) => {
      if (args[0] == null) return '';
      const s = String(args[0]);
      return s === '' ? '' : s.charAt(0).toUpperCase() + s.slice(1);
    },
  },
  FIXED: {
    arity: 2,
    impl: (args) => {
      if (args[0] == null || args[1] == null) return '';
      const n = typeof args[0] === 'number' ? args[0] : Number(args[0]);
      const dp = typeof args[1] === 'number' ? args[1] : Number(args[1]);
      if (!Number.isFinite(n) || !Number.isFinite(dp)) return '';
      return n.toFixed(Math.max(0, Math.min(20, Math.trunc(dp))));
    },
  },
```

- [ ] **Step 4: Verify green + full suite**

Run: `cd packages/expression && npx vitest run && npx tsc --noEmit`
Expected: all pass (existing suite untouched), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/expression/src/builtins.ts packages/expression/tests/builtins.test.ts
git commit -m "feat(expression): TRIM/TITLE/CAMEL/CAP/FIXED total builtins for =expr value formatters"
```

---

### Task 4: `=expr` value-formatter form in `compileFormat`

**Files:**
- Modify: `packages/format/src/compile.ts` (early branch, after Task 1's tick branch)
- Modify: `packages/format/src/types.ts` (`CompileFormatError.code` union gains `'expr-parse' | 'expr-compile'` — read the current union at types.ts:59-66 and extend it)
- Test: `packages/format/tests/exprFormat.test.ts`

**Interfaces:**
- Consumes: `parse`, `compile`, `evaluate` from `@cgrid/expression` (already a dependency; see `tier1/resolver.ts:1-7` for the import idiom) and Task 3's builtins.
- Produces: any format string whose trimmed form starts with `=` compiles the remainder as an expression; `formatText` returns `String(result)` (`''` for null/undefined/throw). Eval context: `value` = the cell value (wins collisions), other identifiers = row fields. Tasks 6/7 rely on the `ƒ(x)`-detection convention `format.trimStart().startsWith('=')`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/format/tests/exprFormat.test.ts
import { describe, it, expect } from 'vitest';
import { compileFormat } from '../src/compile';

const program = (fmt: string) => {
  const r = compileFormat(fmt);
  if (!r.ok) throw new Error(r.error.message);
  return r.program;
};
const run = (fmt: string, value: unknown, row: Record<string, unknown> = {}): string =>
  program(fmt).formatText({ value, row, colId: 'c' });

describe('=expr value-formatter form', () => {
  it('formats via expression with value bound', () => {
    expect(run('=UPPER(value)', 'sample')).toBe('SAMPLE');
    expect(run('=value ? "Y" : "N"', true)).toBe('Y');
    expect(run('=(value >= 0 ? "+" : "") + FIXED(value * 10000, 1) + " bp"', 0.001234)).toBe('+12.3 bp');
  });
  it('value wins a row-field collision; other identifiers hit the row', () => {
    expect(run('=UPPER(value)', 'cell', { value: 'row' })).toBe('CELL');
    expect(run('=UPPER(ticker)', 'ignored', { ticker: 'ibm' })).toBe('IBM');
  });
  it('never throws at eval time', () => {
    expect(run('=FIXED(value, 1)', 'junk')).toBe('');       // builtin total-function path
    expect(run('=value / other', 5, { other: 0 })).toBe(''); // div-by-zero EvalError → ''
    expect(run('=UPPER(value)', null)).toBe('');
  });
  it('rejects a bad expression at compile time', () => {
    const r = compileFormat('=UPPER(');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('compile-format');
  });
  it('tier flags: tier0 only; style/icon null', () => {
    const p = program('=UPPER(value)');
    expect(p.tiers).toEqual({ tier0: true, tier1: false, tier2: false });
    expect(p.resolveStyle({ value: 'x', row: {}, colId: 'c' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/format && npx vitest run tests/exprFormat.test.ts`
Expected: FAIL — `=UPPER(value)` currently tokenizes as literals and renders literal text, not `SAMPLE`.

- [ ] **Step 3: Implement the branch in `compile.ts`**

Imports at top:
```ts
import { parse as parseExpr, compile as compileExpr, evaluate as evaluateExpr } from '@cgrid/expression';
```

Insert AFTER the tick branch (Task 1), BEFORE `tokenize`:

```ts
  // `=expr` value-formatter form (spec §3.3): the expression's stringified
  // result IS the formatted output. `value` is bound over the row so it
  // wins field collisions; eval NEVER throws out of formatText.
  const trimmed = source.trimStart();
  if (trimmed.startsWith('=')) {
    const parsed = parseExpr(trimmed.slice(1));
    if (!parsed.ok) {
      return {
        ok: false,
        error: { kind: 'compile-format', code: 'expr-parse', message: parsed.error.message, loc: parsed.error.loc },
      };
    }
    const compiled = compileExpr(parsed.ast);
    if (!compiled.ok) {
      return {
        ok: false,
        error: { kind: 'compile-format', code: 'expr-compile', message: compiled.error.message, loc: compiled.error.loc },
      };
    }
    const program: FormatProgram = {
      source,
      tiers: { tier0: true, tier1: false, tier2: false },
      formatText: (ctx: FormatEvalContext): string => {
        try {
          const out = evaluateExpr(compiled.compiled, { row: { ...ctx.row, value: ctx.value } });
          return out === null || out === undefined ? '' : String(out);
        } catch {
          return '';
        }
      },
      resolveStyle: (): StyleObj | null => null,
      resolveIcon: (): IconRef | null => null,
      resolveFragments: (): ResolvedFragment[] | null => null,
    };
    return { ok: true, program };
  }
```

In `types.ts`, extend the `CompileFormatError` `code` union with `'expr-parse' | 'expr-compile'` (keep existing members verbatim). If `parsed.error.loc`/`compiled.error.loc` types mismatch the error `loc` field, coerce with the same `Loc` shape used by the excel branch (:52).

- [ ] **Step 4: Verify green + full suite**

Run: `cd packages/format && npx vitest run && npx tsc --noEmit`
Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/compile.ts packages/format/src/types.ts packages/format/tests/exprFormat.test.ts
git commit -m "feat(format): =expr value-formatter form — safe expression-driven text output"
```

---

### Task 5: `editColumn(colId, { format: null })` removes the format

**Files:**
- Modify: `packages/calc/src/types.ts` (`ColumnEditPatch.format?: string` at :13 → `string | null`; same widening on the `overrides.format` doc line :67 is NOT wanted — templates never store null)
- Modify: `packages/calc/src/calcEngine.ts` (`editColumn` — compile guard at :348-353 + scalar-merge loop at :358-364)
- Test: `packages/calc/tests/` — append to the file covering `editColumn` (find it: `grep -rln "editColumn" packages/calc/tests`)

**Interfaces:**
- Produces: `editColumn(colId, { format: null })` deletes `format` from the column's own template (create-if-absent still applies; deleting from a fresh template is a harmless no-op edit). Task 9's `clearFormat()` calls this through the kernel's public `editColumn`.

- [ ] **Step 1: Write the failing test (append to the editColumn test file)**

```ts
  it('format: null removes the format from the own template', () => {
    const engine = makeEngine(); // use the file's existing engine/fixture helper
    engine.editColumn('px', { format: '#,##0.00' }, { now: 1 });
    expect(engine.resolvedPatchFor('px')?.format).toBe('#,##0.00');
    const res = engine.editColumn('px', { format: null }, { now: 2 });
    expect(res.ok).toBe(true);
    expect(engine.resolvedPatchFor('px')?.format).toBeUndefined();
  });
```

(Adapt the construction/assertion helpers to the file's local idiom — `makeEngine`/`resolvedPatchFor` names must match what the file already uses; the behavioral contract above is what matters.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/calc && npx vitest run <that test file>`
Expected: FAIL — today `compileFormat(null)` errors (`format-compile`) or `format: null` lands literally.

- [ ] **Step 3: Implement**

`types.ts:13`: `format?: string | null;` (patch side only).

`calcEngine.ts` — guard skips null:
```ts
    if (patch.format !== undefined && patch.format !== null) {
      const fmt = compileFormat(patch.format);
      ...
```
After the `EDITABLE_SCALAR_KEYS` merge loop (which will have set `target.format = null`), add the removal branch mirroring `cellIcon` (:376-378):
```ts
    // format — `null` → remove from the own template (parity with cellIcon).
    if (patch.format === null) delete target.format;
```

- [ ] **Step 4: Verify green + full suites**

Run: `cd packages/calc && npx vitest run && npx tsc --noEmit && cd ../kernel && npx vitest run && npx tsc --noEmit`
Expected: calc green; kernel suite green (editColumn is public API surface — `CGridApi.editColumn` type flows from calc's `ColumnEditPatch`).

- [ ] **Step 5: Commit**

```bash
git add packages/calc/src/types.ts packages/calc/src/calcEngine.ts packages/calc/tests
git commit -m "feat(calc): editColumn format:null removes the own-template format (cellIcon parity)"
```

---

### Task 6: Preset catalog — `packages/ext/src/toolbar/formatPresets.ts`

**Files:**
- Create: `packages/ext/src/toolbar/formatPresets.ts`
- Test: `packages/ext/tests/formatPresets.test.ts`

**Interfaces:**
- Consumes: `compileFormat` from `@cgrid/format` (round-trip test only — the module itself is pure data/logic, no imports beyond types).
- Produces (Tasks 7/8/9 rely on these exact names):

```ts
export type FormatDataType = 'number' | 'text' | 'date' | 'boolean';
export type FormatCategory = 'number' | 'currency' | 'percent' | 'negatives' | 'conditional' | 'date' | 'tick' | 'text' | 'boolean';
export interface FormatPreset { id: string; category: FormatCategory; label: string; hint?: string; format: string; sample?: unknown }
export const CATEGORY_LABELS: Record<FormatCategory, string>;
export function categoriesForDataType(dt: FormatDataType): FormatCategory[];
export function presetsForCategory(cat: FormatCategory): FormatPreset[];
export function presetsForDataType(dt: FormatDataType): FormatPreset[];
export function findPresetByFormat(format: string | undefined): FormatPreset | undefined; // trimmed string equality
export function defaultSampleValue(dt: FormatDataType): unknown;
export function filterPresets(presets: FormatPreset[], query: string): FormatPreset[];
export function codeText(format: string): string; // 'ƒ(x)' for =expr, 'denom 32'-style for TICK*, else the format itself
export function applyCurrencySymbol(draft: string, symbol: string): string;
export interface ExcelExample { label: string; format: string; sample: string }
export interface ExcelExampleSection { title: string; rows: ExcelExample[] }
export const EXCEL_EXAMPLES: ExcelExampleSection[];
export const CURRENCY_QUICK_INSERT: ReadonlyArray<{ label: string; symbol: string }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ext/tests/formatPresets.test.ts
import { describe, it, expect } from 'vitest';
import { compileFormat } from '@cgrid/format';
import {
  CATEGORY_LABELS, CURRENCY_QUICK_INSERT, EXCEL_EXAMPLES,
  applyCurrencySymbol, categoriesForDataType, codeText, defaultSampleValue,
  filterPresets, findPresetByFormat, presetsForCategory, presetsForDataType,
} from '../src/toolbar/formatPresets';

describe('categories', () => {
  it('maps data types to ordered category rails', () => {
    expect(categoriesForDataType('number')).toEqual(['number', 'negatives', 'conditional', 'tick', 'percent']);
    expect(categoriesForDataType('date')).toEqual(['date']);
    expect(categoriesForDataType('text')).toEqual(['text']);
    expect(categoriesForDataType('boolean')).toEqual(['boolean', 'text']);
  });
  it('labels match the reference UI', () => {
    expect(CATEGORY_LABELS.negatives).toBe('Negatives & P&L');
    expect(CATEGORY_LABELS.date).toBe('Date & time');
  });
  it('category sizes match the reference counts', () => {
    expect(presetsForCategory('number')).toHaveLength(6);
    expect(presetsForCategory('negatives')).toHaveLength(5);
    expect(presetsForCategory('conditional')).toHaveLength(2);
    expect(presetsForCategory('tick')).toHaveLength(5);
    expect(presetsForCategory('percent')).toHaveLength(3);
    expect(presetsForCategory('date')).toHaveLength(6);
    expect(presetsForCategory('text')).toHaveLength(9);
    expect(presetsForCategory('boolean')).toHaveLength(3);
    expect(presetsForCategory('currency')).toHaveLength(12);
  });
});

describe('every preset compiles and renders its reference sample', () => {
  const all = (['number', 'text', 'date', 'boolean'] as const).flatMap(presetsForDataType);
  it('compiles', () => {
    for (const p of all) {
      const r = compileFormat(p.format);
      expect(r.ok, `${p.id}: ${p.format}`).toBe(true);
    }
  });
  const dtFor = (p: (typeof all)[number]) =>
    p.category === 'date' ? 'date' : p.category === 'text' ? 'text' : p.category === 'boolean' ? 'boolean' : 'number';
  const spot = (id: string, expected: string) => {
    const p = all.find((x) => x.id === id)!;
    const r = compileFormat(p.format);
    if (!r.ok) throw new Error(p.id);
    const value = p.sample ?? defaultSampleValue(dtFor(p));
    expect(r.program.formatText({ value, row: { value }, colId: 'c' })).toBe(expected);
  };
  it('spot-checks screenshot samples', () => {
    spot('num-integer', '1,235');
    spot('num-2dp', '1,234.57');
    spot('num-sci', '1.23E+03');
    spot('num-bps', '+12.3 bp');
    spot('tick-32', '101-16');
    spot('tick-32-plus', '101-16+');
    spot('pct-2', '12.34%');
    spot('str-upper', 'SAMPLE');
    spot('str-prefix-px', 'PX sample');
    spot('date-iso', '2026-04-17');
    spot('bool-yn', 'Y');
  });
});

describe('lookup + search + codeText', () => {
  it('findPresetByFormat trims and matches', () => {
    expect(findPresetByFormat(' #,##0 ')?.id).toBe('num-integer');
    expect(findPresetByFormat('#,##0.0000000')).toBeUndefined();
    expect(findPresetByFormat(undefined)).toBeUndefined();
  });
  it('filterPresets: empty query → [], substring across label/hint/format', () => {
    const presets = presetsForDataType('number');
    expect(filterPresets(presets, '  ')).toEqual([]);
    expect(filterPresets(presets, 'parens').every((p) => p.category === 'negatives')).toBe(true);
    expect(filterPresets(presets, 'TICK64')).toHaveLength(1);
  });
  it('codeText marks ƒ(x) and tick forms', () => {
    expect(codeText('=UPPER(value)')).toBe('ƒ(x)');
    expect(codeText('TICK32+')).toBe('denom 32+');
    expect(codeText('TICK128')).toBe('denom 128');
    expect(codeText('#,##0')).toBe('#,##0');
  });
});

describe('applyCurrencySymbol', () => {
  it('seeds an empty draft', () => {
    expect(applyCurrencySymbol('', '$')).toBe('$#,##0.00');
    expect(applyCurrencySymbol('', '"£"')).toBe('"£"#,##0.00');
  });
  it('replaces an existing symbol in every section', () => {
    expect(applyCurrencySymbol('$#,##0.00;($#,##0.00)', '€')).toBe('€#,##0.00;(€#,##0.00)');
    expect(applyCurrencySymbol('"£"#,##0.00', '$')).toBe('$#,##0.00');
  });
  it('prepends when no symbol present', () => {
    expect(applyCurrencySymbol('#,##0.00', '"CHF "')).toBe('"CHF "#,##0.00');
  });
  it('quick-insert entries carry the quoted forms', () => {
    expect(CURRENCY_QUICK_INSERT.map((c) => c.label)).toEqual(['$', '€', '£', '¥', '₹', 'CHF']);
    expect(CURRENCY_QUICK_INSERT.find((c) => c.label === 'CHF')!.symbol).toBe('"CHF "');
  });
});

describe('excel reference data', () => {
  it('has the 8 reference sections with tick sentinels', () => {
    expect(EXCEL_EXAMPLES.map((s) => s.title)).toEqual([
      'Numbers & decimals', 'Currency', 'Percent & basis points',
      'Negatives in parens / red', 'Dates & times', 'Conditional (directional)',
      'Fixed-income tick (via preset dropdown)', 'Scientific & custom text',
    ]);
    const tick = EXCEL_EXAMPLES.find((s) => s.title.startsWith('Fixed-income'))!;
    expect(tick.rows.every((r) => r.format.startsWith('—'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ext && npx vitest run tests/formatPresets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `formatPresets.ts`**

```ts
/**
 * Format-picker catalog — pure data + logic (no DOM). Ported from starui's
 * FormatterPicker and recast so EVERY preset is a plain @cgrid/format DSL
 * string: excel sections, TICK* tokens (Task 1), 0.00E+00 (Task 2), and
 * `=expr` value formatters (Tasks 3-4). Sidebar counts are full category
 * sizes (reference behavior), independent of the active data type.
 */
export type FormatDataType = 'number' | 'text' | 'date' | 'boolean';
export type FormatCategory =
  | 'number' | 'currency' | 'percent' | 'negatives' | 'conditional'
  | 'date' | 'tick' | 'text' | 'boolean';

export interface FormatPreset {
  id: string;
  category: FormatCategory;
  label: string;
  hint?: string;
  format: string;
  sample?: unknown;
}

export const CATEGORY_LABELS: Record<FormatCategory, string> = {
  number: 'Number', currency: 'Currency', percent: 'Percent',
  negatives: 'Negatives & P&L', conditional: 'Conditional',
  date: 'Date & time', tick: 'Tick', text: 'Text', boolean: 'Boolean',
};

export function categoriesForDataType(dt: FormatDataType): FormatCategory[] {
  switch (dt) {
    case 'number': return ['number', 'negatives', 'conditional', 'tick', 'percent'];
    case 'date': return ['date'];
    case 'text': return ['text'];
    case 'boolean': return ['boolean', 'text'];
    default: return ['number'];
  }
}

const PRESETS: FormatPreset[] = [
  // ── Number (6)
  { id: 'num-integer', category: 'number', label: 'Integer', format: '#,##0' },
  { id: 'num-2dp', category: 'number', label: '2 decimals', format: '#,##0.00' },
  { id: 'num-4dp', category: 'number', label: '4 decimals', format: '#,##0.0000' },
  { id: 'num-plain', category: 'number', label: 'No thousands', format: '0.00' },
  { id: 'num-sci', category: 'number', label: 'Scientific', format: '0.00E+00' },
  { id: 'num-bps', category: 'number', label: 'Basis points', hint: '+12.3 bp',
    format: '=(value >= 0 ? "+" : "") + FIXED(value * 10000, 1) + " bp"', sample: 0.001234 },
  // ── Negatives & P&L (5)
  { id: 'neg-parens', category: 'negatives', label: 'Parens negative', format: '#,##0.00;(#,##0.00)' },
  { id: 'neg-red-parens', category: 'negatives', label: 'Red parens neg', format: '#,##0.00;[Red](#,##0.00)' },
  { id: 'neg-red', category: 'negatives', label: 'Red negative', format: '#,##0.00;[Red]#,##0.00' },
  { id: 'neg-green-red', category: 'negatives', label: 'Green / Red (no sign)', format: '[Green]#,##0.00;[Red]#,##0.00' },
  { id: 'neg-green-red-usd', category: 'negatives', label: 'Green / Red $ (no sign)', format: '[Green]$#,##0.00;[Red]$#,##0.00' },
  // ── Conditional (2)
  { id: 'cond-arrows', category: 'conditional', label: 'Green up / red down',
    format: '[>0][Green]▲0.00;[<0][Red]▼0.00;0.00', sample: -12.5 },
  { id: 'cond-thresholds', category: 'conditional', label: 'Thresholds (100)',
    format: '[>100][Red]0;[<=100][Green]0;0', sample: 142 },
  // ── Tick (5)
  { id: 'tick-32', category: 'tick', label: '32nds (bond price)', hint: 'denom 32', format: 'TICK32', sample: 101.5 },
  { id: 'tick-32-plus', category: 'tick', label: '32nds + halves', hint: 'denom 32+', format: 'TICK32+', sample: 101.515625 },
  { id: 'tick-64', category: 'tick', label: '64ths', hint: 'denom 64', format: 'TICK64', sample: 101.515625 },
  { id: 'tick-128', category: 'tick', label: '128ths', hint: 'denom 128', format: 'TICK128', sample: 101.5078125 },
  { id: 'tick-256', category: 'tick', label: '256ths', hint: 'denom 256', format: 'TICK256', sample: 101.50390625 },
  // ── Percent (3)
  { id: 'pct-0', category: 'percent', label: 'Percent (0dp)', format: '0%', sample: 0.12 },
  { id: 'pct-2', category: 'percent', label: 'Percent (2dp)', format: '0.00%', sample: 0.1234 },
  { id: 'pct-bps', category: 'percent', label: 'Basis points', hint: '+12.3 bp',
    format: '=(value >= 0 ? "+" : "") + FIXED(value * 10000, 1) + " bp"', sample: 0.001234 },
  // ── Currency (12)
  { id: 'cur-usd', category: 'currency', label: 'USD', format: '$#,##0.00' },
  { id: 'cur-usd-parens', category: 'currency', label: 'USD parens neg', format: '$#,##0.00;($#,##0.00)' },
  { id: 'cur-usd-red', category: 'currency', label: 'USD red negative', format: '$#,##0.00;[Red]-$#,##0.00' },
  { id: 'cur-usd-0dp', category: 'currency', label: 'USD (0dp)', format: '$#,##0' },
  { id: 'cur-eur', category: 'currency', label: 'EUR', format: '€#,##0.00' },
  { id: 'cur-eur-parens', category: 'currency', label: 'EUR parens neg', format: '€#,##0.00;(€#,##0.00)' },
  { id: 'cur-gbp', category: 'currency', label: 'GBP', format: '"£"#,##0.00' },
  { id: 'cur-gbp-parens', category: 'currency', label: 'GBP parens neg', format: '"£"#,##0.00;("£"#,##0.00)' },
  { id: 'cur-jpy', category: 'currency', label: 'JPY (0dp)', format: '"¥"#,##0' },
  { id: 'cur-inr', category: 'currency', label: 'INR', format: '"₹"#,##0.00' },
  { id: 'cur-chf', category: 'currency', label: 'CHF', format: '"CHF "#,##0.00' },
  { id: 'cur-chf-parens', category: 'currency', label: 'CHF parens neg', format: '"CHF "#,##0.00;("CHF "#,##0.00)' },
  // ── Date & time (6)
  { id: 'date-iso', category: 'date', label: 'ISO (yyyy-mm-dd)', format: 'yyyy-mm-dd' },
  { id: 'date-us', category: 'date', label: 'US (mm/dd/yyyy)', format: 'mm/dd/yyyy' },
  { id: 'date-eu', category: 'date', label: 'EU (dd-mmm-yy)', format: 'dd-mmm-yy' },
  { id: 'date-long', category: 'date', label: 'Long', format: 'dd mmmm yyyy' },
  { id: 'date-iso-time', category: 'date', label: 'ISO with time', format: 'yyyy-mm-dd hh:nn:ss' },
  { id: 'date-us-short', category: 'date', label: 'US short', format: 'mm/dd/yy h:nn AM/PM' },
  // ── Text (9)
  { id: 'str-default', category: 'text', label: 'Default (pass-through)', format: '@' },
  { id: 'str-upper', category: 'text', label: 'UPPERCASE', format: '=UPPER(value)' },
  { id: 'str-lower', category: 'text', label: 'lowercase', format: '=LOWER(value)' },
  { id: 'str-title', category: 'text', label: 'Title Case', format: '=TITLE(value)' },
  { id: 'str-camel', category: 'text', label: 'camelCase', format: '=CAMEL(value)' },
  { id: 'str-cap', category: 'text', label: 'Capitalize first', format: '=CAP(value)' },
  { id: 'str-trim', category: 'text', label: 'Trim whitespace', format: '=TRIM(value)', sample: '  sample  ' },
  { id: 'str-prefix-px', category: 'text', label: 'Prefix: PX', format: '"PX "@' },
  { id: 'str-suffix-units', category: 'text', label: 'Suffix: units', format: '@" units"' },
  // ── Boolean (3)
  { id: 'bool-yn', category: 'boolean', label: 'Y / N', format: '=value ? "Y" : "N"', sample: true },
  { id: 'bool-truefalse', category: 'boolean', label: 'True / False', format: '=value ? "True" : "False"', sample: true },
  { id: 'bool-check', category: 'boolean', label: 'Check / —', format: '=value ? "✓" : "—"', sample: true },
];

export function presetsForCategory(cat: FormatCategory): FormatPreset[] {
  return PRESETS.filter((p) => p.category === cat);
}
export function presetsForDataType(dt: FormatDataType): FormatPreset[] {
  return categoriesForDataType(dt).flatMap(presetsForCategory);
}
export function findPresetByFormat(format: string | undefined): FormatPreset | undefined {
  if (format === undefined) return undefined;
  const f = format.trim();
  return PRESETS.find((p) => p.format === f);
}

export function defaultSampleValue(dt: FormatDataType): unknown {
  switch (dt) {
    case 'date': return new Date('2026-04-17T09:30:00Z');
    case 'text': return 'sample';
    case 'boolean': return true;
    default: return 1234.5678;
  }
}

export function filterPresets(presets: FormatPreset[], query: string): FormatPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return presets.filter((p) =>
    `${p.label} ${p.hint ?? ''} ${p.format}`.toLowerCase().includes(q));
}

export function codeText(format: string): string {
  if (format.trimStart().startsWith('=')) return 'ƒ(x)';
  const tick = /^TICK(32\+?|64|128|256)$/.exec(format.trim());
  if (tick) return `denom ${tick[1]}`;
  return format;
}

export const CURRENCY_QUICK_INSERT: ReadonlyArray<{ label: string; symbol: string }> = [
  { label: '$', symbol: '$' },
  { label: '€', symbol: '€' },
  { label: '£', symbol: '"£"' },
  { label: '¥', symbol: '"¥"' },
  { label: '₹', symbol: '"₹"' },
  { label: 'CHF', symbol: '"CHF "' },
];

const CURRENCY_SYMBOL_RE = /("£"|"¥"|"₹"|"[A-Z]{3} ?"|[$€])/g;

export function applyCurrencySymbol(draft: string, symbol: string): string {
  const d = draft.trim();
  if (!d) return `${symbol}#,##0.00`;
  if (CURRENCY_SYMBOL_RE.test(d)) {
    CURRENCY_SYMBOL_RE.lastIndex = 0;
    return d.replace(CURRENCY_SYMBOL_RE, symbol);
  }
  return `${symbol}${d}`;
}

export interface ExcelExample { label: string; format: string; sample: string }
export interface ExcelExampleSection { title: string; rows: ExcelExample[] }

/** Static reference rows — samples are decorative strings, never evaluated.
 *  Tick rows are sentinels (format starts with `—`): informational only,
 *  pointing at the Tick category presets. */
export const EXCEL_EXAMPLES: ExcelExampleSection[] = [
  { title: 'Numbers & decimals', rows: [
    { label: 'Integer w/ thousands', format: '#,##0', sample: '1,235' },
    { label: '2 decimals', format: '#,##0.00', sample: '1,234.57' },
    { label: '4 decimals', format: '#,##0.0000', sample: '1,234.5678' },
    { label: 'No thousands', format: '0.00', sample: '1234.57' },
  ] },
  { title: 'Currency', rows: [
    { label: 'USD', format: '$#,##0.00', sample: '$1,234.57' },
    { label: 'USD parens neg', format: '$#,##0.00;($#,##0.00)', sample: '($1,234.57)' },
    { label: 'USD red negative', format: '$#,##0.00;[Red]-$#,##0.00', sample: '-$1,234.57 (red)' },
    { label: 'EUR', format: '€#,##0.00', sample: '€1,234.57' },
  ] },
  { title: 'Percent & basis points', rows: [
    { label: 'Percent', format: '0.00%', sample: '12.34%' },
    { label: 'Percent (0dp)', format: '0%', sample: '12%' },
    { label: 'Basis points', format: '0.00 "bps"', sample: '12.34 bps' },
  ] },
  { title: 'Negatives in parens / red', rows: [
    { label: 'Parens negative', format: '#,##0.00;(#,##0.00)', sample: '(1,234.57)' },
    { label: 'Red parens', format: '#,##0.00;[Red](#,##0.00)', sample: '(1,234.57)' },
    { label: 'Red only', format: '#,##0.00;[Red]#,##0.00', sample: '[Red]1,234.57' },
    { label: 'Green / Red (no sign)', format: '[Green]#,##0.00;[Red]#,##0.00', sample: '[Green]1,234.57 · [Red]1,234.57' },
    { label: 'Green / Red $ (no sign)', format: '[Green]$#,##0.00;[Red]$#,##0.00', sample: '[Green]$1,234.57 · [Red]$1,234.57' },
    { label: 'Zero as dash', format: '#,##0.00;(#,##0.00);"—"', sample: '—' },
  ] },
  { title: 'Dates & times', rows: [
    { label: 'ISO date', format: 'yyyy-mm-dd', sample: '2026-04-17' },
    { label: 'US date', format: 'mm/dd/yyyy', sample: '04/17/2026' },
    { label: 'Euro short', format: 'dd-mmm-yy', sample: '17-Apr-26' },
    { label: 'ISO with time', format: 'yyyy-mm-dd hh:nn:ss', sample: '2026-04-17 09:30:00' },
    { label: 'US with AM/PM', format: 'mm/dd/yy h:nn AM/PM', sample: '04/17/26 9:30 AM' },
  ] },
  { title: 'Conditional (directional)', rows: [
    { label: 'Green up / red down', format: '[>0][Green]▲0.00;[<0][Red]▼0.00;0.00', sample: '▲ green, ▼ red, neutral' },
    { label: 'Thresholds', format: '[>100][Red]0;[<=100][Green]0;0', sample: 'red >100, green ≤100' },
  ] },
  { title: 'Fixed-income tick (via preset dropdown)', rows: [
    { label: '32nds', format: '— use "32nds" preset —', sample: '101-16' },
    { label: '32nds + halves', format: '— use "32nds + halves" preset —', sample: '101-16+' },
    { label: '64ths', format: '— use "64ths" preset —', sample: '101-164' },
    { label: '128ths', format: '— use "128ths" preset —', sample: '101-162' },
  ] },
  { title: 'Scientific & custom text', rows: [
    { label: 'Scientific', format: '0.00E+00', sample: '1.23E+03' },
    { label: 'Suffix text', format: '@" units"', sample: 'value units' },
    { label: 'Prefix text', format: '"PX "@', sample: 'PX value' },
  ] },
];
```

**Date/time note:** the cgrid evaluator's unambiguous-minutes token is `nn` (evaluator.ts:259), and `mm` inside a time context is only treated as minutes under its ambiguity heuristic — the catalog uses `hh:nn:ss` / `h:nn` to be deterministic. The reference rows display the same strings. If the spot-check test shows `date-iso-time` rendering differently from `2026-04-17 09:30:00`, fix the FORMAT (not the test) — the sample is the contract.

- [ ] **Step 4: Run to verify green**

Run: `cd packages/ext && npx vitest run tests/formatPresets.test.ts && npx tsc --noEmit`
Expected: all pass — this is also the spec §3.4 round-trip gate (every preset compiles through the real `@cgrid/format`).

- [ ] **Step 5: Commit**

```bash
git add packages/ext/src/toolbar/formatPresets.ts packages/ext/tests/formatPresets.test.ts
git commit -m "feat(ext): format preset catalog — 51 DSL-string presets, categories, search, quick-insert, excel reference"
```

---

### Task 7: Picker panel — trigger contract, CURRENT row, search, sidebar, preset rows

**Files:**
- Create: `packages/ext/src/toolbar/formatPicker.ts`
- Create: `packages/ext/tests/formatPickerHarness.ts`
- Test: `packages/ext/tests/formatPicker.test.ts`

**Interfaces:**
- Consumes: `menu`, `svg` from `./ui`; Task 6's catalog; `compileFormat` from `@cgrid/format`.
- Produces (Task 8 extends the same panel; Task 9 wires it):

```ts
export interface FormatPickerHost {
  targetCols(): string[];
  currentFormat(): string | undefined;
  applyFormat(format: string): void;
  clearFormat(): void;
  dataType(): FormatDataType;
}
export function formatPickerMenu(anchor: HTMLElement, host: FormatPickerHost):
  { toggle(): void; destroy(): void };
export function previewFormat(format: string, sample: unknown): string; // '·' on compile/run failure
export function injectFormatPickerStyles(): void;
```

DOM contract (tests + Task 8 + E2E): panel root `.cgext-menu.cgext-fmt` (width 440); CURRENT row `.cgext-fmt-current` with `.cgext-fmt-current-chip` and `.cgext-fmt-clear`; search `.cgext-fmt-search input`; sidebar `.cgext-fmt-tabs` with `.cgext-fmt-tab[data-cat]` (+ `.cgext-fmt-count`) and `.cgext-fmt-tab[data-cat="__custom__"]`; body `.cgext-fmt-body`; preset rows `.cgext-fmt-row[data-preset-id]` (left `.cgext-fmt-row-label` + `.cgext-fmt-row-code`, right `.cgext-fmt-row-preview`); empty state `.cgext-fmt-empty`.

Behavior: preset row click → `host.applyFormat(preset.format)` + close (selection = dismissal, layouts-panel precedent). CURRENT chip shows `previewFormat(current, defaultSampleValue(dataType))` or `—`; clear button → `host.clearFormat()`, stays open, re-renders. Active row = `preset.format === current?.trim()`. Search input flips the body to a flat filtered list across `presetsForDataType(dataType)`; blank restores tabs. Initial tab = active preset's category, else first category; when a current format matches no preset, initial tab = `__custom__` (Task 8 renders its content; until then the custom tab body may be an empty `.cgext-fmt-custom` container). Escape closes. No target columns → panel renders a single `.cgext-fmt-empty` hint "Select a cell or column first".

- [ ] **Step 1: Write the harness**

```ts
// packages/ext/tests/formatPickerHarness.ts
import { vi } from 'vitest';
import type { FormatPickerHost } from '../src/toolbar/formatPicker';
import type { FormatDataType } from '../src/toolbar/formatPresets';

export class FakeFormatHost implements FormatPickerHost {
  cols: string[] = ['px'];
  format: string | undefined = undefined;
  dt: FormatDataType = 'number';
  targetCols(): string[] { return this.cols; }
  currentFormat(): string | undefined { return this.format; }
  dataType(): FormatDataType { return this.dt; }
  applyFormat = vi.fn((f: string) => { this.format = f; });
  clearFormat = vi.fn(() => { this.format = undefined; });
}

export function mountPicker(host = new FakeFormatHost()) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  // Deferred import so tests stub before module init if ever needed.
  const { formatPickerMenu } = require('../src/toolbar/formatPicker') as typeof import('../src/toolbar/formatPicker');
  const m = formatPickerMenu(anchor, host);
  m.toggle();
  const panel = document.querySelector<HTMLElement>('.cgext-menu.cgext-fmt')!;
  return { anchor, host, m, panel };
}
```

(If `require` trips the ESM config, switch to a top-level `import { formatPickerMenu } …` — the deferred form is a convenience, not a requirement.)

- [ ] **Step 2: Write the failing tests**

```ts
// packages/ext/tests/formatPicker.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { previewFormat } from '../src/toolbar/formatPicker';
import { FakeFormatHost, mountPicker } from './formatPickerHarness';

afterEach(() => { document.body.replaceChildren(); });

describe('previewFormat', () => {
  it('renders through the real compiler and degrades to · on failure', () => {
    expect(previewFormat('#,##0', 1234.5678)).toBe('1,235');
    expect(previewFormat('TICK32', 101.5)).toBe('101-16');
    expect(previewFormat('=UPPER(', 'x')).toBe('·');
  });
});

describe('panel anatomy', () => {
  it('renders sidebar tabs with counts for the data type + the custom tab', () => {
    const { panel } = mountPicker();
    const cats = [...panel.querySelectorAll<HTMLElement>('.cgext-fmt-tab')].map((t) => t.dataset.cat);
    expect(cats).toEqual(['number', 'negatives', 'conditional', 'tick', 'percent', '__custom__']);
    expect(panel.querySelector('.cgext-fmt-tab[data-cat="number"] .cgext-fmt-count')!.textContent).toBe('6');
    expect(panel.querySelector('.cgext-fmt-tab[data-cat="__custom__"] .cgext-fmt-count')).toBeNull();
  });
  it('date columns get the date rail', () => {
    const host = new FakeFormatHost();
    host.dt = 'date';
    const { panel } = mountPicker(host);
    const cats = [...panel.querySelectorAll<HTMLElement>('.cgext-fmt-tab')].map((t) => t.dataset.cat);
    expect(cats).toEqual(['date', '__custom__']);
  });
  it('shows rows for the active tab with label, code, live preview', () => {
    const { panel } = mountPicker();
    const row = panel.querySelector<HTMLElement>('.cgext-fmt-row[data-preset-id="num-integer"]')!;
    expect(row.querySelector('.cgext-fmt-row-label')!.textContent).toBe('Integer');
    expect(row.querySelector('.cgext-fmt-row-code')!.textContent).toBe('#,##0');
    expect(row.querySelector('.cgext-fmt-row-preview')!.textContent).toBe('1,235');
  });
  it('ƒ(x) code text for expression presets', () => {
    const { panel } = mountPicker();
    // Basis points is on the number tab
    const row = panel.querySelector<HTMLElement>('.cgext-fmt-row[data-preset-id="num-bps"]')!;
    expect(row.querySelector('.cgext-fmt-row-code')!.textContent).toBe('ƒ(x)');
    expect(row.querySelector('.cgext-fmt-row-preview')!.textContent).toBe('+12.3 bp');
  });
  it('no target columns → disabled hint', () => {
    const host = new FakeFormatHost();
    host.cols = [];
    const { panel } = mountPicker(host);
    expect(panel.querySelector('.cgext-fmt-empty')!.textContent).toContain('Select a cell or column');
    expect(panel.querySelector('.cgext-fmt-row')).toBeNull();
  });
});

describe('apply / current / clear', () => {
  it('row click applies the preset format and closes', () => {
    const { panel, host } = mountPicker();
    panel.querySelector<HTMLElement>('.cgext-fmt-row[data-preset-id="num-2dp"]')!.click();
    expect(host.applyFormat).toHaveBeenCalledWith('#,##0.00');
    expect(document.querySelector('.cgext-menu.cgext-fmt')).toBeNull();
  });
  it('CURRENT chip previews the current format; active row highlighted; clear stays open', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0';
    const { panel } = mountPicker(host);
    expect(panel.querySelector('.cgext-fmt-current-chip')!.textContent).toBe('1,235');
    expect(panel.querySelector('.cgext-fmt-row[data-preset-id="num-integer"]')!.classList.contains('is-active')).toBe(true);
    const clear = panel.querySelector<HTMLButtonElement>('.cgext-fmt-clear')!;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(host.clearFormat).toHaveBeenCalled();
    expect(document.querySelector('.cgext-menu.cgext-fmt')).not.toBeNull(); // stays open
    expect(panel.querySelector('.cgext-fmt-current-chip')!.textContent).toBe('—');
  });
  it('clear is disabled with no current format', () => {
    const { panel } = mountPicker();
    expect(panel.querySelector<HTMLButtonElement>('.cgext-fmt-clear')!.disabled).toBe(true);
  });
});

describe('search', () => {
  const type = (panel: HTMLElement, text: string) => {
    const input = panel.querySelector<HTMLInputElement>('.cgext-fmt-search input')!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  it('non-blank query flips to a flat result list; blank restores tabs', () => {
    const { panel } = mountPicker();
    type(panel, 'parens');
    expect(panel.querySelector('.cgext-fmt-tabs')).toBeNull();
    expect(panel.querySelectorAll('.cgext-fmt-row').length).toBeGreaterThan(0);
    type(panel, '');
    expect(panel.querySelector('.cgext-fmt-tabs')).not.toBeNull();
  });
  it('zero matches show the empty-state hint', () => {
    const { panel } = mountPicker();
    type(panel, 'zzzznope');
    expect(panel.querySelector('.cgext-fmt-empty')!.textContent).toContain('No formats match');
  });
});

describe('lifecycle', () => {
  it('Escape closes; destroy cleans up', () => {
    const { panel, m } = mountPicker();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.cgext-menu.cgext-fmt')).toBeNull();
    m.destroy(); // second destroy must not throw
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/ext && npx vitest run tests/formatPicker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `formatPicker.ts`**

```ts
/**
 * Format picker — the ribbon `# Format` pill's dropdown. Plain DOM, all
 * state re-derived from the host closures on every open/re-render; the
 * panel owns only its transient query/draft strings. Selection is a
 * dismissal gesture (apply + close), matching the layouts panel; Clear
 * and the Custom tab's quick-inserts keep the panel open.
 */
import { menu, svg } from './ui';
import { compileFormat } from '@cgrid/format';
import {
  CATEGORY_LABELS, CURRENCY_QUICK_INSERT, EXCEL_EXAMPLES,
  applyCurrencySymbol, categoriesForDataType, codeText, defaultSampleValue,
  filterPresets, findPresetByFormat, presetsForCategory, presetsForDataType,
  type FormatDataType, type FormatPreset,
} from './formatPresets';

export interface FormatPickerHost {
  targetCols(): string[];
  currentFormat(): string | undefined;
  applyFormat(format: string): void;
  clearFormat(): void;
  dataType(): FormatDataType;
}

const CUSTOM_TAB = '__custom__';

const I = {
  search: 'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
};

/** Compile + run `format` against `sample`; `·` when anything fails. */
export function previewFormat(format: string, sample: unknown): string {
  try {
    const r = compileFormat(format);
    if (!r.ok) return '·';
    const text = r.program.formatText({ value: sample, row: { value: sample }, colId: '__preview' });
    return text === '' ? '·' : text;
  } catch { return '·'; }
}

export function formatPickerMenu(
  anchor: HTMLElement,
  host: FormatPickerHost,
): { toggle(): void; destroy(): void } {
  injectFormatPickerStyles();
  return menu(anchor, (close) => buildPanel(host, close));
}

function buildPanel(host: FormatPickerHost, close: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cgext-fmt';
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  if (host.targetCols().length === 0) {
    el.innerHTML = `<div class="cgext-fmt-empty">Select a cell or column first.</div>`;
    return el;
  }

  const dataType = host.dataType();
  const sample = defaultSampleValue(dataType);
  const categories = categoriesForDataType(dataType);
  let query = '';
  const current = () => host.currentFormat()?.trim();
  const activePreset = () => findPresetByFormat(current());
  let tab: string = activePreset()?.category
    ?? (current() !== undefined ? CUSTOM_TAB : categories[0] ?? CUSTOM_TAB);

  el.innerHTML =
    `<div class="cgext-fmt-current">` +
      `<span class="cgext-fmt-caps">CURRENT</span>` +
      `<span class="cgext-fmt-current-chip"></span>` +
      `<button type="button" class="cgext-fmt-clear" title="Clear format">${svg(I.x, 14)}</button>` +
    `</div>` +
    `<div class="cgext-fmt-search">${svg(I.search, 14)}<input type="search" placeholder="Search formats…" aria-label="Search formats" /></div>` +
    `<div class="cgext-fmt-main"></div>`;
  const chipEl = el.querySelector<HTMLElement>('.cgext-fmt-current-chip')!;
  const clearBtn = el.querySelector<HTMLButtonElement>('.cgext-fmt-clear')!;
  const mainEl = el.querySelector<HTMLElement>('.cgext-fmt-main')!;
  const searchInput = el.querySelector<HTMLInputElement>('.cgext-fmt-search input')!;

  const renderCurrent = () => {
    const cur = current();
    chipEl.textContent = cur === undefined ? '—' : previewFormat(cur, activePreset()?.sample ?? sample);
    chipEl.title = cur === undefined ? 'No format applied' : cur;
    chipEl.classList.toggle('has-format', cur !== undefined);
    clearBtn.disabled = cur === undefined;
  };

  const presetRow = (p: FormatPreset): HTMLElement => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cgext-fmt-row' + (p.format === current() ? ' is-active' : '');
    row.dataset.presetId = p.id;
    const preview = previewFormat(p.format, p.sample ?? sample);
    row.innerHTML =
      `<span class="cgext-fmt-row-main"><span class="cgext-fmt-row-label"></span><span class="cgext-fmt-row-code"></span></span>` +
      `<span class="cgext-fmt-row-preview"></span>`;
    row.querySelector('.cgext-fmt-row-label')!.textContent = p.label;
    row.querySelector('.cgext-fmt-row-code')!.textContent = codeText(p.format);
    row.querySelector('.cgext-fmt-row-preview')!.textContent = preview;
    row.title = `${p.label} · ${preview}`;
    row.addEventListener('click', () => { host.applyFormat(p.format); close(); });
    return row;
  };

  const renderMain = () => {
    mainEl.replaceChildren();
    if (query.trim()) {
      const results = filterPresets(presetsForDataType(dataType), query);
      const list = document.createElement('div');
      list.className = 'cgext-fmt-list';
      if (results.length === 0) {
        list.innerHTML = `<div class="cgext-fmt-empty"></div>`;
        list.querySelector('.cgext-fmt-empty')!.textContent =
          `No formats match "${query.trim()}". Try the Custom tab.`;
      } else {
        list.append(...results.map(presetRow));
      }
      mainEl.appendChild(list);
      return;
    }
    const tabs = document.createElement('div');
    tabs.className = 'cgext-fmt-tabs';
    const tabBtn = (cat: string, label: string, count: number | null) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgext-fmt-tab' + (tab === cat ? ' is-active' : '');
      b.dataset.cat = cat;
      b.innerHTML = `<span></span>` +
        (count === null ? svg(I.hash, 13) : `<span class="cgext-fmt-count">${count}</span>`);
      b.querySelector('span')!.textContent = label;
      b.addEventListener('click', () => { tab = cat; renderMain(); });
      tabs.appendChild(b);
    };
    for (const c of categories) tabBtn(c, CATEGORY_LABELS[c], presetsForCategory(c).length);
    tabBtn(CUSTOM_TAB, 'Custom', null);

    const body = document.createElement('div');
    body.className = 'cgext-fmt-body';
    if (tab === CUSTOM_TAB) {
      body.appendChild(buildCustomTab(host, dataType, { current, renderCurrent, renderMain, close }));
    } else {
      const list = document.createElement('div');
      list.className = 'cgext-fmt-list';
      list.append(...presetsForCategory(tab as never).map(presetRow));
      body.appendChild(list);
    }
    mainEl.append(tabs, body);
  };

  clearBtn.addEventListener('click', () => { host.clearFormat(); renderCurrent(); renderMain(); });
  searchInput.addEventListener('input', () => { query = searchInput.value; renderMain(); });
  searchInput.addEventListener('keydown', (e) => e.stopPropagation());

  renderCurrent();
  renderMain();
  return el;
}

// Task 8 replaces this stub with the full Custom tab (symbol quick-insert,
// validated input, excel reference). Kept minimal so Task 7 ships runnable.
function buildCustomTab(
  _host: FormatPickerHost,
  _dataType: FormatDataType,
  _ctx: { current(): string | undefined; renderCurrent(): void; renderMain(): void; close(): void },
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cgext-fmt-custom';
  return wrap;
}

export function injectFormatPickerStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-fmt-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-fmt-styles';
  style.textContent = FMT_CSS;
  document.head.appendChild(style);
}

const FMT_CSS = `
.cgext-menu.cgext-fmt { width: 440px; padding: 10px 12px 12px; }
.cgext-fmt-caps { font-size: 11px; font-weight: 650; letter-spacing: 0.08em; color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-fmt-current { display: flex; align-items: center; gap: 10px; padding-bottom: 8px; }
.cgext-fmt-current-chip {
  flex: 1 1 auto; min-width: 0; height: 26px; display: inline-flex; align-items: center;
  padding: 0 10px; border: 1px dashed var(--cg-border-color, #2a3140); border-radius: 6px;
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 12px;
  color: var(--cg-muted-fg-color, #9aa4b6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cgext-fmt-current-chip.has-format { color: var(--cg-fg-color, #e5e9f0); border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-fmt-clear {
  appearance: none; width: 26px; height: 26px; border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 6px; background: transparent; color: var(--cg-muted-fg-color, #9aa4b6);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.cgext-fmt-clear:hover:not(:disabled) { color: var(--cg-neg-color, #e2606c); border-color: var(--cg-neg-color, #e2606c); }
.cgext-fmt-clear:disabled { opacity: 0.4; cursor: default; }
.cgext-fmt-search {
  display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px;
  border: 1px solid var(--cg-accent-color, #4f9cf9); border-radius: 8px; margin-bottom: 8px;
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-fmt-search input {
  flex: 1 1 auto; min-width: 0; border: none; background: transparent; outline: none;
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 13px;
}
.cgext-fmt-main { display: flex; gap: 12px; min-height: 220px; }
.cgext-fmt-tabs { display: flex; flex-direction: column; gap: 2px; width: 132px; flex: 0 0 auto; }
.cgext-fmt-tab {
  appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 7px 9px; border: none; border-radius: 6px; background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.cgext-fmt-tab:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); }
.cgext-fmt-tab.is-active {
  color: var(--cg-accent-color, #4f9cf9);
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--cg-accent-color, #4f9cf9);
}
.cgext-fmt-count { font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 11px; opacity: 0.75; }
.cgext-fmt-body { flex: 1 1 auto; min-width: 0; max-height: 320px; overflow-y: auto; }
.cgext-fmt-list { display: flex; flex-direction: column; gap: 2px; }
.cgext-fmt-row {
  appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 9px; border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--cg-fg-color, #e5e9f0); font: inherit; text-align: left; cursor: pointer;
}
.cgext-fmt-row:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); }
.cgext-fmt-row.is-active {
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent);
  border-color: var(--cg-accent-color, #4f9cf9);
}
.cgext-fmt-row-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cgext-fmt-row-label { font-weight: 600; font-size: 13px; }
.cgext-fmt-row-code {
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 11.5px;
  color: var(--cg-muted-fg-color, #9aa4b6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
}
.cgext-fmt-row-preview {
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 12px;
  color: var(--cg-fg-color, #d3dbe7); white-space: nowrap; flex: 0 0 auto;
}
.cgext-fmt-empty { padding: 18px 10px; font-size: 12.5px; color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-fmt-custom { display: flex; flex-direction: column; gap: 10px; }
`;
```

- [ ] **Step 5: Verify green + full suite**

Run: `cd packages/ext && npx vitest run tests/formatPicker.test.ts && npx vitest run && npx tsc --noEmit`
Expected: new tests pass; full ext suite green; typecheck clean. If the `frontend-design` skill is available, review the CSS values (not the class names / DOM hooks) before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/ext/src/toolbar/formatPicker.ts packages/ext/tests/formatPickerHarness.ts packages/ext/tests/formatPicker.test.ts
git commit -m "feat(ext): format picker panel — CURRENT chip, search, category rail, live-preview preset rows"
```

---

### Task 8: Custom tab — symbol quick-insert, validated input, Excel reference

**Files:**
- Modify: `packages/ext/src/toolbar/formatPicker.ts` (replace the `buildCustomTab` stub; extend `FMT_CSS`)
- Test: `packages/ext/tests/formatPicker.test.ts` (append a describe block)

**Interfaces:**
- Consumes: Task 6's `CURRENCY_QUICK_INSERT`, `applyCurrencySymbol`, `EXCEL_EXAMPLES`; Task 7's panel ctx `{ current, renderCurrent, renderMain, close }`.
- Produces DOM hooks: `.cgext-fmt-custom`; symbol row `.cgext-fmt-symbols button[data-symbol]`; input `.cgext-fmt-custom-input input` (+ `.is-error`); apply `.cgext-fmt-custom-apply`; clear `.cgext-fmt-custom-clear`; reference `.cgext-fmt-ref` with `.cgext-fmt-ref-title` and `.cgext-fmt-ref-row[data-format]` (sentinel rows get `disabled`).

- [ ] **Step 1: Write the failing tests (append)**

```ts
import { EXCEL_EXAMPLES } from '../src/toolbar/formatPresets';

describe('custom tab', () => {
  const openCustom = (host?: FakeFormatHost) => {
    const r = mountPicker(host);
    r.panel.querySelector<HTMLElement>('.cgext-fmt-tab[data-cat="__custom__"]')!.click();
    return r;
  };
  const draftInput = (panel: HTMLElement) =>
    panel.querySelector<HTMLInputElement>('.cgext-fmt-custom-input input')!;

  it('symbol quick-insert seeds/replaces the draft and applies immediately, staying open', () => {
    const { panel, host } = openCustom();
    panel.querySelector<HTMLElement>('.cgext-fmt-symbols button[data-symbol=\'"£"\']')!.click();
    expect(host.applyFormat).toHaveBeenCalledWith('"£"#,##0.00');
    expect(document.querySelector('.cgext-menu.cgext-fmt')).not.toBeNull();
    expect(draftInput(panel).value).toBe('"£"#,##0.00');
  });
  it('valid input + ✓ applies and closes; invalid input shows error state and disables ✓', () => {
    const { panel, host } = openCustom();
    const input = draftInput(panel);
    input.value = '0.00%';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('is-error')).toBe(false);
    const apply = panel.querySelector<HTMLButtonElement>('.cgext-fmt-custom-apply')!;
    expect(apply.disabled).toBe(false);
    apply.click();
    expect(host.applyFormat).toHaveBeenCalledWith('0.00%');
    expect(document.querySelector('.cgext-menu.cgext-fmt')).toBeNull();
  });
  it('invalid draft: error class + disabled apply', () => {
    const { panel } = openCustom();
    const input = draftInput(panel);
    input.value = '=UPPER(';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('is-error')).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('.cgext-fmt-custom-apply')!.disabled).toBe(true);
  });
  it('✕ clears the draft and the applied format, staying open', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0';
    const { panel } = openCustom(host);
    panel.querySelector<HTMLElement>('.cgext-fmt-custom-clear')!.click();
    expect(host.clearFormat).toHaveBeenCalled();
    expect(draftInput(panel).value).toBe('');
    expect(document.querySelector('.cgext-menu.cgext-fmt')).not.toBeNull();
  });
  it('reference rows copy + apply + close; tick sentinels are disabled', () => {
    const writes: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: (t: string) => { writes.push(t); return Promise.resolve(); } } });
    const { panel, host } = openCustom();
    const titles = [...panel.querySelectorAll('.cgext-fmt-ref-title')].map((t) => t.textContent);
    expect(titles).toEqual(EXCEL_EXAMPLES.map((s) => s.title));
    panel.querySelector<HTMLElement>('.cgext-fmt-ref-row[data-format="0.00E+00"]')!.click();
    expect(host.applyFormat).toHaveBeenCalledWith('0.00E+00');
    expect(writes).toEqual(['0.00E+00']);
    expect(document.querySelector('.cgext-menu.cgext-fmt')).toBeNull();
  });
  it('tick sentinel rows are disabled buttons', () => {
    const { panel } = openCustom();
    const sentinel = [...panel.querySelectorAll<HTMLButtonElement>('.cgext-fmt-ref-row')]
      .find((r) => r.dataset.format!.startsWith('—'))!;
    expect(sentinel.disabled).toBe(true);
  });
  it('a custom current format opens on the Custom tab with the draft prefilled', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0.000000';       // matches no preset
    const { panel } = mountPicker(host); // no explicit tab click
    expect(draftInput(panel).value).toBe('#,##0.000000');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ext && npx vitest run tests/formatPicker.test.ts`
Expected: prior tests pass; the new block FAILS (custom tab is an empty stub).

- [ ] **Step 3: Replace `buildCustomTab`**

```ts
function buildCustomTab(
  host: FormatPickerHost,
  dataType: FormatDataType,
  ctx: { current(): string | undefined; renderCurrent(): void; renderMain(): void; close(): void },
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cgext-fmt-custom';
  wrap.innerHTML =
    `<div class="cgext-fmt-caps">CUSTOM EXCEL FORMAT</div>` +
    `<div class="cgext-fmt-symbols"><span class="cgext-fmt-caps">SYMBOL</span></div>` +
    `<div class="cgext-fmt-custom-input">` +
      `${svg(I.hash, 14)}<input type="text" spellcheck="false" aria-label="Custom format" />` +
      `<button type="button" class="cgext-fmt-custom-apply" title="Apply format">${svg(I.check, 14)}</button>` +
      `<button type="button" class="cgext-fmt-custom-clear" title="Clear format">${svg(I.x, 14)}</button>` +
    `</div>` +
    `<div class="cgext-fmt-ref"></div>`;

  const input = wrap.querySelector<HTMLInputElement>('.cgext-fmt-custom-input input')!;
  const applyBtn = wrap.querySelector<HTMLButtonElement>('.cgext-fmt-custom-apply')!;
  const clearBtn = wrap.querySelector<HTMLButtonElement>('.cgext-fmt-custom-clear')!;
  input.placeholder = dataType === 'date' ? 'yyyy-mm-dd' : '#,##0.00';
  // Prefill with a current format that matches no preset (custom source of truth).
  const cur = ctx.current();
  if (cur !== undefined && !findPresetByFormat(cur)) input.value = cur;

  const validate = (): boolean => {
    const draft = input.value.trim();
    if (!draft) { input.classList.remove('is-error'); input.title = ''; applyBtn.disabled = true; return false; }
    const r = compileFormat(draft);
    input.classList.toggle('is-error', !r.ok);
    input.title = r.ok ? '' : r.error.message;
    applyBtn.disabled = !r.ok;
    return r.ok;
  };
  validate();
  input.addEventListener('input', validate);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && validate()) { host.applyFormat(input.value.trim()); ctx.close(); }
    if (e.key === 'Escape') ctx.close();
  });
  applyBtn.addEventListener('click', () => {
    if (validate()) { host.applyFormat(input.value.trim()); ctx.close(); }
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    validate();
    host.clearFormat();
    ctx.renderCurrent();
  });

  const symbols = wrap.querySelector<HTMLElement>('.cgext-fmt-symbols')!;
  for (const c of CURRENCY_QUICK_INSERT) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cgext-fmt-symbol';
    b.dataset.symbol = c.symbol;
    b.textContent = c.label;
    b.setAttribute('aria-label', `Insert ${c.label} currency symbol`);
    b.addEventListener('click', () => {
      const next = applyCurrencySymbol(input.value, c.symbol);
      input.value = next;
      if (validate()) { host.applyFormat(next); ctx.renderCurrent(); } // applies, stays open
    });
    symbols.appendChild(b);
  }

  const ref = wrap.querySelector<HTMLElement>('.cgext-fmt-ref')!;
  for (const section of EXCEL_EXAMPLES) {
    const title = document.createElement('div');
    title.className = 'cgext-fmt-ref-title cgext-fmt-caps';
    title.textContent = section.title;
    ref.appendChild(title);
    for (const row of section.rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgext-fmt-ref-row';
      b.dataset.format = row.format;
      const sentinel = row.format.startsWith('—');
      b.disabled = sentinel;
      b.innerHTML =
        `<span class="cgext-fmt-ref-label"></span>` +
        `<span class="cgext-fmt-ref-code"></span>` +
        `<span class="cgext-fmt-ref-sample"></span>` +
        (sentinel ? '' : `<span class="cgext-fmt-ref-copy">${svg(I.copy, 12)}</span>`);
      b.querySelector('.cgext-fmt-ref-label')!.textContent = row.label;
      b.querySelector('.cgext-fmt-ref-code')!.textContent = row.format;
      b.querySelector('.cgext-fmt-ref-sample')!.textContent = row.sample;
      if (!sentinel) {
        b.addEventListener('click', () => {
          try { void navigator.clipboard?.writeText(row.format); } catch { /* copy is best-effort */ }
          host.applyFormat(row.format);
          ctx.close();
        });
      }
      ref.appendChild(b);
    }
  }
  return wrap;
}
```

Append to `FMT_CSS`:

```css
.cgext-fmt-symbols { display: flex; align-items: center; gap: 6px; }
.cgext-fmt-symbol {
  appearance: none; min-width: 34px; height: 30px; padding: 0 8px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 6px; background: transparent;
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 13px; cursor: pointer;
}
.cgext-fmt-symbol:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-fmt-custom-input {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 7px;
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-fmt-custom-input input {
  flex: 1 1 auto; min-width: 0; border: none; background: transparent; outline: none;
  color: var(--cg-fg-color, #e5e9f0);
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 12.5px;
}
.cgext-fmt-custom-input input.is-error { color: var(--cg-neg-color, #e2606c); }
.cgext-fmt-custom-apply, .cgext-fmt-custom-clear {
  appearance: none; width: 28px; height: 28px; border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 6px; background: transparent; display: inline-flex; align-items: center;
  justify-content: center; cursor: pointer;
}
.cgext-fmt-custom-apply { color: var(--cg-accent-color, #4f9cf9); }
.cgext-fmt-custom-apply:disabled { opacity: 0.4; cursor: default; }
.cgext-fmt-custom-clear { color: var(--cg-neg-color, #e2606c); }
.cgext-fmt-ref { display: flex; flex-direction: column; gap: 2px; border-top: 1px solid var(--cg-border-color, #2a3140); padding-top: 8px; }
.cgext-fmt-ref-title { padding: 8px 2px 4px; }
.cgext-fmt-ref-row {
  appearance: none; display: grid; grid-template-columns: 130px 1fr auto auto; gap: 8px; align-items: center;
  padding: 5px 6px; border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
}
.cgext-fmt-ref-row:hover:not(:disabled) { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); }
.cgext-fmt-ref-row:disabled { opacity: 0.55; cursor: default; }
.cgext-fmt-ref-code, .cgext-fmt-ref-sample { font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 11.5px; }
.cgext-fmt-ref-code { color: var(--cg-accent-color, #4f9cf9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cgext-fmt-ref-sample { color: var(--cg-muted-fg-color, #9aa4b6); white-space: nowrap; }
.cgext-fmt-ref-copy { display: inline-flex; color: var(--cg-muted-fg-color, #9aa4b6); }
```

Also add `findPresetByFormat` to the existing `./formatPresets` import in `formatPicker.ts` if Task 7's transcription didn't already include it.

- [ ] **Step 4: Verify green + full suite**

Run: `cd packages/ext && npx vitest run tests/formatPicker.test.ts && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ext/src/toolbar/formatPicker.ts packages/ext/tests/formatPicker.test.ts
git commit -m "feat(ext): format picker custom tab — symbol quick-insert, validated input, copy-and-apply excel reference"
```

---

### Task 9: Ribbon wiring — delete the prompt, live pill caption, clearFormat

**Files:**
- Modify: `packages/ext/src/toolbar/ribbon.ts` (`fmtCode` handler at :685-688; `refresh()`; the closures block around `targetCols` :426)
- Test: `packages/ext/tests/ribbonFormatPicker.test.ts`

**Interfaces:**
- Consumes: Task 7/8's `formatPickerMenu` + `FormatPickerHost`; Task 5's `format: null`.
- Produces: clicking the `# Format` pill toggles the picker; NO `window.prompt` remains in `packages/ext/src`; the pill caption tracks the current format (`# <preset label>` / `# <code ≤18 chars>` / `# Format`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ext/tests/ribbonFormatPicker.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Static guard: the prompt path is deleted, the picker is wired.
describe('ribbon format pill wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/toolbar/ribbon.ts'), 'utf8');
  it('window.prompt is gone from the ribbon', () => {
    expect(src.includes('window.prompt')).toBe(false);
  });
  it('the picker menu is wired to the pill', () => {
    expect(src.includes('formatPickerMenu')).toBe(true);
  });
});
```

Plus a behavioral test through the ribbon if the existing ext test suite already mounts the ribbon against a fake grid — check `packages/ext/tests/` for a ribbon harness; if none exists (the ribbon is currently E2E-covered only), the static guard above + Task 10's E2E carry this task and that is acceptable; note it in the report.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ext && npx vitest run tests/ribbonFormatPicker.test.ts`
Expected: FAIL — `window.prompt` still present, `formatPickerMenu` absent.

- [ ] **Step 3: Implement in `ribbon.ts`**

Import at top:
```ts
import { formatPickerMenu, type FormatPickerHost } from './formatPicker';
import { findPresetByFormat, type FormatDataType } from './formatPresets';
```

In the wiring section (near `targetCols` :426 and the existing `applyFormat`/`currentFormat` closures), add:

```ts
  /** Data type of the first target column, from the live columnDefs tree. */
  const targetDataType = (): FormatDataType => {
    const colId = targetCols()[0];
    if (!colId) return 'number';
    const walk = (defs: readonly unknown[]): string | undefined => {
      for (const d of defs) {
        const def = d as { colId?: string; cellDataType?: string; children?: unknown[] };
        if (def.colId === colId) return def.cellDataType;
        if (def.children) {
          const hit = walk(def.children);
          if (hit !== undefined) return hit;
        }
      }
      return undefined;
    };
    try {
      const t = walk((grid.getGridOption('columnDefs') as unknown[]) ?? []);
      return t === 'text' || t === 'date' || t === 'boolean' ? t : 'number';
    } catch { return 'number'; }
  };

  const clearFormat = (): void => {
    for (const colId of targetCols()) {
      try { grid.editColumn(colId, { format: null }); } catch { /* calc not wired */ }
    }
    ctx.profiles.markDirty();
    refresh();
  };

  const pickerHost: FormatPickerHost = {
    targetCols,
    currentFormat,
    applyFormat: (f) => { applyFormat(f); },
    clearFormat,
    dataType: targetDataType,
  };
  const fmtPicker = formatPickerMenu(r.fmtCode, pickerHost);
```

Replace the prompt handler (:685-688) with:

```ts
  r.fmtCode.addEventListener('click', () => fmtPicker.toggle());
```

Pill caption — in `refresh()` (the ribbon's existing state-sync function), add:

```ts
    // # Format pill caption tracks the target column's current format.
    const fmt = currentFormat();
    const label = fmt === undefined
      ? 'Format'
      : findPresetByFormat(fmt)?.label ?? (fmt.length > 18 ? `${fmt.slice(0, 17)}…` : fmt);
    const captionEl = r.fmtCode.querySelector('span');
    if (captionEl) captionEl.textContent = `# ${label}`;
    r.fmtCode.classList.toggle('is-set', fmt !== undefined);
```

(The pill's `<span>` comes from `pill('# Format')` :122-127. Add `.cgext-rb-pill.is-set { color: var(--cg-accent-color, #4f9cf9); }` to the ribbon CSS block.) Ensure the ribbon's destroy path calls `fmtPicker.destroy()` alongside its other cleanup.

- [ ] **Step 4: Verify green + full suite**

Run: `cd packages/ext && npx vitest run && npx tsc --noEmit && grep -rn "window.prompt" src/ ; echo "grep-exit=$?"`
Expected: suite green; typecheck clean; grep finds nothing (exit 1).

- [ ] **Step 5: Commit**

```bash
git add packages/ext/src/toolbar/ribbon.ts packages/ext/tests/ribbonFormatPicker.test.ts
git commit -m "feat(ext): # Format pill opens the format picker — window.prompt path deleted, live caption"
```

---

### Task 10: E2E — format picker in the ext demo

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/formatPicker.spec.ts`

**Interfaces:**
- Consumes: `window.__ext` (`__ext.grid` = kernel CGrid: `getTemplates()`, `getCellRanges`, focus APIs), the demo's `persistState: true` + `gridId: 'ext-demo'`, Tasks 7-9 DOM hooks, the demo's `currentPrice` column (number) and `ticker` column (text).

- [ ] **Step 1: Write the E2E spec**

```ts
import { test, expect, type Page } from '@playwright/test';

// Format picker E2E — real kernel + calc/format engines, persistState on.
// Boot storage-clean per test: goto → clear → reload (addInitScript would
// also wipe on in-test reloads, breaking the persistence assertion).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
});

const pill = (page: Page) => page.locator('[data-item-id]').filter({ hasText: '# ' }).first();
const panel = (page: Page) => page.locator('.cgext-menu.cgext-fmt');

/** Focus a cell in the given column so targetCols() resolves. */
async function focusColumn(page: Page, colId: string): Promise<void> {
  await page.evaluate((c) => {
    const g = (window as any).__ext.grid;
    g.setFocusedCell(0, c);
  }, colId);
}

/** The column's own-template format (undefined when none). */
async function ownFormat(page: Page, colId: string): Promise<string | undefined> {
  return page.evaluate((c) => {
    const g = (window as any).__ext.grid;
    const own = g.getTemplates().find((t: any) => t.id === `__cgridOwn:${c}`);
    return own?.overrides?.format;
  }, colId);
}

test('preset apply → own template + CURRENT chip + caption; persists across reload', async ({ page }) => {
  await focusColumn(page, 'notionalAmount');
  await pill(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.cgext-fmt-tab[data-cat="number"] .cgext-fmt-count')).toHaveText('6');

  await panel(page).locator('.cgext-fmt-row[data-preset-id="num-2dp"]').click();
  await expect(panel(page)).not.toBeVisible(); // apply closes
  expect(await ownFormat(page, 'notionalAmount')).toBe('#,##0.00');
  await expect(pill(page)).toContainText('# 2 decimals');

  // Reopen: CURRENT chip previews, active row highlighted.
  await pill(page).click();
  await expect(panel(page).locator('.cgext-fmt-current-chip')).toHaveText('1,234.57');
  await expect(panel(page).locator('.cgext-fmt-row[data-preset-id="num-2dp"]')).toHaveClass(/is-active/);
  await page.keyboard.press('Escape');

  // Persistence: wait for the debounced autosave, then reload.
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('#,##0.00')));
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
  expect(await ownFormat(page, 'notionalAmount')).toBe('#,##0.00');
});

test('tick preset renders on the price column; clear removes it', async ({ page }) => {
  await focusColumn(page, 'currentPrice');
  await pill(page).click();
  await panel(page).locator('.cgext-fmt-tab[data-cat="tick"]').click();
  await expect(panel(page).locator('.cgext-fmt-row[data-preset-id="tick-32"] .cgext-fmt-row-preview')).toHaveText('101-16');
  await panel(page).locator('.cgext-fmt-row[data-preset-id="tick-32"]').click();
  expect(await ownFormat(page, 'currentPrice')).toBe('TICK32');

  await pill(page).click();
  await panel(page).locator('.cgext-fmt-clear').click();
  expect(await ownFormat(page, 'currentPrice')).toBeUndefined();
  await expect(panel(page).locator('.cgext-fmt-current-chip')).toHaveText('—');
});

test('custom format via input; search; text column rail', async ({ page }) => {
  await focusColumn(page, 'notionalAmount');
  await pill(page).click();

  // Search flips to flat results.
  await panel(page).locator('.cgext-fmt-search input').fill('parens');
  await expect(panel(page).locator('.cgext-fmt-tabs')).toHaveCount(0);
  await expect(panel(page).locator('.cgext-fmt-row').first()).toBeVisible();
  await panel(page).locator('.cgext-fmt-search input').fill('');

  // Custom tab: type + apply.
  await panel(page).locator('.cgext-fmt-tab[data-cat="__custom__"]').click();
  const input = panel(page).locator('.cgext-fmt-custom-input input');
  await input.fill('#,##0.000');
  await panel(page).locator('.cgext-fmt-custom-apply').click();
  expect(await ownFormat(page, 'notionalAmount')).toBe('#,##0.000');
  await expect(pill(page)).toContainText('#,##0.000');

  // Text column shows the text rail with the ƒ(x) presets.
  await focusColumn(page, 'ticker');
  await pill(page).click();
  await expect(panel(page).locator('.cgext-fmt-tab[data-cat="text"] .cgext-fmt-count')).toHaveText('9');
  await panel(page).locator('.cgext-fmt-row[data-preset-id="str-upper"]').click();
  expect(await ownFormat(page, 'ticker')).toBe('=UPPER(value)');
});
```

Note on `pill(page)`: if the `# Format` pill lacks a stable `data-item-id` hook, target it as `page.locator('.cgext-rb-pill', { hasText: /# / }).first()` — verify against the rendered DOM and keep ONE stable locator; adding `data-fmt-pill` to the pill in Task 9 is the preferred fix if neither is unique.

- [ ] **Step 2: Run the new spec**

Run: `cd apps/cgrid-ext-demo && npx playwright test e2e/formatPicker.spec.ts`
Expected: 3 pass. Kill stale :5188 first (`lsof -ti :5188 | xargs -r kill`); rebuild the kernel dist if the demo behaves stale (`cd packages/kernel && npm run build`, clear `node_modules/.vite`). If `setFocusedCell(0, colId)`'s signature differs, check `packages/kernel/src/types/api.ts` for the exact form and adjust the helper only.

- [ ] **Step 3: Full demo suite (done-gate)**

Run: `cd apps/cgrid-ext-demo && npx playwright test`
Expected: ALL specs pass (spine, iconRibbon, layoutsToolbar, formatPicker).

- [ ] **Step 4: Kill leftover automation processes**

Run: `lsof -ti :5188 | xargs -r kill`

- [ ] **Step 5: Commit**

```bash
git add apps/cgrid-ext-demo/e2e/formatPicker.spec.ts
git commit -m "test(e2e): format picker — preset/tick/custom apply, clear, search, text rail, reload persistence"
```

---

## Batch closeout (after all 10 tasks)

ONE closeout review over Tasks 1-10 + a single fix wave (standing batch-review rule). Verification: format + expression + calc + ext unit suites and typechecks; kernel suite (calc type flows into `CGridApi`); full demo E2E; manual browser pass of the picker in light AND dark theme (flip via the overflow menu), automation browser killed after.
