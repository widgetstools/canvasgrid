# cgrid-positions

Vanilla-TS demo of `cgrid` consuming the STOMP positions feed (same as the
AG Grid `apps/showcase`).

## Prereqs

- STOMP server at `localhost:8081` (see root README of the monorepo).

## Run

```bash
npm install
npm run dev:positions
```

Opens at http://localhost:5175.

## Visual regression (Cycle 12)

A pinned-Chromium, fixed-viewport Playwright suite under `e2e-visual/` diffs
the demo against committed PNG baselines so layout / overlay regressions fail
the merge gate before they reach the user. Run it from this package:

```bash
npm run test:visual
```

The harness starts (or reuses) the Vite dev server on port 5175 and uses a
1440×900 viewport at DPR 1 with the dark theme forced. To regenerate baselines
after an intentional visual change, run:

```bash
npm run test:visual -- --update-snapshots
```

PRs that ship new or updated baselines MUST title themselves with the
`[visual-baseline-update]` marker so reviewers know to compare the regenerated
PNGs against the prior frame. Baselines live in
`apps/cgrid-positions/e2e-visual/__snapshots__/` and ship in git as binary
(`.gitattributes` enforces this).

## Clipboard + context menu (Cycle 10)

- **Right-click** any body cell — the cgrid context menu opens with the
  eight built-in items (Copy / Copy with Headers / Paste / Cut / Export /
  Autosize Columns / Pin Column ► / Reset Columns) plus a sample
  **Clear filters** entry the demo appends via `getContextMenuItems`.
- **Ctrl+C / Ctrl+X / Ctrl+V** copy / cut / paste the current cell range
  via the system clipboard. The TSV pass runs on the worker; the main
  thread does only `navigator.clipboard.writeText` / `readText`.
- **Clipboard format** dropdown in the toolbar (`TSV (tab)` / `CSV (,)` /
  `SSV (;)` / `Pipe`) drives `setGridOption('clipboardDelimiter', …)` so
  the next copy lands in that format. Default is TSV — pastes into Excel /
  Sheets as a grid; switch to CSV for log-style consumers.
- Round-trip demo: right-click → Copy → switch to a spreadsheet → Paste →
  values land in the same shape (RFC 4180 quoting handles embedded tabs /
  newlines / quotes).
