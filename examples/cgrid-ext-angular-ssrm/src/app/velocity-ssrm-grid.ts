import { Component, OnDestroy, OnInit } from '@angular/core';
import type { VelocityGridExtConfig } from '@wellsfargo-starui/velocity-grid-ext';
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
        <button type="button" (click)="exportConfig()">Export config</button>
        <button type="button" (click)="copyConfig()">Copy config</button>
        <button type="button" (click)="persistConfig()">Save to store</button>
        <label class="file-btn">
          Import config
          <input type="file" accept=".json,application/json" (change)="importConfig($event)" hidden />
        </label>
      </div>
      <div class="status">{{ statusText }}</div>
    </div>
    <textarea
      class="config-preview"
      readonly
      [value]="configPreview"
      placeholder="Config JSON preview appears after Export / Copy…"
    ></textarea>
  `,
})
export class VelocitySsrmGrid implements OnInit, OnDestroy {
  snapshotRows = 3_000;
  statusText = 'Grid loading…';
  configPreview = '';

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

  exportConfig(): void {
    this.api?.downloadConfig();
    this.configPreview = this.api?.exportConfigJson() ?? '';
  }

  async copyConfig(): Promise<void> {
    const json = this.api?.exportConfigJson() ?? '';
    this.configPreview = json;
    if (json && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      this.statusText = 'Copied grid config JSON to clipboard';
    }
  }

  persistConfig(): void {
    this.api?.persistConfig();
  }

  async importConfig(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.api) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as VelocityGridExtConfig;
      this.api.importConfig(parsed);
      this.configPreview = JSON.stringify(parsed, null, 2).slice(0, 8000);
    } catch (err) {
      this.statusText = err instanceof Error ? err.message : String(err);
    }
  }
}
