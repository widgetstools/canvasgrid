#!/usr/bin/env node
/**
 * Rebuild tarballs, then cleanly reinstall the standalone example apps so
 * they resolve @wellsfargo-starui/* from dist/tarballs/*.tgz (not the
 * workspace).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARBALL_PACKAGES, npmPackFileName, exampleTarballDeps } from './tarball-packages.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const examples = ['cgrid-ext-react', 'cgrid-ext-angular', 'cgrid-ext-angular-ssrm'];

console.log('1/2  Packing tarballs…');
execSync('node scripts/build-tarballs.mjs', { cwd: root, stdio: 'inherit' });

const missing = [];
for (const pkg of TARBALL_PACKAGES) {
  const pkgJsonPath = join(root, pkg, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  const { name, version = '0.0.0' } = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const tgzPath = join(root, 'dist/tarballs', npmPackFileName(name, version));
  if (!existsSync(tgzPath)) missing.push(tgzPath);
}
if (missing.length) {
  throw new Error(
    `Tarball build did not produce all expected packages. Missing:\n` +
      missing.map((p) => `  - ${p}`).join('\n'),
  );
}

const expectedDeps = exampleTarballDeps();
for (const name of examples) {
  const pkgJsonPath = join(root, 'examples', name, 'package.json');
  const { dependencies = {} } = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const drift = Object.entries(expectedDeps).filter(
    ([dep, spec]) => dependencies[dep] !== spec,
  );
  if (drift.length) {
    throw new Error(
      `examples/${name}/package.json dependencies drifted from scripts/tarball-packages.mjs:\n` +
        drift.map(([dep, spec]) => `  - ${dep}: expected "${spec}", found "${dependencies[dep] ?? '(missing)'}"`).join('\n'),
    );
  }
}

console.log('\n2/2  Installing example apps from tarballs…');
for (const name of examples) {
  const cwd = join(root, 'examples', name);
  console.log(`\n→ Installing ${name} from tarballs…`);
  // `npm install`/`npm ci` both trust an existing package-lock.json's
  // recorded integrity for an unchanged `file:<name>.tgz` specifier and can
  // skip re-extracting it even though the tarball's *contents* changed
  // underneath the same filename (as they do here on every rebuild) —
  // silently reinstalling stale package contents. Force a from-scratch
  // resolve so the freshly packed tarballs are actually picked up.
  rmSync(join(cwd, 'node_modules'), { recursive: true, force: true });
  rmSync(join(cwd, 'package-lock.json'), { force: true });
  execSync('npm install', { cwd, stdio: 'inherit' });
}

console.log('\nDone. Start with:');
console.log('  npm run dev:ext-react');
console.log('  npm run dev:ext-angular');
console.log('  npm run dev:ext-angular-ssrm');
