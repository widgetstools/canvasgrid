import { Component, OnDestroy, OnInit } from '@angular/core';
import { csvToSsrmUpdates } from './csv-io';
import type { AngularSsrmHost } from './ssrm-host';

@Component({
  selector: 'app-velocity-ssrm-grid',
  standalone: true,
  template: `
    <div class="toolbar">
      <div class="toolbar-group">
        <label>Snapshot rows (AppData)</label>
        <input
          type="number"
          min="500"
          max="20000"
          step="500"
          [value]="snapshotRows"
          (change)="onSnapshotRowsChange($event)"
        />
        <button type="button" (click)="rebindFromAppData()">Re-resolve &amp; rebind</button>
      </div>
      <div class="toolbar-group">
        <button type="button" (click)="exportCsv()">Export CSV</button>
        <button type="button" (click)="copyCsv()">Copy CSV</button>
        <label class="file-btn">
          Import CSV
          <input type="file" accept=".csv,text/csv" (change)="importCsv($event)" hidden />
        </label>
      </div>
      <div class="status">{{ statusText }}</div>
    </div>
    <textarea
      class="csv-preview"
      readonly
      [value]="csvPreview"
      placeholder="CSV preview appears after Copy CSV…"
    ></textarea>
  `,
})
export class VelocitySsrmGrid implements OnInit, OnDestroy {
  snapshotRows = 3_000;
  statusText = 'Grid loading…';
  csvPreview = '';

  private api: AngularSsrmHost | null = null;
  private offStatus: (() => void) | null = null;

  ngOnInit(): void {
    this.api = window.__angularSsrm ?? null;
    if (!this.api) {
      this.statusText = 'Grid host missing — reload the page';
      return;
    }
    this.offStatus = this.api.onStatus((t) => { this.statusText = t; });
    this.statusText = 'SSRM grid ready';
  }

  ngOnDestroy(): void {
    this.offStatus?.();
  }

  onSnapshotRowsChange(ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.snapshotRows = v;
  }

  async rebindFromAppData(): Promise<void> {
    await this.api?.rebindFromAppData(this.snapshotRows);
  }

  async exportCsv(): Promise<void> {
    await this.api?.exportCsv();
  }

  async copyCsv(): Promise<void> {
    const csv = (await this.api?.copyCsv()) ?? '';
    this.csvPreview = csv;
    if (csv && navigator.clipboard?.writeText) await navigator.clipboard.writeText(csv);
  }

  async importCsv(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.api) return;

    const text = await file.text();
    const updates = csvToSsrmUpdates(text);
    if (!updates.length) {
      this.statusText = 'Import: no rows with positionId found';
      return;
    }
    this.api.grid.applyServerSideTransaction({ update: updates });
    this.statusText = `Imported ${updates.length} row update(s)`;
    this.csvPreview = text.slice(0, 4000);
  }
}
