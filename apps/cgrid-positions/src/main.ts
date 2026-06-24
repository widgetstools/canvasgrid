import 'cgrid/style.css';
import { createPositionsGrid } from './positionsGrid';
import { connectStomp } from './stomp';

const host = document.getElementById('grid');
if (!host) throw new Error('grid host not found');

const grid = createPositionsGrid(host);

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
