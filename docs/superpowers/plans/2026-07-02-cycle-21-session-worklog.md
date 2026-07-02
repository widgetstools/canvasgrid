# Cycle 21 — Session Worklog (small-session execution plan)

**Purpose:** the remaining Cycle 21 work, carved into SMALL units sized for one modest session each — so a session restart never loses more than one unit, and no session needs the full history in context. Written 2026-07-02 after a restart wiped in-flight drafting agents + the session scratchpad.

## How to run a session (read this first, every session)

1. **Recover state:** read `.superpowers/sdd/progress.md` (tail = truth) + this worklog. `git log --oneline -5`. Trust the ledger over memory.
2. **Durability rules:** every artifact goes in the REPO (docs/ or committed code), never the session scratchpad. Drafting agents write DIRECTLY into the plan file (or a `docs/superpowers/plans/notes/` file), and their output is committed in the same session. Commit spec/plan/worklog edits to `main` immediately; commit task work to the cycle branch per task.
3. **Untouchables:** the user's uncommitted dark-theme edits (`packages/kernel/src/theming/tokens.css`, `packages/kernel/tests/theming.test.ts`, `apps/cgrid-positions/e2e/cycle4.spec.ts`, 13 positions visual snapshots) stay uncommitted and unmodified. NEVER `reset --hard`/`checkout` over a dirty tree — stash-first rule is absolute.
4. **SDD loop per task:** brief (`task-brief` script → rename `task-N-cycle21X-brief.md`) → implementer (sonnet; haiku only for pure transcription) → `review-package BASE HEAD` → reviewer (sonnet) → fix loop → ledger line. Final whole-branch review (fable) before PR. Squash-merge, sync main with `git merge --ff-only` (never reset), carry ledger forward.
5. **Standing constraints (all cycles):** expression grammar `&&`/`||`, `==`/`!=` (no AND/OR/=); `colId` vocabulary; Date-free engines (injectable now); no raw NUL bytes (`\0` escapes); seeded LCG in tests; known CPU-flaky kernel perf tests → re-run standalone; showcase sources are `.ts` (delete stale `.js` emit stragglers from disk if Vite shadows, never commit them); showcase dev server manual on :5185, positions on :5175.
6. **Session end:** append a ledger entry (what completed, commits, next unit id), even if the unit is unfinished.

## Baselines (main @ `b055115`)

kernel 2568 · calc 215 · rules 144 · format 171 · expression 185 · showcase E2E 131 · typecheck 21/21 · build 13/13 · kernel dist 794150 B. Merged: 21a-e (#92-95), 21d (#96).

## Lost-artifact inventory (from the 2026-07-02 restart)

- Recon files for 21f/21g/21h/21i (scratchpad) — GONE. 21f's content survives in the committed spec; 21g/21h/21i recons must be REDONE in their S1 sessions (key conclusions preserved below in their cycle sections).
- 21f plan phase drafts B/C1/C2/DE — GONE except what the drafters reported: their verified findings are baked into the unit descriptions below (esp. 21f-S2 notes).

---

## CYCLE 21f — @cgrid/renderers (15-task plan; spec + plan header EXIST on disk, commit in S1)

Spec: `docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md` (LOCKED: zero kernel changes; main-side ColumnStats/TickHistory; minimal-composite threading; LAB heat; 5 kernel sparklines re-exported). Plan: `docs/superpowers/plans/2026-07-02-cycle-21f-renderers.md` (header + Task 1 done; phase markers `<!-- PHASE-B -->` etc. await sections). Branch: `cycle21f/renderers`.

**Verified mechanics to honor when drafting (recovered from the lost drafters' reports):**
- Explicit `cellRenderer` WINS over the composite default (`propertyChain.ts` ~1109 first `??` operand) — the threading design is sound.
- Renderer tests deep-import kernel src by relative path (dist exports don't expose resolveColDefs/applyCellProps; format's bridge.test.ts uses structural fakes, NOT kernel imports).
- Scaffold tsconfig needs `rootDir` DROPPED (probe-verified: `"src"` breaks tests, `"."` breaks kernel deep imports).
- `'number'` canonical name collides with the kernel built-in — bridge locks a param-less draw-parity contract test.
- `getCellPaintedBg` never executes painters — E2E asserts resolved names + `window.__cgridRenderers` plumbing probes + fake-gc unit coverage; document the canvas-testing limitation.
- Bars painters read `params.stats` / `params.history` closures (bridge-injected); degrade to plain paint when absent.

| Unit | Scope | End state |
|---|---|---|
| **21f-S1** | Commit spec+plan header+this worklog to main. Draft Phase B (Tasks 2-4: paintUtils+palette+fakeGc harness; threading proof+ColumnStats; TickHistory) INTO the plan file, commit. Execute Task 1 (scaffold+types+name table+palette data). | Plan has Tasks 1-4; branch exists; Task 1 reviewed+ledgered |
| **21f-S2** | Execute Tasks 2-4 with reviews. | Foundations green; calc-style helper tests pass |
| **21f-S3** | Draft Tasks 5-8 (numeric 9 / text 5 / indicators 6 / badges 7 — catalog rows VERBATIM in briefs) into plan, commit. Execute Tasks 5-6. | 14 painters landed |
| **21f-S4** | Execute Tasks 7-8. | 27 foundation painters done |
| **21f-S5** | Draft Tasks 9-12 (bars 8 / charts 4+5 re-exports / composite 5 / actions 2+hit router) into plan, commit. Execute Tasks 9-10. Verify at draft time: exact kernel cell-click event name + public context-menu surface + how kernel sparkline painters are reachable for re-export. | Bars+charts landed |
| **21f-S6** | Execute Tasks 11-12. Run the Phase→D checkpoint (coordinator: name-table completeness, painter-discipline greps, suite+tsc+eslint). | All 40 painters + helpers green |
| **21f-S7** | Draft Tasks 13-15 (bridge; showcase 2 pages + ≥10 E2E; README+gates) into plan, commit. Execute Task 13 (bridge). | Bridge green |
| **21f-S8** | Execute Task 14 (showcase demos + E2E; dev server :5185; baseline 131 preserved). | E2E 131+new green |
| **21f-S9** | Execute Task 15 (gates incl. the ZERO-KERNEL-DIFF proof: `git diff main...HEAD -- packages/kernel packages/{expression,format,rules,calc}` empty). Final whole-branch review (fable) + fix wave + re-review. | needs-fixes resolved; all gates green |
| **21f-S10** | Push, PR, squash-merge (`cycle 21f — @cgrid/renderers ... (#NN)`), ff-only sync, ledger close-out. Update baselines table above. | 21f MERGED |

## CYCLE 21g — @cgrid/edit (est. 10-12 tasks)

Preserved recon conclusions (redo recon in S1; docs: `starui-customizer/{01-editing-core,11-data-change-history,12-smart-edit,13-bulk-update,14-plus-minus,15-shortcuts}.md` + ui docs 06/07/09/10/14/15/16): models = CellPatch {rowId,colId,field,oldValue,newValue}, EditJournalEntry {id,timestamp(host-stamped),source,label,patches[]}, settings trio, PlusMinusNudge, Shortcut. Open questions to settle in spec: plus/minus interception vs `suppressKeyboardEvent` (hook EXISTS per 21e recon); cascade-undo atomicity (one Tx per entry recommended); selection preservation across preview/commit; `getRowById` accessor need (kernel has `rowDataById` + `forEachRow`; distinct-values limit landed in 21d).

| Unit | Scope |
|---|---|
| **21g-S1** | Recon (write to `docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md`, COMMIT) + design spec + commit |
| **21g-S2** | Plan (header+Task 1 by hand; remaining phases drafted into file same-session), commit; execute Task 1 |
| **21g-S3** | Engine I: CellPatch/journal core + undo/redo semantics (~Tasks 2-4) |
| **21g-S4** | Engine II: smart-edit ops + K/M/B magnitude parser + bulk-update ops + preview/commit (~Tasks 5-7) |
| **21g-S5** | Kernel seams (only if genuinely needed — suppressKeyboardEvent exists; aim near-zero kernel diff) + plus/minus + shortcuts + bridge (~Tasks 8-10) |
| **21g-S6** | Showcase demo + E2E; README + gates; final review + fixes; PR + merge |

## CYCLE 21h — @cgrid/export (est. 6-8 tasks — SMALLER than master doc implies)

Preserved recon conclusion: kernel ALREADY ships `exportDataAsCsv/getDataAsCsv/exportDataAsExcel/getDataAsExcel` with a vendored zero-dep XLSX writer (ZIP+XML; styles.xml is a stub). External XLSX libs were explicitly rejected previously — STAY VENDORED. 21h = visual formatting (resolved format programs + rule colors + theme mode into a real styles table with per-cell xf refs) + the `@cgrid/export` package split/facade. Spec must decide: writer refactor location (recommend: writer stays kernel, @cgrid/export orchestrates via public APIs + a style-build slot) and how rule colors resolve at export time (main-side via evaluateCell over rowDataById — no worker round-trip).

| Unit | Scope |
|---|---|
| **21h-S1** | Recon redo (→ committed notes) + spec + commit |
| **21h-S2** | Plan + commit; execute scaffold + style-model tasks |
| **21h-S3** | Visual styles into the XLSX writer path + CSV parity + rule/format resolution tasks |
| **21h-S4** | Bridge/facade + demo + E2E; gates; final review; PR + merge |

## CYCLE 21i — @cgrid/customizer (DISCUSSION FIRST — user directive)

**21i-S0 (BLOCKING): present the decision set to the user before any spec.** Preserved from lost recon: 20 panels (7 master-detail, 8 flat, 5 inline/toolbar) over 6 engine packages; 18-primitive foundation library (Cockpit, Band, SettingsRow, Poppable, shared editors); StarUI docs assume Lit + Web Awesome + Monaco + SortableJS while the repo is framework-free; 5 engine-API gaps (column visibility, filter-model host contract, group-tree traversal, indicator-icon registry access, +1); 3 blocking questions (panel attachment: sidebar tool-panel vs settings-sheet vs popout; reducer wiring contract; host hooks for notifications/providers/persistence). Redo recon into committed notes BEFORE the discussion; bring options+tradeoffs, not an action plan (user's plan-mode preference). Session plan for implementation: TBD after S0.

---

## Progress tracker (update every session)

- [x] 21f-S1 (2026-07-02: plan Tasks 1-4 on main @ ed24add; Task 1 done on cycle21f/renderers @ c20fc5b; name table corrected to 46+5=51; ledger on branch) · [ ] 21f-S2 · [ ] 21f-S3 · [ ] 21f-S4 · [ ] 21f-S5 · [ ] 21f-S6 · [ ] 21f-S7 · [ ] 21f-S8 · [ ] 21f-S9 · [ ] 21f-S10
- [ ] 21g-S1 · [ ] 21g-S2 · [ ] 21g-S3 · [ ] 21g-S4 · [ ] 21g-S5 · [ ] 21g-S6
- [ ] 21h-S1 · [ ] 21h-S2 · [ ] 21h-S3 · [ ] 21h-S4
- [ ] 21i-S0 (user discussion) · then TBD
