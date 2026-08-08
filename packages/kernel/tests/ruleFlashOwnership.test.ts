import { describe, it, expect } from 'vitest';
import { isRuleFlashOwned, ruleFlashOwnership } from '../src/core/ruleFlashOwnership';
import type { ConditionalRuleShape } from '../src/core/ruleEngineSlot';

describe('ruleFlashOwnership', () => {
  it('returns empty for no rules / no flash', () => {
    expect(ruleFlashOwnership(undefined).allColumns).toBe(false);
    expect(ruleFlashOwnership([]).colIds.size).toBe(0);
    expect(ruleFlashOwnership([
      { id: 'a', kind: 'style', flash: { enabled: false }, scope: { kind: 'cell', columnIds: ['mid'] } },
    ]).colIds.size).toBe(0);
  });

  it('collects cell-scoped flash-enabled columns', () => {
    const rules: ConditionalRuleShape[] = [
      { id: 'up', kind: 'style', flash: { enabled: true, target: 'cell' }, scope: { kind: 'cell', columnIds: ['midPrice'] } },
      { id: 'dn', kind: 'style', enabled: true, flash: { enabled: true }, scope: { kind: 'cell', columnIds: ['yield'] } },
      { id: 'off', kind: 'style', enabled: false, flash: { enabled: true }, scope: { kind: 'cell', columnIds: ['bid'] } },
    ];
    const owned = ruleFlashOwnership(rules);
    expect(owned.allColumns).toBe(false);
    expect([...owned.colIds].sort()).toEqual(['midPrice', 'yield']);
    expect(isRuleFlashOwned(owned, 'midPrice')).toBe(true);
    expect(isRuleFlashOwned(owned, 'bid')).toBe(false);
  });

  it('marks allColumns for row-scope flash', () => {
    const owned = ruleFlashOwnership([
      { id: 'row', kind: 'style', flash: { enabled: true, target: 'row' }, scope: { kind: 'row' } },
    ]);
    expect(owned.allColumns).toBe(true);
    expect(isRuleFlashOwned(owned, 'anything')).toBe(true);
  });
});
