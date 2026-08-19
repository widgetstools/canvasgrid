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
  private eDot = document.createElement('span');
  private eLabel = document.createElement('strong');
  private eRows = document.createElement('span');
  private eLive = document.createElement('span');

  init(params: PhasePanelParams): void {
    this.context = params.context;
    this.eGui.className = 'status-panel';
    this.eDot.className = 'status-dot';
    this.eGui.append(this.eDot, this.eLabel, this.eRows, this.eLive);
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
    this.eDot.dataset.phase = feed.phase;
    this.eLabel.textContent = phaseLabel(feed);
    this.eRows.textContent = `Rows: ${totalRows.toLocaleString()}`;
    this.eLive.textContent = `Live updates: ${feed.liveUpdates.toLocaleString()}`;
  }
}
