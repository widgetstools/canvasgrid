/**
 * Columns (or whole-row) owned by enabled style rules that have
 * `flash.enabled`. Kernel default cell-change flash is suppressed for
 * those cells unless a rule activation staged a `flashOverrides` entry
 * (rule flash still paints via flashCells → override join).
 */
import type { ConditionalRuleShape } from './ruleEngineSlot';

export interface RuleFlashOwnership {
  /** True when any flash-enabled rule has row scope / flash.target === 'row'. */
  allColumns: boolean;
  /** Cell-scoped flash-enabled column ids (ignored when `allColumns`). */
  colIds: ReadonlySet<string>;
}

const EMPTY: RuleFlashOwnership = Object.freeze({
  allColumns: false,
  colIds: Object.freeze(new Set<string>()),
});

export function ruleFlashOwnership(
  rules: readonly ConditionalRuleShape[] | undefined | null,
): RuleFlashOwnership {
  if (!rules || rules.length === 0) return EMPTY;
  const colIds = new Set<string>();
  for (const r of rules) {
    if (r.enabled === false) continue;
    if (r.kind != null && r.kind !== 'style') continue;
    if (r.flash?.enabled !== true) continue;
    if (r.flash.target === 'row' || r.scope?.kind === 'row') {
      return { allColumns: true, colIds };
    }
    const cols = r.scope?.columnIds;
    if (!cols) continue;
    for (const c of cols) colIds.add(c);
  }
  if (colIds.size === 0) return EMPTY;
  return { allColumns: false, colIds };
}

export function isRuleFlashOwned(owned: RuleFlashOwnership, colId: string): boolean {
  return owned.allColumns || owned.colIds.has(colId);
}
