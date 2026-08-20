#!/usr/bin/env node
/**
 * Install every VelocityGrid package into an external project in one
 * command, straight from the local tarballs — no registry needed.
 *
 * Usage:
 *   npm run build:tarballs                                (if not already built)
 *   node scripts/install-tarballs-into.mjs <target-project-dir>
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARBALL_PACKAGES, npmPackFileName } from './tarball-packages.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const target = process.argv[2];

if (!target) {
  console.error('Usage: node scripts/install-tarballs-into.mjs <target-project-dir>');
  process.exit(1);
}

const targetDir = resolve(target);
if (!existsSync(targetDir)) {
  console.error(`Target directory does not exist: ${targetDir}`);
  process.exit(1);
}

const tarballDir = join(root, 'dist', 'tarballs');
const tgzPaths = [];
const missing = [];
for (const pkg of TARBALL_PACKAGES) {
  const pkgJsonPath = join(root, pkg, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  const { name, version = '0.0.0' } = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const tgzPath = join(tarballDir, npmPackFileName(name, version));
  if (existsSync(tgzPath)) {
    tgzPaths.push(tgzPath);
  } else {
    missing.push(tgzPath);
  }
}

if (missing.length) {
  console.error(
    `Missing tarball(s) — run "npm run build:tarballs" first:\n${missing.map((p) => `  - ${p}`).join('\n')}`,
  );
  process.exit(1);
}

if (!existsSync(join(targetDir, 'package.json'))) {
  console.log(`No package.json in ${targetDir} — creating one...`);
  execSync('npm init -y', { cwd: targetDir, stdio: 'inherit' });
}

// Copy the tarballs into the target project itself rather than installing
// a `file:` reference back to this repo's dist/tarballs/ — otherwise a
// later `npm ci`/`npm install` in the target breaks the moment this repo
// is cleaned up or moved. This makes the target project genuinely
// self-contained.
const vendorDir = join(targetDir, 'vendor', 'velocity-grid-tarballs');
mkdirSync(vendorDir, { recursive: true });
const localTgzPaths = tgzPaths.map((p) => {
  const dest = join(vendorDir, basename(p));
  copyFileSync(p, dest);
  return dest;
});

console.log(`\nInstalling ${localTgzPaths.length} VelocityGrid packages into ${targetDir}...\n`);
execSync(`npm install ${localTgzPaths.map((p) => `"${p}"`).join(' ')}`, { cwd: targetDir, stdio: 'inherit' });

console.log('\nDone. Installed (vendored into ./vendor/velocity-grid-tarballs/, safe to commit):');
localTgzPaths.forEach((p) => console.log(`  - ${basename(p)}`));
