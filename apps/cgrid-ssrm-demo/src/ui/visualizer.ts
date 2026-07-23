import type { BookTelemetry } from '../perspective/book';

function fmt(n: number): string {
  return n.toLocaleString();
}

function phaseClass(phase: string): string {
  if (phase === 'live') return 'ok';
  if (phase === 'snapshot' || phase === 'connecting' || phase === 'bootstrapping') return 'warm';
  if (phase === 'error') return 'bad';
  return 'muted';
}

export function renderVisualizer(
  host: HTMLElement,
  t: BookTelemetry,
  focusedViewId: string | null = null,
): void {
  const viewsHtml = t.views
    .map(
      (v) => `
      <article class="view-card${focusedViewId === v.id ? ' focused' : ''}${v.inflight > 0 ? ' busy' : ''}" data-view-id="${v.id}" title="Click to highlight blotter">
        <header class="view-card-head">
          <div>
            <div class="view-title">${v.label}</div>
            <div class="view-id">${v.id}</div>
          </div>
          <div class="view-pill ${v.inflight > 0 ? 'warm' : 'ok'}">${v.inflight > 0 ? `${v.inflight} in flight` : 'idle'}</div>
        </header>
        <div class="metric-grid">
          <div class="metric"><span class="metric-label">Projected</span><span class="metric-value">${fmt(v.projectedRows)}</span></div>
          <div class="metric"><span class="metric-label">Served</span><span class="metric-value accent">${fmt(v.rowsServed)}</span></div>
          <div class="metric"><span class="metric-label">getRows</span><span class="metric-value">${fmt(v.getRowsCalls)}</span></div>
          <div class="metric"><span class="metric-label">In flight</span><span class="metric-value">${fmt(v.inflight)}</span></div>
        </div>
        <div class="queue-block">
          <div class="queue-label">SSRM window traffic (Perspective View)</div>
          <div class="queue-meta">rows served from View windows only — no full hydrate</div>
        </div>
      </article>`,
    )
    .join('');

  host.innerHTML = `
    <section class="viz-provider">
      <div class="viz-provider-head">
        <div>
          <div class="viz-kicker">Shared DataProvider · Phase 1</div>
          <h2>Perspective WASM Table</h2>
          <div class="viz-sub">${t.wsUrl} · engine=${t.engine}</div>
        </div>
        <div class="phase-badge ${phaseClass(t.phase)}">${t.phase}</div>
      </div>
      <div class="provider-stats">
        <div class="stat big"><span class="stat-label">Book rows</span><span class="stat-value">${fmt(t.bookSize)}</span></div>
        <div class="stat"><span class="stat-label">Snapshot loaded</span><span class="stat-value">${fmt(t.snapshotRowsLoaded)}</span></div>
        <div class="stat"><span class="stat-label">Live rows/s</span><span class="stat-value accent">${fmt(t.liveUpdatesPerSec)}</span></div>
        <div class="stat"><span class="stat-label">Live batches</span><span class="stat-value">${fmt(t.liveBatches)}</span></div>
        <div class="stat"><span class="stat-label">Live rows in</span><span class="stat-value">${fmt(t.liveRowsIn)}</span></div>
        <div class="stat"><span class="stat-label">getRows total</span><span class="stat-value">${fmt(t.getRowsTotal)}</span></div>
        <div class="stat"><span class="stat-label">Rows served</span><span class="stat-value accent">${fmt(t.rowsServedTotal)}</span></div>
        <div class="stat"><span class="stat-label">Views</span><span class="stat-value">${fmt(t.viewCount)}</span></div>
      </div>
      <div class="knob-readout">
        Phase 1: flat View windows · sort/filter/group → Phase 2–4 · SharedWorker multi-tab → Phase 5
      </div>
    </section>
    <section class="viz-views">
      <div class="viz-views-head">
        <h3>SSRM views</h3>
        <span class="viz-hint">Each blotter is a Perspective View over the shared Table. Scroll only loads viewport blocks.</span>
      </div>
      <div class="view-grid">${viewsHtml || '<div class="queue-empty">No views registered</div>'}</div>
    </section>
  `;
}
