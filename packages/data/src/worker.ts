/**
 * SharedWorker entry for the data-provider hub.
 * Consuming apps should bundle this as `new SharedWorker(new URL('@wellsfargo-starui/velocity-grid-data/worker', import.meta.url), { type: 'module' })`.
 */
import { DataServicesHub } from './hub/DataServicesHub';

const hub = new DataServicesHub();

const sw = self as unknown as SharedWorkerGlobalScope;
sw.addEventListener('connect', (ev: MessageEvent) => {
  const port = (ev as unknown as { ports: MessagePort[] }).ports[0];
  if (!port) return;
  hub.addPort(port);
});
