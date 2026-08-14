/**
 * StompPerspectiveProvider playground — every config attribute editable in
 * the header; Apply tears down the current provider + grid and rebuilds
 * both from the form. The status strip mirrors live telemetry (phase,
 * worker mode, feed role, book size, live rate).
 *
 * Shared-engine note (Phase 5): the book table outlives a provider on the
 * shared engine, so re-Applying a smaller `snapshotRows` attaches to the
 * existing book rather than shrinking it — the status strip always shows
 * the REAL book size. `?worker=dedicated` gives each Apply a private
 * engine if you want reseeds to take effect exactly.
 */
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import '@wellsfargo-starui/velocity-grid/style.css';
import {
  StompPerspectiveProvider,
  type BookTelemetry,
  type PspFilter,
  type StompPerspectiveProviderConfig,
} from '@wellsfargo-starui/velocity-grid-perspective';

const form = document.getElementById('cfg') as HTMLFormElement;
const statusEl = document.getElementById('status')!;
const gridHost = document.getElementById('grid')!;
const feedSel = form.elements.namedItem('feed') as HTMLSelectElement;
const wsUrlIn = form.elements.namedItem('wsUrl') as HTMLInputElement;
const clientIdIn = form.elements.namedItem('clientId') as HTMLInputElement;
const filterIn = form.elements.namedItem('filter') as HTMLInputElement;

// Transport-only attributes enable with the STOMP feed.
const STOMP_ONLY = ['wsUrl', 'clientId', 'snapshotTopic', 'triggerTopic', 'snapshotEndToken', 'keyColumn'] as const;
feedSel.addEventListener('change', () => {
  const stomp = feedSel.value === 'stomp';
  for (const name of STOMP_ONLY) {
    (form.elements.namedItem(name) as HTMLInputElement).disabled = !stomp;
  }
});

function num(name: string): number {
  return Number((form.elements.namedItem(name) as HTMLInputElement).value);
}

function readConfig(): StompPerspectiveProviderConfig | null {
  let filter: PspFilter[] | undefined;
  filterIn.classList.remove('invalid');
  const rawFilter = filterIn.value.trim();
  if (rawFilter) {
    try {
      const parsed = JSON.parse(rawFilter) as unknown;
      if (!Array.isArray(parsed) || parsed.some((f) => !Array.isArray(f) || f.length !== 3)) {
        throw new Error('expected an array of [column, op, value] triples');
      }
      filter = parsed as PspFilter[];
    } catch (err) {
      filterIn.classList.add('invalid');
      statusEl.innerHTML = `<span class="err">filter: <b>${String((err as Error).message ?? err)}</b></span>`;
      return null;
    }
  }
  const feed = feedSel.value === 'stomp' ? 'stomp' : 'seed';
  const str = (name: string): string =>
    (form.elements.namedItem(name) as HTMLInputElement).value.trim();
  const stompAttrs = feed === 'stomp'
    ? {
      wsUrl: wsUrlIn.value.trim(),
      clientId: clientIdIn.value.trim(),
      // Empty inputs fall back to the provider's documented defaults.
      ...(str('snapshotTopic') ? { snapshotTopic: str('snapshotTopic') } : {}),
      ...(str('triggerTopic') ? { triggerTopic: str('triggerTopic') } : {}),
      ...(str('snapshotEndToken') ? { snapshotEndToken: str('snapshotEndToken') } : {}),
      ...(str('keyColumn') ? { keyColumn: str('keyColumn') } : {}),
    }
    : {};
  return {
    feed,
    ...stompAttrs,
    snapshotRows: num('snapshotRows'),
    rate: num('rate'),
    batchSize: num('batchSize'),
    updatesPerTick: num('updatesPerTick'),
    label: (form.elements.namedItem('label') as HTMLInputElement).value.trim() || 'Playground',
    ...(filter ? { filter } : {}),
    onTelemetry: paintStatus,
  };
}

function paintStatus(t: BookTelemetry): void {
  const phaseCls = t.phase === 'live' ? 'ok' : t.phase === 'error' ? 'err' : '';
  statusEl.innerHTML = [
    `<span class="${phaseCls}">phase <b>${t.phase}</b></span>`,
    `<span>engine <b>${t.workerMode}</b></span>`,
    ...(t.workerMode === 'shared' ? [`<span>feed <b>${t.feedRole}</b></span>`] : []),
    `<span>book <b>${t.bookSize.toLocaleString()}</b></span>`,
    `<span>live rows/s <b>${t.liveUpdatesPerSec.toLocaleString()}</b></span>`,
    `<span>getRows <b>${t.getRowsTotal.toLocaleString()}</b></span>`,
    `<span>served <b>${t.rowsServedTotal.toLocaleString()}</b></span>`,
    '<span class="hint">edit config → Apply rebuilds provider + grid · second tab shares the engine</span>',
  ].join('');
}

let provider: StompPerspectiveProvider | null = null;
let grid: VelocityGrid | null = null;
let detach: (() => void) | null = null;

function teardown(): void {
  try { detach?.(); } catch { /* already detached */ }
  detach = null;
  try { provider?.destroy(); } catch { /* already destroyed */ }
  provider = null;
  try { grid?.destroy(); } catch { /* already destroyed */ }
  grid = null;
  gridHost.replaceChildren();
}

function build(): void {
  const config = readConfig();
  if (!config) return;
  teardown();
  provider = new StompPerspectiveProvider(config);
  grid = new VelocityGrid(gridHost, {
    theme: 'vg-theme-cursor-dark',
    ...provider.gridOptions(),
  });
  detach = provider.attach(grid);
  (window as unknown as { __playground: unknown }).__playground = { provider, grid };
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  build();
});

window.addEventListener('beforeunload', teardown);

build();
