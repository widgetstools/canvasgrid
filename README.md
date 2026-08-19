# VelocityGrid

Vanilla TypeScript **canvas data grid** (`@wellsfargo-starui/velocity-grid`) aiming for AG Grid API parity. Data ops (sort / filter / group / pivot / agg) run in a Web Worker; the main thread paints visible cells. This repository is named `canvasgrid`.

AG Grid React apps under `apps/showcase` and `apps/colgroups` are **comparison references**, not the product library.

## Requirements

- Node 22+ (macOS, Windows, or Linux)
- npm 10+ (`packageManager` is pinned in root `package.json`)

All demo scripts below are plain `npm run` / Node — no bash required. They work in Terminal (macOS), PowerShell, cmd.exe, and Git Bash (Windows).

## Quick start

```bash
npm install
npm run build
npm run dev:showcase    # VelocityGrid feature tour (no external services)
```

## Demos (macOS + Windows)

| Script | App | Port | Needs STOMP? | Notes |
|--------|-----|------|--------------|-------|
| `npm run dev:showcase` | `velocitygrid-showcase` | 5185 | No | CSRM feature tour (seed data) |
| `npm run dev:ssrm-demo` | `velocitygrid-ssrm-demo` | 5191 | No* | Perspective SSRM (`StompPerspectiveProvider`) |
| `npm run dev:perspective-ssrm-sample` | `velocitygrid-perspective-ssrm-sample` | 5201 | No* | Perspective SSRM + tabbed provider editor |
| `npm run dev:positions` | `velocitygrid-positions` | 5175 | Yes | Live blotter |
| `npm run dev:ext-demo` | `velocitygrid-ext-demo` | 5188 | Yes | VelocityGridExt chrome |
| `npm run dev:ext-react` | `examples/cgrid-ext-react` | 5202 | No | React + VelocityGridExt from tarballs |
| `npm run dev:ext-angular` | `examples/cgrid-ext-angular` | 5203 | No | Angular + VelocityGridExt from tarballs |
| `npm run dev:ext-angular-ssrm` | `examples/cgrid-ext-angular-ssrm` | 5204 | No | Angular 16.1 SSRM + AppData + CSV export/import |
| `npm run dev:customizer` | `velocitygrid-customizer-demo` | 5187 | Yes | Customizer UI |
| `npm run dev:colgroups` | `colgroups` | 5176 | No | AG Grid column-groups reference |
| `npm run dev:ag-showcase` | `showcase` | 5174 | Optional | AG Grid React reference |

\* Default feed is local seed. Pass `?feed=stomp` only when `npm run dev:stomp` is running.

React / Angular **tarball** hosts (not workspace apps):

```bash
npm run examples:install    # pack dist/tarballs + npm install examples/*
npm run dev:ext-react       # http://localhost:5202
npm run dev:ext-angular         # http://localhost:5203
npm run dev:ext-angular-ssrm    # http://localhost:5204
```

### STOMP live feed (optional)

Live-data demos expect a sibling [starui](https://github.com/widgetstools) checkout with a built `stomp-view-server`:

```text
<parent>/
  canvasgrid/     ← this repo
  starui/         ← build apps/stomp-view-server, then:
```

```bash
npm run dev:stomp
```

Override the entry on any OS with `STOMP_SERVER_ENTRY` set to an absolute path to `main.js`.

### OpenFin (optional, ext-demo)

```bash
npm run ext-demo:openfin
```

Uses a Node orchestrator (not shell `&&`) so it works on Windows and macOS. Requires OpenFin runtime installed.

### Verify every demo boots

After `npm run build`:

```bash
npm run verify:demos
```

Starts each Vite app briefly, checks HTTP on its port, then stops it. Safe on macOS and Windows.

## Workspace layout

| Path | Role |
|------|------|
| `packages/kernel` | Canvas grid library (built) |
| `packages/expression` | Safe formula DSL (no `eval`) |
| `packages/format` / `calc` / `rules` / `edit` / `renderers` | Pluggable feature packages |
| `packages/ext` / `customizer` | Lit UI chrome |
| `packages/perspective` | Perspective + STOMP SSRM bridge |
| `apps/cgrid-*` | Product demos |
| `examples/cgrid-ext-react` | Vite React host installing kernel/ext tarballs |
| `examples/cgrid-ext-angular` | Angular host installing kernel/ext tarballs |
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
| `npm run verify:demos` | Cross-platform demo HTTP boot check |
| `npm run build:tarballs` | `npm pack` kernel, ext, and companions into `dist/tarballs/` |
| `npm run examples:install` | Rebuild tarballs and `npm install` the React/Angular examples |

## Trust boundaries

- **`aggFuncs` / custom comparators** serialize via `new Function` on main + worker. Treat them as **trusted application code** only. Prefer `@wellsfargo-starui/velocity-grid-expression` for user-authored formulas.
- **Tooltip `{ html }`** and context-menu icons are allowlist-sanitized; prefer `{ plain }` / trusted SVG.

## Docs

- [Performance (Cycle 25)](docs/PERFORMANCE.md)
- [Feature catalog](docs/catalog/README.md)

## License

Private / unpublished (`0.0.0` workspaces).
