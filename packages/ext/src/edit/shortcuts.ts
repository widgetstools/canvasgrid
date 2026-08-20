// @wellsfargo-starui/velocity-grid-ext/edit — letter-key shortcuts: key matching, patches, conflict detection.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 1.1.7 (letter-key shortcuts).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.6.
//
// Pure engine module — no kernel imports, no Date, no grid surface, no
// expression gates by design (recon A.6: predictability over flexibility).

import type { CellTarget } from './patches';
import { buildPatchesFromTargets } from './patches';
import type { CellPatch, ShortcutDefinition } from './types';
import { applyNumericOp } from './numericOps';

/** Lowercase `shortcutKey`s of ENABLED shortcuts only — built ONCE at config
 *  time by the bridge so the hot keydown path is O(1) set membership
 *  (recon A.6). */
export function collectShortcutKeys(shortcuts: ShortcutDefinition[]): Set<string> {
  const keys = new Set<string>();
  for (const s of shortcuts) {
    if (s.enabled) keys.add(s.shortcutKey.toLowerCase());
  }
  return keys;
}

function scopeMatches(columnIds: string[], colId: string, field: string): boolean {
  return columnIds.length === 0 || columnIds.includes(colId) || columnIds.includes(field);
}

/** `key` is normalized `toLowerCase()` before comparison — case-insensitive:
 *  `Shift+M` delivers `key === 'M'` and must match a stored `'m'`. First
 *  ENABLED match in list order. Scope rule IDENTICAL to nudges (empty
 *  `columnIds` = all columns; else must include `cell.colId` OR
 *  `cell.field`). NO expression gates by design. */
export function matchShortcutForCell(
  cell: { colId: string; field: string },
  key: string,
  shortcuts: ShortcutDefinition[],
): ShortcutDefinition | null {
  const normalizedKey = key.toLowerCase();
  for (const s of shortcuts) {
    if (!s.enabled) continue;
    if (s.shortcutKey.toLowerCase() !== normalizedKey) continue;
    if (!scopeMatches(s.scope.columnIds, cell.colId, cell.field)) continue;
    return s;
  }
  return null;
}

/** Per target: `matchShortcutForCell` -> null skips; matched shortcut applies
 *  `applyNumericOp(target.value, s.operation, s.shortcutValue)` (non-numeric
 *  current -> null -> skip). Composed through `buildPatchesFromTargets` so
 *  the null-skip and `Object.is` no-op guard stay centralized. */
export function buildShortcutPatches(opts: {
  targets: CellTarget[];
  key: string;
  shortcuts: ShortcutDefinition[];
}): CellPatch[] {
  const { targets, key, shortcuts } = opts;
  return buildPatchesFromTargets(targets, (t) => {
    const s = matchShortcutForCell({ colId: t.colId, field: t.field }, key, shortcuts);
    if (!s) return null;
    return applyNumericOp(t.value, s.operation, s.shortcutValue);
  });
}

/** Two scopes OVERLAP iff either is empty or their `columnIds` intersect. */
function scopesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const bSet = new Set(b);
  return a.some((colId) => bSet.has(colId));
}

/** ENABLED shortcuts grouped by lowercase key; within a group, the winner is
 *  the first list-order member and `shadowedIds` are later members whose
 *  scope overlaps the winner's, in list order. Groups with no shadowing are
 *  OMITTED. Engine-side helper only — the shadow-rule warning UI is 21i. */
export function detectShortcutConflicts(
  shortcuts: ShortcutDefinition[],
): Array<{ key: string; winnerId: string; shadowedIds: string[] }> {
  const groups = new Map<string, ShortcutDefinition[]>();
  for (const s of shortcuts) {
    if (!s.enabled) continue;
    const key = s.shortcutKey.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }

  const conflicts: Array<{ key: string; winnerId: string; shadowedIds: string[] }> = [];
  for (const [key, members] of groups) {
    const [winner, ...rest] = members;
    if (!winner) continue;
    const shadowedIds = rest
      .filter((s) => scopesOverlap(winner.scope.columnIds, s.scope.columnIds))
      .map((s) => s.id);
    if (shadowedIds.length > 0) conflicts.push({ key, winnerId: winner.id, shadowedIds });
  }
  return conflicts;
}
