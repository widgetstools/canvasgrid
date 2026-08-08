# Cycle 20 — Export — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 20
**FM coverage:** Area 25 — ~32 of 34 rows + Area 16 (`domLayout: 'print'`)
**Depends on:** Cycle 15 (export respects grouping / aggregation)

---

## Mental model: export is a WORKER pass, not a main-thread serialization

Export reads the chunk format on the WORKER and serializes to a
`Blob`. The main thread only triggers download via
`URL.createObjectURL` + `<a download>`. This keeps a 1M-row CSV
export from blocking input handlers.

```
Main thread:                 Worker:
─────────────────────────    ─────────────────────────────────
api.exportDataAsCsv()  ───→  worker.export({format: 'csv', opts})
                             ├─ Walk all rows (filtered/sorted)
                             ├─ Stream rows → TSV/CSV writer
                             └─ Return ArrayBuffer
api.exportDataAsCsv() ←───   (Blob from ArrayBuffer)
↓
URL.createObjectURL + <a download>
```

---

## Task 1 — CSV writer on worker

**Goal:** Streaming CSV writer that handles quoting, line endings,
BOM, and respects current filter / sort / group state.

**Worker file:** `worker/export/csv.ts` (new).

**API:**

```typescript
interface CSVExportParams {
  fileName?: string;                  // default 'export.csv'
  columnSeparator?: string;           // default ','
  columnKeys?: string[];              // export only these columns
  onlySelected?: boolean;             // export only selected rows
  onlySelectedAllPages?: boolean;
  skipColumnHeaders?: boolean;
  skipColumnGroupHeaders?: boolean;
  skipRowGroups?: boolean;
  skipPinnedTop?: boolean;
  skipPinnedBottom?: boolean;
  exportedRows?: 'all' | 'filtered' | 'displayed';
  appendContent?: string;             // text appended after data
  prependContent?: string;            // text prepended before data
  suppressQuotes?: boolean;
  processCellCallback?: string;       // serialized function name (registry)
  processRowGroupCallback?: string;
  processHeaderCallback?: string;
  withBOM?: boolean;                  // for Excel UTF-8 compat
}
```

**Streaming details:**
- Writer writes into a growable `Uint8Array` (start 64KB, double on
  growth) — avoids many small allocations.
- Quoting rule (RFC 4180): wrap a field in `"..."` when it contains
  separator, quote, or newline. Embedded quotes double.
- Line ending: `\r\n` (Excel-friendly).
- BOM: optional 3-byte UTF-8 BOM at start (`0xEF 0xBB 0xBF`).

---

## Task 2 — Excel (XLSX) writer on worker

**Goal:** Minimal XLSX with sheet + cells + simple styles. No
charts, no formulas (use ag-grid's enterprise reach — we just need
parity for the common case).

**Approach:** Vendor a tiny XLSX writer (XLSX is a ZIP of XML). The
project budget for new runtime dep is zero, so:

- **Option A (chosen):** Vendor a ~12 KB ZIP+XML writer
  (`worker/export/zipWriter.ts` + `xlsxBuilder.ts`). Implements
  only what cgrid emits — single sheet, shared-strings table,
  inline styles. Bundle hit: ~10 KB gz.
- **Option B (rejected):** Bring `exceljs` (~250 KB) — busts the
  bundle budget.

**Worker file:** `worker/export/xlsx.ts` (new).

**API:** mirrors CSV plus:

```typescript
interface ExcelExportParams extends Omit<CSVExportParams, 'columnSeparator' | 'suppressQuotes' | 'withBOM'> {
  sheetName?: string;
  author?: string;
  fontSize?: number;
  rowHeight?: number;
  headerRowHeight?: number;
  freezeRows?: number;     // freeze N rows at top
  freezeColumns?: number;  // freeze N columns at left
  // Style hooks via processCellCallback's return value:
  //   `{ value: string; styleId?: string }`
  styles?: ExcelStyle[];   // registry of styles by id
}
```

**Cell styling:** A small style table (font weight, color, alignment,
number format) referenced by `styleId` from `processCellCallback`.
Group headers default to a bold style; totals row to a top-border
style — matches the canvas vocabulary.

---

## Task 3 — `exportDataAsCsv` + `exportDataAsExcel` API

**Goal:** Two functions on `VelocityGridApi`. Each:

1. Sends `{ format, params }` message to worker.
2. Worker assembles the bytes, returns `ArrayBuffer`.
3. Main thread wraps in `Blob`, triggers download.

```typescript
class VelocityGridApi {
  exportDataAsCsv(params?: CSVExportParams): void;
  getDataAsCsv(params?: CSVExportParams): Promise<string>;
  exportDataAsExcel(params?: ExcelExportParams): void;
  getDataAsExcel(params?: ExcelExportParams): Promise<Blob>;
}
```

`exportDataAs*` auto-downloads; `getDataAs*` returns the bytes so
the app can post to a server / preview / etc.

---

## Task 4 — Process callbacks via name-registry

**Goal:** `processCellCallback`, `processRowGroupCallback`, and
`processHeaderCallback` can transform values per cell / per row /
per header during export.

**Problem:** Functions can't postMessage to a worker. Two solutions:

| Approach | Pros | Cons |
|---|---|---|
| **String-serialized** (ag-grid style) | Just works | `eval` smell; closures don't survive; security review needed |
| **Named registry** (cgrid's pattern from Cycle 8 comparator) | Type-safe, no eval | Apps must register callbacks at construction time |

**Choice: name-registry.** Consistency with Cycle 8 + Cycle 14.

```typescript
interface VelocityGridOptions {
  exportCallbacks?: {
    [name: string]: ProcessCellCallback | ProcessHeaderCallback;
  };
}

const grid = new VelocityGrid(host, {
  exportCallbacks: {
    formatPrice: ({ value }) => Number(value).toFixed(4),
  },
});

api.exportDataAsCsv({
  processCellCallback: 'formatPrice', // by name, not function
});
```

---

## Task 5 — Export options surface

**Goal:** Make `columnKeys`, `onlySelected`, `skipPinnedTop`,
`skipRowGroups`, etc. all respect grouping / filter / sort state.

**Rows-to-export selection algorithm (worker-side):**

```typescript
function selectExportRows(opts: CSVExportParams): RowIterator {
  let rows = opts.exportedRows === 'all'      ? allRowsInChunkOrder()
           : opts.exportedRows === 'filtered' ? filteredRows()
           : displayedRows(); // post-group-collapse

  if (opts.onlySelected) rows = rows.filter(r => selection.has(r.id));
  if (opts.skipRowGroups) rows = rows.filter(r => r.rowKind !== 'group');
  if (opts.skipPinnedTop) rows = rows.filter(r => !r.isPinnedTop);
  if (opts.skipPinnedBottom) rows = rows.filter(r => !r.isPinnedBottom);

  return rows;
}
```

---

## Task 6 — `domLayout: 'print'`

**Goal:** When `domLayout: 'print'`, the host element grows to
content height (all rows rendered, no virtualization) so the browser
print path captures the entire grid.

**Behaviour:**
- Disables virtualization (treat as `suppressRowVirtualisation`).
- Disables sticky group rows (no scroll, no need).
- Disables overlays (filter popups, context menus).
- `@media print` CSS strips body bg + grid line tint (handled in
  Task 7).

**Toggle:** `setGridOption('domLayout', 'print')` then call
`window.print()`. Reverting to `'normal'` re-enables virtualization.

---

## Task 7 — Print-friendly theme

**Goal:** A `vg-theme-print` class delivers black-on-white,
no row stripes, no row-hover, no flash overlay, no selection bg.

**Tokens:**

| Token | Print value |
|---|---|
| `--vg-bg` | `#ffffff` |
| `--vg-fg` | `#000000` |
| `--vg-row-bg-odd` | `#ffffff` |
| `--vg-row-bg-hover` | `transparent` |
| `--vg-grid-line-color` | `#000000` (printer-friendly black gridlines) |
| `--vg-selection-bg` | `transparent` |
| `--vg-flash-from-color` | `transparent` |

**Page breaks at group boundaries:** print mode renders one group's
descendants per page when `groupIncludeFooter: true` — CSS only:
`break-after: page` on the footer DOM portal (group footer rows are
already DOM portals from Cycle 15 — reuse).

---

## Performance gates

- Export 1M rows × 30 cols to CSV ≤ 3 s on worker.
- Export 100k rows × 30 cols to XLSX ≤ 4 s on worker.
- Main thread unblocked during export — input handlers still
  respond within 16 ms.
- Memory bound during export: writer never allocates more than
  64 MB peak even for 10M-row exports (streaming over chunks, not
  full materialization).

---

## Exit criteria recap

- FM Area 25 ≥ 90 % ✅.
- Demo: "Export CSV" + "Export Excel" buttons in toolbar; opening
  the .xlsx in Excel + LibreOffice round-trips correctly.
- Print preview shows the entire grid (not just visible viewport).
- `processCellCallback` (named) round-trips through CSV + XLSX.
- Group rows, totals, pinned rows all honor their respective
  `skip*` options.
