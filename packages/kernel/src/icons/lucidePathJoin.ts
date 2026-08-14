// Pure SVG `d`-string extraction/join helpers for the Lucide icon bundle
// generator (`build-lucide.ts`). Split out into their own module (no I/O)
// so `tests/icons/lucide.generated.test.ts` can re-derive the bundle
// straight from the upstream SVGs and diff it against the committed
// `lucide.generated.ts` — the strongest possible regression test for the
// join-corruption bug this module's `joinSubpaths` fixes.

/** Kernel bugfix follow-up (post-21f) — join independently-authored
 *  `<path d="...">` strings into ONE combined `d` string for the bundle,
 *  correcting for a subtle SVG-spec interaction that corrupted every
 *  multi-path icon whose 2nd+ path started with a *relative* moveto
 *  (lowercase `m`), e.g. lucide's `x.svg`:
 *    <path d="M18 6 6 18" />
 *    <path d="m6 6 12 12" />
 *  Per the SVG path grammar, "if a relative moveto (m) appears as the
 *  FIRST element of a path, it is treated as an absolute moveto" — but
 *  that rule only fires once, for the first command of the whole `d`
 *  string. Naively concatenating the two `d` values with a space
 *  (`paths.join(' ')`, the previous implementation) meant the second
 *  path's leading `m6 6` was interpreted as *relative to the endpoint of
 *  the first path* (6,18) instead of as an absolute (6,6) — landing the
 *  second stroke at the wrong place entirely (only 'x' was independently
 *  confirmed by two reviewers, but the same join bug affected ~449 of the
 *  bundle's ~1500 icons).
 *
 *  Fix: for every subpath after the first, if it opens with a lowercase
 *  `m`, rewrite its leading coordinate pair as an absolute `M` (correct,
 *  since a standalone path's first moveto is absolute by the same rule)
 *  and — critically — re-anchor any *implicit* trailing coordinate pairs
 *  (lucide often packs multiple lineto pairs onto one `m`/`M`, e.g.
 *  `m2 16 4.5-9 4.5 9`) behind an explicit lowercase `l` so they keep
 *  their original *relative* meaning instead of inheriting the new `M`'s
 *  absolute one. Note: this only ever touches the LEADING command of each
 *  array entry — i.e. the join seam between originally-separate `<path>`
 *  elements. A single `<path d="...">` that legitimately contains several
 *  internal `m` subpaths (e.g. `twitch.svg`'s `M...zm-10 9V7m5 4V7`) is
 *  passed through untouched at index 0 and is never itself split into
 *  multiple `paths[]` array entries, so it's correctly left alone. */
export function joinSubpaths(paths: string[]): string {
  return paths.map((seg, i) => (i === 0 ? seg : fixLeadingRelativeMoveto(seg))).join(' ');
}

const COMMAND_LETTER = /[MLHVCSQTAZmlhvcsqtaz]/;
const NUMBER_TOKEN = /-?\d*\.?\d+/g;

export function fixLeadingRelativeMoveto(seg: string): string {
  const lead = /^m[\s,]*/.exec(seg);
  if (!lead) return seg; // already absolute (M…) or something else — untouched
  const afterM = seg.slice(lead[0].length);
  const cmdIdx = afterM.search(COMMAND_LETTER);
  const numbersRun = cmdIdx === -1 ? afterM : afterM.slice(0, cmdIdx);
  const rest = cmdIdx === -1 ? '' : afterM.slice(cmdIdx);

  NUMBER_TOKEN.lastIndex = 0;
  const tokenEnds: number[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = NUMBER_TOKEN.exec(numbersRun)) !== null) {
    tokenEnds.push(tm.index + tm[0].length);
    if (tokenEnds.length === 2) break;
  }
  if (tokenEnds.length < 2) return `M${numbersRun}${rest}`; // degenerate — just uppercase

  const boundary = tokenEnds[1] as number;
  const firstPair = numbersRun.slice(0, boundary);
  const remainder = numbersRun.slice(boundary);
  // No trailing implicit pairs → plain absolute moveto suffices.
  if (remainder.trim().length === 0) return `M${firstPair}${rest}`;
  // Trailing implicit pairs existed under the original relative `m` —
  // keep them relative via an explicit lowercase `l`.
  return `M${firstPair} l${remainder}${rest}`;
}

/** Extract every drawable primitive from a Lucide SVG source as an array
 *  of independent path-data (`d`-string) segments, in document order. */
export function extractPaths(svg: string): string[] {
  const paths: string[] = [];

  // <path d="...">
  const rePathD = /<path[^>]*\sd="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rePathD.exec(svg)) !== null) paths.push(m[1] as string);

  // <polyline points="x1,y1 x2,y2 ..."> → convert to M … L … path data
  const rePolyline = /<polyline[^>]*\spoints="([^"]+)"/g;
  while ((m = rePolyline.exec(svg)) !== null) {
    const pts = (m[1] as string).trim().split(/[\s,]+/);
    if (pts.length >= 2) {
      const pairs: string[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        pairs.push(`${pts[i] as string},${pts[i + 1] as string}`);
      }
      paths.push('M' + pairs.join(' L'));
    }
  }

  // <line> extraction — supports both x1 x2 y1 y2 (140 files in lucide-static
  // v0.469.0) and x1 y1 x2 y2 (heart-off.svg specifically). Two regexes cover
  // all observed orderings; deduplicate emitted paths in case a future SVG
  // file matches both.
  const reLineXXYY = /<line[^>]*\sx1="([^"]+)"[^>]*\sx2="([^"]+)"[^>]*\sy1="([^"]+)"[^>]*\sy2="([^"]+)"/g;
  const reLineXYXY = /<line[^>]*\sx1="([^"]+)"[^>]*\sy1="([^"]+)"[^>]*\sx2="([^"]+)"[^>]*\sy2="([^"]+)"/g;
  const emittedLines = new Set<string>();
  while ((m = reLineXXYY.exec(svg)) !== null) {
    emittedLines.add(`M${m[1] as string},${m[3] as string} L${m[2] as string},${m[4] as string}`);
  }
  while ((m = reLineXYXY.exec(svg)) !== null) {
    emittedLines.add(`M${m[1] as string},${m[2] as string} L${m[3] as string},${m[4] as string}`);
  }
  for (const path of emittedLines) paths.push(path);

  // <circle cx cy r> → two-arc path so stroke-only Lucide rings survive
  // path-only bundling (circle, circle-dot, target, and the ring on
  // circle-check / circle-x / circle-alert / clock).
  const reCircle = /<circle\b[^>]*>/g;
  while ((m = reCircle.exec(svg)) !== null) {
    const tag = m[0];
    const cx = Number(attr(tag, 'cx') ?? 0);
    const cy = Number(attr(tag, 'cy') ?? 0);
    const r = Number(attr(tag, 'r') ?? 0);
    if (!(r > 0)) continue;
    paths.push(`M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`);
  }

  // <rect x y width height rx ry>
  const reRect = /<rect\b[^>]*>/g;
  while ((m = reRect.exec(svg)) !== null) {
    const tag = m[0];
    const x = Number(attr(tag, 'x') ?? 0);
    const y = Number(attr(tag, 'y') ?? 0);
    const w = Number(attr(tag, 'width') ?? 0);
    const h = Number(attr(tag, 'height') ?? 0);
    if (!(w > 0 && h > 0)) continue;
    const rx = Number(attr(tag, 'rx') ?? attr(tag, 'ry') ?? 0);
    const ry = Number(attr(tag, 'ry') ?? attr(tag, 'rx') ?? 0);
    paths.push(rectToPath(x, y, w, h, rx, ry));
  }

  return paths;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]+)"`).exec(tag);
  return m?.[1];
}

function rectToPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  const rdx = Math.min(Math.max(rx, 0), w / 2);
  const rdy = Math.min(Math.max(ry, 0), h / 2);
  if (rdx === 0 && rdy === 0) {
    return `M${x},${y}h${w}v${h}h${-w}z`;
  }
  return [
    `M${x + rdx},${y}`,
    `h${w - 2 * rdx}`,
    `a${rdx},${rdy} 0 0 1 ${rdx},${rdy}`,
    `v${h - 2 * rdy}`,
    `a${rdx},${rdy} 0 0 1 ${-rdx},${rdy}`,
    `h${-(w - 2 * rdx)}`,
    `a${rdx},${rdy} 0 0 1 ${-rdx},${-rdy}`,
    `v${-(h - 2 * rdy)}`,
    `a${rdx},${rdy} 0 0 1 ${rdx},${-rdy}`,
    'z',
  ].join('');
}
