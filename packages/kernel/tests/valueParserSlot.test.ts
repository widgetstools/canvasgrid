// The value-parser DI slot: a package extends how a typed cell value is
// PARSED, without rewriting column defs.
//
// The alternative was for the contributing package to transform `columnDefs`
// and push them back through `updateGridOptions` — which rebuilds the column
// tree and contends with the format and calc engines, both of which also own
// colDefs. Last writer wins there, so a wrapper is silently dropped or applied
// twice. These pin the properties that made the slot the better answer.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerValueParserContributor,
  getValueParserContributor,
  _resetValueParserContributor_forTests,
} from '../src/core/valueParserSlot';
import { resolveColDefs } from '../src/core/propertyChain';

beforeEach(() => { _resetValueParserContributor_forTests(); });

/** Resolve one column and hand back the parser the grid would use. */
function parserFor(colDef: Record<string, unknown>) {
  const resolved = resolveColDefs([colDef] as never);
  return (resolved[0] as { valueParser?: (p: unknown) => unknown }).valueParser;
}

describe('value-parser slot', () => {
  it('is a pure pass-through with nothing registered', () => {
    // A grid without the edit package must behave exactly as before.
    expect(getValueParserContributor()).toBeNull();
    const own = (p: unknown) => (p as { newValue: unknown }).newValue;
    expect(parserFor({ colId: 'a', field: 'a', valueParser: own })).toBe(own);
    expect(parserFor({ colId: 'b', field: 'b' })).toBeUndefined();
  });

  it('wraps the column the contributor opts into, and leaves the rest alone', () => {
    registerValueParserContributor((col, original) =>
      (col.cellDataType === 'number'
        ? (p) => `wrapped:${String((p as { newValue: unknown }).newValue)}`
        : original));
    const num = parserFor({ colId: 'qty', field: 'qty', cellDataType: 'number' });
    expect(num?.({ newValue: 5 })).toBe('wrapped:5');
    expect(parserFor({ colId: 'name', field: 'name', cellDataType: 'text' })).toBeUndefined();
  });

  it("the column's OWN parser is handed to the contributor, and can win", () => {
    // An app that wrote a valueParser must keep precedence over anything a
    // contributor adds — otherwise installing the edit package silently
    // changes how the app's own columns parse.
    const own = () => 'from-app';
    let sawOriginal: unknown;
    registerValueParserContributor((_col, original) => {
      sawOriginal = original;
      return (p) => original?.(p) ?? 'contributor';
    });
    const parser = parserFor({ colId: 'a', field: 'a', cellDataType: 'number', valueParser: own });
    expect(sawOriginal).toBe(own);
    expect(parser?.({ newValue: 1 })).toBe('from-app');
  });

  it('does not mutate the authored colDef', () => {
    // The whole reason for resolving rather than rewriting.
    registerValueParserContributor(() => () => 'x');
    const authored = { colId: 'a', field: 'a', cellDataType: 'number' };
    parserFor(authored);
    expect(authored).toEqual({ colId: 'a', field: 'a', cellDataType: 'number' });
  });

  it('unregistering restores the pass-through', () => {
    registerValueParserContributor(() => () => 'x');
    expect(parserFor({ colId: 'a', field: 'a' })?.({ newValue: 1 })).toBe('x');
    registerValueParserContributor(null);
    expect(parserFor({ colId: 'a', field: 'a' })).toBeUndefined();
  });

  it('holds exactly one contributor, so a second registration replaces it', () => {
    // Idempotence by construction: this is what a colDef rewrite could not
    // offer, since re-applying a transform stacks wrappers.
    registerValueParserContributor(() => () => 'first');
    registerValueParserContributor(() => () => 'second');
    expect(parserFor({ colId: 'a', field: 'a' })?.({ newValue: 1 })).toBe('second');
  });
});
