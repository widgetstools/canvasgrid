import { defineTransportPlugin, type TransportPlugin } from '../registry/plugins';
import { mountFieldDescriptors } from '../editor/connectionFields';
import { createMockTransport } from './mock';
import { createStompTransport } from './stomp';
import { createRestTransport } from './rest';
import {
  createAmpsTransport,
  createSocketIoTransport,
  createSolaceTransport,
  createWebSocketTransport,
} from './stubs';

export const mockTransportPlugin: TransportPlugin = defineTransportPlugin({
  id: 'mock',
  label: 'Mock',
  defaultKeyFields: 'positionId',
  create: createMockTransport as never,
  defaultConfig: () => ({
    rowCount: 1000,
    tickMs: 250,
    updatesPerTick: 5,
    shape: 'positions',
    keyColumn: 'positionId',
  }),
  mountConnectionFields(host, api) {
    return mountFieldDescriptors(host, [
      { kind: 'number', key: 'rowCount', label: 'rowCount' },
      { kind: 'number', key: 'tickMs', label: 'tickMs' },
      { kind: 'select', key: 'shape', label: 'shape', options: ['positions', 'trades', 'orders'] },
    ], api);
  },
});

export const stompTransportPlugin: TransportPlugin = defineTransportPlugin({
  id: 'stomp',
  label: 'STOMP',
  create: createStompTransport as never,
  defaultConfig: () => ({
    websocketUrl: '',
    listenerTopic: '',
    snapshotEndToken: 'Success',
    autoStart: true,
  }),
  mountConnectionFields(host, api) {
    return mountFieldDescriptors(host, [
      { kind: 'text', key: 'websocketUrl', label: 'websocketUrl' },
      { kind: 'text', key: 'listenerTopic', label: 'listenerTopic' },
      { kind: 'text', key: 'requestMessage', label: 'requestMessage' },
      { kind: 'text', key: 'requestBody', label: 'requestBody' },
      { kind: 'text', key: 'snapshotEndToken', label: 'snapshotEndToken' },
    ], api);
  },
});

export const restTransportPlugin: TransportPlugin = defineTransportPlugin({
  id: 'rest',
  label: 'REST',
  create: createRestTransport as never,
  defaultConfig: () => ({
    baseUrl: '',
    endpoint: '',
    method: 'GET',
    pollInterval: 0,
  }),
  mountConnectionFields(host, api) {
    return mountFieldDescriptors(host, [
      { kind: 'text', key: 'baseUrl', label: 'baseUrl' },
      { kind: 'text', key: 'endpoint', label: 'endpoint' },
      { kind: 'number', key: 'pollInterval', label: 'pollInterval' },
      { kind: 'text', key: 'rowsPath', label: 'rowsPath' },
    ], api);
  },
});

function stubPlugin(
  id: string,
  label: string,
  create: TransportPlugin['create'],
): TransportPlugin {
  return defineTransportPlugin({
    id,
    label,
    create,
    defaultConfig: () => ({ url: '', topic: '' }),
    mountConnectionFields(host, api) {
      return mountFieldDescriptors(host, [
        { kind: 'text', key: 'url', label: 'url' },
        { kind: 'text', key: 'topic', label: 'topic' },
      ], api);
    },
  });
}

export const solaceTransportPlugin = stubPlugin('solace', 'Solace (stub)', createSolaceTransport);
export const ampsTransportPlugin = stubPlugin('amps', 'AMPS (stub)', createAmpsTransport);
export const socketIoTransportPlugin = stubPlugin('socketio', 'Socket.IO (stub)', createSocketIoTransport);
export const webSocketTransportPlugin = stubPlugin('websocket', 'WebSocket (stub)', createWebSocketTransport);

export const builtinTransportPlugins: TransportPlugin[] = [
  mockTransportPlugin,
  stompTransportPlugin,
  restTransportPlugin,
  solaceTransportPlugin,
  ampsTransportPlugin,
  socketIoTransportPlugin,
  webSocketTransportPlugin,
];
