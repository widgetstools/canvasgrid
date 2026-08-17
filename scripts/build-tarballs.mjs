#!/usr/bin/env node
/**
 * Build and package grid distributions as tarballs
 * Usage: node scripts/build-tarballs.mjs
 *
 * Creates distribution tarballs in dist/tarballs/ for:
 * - @wellsfargo-starui/velocity-grid (kernel)
 * - @wellsfargo-starui/velocity-grid-ext (customizer)
 * - Supporting feature packages
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const tarballDir = join(root, 'dist', 'tarballs');
const timestamp = new Date().toISOString().split('T')[0];

// Create output directory
if (!existsSync(tarballDir)) {
  mkdirSync(tarballDir, { recursive: true });
}

const packages = [
  'packages/kernel',           // @wellsfargo-starui/velocity-grid
  'packages/ext',              // @wellsfargo-starui/velocity-grid-ext
  'packages/customizer',       // @wellsfargo-starui/velocity-grid-customizer
  'packages/data',             // @wellsfargo-starui/velocity-grid-data
  'packages/calc',             // @wellsfargo-starui/velocity-grid-calc
  'packages/format',           // @wellsfargo-starui/velocity-grid-format
  'packages/rules',            // @wellsfargo-starui/velocity-grid-rules
  'packages/edit',             // @wellsfargo-starui/velocity-grid-edit
  'packages/renderers',        // @wellsfargo-starui/velocity-grid-renderers
  'packages/expression',       // @wellsfargo-starui/velocity-grid-expression
  'packages/perspective',      // @wellsfargo-starui/velocity-grid-perspective
  'packages/storage',          // @wellsfargo-starui/velocity-grid-storage
];

console.log(`📦 Building tarballs for ${packages.length} packages...\n`);

// First, ensure core packages are built (skip demo apps if they fail)
console.log('🔨 Building core packages...');
try {
  execSync('npm run build', { cwd: root, stdio: 'pipe' });
} catch (e) {
  console.log('⚠️  Some packages failed to build (likely demo apps), continuing with available builds...');
}

// Create tarballs
const tarballs = [];
for (const pkg of packages) {
  const pkgPath = join(root, pkg);
  const pkgJsonPath = join(pkgPath, 'package.json');

  if (!existsSync(pkgJsonPath)) {
    console.log(`⚠️  Skipping ${pkg} (no package.json)`);
    continue;
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const name = pkgJson.name.replace('@', '').replace('/', '-');
  const version = pkgJson.version || '0.0.0';
  const tarballName = `${name}-${version}-${timestamp}.tgz`;
  const tarballPath = join(tarballDir, tarballName);

  try {
    console.log(`📦 Packing ${pkgJson.name}...`);
    execSync(`npm pack --pack-destination "${tarballDir}"`, {
      cwd: pkgPath,
      stdio: 'pipe'
    });

    // Rename to include timestamp
    const defaultTarball = join(tarballDir, `${name}-${version}.tgz`);
    if (existsSync(defaultTarball) && defaultTarball !== tarballPath) {
      execSync(`mv "${defaultTarball}" "${tarballPath}"`);
    }

    tarballs.push({ name: pkgJson.name, tarball: tarballName });
    console.log(`  ✓ ${tarballName}`);
  } catch (e) {
    console.log(`  ✗ Failed to pack ${pkgJson.name}`);
  }
}

// Create manifest
const manifest = {
  version: '1.0',
  buildDate: timestamp,
  packages: tarballs,
  installGuide: `
## Installation from Tarballs

### Option 1: Direct Installation (Recommended)

\`\`\`bash
# Install directly from tarball
npm install ./wellsfargo-starui-velocity-grid-0.0.0-${timestamp}.tgz
npm install ./wellsfargo-starui-velocity-grid-ext-0.0.0-${timestamp}.tgz
\`\`\`

### Option 2: Add to package.json

\`\`\`json
{
  "dependencies": {
    "@wellsfargo-starui/velocity-grid": "file:./tarballs/wellsfargo-starui-velocity-grid-0.0.0-${timestamp}.tgz",
    "@wellsfargo-starui/velocity-grid-ext": "file:./tarballs/wellsfargo-starui-velocity-grid-ext-0.0.0-${timestamp}.tgz"
  }
}
\`\`\`

Then run: \`npm install\`

### Option 3: Global Installation (Dev)

\`\`\`bash
npm install -g ./wellsfargo-starui-velocity-grid-0.0.0-${timestamp}.tgz
\`\`\`

## Usage

After installation, import the grid:

\`\`\`typescript
import { CGridApi } from '@wellsfargo-starui/velocity-grid';
import { VelocityGridExt } from '@wellsfargo-starui/velocity-grid-ext';
\`\`\`

## Troubleshooting

**"Cannot find module" errors:**
- Ensure all dependencies are installed: \`npm install\`
- Check that peer dependencies match (Node 22+, npm 10+)

**"Module not found" in dist/:**
- Some packages require build artifacts in dist/
- Run \`npm run build\` after installation

**Web Worker issues:**
- The grid kernel expects \`velocity-grid.js\` to be co-located with \`worker.js\`
- If using in a bundler, ensure the kernel dist is not pre-bundled
  `,
};

const manifestPath = join(tarballDir, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Create README
const readmePath = join(tarballDir, 'README.md');
const readmeContent = `# VelocityGrid Distribution (${timestamp})

Built tarballs for offline or air-gapped installation.

## Contents

${tarballs.map(t => `- \`${t.tarball}\` — ${t.name}`).join('\n')}

${manifest.installGuide}

## Requirements

- Node 22+
- npm 10+

## Bundle Size

| Package | Size |
|---------|------|
${tarballs.map(t => {
  const tarballPath = join(tarballDir, t.tarball);
  if (existsSync(tarballPath)) {
    const stat = statSync(tarballPath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
    return `| ${t.name} | ${sizeMB} MB |`;
  }
  return `| ${t.name} | ? |`;
}).join('\n')}

## Version Info

- Build Date: ${timestamp}
- Manifest: \`manifest.json\`

---

Created: ${new Date().toISOString()}
`;

writeFileSync(readmePath, readmeContent);

console.log(`\n✅ Tarballs created in dist/tarballs/\n`);
console.log(`📋 Created ${tarballs.length} packages:`);
tarballs.forEach(t => console.log(`   • ${t.tarball}`));
console.log(`\n📄 See dist/tarballs/README.md for installation instructions\n`);
