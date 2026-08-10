/**
 * DataProviderEditor — Markets-shaped outer shell: list (left) + form (right).
 *
 * Routes are not used; the popout mounts this directly with an optional
 * `initialProviderId`. The list refreshes after save/delete/import.
 */
import type { DataProviderConfig, TransportType } from '../types';
import type { ConfigBackend } from '../catalog/ConfigBackend';
import { createDefaultConfigBackend } from '../catalog/ConfigBackend';
import type { ProviderClientOptions } from '../client/ProviderClientAdapter';
import {
  getTransportPlugin,
  listTransportPlugins,
} from '../registry/plugins';
import { registerDefaultTransports } from '../transports/registerDefaults';
import { mountProviderEditor, type ProviderEditor } from './ProviderEditor';
import { cloneProviderConfig } from './cloneProviderConfig';
import { parseProviderConfigImport } from './providerConfigIo';
import {
  buildProviderSidebarConfigs,
  isDraftListId,
  providerMatchesSearch,
  toDraftListId,
} from './providerSidebarList';
import { ensureEditorStyles } from './styles';
import {
  createButton,
  createField,
  createModal,
  createSearchInput,
  createSelect,
} from './ui';

export type DataProviderEditorOptions = {
  mount: HTMLElement;
  backend?: ConfigBackend;
  /** Focus this provider when the list resolves (popout `?id=`). */
  initialProviderId?: string | null;
  onClose?: () => void;
  onSaved?: (cfg: DataProviderConfig) => void;
  /** Hub options for Diagnostics (shared with the grid when possible). */
  hubOpts?: ProviderClientOptions;
};

const NEW_PROVIDER_TYPES: Array<{
  id: TransportType;
  label: string;
  description: string;
}> = [
  {
    id: 'stomp',
    label: 'STOMP',
    description: 'WebSocket streaming with snapshot + delta semantics.',
  },
  {
    id: 'rest',
    label: 'REST',
    description: 'One-shot HTTP fetch — no live updates.',
  },
  {
    id: 'mock',
    label: 'Mock',
    description: 'In-memory dummy stream — for dev/tests.',
  },
];

/**
 * Full catalog editor (shared across grids). Customize tabs only select
 * an active providerId; authoring happens here / in the popout.
 */
export class DataProviderEditor {
  private readonly root: HTMLElement;
  private readonly backend: ConfigBackend;
  private readonly onClose?: () => void;
  private readonly onSaved?: (cfg: DataProviderConfig) => void;
  private readonly hubOpts?: ProviderClientOptions;
  private readonly initialProviderId: string | null;
  private list: DataProviderConfig[] = [];
  private search = '';
  private selectedId: string | null = null;
  private creating: DataProviderConfig | null = null;
  private draftSeq = 0;
  private form: ProviderEditor | null = null;
  private formHost: HTMLElement | null = null;
  private loading = true;
  private error: string | null = null;
  private modalHost: HTMLElement | null = null;
  private confirmDelete: DataProviderConfig | null = null;
  private deleting = false;
  private deleteError: string | null = null;

  constructor(opts: DataProviderEditorOptions) {
    ensureEditorStyles();
    registerDefaultTransports();
    this.backend = opts.backend ?? createDefaultConfigBackend();
    this.onClose = opts.onClose;
    this.onSaved = opts.onSaved;
    this.hubOpts = opts.hubOpts;
    this.initialProviderId = opts.initialProviderId ?? null;
    this.selectedId = this.initialProviderId;
    this.root = document.createElement('div');
    this.root.className = 'vg-dp-shell';
    opts.mount.appendChild(this.root);
    void this.refreshList().then(() => this.render());
  }

  destroy(): void {
    this.closeModal();
    this.form?.destroy();
    this.form = null;
    this.root.remove();
  }

  async refreshList(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.list = await this.backend.list();
      if (
        this.initialProviderId
        && !this.selectedId
        && this.list.some((c) => c.providerId === this.initialProviderId)
      ) {
        this.selectedId = this.initialProviderId;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private filtered(): DataProviderConfig[] {
    return this.list.filter((c) => providerMatchesSearch(c, this.search));
  }

  private selected(): DataProviderConfig | null {
    if (this.creating) return this.creating;
    if (!this.selectedId) return null;
    return this.list.find((c) => c.providerId === this.selectedId) ?? null;
  }

  private activeListId(): string | null {
    return this.creating ? toDraftListId(this.draftSeq) : this.selectedId;
  }

  private startCreate(type: TransportType): void {
    const plugin = getTransportPlugin(type);
    this.creating = {
      providerId: '',
      name: 'untitled',
      description: '',
      providerType: type,
      rowModel: 'clientSide',
      blockSize: 100,
      public: false,
      config: {
        throttleEnabled: true,
        throttleMs: 100,
        conflateEnabled: true,
        wireFormat: 'json',
        snapshotChunkSize: 500,
        keyColumn: plugin?.defaultKeyFields ?? 'positionId',
        ...(plugin?.defaultConfig() ?? {}),
      } as DataProviderConfig['config'],
    };
    this.selectedId = null;
    this.draftSeq += 1;
    this.render();
  }

  private startClone(source: DataProviderConfig): void {
    this.creating = cloneProviderConfig(source);
    this.selectedId = null;
    this.draftSeq += 1;
    this.render();
  }

  private async onImportFile(file: File): Promise<void> {
    try {
      const portable = parseProviderConfigImport(await file.text());
      const draft: DataProviderConfig = {
        ...portable,
        providerId: `provider-${Date.now().toString(36)}`,
        isDefault: false,
        rowModel: portable.rowModel ?? 'clientSide',
      };
      const saved = await this.backend.save(draft);
      this.creating = null;
      this.selectedId = saved.providerId;
      await this.refreshList();
      this.render();
    } catch (err) {
      window.alert(`Could not import provider: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private requestDelete(cfg: DataProviderConfig): void {
    this.deleteError = null;
    this.confirmDelete = cfg;
    this.openDeleteDialog();
  }

  private async onDelete(cfg: DataProviderConfig): Promise<void> {
    if (!cfg.providerId || isDraftListId(cfg.providerId) || this.deleting) return;
    this.deleting = true;
    this.deleteError = null;
    this.openDeleteDialog();
    try {
      await this.backend.remove(cfg.providerId);
      this.confirmDelete = null;
      if (this.selectedId === cfg.providerId) this.selectedId = null;
      await this.refreshList();
      this.closeModal();
      this.render();
    } catch (err) {
      this.deleteError = err instanceof Error ? err.message : String(err);
      this.openDeleteDialog();
    } finally {
      this.deleting = false;
    }
  }

  private render(): void {
    this.form?.destroy();
    this.form = null;
    this.formHost = null;
    // Keep modal if open; rebuild shell under it.
    const keepModal = this.modalHost;
    this.root.innerHTML = '';
    this.root.appendChild(this.renderSidebar());
    const main = document.createElement('main');
    main.className = 'vg-dp-shell__main';
    const sel = this.selected();
    if (sel) {
      this.formHost = document.createElement('div');
      this.formHost.className = 'vg-dp-shell__form';
      main.appendChild(this.formHost);
      // Drafts keep empty providerId until Create DataProvider mints one.
      const initial = structuredClone(sel);
      if (this.creating) initial.providerId = '';
      this.form = mountProviderEditor({
        mount: this.formHost,
        backend: this.backend,
        initial,
        compactActions: true,
        hubOpts: this.hubOpts,
        onCancel: () => {
          this.creating = null;
          this.selectedId = null;
          this.onClose?.();
          this.render();
        },
        onClone: !this.creating && isStableId(sel.providerId)
          ? () => this.startClone(sel)
          : undefined,
        onSave: async (saved) => {
          this.creating = null;
          this.selectedId = saved.providerId;
          this.onSaved?.(saved);
          await this.refreshList();
          this.render();
        },
      });
    } else {
      main.appendChild(this.renderEmpty());
    }
    this.root.appendChild(main);
    if (keepModal && keepModal.isConnected === false && this.confirmDelete) {
      this.openDeleteDialog();
    }
  }

  private renderSidebar(): HTMLElement {
    const aside = document.createElement('aside');
    aside.className = 'vg-dp-shell__sidebar';

    const head = document.createElement('div');
    head.className = 'vg-dp-shell__sidebar-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'vg-dp-shell__sidebar-title-row';
    const h2 = document.createElement('h2');
    h2.textContent = 'Providers';
    const actions = document.createElement('div');
    actions.className = 'vg-dp-shell__sidebar-actions';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.onImportFile(file);
      fileInput.value = '';
    });
    const importBtn = createButton({
      label: 'Import',
      variant: 'ghost',
      title: 'Import a provider from JSON',
      onClick: () => fileInput.click(),
    });
    const newBtn = createButton({
      label: '+',
      className: 'vg-dp-addbtn',
      title: 'New provider',
      onClick: () => this.openNewPicker(),
    });

    actions.append(importBtn, newBtn, fileInput);
    titleRow.append(h2, actions);

    const search = createSearchInput({
      value: this.search,
      placeholder: 'Search…',
      onInput: (value) => {
        this.search = value;
        this.renderListOnly(aside);
      },
    });

    head.append(titleRow, search);
    aside.appendChild(head);

    const listHost = document.createElement('div');
    listHost.className = 'vg-dp-shell__list';
    aside.appendChild(listHost);
    this.fillList(listHost);
    return aside;
  }

  private renderListOnly(aside: HTMLElement): void {
    const listHost = aside.querySelector('.vg-dp-shell__list');
    if (!(listHost instanceof HTMLElement)) return;
    listHost.replaceChildren();
    this.fillList(listHost);
  }

  private fillList(listHost: HTMLElement): void {
    if (this.loading) {
      listHost.textContent = 'Loading…';
      return;
    }
    if (this.error) {
      listHost.textContent = this.error;
      return;
    }
    const sidebarConfigs = buildProviderSidebarConfigs(
      this.filtered(),
      this.creating,
      this.draftSeq,
      this.search,
    );
    const ul = document.createElement('ul');
    ul.className = 'vg-dp-shell__ul';
    if (!sidebarConfigs.length) {
      const empty = document.createElement('li');
      empty.className = 'vg-dp-shell__empty';
      empty.textContent = 'No providers yet.';
      ul.appendChild(empty);
    }
    const active = this.activeListId();
    for (const c of sidebarConfigs) {
      ul.appendChild(this.sidebarRow(c, c.providerId === active));
    }
    listHost.appendChild(ul);
  }

  private sidebarRow(cfg: DataProviderConfig, selected: boolean): HTMLElement {
    const isDraft = isDraftListId(cfg.providerId);
    const li = document.createElement('li');
    li.className = `vg-dp-shell__row${selected ? ' is-selected' : ''}`;
    li.tabIndex = 0;
    li.setAttribute('data-selected', selected ? 'true' : 'false');
    li.addEventListener('click', () => {
      if (isDraft) return;
      this.creating = null;
      this.selectedId = cfg.providerId;
      this.render();
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !isDraft) {
        this.creating = null;
        this.selectedId = cfg.providerId;
        this.render();
      }
    });

    const meta = document.createElement('div');
    meta.className = 'vg-dp-shell__row-meta';
    const name = document.createElement('div');
    name.className = 'vg-dp-shell__row-name';
    name.textContent = cfg.name;
    const sub = document.createElement('div');
    sub.className = 'vg-dp-shell__row-sub';
    const plugin = getTransportPlugin(cfg.providerType);
    const typeSpan = document.createElement('span');
    typeSpan.textContent = plugin?.label ?? cfg.providerType;
    sub.appendChild(typeSpan);
    if (isDraft) {
      const badge = document.createElement('span');
      badge.className = 'vg-dp-shell__badge';
      badge.textContent = 'Unsaved';
      sub.appendChild(badge);
    }
    if (cfg.public) {
      const badge = document.createElement('span');
      badge.className = 'vg-dp-shell__badge';
      badge.textContent = 'Public';
      sub.appendChild(badge);
    }
    meta.append(name, sub);

    const tools = document.createElement('div');
    tools.className = 'vg-dp-shell__row-tools';
    if (!isDraft) {
      const clone = createButton({
        label: '⧉',
        title: 'Duplicate',
        variant: 'ghost',
        onClick: () => this.startClone(cfg),
      });
      clone.addEventListener('click', (e) => e.stopPropagation());
      const del = createButton({
        label: '✕',
        title: 'Delete',
        variant: 'ghost',
        onClick: () => this.requestDelete(cfg),
      });
      del.addEventListener('click', (e) => e.stopPropagation());
      tools.append(clone, del);
    }

    li.append(meta, tools);
    return li;
  }

  private openNewPicker(): void {
    this.closeModal();
    let picked: TransportType = 'stomp';
    const typeDesc = document.createElement('p');
    typeDesc.className = 'vg-dp-field__help';
    typeDesc.textContent = NEW_PROVIDER_TYPES.find((t) => t.id === picked)?.description ?? '';

    const options: Array<{ value: string; label: string }> = [
      ...NEW_PROVIDER_TYPES.map((t) => ({ value: t.id, label: t.label })),
    ];
    // Also expose any registered plugins beyond the three presets.
    for (const p of listTransportPlugins()) {
      if (NEW_PROVIDER_TYPES.some((t) => t.id === p.id)) continue;
      options.push({ value: p.id, label: p.label });
    }

    const sel = createSelect({
      value: picked,
      options,
      onChange: (value) => {
        picked = value as TransportType;
        typeDesc.textContent =
          NEW_PROVIDER_TYPES.find((t) => t.id === picked)?.description ?? '';
      },
    });
    const field = createField({ label: 'Type', control: sel });
    field.appendChild(typeDesc);

    const overlay = createModal({
      title: 'New Provider',
      description: 'Pick a transport. You can change details after.',
      body: field,
      testId: 'provider-new-dialog',
      onBackdropClose: () => this.closeModal(),
      actions: [
        { label: 'Cancel', onClick: () => this.closeModal(), variant: 'secondary' },
        {
          label: 'Create',
          variant: 'primary',
          onClick: () => {
            this.closeModal();
            this.startCreate(picked);
          },
        },
      ],
    });
    this.modalHost = overlay;
    this.root.appendChild(overlay);
  }

  private openDeleteDialog(): void {
    this.closeModal();
    const cfg = this.confirmDelete;
    if (!cfg) return;

    let body: HTMLElement | undefined;
    if (this.deleteError) {
      body = document.createElement('p');
      body.className = 'vg-dp-editor__error';
      body.setAttribute('data-testid', 'provider-delete-error');
      body.textContent = this.deleteError;
    }

    const overlay = createModal({
      title: 'Delete provider?',
      description:
        `${cfg.name} will be removed. Subscribers in other windows will fail `
        + 'to re-attach until a replacement is configured. This cannot be undone.',
      body,
      testId: 'provider-delete-confirm',
      actions: [
        {
          label: 'Cancel',
          variant: 'secondary',
          disabled: this.deleting,
          onClick: () => {
            if (this.deleting) return;
            this.confirmDelete = null;
            this.deleteError = null;
            this.closeModal();
          },
        },
        {
          label: this.deleting ? 'Deleting…' : 'Delete',
          variant: 'danger',
          disabled: this.deleting || !cfg.providerId,
          testId: 'provider-delete-confirm-btn',
          onClick: () => { void this.onDelete(cfg); },
        },
      ],
    });
    // Keep legacy class for existing destructive footer styles.
    overlay.querySelector('[data-testid="provider-delete-confirm-btn"]')
      ?.classList.add('destructive');
    this.modalHost = overlay;
    this.root.appendChild(overlay);
  }

  private closeModal(): void {
    this.modalHost?.remove();
    this.modalHost = null;
  }

  private renderEmpty(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'vg-dp-shell__empty-main';
    empty.innerHTML = `
      <h2>No provider selected</h2>
      <p>Pick a provider on the left, or create a new one to get started.</p>
    `;
    empty.appendChild(createButton({
      label: '+ New STOMP Provider',
      variant: 'primary',
      onClick: () => this.startCreate('stomp'),
    }));
    return empty;
  }
}

function isStableId(id: string | undefined): boolean {
  return Boolean(id) && !isDraftListId(id);
}

export function mountDataProviderEditor(opts: DataProviderEditorOptions): DataProviderEditor {
  return new DataProviderEditor(opts);
}
