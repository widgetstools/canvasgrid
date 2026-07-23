# Perspective WASM + cgrid SSRM — Phased Implementation

**Status:** Phase 1 complete — awaiting human OK before Phase 2  
**Contract (locked):** Perspective owns storage / filter / sort / group / agg / windows / ticks.  
CGrid SSRM owns block cache + paint. No `serverSideEnableClientSidePipeline` on this path.

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
                 CGrid SSRM block cache ──► canvas paint
```

**Scroll rule:** only viewport (+ small overscan) blocks load. Never full-book hydrate.

---

## Phases & validation gates

### Phase 1 — Flat View windows + smooth SSRM scroll
**Deliver**
- `@cgrid/perspective` package (or app-local provider if package lands later)
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
