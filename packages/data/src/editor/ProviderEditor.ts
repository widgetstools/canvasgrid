/**
 * ProviderEditor — Markets EditorForm parity (vanilla DOM).
 *
 * Tabs: Connection / Fields / Columns / Behaviour / Diagnostics (saved only).
 * Owns working config, probe, pending Fields→Columns buffer, and save state.
 */
import type { ColumnDefinition, DataProviderConfig, TransportType } from '../types';
import type { ConfigBackend } from '../catalog/ConfigBackend';
import { createDefaultConfigBackend } from '../catalog/ConfigBackend';
import type { ProviderClientOptions } from '../client/ProviderClientAdapter';
import {
  getTransportPlugin,
  listTransportPlugins,
  type ConnectionFieldsHandle,
} from '../registry/plugins';
import { mountGenericConfigFields } from './connectionFields';
import {
  createProviderProbe,
  buildColumnsFromFields,
  type ProviderProbe,
} from './providerProbe';
import { exportProviderConfig } from './providerConfigIo';
import { exportColumnDefs, parseColumnDefsImport } from './columnDefsIo';
import { normalizeKeyColumns, readKeyColumns } from './keyColumn';
import { mountMultiSelect, type MultiSelectHandle } from './MultiSelect';
import { ensureEditorStyles } from './styles';
import { registerDefaultTransports } from '../transports/registerDefaults';
import { DRAFT_LIST_ID_PREFIX } from './providerSidebarList';
import {
  createDiagnosticsSession,
  type DiagnosticsSession,
  type DiagnosticsState,
} from './diagnosticsSession';
import {
  createBadge,
  createButton,
  createCard,
  createCheckbox,
  createEmptyState,
  createField,
  createNumberField,
  createSearchInput,
  createSelect,
  createSwitch,
  createSwitchField,
  createTabs,
  createTextarea,
  createTextInput,
} from './ui';

export type ProviderEditorOptions = {
  mount: HTMLElement;
  backend?: ConfigBackend;
  initial?: Partial<DataProviderConfig>;
  onSave?: (cfg: DataProviderConfig) => void | Promise<void>;
  onChange?: (cfg: DataProviderConfig) => void;
  /** Markets EditorForm cancel — e.g. clear draft / close popout. */
  onCancel?: () => void;
  /** Duplicate current saved provider into a new unsaved draft (shell owns clone). */
  onClone?: () => void;
  /** Hide Load-by-id/name chrome when embedded in the list shell. */
  compactActions?: boolean;
  /** Hub connection options for Diagnostics (must match grid / lab). */
  hubOpts?: ProviderClientOptions;
};

const CONFLATE_NONE = '__none__';

const TABS = ['Connection', 'Fields', 'Columns', 'Behaviour', 'Diagnostics'] as const;
type Tab = (typeof TABS)[number];

const SAMPLE_SIZES = [50, 100, 200, 500] as const;
type SampleSize = (typeof SAMPLE_SIZES)[number];

const PIPELINE_DEFAULTS = {
  throttleEnabled: true,
  throttleMs: 100,
  conflateEnabled: true,
  wireFormat: 'json' as const,
  snapshotChunkSize: 500,
};

const SAVING_PULSE_MS = 1200;
const CELL_TYPES = ['text', 'number', 'boolean', 'date'] as const;

function isStableProviderId(id: string | undefined): boolean {
  return Boolean(id) && !id!.startsWith(DRAFT_LIST_ID_PREFIX);
}

function defaultConfig(partial?: Partial<DataProviderConfig>): DataProviderConfig {
  registerDefaultTransports();
  const type = partial?.providerType ?? 'mock';
  const plugin = getTransportPlugin(type);
  const pluginDefaults = plugin?.defaultConfig() ?? {};
  const keyColumn = plugin?.defaultKeyFields
    ?? (pluginDefaults.keyColumn as string | undefined)
    ?? 'positionId';
  // Mint providerId only when the partial already carries one; drafts stay empty.
  const providerId = partial?.providerId ?? '';
  return {
    name: partial?.name ?? 'untitled',
    description: partial?.description ?? '',
    providerType: type,
    rowModel: partial?.rowModel ?? 'clientSide',
    blockSize: partial?.blockSize ?? 100,
    public: partial?.public ?? false,
    tags: partial?.tags,
    isDefault: partial?.isDefault,
    userId: partial?.userId,
    updatedAt: partial?.updatedAt,
    providerId,
    config: {
      ...PIPELINE_DEFAULTS,
      keyColumn,
      ...pluginDefaults,
      ...(partial?.config ?? {}),
    } as DataProviderConfig['config'],
  };
}

/**
 * Vanilla provider form (Markets EditorForm parity).
 */
export class ProviderEditor {
  private readonly root: HTMLElement;
  private readonly backend: ConfigBackend;
  private readonly onSave?: ProviderEditorOptions['onSave'];
  private readonly onChange?: ProviderEditorOptions['onChange'];
  private readonly onCancel?: ProviderEditorOptions['onCancel'];
  private readonly onClone?: ProviderEditorOptions['onClone'];
  private readonly compactActions: boolean;
  private readonly hubOpts?: ProviderClientOptions;

  private cfg: DataProviderConfig;
  private tab: Tab = 'Connection';
  private readonly probe: ProviderProbe;
  private unsubProbe: (() => void) | null = null;
  private pendingFieldsCols: ColumnDefinition[] | null = null;
  private sampleSize: SampleSize = 200;
  private selectedFieldPaths: Set<string>;
  private fieldsSearch = '';
  private saving = false;
  private savedAt: number | null = null;
  private saveError: string | null = null;
  private savedPulseTimer: ReturnType<typeof setTimeout> | null = null;
  private statusText = 'idle';
  private samplePreview = '[]';
  private connectionFields: ConnectionFieldsHandle | null = null;
  private keyMultiSelect: MultiSelectHandle | null = null;
  private diagSession: DiagnosticsSession | null = null;
  private unsubDiag: (() => void) | null = null;
  private diagBoundId: string | null = null;

  constructor(opts: ProviderEditorOptions) {
    ensureEditorStyles();
    registerDefaultTransports();
    this.backend = opts.backend ?? createDefaultConfigBackend();
    this.onSave = opts.onSave;
    this.onChange = opts.onChange;
    this.onCancel = opts.onCancel;
    this.onClone = opts.onClone;
    this.compactActions = opts.compactActions ?? false;
    this.hubOpts = opts.hubOpts;
    this.cfg = defaultConfig(opts.initial);
    this.selectedFieldPaths = new Set(
      (this.cfg.config.columnDefinitions ?? []).map((c) => c.field),
    );
    this.probe = createProviderProbe(() => ({
      providerType: this.cfg.providerType,
      config: this.cfg.config,
    }));
    this.unsubProbe = this.probe.subscribe(() => {
      if (this.probe.inferredFields.length) {
        this.cfg = {
          ...this.cfg,
          config: {
            ...this.cfg.config,
            inferredFields: this.probe.inferredFields,
          },
        };
      }
      if (this.tab === 'Connection' || this.tab === 'Fields') this.render();
    });
    this.root = document.createElement('div');
    this.root.className = 'vg-dp-editor';
    this.root.setAttribute('data-testid', 'provider-editor');
    opts.mount.appendChild(this.root);
    this.render();
  }

  getConfig(): DataProviderConfig {
    return structuredClone(this.cfg);
  }

  setConfig(cfg: DataProviderConfig): void {
    this.cfg = structuredClone(cfg);
    this.pendingFieldsCols = null;
    this.selectedFieldPaths = new Set(
      (this.cfg.config.columnDefinitions ?? []).map((c) => c.field),
    );
    this.savedAt = null;
    this.saveError = null;
    this.probe.reset();
    this.render();
  }

  setPreview(status: string, sampleRows: unknown[]): void {
    this.statusText = status;
    this.samplePreview = JSON.stringify(sampleRows.slice(0, 5), null, 2);
    if (this.tab === 'Diagnostics') this.render();
    else {
      const el = this.root.querySelector('.vg-dp-editor__status');
      if (el) el.textContent = status;
    }
  }

  destroy(): void {
    if (this.savedPulseTimer) clearTimeout(this.savedPulseTimer);
    this.teardownDiagnostics();
    this.unsubProbe?.();
    this.unsubProbe = null;
    this.connectionFields?.destroy();
    this.connectionFields = null;
    this.keyMultiSelect?.destroy();
    this.keyMultiSelect = null;
    this.root.remove();
  }

  private teardownDiagnostics(): void {
    this.unsubDiag?.();
    this.unsubDiag = null;
    this.diagBoundId = null;
    this.diagSession?.destroy();
    this.diagSession = null;
  }

  private ensureDiagnosticsSession(): DiagnosticsSession {
    if (!this.diagSession) {
      this.diagSession = createDiagnosticsSession(this.hubOpts);
    }
    return this.diagSession;
  }

  private emitChange(): void {
    this.onChange?.(this.getConfig());
  }

  private isExisting(): boolean {
    return isStableProviderId(this.cfg.providerId);
  }

  private saveLabel(): string {
    return this.isExisting() ? 'Update DataProvider' : 'Create DataProvider';
  }

  private hasPendingFieldsChanges(): boolean {
    if (!this.pendingFieldsCols) return false;
    const existing = new Set((this.cfg.config.columnDefinitions ?? []).map((c) => c.field));
    return this.pendingFieldsCols.some((c) => !existing.has(c.field));
  }

  private applyPendingFieldsCols(): void {
    if (!this.pendingFieldsCols) return;
    const existing = this.cfg.config.columnDefinitions ?? [];
    const existingByField = new Map(existing.map((c) => [c.field, c]));
    const merged = [...existing];
    for (const incoming of this.pendingFieldsCols) {
      if (!existingByField.has(incoming.field)) merged.push(incoming);
    }
    this.cfg = {
      ...this.cfg,
      config: { ...this.cfg.config, columnDefinitions: merged },
    };
    this.pendingFieldsCols = null;
    this.selectedFieldPaths = new Set(merged.map((c) => c.field));
    this.emitChange();
    this.render();
  }

  private async save(): Promise<void> {
    this.saving = true;
    this.saveError = null;
    this.render();
    try {
      let next = structuredClone(this.cfg);
      if (!next.providerId || next.providerId.startsWith(DRAFT_LIST_ID_PREFIX)) {
        next.providerId = `provider-${Date.now().toString(36)}`;
      }
      if (this.probe.inferredFields.length) {
        next = {
          ...next,
          config: { ...next.config, inferredFields: this.probe.inferredFields },
        };
      }
      const saved = await this.backend.save(next);
      this.cfg = saved;
      this.savedAt = Date.now();
      this.saveError = null;
      if (this.savedPulseTimer) clearTimeout(this.savedPulseTimer);
      this.savedPulseTimer = setTimeout(() => {
        this.savedAt = null;
        this.savedPulseTimer = null;
        this.render();
      }, SAVING_PULSE_MS);
      await this.onSave?.(saved);
    } catch (err) {
      this.saveError = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private patchConfig(patch: Record<string, unknown>): void {
    this.cfg = {
      ...this.cfg,
      config: { ...this.cfg.config, ...patch } as DataProviderConfig['config'],
    };
    this.emitChange();
  }

  private render(): void {
    this.connectionFields?.destroy();
    this.connectionFields = null;
    this.keyMultiSelect?.destroy();
    this.keyMultiSelect = null;
    this.root.innerHTML = '';
    this.root.appendChild(this.renderHeader());
    this.root.appendChild(this.renderTabs());
    const body = document.createElement('div');
    body.className = 'vg-dp-editor__body';
    body.appendChild(this.renderTabBody());
    this.root.appendChild(body);
    this.root.appendChild(this.renderFooter());
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('header');
    header.className = 'vg-dp-editor__header';

    const row = document.createElement('div');
    row.className = 'vg-dp-editor__header-row';

    const nameBlock = document.createElement('div');
    nameBlock.className = 'vg-dp-editor__header-name';
    const nameLab = document.createElement('label');
    nameLab.className = 'vg-dp-field__label';
    nameLab.textContent = 'Name *';
    const name = createTextInput({
      value: this.cfg.name,
      placeholder: 'positions-live',
      onChange: (value) => {
        this.cfg.name = value;
        this.emitChange();
      },
    });
    nameBlock.append(nameLab, name);

    const descBlock = document.createElement('div');
    descBlock.className = 'vg-dp-editor__header-desc';
    const descLab = document.createElement('label');
    descLab.className = 'vg-dp-field__label';
    descLab.textContent = 'Description';
    const desc = createTextarea({
      rows: 1,
      placeholder: 'What this provider streams (optional)',
      value: this.cfg.description ?? '',
      onChange: (value) => {
        this.cfg.description = value;
        this.emitChange();
      },
    });
    descBlock.append(descLab, desc);

    const pubBlock = document.createElement('div');
    pubBlock.className = 'vg-dp-editor__header-public';
    const sw = createSwitch(Boolean(this.cfg.public), (on) => {
      this.cfg.public = on;
      this.emitChange();
    });
    const pubLab = document.createElement('label');
    pubLab.className = 'vg-dp-field__label';
    pubLab.textContent = 'Public';
    pubLab.style.cursor = 'pointer';
    pubLab.addEventListener('click', () => sw.click());
    pubBlock.append(sw, pubLab);

    row.append(nameBlock, descBlock, pubBlock);
    header.appendChild(row);
    return header;
  }

  private renderTabs(): HTMLElement {
    const tabs: Tab[] = this.isExisting()
      ? [...TABS]
      : TABS.filter((t) => t !== 'Diagnostics');
    if (!this.isExisting() && this.tab === 'Diagnostics') this.tab = 'Connection';
    return createTabs({
      tabs,
      active: this.tab,
      onChange: (id) => {
        this.tab = id;
        this.render();
      },
    });
  }

  private renderFooter(): HTMLElement {
    const footer = document.createElement('footer');
    footer.className = 'vg-dp-editor__actions';

    const left = document.createElement('div');
    left.className = 'vg-dp-editor__actions-left';
    if (this.saveError) {
      left.classList.add('is-error');
      left.textContent = this.saveError;
    } else if (this.savedAt) {
      left.classList.add('is-saved');
      left.textContent = 'Saved';
    } else {
      left.textContent = `Unsaved changes are kept locally until you click ${this.saveLabel()}.`;
    }

    const right = document.createElement('div');
    right.className = 'vg-dp-editor__actions-right';

    if (this.onCancel) {
      right.appendChild(createButton({
        label: 'Cancel',
        onClick: () => this.onCancel?.(),
        variant: 'secondary',
      }));
    }
    right.appendChild(createButton({
      label: 'Export',
      onClick: () => exportProviderConfig(this.cfg),
      variant: 'secondary',
      title: 'Download this provider config (including unsaved edits) as a JSON file',
    }));
    if (this.onClone) {
      right.appendChild(createButton({
        label: 'Duplicate',
        onClick: () => this.onClone?.(),
        variant: 'secondary',
        title: 'Copy this provider into a new draft you can edit and save separately',
      }));
    }
    right.appendChild(createButton({
      label: 'Update Columns',
      onClick: () => this.applyPendingFieldsCols(),
      variant: 'secondary',
      disabled: !this.hasPendingFieldsChanges(),
      testId: 'update-columns',
      title: this.hasPendingFieldsChanges()
        ? 'Merge the Fields-tab selection into the Columns tab (existing columns kept; new fields appended).'
        : 'No new fields selected in the Fields tab.',
    }));
    right.appendChild(createButton({
      label: this.saving ? 'Saving…' : this.saveLabel(),
      onClick: () => { void this.save(); },
      variant: 'primary',
      disabled: this.saving,
      testId: 'save-provider',
    }));

    // compactActions reserved for shell embed; Markets footer is always shown.
    void this.compactActions;

    footer.append(left, right);
    return footer;
  }

  private renderTabBody(): HTMLElement {
    switch (this.tab) {
      case 'Connection':
        return this.renderConnection();
      case 'Fields':
        return this.renderFields();
      case 'Columns':
        return this.renderColumns();
      case 'Behaviour':
        return this.renderBehaviour();
      case 'Diagnostics':
        return this.renderDiagnostics();
    }
  }

  private renderConnection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vg-dp-editor__connection';

    const scroll = document.createElement('div');
    scroll.className = 'vg-dp-editor__connection-scroll';

    const grid = document.createElement('div');
    grid.className = 'vg-dp-fields';

    const plugins = listTransportPlugins();
    const ids = plugins.map((p) => p.id);
    if (!ids.includes(this.cfg.providerType)) ids.push(this.cfg.providerType);
    const labels = Object.fromEntries(plugins.map((p) => [p.id, p.label]));
    const transportCard = createCard('Transport', (card) => {
      card.appendChild(createField({
        label: 'Transport',
        control: createSelect({
          value: this.cfg.providerType,
          options: ids.map((id) => ({ value: id, label: labels[id] ?? id })),
          onChange: (value) => {
            const next = value as TransportType;
            const plugin = getTransportPlugin(next);
            this.cfg.providerType = next;
            this.cfg.config = {
              ...PIPELINE_DEFAULTS,
              keyColumn: plugin?.defaultKeyFields ?? 'positionId',
              ...(plugin?.defaultConfig() ?? {}),
            } as DataProviderConfig['config'];
            this.probe.reset();
            this.emitChange();
            this.render();
          },
        }),
      }));
    });
    grid.appendChild(transportCard);
    scroll.appendChild(grid);

    const pluginHost = document.createElement('div');
    pluginHost.style.marginTop = '12px';
    scroll.appendChild(pluginHost);

    const plugin = getTransportPlugin(this.cfg.providerType);
    const api = {
      value: this.cfg.config as Record<string, unknown>,
      onChange: (patch: Record<string, unknown>) => this.patchConfig(patch),
    };
    this.connectionFields = plugin?.mountConnectionFields
      ? plugin.mountConnectionFields(pluginHost, api)
      : mountGenericConfigFields(pluginHost, api);

    wrap.appendChild(scroll);

    const showTest = this.cfg.providerType === 'stomp' || this.cfg.providerType === 'rest';
    if (showTest) {
      wrap.appendChild(this.renderTestStrip());
    }
    return wrap;
  }

  private renderTestStrip(): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'vg-dp-editor__test-strip';
    const pill = document.createElement('span');
    pill.className = 'vg-dp-editor__test-pill';
    if (this.probe.testing) {
      pill.textContent = 'Connecting…';
    } else if (!this.probe.testResult) {
      pill.textContent = 'Not yet tested.';
    } else if (this.probe.testResult.success) {
      pill.classList.add('is-ok');
      const n = this.probe.testResult.rowCount;
      pill.textContent = n === undefined
        ? 'Connected'
        : `Connected — received ${n} row${n === 1 ? '' : 's'}`;
    } else {
      pill.classList.add('is-error');
      pill.textContent = this.probe.testResult.error ?? 'connection failed';
    }
    const btn = createButton({
      label: this.probe.testing ? 'Connecting…' : 'Test Connection',
      onClick: () => { void this.probe.test(); },
      disabled: this.probe.testing,
      testId: 'test-connection',
    });
    strip.append(pill, btn);
    return strip;
  }

  private renderFields(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vg-dp-editor__fields-tab';

    if (!this.probe.inferredFields.length) {
      wrap.appendChild(this.renderFieldsEmpty());
      return wrap;
    }

    if (this.probe.inferenceSummary) {
      const bar = document.createElement('div');
      bar.className = 'vg-dp-editor__inference-bar';
      const left = document.createElement('div');
      left.className = 'vg-dp-editor__inference-meta';
      const badge = createBadge('INFERENCE');
      const s = this.probe.inferenceSummary;
      const meta = document.createElement('span');
      meta.textContent = `${s.rowsUsed} rows used (of ${s.rowsFetched}) · ${s.fieldsDetected} fields detected`;
      left.append(badge, meta);

      const right = document.createElement('div');
      right.className = 'vg-dp-editor__inline-actions';
      right.style.marginBottom = '0';
      right.appendChild(this.sampleSizeSelect());
      right.appendChild(createButton({
        label: this.probe.inferring ? 'Inferring…' : 'Re-sample',
        onClick: () => { void this.probe.infer({ sampleSize: this.sampleSize }); },
        disabled: this.probe.inferring,
      }));
      bar.append(left, right);
      wrap.appendChild(bar);
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'vg-dp-editor__fields-toolbar';
    const search = createSearchInput({
      value: this.fieldsSearch,
      placeholder: 'Search fields…',
      onInput: (value) => {
        this.fieldsSearch = value;
        this.render();
      },
    });

    const selectRow = document.createElement('div');
    selectRow.className = 'vg-dp-editor__select-all';
    const q = this.fieldsSearch.trim().toLowerCase();
    const visible = this.probe.inferredFields.filter((f) =>
      !q || f.path.toLowerCase().includes(q) || f.inferredType.toLowerCase().includes(q));
    const selectable = visible.filter((f) => f.inferredType !== 'object');
    const allSelected = selectable.length > 0
      && selectable.every((f) => this.selectedFieldPaths.has(f.path));
    const someSelected = !allSelected && selectable.some((f) => this.selectedFieldPaths.has(f.path));
    const allCb = createCheckbox({
      checked: allSelected,
      onChange: (checked) => {
        const next = new Set(this.selectedFieldPaths);
        if (checked) for (const f of selectable) next.add(f.path);
        else for (const f of selectable) next.delete(f.path);
        this.commitFieldSelection(next);
      },
    });
    allCb.indeterminate = someSelected;
    const allLab = document.createElement('label');
    allLab.textContent = 'Select All';
    const count = document.createElement('span');
    count.className = 'vg-dp-muted';
    count.textContent = `${this.selectedFieldPaths.size} selected`;
    selectRow.append(allCb, allLab, count);
    toolbar.append(search, selectRow);
    wrap.appendChild(toolbar);

    const list = document.createElement('div');
    list.className = 'vg-dp-editor__field-list';
    for (const f of visible) {
      const row = document.createElement('label');
      row.className = 'vg-dp-editor__field-row';
      const cb = createCheckbox({
        checked: this.selectedFieldPaths.has(f.path),
        disabled: f.inferredType === 'object',
        onChange: (checked) => {
          const next = new Set(this.selectedFieldPaths);
          if (checked) next.add(f.path);
          else next.delete(f.path);
          this.commitFieldSelection(next);
        },
      });
      const path = document.createElement('span');
      path.className = 'vg-dp-mono';
      path.textContent = f.path;
      const type = document.createElement('span');
      type.className = 'vg-dp-muted';
      type.textContent = f.inferredType;
      row.append(cb, path, type);
      list.appendChild(row);
    }
    wrap.appendChild(list);

    if (this.probe.inferenceError) {
      const err = document.createElement('p');
      err.className = 'vg-dp-editor__error';
      err.textContent = this.probe.inferenceError;
      wrap.appendChild(err);
    }
    return wrap;
  }

  private renderFieldsEmpty(): HTMLElement {
    const empty = createEmptyState({
      title: 'No fields inferred yet',
      description: 'Click Infer Fields to fetch a sample snapshot and analyze the row schema.',
      icon: '⬡',
    });
    const controls = document.createElement('div');
    controls.className = 'vg-dp-editor__inline-actions';
    controls.style.justifyContent = 'center';
    const sizeLab = document.createElement('span');
    sizeLab.className = 'vg-dp-muted';
    sizeLab.textContent = 'Sample size:';
    controls.append(sizeLab, this.sampleSizeSelect());
    empty.append(
      controls,
      createButton({
        label: this.probe.inferring ? 'Inferring…' : 'Infer Fields',
        onClick: () => { void this.probe.infer({ sampleSize: this.sampleSize }); },
        disabled: this.probe.inferring,
        testId: 'infer-fields',
      }),
    );
    if (this.probe.inferenceError) {
      const err = document.createElement('p');
      err.className = 'vg-dp-editor__error';
      err.textContent = this.probe.inferenceError;
      empty.appendChild(err);
    }
    return empty;
  }

  private sampleSizeSelect(): HTMLSelectElement {
    return createSelect({
      value: String(this.sampleSize),
      className: 'vg-dp-editor__sample-size',
      options: SAMPLE_SIZES.map((n) => ({ value: String(n), label: `${n} rows` })),
      onChange: (value) => {
        this.sampleSize = Number(value) as SampleSize;
      },
    });
  }

  private commitFieldSelection(next: Set<string>): void {
    this.selectedFieldPaths = next;
    this.pendingFieldsCols = buildColumnsFromFields(
      this.probe.inferredFields,
      [...next],
    );
    // Do NOT write columnDefinitions until Update Columns.
    this.render();
  }

  private renderColumns(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vg-dp-editor__columns-tab';
    const cols = this.cfg.config.columnDefinitions ?? [];

    if (!cols.length) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'application/json,.json';
      fileInput.hidden = true;
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) void this.importColumnDefs(file);
        fileInput.value = '';
      });
      const empty = createEmptyState({
        title: 'No columns selected',
        description: 'Use the Fields tab to infer and pick columns, or Import JSON.',
        action: {
          label: 'Import JSON',
          onClick: () => fileInput.click(),
        },
      });
      empty.appendChild(fileInput);
      wrap.appendChild(empty);
      return wrap;
    }

    // Key columns — Markets MultiSelect dropdown (chips + searchable list).
    const keyKeys = readKeyColumns(this.cfg.config.keyColumn);
    let keyTitleEl: HTMLElement | null = null;
    const composite = document.createElement('p');
    composite.className = 'vg-dp-editor__key-composite vg-dp-mono';
    const syncComposite = (keys: readonly string[]): void => {
      if (keys.length > 1) {
        composite.hidden = false;
        composite.textContent = `id = ${keys.map((v) => `[${v}]`).join(' + "-" + ')}`;
      } else {
        composite.hidden = true;
        composite.textContent = '';
      }
      if (keyTitleEl) {
        keyTitleEl.textContent = keys.length > 1 ? 'Key Columns *' : 'Key Column *';
      }
    };

    const keyCard = createCard(
      keyKeys.length > 1 ? 'Key Columns *' : 'Key Column *',
      (card) => {
        keyTitleEl = card.querySelector('.vg-dp-card__title');

        const keyHost = document.createElement('div');
        keyHost.className = 'vg-dp-editor__key-select';
        keyHost.setAttribute('data-testid', 'key-column-select');
        card.appendChild(keyHost);

        syncComposite(keyKeys);
        card.appendChild(composite);

        const keyHelp = document.createElement('p');
        keyHelp.className = 'vg-dp-field__help';
        keyHelp.append(
          'Drives AG-Grid ',
          Object.assign(document.createElement('code'), { textContent: 'getRowId' }),
          ' + the worker-side cache key. Pick a single column for a simple key, or two or more for a composite key (values joined with ',
          Object.assign(document.createElement('code'), { textContent: '-' }),
          ').',
        );
        card.appendChild(keyHelp);

        this.keyMultiSelect = mountMultiSelect({
          host: keyHost,
          options: cols.map((c) => ({
            value: c.field,
            label: c.field,
            hint: c.cellDataType ?? 'text',
          })),
          value: keyKeys,
          placeholder: 'Select column(s)…',
          emptyMessage: 'No columns — add fields on the Fields tab',
          onChange: (next) => {
            // Keep this MultiSelect mounted (no full Columns remount) so chip
            // remove / reopen stays responsive; the control closes itself on pick.
            this.patchConfig({ keyColumn: normalizeKeyColumns(next) });
            syncComposite(next);
          },
        });
      },
    );
    wrap.appendChild(keyCard);

    // Add custom column
    const fieldIn = createTextInput({ placeholder: 'field' });
    const headerIn = createTextInput({ placeholder: 'header' });
    const typeSel = createSelect({
      value: CELL_TYPES[0],
      options: [...CELL_TYPES],
      onChange: () => { /* value read on Add */ },
    });
    const addCard = createCard('Add Custom Column', (card) => {
      const addRow = document.createElement('div');
      addRow.className = 'vg-dp-editor__add-column-row';
      fieldIn.classList.add('vg-dp-editor__add-column-field');
      headerIn.classList.add('vg-dp-editor__add-column-header');
      typeSel.classList.add('vg-dp-editor__add-column-type');
      addRow.append(
        fieldIn,
        headerIn,
        typeSel,
        createButton({
          label: 'Add',
          onClick: () => {
            const field = fieldIn.value.trim();
            if (!field) return;
            if (cols.some((c) => c.field === field)) return;
            const next: ColumnDefinition[] = [
              ...cols,
              {
                field,
                headerName: headerIn.value.trim() || field,
                cellDataType: typeSel.value as ColumnDefinition['cellDataType'],
              },
            ];
            this.patchConfig({ columnDefinitions: next });
            this.selectedFieldPaths = new Set(next.map((c) => c.field));
            this.render();
          },
        }),
      );
      card.appendChild(addRow);
    });
    wrap.appendChild(addCard);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'vg-dp-editor__columns-toolbar';
    const count = document.createElement('span');
    count.textContent = `Columns (${cols.length})`;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.importColumnDefs(file);
      fileInput.value = '';
    });
    toolbar.append(
      count,
      createButton({ label: 'Export JSON', onClick: () => exportColumnDefs(cols) }),
      createButton({ label: 'Import JSON', onClick: () => fileInput.click() }),
      createButton({
        label: 'Clear all columns',
        variant: 'secondary',
        onClick: () => {
          if (!window.confirm('Clear all columns? You can re-select them from the Fields tab.')) return;
          this.patchConfig({ columnDefinitions: [], keyColumn: undefined });
          this.selectedFieldPaths = new Set();
          this.pendingFieldsCols = null;
          this.render();
        },
      }),
      fileInput,
    );
    wrap.appendChild(toolbar);

    // Viewport-fitting scroll region: sticky thead + x/y overflow.
    const scroll = document.createElement('div');
    scroll.className = 'vg-dp-editor__columns-scroll';
    scroll.setAttribute('data-testid', 'columns-scroll');

    const table = document.createElement('table');
    table.className = 'vg-dp-editor__columns-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['Field', 'Header', 'Type', '']) {
      const th = document.createElement('th');
      th.textContent = label;
      if (!label) th.className = 'vg-dp-editor__columns-actions-col';
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    cols.forEach((c, i) => {
      const tr = document.createElement('tr');
      const fieldTd = document.createElement('td');
      fieldTd.className = 'vg-dp-mono';
      fieldTd.textContent = c.field;

      const headerTd = document.createElement('td');
      headerTd.appendChild(createTextInput({
        value: c.headerName ?? c.field,
        onChange: (value) => {
          const next = [...cols];
          next[i] = { ...c, headerName: value };
          this.patchConfig({ columnDefinitions: next });
        },
      }));

      const typeTd = document.createElement('td');
      typeTd.appendChild(createSelect({
        value: c.cellDataType ?? 'text',
        options: [...CELL_TYPES],
        onChange: (value) => {
          const next = [...cols];
          next[i] = {
            ...c,
            cellDataType: value as ColumnDefinition['cellDataType'],
          };
          this.patchConfig({ columnDefinitions: next });
        },
      }));

      const actionsTd = document.createElement('td');
      actionsTd.className = 'vg-dp-editor__col-actions';
      actionsTd.append(
        createButton({
          label: '↑',
          title: 'Move up',
          disabled: i === 0,
          onClick: () => {
            if (i === 0) return;
            const next = [...cols];
            const a = next[i - 1]!;
            const b = next[i]!;
            next[i - 1] = b;
            next[i] = a;
            this.patchConfig({ columnDefinitions: next });
            this.render();
          },
        }),
        createButton({
          label: '↓',
          title: 'Move down',
          disabled: i === cols.length - 1,
          onClick: () => {
            if (i >= cols.length - 1) return;
            const next = [...cols];
            const a = next[i]!;
            const b = next[i + 1]!;
            next[i] = b;
            next[i + 1] = a;
            this.patchConfig({ columnDefinitions: next });
            this.render();
          },
        }),
        createButton({
          label: 'Remove',
          onClick: () => {
            const next = cols.filter((_, j) => j !== i);
            const keys = readKeyColumns(this.cfg.config.keyColumn).filter((k) =>
              next.some((col) => col.field === k));
            this.patchConfig({
              columnDefinitions: next,
              keyColumn: normalizeKeyColumns(keys),
            });
            this.selectedFieldPaths = new Set(next.map((col) => col.field));
            this.render();
          },
        }),
      );
      tr.append(fieldTd, headerTd, typeTd, actionsTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    const foot = document.createElement('div');
    foot.className = 'vg-dp-editor__rows-footer';
    foot.textContent = `Rows: ${cols.length}`;
    wrap.appendChild(foot);
    return wrap;
  }

  private async importColumnDefs(file: File): Promise<void> {
    try {
      const imported = parseColumnDefsImport(await file.text());
      const present = new Set(imported.map((c) => c.field));
      const prunedKey = readKeyColumns(this.cfg.config.keyColumn).filter((k) => present.has(k));
      this.patchConfig({
        columnDefinitions: imported,
        keyColumn: normalizeKeyColumns(prunedKey),
      });
      this.selectedFieldPaths = new Set(imported.map((c) => c.field));
      this.pendingFieldsCols = null;
      this.render();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  private renderBehaviour(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vg-dp-fields';

    if (this.cfg.providerType !== 'stomp') {
      const note = document.createElement('section');
      note.className = 'vg-dp-card';
      note.textContent = `No behaviour settings for ${this.cfg.providerType.toUpperCase()} providers.`;
      wrap.appendChild(note);
      return wrap;
    }

    const c = this.cfg.config;
    const throttleEnabled = c.throttleEnabled !== false;
    const conflateEnabled = c.conflateEnabled !== false;

    // Reconnect
    wrap.appendChild(createCard('Reconnect', (card) => {
      card.appendChild(createNumberField({
        label: 'Initial Delay (ms)',
        value: c.reconnect?.initialDelayMs ?? 5000,
        onChange: (v) => this.patchConfig({
          reconnect: { ...(c.reconnect ?? {}), initialDelayMs: v },
        }),
        help: 'Static delay between reconnect attempts. Full exponential backoff + jitter + max-attempts are reserved in the schema; not yet implemented.',
      }));
    }));

    // Realtime updates
    wrap.appendChild(createCard('Realtime updates', (card) => {
      card.appendChild(createSwitchField({
        label: 'Throttle updates',
        checked: throttleEnabled,
        onChange: (on) => {
          this.patchConfig({ throttleEnabled: on });
          this.render();
        },
      }));
      card.appendChild(createNumberField({
        label: 'Throttle (ms)',
        value: c.throttleMs ?? 0,
        onChange: (v) => this.patchConfig({ throttleMs: v > 0 ? v : undefined }),
        help: 'Coalesce live deltas into a trailing-edge burst every N ms. 0 = immediate (no batching). Conflation only applies when throttling is on.',
        disabled: !throttleEnabled,
      }));
      card.appendChild(createSwitchField({
        label: 'Thin field-level deltas',
        checked: c.thinDeltas === true,
        onChange: (on) => this.patchConfig({ thinDeltas: on ? true : undefined }),
        help: 'Ship only the fields that changed per row on live updates. Requires a key column; snapshots always ship full rows.',
      }));
      card.appendChild(createSwitchField({
        label: 'Conflate updates',
        checked: conflateEnabled,
        onChange: (on) => {
          this.patchConfig({ conflateEnabled: on });
          this.render();
        },
      }));

      card.appendChild(createField({
        label: 'Conflate by key',
        control: createSelect({
          value: c.conflateByKey ?? CONFLATE_NONE,
          disabled: !conflateEnabled,
          options: [
            { value: CONFLATE_NONE, label: '(use key column)' },
            ...this.conflateFieldOptions().map((f) => ({ value: f, label: f })),
          ],
          onChange: (value) => {
            this.patchConfig({
              conflateByKey: value === CONFLATE_NONE || !value ? undefined : value,
            });
          },
        }),
        help: 'Within each throttle window, collapse repeated updates for the same key to the latest. Defaults to the provider\'s key column when left unset.',
      }));
    }));

    // Snapshot
    wrap.appendChild(createCard('Snapshot', (card) => {
      card.appendChild(createNumberField({
        label: 'Chunk size (rows)',
        value: c.snapshotChunkSize ?? 500,
        onChange: (v) => this.patchConfig({ snapshotChunkSize: v > 0 ? v : undefined }),
        help: 'Rows per worker→client frame when flushing the snapshot. Default 500.',
      }));
      card.appendChild(createField({
        label: 'Wire format',
        control: createSelect({
          value: c.wireFormat ?? 'json',
          options: [
            { value: 'json', label: 'JSON (default)' },
            { value: 'columnar', label: 'Columnar (typed arrays)' },
          ],
          onChange: (value) => {
            this.patchConfig({
              wireFormat: value === 'columnar' ? 'columnar' : 'json',
            });
          },
        }),
        help: 'Codec for worker→window frames. Changing this requires a provider Restart.',
      }));
    }));

    // Row fields
    wrap.appendChild(createCard('Row fields', (card) => {
      card.appendChild(createSwitchField({
        label: 'Keep only column fields',
        checked: c.projectFields === true,
        onChange: (on) => this.patchConfig({ projectFields: on ? true : undefined }),
        help: 'Prune each incoming row to the column definition fields (plus the key column) before it enters the cache. Infer Fields always sees the full row.',
      }));
    }));

    return wrap;
  }

  private conflateFieldOptions(): string[] {
    const fromCols = (this.cfg.config.columnDefinitions ?? []).map((c) => c.field);
    if (fromCols.length > 0) return [...new Set(fromCols)];
    return [...new Set((this.cfg.config.inferredFields ?? []).map((f) => f.path))];
  }

  private renderDiagnostics(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vg-dp-editor__diagnostics';

    if (!this.isExisting()) {
      this.teardownDiagnostics();
      wrap.appendChild(createEmptyState({
        title: 'Save the provider first — diagnostics show live stats from the worker once the provider has a stable id.',
      }));
      return wrap;
    }

    const session = this.ensureDiagnosticsSession();
    if (this.diagBoundId !== this.cfg.providerId) {
      this.diagBoundId = this.cfg.providerId;
      void session.ensure(this.cfg).catch(() => undefined);
    }

    const statusBar = document.createElement('div');
    statusBar.className = 'vg-dp-editor__diag-bar';
    const badgeHost = document.createElement('span');
    badgeHost.setAttribute('data-diag', 'badge');
    const id = document.createElement('span');
    id.className = 'vg-dp-mono';
    id.textContent = this.cfg.providerId;
    const actions = document.createElement('div');
    actions.className = 'vg-dp-editor__inline-actions';
    actions.style.marginBottom = '0';
    const restartBtn = createButton({
      label: 'Restart',
      title: 'Re-attach + replay',
      onClick: () => { void session.restart(this.cfg); },
    });
    const stopBtn = createButton({
      label: 'Stop',
      title: 'Tear down upstream connection',
      variant: 'danger',
      onClick: () => { void session.stop(); },
    });
    actions.append(restartBtn, stopBtn);
    const left = document.createElement('div');
    left.className = 'vg-dp-editor__diag-bar-left';
    left.append(badgeHost, id);
    statusBar.append(left, actions);
    wrap.appendChild(statusBar);

    const errEl = document.createElement('div');
    errEl.className = 'vg-dp-editor__diag-error';
    errEl.hidden = true;
    errEl.setAttribute('data-diag', 'error');
    wrap.appendChild(errEl);

    const cards = document.createElement('div');
    cards.className = 'vg-dp-editor__diag-cards';
    cards.append(
      this.diagCard('Snapshot', [
        ['Fetch time', 'snapshotFetchMs'],
        ['Rows loaded', 'rowCount'],
        ['Cache size (serialized)', 'cacheBytes'],
      ]),
      this.diagCard('Connection latency', [
        ['Restart → request sent', 'restartRequestMs'],
        ['Request → first message', 'firstMessageMs'],
      ]),
      this.diagCard('Throughput', [
        ['Messages (upstream)', 'msgCount'],
        ['Upstream rate', 'msgPerSec'],
        ['Bytes received', 'byteCount'],
      ]),
      this.diagCard('Client publishing', [
        ['Published', 'publishCount'],
        ['Publish rate', 'publishPerSec'],
        ['Publish rate (1m avg)', 'publishPerMin'],
        ['Subscribers', 'subscriberCount'],
      ]),
      this.diagCard('Lifecycle', [
        ['Started', 'startedAt'],
        ['Last message', 'lastMessageAt'],
        ['Errors', 'errorCount'],
      ]),
    );
    wrap.appendChild(cards);

    const lastErrCard = createCard('Last Error', (host) => {
      const p = document.createElement('p');
      p.className = 'vg-dp-mono';
      p.setAttribute('data-diag', 'lastError');
      p.textContent = '—';
      host.appendChild(p);
    });
    lastErrCard.classList.add('vg-dp-editor__diag-card');
    lastErrCard.hidden = true;
    lastErrCard.setAttribute('data-diag', 'lastErrorCard');
    wrap.appendChild(lastErrCard);

    this.unsubDiag?.();
    this.unsubDiag = session.subscribe((state) => {
      this.paintDiagnostics(wrap, state, restartBtn, stopBtn);
    });

    return wrap;
  }

  private paintDiagnostics(
    root: HTMLElement,
    state: DiagnosticsState,
    restartBtn: HTMLButtonElement,
    stopBtn: HTMLButtonElement,
  ): void {
    const { stats, status, error, busy } = state;
    this.statusText = status;
    const badgeHost = root.querySelector<HTMLElement>('[data-diag="badge"]');
    if (badgeHost) {
      badgeHost.replaceChildren(createBadge(status.toUpperCase()));
    }
    const errEl = root.querySelector<HTMLElement>('[data-diag="error"]');
    if (errEl) {
      if (error) {
        errEl.hidden = false;
        errEl.textContent = error;
      } else {
        errEl.hidden = true;
        errEl.textContent = '';
      }
    }
    restartBtn.disabled = busy;
    stopBtn.disabled = busy;
    stopBtn.textContent = busy && status !== 'idle' ? 'Stopping…' : 'Stop';

    const set = (key: string, text: string): void => {
      const el = root.querySelector<HTMLElement>(`[data-diag-stat="${key}"]`);
      if (el) el.textContent = text;
    };
    set('snapshotFetchMs', fmtSnapshotFetch(stats.snapshotFetchMs, status));
    set('rowCount', fmtInt(stats.rowCount));
    set('cacheBytes', fmtBytes(stats.cacheBytes));
    set('restartRequestMs', fmtLatency(stats.restartRequestMs));
    set('firstMessageMs', fmtLatency(stats.firstMessageMs));
    set('msgCount', fmtInt(stats.msgCount));
    set('msgPerSec', `${stats.msgPerSec.toFixed(1)} msg/s`);
    set('byteCount', fmtBytes(stats.byteCount));
    set('publishCount', fmtInt(stats.publishCount));
    set('publishPerSec', `${stats.publishPerSec.toFixed(1)} msg/s`);
    set('publishPerMin', `${stats.publishPerMin.toFixed(1)} msg/min`);
    set('subscriberCount', fmtInt(stats.subscriberCount));
    set('startedAt', fmtTime(stats.startedAt));
    set('lastMessageAt', stats.lastMessageAt ? fmtTime(stats.lastMessageAt) : '—');
    set('errorCount', fmtInt(stats.errorCount));

    const lastCard = root.querySelector<HTMLElement>('[data-diag="lastErrorCard"]');
    const lastEl = root.querySelector<HTMLElement>('[data-diag="lastError"]');
    if (lastCard && lastEl) {
      if (stats.lastError) {
        lastCard.hidden = false;
        lastEl.textContent = stats.lastError;
      } else {
        lastCard.hidden = true;
        lastEl.textContent = '—';
      }
    }
  }

  private diagCard(title: string, rows: Array<[string, string]>): HTMLElement {
    const card = createCard(title, (host) => {
      const grid = document.createElement('div');
      grid.className = 'vg-dp-editor__stat-grid';
      for (const [label, key] of rows) {
        const cell = document.createElement('div');
        cell.className = 'vg-dp-editor__stat';
        const lab = document.createElement('div');
        lab.className = 'vg-dp-editor__stat-label';
        lab.textContent = label;
        const val = document.createElement('div');
        val.className = 'vg-dp-editor__stat-value vg-dp-mono';
        val.setAttribute('data-diag-stat', key);
        val.textContent = '—';
        cell.append(lab, val);
        grid.appendChild(cell);
      }
      host.appendChild(grid);
    });
    card.classList.add('vg-dp-editor__diag-card');
    return card;
  }
}

function fmtInt(n: number | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function fmtBytes(n: number | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtLatency(ms: number | null | undefined): string {
  return fmtDuration(ms);
}

function fmtSnapshotFetch(ms: number | null | undefined, status: string): string {
  if (ms != null) return fmtDuration(ms);
  if (status === 'snapshot' || status === 'connecting') return 'In progress…';
  return '—';
}

function fmtTime(ts: number | null | undefined): string {
  if (ts == null) return '—';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '—';
  }
}

export function mountProviderEditor(opts: ProviderEditorOptions): ProviderEditor {
  return new ProviderEditor(opts);
}
