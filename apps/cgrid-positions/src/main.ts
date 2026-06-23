import { createPositionsGrid } from './positionsGrid';
import { connectStomp } from './stomp';

const host = document.getElementById('grid');
if (!host) throw new Error('grid host not found');

const grid = createPositionsGrid(host);

grid.on('gridReady', () => {
  console.log('[cgrid] ready');
  connectStomp({
    onSnapshot: (rows) => grid.setRowData(rows),
    onLiveUpdate: (updates) => grid.applyTransactionAsync({ update: updates }),
    onPhase: (phase) => console.log('[stomp] phase:', phase),
  });
});

grid.on('modelUpdated', (e) => console.log('[cgrid] modelUpdated, visible:', e.visibleRowCount));

document.getElementById('theme')?.addEventListener('click', () => {
  host.classList.toggle('cg-theme-quartz');
  host.classList.toggle('cg-theme-quartz-dark');
  grid.refresh();
});
