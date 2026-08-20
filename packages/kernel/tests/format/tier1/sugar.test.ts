import { describe, it, expect } from 'vitest';
import { canonicalize } from '../../../src/format/tier1/sugar';

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
    expect(r.ruleRefs[0]?.loc.start).toBe(5);
  });

  it('rule:<id> inside ternary preserves other tokens', () => {
    const r = canonicalize('[change] > 0 ? rule:up : rule:down', { start: 0, end: 40 });
    expect(r.canonicalized).toBe('[change] > 0 ? null : null');
    expect(r.ruleRefs).toHaveLength(2);
    expect(r.ruleRefs.map((n) => n.ruleId)).toEqual(['up', 'down']);
  });
});
