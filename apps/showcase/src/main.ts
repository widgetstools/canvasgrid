import './agGridSetup';
import './styles.css';
import { mountPositionsGrid } from './grid/positionsGrid';
import { DEFAULT_STOMP_CONFIG } from './types';

const cleanup = mountPositionsGrid(document.getElementById('root')!, DEFAULT_STOMP_CONFIG);
window.addEventListener('pagehide', () => cleanup());

if (import.meta.hot) {
  import.meta.hot.dispose(() => cleanup());
}
