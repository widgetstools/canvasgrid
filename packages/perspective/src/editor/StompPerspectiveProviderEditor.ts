/**
 * StompPerspectiveProviderEditor — Markets DataProvider-editor parity
 * (Connection / Fields / Columns / Behaviour / Diagnostics) for the
 * Perspective SSRM provider.
 */
import type { BookTelemetry, PspFilter } from '../book';
import { POSITION_SCHEMA } from '../bootstrap';
import { POSITION_COLUMNS } from '../positionColumns';
import type { StompPerspectiveProviderConfig } from '../provider';
import { ensurePspEditorStyles } from './styles';

const TABS = ['Connection', 'Fields', 'Columns', 'Behaviour', 'Diagnostics'] as const;
type Tab = (typeof TABS)[number];

export type StompPerspectiveProviderEditorOptions = {
  mount: HTMLElement;
  initial?: Partial<StompPerspectiveProviderConfig>;
  /** Fired when Apply is clicked (validated config). */
  onApply?: (cfg: StompPerspectiveProviderConfig) => void | Promise<void>;
  /** Fired on any field edit (may be incomplete / unvalidated). */
  onChange?: (cfg: StompPerspectiveProviderConfig) => void;
  onCancel?: () => void;
};

export type StompPerspectiveProviderEditor = {
  getConfig(): StompPerspectiveProviderConfig;
  setConfig(partial: Partial<StompPerspectiveProviderConfig>): void;
  /** Push live telemetry into the Diagnostics tab. */
  setTelemetry(t: BookTelemetry | null): void;
  destroy(): void;
};

type Draft = {
  name: string;
  description: string;
  feed: 'seed' | 'stomp';
  wsUrl: string;
  clientId: string;
  snapshotTopic: string;
  triggerTopic: string;
  snapshotEndToken: string;
  keyColumn: string;
  snapshotRows: number;
  rate: number;
  batchSize: number;
  updatesPerTick: number;
  label: string;
  filterJson: string;
};

const DEFAULT_DRAFT: Draft = {
  name: 'Perspective SSRM Positions',
  description: 'StompPerspectiveProvider · SSRM blotter',
  feed: 'stomp',
  wsUrl: 'ws://localhost:8082',
  clientId: 'TRADER001',
  snapshotTopic: '',
  triggerTopic: '',
  snapshotEndToken: 'Success',
  keyColumn: 'positionId',
  snapshotRows: 5_000,
  rate: 40,
  batchSize: 200,
  updatesPerTick: 5,
  label: 'Perspective SSRM',
  filterJson: '',
};

function draftFromInitial(partial?: Partial<StompPerspectiveProviderConfig>): Draft {
  return {
    ...DEFAULT_DRAFT,
    feed: partial?.feed === 'seed' ? 'seed' : 'stomp',
    wsUrl: partial?.wsUrl ?? DEFAULT_DRAFT.wsUrl,
    clientId: partial?.clientId ?? DEFAULT_DRAFT.clientId,
    snapshotTopic: partial?.snapshotTopic ?? '',
    triggerTopic: partial?.triggerTopic ?? '',
    snapshotEndToken: partial?.snapshotEndToken ?? DEFAULT_DRAFT.snapshotEndToken,
    keyColumn: partial?.keyColumn ?? DEFAULT_DRAFT.keyColumn,
    snapshotRows: partial?.snapshotRows ?? DEFAULT_DRAFT.snapshotRows,
    rate: partial?.rate ?? DEFAULT_DRAFT.rate,
    batchSize: partial?.batchSize ?? DEFAULT_DRAFT.batchSize,
    updatesPerTick: partial?.updatesPerTick ?? DEFAULT_DRAFT.updatesPerTick,
    label: partial?.label ?? DEFAULT_DRAFT.label,
    filterJson: partial?.filter ? JSON.stringify(partial.filter, null, 2) : '',
  };
}

function parseFilter(raw: string): { ok: true; filter?: PspFilter[] } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, filter: undefined };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.some((f) => !Array.isArray(f) || f.length !== 3)) {
      return { ok: false, error: 'expected an array of [column, op, value] triples' };
    }
    return { ok: true, filter: parsed as PspFilter[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function toProviderConfig(d: Draft): { ok: true; cfg: StompPerspectiveProviderConfig } | { ok: false; error: string } {
  const filterRes = parseFilter(d.filterJson);
  if (!filterRes.ok) return filterRes;
  const cfg: StompPerspectiveProviderConfig = {
    feed: d.feed,
    snapshotRows: d.snapshotRows,
    rate: d.rate,
    batchSize: d.batchSize,
    updatesPerTick: d.updatesPerTick,
    label: d.label || DEFAULT_DRAFT.label,
    ...(filterRes.filter ? { filter: filterRes.filter } : {}),
  };
  if (d.feed === 'stomp') {
    if (!d.wsUrl.trim()) return { ok: false, error: 'WebSocket URL is required for STOMP feed' };
    cfg.wsUrl = d.wsUrl.trim();
    cfg.clientId = d.clientId.trim() || 'TRADER001';
    if (d.snapshotTopic.trim()) cfg.snapshotTopic = d.snapshotTopic.trim();
    if (d.triggerTopic.trim()) cfg.triggerTopic = d.triggerTopic.trim();
    if (d.snapshotEndToken.trim()) cfg.snapshotEndToken = d.snapshotEndToken.trim();
    if (d.keyColumn.trim()) cfg.keyColumn = d.keyColumn.trim();
  }
  return { ok: true, cfg };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (v === true) node.setAttribute(k, '');
    else if (k === 'className') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

function field(
  label: string,
  control: HTMLElement,
  opts?: { required?: boolean; help?: string },
): HTMLElement {
  const wrap = el('div', { className: 'vg-psp-field' });
  const lab = el('label', { className: 'vg-psp-field__label' }, label);
  if (opts?.required) lab.append(el('span', { className: 'req' }, '*'));
  wrap.append(lab, control);
  if (opts?.help) wrap.append(el('div', { className: 'vg-psp-field__help' }, opts.help));
  return wrap;
}

export function mountStompPerspectiveProviderEditor(
  opts: StompPerspectiveProviderEditorOptions,
): StompPerspectiveProviderEditor {
  ensurePspEditorStyles();
  const draft = draftFromInitial(opts.initial);
  let tab: Tab = 'Connection';
  let telemetry: BookTelemetry | null = null;

  const root = el('div', { className: 'vg-psp-editor', 'data-testid': 'psp-provider-editor' });
  const head = el('div', { className: 'vg-psp-editor__head' });
  head.append(el('h2', { className: 'vg-psp-editor__title' }, 'Stomp Perspective provider'));
  const tabsEl = el('div', { className: 'vg-psp-editor__tabs', role: 'tablist' });
  const body = el('div', { className: 'vg-psp-editor__body' });
  const foot = el('div', { className: 'vg-psp-editor__foot' });
  const errEl = el('div', { className: 'vg-psp-muted' });
  errEl.style.flex = '1';
  errEl.style.color = '#ef9a9a';

  const cancelBtn = el('button', { type: 'button', className: 'vg-psp-btn' }, 'Cancel');
  const applyBtn = el('button', { type: 'button', className: 'vg-psp-btn vg-psp-btn--primary' }, 'Apply');
  foot.append(errEl, cancelBtn, applyBtn);
  root.append(head, tabsEl, body, foot);
  opts.mount.replaceChildren(root);

  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

  function bind<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    key: keyof Draft,
    control: T,
  ): T {
    inputs.set(key, control);
    control.addEventListener('input', () => {
      syncDraftFromDom();
      bumpStompDisabled();
      const res = toProviderConfig(draft);
      opts.onChange?.(res.ok ? res.cfg : draftAsLoose());
      if (tab === 'Diagnostics') renderBody();
    });
    control.addEventListener('change', () => {
      syncDraftFromDom();
      bumpStompDisabled();
      const res = toProviderConfig(draft);
      opts.onChange?.(res.ok ? res.cfg : draftAsLoose());
    });
    return control;
  }

  function draftAsLoose(): StompPerspectiveProviderConfig {
    return {
      feed: draft.feed,
      wsUrl: draft.wsUrl,
      clientId: draft.clientId,
      snapshotRows: draft.snapshotRows,
      rate: draft.rate,
      batchSize: draft.batchSize,
      updatesPerTick: draft.updatesPerTick,
      label: draft.label,
    };
  }

  function syncDraftFromDom(): void {
    const g = (k: keyof Draft) => inputs.get(k);
    const feed = (g('feed') as HTMLSelectElement | undefined)?.value;
    draft.feed = feed === 'seed' ? 'seed' : 'stomp';
    draft.wsUrl = (g('wsUrl') as HTMLInputElement | undefined)?.value ?? draft.wsUrl;
    draft.clientId = (g('clientId') as HTMLInputElement | undefined)?.value ?? draft.clientId;
    draft.snapshotTopic = (g('snapshotTopic') as HTMLInputElement | undefined)?.value ?? draft.snapshotTopic;
    draft.triggerTopic = (g('triggerTopic') as HTMLInputElement | undefined)?.value ?? draft.triggerTopic;
    draft.snapshotEndToken =
      (g('snapshotEndToken') as HTMLInputElement | undefined)?.value ?? draft.snapshotEndToken;
    draft.keyColumn = (g('keyColumn') as HTMLSelectElement | undefined)?.value ?? draft.keyColumn;
    draft.snapshotRows = Number((g('snapshotRows') as HTMLInputElement | undefined)?.value) || draft.snapshotRows;
    draft.rate = Number((g('rate') as HTMLInputElement | undefined)?.value) || draft.rate;
    draft.batchSize = Number((g('batchSize') as HTMLInputElement | undefined)?.value) || draft.batchSize;
    draft.updatesPerTick =
      Number((g('updatesPerTick') as HTMLInputElement | undefined)?.value) || draft.updatesPerTick;
    draft.label = (g('label') as HTMLInputElement | undefined)?.value ?? draft.label;
    draft.filterJson = (g('filterJson') as HTMLTextAreaElement | undefined)?.value ?? draft.filterJson;
    draft.name = (g('name') as HTMLInputElement | undefined)?.value ?? draft.name;
    draft.description = (g('description') as HTMLInputElement | undefined)?.value ?? draft.description;
  }

  function bumpStompDisabled(): void {
    const stomp = draft.feed === 'stomp';
    for (const key of ['wsUrl', 'clientId', 'snapshotTopic', 'triggerTopic', 'snapshotEndToken'] as const) {
      const c = inputs.get(key);
      if (c) c.disabled = !stomp;
    }
  }

  function card(title: string, ...kids: HTMLElement[]): HTMLElement {
    const c = el('div', { className: 'vg-psp-card' });
    c.append(el('h3', { className: 'vg-psp-card__title' }, title), ...kids);
    return c;
  }

  function renderTabs(): void {
    tabsEl.replaceChildren();
    for (const t of TABS) {
      const b = el('button', {
        type: 'button',
        className: 'vg-psp-editor__tab',
        role: 'tab',
        'aria-selected': t === tab ? 'true' : 'false',
      }, t);
      b.addEventListener('click', () => {
        syncDraftFromDom();
        tab = t;
        renderTabs();
        renderBody();
      });
      tabsEl.append(b);
    }
  }

  function renderConnection(): void {
    inputs.clear();
    const name = bind('name', el('input', { type: 'text', value: draft.name }) as HTMLInputElement);
    const desc = bind(
      'description',
      el('input', { type: 'text', value: draft.description }) as HTMLInputElement,
    );
    const feed = bind('feed', el('select') as HTMLSelectElement);
    feed.append(
      el('option', { value: 'stomp', ...(draft.feed === 'stomp' ? { selected: true } : {}) }, 'STOMP (live)'),
      el('option', { value: 'seed', ...(draft.feed === 'seed' ? { selected: true } : {}) }, 'Seed (local)'),
    );

    const wsUrl = bind('wsUrl', el('input', {
      type: 'text',
      value: draft.wsUrl,
      placeholder: 'ws://localhost:8082',
    }) as HTMLInputElement);
    const clientId = bind('clientId', el('input', {
      type: 'text',
      value: draft.clientId,
      placeholder: 'TRADER001',
    }) as HTMLInputElement);
    const snapshotTopic = bind('snapshotTopic', el('input', {
      type: 'text',
      value: draft.snapshotTopic,
      placeholder: '/snapshot/positions/{clientId}',
    }) as HTMLInputElement);
    const triggerTopic = bind('triggerTopic', el('input', {
      type: 'text',
      value: draft.triggerTopic,
      placeholder: '{snapshotTopic}/{rate}/{batchSize}',
    }) as HTMLInputElement);
    const endToken = bind('snapshotEndToken', el('input', {
      type: 'text',
      value: draft.snapshotEndToken,
      placeholder: 'Success',
    }) as HTMLInputElement);

    body.append(
      card(
        'Identity',
        field('Name', name, { required: true }),
        field('Description', desc),
      ),
      card(
        'Feed',
        field('Feed mode', feed, { help: 'STOMP talks to stomp-view-server; Seed needs no broker.' }),
      ),
      card(
        'Connection',
        field('WebSocket URL', wsUrl, {
          required: true,
          help: 'Maps from hub editor websocketUrl. Supports {{appData.key}} when AppData is wired.',
        }),
        field('Client ID', clientId, { help: 'Used in default snapshot / trigger topics.' }),
      ),
      card(
        'Trigger',
        field('Listener topic', snapshotTopic, {
          help: 'Maps from hub editor listenerTopic. Empty → /snapshot/positions/{clientId}.',
        }),
        field('Trigger destination', triggerTopic, {
          help: 'Maps from hub editor requestMessage. Empty → {snapshotTopic}/{rate}/{batchSize}.',
        }),
        field('Snapshot end token', endToken, {
          help: 'Case-insensitive substring that ends the snapshot phase.',
        }),
      ),
    );
    bumpStompDisabled();
  }

  function renderFields(): void {
    inputs.clear();
    const list = el('div');
    for (const [name, type] of Object.entries(POSITION_SCHEMA)) {
      const row = el('div', { className: 'vg-psp-checkrow' });
      const cb = el('input', { type: 'checkbox', checked: true, disabled: true }) as HTMLInputElement;
      row.append(cb, el('span', {}, `${name} · ${type}`));
      list.append(row);
    }
    body.append(
      card(
        'Perspective table fields',
        el('p', { className: 'vg-psp-muted' },
          'Fixed POSITION_SCHEMA on the shared Perspective table. Unlike the hub editor, '
          + 'fields are not inferred from the transport — the book owns the schema.'),
        list,
      ),
    );
  }

  function renderColumns(): void {
    inputs.clear();
    const key = bind('keyColumn', el('select') as HTMLSelectElement);
    for (const col of POSITION_COLUMNS) {
      const id = String(col.colId ?? col.field ?? '');
      key.append(el('option', {
        value: id,
        ...(draft.keyColumn === id ? { selected: true } : {}),
      }, id));
    }

    const table = el('table', { className: 'vg-psp-table' });
    const thead = el('thead');
    thead.append(el('tr', {},
      el('th', {}, 'Field'),
      el('th', {}, 'Header'),
      el('th', {}, 'Type'),
      el('th', {}, 'Width'),
    ));
    const tbody = el('tbody');
    for (const col of POSITION_COLUMNS) {
      tbody.append(el('tr', {},
        el('td', {}, String(col.field ?? col.colId ?? '')),
        el('td', {}, String(col.headerName ?? col.field ?? '')),
        el('td', {}, String(col.cellDataType ?? 'text')),
        el('td', {}, String(col.width ?? '')),
      ));
    }
    table.append(thead, tbody);

    body.append(
      card(
        'Key column',
        field('Payload key → positionId', key, {
          help: 'Maps STOMP payload unique key onto the canonical positionId field.',
        }),
      ),
      card(
        'Grid columns (POSITION_COLUMNS)',
        el('p', { className: 'vg-psp-muted' },
          'Read-only. Column defs ship with StompPerspectiveProvider.gridOptions().'),
        table,
      ),
    );
  }

  function renderBehaviour(): void {
    inputs.clear();
    const rows = bind('snapshotRows', el('input', {
      type: 'number',
      value: String(draft.snapshotRows),
      min: '1',
    }) as HTMLInputElement);
    const rate = bind('rate', el('input', {
      type: 'number',
      value: String(draft.rate),
      min: '1',
    }) as HTMLInputElement);
    const batch = bind('batchSize', el('input', {
      type: 'number',
      value: String(draft.batchSize),
      min: '1',
    }) as HTMLInputElement);
    const upt = bind('updatesPerTick', el('input', {
      type: 'number',
      value: String(draft.updatesPerTick),
      min: '0',
    }) as HTMLInputElement);
    const label = bind('label', el('input', {
      type: 'text',
      value: draft.label,
    }) as HTMLInputElement);
    const filter = bind('filterJson', el('textarea', {
      placeholder: '[["desk","==","RATES"]]',
    }) as HTMLTextAreaElement);
    filter.value = draft.filterJson;

    const knobs = el('div', { className: 'vg-psp-grid2' });
    knobs.append(
      field('Snapshot rows', rows, { help: 'Seed size / STOMP snapshot-rows request.' }),
      field('Rate (ticks/s)', rate),
      field('Batch size', batch),
      field('Updates / tick (seed)', upt),
    );

    body.append(
      card('Book knobs', knobs),
      card(
        'View',
        field('Label', label),
        field('Perspective filter (JSON)', filter, {
          help: 'Optional filter triples fixed onto this provider view.',
        }),
      ),
      card(
        'Hub Behaviour map',
        el('p', { className: 'vg-psp-muted' },
          'Throttle / conflate / thinDeltas / wireFormat live inside PerspectiveBook + '
          + 'SharedWorker, not as hub pipeline toggles. Apply rebuilds the provider.'),
      ),
    );
  }

  function renderDiagnostics(): void {
    inputs.clear();
    const grid = el('div', { className: 'vg-psp-diag' });
    const stat = (k: string, v: string) => {
      const s = el('div', { className: 'vg-psp-stat' });
      s.append(el('div', { className: 'vg-psp-stat__k' }, k), el('div', { className: 'vg-psp-stat__v' }, v));
      return s;
    };
    if (!telemetry) {
      body.append(
        card(
          'Live telemetry',
          el('p', { className: 'vg-psp-muted' },
            'Apply the provider to start receiving BookTelemetry (phase, worker mode, book size, rates).'),
        ),
      );
      return;
    }
    const t = telemetry;
    grid.append(
      stat('Phase', t.phase),
      stat('Engine', t.workerMode),
      stat('Feed role', t.feedRole ?? '—'),
      stat('Book size', t.bookSize.toLocaleString()),
      stat('Live rows/s', t.liveUpdatesPerSec.toLocaleString()),
      stat('getRows', t.getRowsTotal.toLocaleString()),
      stat('Rows served', t.rowsServedTotal.toLocaleString()),
    );
    body.append(card('Live telemetry', grid));
  }

  function renderBody(): void {
    body.replaceChildren();
    if (tab === 'Connection') renderConnection();
    else if (tab === 'Fields') renderFields();
    else if (tab === 'Columns') renderColumns();
    else if (tab === 'Behaviour') renderBehaviour();
    else renderDiagnostics();
  }

  cancelBtn.addEventListener('click', () => opts.onCancel?.());
  applyBtn.addEventListener('click', () => {
    syncDraftFromDom();
    const res = toProviderConfig(draft);
    if (!res.ok) {
      errEl.textContent = res.error;
      return;
    }
    errEl.textContent = '';
    void opts.onApply?.(res.cfg);
  });

  renderTabs();
  renderBody();

  return {
    getConfig() {
      syncDraftFromDom();
      const res = toProviderConfig(draft);
      if (!res.ok) throw new Error(res.error);
      return res.cfg;
    },
    setConfig(partial) {
      const merged: Partial<StompPerspectiveProviderConfig> = {
        feed: partial.feed ?? draft.feed,
        wsUrl: partial.wsUrl ?? draft.wsUrl,
        clientId: partial.clientId ?? draft.clientId,
        snapshotTopic: partial.snapshotTopic ?? (draft.snapshotTopic || undefined),
        triggerTopic: partial.triggerTopic ?? (draft.triggerTopic || undefined),
        snapshotEndToken: partial.snapshotEndToken ?? draft.snapshotEndToken,
        keyColumn: partial.keyColumn ?? draft.keyColumn,
        snapshotRows: partial.snapshotRows ?? draft.snapshotRows,
        rate: partial.rate ?? draft.rate,
        batchSize: partial.batchSize ?? draft.batchSize,
        updatesPerTick: partial.updatesPerTick ?? draft.updatesPerTick,
        label: partial.label ?? draft.label,
        filter: partial.filter,
      };
      if (partial.filter === undefined) {
        const parsed = parseFilter(draft.filterJson);
        if (parsed.ok) merged.filter = parsed.filter;
      }
      Object.assign(draft, draftFromInitial(merged));
      renderBody();
    },
    setTelemetry(t) {
      telemetry = t;
      if (tab === 'Diagnostics') renderBody();
    },
    destroy() {
      root.remove();
    },
  };
}
