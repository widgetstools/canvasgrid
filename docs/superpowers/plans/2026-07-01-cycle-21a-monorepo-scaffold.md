# Cycle 21a — Turborepo Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate cgrid from a single-package npm workspace to a turborepo-managed monorepo with 10 `@cgrid/*` packages (kernel + 9 empty scaffolds), all consumer apps updated, one PR.

**Architecture:** Root turborepo pipeline drives all packages under `packages/*`. Current `cgrid/` becomes `packages/kernel/` renamed from `cgrid` → `@wellsfargo-starui/velocity-grid`. Nine new empty packages scaffold the target dependency graph from Cycle 21 spec §3 so future feature-absorption cycles (21b–i) land in the correct package from day one. Lockstep version bumps (all packages share `"version": "0.0.0"` initially). Consumer apps (`cgrid-positions`, `cgrid-showcase`) update 23 import sites from `'cgrid'` to `'@wellsfargo-starui/velocity-grid'`.

**Tech Stack:** npm workspaces, turborepo, TypeScript 5.9 strict, Vite (for kernel build), Vitest (unit tests), Playwright (E2E).

## Global Constraints

Copied verbatim from Cycle 21 spec (`docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md`):

- **L2:** Domain-oriented split across 10 packages (§3.1). No fewer, no more.
- **L3:** Turborepo monorepo, lockstep versioning. All packages share `"version": "0.0.0"` in this scaffold cycle.
- **L4:** Split BEFORE absorbing features. All 10 package directories exist by the end of Cycle 21a, with 9 of them empty stubs (kernel is fully populated by the move).
- **Q10.1:** `cgrid/package.json` `"name": "cgrid"` becomes `"name": "@wellsfargo-starui/velocity-grid"`. No meta-package, no aliasing, no deprecation cycle.
- **Q10.2:** Turborepo remote cache is LOCAL ONLY. No `TURBO_TOKEN` / Vercel remote cache setup.
- **Q10.6:** Icons — `@wellsfargo-starui/velocity-grid` bundles Lucide as default; Phosphor opt-in via `registerIconSet()`. (Not scaffold work — noted for context.)
- **Zero behaviour, look-and-feel, or styling change.** Cycle 21a is pure structural migration. All 2,326 unit tests + full E2E suites (97 showcase + 259 positions) stay green.
- **One PR** for the entire scaffold (per L4 and Cycle 21 §9.3 Option C).

## Preconditions (verified 2026-07-01)

- Cycle 19 refactor hygiene complete (tasks 1–8c all merged, plus autosize fix #91).
- Workspace typecheck clean (commit `582aa22`).
- Cgrid unit tests: 2,326 passing (verified this session).
- No uncommitted work in tree (verified).
- No open PRs (verified).

## File Structure Overview

**Files created:**
- `turbo.json` — turborepo task pipeline config
- `tsconfig.base.json` — shared TS compiler options for project references
- `packages/kernel/**` — everything currently in `cgrid/` (moved via `git mv`)
- `packages/expression/{package.json,tsconfig.json,README.md,src/index.ts,tests/.gitkeep}` — empty package
- `packages/format/{...}` — empty package (same shape)
- `packages/rules/{...}` — empty package
- `packages/calc/{...}` — empty package
- `packages/renderers/{...}` — empty package
- `packages/edit/{...}` — empty package
- `packages/export/{...}` — empty package
- `packages/customizer/{...}` — empty package
- `packages/excel-pivot/{...}` — empty package

**Files modified:**
- `package.json` (root) — add `turbo` devDep, change workspaces to `["packages/*", "apps/*"]`, rewrite `scripts` block to use `turbo run`
- `eslint.config.mjs` — replace `cgrid/src/**/*.ts` + `cgrid/tests/**/*.ts` with `packages/*/src/**/*.ts` + `packages/*/tests/**/*.ts`
- `apps/cgrid-positions/package.json` — `"cgrid": "*"` → `"@wellsfargo-starui/velocity-grid": "*"`
- `apps/cgrid-showcase/package.json` — same
- 23 files under `apps/**/src/` — `from 'cgrid'` → `from '@wellsfargo-starui/velocity-grid'`
- `packages/kernel/package.json` — `"name": "cgrid"` → `"name": "@wellsfargo-starui/velocity-grid"`

**Files deleted:**
- `cgrid/` directory — moved, not deleted; but empty after move so `git mv` removes it

---

### Task 1: Preparation — feature branch, turborepo devDep, turbo.json

**Files:**
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Modify: `package.json` (root) — add turbo devDep

**Interfaces:**
- Produces: turborepo pipeline available for `turbo run build/test/typecheck/lint`; shared TS base config for future package tsconfigs to extend.

- [ ] **Step 1: Create feature branch**

Run:
```bash
git checkout -b cycle21a/monorepo-scaffold
```

Expected: branch created, currently on `cycle21a/monorepo-scaffold`.

- [ ] **Step 2: Install turborepo as root devDep**

Run:
```bash
npm install --save-dev --workspace-root turbo@^2.0.0
```

Expected: `turbo` added to root `package.json` devDependencies; `package-lock.json` updated.

- [ ] **Step 3: Create `turbo.json`**

Create file `turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "vite.config.ts", "package.json"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "tsconfig.json"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "vitest.config.ts"],
      "outputs": []
    },
    "lint": {
      "inputs": ["src/**", "tests/**", "eslint.config.mjs"],
      "outputs": []
    }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

Create file `tsconfig.base.json` — extracted shared compiler options from `cgrid/tsconfig.json` for downstream packages to extend:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true,
    "useDefineForClassFields": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Verify turbo runs (against existing workspaces)**

Run:
```bash
npx turbo run typecheck --dry-run 2>&1 | head -20
```

Expected: turbo shows planned tasks for `cgrid`, `cgrid-positions`, `cgrid-showcase` workspaces. No errors about missing config.

- [ ] **Step 6: Commit**

Run:
```bash
git add turbo.json tsconfig.base.json package.json package-lock.json
git commit -m "$(cat <<'EOF'
build(turbo): cycle 21a step 1 — install turborepo + task pipeline scaffold

Adds `turbo` as root devDep and `turbo.json` with the four cycle 21
pipeline tasks: build, typecheck, test, lint. `tsconfig.base.json`
extracts the shared TS compiler options for future packages to
extend via `"extends": "../../tsconfig.base.json"`.

No workspace layout changes yet — that's step 2. Turbo runs against
the existing `cgrid` + apps/* workspaces and shows the planned task
graph via --dry-run.

Cycle 21a / Task 1 of 5. Ref cycle 21 spec §9.3 Option C step 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The move — `cgrid/` → `packages/kernel/` + full consumer/root/lint update

The atomic migration commit. Nothing works between step 1 and step 6 — commit at the end when green.

**Files:**
- Move (git mv): `cgrid/` → `packages/kernel/` (recursive; preserves history)
- Modify: `packages/kernel/package.json` — `"name": "cgrid"` → `"@wellsfargo-starui/velocity-grid"`
- Modify: `package.json` (root) — workspaces `["cgrid", "apps/*"]` → `["packages/*", "apps/*"]`; scripts rewrite
- Modify: `eslint.config.mjs` — path patterns
- Modify: `apps/cgrid-positions/package.json` — dep
- Modify: `apps/cgrid-showcase/package.json` — dep
- Modify (23 files): `apps/cgrid-positions/src/positionsGrid.ts` + 22 files under `apps/cgrid-showcase/src/` — `from 'cgrid'` → `from '@wellsfargo-starui/velocity-grid'`

**Interfaces:**
- Consumes: `turbo.json` from Task 1 (pipeline definitions).
- Produces: `@wellsfargo-starui/velocity-grid` package resolves from consumer apps; workspace typecheck / test / build all green under the new name.

- [ ] **Step 1: Move `cgrid/` to `packages/kernel/`**

Run:
```bash
mkdir -p packages
git mv cgrid packages/kernel
```

Expected: `cgrid/` gone; `packages/kernel/` contains everything that was in `cgrid/`. History preserved for every file.

- [ ] **Step 2: Rename kernel package name**

Modify `packages/kernel/package.json` — change:
```json
  "name": "cgrid",
```
to:
```json
  "name": "@wellsfargo-starui/velocity-grid",
```

Leave `main`, `types`, `exports` pointing at `./dist/velocity-grid.js` etc. for now — kernel still builds to the same `dist/` filename. (Renaming the built artifact is a follow-up refinement — out of scope for the scaffold.)

- [ ] **Step 3: Update root `package.json` workspaces + scripts**

Modify `package.json` (root):

Change workspaces from:
```json
  "workspaces": [
    "cgrid",
    "apps/*"
  ],
```
to:
```json
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
```

Change scripts block from:
```json
  "scripts": {
    "dev:showcase": "npm run dev --workspace=cgrid-showcase",
    "dev:positions": "npm run dev --workspace=cgrid-positions",
    "build:cgrid": "npm run build --workspace=cgrid",
    "test:cgrid": "npm test --workspace=cgrid",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint cgrid/src cgrid/tests apps/cgrid-positions/src apps/cgrid-positions/e2e apps/cgrid-showcase/src apps/cgrid-showcase/e2e"
  },
```
to:
```json
  "scripts": {
    "dev:showcase": "npm run dev --workspace=cgrid-showcase",
    "dev:positions": "npm run dev --workspace=cgrid-positions",
    "build": "turbo run build",
    "build:kernel": "npm run build --workspace=@wellsfargo-starui/velocity-grid",
    "test": "turbo run test",
    "test:kernel": "npm test --workspace=@wellsfargo-starui/velocity-grid",
    "typecheck": "turbo run typecheck",
    "lint": "eslint packages/*/src packages/*/tests apps/cgrid-positions/src apps/cgrid-positions/e2e apps/cgrid-showcase/src apps/cgrid-showcase/e2e"
  },
```

- [ ] **Step 4: Update `eslint.config.mjs` path patterns**

Modify `eslint.config.mjs` line 40, change:
```js
    files: ['cgrid/src/**/*.ts', 'cgrid/tests/**/*.ts', 'apps/*/src/**/*.ts', 'apps/*/e2e/**/*.ts'],
```
to:
```js
    files: ['packages/*/src/**/*.ts', 'packages/*/tests/**/*.ts', 'apps/*/src/**/*.ts', 'apps/*/e2e/**/*.ts'],
```

- [ ] **Step 5: Update consumer app package.json deps**

Modify `apps/cgrid-positions/package.json` — change:
```json
    "cgrid": "*"
```
to:
```json
    "@wellsfargo-starui/velocity-grid": "*"
```

Modify `apps/cgrid-showcase/package.json` — same change.

- [ ] **Step 6: Update all 23 consumer import sites**

Run this bulk-replace across the app tree:
```bash
grep -rln "from 'cgrid'" apps/ | while read f; do
  # POSIX portable in-place sed (macOS + Linux compatible)
  perl -pi -e "s|from 'cgrid'|from '\@wellsfargo-starui/velocity-grid'|g" "\$f"
done
grep -rln "from \"cgrid\"" apps/ | while read f; do
  perl -pi -e "s|from \"cgrid\"|from \"\@wellsfargo-starui/velocity-grid\"|g" "\$f"
done
```

Then verify count is zero:
```bash
grep -rln "from 'cgrid'\|from \"cgrid\"" apps/ | wc -l
```

Expected: `0` (all replaced). If non-zero, inspect and fix manually.

- [ ] **Step 7: Reinstall workspace symlinks**

Run:
```bash
npm install
```

Expected: no errors. Fresh `node_modules/@wellsfargo-starui/velocity-grid` symlink established. Kernel's own build artifacts (`packages/kernel/dist/`) still present from before the move.

- [ ] **Step 8: Verify workspace typecheck green**

Run:
```bash
npm run typecheck 2>&1 | tail -20
```

Expected: all workspaces typecheck clean. No errors about missing `cgrid` module.

- [ ] **Step 9: Verify kernel unit tests green**

Run:
```bash
npm run test:kernel 2>&1 | tail -10
```

Expected: `Test Files  175 passed (175)` / `Tests  2326 passed (2326)` — same as pre-migration.

- [ ] **Step 10: Verify kernel build green**

Run:
```bash
npm run build:kernel 2>&1 | tail -10
```

Expected: `packages/kernel/dist/velocity-grid.js` (and other build outputs) produced successfully.

- [ ] **Step 11: Commit**

Run:
```bash
git add -A
git commit -m "$(cat <<'EOF'
build(monorepo): cycle 21a step 2 — move cgrid → packages/kernel + rename to @wellsfargo-starui/velocity-grid

Migrates cgrid/ to packages/kernel/ via `git mv` (history
preserved), renames the package from `cgrid` to `@wellsfargo-starui/velocity-grid`
(Q10.1 resolved: no existing external consumers so direct rename
with no meta-package). Updates:

- Root `package.json`: workspaces `["cgrid", "apps/*"]` →
  `["packages/*", "apps/*"]`; scripts rewritten to use
  `turbo run` for build/test/typecheck; per-package scripts
  suffixed `:kernel`; lint paths point at `packages/*/`.
- `eslint.config.mjs`: file patterns updated to
  `packages/*/src/**/*.ts` etc.
- Both consumer apps (cgrid-positions, cgrid-showcase):
  `"cgrid": "*"` → `"@wellsfargo-starui/velocity-grid": "*"`; 23 import sites
  updated from `from 'cgrid'` to `from '@wellsfargo-starui/velocity-grid'` via
  perl bulk-replace.

Verified: workspace typecheck clean, 2,326 kernel unit tests
green, kernel build produces the same `dist/velocity-grid.js` artifact.

Cycle 21a / Task 2 of 5. Ref cycle 21 spec §9.3 Option C step 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create 9 empty package scaffolds

Nine packages, all with the same shape. Bulk creation, one commit.

**Files:**
- Create (9 dirs × 5 files = 45 files):
  - `packages/expression/{package.json, tsconfig.json, README.md, src/index.ts, tests/.gitkeep}`
  - `packages/format/{...}`
  - `packages/rules/{...}`
  - `packages/calc/{...}`
  - `packages/renderers/{...}`
  - `packages/edit/{...}`
  - `packages/export/{...}`
  - `packages/customizer/{...}`
  - `packages/excel-pivot/{...}`

**Interfaces:**
- Consumes: `@wellsfargo-starui/velocity-grid` (declared as workspace dep in each package.json for packages that will depend on kernel per Cycle 21 §3.2 dep graph).
- Produces: 9 workspace-resolvable `@cgrid/*` package names, each with empty `src/index.ts` (barrel exports empty for now).

- [ ] **Step 1: Create scaffold script**

Create file `scripts/scaffold-empty-package.sh`:
```bash
#!/usr/bin/env bash
# Cycle 21a Task 3 — scaffold one empty @cgrid/* package.
#
# Usage: scripts/scaffold-empty-package.sh <name> <description> [<dep1> <dep2> ...]
# Example: scripts/scaffold-empty-package.sh expression "DSL parser + compiler + evaluator"
# Example: scripts/scaffold-empty-package.sh format "Unified formatting DSL parser" @wellsfargo-starui/velocity-grid-expression
set -euo pipefail

name="$1"
description="$2"
shift 2
deps=("$@")

pkg_dir="packages/$name"
mkdir -p "$pkg_dir/src" "$pkg_dir/tests"

# Build dependencies JSON object
deps_json="{"
first=true
for dep in "${deps[@]}"; do
  if [ "$first" = true ]; then first=false; else deps_json+=","; fi
  deps_json+="\n    \"$dep\": \"*\""
done
if [ "$first" = false ]; then deps_json+="\n  "; fi
deps_json+="}"

cat > "$pkg_dir/package.json" <<PKGJSON
{
  "name": "@cgrid/$name",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "echo '@cgrid/$name is a scaffold — no build yet' && exit 0",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": $deps_json,
  "devDependencies": {
    "typescript": "~5.9.3",
    "vitest": "^2.1.0"
  }
}
PKGJSON

cat > "$pkg_dir/tsconfig.json" <<TSJSON
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["dist", "node_modules"]
}
TSJSON

cat > "$pkg_dir/README.md" <<READMEMD
# @cgrid/$name

$description.

**Status:** empty scaffold (cycle 21a). Implementation lands in a subsequent cycle per the [cycle 21 roadmap](../../docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md#9-migration-options--split-before-features-l4).

## Package purpose

See the [cycle 21 spec §4](../../docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md#4-intrinsic-api-delta-per-package) for the intrinsic API delta this package will expose.
READMEMD

cat > "$pkg_dir/src/index.ts" <<TSINDEX
// @cgrid/$name — empty scaffold (cycle 21a).
// Implementation lands in a subsequent cycle per the cycle 21 roadmap.
// See: docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md
export {};
TSINDEX

touch "$pkg_dir/tests/.gitkeep"

echo "Scaffolded packages/$name"
```

Make executable:
```bash
chmod +x scripts/scaffold-empty-package.sh
```

- [ ] **Step 2: Scaffold all 9 packages**

Run (dependency declarations per Cycle 21 §3.2 dep graph):
```bash
scripts/scaffold-empty-package.sh expression "DSL parser, compiler, portable AST, evaluators"
scripts/scaffold-empty-package.sh format "Unified formatting DSL (Excel format codes + expression extensions + composite fragments)" @wellsfargo-starui/velocity-grid-expression
scripts/scaffold-empty-package.sh rules "Rule engine, conditional-styling, alerts core" @wellsfargo-starui/velocity-grid @wellsfargo-starui/velocity-grid-expression @wellsfargo-starui/velocity-grid-format
scripts/scaffold-empty-package.sh calc "Calculated columns, column overrides + templates, aggregate function registry + delta-aware cache" @wellsfargo-starui/velocity-grid @wellsfargo-starui/velocity-grid-expression @wellsfargo-starui/velocity-grid-format
scripts/scaffold-empty-package.sh renderers "40 rich cell renderers for financial blotters (numeric tick-aware, indicators, badges, bars, sparklines, composite)" @wellsfargo-starui/velocity-grid @wellsfargo-starui/velocity-grid-expression @wellsfargo-starui/velocity-grid-format @wellsfargo-starui/velocity-grid-calc @wellsfargo-starui/velocity-grid-rules
scripts/scaffold-empty-package.sh edit "EditJournal, smart-edit + bulk-update ops, CellPatch, distinct-values RPC" @wellsfargo-starui/velocity-grid
scripts/scaffold-empty-package.sh export "Excel/CSV export with visual formatting" @wellsfargo-starui/velocity-grid @wellsfargo-starui/velocity-grid-calc @wellsfargo-starui/velocity-grid-rules @wellsfargo-starui/velocity-grid-format
scripts/scaffold-empty-package.sh customizer "StarUI editor panels + toolbars, popout window primitive, template manager UI" @wellsfargo-starui/velocity-grid @wellsfargo-starui/velocity-grid-expression @wellsfargo-starui/velocity-grid-format @wellsfargo-starui/velocity-grid-rules @wellsfargo-starui/velocity-grid-calc @wellsfargo-starui/velocity-grid-renderers @wellsfargo-starui/velocity-grid-edit @wellsfargo-starui/velocity-grid-export
scripts/scaffold-empty-package.sh excel-pivot "ExcelPivotGrid — Excel-native pivot data model + engine (cycle 20)" @wellsfargo-starui/velocity-grid @wellsfargo-starui/velocity-grid-expression @wellsfargo-starui/velocity-grid-format @wellsfargo-starui/velocity-grid-calc @wellsfargo-starui/velocity-grid-renderers @wellsfargo-starui/velocity-grid-edit @wellsfargo-starui/velocity-grid-export
```

Expected: `Scaffolded packages/expression` ... `Scaffolded packages/excel-pivot` — 9 lines.

- [ ] **Step 3: Verify all 10 packages exist**

Run:
```bash
ls packages/
```

Expected: `calc  customizer  edit  excel-pivot  expression  export  format  kernel  renderers  rules` (10 dirs).

- [ ] **Step 4: Install workspace links for the new packages**

Run:
```bash
npm install
```

Expected: no errors. New `@cgrid/*` symlinks in `node_modules/@cgrid/`.

- [ ] **Step 5: Verify workspace typecheck still green (kernel + 9 scaffolds)**

Run:
```bash
npm run typecheck 2>&1 | tail -10
```

Expected: all 10 packages typecheck clean. The empty `src/index.ts` files pass trivially.

- [ ] **Step 6: Verify turborepo picks up all packages**

Run:
```bash
npx turbo run typecheck --dry-run 2>&1 | grep -E "@cgrid/" | sort -u
```

Expected: all 10 `@cgrid/*` package names appear in turbo's planned tasks.

- [ ] **Step 7: Commit**

Run:
```bash
git add scripts/scaffold-empty-package.sh packages/expression packages/format packages/rules packages/calc packages/renderers packages/edit packages/export packages/customizer packages/excel-pivot package-lock.json
git commit -m "$(cat <<'EOF'
build(scaffolds): cycle 21a step 3 — nine empty @cgrid/* package scaffolds

Adds nine empty packages under packages/*, each with:
- package.json — `@cgrid/<name>@0.0.0` lockstep versioned with
  kernel, `type: module`, `main`/`types` pointing to `src/index.ts`
  (source-based resolution — no build step for empty scaffolds),
  workspace deps declared per cycle 21 §3.2 dep graph.
- tsconfig.json — extends tsconfig.base.json, `noEmit: true`.
- README.md — package purpose + link to cycle 21 spec §4.
- src/index.ts — empty barrel (`export {};`).
- tests/.gitkeep — placeholder.

Packages: @wellsfargo-starui/velocity-grid-expression, @wellsfargo-starui/velocity-grid-format, @wellsfargo-starui/velocity-grid-rules,
@wellsfargo-starui/velocity-grid-calc, @wellsfargo-starui/velocity-grid-renderers, @wellsfargo-starui/velocity-grid-edit, @wellsfargo-starui/velocity-grid-export,
@wellsfargo-starui/velocity-grid-customizer, @wellsfargo-starui/velocity-grid-excel-pivot.

Scaffold script at scripts/scaffold-empty-package.sh is retained
in-repo — future refinement (e.g. adding a vite build per package)
extends it rather than rebuilding from scratch.

Verified: turborepo picks up all 10 packages (kernel + 9);
workspace typecheck clean; installs cleanly.

Cycle 21a / Task 3 of 5. Ref cycle 21 spec §9.3 Option C step 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Verify — full test + build + E2E suite green

No new commits — this is the regression signal for the whole migration. Fix any failures inline and add fix commits as needed.

**Files:** none created/modified (unless fixes surface).

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: signed-off verification that the migration is byte-equivalent behaviour-wise.

- [ ] **Step 1: Fresh install (clean state)**

Run:
```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm install
```

Expected: all workspaces linked cleanly, no peer dep warnings from the rename.

- [ ] **Step 2: Full workspace typecheck**

Run:
```bash
npm run typecheck 2>&1 | tail -15
```

Expected: no `error TS*` output. All packages + apps clean.

- [ ] **Step 3: Full kernel unit tests**

Run:
```bash
npm run test:kernel 2>&1 | tail -10
```

Expected: `Test Files  175 passed (175)` / `Tests  2326 passed (2326)`.

- [ ] **Step 4: Kernel build (verify Vite build still produces dist/)**

Run:
```bash
npm run build:kernel 2>&1 | tail -10
```

Expected: build succeeds, `packages/kernel/dist/velocity-grid.js` and `packages/kernel/dist/velocity-grid.d.ts` written.

- [ ] **Step 5: Lint clean**

Run:
```bash
npm run lint 2>&1 | tail -20
```

Expected: no ESLint errors. Rule vocabulary check (colId/rowId enforcement from cycle 19 task 8c) still active on `packages/kernel/src` and `apps/*/src`.

- [ ] **Step 6: E2E — cgrid-showcase suite**

Run:
```bash
npx playwright test --config apps/cgrid-showcase/playwright.config.ts 2>&1 | tail -15
```

Expected: all 97 tests pass.

- [ ] **Step 7: E2E — cgrid-positions suite**

Run:
```bash
npx playwright test --config apps/cgrid-positions/playwright.config.ts 2>&1 | tail -15
```

Expected: all 259 tests pass.

- [ ] **Step 8: Grep for residual `cgrid` (the old package name)**

Run:
```bash
grep -rn "from 'cgrid'\|from \"cgrid\"\|\"cgrid\":\s*\"" packages/ apps/ 2>&1 | grep -v "node_modules\|dist" | head -10
```

Expected: no results. If any residual references to the old `cgrid` package name surface (e.g. in comments), remove/update them and add a follow-up fix commit.

- [ ] **Step 9: (Optional) Follow-up fix commit if any issue surfaced in steps 1–8**

If any step failed and required a fix:
```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(migration): cycle 21a task 4 — resolve <specific issue>

<Describe the specific fix. If a test failed, name the test and the
root cause. If a file was missed by the perl bulk-replace, list it.>

Cycle 21a / Task 4 verification follow-up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If everything passes, no commit needed — proceed to Task 5.

---

### Task 5: Push branch + open PR

**Files:** none created/modified.

**Interfaces:**
- Consumes: verified branch state from Tasks 1–4.
- Produces: GitHub PR from `cycle21a/monorepo-scaffold` → `main` ready for review.

- [ ] **Step 1: Push branch**

Run:
```bash
git push -u origin cycle21a/monorepo-scaffold
```

Expected: branch pushed with upstream tracking set.

- [ ] **Step 2: Confirm commit list on branch**

Run:
```bash
git log --oneline main..HEAD
```

Expected: 3 commits (task 1 turbo setup, task 2 the move, task 3 empty scaffolds) — plus any task 4 follow-up fix commits.

- [ ] **Step 3: Open PR**

Run:
```bash
gh pr create --title "build(monorepo): cycle 21a — turborepo scaffold + move cgrid → @wellsfargo-starui/velocity-grid + 9 empty packages" --body "$(cat <<'EOF'
## Summary

- Migrates cgrid from single-package npm workspace to turborepo-managed monorepo (10 `@cgrid/*` packages).
- `cgrid/` → `packages/kernel/`, renamed to `@wellsfargo-starui/velocity-grid` (Q10.1: direct rename, no meta-package).
- 9 new empty package scaffolds (`expression`, `format`, `rules`, `calc`, `renderers`, `edit`, `export`, `customizer`, `excel-pivot`) with correct dep graph declared up front so cycles 21b–i land features in the right package.
- 23 consumer import sites in `apps/cgrid-positions` + `apps/cgrid-showcase` updated from `from 'cgrid'` to `from '@wellsfargo-starui/velocity-grid'`.

Spec: [docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md](../blob/main/docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) §9.3 Option C.

Plan: [docs/superpowers/plans/2026-07-01-cycle-21a-monorepo-scaffold.md](../blob/main/docs/superpowers/plans/2026-07-01-cycle-21a-monorepo-scaffold.md).

## Test plan

- [x] Workspace typecheck clean
- [x] Kernel unit tests: 2,326 passed (175 files)
- [x] Kernel build produces `packages/kernel/dist/velocity-grid.js`
- [x] ESLint clean
- [x] E2E cgrid-showcase: 97 tests passed
- [x] E2E cgrid-positions: 259 tests passed
- [x] No residual `from 'cgrid'` imports outside `node_modules`/`dist`
- [x] Turborepo picks up all 10 packages

Cycle 21a of 21 (roadmap: Cycle 19 done → Cycle 21a scaffold → Cycle 21b–i feature packages → Cycle 20 ExcelPivotGrid capstone).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Copy and share.

- [ ] **Step 4: Return PR URL to user**

Print the URL from `gh pr create` output.

---

## Self-review

**1. Spec coverage** (checked against Cycle 21 spec §9.3 Option C step-by-step):

| Spec step | Plan task |
|---|---|
| Sets up turborepo at repo root — migrates root `package.json` `workspaces`, adds `turbo.json`, task pipeline (`build`, `test`, `typecheck`, `lint`) | Task 1 (turbo.json), Task 2 step 3 (workspaces + scripts) |
| Moves current `cgrid/src/*` → `packages/kernel/src/*`. Updates all imports across `apps/*`, tests, docs | Task 2 (steps 1, 5, 6) |
| Renames `cgrid/package.json` `"name": "cgrid"` to `"name": "@wellsfargo-starui/velocity-grid"` | Task 2 step 2 |
| Creates `packages/{expression, format, rules, calc, renderers, edit, export, customizer, excel-pivot}` with package.json, tsconfig.json, README.md, minimal src/index.ts, test scaffold | Task 3 (all steps) |
| Turborepo pipeline caches build/test/typecheck outputs per package | Task 1 step 3 (turbo.json inputs/outputs config) |

All spec items covered.

**2. Placeholder scan:** none found. Every step has concrete commands, expected output, or exact code.

**3. Type consistency:** every package name (`@wellsfargo-starui/velocity-grid`, `@wellsfargo-starui/velocity-grid-expression`, etc.) matches Cycle 21 spec §3.1. Import path `from '@wellsfargo-starui/velocity-grid'` matches the rename target in Task 2 step 2.

**4. Preconditions verified this session:**
- Cycle 19 complete (all task commits merged, autosize fix #91 landed).
- cgrid-positions typecheck fix committed (582aa22).
- 2,326 unit tests green.
- No open PRs, clean tree at start of Cycle 21a.

## Notes on execution

- **Total elapsed time estimate:** 6–10 hours across all 5 tasks. Task 4 verification (E2E suites) is the longest single step (~10 minutes of test runtime).
- **Fallback plan if Task 2 verification fails at step 8 or 9:** revert with `git reset --hard HEAD~1` and re-attempt from step 1. Do NOT try to fix Task 2 incrementally — the move is atomic by design.
- **The scaffold script at `scripts/scaffold-empty-package.sh` is intentionally retained** — future refinements to package scaffolding (e.g. adding a per-package Vite build) extend this script rather than being scattered across ad-hoc commits.
- **`packages/kernel/dist/velocity-grid.js`** — the built artifact name is intentionally preserved from before the migration. Renaming it to `kernel.js` or similar is a follow-up refinement; not required for Cycle 21a to be a byte-equivalent migration.
