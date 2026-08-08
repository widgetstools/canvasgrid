# Perspective WASM + cgrid SSRM — Phased Implementation

**Status:** Phase 5 complete (2026-07-25) — SharedWorker multi-tab landed  
**Contract (locked):** Perspective owns storage / filter / sort / group / agg / windows / ticks.  
VelocityGrid SSRM owns block cache + paint. No `serverSideEnableClientSidePipeline` on this path.

---

## Architecture

```
STOMP / seed ──► SharedWorker (Perspective WASM Table)
                      │
                      ├─ View A (blotter: all)
                      ├─ View B (blotter: filter)
                      └─ View C (… )
                           │
                           ▼  to_columns / ViewWindow { start_row, end_row }
                 IServerSideDatasource.getRows
                           │
                           ▼
                 VelocityGrid SSRM block cache ──► canvas paint
```

**Scroll rule:** only viewport (+ small overscan) blocks load. Never full-book hydrate.

---

## Phases & validation gates

### Phase 1 — Flat View windows + smooth SSRM scroll
**Deliver**
- `@wellsfargo-starui/velocity-grid-perspective` package (or app-local provider if package lands later)
- Perspective worker (SharedWorker with DedicatedWorker fallback)
- One Table + N flat Views
- `PerspectiveSsrmDatasource` implementing `getRows` via windowed reads
- `cgrid-ssrm-demo` mode: `?engine=perspective` (default) using this path
- Explicitly **off**: client-side pipeline / full hydrate

**Validation gate (must pass before Phase 2)**
- [x] `npm run typecheck` for provider + demo
- [x] Demo loads ≥10k rows; status shows book size
- [x] Scrolling only issues `getRows` for near-viewport blocks (telemetry / console)
- [x] No blank-grid hangs; qualityMode=`performance`
- [x] Soft smoke: scroll top↔bottom without UI freeze (>1s)

### Phase 2 — Sort / filter → Perspective ViewConfig
**Deliver**
- Map cgrid `sortModel` / `filterModel` → View `sort` / `filter`
- On model change: update View + `refreshServerSide({ purge: true })`

**Validation**
- Sort by pnl / mkt value reorders via Perspective (rows move after purge)
- Column filter reduces `rowCount` from View
- Scroll remains sparse (no full hydrate)

### Phase 3 — Live ticks (`on_update`) without scroll jank
**Deliver**
- Table `update` from STOMP/sparse feed
- View `on_update` → conflated `applyServerSideTransaction` / soft refresh
- Honor `deferAsyncTransactionsWhileScrolling`

**Validation**
- Live counters move while idle
- Scroll FPS stays interactive on soft-raster / performance mode
- Pausing fan-out stops pushes

### Phase 4 — Group / agg in Perspective
**Deliver**
- `group_by` + aggregates on Views from row-group panel
- Subtotals / grand totals from Perspective (no CSRM remount)

**Validation**
- Group by desk expands/collapses via Perspective
- Totals match filtered book
- Still no full hydrate

### Phase 5 — Multi-blotter SharedWorker + E2E suite
**Deliver**
- One SharedWorker table shared by all blotters
- Playwright: scroll, sort, filter, live, multi-view
- Performance assertion helpers (getRows count, optional FPS sample)

**Validation**
- Full E2E green
- Three blotters share one book; independent Views

---

## Non-goals (later / separate)
- Replacing CSRM worker FilterPass/GroupPass for non-SSRM grids (rejected Option C)
- Excel show-values-as matrix (Cycle 20 / Option B excel-pivot)
- Infinite row model + LRU maxBlocks (classic Cycle 19 Task 8/9) — add after Phase 3 if needed

---

## Phase exit protocol
1. Implement phase  
2. Run validation checklist  
3. Record results in this file under **Phase N results**  
4. Stop for human OK before starting next phase

---

## Phase 1 results

| Check | Status | Notes |
|-------|--------|-------|
| Typecheck (`cgrid-ssrm-demo`) | **pass** | `npm run typecheck --workspace=cgrid-ssrm-demo` |
| Demo boots Perspective WASM worker | **pass** | Dedicated Worker via `perspective.worker()` |
| Book fills Table (≥10k) | **pass** | Default `feed=seed` (STOMP via `?feed=stomp` when starui available) |
| SSRM getRows windows only | **pass** | smoke: getRowsTotal=20, rowsServed=1600 / book=10000 |
| Scroll sparse serve heuristic | **pass** | `await __ssrmDemo.validatePhase1()` + wheel smoke |
| qualityMode performance | **pass** | `?quality=performance` in smoke URL |

**Smoke command:** `node apps/cgrid-ssrm-demo/scripts/phase1-smoke.mjs` (dev server on :5191)

**Code landed**
- `apps/cgrid-ssrm-demo/src/perspective/bootstrap.ts` — WASM init + Table
- `apps/cgrid-ssrm-demo/src/perspective/book.ts` — seed/STOMP → Table + Views
- `apps/cgrid-ssrm-demo/src/perspective/ssrmDatasource.ts` — windowed `to_json`
- `apps/cgrid-ssrm-demo/src/perspective/validatePhase1.ts` — browser gate
- Demo defaults to Perspective + seed; `serverSideEnableClientSidePipeline: false`
- Note: `npm run dev:stomp` points at missing `../starui/...`; use seed until that host is restored

---

## Phase 5 results (2026-07-25)

| Check | Status | Notes |
|-------|--------|-------|
| SharedWorker engine (one per origin) | **pass** | `sharedServer.worker.ts` — multi-session host, one session per connected tab |
| Cross-tab table share, no reseed | **pass** | tab B attaches via `open_table('positions-shared')` in <1s, `snap === book === 10000` |
| Live fan-out to follower tabs | **pass** | 27 grid tick dispatches / 3s on B while A feeds (flat views ride a conflated soft refresh; leader keeps the patch path) |
| Feed leader election + takeover | **pass** | Web Locks (`cgrid-ssrm-demo:feed-leader`): close leader → follower acquires, resumes seed ticks (27 → 52 dispatches) |
| Dedicated-Worker fallback | **pass** | `?worker=dedicated` (also automatic on SharedWorker init failure, 10s timeout) |
| Phase 1 sparse-window gate regression | **pass** | `phase1-smoke.mjs`: served=1600 ≪ book=10000 under the shared engine |

**Smoke command:** `node apps/cgrid-ssrm-demo/scripts/phase5-smoke.mjs` (dev server on :5191)

**Code landed**
- `apps/cgrid-ssrm-demo/src/perspective/sharedServer.worker.ts` — SharedWorker host for the
  Perspective server WASM. Faithful port of the stock inline worker's engine machinery with
  the structural fix the stock script lacks: a **session per connected port** (the stock
  script's single module-global session makes concurrent tabs clobber each other). Engine
  instantiated from the init message's structured-cloned `WebAssembly.Module`.
- `bootstrap.ts` — `perspective.worker(SharedWorker)` with 10s-timeout dedicated fallback;
  `openOrCreatePositionsTable` (fixed cross-tab name + `get_hosted_table_names`/`open_table`).
- `book.ts` — feed-leader election via Web Locks with queued takeover; followers adopt the
  live book (no reseed) and never delete the shared table on teardown; follower flat views
  route remote ticks to a band-scoped soft refresh; telemetry carries `workerMode`/`feedRole`.
- Known scope note: STOMP-mode takeover re-runs the snapshot into the keyed table (benign,
  positionId-indexed); the tab-crash edge (no `close` event, no `cmd:'close'`) leaks a
  session in the SharedWorker until the last tab closes it.
