# @wellsfargo-starui/velocity-grid-all

Meta-package for VelocityGrid. Installing this one package pulls in every
`@wellsfargo-starui/velocity-grid-*` package as a normal dependency — it
contains no code itself, just a `package.json` listing all 14.

## Status: not usable standalone yet

This only works once the 14 packages it depends on are actually published
somewhere npm can fetch them from (a private registry, GitHub Packages,
etc.) — right now they exist only as locally-packed tarballs, and npm
can't resolve a bare version dependency (`"0.0.0"`) against a package
that isn't published anywhere.

The package is built and packed now so it's ready to use the moment
publishing happens — at that point `npm install @wellsfargo-starui/velocity-grid-all`
is all a consumer needs.

**Until then**, to install all 14 packages at once from the local
tarballs, use `node scripts/install-tarballs-into.mjs <target-dir>` from
the repo root instead — see that script's header comment.

## Keeping this in sync

The dependency list here is the same 14 packages listed in
`scripts/tarball-packages.mjs`'s `TARBALL_PACKAGES`. If a package is
added to or removed from that list, update this `package.json` to match.
