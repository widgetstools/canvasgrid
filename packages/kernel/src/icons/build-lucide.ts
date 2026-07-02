// Build script: reads node_modules/lucide-static/icons/*.svg and emits
// packages/kernel/src/icons/lucide.generated.ts with a Record<name, path>.
// Committed to git; regenerate via `npm run prebuild-icons`.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve lucide-static from the monorepo root (hoisted) or local node_modules.
function findLucideIconsDir(): string {
  const candidates = [
    // monorepo root (hoisted)
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
  throw new Error(
    '[build-lucide] Cannot find lucide-static/icons. Run: npm install --save-dev --workspace=@cgrid/kernel lucide-static',
  );
}

const iconsDir = findLucideIconsDir();
const outputPath = join(__dirname, 'lucide.generated.ts');

const bundle: Record<string, string> = {};
for (const file of readdirSync(iconsDir)) {
  if (!file.endsWith('.svg')) continue;
  const name = file.slice(0, -4);
  const svg = readFileSync(join(iconsDir, file), 'utf8');
  const paths = extractPaths(svg);
  if (paths.length > 0) bundle[name] = paths.join(' ');
}

const sorted = Object.fromEntries(Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(
  outputPath,
  `// AUTO-GENERATED — do not edit. Regenerate via \`npm --workspace @cgrid/kernel run prebuild-icons\`.
// Source: node_modules/lucide-static/icons/*.svg (Lucide MIT license).
export const lucideBundle: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(sorted, null, 2)});
`,
);
console.log(`[build-lucide] wrote ${Object.keys(sorted).length} icons to ${outputPath}`);

function extractPaths(svg: string): string[] {
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

  return paths;
}
