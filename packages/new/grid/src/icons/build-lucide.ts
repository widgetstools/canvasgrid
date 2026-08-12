// Build script: reads node_modules/lucide-static/icons/*.svg and emits
// packages/kernel/src/icons/lucide.generated.ts with a Record<name, path>.
// Committed to git; regenerate via `npm run prebuild-icons`.
//
// Extraction + multi-path join logic lives in `lucidePathJoin.ts` (pure,
// no I/O) so `tests/icons/lucide.generated.test.ts` can re-derive the
// bundle from source and diff it against the committed output — see that
// module's header comment for the join-corruption bug this fixes.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPaths, joinSubpaths } from './lucidePathJoin';

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
    '[build-lucide] Cannot find lucide-static/icons. Run: npm install --save-dev --workspace=@wellsfargo-starui/velocity-grid lucide-static',
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
  if (paths.length > 0) bundle[name] = joinSubpaths(paths);
}

const sorted = Object.fromEntries(Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(
  outputPath,
  `// AUTO-GENERATED — do not edit. Regenerate via \`npm --workspace @wellsfargo-starui/velocity-grid run prebuild-icons\`.
// Source: node_modules/lucide-static/icons/*.svg (Lucide MIT license).
export const lucideBundle: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(sorted, null, 2)});
`,
);
console.log(`[build-lucide] wrote ${Object.keys(sorted).length} icons to ${outputPath}`);
