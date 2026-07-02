import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCalcProvider,
  getCalcProvider,
  _resetCalcProvider_forTests,
  type CalcProviderShape,
} from '../../src/core/calcSlot';

function makeFake(overrides: Partial<CalcProviderShape> = {}): CalcProviderShape {
  return {
    synthesizedColDefs: () => [],
    resolvedPatchFor: () => null,
    workerProgram: () => null,
    onColumnsChanged: () => () => {},
    ...overrides,
  };
}

describe('Kernel calc-provider slot', () => {
  beforeEach(() => _resetCalcProvider_forTests());

  it('returns null when no provider registered', () => {
    expect(getCalcProvider()).toBeNull();
  });

  it('stores and returns the registered provider', () => {
    const fake = makeFake();
    registerCalcProvider(fake);
    expect(getCalcProvider()).toBe(fake);
  });

  it('overwrites previous provider on re-register', () => {
    const first = makeFake();
    const second = makeFake({ workerProgram: () => ({ ops: [] }) });
    registerCalcProvider(first);
    registerCalcProvider(second);
    expect(getCalcProvider()).toBe(second);
  });

  it('reset helper clears the slot', () => {
    registerCalcProvider(makeFake());
    _resetCalcProvider_forTests();
    expect(getCalcProvider()).toBeNull();
  });
});
