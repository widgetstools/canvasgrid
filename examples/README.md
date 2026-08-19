# VelocityGridExt consumer examples

Standalone apps **outside** the npm workspace. They install
`@wellsfargo-starui/velocity-grid*` from `dist/tarballs/*.tgz`, the same way a
React or Angular host would after `npm pack`.

## One-time setup

From the repo root:

```bash
npm run examples:install
```

That rebuilds every package tarball, then runs `npm install` in each example.

## Run

```bash
npm run dev:ext-react           # http://localhost:5202
npm run dev:ext-angular         # http://localhost:5203
npm run dev:ext-angular-ssrm    # http://localhost:5204 — Angular 16.1 SSRM + AppData
```

Rebuild tarballs and reinstall after changing kernel / ext source:

```bash
npm run examples:install
```
