import type { Ast } from '@cgrid/expression';
import type { Loc } from '@cgrid/expression';
import type { CompileFormatError, RuleRefNode } from '../types';

export interface Tier1Node {
  channel: 'color' | 'bg' | 'weight' | 'style' | 'if';
  ast: Ast | null;             // null when the interior compiles to a rule-ref only
  ruleRefs: RuleRefNode[];
  loc: Loc;
}

export type Tier1ParseResult =
  | { ok: true; nodes: Tier1Node[] }
  | { ok: false; error: CompileFormatError };

export function parseTier1Brackets(
  brackets: Array<{ channel: Tier1Node['channel']; interior: string; interiorLoc: Loc; loc: Loc }>,
): Tier1ParseResult {
  throw new Error('not-yet-implemented: tier1.parseTier1Brackets');
}
