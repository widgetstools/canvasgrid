# velocitygrid-ssrm-demo

`StompPerspectiveProvider` demos — Perspective WASM book + sparse SSRM.

| Page | URL | Purpose |
|------|-----|---------|
| Simple | http://localhost:5191/simple.html | Minimal provider → grid |
| Playground | http://localhost:5191/playground.html | Editable config |
| Main | http://localhost:5191/ | Multi-blotter visualizer |

```bash
npm run dev
# optional live broker (stomp-view-server on :8082)
npm run dev:stomp   # from repo root
```

## E2E (Playwright) — StompPerspectiveProvider

| Suite | Command | Broker |
|-------|---------|--------|
| Seed Perspective SSRM | `npm run test:e2e:seed` | not required |
| Live STOMP → Perspective (`@live-stomp`) | `npm run test:e2e:live` | `:8082` |
| All | `npm run test:e2e` | live specs skip if broker down |

Coverage against `/simple.html`:

- Sparse SSRM boot / scroll / sort / soft refresh / group-by
- **ExprTK calculated columns** (`provider.setExpressions`)
- **Conditional styling rules** + diff flash
- **Alerts** (dataChange / relativeChange)
- **Formatting** (`editColumn` / `calc.applyOverrides`)
- Live STOMP feed bind + ExprTK on broker book

`window.__simple` exposes `provider`, `grid`, `calc`, `rules`, `alerts`,
`addPerspectiveCalc()`, `simulateLiveTick()`, paint probes.

Query params: `feed=seed|stomp`, `wsUrl`, `rows`, `rate`, `worker=dedicated`.
