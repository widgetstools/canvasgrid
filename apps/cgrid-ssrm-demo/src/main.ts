import '@wellsfargo-starui/velocity-grid/style.css';
import './styles.css';

import {
  PerspectiveBook,
  createPerspectiveSsrmDatasource,
  type BookTelemetry,
  type PositionRow,
  type PspFilter,
  type ViewSpec,
} from '@wellsfargo-starui/velocity-grid-perspective';
import { validatePhase1 } from './perspective/validatePhase1';
import { renderVisualizer } from './ui/visualizer';
import { mountBlotter, type BlotterMount } from './ui/blotterHost';

const THEME = 'vg-theme-cursor-dark';
const ENGINE = 'perspective' as const;
/** Default `seed` — starui STOMP is optional via `?feed=stomp`. */
const FEED =
  new URLSearchParams(location.search).get('feed') === 'stomp' ? 'stomp' : 'seed';

const VIEW_CATALOG: ViewSpec[] = [
  { id: 'all', label: 'All positions' },
  {
    id: 'securitized',
    label: 'Securitized desk',
    filter: [['desk', 'contains', 'Securit']] as PspFilter[],
  },
  {
    id: 'winners',
    label: 'Positive P&L',
    filter: [['pnl', '>', 0]] as PspFilter[],
  },
  {
    id: 'losers',
    label: 'Negative P&L',
    filter: [['pnl', '<', 0]] as PspFilter[],
  },
  {
    id: 'emea',
    label: 'EMEA region',
    filter: [['region', 'contains', 'EME']] as PspFilter[],
  },
];

function qualityFromUrl(): 'auto' | 'quality' | 'performance' {
  const q = new URLSearchParams(window.location.search).get('quality');
  if (q === 'performance' || q === 'quality' || q === 'auto') return q;
  return 'performance';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = el('label', { className: 'field' });
  wrap.append(label, control);
  return wrap;
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <strong>cgrid SSRM · Perspective</strong>
      <span>Phase 1 — sparse SSRM + Perspective (windowed getRows only)</span>
    </div>
    <div class="controls" id="controls"></div>
  </header>
  <div class="viz" id="viz"></div>
  <main class="stage" id="stage"></main>
`;

const controls = document.getElementById('controls')!;
const vizHost = document.getElementById('viz')!;
const stage = document.getElementById('stage')!;

let qualityMode = qualityFromUrl();
let cellFlashEnabled = true;
let latest: BookTelemetry | null = null;
let focusedViewId: string | null = null;

interface ViewTickPayload {
  viewId: string;
  totals: PositionRow;
  refreshSsrm: boolean;
  updates: PositionRow[];
}

const pendingViewTicks = new Map<string, ViewTickPayload>();
const blotterScrollActive = new Map<string, boolean>();

/** Coalesce mid-scroll ticks so later batches don't drop earlier row updates. */
function mergeViewTicks(prev: ViewTickPayload, next: ViewTickPayload): ViewTickPayload {
  const byId = new Map<string, PositionRow>();
  for (const row of prev.updates) byId.set(row.positionId, row);
  for (const row of next.updates) byId.set(row.positionId, row);
  return {
    viewId: next.viewId,
    totals: next.totals,
    refreshSsrm: prev.refreshSsrm || next.refreshSsrm,
    updates: [...byId.values()],
  };
}

function applyViewTick(payload: ViewTickPayload): void {
  const mount = blotters.get(payload.viewId);
  if (!mount) return;
  // Grand totals now render kernel-natively (`grandTotalRow: 'pinnedBottom'`
  // fed by the skeleton root / flat-load grandTotals) — no pinned-row push.
  if (payload.refreshSsrm) {
    try { mount.grid.refreshServerSide({ purge: false }); } catch { /* swallow */ }
    return;
  }
  if (payload.updates.length === 0) return;
  try {
    mount.grid.applyServerSideTransaction({ update: payload.updates });
  } catch { /* swallow */ }
}

const book = new PerspectiveBook({
  feed: FEED,
  snapshotRows: 10_000,
  rate: 40,
  batchSize: 50,
  updatesPerTick: 5,
  onTelemetry: (t) => {
    latest = t;
    paintViz(t);
  },
  onPhase: (phase) => {
    if (phase === 'live' || phase === 'snapshot') {
      for (const m of blotters.values()) {
        try { m.grid.refreshServerSide({ purge: true }); } catch { /* swallow */ }
      }
    }
  },
  onViewTick: (payload) => {
    if (blotterScrollActive.get(payload.viewId)) {
      const prev = pendingViewTicks.get(payload.viewId);
      pendingViewTicks.set(payload.viewId, prev ? mergeViewTicks(prev, payload) : payload);
      return;
    }
    applyViewTick(payload);
  },
});

const blotterUnsubs = new Map<string, Array<() => void>>();

function wireBlotterSsrm(mount: BlotterMount, viewId: string): void {
  const unsubs: Array<() => void> = [];
  const grid = mount.grid;
  const origSetRowGroupColumns = grid.setRowGroupColumns.bind(grid);
  grid.setRowGroupColumns = (cols: string[]) => {
    void book.setViewGroupBy(viewId, cols);
    origSetRowGroupColumns(cols);
  };
  unsubs.push(
    mount.grid.on('columnRowGroupChanged', (ev) => {
      const cols =
        (ev as { columns?: string[] }).columns
        ?? mount.grid.getRowGroupColumns();
      void book.setViewGroupBy(viewId, cols);
    }),
  );
  unsubs.push(
    mount.grid.on('sortChanged', () => {
      mount.grid.refreshServerSide({ purge: true });
    }),
  );
  unsubs.push(
    mount.grid.on('filterChanged', () => {
      mount.grid.refreshServerSide({ purge: true });
    }),
  );
  // (Grand totals are kernel-native now — see blotterHost's
  // `grandTotalRow: 'pinnedBottom'`.)
  unsubs.push(
    mount.grid.on('bodyScroll', () => {
      blotterScrollActive.set(viewId, true);
    }),
  );
  unsubs.push(
    mount.grid.on('bodyScrollEnd', () => {
      blotterScrollActive.set(viewId, false);
      const pending = pendingViewTicks.get(viewId);
      if (pending) {
        pendingViewTicks.delete(viewId);
        applyViewTick(pending);
      }
    }),
  );
  blotterUnsubs.set(viewId, unsubs);
}

const blotters = new Map<string, BlotterMount>();
/** Per-blotter gridReady promise, armed at construction time in addView —
 *  gridReady fires once during async init, so a listener attached later
 *  (e.g. after boot's other `await addView` calls) would miss it. */
const blotterReady = new Map<string, Promise<void>>();
// Dev/e2e drivability — expose the mounted blotters + book (same pattern
// as the positions app's `__cgrid`).
(window as unknown as { __blotters: Map<string, BlotterMount> }).__blotters = blotters;
(window as unknown as { __book: PerspectiveBook }).__book = book;
const viewToggleBtns = new Map<string, HTMLButtonElement>();
/** Per-blotter flex-grow weight for horizontal splitters. */
const stageWeights = new Map<string, number>();

const STAGE_MIN_BLOTTER_PX = 220;
const STAGE_MIN_WEIGHT = 0.15;

function ensureStageWeights(): void {
  for (const id of [...stageWeights.keys()]) {
    if (!blotters.has(id)) stageWeights.delete(id);
  }
  for (const id of blotters.keys()) {
    if (!stageWeights.has(id)) stageWeights.set(id, 1);
  }
}

function applyStageFlex(): void {
  for (const [id, mount] of blotters) {
    const w = stageWeights.get(id) ?? 1;
    mount.root.style.flex = `${w} 1 0`;
  }
}

function wireStageResizer(
  resizer: HTMLElement,
  leftId: string,
  rightId: string,
): void {
  let startX = 0;
  let startLeft = 0;
  let startRight = 0;
  let stageWidth = 0;

  const onMove = (ev: PointerEvent): void => {
    if (stageWidth <= 0) return;
    const delta = ev.clientX - startX;
    const pairTotal = startLeft + startRight;
    const deltaWeight = (delta / stageWidth) * pairTotal;
    let nextLeft = startLeft + deltaWeight;
    let nextRight = startRight - deltaWeight;
    if (nextLeft < STAGE_MIN_WEIGHT) {
      nextRight -= STAGE_MIN_WEIGHT - nextLeft;
      nextLeft = STAGE_MIN_WEIGHT;
    }
    if (nextRight < STAGE_MIN_WEIGHT) {
      nextLeft -= STAGE_MIN_WEIGHT - nextRight;
      nextRight = STAGE_MIN_WEIGHT;
    }
    nextLeft = Math.max(STAGE_MIN_WEIGHT, nextLeft);
    nextRight = Math.max(STAGE_MIN_WEIGHT, nextRight);
    stageWeights.set(leftId, nextLeft);
    stageWeights.set(rightId, nextRight);
    applyStageFlex();
  };

  const onUp = (ev: PointerEvent): void => {
    resizer.classList.remove('dragging');
    try { resizer.releasePointerCapture(ev.pointerId); } catch { /* swallow */ }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  resizer.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    startX = ev.clientX;
    stageWidth = stage.clientWidth;
    startLeft = stageWeights.get(leftId) ?? 1;
    startRight = stageWeights.get(rightId) ?? 1;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function syncStageLayout(): void {
  ensureStageWeights();
  stage.replaceChildren();
  const ids = [...blotters.keys()];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const mount = blotters.get(id);
    if (!mount) continue;
    stage.appendChild(mount.root);
    applyStageFlex();
    if (i < ids.length - 1) {
      const resizer = el('div', { className: 'stage-resizer' });
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      wireStageResizer(resizer, id, ids[i + 1]!);
      stage.appendChild(resizer);
    }
  }
}

function applyCellFlashToBlotters(): void {
  for (const m of blotters.values()) {
    try {
      m.grid.updateGridOptions({ enableCellChangeFlash: cellFlashEnabled });
    } catch { /* swallow */ }
  }
}

function paintViz(t: BookTelemetry): void {
  renderVisualizer(vizHost, t, focusedViewId);
  syncBlotterFocus();
}

function syncBlotterFocus(): void {
  for (const [id, mount] of blotters) {
    mount.root.classList.toggle('focused', focusedViewId === id);
  }
}

function setFocusedView(id: string | null): void {
  focusedViewId = id;
  if (latest) paintViz(latest);
  else syncBlotterFocus();
}

async function addView(spec: ViewSpec): Promise<void> {
  if (blotters.has(spec.id)) return;
  await book.registerView(spec);
  const ds = createPerspectiveSsrmDatasource(book, spec.id);
  const mount = mountBlotter({
    id: spec.id,
    title: spec.label,
    theme: THEME,
    datasource: ds,
    qualityMode,
    engine: ENGINE,
    enableCellChangeFlash: cellFlashEnabled,
  });
  // Attach gridReady synchronously at construction (before any await) —
  // see blotterReady.
  blotterReady.set(spec.id, new Promise<void>((resolve) => {
    const off = mount.grid.on('gridReady', () => {
      off();
      resolve();
    });
  }));
  blotters.set(spec.id, mount);
  wireBlotterSsrm(mount, spec.id);
  viewToggleBtns.get(spec.id)?.classList.add('active');
  syncStageLayout();
  setFocusedView(spec.id);
}

async function removeView(id: string): Promise<void> {
  for (const u of blotterUnsubs.get(id) ?? []) u();
  blotterUnsubs.delete(id);
  blotters.get(id)?.destroy();
  blotters.delete(id);
  blotterReady.delete(id);
  stageWeights.delete(id);
  await book.unregisterView(id);
  viewToggleBtns.get(id)?.classList.remove('active');
  if (focusedViewId === id) setFocusedView(null);
  syncStageLayout();
}

vizHost.addEventListener('click', (ev) => {
  const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-view-id]');
  if (!card) return;
  const id = card.dataset.viewId ?? null;
  setFocusedView(focusedViewId === id ? null : id);
});

const connectBtn = el('button', { className: 'btn primary', 'data-testid': 'btn-connect' }, 'Connect');
const pauseBtn = el('button', { className: 'btn', 'data-testid': 'btn-pause' }, 'Pause fan-out');
const refreshBtn = el('button', { className: 'btn' }, 'Refresh views');

const qualitySel = el('select');
for (const q of ['performance', 'auto', 'quality'] as const) {
  const o = el('option', { value: q }, q);
  if (q === qualityMode) o.selected = true;
  qualitySel.appendChild(o);
}

const snapInput = el('input', {
  type: 'number',
  value: '10000',
  min: '100',
  max: '50000',
  step: '500',
});
const rateInput = el('input', { type: 'number', value: '40', min: '1', max: '500' });
const urlInput = el('input', { type: 'text', value: 'ws://localhost:8081' });
urlInput.classList.add('wide');

const flashCheck = el('input', { type: 'checkbox' });
flashCheck.checked = cellFlashEnabled;

const viewToggles = el('div', { className: 'view-toggles' });

for (const spec of VIEW_CATALOG) {
  const btn = el('button', { className: 'btn', 'data-view': spec.id }, spec.label);
  viewToggleBtns.set(spec.id, btn);
  btn.addEventListener('click', () => {
    void (async () => {
      if (blotters.has(spec.id)) await removeView(spec.id);
      else await addView(spec);
    })();
  });
  viewToggles.appendChild(btn);
}

connectBtn.addEventListener('click', () => {
  const phase = book.getPhase();
  if (phase === 'live' || phase === 'snapshot' || phase === 'connecting' || phase === 'bootstrapping') {
    book.disconnect();
    connectBtn.textContent = 'Connect';
  } else {
    book.setKnobs({
      snapshotRows: Number(snapInput.value) || 10_000,
      rate: Number(rateInput.value) || 40,
      wsUrl: urlInput.value.trim() || 'ws://localhost:8081',
    });
    book.connect();
    connectBtn.textContent = 'Disconnect';
  }
});

pauseBtn.addEventListener('click', () => {
  const next = !book.isFanoutPaused();
  book.setPauseFanout(next);
  pauseBtn.textContent = next ? 'Resume fan-out' : 'Pause fan-out';
  pauseBtn.classList.toggle('active', next);
});

refreshBtn.addEventListener('click', () => {
  for (const m of blotters.values()) {
    m.grid.refreshServerSide({ purge: true });
  }
});

qualitySel.addEventListener('change', () => {
  qualityMode = qualitySel.value as typeof qualityMode;
  const active = [...blotters.keys()];
  void (async () => {
    for (const id of active) {
      const spec = VIEW_CATALOG.find((v) => v.id === id);
      if (!spec) continue;
      await removeView(id);
      await addView(spec);
    }
  })();
});

flashCheck.addEventListener('change', () => {
  cellFlashEnabled = flashCheck.checked;
  applyCellFlashToBlotters();
});

window.addEventListener('resize', () => {
  if (blotters.size === 0) return;
  applyStageFlex();
});

controls.append(
  connectBtn,
  pauseBtn,
  refreshBtn,
  field('quality', qualitySel),
  field('cell flash', flashCheck),
  field('snapshot', snapInput),
  field('rate/s', rateInput),
  field('ws', urlInput),
  viewToggles,
);

async function boot(): Promise<void> {
  paintViz(book.getTelemetry());
  for (const id of ['all', 'securitized', 'winners']) {
    const spec = VIEW_CATALOG.find((v) => v.id === id)!;
    await addView(spec);
  }
  await Promise.all([...blotterReady.values()]);
  book.connect();
  connectBtn.textContent = 'Disconnect';
}

void boot().catch((err) => {
  console.error('[ssrm-demo] boot failed', err);
  const banner = el('div', { className: 'queue-empty' }, `Boot failed: ${String(err)}`);
  vizHost.prepend(banner);
});

declare global {
  interface Window {
    __ssrmDemo: {
      book: PerspectiveBook;
      blotters: Map<string, BlotterMount>;
      latest: () => BookTelemetry | null;
      validatePhase1: () => ReturnType<typeof validatePhase1>;
    };
  }
}

window.__ssrmDemo = {
  book,
  blotters,
  latest: () => latest,
  validatePhase1: () => validatePhase1({ book, blotters }),
};
