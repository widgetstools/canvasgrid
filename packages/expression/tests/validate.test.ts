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

  it('flags unary ! result vs number (boolean vs number)', () => {
    // staticType(unary '!') → 'boolean'; literal 0 → 'number' → type-mismatch
    const r = validate('![active] > 0', S);
    expect(r.ok).toBe(false);
    const tm = r.errors.find((e) => e.code === 'type-mismatch');
    expect(tm?.message).toMatch(/cannot compare boolean and number/);
  });

  it('flags unary - result vs string (number vs string)', () => {
    // staticType(unary '-') → 'number'; [symbol] → 'string' → type-mismatch
    const r = validate('-[price] > [symbol]', S);
    expect(r.ok).toBe(false);
    const tm = r.errors.find((e) => e.code === 'type-mismatch');
    expect(tm?.message).toMatch(/cannot compare number and string/);
  });

  it('does not flag when arithmetic binary is left operand (resolves to number)', () => {
    // staticType(binary '+') → 'number'; [price] → 'number' → compatible
    const r = validate('[price] + 1 > [trade.px]', S);
    expect(r.ok).toBe(true);
  });

  it('flags arithmetic binary vs string', () => {
    // staticType(binary '+') → 'number'; [symbol] → 'string' → type-mismatch
    // precedence: [price] + 1 > [symbol] parses as ([price] + 1) > [symbol]
    const r = validate('[price] + 1 > [symbol]', S);
    expect(r.ok).toBe(false);
    const tm = r.errors.find((e) => e.code === 'type-mismatch');
    expect(tm?.message).toMatch(/cannot compare number and string/);
  });

  it('does not flag when ternary is operand (unknown type — skip)', () => {
    // staticType(ternary) → 'unknown' → no type-mismatch emitted
    const r = validate('(true ? [price] : [trade.px]) > [symbol]', S);
    // unknown vs string → skip (no type-mismatch), but unknown-field check passes
    // [symbol] is known string, ternary is unknown → no mismatch
    expect(r.errors.every((e) => e.code !== 'type-mismatch')).toBe(true);
  });

  it('does not flag when call result is operand (unknown type — skip)', () => {
    // staticType(call) → 'unknown' → no type-mismatch emitted
    const r = validate('ABS([price]) > [symbol]', S);
    // ABS is unknown, [symbol] is string → unknown vs string → skip
    expect(r.errors.every((e) => e.code !== 'type-mismatch')).toBe(true);
  });

  it('allows != comparison across types (equality not type-checked)', () => {
    const r = validate('[price] != [symbol]', S);
    expect(r.ok).toBe(true);
  });
});

describe('validate — ternary + call node walking', () => {
  it('walks ternary branches for unknown fields', () => {
    const r = validate('true ? [foo] : [bar]', S);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.map((e) => e.code)).toEqual(['unknown-field', 'unknown-field']);
  });

  it('walks call args for unknown fields', () => {
    const r = validate('IF([foo], [price], [bar])', S);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.map((e) => e.code)).toEqual(['unknown-field', 'unknown-field']);
  });

  it('ok on valid ternary with known fields', () => {
    const r = validate('[active] ? [price] : [trade.px]', S);
    expect(r.ok).toBe(true);
  });

  it('ok on valid call with known fields', () => {
    const r = validate('IF([active], [price], [trade.px])', S);
    expect(r.ok).toBe(true);
  });
});
