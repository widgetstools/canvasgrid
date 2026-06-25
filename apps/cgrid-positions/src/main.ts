import 'cgrid/style.css';
import { createPositionsGrid, setPositiveOnlyFilter } from './positionsGrid';
import { connectStomp } from './stomp';

const host = document.getElementById('grid');
if (!host) throw new Error('grid host not found');

// Cycle 5 / Task 10 — `?editType=fullRow` flips the demo into full-row
// edit mode without changing the default single-cell flow. The E2E
// targeting full-row navigates with this query param; other E2Es keep
// the default.
const editTypeParam = new URLSearchParams(window.location.search).get('editType');
const editType = editTypeParam === 'fullRow' ? 'fullRow' as const : undefined;
const grid = createPositionsGrid(host, { editType });

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
      for (const r of rows) {
        if (r.notes == null || r.notes === '') r.notes = autoHeightDescription(r.positionId);
      }
      grid.setRowData(rows);
    },
    onLiveUpdate: (updates) => grid.applyTransactionAsync({ update: updates }),
    onPhase: (phase) => console.log('[stomp] phase:', phase),
  });
});

grid.on('modelUpdated', (e) => console.log('[cgrid] modelUpdated, visible:', e.visibleRowCount));

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

