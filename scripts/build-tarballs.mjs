#!/usr/bin/env node
/**
 * Build and package grid distributions as tarballs.
 * Usage: node scripts/build-tarballs.mjs
 *
 * Writes stable names (no date suffix) under dist/tarballs/ so example apps
 * can depend on `file:../../dist/tarballs/<name>-0.0.0.tgz`.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARBALL_PACKAGES, META_PACKAGE, npmPackFileName } from './tarball-packages.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const tarballDir = join(root, 'dist', 'tarballs');
const timestamp = new Date().toISOString().split('T')[0];

// The meta-package (packages/all) is packed alongside the individually
// consumed packages so a tarball is ready the moment publishing makes it
// usable — see packages/all/README.md.
const packagesToPack = [...TARBALL_PACKAGES, META_PACKAGE];

// Clear any prior output so a failed pack below can never leave a stale
// tarball behind to be silently reused by a later install.
if (existsSync(tarballDir)) {
  rmSync(tarballDir, { recursive: true, force: true });
}
mkdirSync(tarballDir, { recursive: true });

console.log(`📦 Building tarballs for ${packagesToPack.length} packages...\n`);

console.log('🔨 Building kernel dist (other packs are source-direct)...');
execSync('npm run build --workspace=@wellsfargo-starui/velocity-grid', {
  cwd: root,
  stdio: 'inherit',
});

const tarballs = [];
const failures = [];
for (const pkg of packagesToPack) {
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
    const before = new Set(existsSync(tarballDir) ? readdirSync(tarballDir) : []);
    const output = execSync(`npm pack --pack-destination "${tarballDir}" --json`, {
      cwd: pkgPath,
      stdio: 'pipe',
    }).toString('utf-8');
    const [packed] = JSON.parse(output);
    const actualName = packed?.filename;

    if (!actualName) {
      throw new Error('npm pack --json produced no filename');
    }
    if (actualName !== tarballName) {
      throw new Error(
        `npm pack wrote '${actualName}' but predicted '${tarballName}' — npmPackFileName() is out of sync`,
      );
    }
    if (!existsSync(tarballPath)) {
      throw new Error(`expected tarball not found at ${tarballPath} after npm pack`);
    }
    const after = new Set(readdirSync(tarballDir));
    const unexpected = [...after].filter((f) => !before.has(f) && f !== tarballName);
    if (unexpected.length) {
      throw new Error(`npm pack wrote unexpected extra file(s): ${unexpected.join(', ')}`);
    }

    tarballs.push({ name: pkgJson.name, tarball: tarballName });
    console.log(`  ✓ ${tarballName}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ Failed to pack ${pkgJson.name}: ${msg}`);
    failures.push({ name: pkgJson.name, error: msg });
    process.exitCode = 1;
  }
}

const manifest = {
  version: '1.0',
  buildDate: timestamp,
  packages: tarballs,
  failures: failures.length ? failures.map((f) => f.name) : undefined,
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

if (failures.length) {
  console.log(`\n❌ ${failures.length} package(s) failed to pack — dist/tarballs/ is incomplete\n`);
  failures.forEach((f) => console.log(`   • ${f.name}: ${f.error}`));
} else {
  console.log(`\n✅ Tarballs created in dist/tarballs/\n`);
}
console.log(`📋 Packed ${tarballs.length} packages:`);
tarballs.forEach((t) => console.log(`   • ${t.tarball}`));
console.log(`\n📄 See dist/tarballs/README.md\n`);
