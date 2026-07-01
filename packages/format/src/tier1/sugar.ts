import type { Loc } from '@cgrid/expression';
import type { RuleRefNode } from '../types';

export interface SugarResult {
  /** The canonicalized expression string ready for expression.parse. */
  canonicalized: string;
  /** RuleRefNode reserves discovered during canonicalization. */
  ruleRefs: RuleRefNode[];
}

export function canonicalize(interior: string, interiorLoc: Loc): SugarResult {
  throw new Error('not-yet-implemented: tier1.canonicalize');
}
