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
