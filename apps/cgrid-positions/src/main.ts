import 'cgrid/style.css';
import { createPositionsGrid } from './positionsGrid';
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

