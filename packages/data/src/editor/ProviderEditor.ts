import type { ColumnDefinition, DataProviderConfig, TransportType } from '../types';
import type { ConfigBackend } from '../catalog/ConfigBackend';
import { createDefaultConfigBackend } from '../catalog/ConfigBackend';
import { fieldsToColumnDefinitions } from '../schema/infer';
import {
  getTransportPlugin,
  listTransportPlugins,
  type ConnectionFieldsHandle,
} from '../registry/plugins';
import { mountGenericConfigFields } from './connectionFields';
import { ensureEditorStyles } from './styles';
import { registerDefaultTransports } from '../transports/registerDefaults';

export type ProviderEditorOptions = {
  mount: HTMLElement;
  backend?: ConfigBackend;
  initial?: Partial<DataProviderConfig>;
  onSave?: (cfg: DataProviderConfig) => void | Promise<void>;
  onChange?: (cfg: DataProviderConfig) => void;
};

const TABS = ['Connection', 'Schema', 'Performance', 'Row model', 'Preview'] as const;
type Tab = (typeof TABS)[number];

const PIPELINE_DEFAULTS = {
  throttleEnabled: true,
  throttleMs: 100,
  conflateEnabled: true,
  wireFormat: 'json' as const,
  snapshotChunkSize: 500,
};

function defaultConfig(partial?: Partial<DataProviderConfig>): DataProviderConfig {
  registerDefaultTransports();
  const type = partial?.providerType ?? 'mock';
  const plugin = getTransportPlugin(type);
  const pluginDefaults = plugin?.defaultConfig() ?? {};
  const keyColumn = plugin?.defaultKeyFields
    ?? (pluginDefaults.keyColumn as string | undefined)
    ?? 'positionId';
  return {
    providerId: partial?.providerId ?? `provider-${Date.now().toString(36)}`,
    name: partial?.name ?? 'New provider',
    description: partial?.description ?? '',
    providerType: type,
    rowModel: partial?.rowModel ?? 'clientSide',
    blockSize: partial?.blockSize ?? 100,
    ...partial,
    config: {
      ...PIPELINE_DEFAULTS,
      keyColumn,
      ...pluginDefaults,
      ...(partial?.config ?? {}),
    } as DataProviderConfig['config'],
  };
}

/**
 * Vanilla provider editor shell: Connection (plugin fields) / Schema /
 * Performance / Row model / Preview. Save/load via ConfigBackend.
 */
export class ProviderEditor {
  private readonly root: HTMLElement;
  private readonly backend: ConfigBackend;
  private readonly onSave?: ProviderEditorOptions['onSave'];
  private readonly onChange?: ProviderEditorOptions['onChange'];
  private cfg: DataProviderConfig;
  private tab: Tab = 'Connection';
  private statusText = 'idle';
  private samplePreview = '[]';
  private connectionFields: ConnectionFieldsHandle | null = null;

  constructor(opts: ProviderEditorOptions) {
    ensureEditorStyles();
    registerDefaultTransports();
    this.backend = opts.backend ?? createDefaultConfigBackend();
    this.onSave = opts.onSave;
    this.onChange = opts.onChange;
    this.cfg = defaultConfig(opts.initial);
    this.root = document.createElement('div');
    this.root.className = 'vg-dp-editor';
    opts.mount.appendChild(this.root);
    this.render();
  }

  getConfig(): DataProviderConfig {
    return structuredClone(this.cfg);
  }

  setConfig(cfg: DataProviderConfig): void {
    this.cfg = structuredClone(cfg);
    this.render();
  }

  setPreview(status: string, sampleRows: unknown[]): void {
    this.statusText = status;
    this.samplePreview = JSON.stringify(sampleRows.slice(0, 5), null, 2);
    if (this.tab === 'Preview') this.render();
    else {
      const el = this.root.querySelector('.vg-dp-editor__status');
      if (el) el.textContent = status;
    }
  }

  destroy(): void {
    this.connectionFields?.destroy();
    this.connectionFields = null;
    this.root.remove();
  }

  private emitChange(): void {
    this.onChange?.(this.getConfig());
  }

  private async save(): Promise<void> {
    const saved = await this.backend.save(this.cfg);
    this.cfg = saved;
    await this.onSave?.(saved);
    this.statusText = `saved ${saved.providerId}`;
    this.render();
  }

  private async loadById(): Promise<void> {
    const id = window.prompt('providerId', this.cfg.providerId);
    if (!id) return;
    const cfg = await this.backend.get(id);
    if (!cfg) {
      this.statusText = `not found: ${id}`;
      this.render();
      return;
    }
    this.cfg = cfg;
    this.statusText = `loaded ${id}`;
    this.render();
    this.emitChange();
  }

  private async loadByName(): Promise<void> {
    const name = window.prompt('name', this.cfg.name);
    if (!name) return;
    const cfg = await this.backend.getByName(name);
    if (!cfg) {
      this.statusText = `not found: ${name}`;
      this.render();
      return;
    }
    this.cfg = cfg;
    this.statusText = `loaded ${name}`;
    this.render();
    this.emitChange();
  }

  private promoteAllFields(): void {
    const inferred = this.cfg.config.inferredFields ?? [];
    const next = fieldsToColumnDefinitions(inferred);
    const existing = new Set((this.cfg.config.columnDefinitions ?? []).map((c) => c.field));
    const merged: ColumnDefinition[] = [
      ...(this.cfg.config.columnDefinitions ?? []),
      ...next.filter((c) => !existing.has(c.field)),
    ];
    this.cfg = {
      ...this.cfg,
      config: { ...this.cfg.config, columnDefinitions: merged },
    };
    this.emitChange();
    this.render();
  }

  private render(): void {
    this.connectionFields?.destroy();
    this.connectionFields = null;
    this.root.innerHTML = '';
    this.root.appendChild(this.renderHeader());
    this.root.appendChild(this.renderTabs());
    const body = document.createElement('div');
    body.className = 'vg-dp-editor__body';
    body.appendChild(this.renderTabBody());
    this.root.appendChild(body);
    this.root.appendChild(this.renderActions());
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'vg-dp-editor__header';
    const brand = document.createElement('div');
    brand.className = 'vg-dp-editor__brand';
    brand.textContent = 'Data Provider';
    const name = document.createElement('input');
    name.value = this.cfg.name;
    name.placeholder = 'Name';
    name.addEventListener('change', () => {
      this.cfg.name = name.value;
      this.emitChange();
    });
    const id = document.createElement('input');
    id.value = this.cfg.providerId;
    id.placeholder = 'providerId';
    id.addEventListener('change', () => {
      this.cfg.providerId = id.value;
      this.emitChange();
    });
    const status = document.createElement('div');
    status.className = 'vg-dp-editor__status';
    status.textContent = this.statusText;
    header.append(brand, name, id, status);
    return header;
  }

  private renderTabs(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'vg-dp-editor__tabs';
    bar.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vg-dp-editor__tab';
      btn.textContent = t;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(t === this.tab));
      btn.addEventListener('click', () => {
        this.tab = t;
        this.render();
      });
      bar.appendChild(btn);
    }
    return bar;
  }

  private renderActions(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'vg-dp-editor__actions';
    const mk = (label: string, fn: () => void, secondary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (secondary) b.className = 'secondary';
      b.addEventListener('click', fn);
      return b;
    };
    bar.append(
      mk('Save', () => { void this.save(); }),
      mk('Load by id', () => { void this.loadById(); }, true),
      mk('Load by name', () => { void this.loadByName(); }, true),
    );
    return bar;
  }

  private field(grid: HTMLElement, label: string, control: HTMLElement): void {
    const lab = document.createElement('label');
    lab.textContent = label;
    grid.append(lab, control);
  }

  private input(
    value: string | number | boolean | undefined,
    onChange: (v: string) => void,
    type = 'text',
  ): HTMLInputElement {
    const el = document.createElement('input');
    el.type = type;
    if (type === 'checkbox') el.checked = Boolean(value);
    else el.value = value == null ? '' : String(value);
    el.addEventListener('change', () => onChange(type === 'checkbox' ? String(el.checked) : el.value));
    return el;
  }

  private select(
    value: string,
    options: string[],
    onChange: (v: string) => void,
  ): HTMLSelectElement {
    const el = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      if (o === value) opt.selected = true;
      el.appendChild(opt);
    }
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  private patchConfig(patch: Record<string, unknown>): void {
    this.cfg = {
      ...this.cfg,
      config: { ...this.cfg.config, ...patch } as DataProviderConfig['config'],
    };
    this.emitChange();
  }

  private renderTabBody(): HTMLElement {
    switch (this.tab) {
      case 'Connection':
        return this.renderConnection();
      case 'Schema':
        return this.renderSchema();
      case 'Performance':
        return this.renderPerformance();
      case 'Row model':
        return this.renderRowModel();
      case 'Preview':
        return this.renderPreview();
    }
  }

  private renderConnection(): HTMLElement {
    const wrap = document.createElement('div');
    const grid = document.createElement('div');
    grid.className = 'vg-dp-editor__grid';

    const plugins = listTransportPlugins();
    const ids = plugins.map((p) => p.id);
    if (!ids.includes(this.cfg.providerType)) ids.push(this.cfg.providerType);

    const labels = Object.fromEntries(plugins.map((p) => [p.id, p.label]));
    const sel = document.createElement('select');
    for (const id of ids) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = labels[id] ?? id;
      if (id === this.cfg.providerType) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      const next = sel.value as TransportType;
      const plugin = getTransportPlugin(next);
      this.cfg.providerType = next;
      this.cfg.config = {
        ...PIPELINE_DEFAULTS,
        keyColumn: plugin?.defaultKeyFields ?? 'positionId',
        ...(plugin?.defaultConfig() ?? {}),
      } as DataProviderConfig['config'];
      this.emitChange();
      this.render();
    });
    this.field(grid, 'Transport', sel);

    const c = this.cfg.config as Record<string, unknown>;
    this.field(grid, 'keyColumn', this.input(
      Array.isArray(c.keyColumn) ? (c.keyColumn as string[]).join(',') : (c.keyColumn as string) ?? '',
      (v) => this.patchConfig({ keyColumn: v.includes(',') ? v.split(',').map((s) => s.trim()) : v }),
    ));
    wrap.appendChild(grid);

    const pluginHost = document.createElement('div');
    pluginHost.style.marginTop = '12px';
    wrap.appendChild(pluginHost);

    const plugin = getTransportPlugin(this.cfg.providerType);
    const api = {
      value: this.cfg.config as Record<string, unknown>,
      onChange: (patch: Record<string, unknown>) => this.patchConfig(patch),
    };
    this.connectionFields = plugin?.mountConnectionFields
      ? plugin.mountConnectionFields(pluginHost, api)
      : mountGenericConfigFields(pluginHost, api);

    return wrap;
  }

  private renderSchema(): HTMLElement {
    const wrap = document.createElement('div');
    const actions = document.createElement('div');
    actions.style.marginBottom = '12px';
    const promote = document.createElement('button');
    promote.type = 'button';
    promote.textContent = 'Promote inferred → column defs';
    promote.addEventListener('click', () => this.promoteAllFields());
    actions.appendChild(promote);
    wrap.appendChild(actions);

    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Path</th><th>Type</th><th>Null%</th><th>Sample</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const f of this.cfg.config.inferredFields ?? []) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${f.path}</td><td>${f.inferredType}</td><td>${(f.nullRatio * 100).toFixed(0)}%</td><td>${JSON.stringify(f.samples[0] ?? '')}</td>`;
      tbody.appendChild(tr);
    }
    if (!(this.cfg.config.inferredFields?.length)) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4">No inferred fields yet — start the provider to sample rows, then re-open Schema.</td>';
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    const authored = document.createElement('p');
    authored.style.marginTop = '16px';
    authored.textContent = `Authored columnDefinitions: ${(this.cfg.config.columnDefinitions ?? []).length}`;
    wrap.appendChild(authored);
    return wrap;
  }

  private renderPerformance(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'vg-dp-editor__grid';
    const c = this.cfg.config;
    this.field(grid, 'throttleEnabled', this.input(c.throttleEnabled !== false, (v) => this.patchConfig({ throttleEnabled: v === 'true' }), 'checkbox'));
    this.field(grid, 'throttleMs', this.input(c.throttleMs ?? 100, (v) => this.patchConfig({ throttleMs: Number(v) || 0 }), 'number'));
    this.field(grid, 'conflateEnabled', this.input(c.conflateEnabled !== false, (v) => this.patchConfig({ conflateEnabled: v === 'true' }), 'checkbox'));
    this.field(grid, 'thinDeltas', this.input(Boolean(c.thinDeltas), (v) => this.patchConfig({ thinDeltas: v === 'true' }), 'checkbox'));
    this.field(grid, 'projectFields', this.input(Boolean(c.projectFields), (v) => this.patchConfig({ projectFields: v === 'true' }), 'checkbox'));
    this.field(grid, 'wireFormat', this.select(c.wireFormat ?? 'json', ['json', 'columnar'], (v) => this.patchConfig({ wireFormat: v })));
    this.field(grid, 'snapshotChunkSize', this.input(c.snapshotChunkSize ?? 500, (v) => this.patchConfig({ snapshotChunkSize: Number(v) || 500 }), 'number'));
    return grid;
  }

  private renderRowModel(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'vg-dp-editor__grid';
    this.field(
      grid,
      'rowModel',
      this.select(this.cfg.rowModel, ['clientSide', 'serverSide'], (v) => {
        this.cfg.rowModel = v as DataProviderConfig['rowModel'];
        this.emitChange();
      }),
    );
    this.field(
      grid,
      'blockSize',
      this.input(this.cfg.blockSize ?? 100, (v) => {
        this.cfg.blockSize = Number(v) || 100;
        this.emitChange();
      }, 'number'),
    );
    return grid;
  }

  private renderPreview(): HTMLElement {
    const wrap = document.createElement('div');
    const status = document.createElement('p');
    status.textContent = `Status: ${this.statusText}`;
    const pre = document.createElement('pre');
    pre.className = 'vg-dp-editor__preview';
    pre.textContent = this.samplePreview;
    wrap.append(status, pre);
    return wrap;
  }
}

export function mountProviderEditor(opts: ProviderEditorOptions): ProviderEditor {
  return new ProviderEditor(opts);
}
