// Does every switch in the Editing tab actually DO anything?
//
// The kernel has this guard for the Grid Options panel
// (`packages/kernel/tests/deadSwitches.test.ts`) and it caught `animateRows`.
// The Editing tab's settings live in `ext` and were never covered, so the same
// class went unnoticed here — SEVEN of them. Four are now implemented
// (`confirmThreshold` on both panels, `previewBeforeApply`, `showDistinctValues`,
// and `incrementStep`, which seeds the toolbar operand); the rest remain below
// with what each would take.
//
// A read site means the ENGINE acts on the value. Deliberately NOT counted:
//
//   - `edit/types.ts`                       declares the shape, nothing more
//   - `modules/` and `customizer/panels/`   render the control, so they read
//                                           the value to DISPLAY it — which is
//                                           exactly the state a dead switch is
//                                           already in, and counting it would
//                                           make every dead switch look alive
//   - the defaults + merge lines in         `edit/settings.ts` also holds real
//     `edit/settings.ts`                    logic (`shouldRecord`), so only its
//                                           object-literal lines are stripped;
//                                           excluding the file reported
//                                           `suspended` dead when it is not
//   - comment lines                         `magnitudeShortcutsEnabled`'s only
//                                           mention is a comment saying the
//                                           feature is "gated by" it. It is not.
//
// Conservative by construction: it asks only whether the key appears at all in
// engine code, so it cannot report a false "dead". It will miss a setting that
// is read and then ignored — that needs a behavioural test, and the journal's
// exhaustive per-source table is what that looks like.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_EDIT_SETTINGS } from '../src/edit/settings';

const TYPES_ONLY = ['edit/types.ts'];
const RENDERS = ['/modules/', '/customizer/panels/'];
/** `edit/settings.ts` holds BOTH the defaults literal and real engine logic
 *  (`shouldRecord`, `recordSourceKey`), so excluding the file wholesale
 *  reported `suspended` as dead when `shouldRecord` reads it. Only its
 *  object-literal property lines — the defaults and the key-by-key merge —
 *  are stripped. */
const SETTINGS_FILE = 'edit/settings.ts';

/**
 * Settings the Editing tab offers and the engine does not implement.
 *
 * Empty is the goal. Each entry is a control the panel shows, stores a value
 * for, and that changes nothing — so it should leave by being implemented or
 * by being removed from the panel, not by this list growing.
 */
interface Unimplemented {
  reason: string;
  /** Override for a leaf name another TYPE also uses. `incrementStep` needed
   *  one — a bare scan cannot tell `settings.smartEdit.incrementStep` from a
   *  Plus/Minus `nudge.incrementStep` — and the next collision will too. */
  probe?: RegExp;
}

const KNOWN_UNIMPLEMENTED = new Map<string, Unimplemented>([
  ['magnitudeShortcutsEnabled', {
    reason: 'Smart Edit "K/M/B shortcuts" — the spec says the parser is gated by it; nothing reads it',
  }],
  ['unifyUndo', {
    reason: 'Edit History "Unify Undo" — stored by the panel, read by nothing',
  }],
]);

/** A setting is implemented when engine code ACCESSES it as a property. A bare
 *  word match would count a string or an unrelated identifier. */
const defaultProbe = (key: string) => new RegExp(`\\.\\s*${key}\\b`);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SRC = resolve(__dirname, '../src');
const ENGINE_FILES = sourceFiles(SRC).filter(
  (f) => !TYPES_ONLY.some((d) => f.endsWith(d)) && !RENDERS.some((r) => f.includes(r)),
);
/** Engine code with comment-only lines stripped — a comment mentioning a
 *  setting must not pass for an implementation of it — and, in the settings
 *  file alone, object-literal property lines stripped too. */
const ENGINE = ENGINE_FILES
  .map((f) => {
    const isDefaults = f.endsWith(SETTINGS_FILE);
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => !(isDefaults && /^\s*\w+:\s/.test(line)))
      .join('\n');
  })
  .join('\n');

/**
 * Leaf setting names, one level under each slice.
 *
 * `recordSources` is skipped on purpose: it is read by dynamic index
 * (`settings.recordSources[recordSourceKey(source)]`), which no text scan can
 * see, and it has an exhaustive behavioural test of its own in
 * `edit/journal.test.ts` — the better instrument for it.
 */
function leafKeys(): string[] {
  const out = new Set<string>();
  for (const slice of Object.values(DEFAULT_EDIT_SETTINGS) as Record<string, unknown>[]) {
    for (const [key, value] of Object.entries(slice)) {
      if (key === 'recordSources' || (value && typeof value === 'object' && !Array.isArray(value))) continue;
      out.add(key);
    }
  }
  return [...out];
}

describe('every setting the Editing tab offers is wired to something', () => {
  it('no setting is shown, stored, and then read by no engine code', () => {
    const dead = leafKeys()
      .filter((k) => !KNOWN_UNIMPLEMENTED.has(k))
      .filter((k) => !defaultProbe(k).test(ENGINE));
    expect(
      dead,
      `Editing settings with no implementation: ${dead.join(', ')}\n`
      + 'Implement it, drop it from the panel, or record it in '
      + 'KNOWN_UNIMPLEMENTED with a reason.',
    ).toEqual([]);
  });

  it('every known-unimplemented setting is still genuinely unimplemented', () => {
    // So the list shrinks when someone implements one, rather than outliving
    // the problem and hiding the next regression behind it.
    const nowLive = [...KNOWN_UNIMPLEMENTED.entries()]
      .filter(([k, v]) => (v.probe ?? defaultProbe(k)).test(ENGINE))
      .map(([k]) => k);
    expect(
      nowLive,
      `now implemented — remove from KNOWN_UNIMPLEMENTED: ${nowLive.join(', ')}`,
    ).toEqual([]);
  });

  it('every entry says why', () => {
    for (const [key, v] of KNOWN_UNIMPLEMENTED) {
      expect(v.reason.length, `no reason recorded for '${key}'`).toBeGreaterThan(15);
    }
  });

  it('the settings it checks and the corpus it scans are both real', () => {
    // A scan over an empty corpus, or over no keys, passes everything above
    // while checking nothing at all.
    expect(ENGINE_FILES.length).toBeGreaterThan(20);
    expect(ENGINE).toContain('commitAndMaybeRecord');
    expect(leafKeys().length).toBeGreaterThan(10);
    // And the settings that DO work must be seen as working, or the scan is
    // just reporting everything as dead.
    for (const live of ['enforceSingleColumn', 'maxDropdownValues', 'maxEntries', 'suspended']) {
      expect(defaultProbe(live).test(ENGINE), `${live} should read as live`).toBe(true);
    }
  });
});
