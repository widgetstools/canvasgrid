// Does every switch in the Grid Options panel actually DO anything?
//
// The existing drift guard asks whether a runtime option has a panel entry.
// This asks the opposite and more important question: whether a panel entry
// has an implementation. A switch that stores a value nothing reads is worse
// than a missing one — it tells the user a thing is on, the grid behaves as
// though it is off, and nothing anywhere disagrees.
//
// `animateRows` was exactly that: offered as "Animate rows", accepted by
// `setGridOption`, round-tripped by its own test ("storage-only flags ...
// round-trip"), and read by no line of code in any package.
//
// The check is deliberately conservative. It asks only whether the key appears
// AT ALL outside the files that merely declare it, so it cannot produce a false
// "dead" — if it fires, the option genuinely has no implementation. It will
// miss an option that is read but ignored; that class needs a behavioural test,
// not a scan.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GRID_OPTIONS_SCHEMA_KEYS } from '../src/core/optionSchema';

/** Files that DECLARE options rather than act on them. */
const PLUMBING = [
  'core/runtimeOptions.ts',
  'core/optionSchema.ts',
  'types/options.ts',
  'types/settingsSchema.ts',
];

/**
 * Known dead or not-yet-implemented switches, each with a reason.
 *
 * Empty is the goal. An entry here is a promise the panel is currently making
 * and the grid is not keeping, so it should be removed by implementing the
 * option or dropping it from the schema — not by growing this list.
 */
const KNOWN_UNIMPLEMENTED = new Map<string, string>([
  // No read site in ANY package. AG animates row moves on sort/filter; this
  // grid paints to a canvas and has never had the transition to suppress.
  // Either implement it against the paint path or drop it from the panel —
  // today it is a switch reporting a state the grid does not have.
  ['animateRows', 'accepted and stored, read by no line of code in any package'],
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Sibling packages too: an option the kernel only declares may well be
// implemented in `ext`, and flagging that as dead would be the same kind of
// confidently-wrong answer this guard exists to catch.
const ROOTS = ['../src', '../../ext/src', '../../data/src']
  .map((r) => resolve(__dirname, r))
  .filter((r) => { try { return statSync(r).isDirectory(); } catch { return false; } });
const FILES = ROOTS.flatMap((r) => sourceFiles(r))
  .filter((f) => !PLUMBING.some((p) => f.endsWith(p)));
const CORPUS = FILES.map((f) => readFileSync(f, 'utf8')).join('\n');

describe('every option the panel offers is wired to something', () => {
  it('no schema key is accepted, stored, and then read by nothing', () => {
    const dead: string[] = [];
    for (const key of GRID_OPTIONS_SCHEMA_KEYS) {
      if (KNOWN_UNIMPLEMENTED.has(key)) continue;
      // Word-boundary match, so `rowHeight` does not satisfy `headerRowHeight`.
      if (!new RegExp(`\\b${key}\\b`).test(CORPUS)) dead.push(key);
    }
    expect(
      dead,
      `panel options with no implementation anywhere in src/: ${dead.join(', ')}\n`
      + 'Implement the option, drop it from the schema, or record it in '
      + 'KNOWN_UNIMPLEMENTED with a reason.',
    ).toEqual([]);
  });

  it('every known-unimplemented switch is still genuinely unimplemented', () => {
    // So the list shrinks when someone implements one, instead of quietly
    // outliving the problem and hiding the next regression behind it.
    const implemented = [...KNOWN_UNIMPLEMENTED.keys()]
      .filter((key) => new RegExp(`\\b${key}\\b`).test(CORPUS));
    expect(
      implemented,
      `now implemented — remove from KNOWN_UNIMPLEMENTED: ${implemented.join(', ')}`,
    ).toEqual([]);
  });

  it('every entry in the list says why', () => {
    for (const [key, reason] of KNOWN_UNIMPLEMENTED) {
      expect(reason.length, `no reason recorded for '${key}'`).toBeGreaterThan(10);
    }
  });

  it('the corpus it scans is real', () => {
    // A scan over an empty corpus would pass every assertion above while
    // checking nothing at all.
    expect(FILES.length).toBeGreaterThan(100);
    expect(CORPUS).toContain('setGridOption');
    expect(GRID_OPTIONS_SCHEMA_KEYS.size).toBeGreaterThan(30);
  });
});
