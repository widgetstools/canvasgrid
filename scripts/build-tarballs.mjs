#!/usr/bin/env node
/**
 * Build and package grid distributions as tarballs.
 * Usage: node scripts/build-tarballs.mjs
 *
 * Writes stable names (no date suffix) under dist/tarballs/ so example apps
 * can depend on `file:../../dist/tarballs/<name>-0.0.0.tgz`.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARBALL_PACKAGES, npmPackFileName } from './tarball-packages.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const tarballDir = join(root, 'dist', 'tarballs');
const timestamp = new Date().toISOString().split('T')[0];

if (!existsSync(tarballDir)) {
  mkdirSync(tarballDir, { recursive: true });
}

console.log(`📦 Building tarballs for ${TARBALL_PACKAGES.length} packages...\n`);

console.log('🔨 Building kernel dist (other packs are source-direct)...');
execSync('npm run build --workspace=@wellsfargo-starui/velocity-grid', {
  cwd: root,
  stdio: 'inherit',
});

const tarballs = [];
for (const pkg of TARBALL_PACKAGES) {
  const pkgPath = join(root, pkg);
  const pkgJsonPath = join(pkgPath, 'package.json');

  if (!existsSync(pkgJsonPath)) {
    console.log(`⚠️  Skipping ${pkg} (no package.json)`);
    continue;
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const version = pkgJson.version || '0.0.0';
  const tarballName = npmPackFileName(pkgJson.name, version);
  const tarballPath = join(tarballDir, tarballName);

  try {
    console.log(`📦 Packing ${pkgJson.name}...`);
    execSync(`npm pack --pack-destination "${tarballDir}"`, {
      cwd: pkgPath,
      stdio: 'pipe',
    });
    if (existsSync(tarballPath)) {
      // npm pack already wrote the stable name — keep it.
    }
    tarballs.push({ name: pkgJson.name, tarball: tarballName });
    console.log(`  ✓ ${tarballName}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ Failed to pack ${pkgJson.name}: ${msg}`);
  }
}

const manifest = {
  version: '1.0',
  buildDate: timestamp,
  packages: tarballs,
};

writeFileSync(join(tarballDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const sizeRows = tarballs.map((t) => {
  const p = join(tarballDir, t.tarball);
  if (!existsSync(p)) return `| ${t.name} | ? |`;
  const sizeMB = (statSync(p).size / 1024 / 1024).toFixed(2);
  return `| ${t.name} | ${sizeMB} MB |`;
});

writeFileSync(join(tarballDir, 'README.md'), `# VelocityGrid Distribution (${timestamp})

Built tarballs for offline / example-app installation.

## Contents

${tarballs.map((t) => `- \`${t.tarball}\` — ${t.name}`).join('\n')}

## Install into the example apps

From the repo root:

\`\`\`bash
npm run build:tarballs
npm run examples:install
npm run dev:ext-react      # http://localhost:5202
npm run dev:ext-angular    # http://localhost:5203
\`\`\`

The React and Angular apps live under \`examples/\` (outside the npm workspace)
and depend on these tarballs via \`file:\` so they behave like third-party
consumers.

## Bundle size

| Package | Size |
|---------|------|
${sizeRows.join('\n')}

Created: ${new Date().toISOString()}
`);

console.log(`\n✅ Tarballs created in dist/tarballs/\n`);
console.log(`📋 Packed ${tarballs.length} packages:`);
tarballs.forEach((t) => console.log(`   • ${t.tarball}`));
console.log(`\n📄 See dist/tarballs/README.md\n`);
