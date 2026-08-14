import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lucideBundle } from '../../src/icons/lucide.generated';
import { extractPaths, joinSubpaths } from '../../src/icons/lucidePathJoin';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Kernel bugfix follow-up (post-21f) — split a `d` string into its
 *  subpaths. Every `M`/`m` occurrence in Lucide's icon data is a moveto
 *  COMMAND (the icon set never uses exponent notation, so `m`/`M` never
 *  appears inside a number) — splitting on that boundary yields exactly
 *  the icon's subpaths. */
function subpathsOf(d: string): string[] {
  return d.split(/(?=[Mm])/).filter((s) => s.length > 0);
}

/** Resolve lucide-static/icons the same way build-lucide.ts does — the
 *  package is a devDependency of @wellsfargo-starui/velocity-grid, so it's present whenever
 *  this test suite runs. */
function findLucideIconsDir(): string {
  const candidates = [
    // monorepo root (hoisted) — tests/icons is the same depth under
    // packages/kernel as src/icons, so this mirrors build-lucide.ts's own resolution.
    join(__dirname, '..', '..', '..', '..', 'node_modules', 'lucide-static', 'icons'),
    // local package node_modules (fallback)
    join(__dirname, '..', '..', 'node_modules', 'lucide-static', 'icons'),
  ];
  for (const candidate of candidates) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      // not here
    }
  }
  throw new Error('[lucide.generated.test] Cannot find lucide-static/icons.');
}

/** Structural proxy for "would `new Path2D(d)` construct correctly" —
 *  happy-dom (the kernel's vitest environment) doesn't implement Path2D,
 *  so we validate the SVG path-data grammar directly: the whole string
 *  must be a sequence of one command letter followed by a (possibly
 *  empty, for Z/z) run of numbers/separators, with nothing else. */
const PATH_GRAMMAR = /^(?:[MLHVCSQTAZmlhvcsqtaz][\s,]*(?:-?\d*\.?\d+[\s,-]*)*)+$/;

describe('Lucide bundle smoke test', () => {
  it('exports at least 1000 icons', () => {
    expect(Object.keys(lucideBundle).length).toBeGreaterThanOrEqual(1000);
  });

  it('circle-only icons (circle, circle-dot, target) are present', () => {
    expect(lucideBundle['circle']).toBeDefined();
    expect(lucideBundle['circle-dot']).toBeDefined();
    expect(lucideBundle['target']).toBeDefined();
  });

  it('circle-check includes the circle ring, not just the tick', () => {
    const d = lucideBundle['circle-check'];
    expect(d).toBeDefined();
    expect(d).toMatch(/a10,10/);
  });

  it('line-only icons like crosshair + battery + voicemail are present (regression: build-lucide line regex)', () => {
    expect(lucideBundle['crosshair']).toBeDefined();
    expect(lucideBundle['battery']).toBeDefined();
    expect(lucideBundle['voicemail']).toBeDefined();
    expect(lucideBundle['equal']).toBeDefined();
  });

  it('has trending-up + trending-down (referenced by design spec)', () => {
    expect(lucideBundle['trending-up']).toBeDefined();
    expect(lucideBundle['trending-down']).toBeDefined();
  });

  it('heart-off (attribute order regression) contains the diagonal slash line', () => {
    // heart-off.svg uses x1 y1 x2 y2 order (unlike other line-using files).
    // Verify the diagonal slash M2,2 L22,22 is present so heart-off is
    // visually distinct from heart.
    expect(lucideBundle['heart-off']).toBeDefined();
    expect(lucideBundle['heart-off']).toContain('M2,2 L22,22');
  });

  it('every entry is a non-empty string', () => {
    for (const [, path] of Object.entries(lucideBundle)) {
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    }
  });

  it('every entry conforms to SVG path-data grammar (Path2D-construction proxy — happy-dom has no real Path2D)', () => {
    const offenders: string[] = [];
    for (const [name, path] of Object.entries(lucideBundle)) {
      if (!PATH_GRAMMAR.test(path)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('every entry matches re-deriving straight from the upstream SVG source (catches ANY join/extraction drift, incl. the "x" corruption)', () => {
    // The strongest form of this regression test: don't guess at a
    // corruption heuristic from the bundle string alone (a naive "no 2nd+
    // subpath may open with lowercase m" scan is a false-positive trap —
    // e.g. twitch.svg is a SINGLE <path> whose `d` legitimately contains
    // several internal lowercase-m subpaths, `M...zm-10 9V7m5 4V7`, which
    // were never part of a join and were never broken). Instead, re-run
    // the exact same pure extraction+join used by `build-lucide.ts`
    // (imported from `lucidePathJoin.ts`, not re-implemented here) against
    // every upstream SVG and diff the result against the committed bundle.
    // Before the join fix, this would have failed for ~449 icons
    // (including 'x') whose 2nd+ `<path>` began with a relative moveto.
    const iconsDir = findLucideIconsDir();
    const offenders: string[] = [];
    let checked = 0;
    for (const file of readdirSync(iconsDir)) {
      if (!file.endsWith('.svg')) continue;
      const name = file.slice(0, -4);
      const svg = readFileSync(join(iconsDir, file), 'utf8');
      const paths = extractPaths(svg);
      if (paths.length === 0) continue;
      checked++;
      const expected = joinSubpaths(paths);
      if (lucideBundle[name] !== expected) offenders.push(name);
    }
    expect(checked).toBeGreaterThan(1000); // sanity — we actually scanned the set
    expect(offenders).toEqual([]);
  });

  it('"x" — the reported case — has exactly 2 subpaths, both absolute, forming two independent diagonal strokes', () => {
    const x = lucideBundle['x'];
    expect(x).toBeDefined();
    const subpaths = subpathsOf(x as string);
    expect(subpaths).toHaveLength(2);
    expect(subpaths[0]).toMatch(/^M/);
    expect(subpaths[1]).toMatch(/^M/); // was 'm6 6 12 12' pre-fix — the corrupted case
    expect(PATH_GRAMMAR.test(x as string)).toBe(true);
  });
});
