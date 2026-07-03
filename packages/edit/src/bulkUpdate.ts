// @cgrid/edit — bulk-update target collection, type-aware value parsing,
// patch build, and the distinct-values dropdown feed.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 1.1.5 (bulk-update).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.4.
//
// Pure engine module — no kernel imports, no Date (calendar validation is
// arithmetic, never `new Date`), no grid surface beyond the structural
// TargetSurface shared with smart-edit (Task 5).

import type { CellTarget } from './patches';
import { buildPatchesFromTargets } from './patches';
import type { CellPatch } from './types';
import type { TargetSurface } from './smartEdit';
import { collectCellsByType } from './smartEdit';

/** Bulk-update's cell-data-type filter (recon A.4): text/number/date/dateTime
 *  included; undefined treated as text (INCLUDED); boolean EXCLUDED. */
function isBulkUpdateCellDataType(cellDataType?: string): boolean {
  if (cellDataType === undefined) return true;
  return (
    cellDataType === 'text' ||
    cellDataType === 'number' ||
    cellDataType === 'date' ||
    cellDataType === 'dateTime'
  );
}

/** Same ranges-first collection walk as Task 5's `collectTargetCells`
 *  (shared via `collectCellsByType` in smartEdit.ts) but filtered to
 *  text/number/date/dateTime cells (undefined -> text, boolean excluded). */
export async function collectBulkUpdateTargets(surface: TargetSurface): Promise<CellTarget[]> {
  return collectCellsByType(surface, isBulkUpdateCellDataType);
}

/** Maps a cellDataType to its bulk-update value-parsing family. `date` and
 *  `dateTime` both collapse to `'date'` here (used by 21i's type-inferred
 *  input, recon B/15) even though `parseBulkUpdateValue` below validates
 *  them with different (date-only vs date+time) rules. */
export function bulkUpdateValueKind(cellDataType?: string): 'text' | 'number' | 'date' {
  if (cellDataType === 'number') return 'number';
  if (cellDataType === 'date' || cellDataType === 'dateTime') return 'date';
  return 'text';
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Date-free (spec §2.3) calendar validation: month range + day-for-month,
 *  including the century leap rule (2000 leap, 1900 not) — all arithmetic,
 *  never `new Date`. */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day >= 1 && day <= maxDay;
}

function parseBulkUpdateNumber(raw: string): number | null {
  // Implementer NOTE (mandatory): do NOT copy StarUI's
  // `parseFloat(raw) || null` — that falsy-coercion bug makes '0' parse to
  // null. `Number('')` is ALSO `0`, so the empty string needs its own
  // explicit guard; every other non-numeric string already yields `NaN`
  // from `Number(...)`, which the `Number.isNaN` check below catches.
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

function parseBulkUpdateDate(raw: string): string | null {
  const match = DATE_RE.exec(raw);
  if (!match) return null;
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  return isValidCalendarDate(year, month, day) ? raw : null;
}

function parseBulkUpdateDateTime(raw: string): string | null {
  const match = DATE_TIME_RE.exec(raw);
  if (!match) return null;
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const hour = Number(match[4]!);
  const minute = Number(match[5]!);
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  if (!isValidCalendarDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return raw;
}

/** Type-aware, null-on-failure, never-throws value parsing for bulk-update's
 *  free-text/dropdown input (recon A.4). `number`/`date`/`dateTime` validate
 *  and may reject; `text` (and any other/undefined cellDataType) always
 *  succeeds, including the empty string. */
export function parseBulkUpdateValue(raw: string, cellDataType?: string): unknown | null {
  if (cellDataType === 'number') return parseBulkUpdateNumber(raw);
  if (cellDataType === 'date') return parseBulkUpdateDate(raw);
  if (cellDataType === 'dateTime') return parseBulkUpdateDateTime(raw);
  return raw;
}

/** Thin composition over Task 3's `buildPatchesFromTargets` — the null-skip
 *  and `Object.is` no-op guard (e.g. `-0` vs `0` still patches; `NaN` vs
 *  `NaN` does not) live there, not re-implemented here. */
export function buildBulkUpdatePatches(targets: CellTarget[], newValue: unknown): CellPatch[] {
  return buildPatchesFromTargets(targets, () => newValue);
}

/** Adapter over the kernel's `getDistinctValues`, which returns STRINGIFIED
 *  values (recon C.6): fetches at `opts.maxDropdownValues`, parses each
 *  string back type-aware via `parseBulkUpdateValue`, and drops parse
 *  failures. Performs a FRESH fetch on every call — no caching (recon A.4:
 *  distinct values reflect currently-displayed rows at open time). */
export function makeDistinctValuesFeed(
  getDistinctValues: (colId: string, limit?: number) => Promise<string[]>,
  opts: { maxDropdownValues: number },
): (colId: string, cellDataType?: string) => Promise<unknown[]> {
  return async (colId: string, cellDataType?: string) => {
    const raws = await getDistinctValues(colId, opts.maxDropdownValues);
    const values: unknown[] = [];
    for (const raw of raws) {
      const parsed = parseBulkUpdateValue(raw, cellDataType);
      if (parsed !== null) values.push(parsed);
    }
    return values;
  };
}
