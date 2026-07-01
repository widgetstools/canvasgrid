import type { FormatEvalContext, StyleObj, IconRef } from '../types';
import type { Tier1Node } from './parser';

export function resolveStyle(nodes: Tier1Node[], ctx: FormatEvalContext): StyleObj | null {
  throw new Error('not-yet-implemented: tier1.resolveStyle');
}

export function resolveIcon(
  iconTokens: Array<{ name: string; dynamicExpr?: string }>,
  ctx: FormatEvalContext,
): IconRef | null {
  throw new Error('not-yet-implemented: tier1.resolveIcon');
}
