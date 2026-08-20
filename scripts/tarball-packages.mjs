/**
 * Packages packed by `npm run build:tarballs` and consumed as `file:`
 * dependencies by the standalone React / Angular example apps.
 */
export const TARBALL_PACKAGES = [
  'packages/kernel',
  'packages/ext',
  'packages/data',
  'packages/perspective',
];

/**
 * Meta-package that depends on every package above — packed separately
 * from TARBALL_PACKAGES since it's not a `file:` dependency of the example
 * apps (see packages/all/README.md for why it can't be installed standalone
 * yet, and scripts/install-tarballs-into.mjs for the local alternative).
 */
export const META_PACKAGE = 'packages/all';

export function npmPackFileName(packageName, version = '0.0.0') {
  return `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
}

/** `file:` deps relative to `examples/<app>/package.json`. */
export function exampleTarballDeps(relativeDir = '../../dist/tarballs') {
  return {
    '@wellsfargo-starui/velocity-grid': `file:${relativeDir}/wellsfargo-starui-velocity-grid-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-ext': `file:${relativeDir}/wellsfargo-starui-velocity-grid-ext-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-data': `file:${relativeDir}/wellsfargo-starui-velocity-grid-data-0.0.0.tgz`,
    '@wellsfargo-starui/velocity-grid-perspective': `file:${relativeDir}/wellsfargo-starui-velocity-grid-perspective-0.0.0.tgz`,
  };
}
