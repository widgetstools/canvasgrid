# VelocityGrid Greenfield (`packages/new`)

Charter for the rewrite that lands beside the legacy packages until cutover.

## Locked decisions

- **Greenfield** — no runtime imports from `@wellsfargo-starui/velocity-grid*` legacy packages
- **Full current surface** — CSRM + sparse SSRM + explicit pipeline mode + Ext + data + AppData + Perspective
- **One design system** — `@wellsfargo-starui/vg-new-ui`
- **One SSRM core** — v2 skeleton semantics; pipeline mode is explicit and fail-closed

## Packages

| Package | npm name |
|---------|----------|
| [`ui/`](ui/) | `@wellsfargo-starui/vg-new-ui` |
| [`grid/`](grid/) | `@wellsfargo-starui/vg-new-grid` |
| [`ext/`](ext/) | `@wellsfargo-starui/vg-new-ext` |
| [`data/`](data/) | `@wellsfargo-starui/vg-new-data` |
| [`appdata/`](appdata/) | `@wellsfargo-starui/vg-new-appdata` |
| [`perspective/`](perspective/) | `@wellsfargo-starui/vg-new-perspective` |
| [`engines/`](engines/) | `@wellsfargo-starui/vg-new-engines` |

## Docs

- [`DESIGN.md`](DESIGN.md) — architecture + contracts
- [`INVENTORY.md`](INVENTORY.md) — frozen feature IDs (`K-*` / `E-*` / `D-*`)
- [`MIGRATION.md`](MIGRATION.md) — cutover / import map (Phase 9)

## Quality bar

- AG-Grid-grade polish; one authoring grammar (Draft → Validate → Apply/Save)
- Zero reintroduction of known SSRM races (index-merge, null wipe, off-chain soft refresh, Stop vs lock takeover)
- Parity demos: `apps/cgrid-new-csrm`, `apps/cgrid-new-ext-demo`, `apps/cgrid-new-perspective-ssrm`

## Branch

`rewrite/packages-new`
