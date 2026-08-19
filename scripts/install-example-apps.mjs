#!/usr/bin/env node
/**
 * Rebuild tarballs, then `npm install` the standalone example apps so they
 * resolve @wellsfargo-starui/* from dist/tarballs/*.tgz (not the workspace).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const examples = ['cgrid-ext-react', 'cgrid-ext-angular', 'cgrid-ext-angular-ssrm'];

console.log('1/2  Packing tarballs…');
execSync('node scripts/build-tarballs.mjs', { cwd: root, stdio: 'inherit' });

const kernelTgz = join(root, 'dist/tarballs/wellsfargo-starui-velocity-grid-0.0.0.tgz');
if (!existsSync(kernelTgz)) {
  throw new Error(`Missing ${kernelTgz} — tarball build did not produce the kernel pack.`);
}

console.log('\n2/2  Installing example apps from tarballs…');
for (const name of examples) {
  const cwd = join(root, 'examples', name);
  console.log(`\n→ npm install (${name})`);
  execSync('npm install', { cwd, stdio: 'inherit' });
}

console.log('\nDone. Start with:');
console.log('  npm run dev:ext-react');
console.log('  npm run dev:ext-angular');
console.log('  npm run dev:ext-angular-ssrm');
