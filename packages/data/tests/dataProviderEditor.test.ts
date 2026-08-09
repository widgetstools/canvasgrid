import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryConfigBackend,
  mountDataProviderEditor,
  mountProviderEditor,
  registerDefaultTransports,
  _resetDefaultTransportsFlagForTests,
  _resetHubConnectionForTests,
  _resetTransportRegistryForTests,
} from '../src/index';

function reset(): void {
  _resetHubConnectionForTests();
  _resetTransportRegistryForTests();
  _resetDefaultTransportsFlagForTests();
}

afterEach(reset);

describe('DataProviderEditor shell', () => {
  it('lists catalog providers and mounts Markets-tab form on select', async () => {
    reset();
    registerDefaultTransports();
    const backend = new MemoryConfigBackend();
    await backend.save({
      providerId: 'stomp-1',
      name: 'Live positions',
      providerType: 'stomp',
      rowModel: 'clientSide',
      config: {
        keyColumn: 'positionId',
        websocketUrl: 'ws://localhost:8080',
        listenerTopic: '/topic/x',
      },
    });

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const shell = mountDataProviderEditor({
      mount,
      backend,
      initialProviderId: 'stomp-1',
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(mount.querySelector('.vg-dp-shell')).toBeTruthy();
    expect(mount.querySelector('.vg-dp-shell__sidebar')).toBeTruthy();
    expect(mount.textContent).toContain('Name');
    expect(mount.textContent).toContain('Update DataProvider');
    const tabs = Array.from(mount.querySelectorAll('.vg-dp-editor__tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['Connection', 'Fields', 'Columns', 'Behaviour', 'Diagnostics']);
    expect(mount.textContent).toContain('WebSocket URL');
    expect(mount.textContent).toContain('Listener Topic');
    expect(mount.textContent).toContain('Trigger Destination');

    shell.destroy();
    mount.remove();
  });
});

describe('ProviderEditor form tabs', () => {
  it('shows Diagnostics + Update when saved id is present', () => {
    reset();
    registerDefaultTransports();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = mountProviderEditor({
      mount,
      initial: { providerType: 'mock', providerId: 'm1', name: 'Mock' },
    });
    expect(mount.textContent).toContain('Name');
    expect(mount.textContent).toContain('Update DataProvider');
    const tabs = Array.from(mount.querySelectorAll('.vg-dp-editor__tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['Connection', 'Fields', 'Columns', 'Behaviour', 'Diagnostics']);
    editor.destroy();
    mount.remove();
  });

  it('hides Diagnostics and shows Create for draft (empty providerId)', () => {
    reset();
    registerDefaultTransports();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = mountProviderEditor({
      mount,
      initial: { providerType: 'stomp', providerId: '', name: 'untitled' },
    });
    expect(mount.textContent).toContain('Create DataProvider');
    const tabs = Array.from(mount.querySelectorAll('.vg-dp-editor__tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['Connection', 'Fields', 'Columns', 'Behaviour']);
    expect(mount.textContent).toContain('WebSocket URL');
    editor.destroy();
    mount.remove();
  });

  it('Columns table sits in a viewport scroll region with sticky header', () => {
    reset();
    registerDefaultTransports();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = mountProviderEditor({
      mount,
      initial: {
        providerType: 'mock',
        providerId: 'm1',
        name: 'Mock',
        config: {
          keyColumn: 'positionId',
          columnDefinitions: [
            { field: 'positionId', headerName: 'Position Id', cellDataType: 'text' },
            { field: 'ticker', headerName: 'Ticker', cellDataType: 'text' },
          ],
        },
      },
    });
    const columnsTab = Array.from(mount.querySelectorAll('.vg-dp-editor__tab'))
      .find((t) => t.textContent === 'Columns') as HTMLButtonElement;
    columnsTab.click();
    expect(mount.querySelector('[data-testid="columns-scroll"]')).toBeTruthy();
    expect(mount.querySelector('.vg-dp-editor__columns-table thead')).toBeTruthy();
    expect(mount.textContent).toContain('Rows: 2');
    editor.destroy();
    mount.remove();
  });

  it('Key Column uses a dropdown multi-select with chips', () => {
    reset();
    registerDefaultTransports();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = mountProviderEditor({
      mount,
      initial: {
        providerType: 'mock',
        providerId: 'm1',
        name: 'Mock',
        config: {
          keyColumn: 'positionId',
          columnDefinitions: [
            { field: 'positionId', headerName: 'Position Id', cellDataType: 'text' },
            { field: 'ticker', headerName: 'Ticker', cellDataType: 'text' },
          ],
        },
      },
    });
    const columnsTab = Array.from(mount.querySelectorAll('.vg-dp-editor__tab'))
      .find((t) => t.textContent === 'Columns') as HTMLButtonElement;
    columnsTab.click();

    const keySelect = mount.querySelector('[data-testid="key-column-select"]');
    expect(keySelect).toBeTruthy();
    expect(keySelect?.querySelector('.vg-dp-ms__trigger')).toBeTruthy();
    expect(keySelect?.querySelector('.vg-dp-ms__chip')?.textContent).toContain('positionId');

    keySelect?.querySelector<HTMLButtonElement>('.vg-dp-ms__trigger')?.click();
    expect(keySelect?.querySelector('.vg-dp-ms__panel')).toBeTruthy();
    expect(keySelect?.textContent).toContain('ticker');

    editor.destroy();
    mount.remove();
  });
});
