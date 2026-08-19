/**
 * Packages packed by `npm run build:tarballs` and consumed as `file:`
 * dependencies by the standalone React / Angular example apps.
 */
export const TARBALL_PACKAGES = [
  'packages/kernel',
  'packages/ext',
  'packages/customizer',
  'packages/data',
  'packages/calc',
  'packages/format',
  'packages/rules',
  'packages/edit',
  'packages/renderers',
  'packages/expression',
  'packages/perspective',
  'packages/storage',
  'packages/appdata',
  'packages/export',
];

export function npmPackFileName(packageName, version = '0.0.0') {
  return `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
}

/** `file:` deps relative to `examples/<app>/package.json`. */
export function exampleTarballDeps(relativeDir = '../../dist/tarballs') {
  return {
    '@wellsfargo-starui/velocity-grid': `file:${relativeDir}/wellsfargo-starui-velocity-grid-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-ext': `file:${relativeDir}/wellsfargo-starui-velocity-grid-ext-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-customizer': `file:${relativeDir}/wellsfargo-starui-velocity-grid-customizer-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-data': `file:${relativeDir}/wellsfargo-starui-velocity-grid-data-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-calc': `file:${relativeDir}/wellsfargo-starui-velocity-grid-calc-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-format': `file:${relativeDir}/wellsfargo-starui-velocity-grid-format-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-rules': `file:${relativeDir}/wellsfargo-starui-velocity-grid-rules-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-edit': `file:${relativeDir}/wellsfargo-starui-velocity-grid-edit-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-renderers': `file:${relativeDir}/wellsfargo-starui-velocity-grid-renderers-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-expression': `file:${relativeDir}/wellsfargo-starui-velocity-grid-expression-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-perspective': `file:${relativeDir}/wellsfargo-starui-velocity-grid-perspective-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-storage': `file:${relativeDir}/wellsfargo-starui-velocity-grid-storage-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-appdata': `file:${relativeDir}/wellsfargo-starui-velocity-grid-appdata-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-export': `file:${relativeDir}/wellsfargo-starui-velocity-grid-export-0.0.0.tgz`,
  };
}
