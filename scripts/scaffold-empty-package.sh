#!/usr/bin/env bash
# Cycle 21a Task 3 — scaffold one empty @wellsfargo-starui/velocity-grid-* package.
#
# Usage: scripts/scaffold-empty-package.sh <name> <description> [<dep1> <dep2> ...]
# Example: scripts/scaffold-empty-package.sh expression "DSL parser + compiler + evaluator"
# Example: scripts/scaffold-empty-package.sh format "Unified formatting DSL parser" @wellsfargo-starui/velocity-grid-expression
set -euo pipefail

name="$1"
description="$2"
shift 2
deps=("${@+"${@}"}")

pkg_dir="packages/$name"
mkdir -p "$pkg_dir/src" "$pkg_dir/tests"

# Build dependencies JSON object
# FIX: use $'\n' (ANSI-C quoting) to produce a real newline; bare "\n" in
# double-quoted strings is a literal backslash-n, which is invalid JSON.
# "${deps[@]+"${deps[@]}"}" safely expands an empty array under set -u.
deps_json="{"
first=true
for dep in "${deps[@]+"${deps[@]}"}"; do
  if [ "$first" = true ]; then first=false; else deps_json+=","; fi
  deps_json+=$'\n    '"\"$dep\": \"*\""
done
if [ "$first" = false ]; then deps_json+=$'\n  '; fi
deps_json+="}"

cat > "$pkg_dir/package.json" <<PKGJSON
{
  "name": "@wellsfargo-starui/velocity-grid-$name",
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
    "build": "echo '@wellsfargo-starui/velocity-grid-$name is a scaffold — no build yet' && exit 0",
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
# @wellsfargo-starui/velocity-grid-$name

$description.

**Status:** empty scaffold (cycle 21a). Implementation lands in a subsequent cycle per the [cycle 21 roadmap](../../docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md#9-migration-options--split-before-features-l4).

## Package purpose

See the [cycle 21 spec §4](../../docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md#4-intrinsic-api-delta-per-package) for the intrinsic API delta this package will expose.
READMEMD

cat > "$pkg_dir/src/index.ts" <<TSINDEX
// @wellsfargo-starui/velocity-grid-$name — empty scaffold (cycle 21a).
// Implementation lands in a subsequent cycle per the cycle 21 roadmap.
// See: docs/superpowers/plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md
export {};
TSINDEX

touch "$pkg_dir/tests/.gitkeep"

echo "Scaffolded packages/$name"
