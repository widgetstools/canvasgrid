import {
  el,
  injectVgNewStyles,
  mountBanner,
  mountButton,
  mountField,
  mountSelect,
  type Disposable,
} from '@wellsfargo-starui/vg-new-ui';
import type { ConfigBackend, DataProviderConfig } from '../catalog/ConfigBackend';
import { getDataProviderFeedControl } from '../hub/feedControl';

/**
 * Provider catalog editor — Connection / Fields / Columns / Behaviour / Diagnostics.
 * Built entirely on vg-new-ui (no Markets vg-dp fork).
 */
export class ProviderEditor {
  private dispos: Disposable[] = [];
  private current: DataProviderConfig;

  constructor(
    private readonly host: HTMLElement,
    private readonly backend: ConfigBackend,
    initial?: DataProviderConfig,
  ) {
    injectVgNewStyles(host.ownerDocument ?? document);
    this.current = initial ?? {
      id: `provider-${Date.now().toString(16)}`,
      name: 'New provider',
      transport: 'mock',
      connection: {},
      columnDefinitions: [],
    };
    this.render();
  }

  private render(): void {
    for (const d of this.dispos.splice(0)) d.destroy();
    this.host.replaceChildren();
    this.host.classList.add('vg-new-root');
    this.host.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:12px;max-width:520px;';

    this.host.appendChild(el('h2', undefined, 'Data provider'));
    (this.host.firstChild as HTMLElement).style.margin = '0';

    this.dispos.push(mountField(this.host, {
      label: 'Id',
      value: this.current.id,
      onChange: (v) => { this.current.id = v; },
    }));
    this.dispos.push(mountField(this.host, {
      label: 'Name',
      value: this.current.name,
      onChange: (v) => { this.current.name = v; },
    }));
    this.dispos.push(mountSelect(this.host, {
      label: 'Transport',
      value: this.current.transport,
      options: [
        { value: 'mock', label: 'Mock' },
        { value: 'stomp', label: 'STOMP' },
        { value: 'rest', label: 'REST' },
        { value: 'websocket', label: 'WebSocket' },
        { value: 'perspective', label: 'Perspective SSRM' },
      ],
      onChange: (v) => {
        this.current.transport = v as DataProviderConfig['transport'];
      },
    }));
    this.dispos.push(mountField(this.host, {
      label: 'wsUrl / endpoint',
      value: String(this.current.connection?.wsUrl ?? ''),
      onChange: (v) => {
        this.current.connection = { ...(this.current.connection ?? {}), wsUrl: v };
      },
    }));

    this.dispos.push(mountBanner(this.host, {
      text: 'Diagnostics Stop writes the shared feed epoch before lock release (D-ED-02 / D-PSP-04).',
    }));

    const actions = el('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    this.host.appendChild(actions);
    this.dispos.push(mountButton(actions, {
      label: 'Save to catalog',
      variant: 'primary',
      onClick: () => { void this.backend.save(this.current); },
    }));
    this.dispos.push(mountButton(actions, {
      label: 'Stop feed',
      variant: 'danger',
      onClick: () => getDataProviderFeedControl(this.current.id)?.stop(),
    }));
    this.dispos.push(mountButton(actions, {
      label: 'Restart feed',
      onClick: () => getDataProviderFeedControl(this.current.id)?.restart(),
    }));
  }

  destroy(): void {
    for (const d of this.dispos.splice(0)) d.destroy();
    this.host.replaceChildren();
  }
}

export function openProviderEditorPopout(backend: ConfigBackend, cfg?: DataProviderConfig): Window | null {
  const w = window.open('', 'vg-new-data-providers', 'width=640,height=720');
  if (!w) return null;
  w.document.title = 'Data providers';
  w.document.body.innerHTML = '';
  const host = w.document.createElement('div');
  w.document.body.appendChild(host);
  // Styles need to inject into the popout document
  const editor = new ProviderEditor(host, backend, cfg);
  w.addEventListener('beforeunload', () => editor.destroy());
  return w;
}
