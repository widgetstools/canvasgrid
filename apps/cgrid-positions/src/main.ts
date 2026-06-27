import 'cgrid/style.css';
import { createPositionsGrid, setPositiveOnlyFilter, setPinSelectedToTop } from './positionsGrid';
import { connectStomp, STOMP_PUBLISH_RATE_PER_SEC } from './stomp';

const host = document.getElementById('grid');
if (!host) throw new Error('grid host not found');

// Cycle 5 / Task 10 — `?editType=fullRow` flips the demo into full-row
// edit mode without changing the default single-cell flow. The E2E
// targeting full-row navigates with this query param; other E2Es keep
// the default.
//
// `?variableHeights=1` / `?autoHeight=1` re-enable the Cycle 5 / Task 6
// + Task 8 variant features the variableHeights / autoHeight / wrapText
// E2E specs need. Default demo is uniform-height, no per-row variance.
const search = new URLSearchParams(window.location.search);
const editTypeParam = search.get('editType');
const editType = editTypeParam === 'fullRow' ? 'fullRow' as const : undefined;
const variableHeights = search.get('variableHeights') === '1';
const autoHeight = search.get('autoHeight') === '1';
const cellClassDemo = search.get('cellClassDemo') === '1';
// Cycle 11 / Task 5 — `?customPanel=1` registers the demo `DemoCustomPanel`
// via `CGridOptions.components` and adds a third tab to the side bar so the
// cycle11-customPanelApi E2E can exercise refreshToolPanel +
// getToolPanelInstance against a custom id.
const customPanel = search.get('customPanel') === '1';
// Cycle 11 / Task 9 — `?openColumns=1` sets
// `sideBar.defaultToolPanel: 'agColumnsToolPanel'` so the Columns panel
// opens at mount. The polished default-panel experience is opt-in to
// keep the prior Cycle 11 E2Es (which assert "no tab pressed at mount")
// green against the default URL.
const openColumns = search.get('openColumns') === '1';
const grid = createPositionsGrid(host, { editType, variableHeights, autoHeight, cellClassDemo, customPanel, openColumns });

// E2E hooks: expose the grid + a readiness flag so Playwright tests can wait
// for first-data-rendered and call api helpers (`getCellBoundsAt`,
// `getCellValue`) instead of guessing pixel coordinates.
(window as unknown as { __cgrid: typeof grid }).__cgrid = grid;
(window as unknown as { __cgridReady: boolean }).__cgridReady = false;
grid.on('firstDataRendered', () => {
  (window as unknown as { __cgridReady: boolean }).__cgridReady = true;
});

/** Synthetic multi-line description for the `notes` column so Cycle 5 /
 *  Task 8's autoHeight has real text to wrap + measure. Deterministic per
 *  positionId so the E2E can predict which rows go tall. ~1 in 3 rows
 *  carries a string sized to wrap to ~2-3 lines at the notes column width;
 *  the rest stay empty (no autoHeight contribution → fallback row height).
 *  Kept short so the viewport still fits ≥ 10 rows for the Cycle 5 / Task
 *  6 variable-heights spec to scan a meaningful window. */
function autoHeightDescription(positionId: string): string {
  const last = positionId.charCodeAt(positionId.length - 1);
  // Disjoint from Cycle 5 / Task 6's `last % 4 === 0` rule so the two demos
  // never apply to the same row — keeps each spec's assertions clean.
  if (last % 3 !== 0 || last % 4 === 0) return '';
  return `autoHeight wrap demo ${positionId}`;
}

grid.on('gridReady', () => {
  console.log('[cgrid] ready');
  connectStomp({
    onSnapshot: (rows) => {
      // Only seed synthetic descriptions when the autoHeight demo is
      // opted in (otherwise the default uniform-row demo would render
      // "autoHeight wrap demo ..." in 1-of-3 notes cells for no
      // visible reason).
      if (autoHeight) {
        for (const r of rows) {
          if (r.notes == null || r.notes === '') r.notes = autoHeightDescription(r.positionId);
        }
      }
      grid.setRowData(rows);
    },
    onLiveUpdate: (updates) => {
      grid.applyTransactionAsync({ update: updates });
      recordUpdates(updates.length);
    },
    onPhase: (phase) => console.log('[stomp] phase:', phase),
  });
});

grid.on('modelUpdated', (e) => console.log('[cgrid] modelUpdated, visible:', e.visibleRowCount));

// ───────────────────────────────────────────────────────────────────
// Status pill — row count + updates/sec. The row count reflects the
// grid's current displayed-row count (post-filter); updates/sec is a
// 1-second sliding window over the STOMP onLiveUpdate batches that
// arrive via `recordUpdates(n)`.
// ───────────────────────────────────────────────────────────────────
const rowsEl = document.querySelector('[data-testid="status-rows"]');
const upsProcessedEl = document.querySelector('[data-testid="status-ups-processed"]');
const upsPublishedEl = document.querySelector('[data-testid="status-ups-published"]');
type UpdateSample = { t: number; n: number };
const updateSamples: UpdateSample[] = [];
function recordUpdates(n: number): void {
  if (n <= 0) return;
  updateSamples.push({ t: performance.now(), n });
}
function refreshStatus(): void {
  if (rowsEl) {
    const api = grid as unknown as { getDisplayedRowCount?: () => number };
    const count = api.getDisplayedRowCount?.() ?? 0;
    rowsEl.textContent = `Rows: ${count.toLocaleString()}`;
  }
  if (upsProcessedEl) {
    // Drop samples older than 1 second.
    const cutoff = performance.now() - 1000;
    while (updateSamples.length > 0 && updateSamples[0]!.t < cutoff) {
      updateSamples.shift();
    }
    const sum = updateSamples.reduce((s, x) => s + x.n, 0);
    upsProcessedEl.textContent = sum.toLocaleString();
  }
  if (upsPublishedEl) {
    upsPublishedEl.textContent = STOMP_PUBLISH_RATE_PER_SEC.toLocaleString();
  }
}
setInterval(refreshStatus, 250);
refreshStatus();

let darkTheme = true;
document.getElementById('theme')?.addEventListener('click', () => {
  darkTheme = !darkTheme;
  grid.setTheme(darkTheme ? 'cg-theme-quartz-dark' : 'cg-theme-quartz');
  host.classList.toggle('cg-theme-quartz', !darkTheme);
  host.classList.toggle('cg-theme-quartz-dark', darkTheme);
});

// Cycle 6 / Task 2 — Save / Restore / Reset column-layout buttons. The
// state round-trips through localStorage so a page reload exercises the
// real persistence path. Reset replays the construction-time snapshot.
const LAYOUT_KEY = 'cg-layout';
document.getElementById('save-layout')?.addEventListener('click', () => {
  const api = grid as unknown as { getColumnState: () => unknown };
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.getColumnState()));
});
document.getElementById('restore-layout')?.addEventListener('click', () => {
  const raw = localStorage.getItem(LAYOUT_KEY);
  if (!raw) return;
  const api = grid as unknown as { applyColumnState: (p: unknown) => boolean };
  api.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
});
document.getElementById('reset-layout')?.addEventListener('click', () => {
  const api = grid as unknown as { resetColumnState: () => void };
  api.resetColumnState();
});

// Cycle 6 / Task 3 — distribute the canvas drawable width across the
// visible non-`suppressSizeToFit` leaves. Clicking the button forces a
// fit even after the user has manually resized columns.
document.getElementById('fit-columns')?.addEventListener('click', () => {
  const api = grid as unknown as { sizeColumnsToFit: (p?: unknown) => void };
  api.sizeColumnsToFit();
});

// Cycle 6 / Task 4 — autosize every visible non-`suppressAutoSize` leaf
// to its widest visible content. Awaits the worker measure pass; the
// fire-and-forget Promise lets the button stay responsive.
document.getElementById('autosize-all')?.addEventListener('click', () => {
  const api = grid as unknown as { autoSizeAllColumns: (skipHeader?: boolean) => Promise<void> };
  void api.autoSizeAllColumns();
});

// Cycle 6 / Task 5 — imperative column API. Three buttons exercise the
// batch mutation surface against the live demo grid.
document.getElementById('imp-hide-pnl')?.addEventListener('click', () => {
  const api = grid as unknown as { setColumnsVisible: (keys: string[], visible: boolean) => void };
  api.setColumnsVisible(['pnl', 'dailyPnl', 'unrealizedPnl'], false);
});
document.getElementById('imp-pin-spread')?.addEventListener('click', () => {
  const api = grid as unknown as { setColumnsPinned: (keys: string[], pinned: 'left' | 'right' | null) => void };
  api.setColumnsPinned(['spread'], 'left');
});
document.getElementById('imp-reset-widths')?.addEventListener('click', () => {
  const api = grid as unknown as {
    setColumnWidths: (widths: Array<{ key: string; newWidth: number }>, finished?: boolean) => void;
  };
  api.setColumnWidths([
    { key: 'ticker', newWidth: 100 },
    { key: 'cusip', newWidth: 110 },
    { key: 'notionalAmount', newWidth: 130 },
    { key: 'marketValue', newWidth: 130 },
  ]);
});

// Cycle 7 / Task 8 — toolbar "Positive P&L only" checkbox toggles the
// demo's external filter. The grid's `isExternalFilterPresent` reads
// the module-level flag inside positionsGrid; flipping it triggers
// `onFilterChanged('externalFilter')` which fires the worker round-trip.
// `change` event (not `click`) so keyboard activations also fire.
const positivePnlCheckbox = document.getElementById('ext-positive-pnl') as HTMLInputElement | null;
if (positivePnlCheckbox) {
  positivePnlCheckbox.addEventListener('change', () => {
    setPositiveOnlyFilter(grid, positivePnlCheckbox.checked);
  });
}

// Cycle 8 / Task 4 — toolbar "Pin selected to top" checkbox. Toggling on
// snapshots the current selection into the demo's pin set; the
// `postSortRows` callback then moves those rows to the top regardless
// of the active sort. Toggling off clears the pin set. The toggle
// re-applies the current sort model to fire the post-sort hook.
const pinSelectedCheckbox = document.getElementById('pin-selected-top') as HTMLInputElement | null;
if (pinSelectedCheckbox) {
  pinSelectedCheckbox.addEventListener('change', () => {
    setPinSelectedToTop(grid, pinSelectedCheckbox.checked);
  });
}

// Cycle 10 / Task 3 — clipboard delimiter selector. Picking a value drives
// `setGridOption('clipboardDelimiter', value)` so Ctrl+C / Ctrl+X land in
// the chosen format on the next copy. `'tab'` maps to the default `'\t'`
// (TSV — what Excel / Sheets paste as a grid); the others switch to CSV,
// SSV (semicolon — common in European locales where `,` is decimal), or
// pipe-separated for log-style consumers.
const clipboardDelimiterSelect = document.getElementById('clipboard-delimiter') as HTMLSelectElement | null;
if (clipboardDelimiterSelect) {
  clipboardDelimiterSelect.addEventListener('change', () => {
    const v = clipboardDelimiterSelect.value;
    const delim = v === 'tab' ? '\t' : v;
    const api = grid as unknown as {
      setGridOption: (key: 'clipboardDelimiter', value: string) => void;
    };
    api.setGridOption('clipboardDelimiter', delim);
  });
}

// Cycle 7 / Task 7 — cross-column quick filter. Input drives
// `setGridOption('quickFilterText', value)` after a short trailing
// debounce. Without it, a 5-char string would fire 5 worker round-trips
// and 5 repaints; with 200ms the user types the query and only the
// final value reaches the worker. cgrid's applyQuickFilter also drops
// stale replies via its own request-id guard, so this debounce is
// purely about saving wire traffic + paint cost in the demo.
const quickInput = document.getElementById('quick-filter') as HTMLInputElement | null;
if (quickInput) {
  let debounceHandle: number | null = null;
  const QUICK_FILTER_DEBOUNCE_MS = 200;
  quickInput.addEventListener('input', () => {
    if (debounceHandle !== null) window.clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(() => {
      debounceHandle = null;
      const api = grid as unknown as {
        setGridOption: (key: 'quickFilterText', value: string) => void;
      };
      api.setGridOption('quickFilterText', quickInput.value);
    }, QUICK_FILTER_DEBOUNCE_MS);
  });
}

