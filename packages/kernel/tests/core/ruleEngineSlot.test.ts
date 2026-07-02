import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRuleEngine,
  getRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../../src/core/ruleEngineSlot';

const EMPTY = { matched: [], style: null, indicator: null, formatProgram: null };

describe('Kernel rule-engine slot', () => {
  beforeEach(() => _resetRuleEngine_forTests());

  it('returns null when no engine registered', () => {
    expect(getRuleEngine()).toBeNull();
  });

  it('stores and returns the registered engine', () => {
    const fake: RuleEngineShape = {
      evaluateCell: () => EMPTY,
      resolveRuleRef: () => null,
    };
    registerRuleEngine(fake);
    expect(getRuleEngine()).toBe(fake);
  });

  it('overwrites previous engine on re-register', () => {
    const first: RuleEngineShape = { evaluateCell: () => EMPTY, resolveRuleRef: () => null };
    const second: RuleEngineShape = { evaluateCell: () => EMPTY, resolveRuleRef: () => '#f00' };
    registerRuleEngine(first);
    registerRuleEngine(second);
    expect(getRuleEngine()).toBe(second);
  });

  it('reset helper clears the slot', () => {
    registerRuleEngine({ evaluateCell: () => EMPTY, resolveRuleRef: () => null });
    _resetRuleEngine_forTests();
    expect(getRuleEngine()).toBeNull();
  });
});
