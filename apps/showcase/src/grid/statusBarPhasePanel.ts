import type { IStatusPanelComp, IStatusPanelParams } from 'ag-grid-community';
import type { StompFeedState } from '../types';

export type PhasePanelContext = {
  getFeed: () => StompFeedState;
  getTotalRows: () => number;
};

type PhasePanelParams = IStatusPanelParams & { context: PhasePanelContext };

function phaseLabel(feed: StompFeedState): string {
  if (feed.phase === 'connecting') return 'Connecting…';
  if (feed.phase === 'snapshot') {
    return `Loading snapshot (${feed.rowsReceived.toLocaleString()} rows)…`;
  }
  if (feed.phase === 'live') return 'Live';
  if (feed.phase === 'error') return `Error: ${feed.error ?? 'unknown'}`;
  return feed.phase;
}

export class StatusBarPhasePanel implements IStatusPanelComp {
  private eGui = document.createElement('div');
  private context!: PhasePanelContext;

  init(params: PhasePanelParams): void {
    this.context = params.context;
    this.eGui.className = 'status-panel';
    this.render();
  }

  getGui(): HTMLElement {
    return this.eGui;
  }

  refresh(): boolean {
    this.render();
    return true;
  }

  private render(): void {
    const feed = this.context.getFeed();
    const totalRows = this.context.getTotalRows();
    this.eGui.innerHTML = `
      <span class="status-dot" data-phase="${feed.phase}"></span>
      <strong>${phaseLabel(feed)}</strong>
      <span>Rows: ${totalRows.toLocaleString()}</span>
      <span>Live updates: ${feed.liveUpdates.toLocaleString()}</span>
    `;
  }
}
