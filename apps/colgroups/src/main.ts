import './agGridSetup';
import './styles.css';
import { mountColgroupsDemo } from './app';

const cleanup = mountColgroupsDemo(document.getElementById('root')!);
window.addEventListener('pagehide', () => cleanup());

if (import.meta.hot) {
  import.meta.hot.dispose(() => cleanup());
}
