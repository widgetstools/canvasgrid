# canvasgrid

Vanilla TypeScript **canvas data grid** (`@cgrid/kernel` / **cgrid**) aiming for AG Grid API parity. Data ops (sort / filter / group / pivot / agg) run in a Web Worker; the main thread paints visible cells.

AG Grid React apps under `apps/showcase` and `apps/colgroups` are **comparison references**, not the product library.

## Requirements

- Node 22+
- npm 10+ (`packageManager` is pinned in root `package.json`)

## Quick start

```bash
npm install
npm run build
npm run dev:showcase    # cgrid feature tour
npm run dev:positions   # blotter-style demo
```

## Workspace layout

| Path | Role |
|------|------|
| `packages/kernel` | Canvas grid library (built) |
| `packages/expression` | Safe formula DSL (no `eval`) |
| `packages/format` / `calc` / `rules` / `edit` / `renderers` | Pluggable feature packages |
| `packages/ext` / `customizer` | Lit UI chrome |
| `apps/cgrid-*` | Product demos |
| `apps/showcase` / `colgroups` | AG Grid 35.x reference apps |
| `docs/` | Feature catalog, plans, performance notes |

## Scripts

| Script | What it does |
|--------|----------------|
| `npm run build` | Turbo build all workspaces |
| `npm run typecheck` | Turbo typecheck |
| `npm run test` | Turbo test |
| `npm run test:kernel` | Kernel Vitest suite |
| `npm run lint` | ESLint (identifier vocabulary + basic hygiene) |

## Trust boundaries

- **`aggFuncs` / custom comparators** serialize via `new Function` on main + worker. Treat them as **trusted application code** only. Prefer `@cgrid/expression` for user-authored formulas.
- **Tooltip `{ html }`** and context-menu icons are allowlist-sanitized; prefer `{ plain }` / trusted SVG.

## Docs

- [Performance (Cycle 25)](docs/PERFORMANCE.md)
- [Feature catalog](docs/catalog/README.md)

## License

Private / unpublished (`0.0.0` workspaces).
