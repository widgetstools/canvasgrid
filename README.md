# canvasgrid

Vanilla TypeScript **canvas data grid** aiming for AG Grid API parity.

**Forward path:** greenfield packages under [`packages/new/`](packages/new/) (`@wellsfargo-starui/vg-new-*`). See [`packages/new/MIGRATION.md`](packages/new/MIGRATION.md).

**Legacy path:** `@wellsfargo-starui/velocity-grid*` (deprecated; still built for comparison demos until Playwright parity cutover).

AG Grid React apps under `apps/showcase` and `apps/colgroups` are **comparison references**, not the product library.

## Requirements

- Node 22+ (macOS, Windows, or Linux)
- npm 10+ (`packageManager` is pinned in root `package.json`)

All demo scripts below are plain `npm run` / Node — no bash required. They work in Terminal (macOS), PowerShell, cmd.exe, and Git Bash (Windows).

## Quick start

```bash
npm install
npm run build
npm run dev:showcase    # cgrid feature tour (no external services)
```

## Demos (macOS + Windows)

| Script | App | Port | Needs STOMP? | Notes |
|--------|-----|------|--------------|-------|
| `npm run dev:new-csrm` | `cgrid-new-csrm` | 5210 | No | **Greenfield** CSRM |
| `npm run dev:new-ext-demo` | `cgrid-new-ext-demo` | 5211 | No | **Greenfield** Ext + data bind |
| `npm run dev:new-perspective-ssrm` | `cgrid-new-perspective-ssrm` | 5212 | No* | **Greenfield** Perspective SSRM |
| `npm run dev:showcase` | `cgrid-showcase` | 5185 | No | Legacy CSRM feature tour |
| `npm run dev:ssrm-demo` | `cgrid-ssrm-demo` | 5191 | No* | Legacy Perspective SSRM |
| `npm run dev:perspective-ssrm-sample` | `cgrid-perspective-ssrm-sample` | 5201 | No* | Legacy Perspective + provider editor |
| `npm run dev:positions` | `cgrid-positions` | 5175 | Yes | Live blotter (legacy) |
| `npm run dev:ext-demo` | `cgrid-ext-demo` | 5188 | Yes | Legacy VelocityGridExt chrome |
| `npm run dev:customizer` | `cgrid-customizer-demo` | 5187 | Yes | Legacy Customizer UI |
| `npm run dev:colgroups` | `colgroups` | 5176 | No | AG Grid column-groups reference |
| `npm run dev:ag-showcase` | `showcase` | 5174 | Optional | AG Grid React reference |

\* Default feed is local seed. Pass `?feed=stomp` only when `npm run dev:stomp` is running.

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
| `packages/new/*` | **Greenfield** `vg-new-*` rewrite (preferred) |
| `packages/kernel` | Legacy canvas grid (deprecated) |
| `packages/expression` / `format` / `calc` / `rules` / `edit` | Legacy engines (→ `vg-new-engines`) |
| `packages/ext` / `customizer` | Legacy Lit UI chrome |
| `packages/perspective` | Legacy Perspective + STOMP SSRM bridge |
| `apps/cgrid-new-*` | Greenfield demos |
| `apps/cgrid-*` | Legacy demos (comparison) |
| `apps/showcase` / `colgroups` | AG Grid 35.x reference apps |
| `docs/` | Feature catalog, plans, performance notes |

## Scripts

| Script | What it does |
|--------|----------------|
| `npm run build` | Turbo build all workspaces |
| `npm run typecheck` | Turbo typecheck |
| `npm run test` | Turbo test |
| `npm run test:new` | Greenfield `vg-new-*` Vitest suites |
| `npm run test:kernel` | Legacy kernel Vitest suite |
| `npm run lint` | ESLint (identifier vocabulary + basic hygiene) |
| `npm run verify:demos` | Cross-platform demo HTTP boot check |

## Trust boundaries

- **`aggFuncs` / custom comparators** (legacy) serialize via `new Function` on main + worker. Treat them as **trusted application code** only. Prefer `vg-new-engines` expression DSL for user-authored formulas.
- **Tooltip `{ html }`** and context-menu icons are allowlist-sanitized; prefer `{ plain }` / trusted SVG.

## Docs

- [Greenfield README](packages/new/README.md)
- [Migration / cutover](packages/new/MIGRATION.md)
- [Performance (Cycle 25)](docs/PERFORMANCE.md)
- [Feature catalog](docs/catalog/README.md)

## License

Private / unpublished (`0.0.0` workspaces).
