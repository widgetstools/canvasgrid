import { afterEach, describe, expect, it } from 'vitest';
import {
  defineTransportPlugin,
  registerTransportPlugin,
  getTransportPlugin,
  listTransportPlugins,
  _resetTransportPluginsForTests,
} from '../src/registry/plugins';
import { _resetTransportRegistryForTests } from '../src/registry/transports';
import { _resetDefaultTransportsFlagForTests, registerDefaultTransports } from '../src/transports/registerDefaults';
import { ProviderClientAdapter } from '../src/client/ProviderClientAdapter';
import { _resetHubConnectionForTests } from '../src/client/hubConnection';
import { mountProviderEditor } from '../src/editor/ProviderEditor';

function reset(): void {
  _resetHubConnectionForTests();
  _resetTransportRegistryForTests();
  _resetDefaultTransportsFlagForTests();
}

afterEach(reset);

describe('TransportPlugin registry', () => {
  it('registers custom transport and hub can start it', async () => {
    reset();
    registerDefaultTransports();
    registerTransportPlugin(defineTransportPlugin({
      id: 'test-custom',
      label: 'Custom',
      defaultKeyFields: 'id',
      defaultConfig: () => ({ marker: 'x' }),
      create(cfg, emit) {
        queueMicrotask(() => {
          emit({ status: 'connecting' });
          emit({ status: 'snapshot' });
          emit({ rows: [{ id: '1', marker: cfg.marker }], replace: true });
          emit({ rowsReceived: 1 });
          emit({ status: 'ready' });
        });
        return {
          stop() { emit({ status: 'disconnected' }); },
          restart() { /* */ },
        };
      },
      mountConnectionFields(host, api) {
        const input = document.createElement('input');
        input.dataset.testid = 'custom-marker';
        input.value = String(api.value.marker ?? '');
        input.addEventListener('change', () => api.onChange({ marker: input.value }));
        host.appendChild(input);
        return { destroy() { input.remove(); } };
      },
    }));

    expect(getTransportPlugin('test-custom')?.label).toBe('Custom');
    expect(listTransportPlugins().some((p) => p.id === 'test-custom')).toBe(true);

    const provider = new ProviderClientAdapter({
      providerId: 'custom-1',
      name: 'Custom',
      providerType: 'test-custom',
      rowModel: 'clientSide',
      config: { keyColumn: 'id', marker: 'hello', throttleEnabled: false },
    }, { inProcess: true });

    await provider.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(provider.getStatus()).toBe('ready');
    expect(provider.getData()).toEqual([{ id: '1', marker: 'hello' }]);
    provider.destroy();
  });

  it('editor mounts plugin connection fields', () => {
    reset();
    registerDefaultTransports();
    registerTransportPlugin(defineTransportPlugin({
      id: 'ui-custom',
      label: 'UI Custom',
      defaultConfig: () => ({ foo: 'bar' }),
      create(_cfg, emit) {
        return {
          stop() { emit({ status: 'disconnected' }); },
          restart() { /* */ },
        };
      },
      mountConnectionFields(host) {
        const el = document.createElement('div');
        el.dataset.testid = 'ui-custom-fields';
        host.appendChild(el);
        return { destroy() { el.remove(); } };
      },
    }));

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = mountProviderEditor({
      mount,
      initial: { providerType: 'ui-custom', providerId: 'e1', name: 'E' },
    });
    expect(mount.querySelector('[data-testid="ui-custom-fields"]')).toBeTruthy();
    editor.destroy();
    mount.remove();
  });
});
