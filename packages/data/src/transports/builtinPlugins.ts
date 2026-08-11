import { defineTransportPlugin, type TransportPlugin } from '../registry/plugins';
import { mountFieldDescriptors, mountFieldGroups } from '../editor/connectionFields';
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
    return mountFieldGroups(host, [{
      title: 'Mock stream',
      fields: [
        { kind: 'number', key: 'rowCount', label: 'Row count', help: 'Initial snapshot size.' },
        { kind: 'number', key: 'tickMs', label: 'Tick interval (ms)', help: '0 = snapshot only, no live ticks.' },
        {
          kind: 'select',
          key: 'shape',
          label: 'Shape',
          options: ['positions', 'trades', 'orders'],
          help: 'Synthetic row shape for local demos.',
        },
      ],
    }], api);
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
    heartbeat: { outgoing: 4000, incoming: 4000 },
  }),
  mountConnectionFields(host, api) {
    // Markets StompFields layout: Connection + Trigger + Heartbeat.
    return mountFieldGroups(host, [
      {
        title: 'Connection',
        fields: [
          {
            kind: 'text',
            key: 'websocketUrl',
            label: 'WebSocket URL',
            required: true,
            mono: true,
            placeholder: 'ws://localhost:8080',
            help: 'Supports {{appData.key}} (deterministic) and [name] (session-unique ID).',
          },
          {
            kind: 'text',
            key: 'listenerTopic',
            label: 'Listener Topic',
            required: true,
            mono: true,
            placeholder: '/snapshot/positions/TRADER001',
            help: 'Topic the worker SUBSCRIBEs to. Use [name] for a session-unique ID.',
          },
        ],
      },
      {
        title: 'Trigger',
        fields: [
          {
            kind: 'text',
            key: 'requestMessage',
            label: 'Trigger Destination',
            mono: true,
            placeholder: '/snapshot/positions/TRADER001/1000',
            help: 'SEND destination after subscribing. Supports [name] tokens.',
          },
          {
            kind: 'text',
            key: 'requestBody',
            label: 'Trigger Body',
            mono: true,
            placeholder: '(empty — rate in destination)',
            help: 'Leave empty when destination encodes everything. Some servers expect START or a JSON envelope.',
          },
          {
            kind: 'text',
            key: 'snapshotEndToken',
            label: 'Snapshot End Token',
            mono: true,
            placeholder: 'Success',
            help: "Case-insensitive substring that flips status: 'snapshot' → 'ready'.",
          },
          {
            kind: 'number',
            key: 'messageRate',
            label: 'Snapshot rows',
            help: 'Sent as the STOMP `snapshot-rows` header when requesting the book. Default 10000.',
          },
          {
            kind: 'number',
            key: 'batchSize',
            label: 'Batch size',
            help: 'Rows per flush while loading the snapshot / live ticks.',
          },
        ],
      },
      {
        title: 'Heartbeat',
        fields: [
          {
            kind: 'number',
            key: 'heartbeat.outgoing',
            label: 'Outgoing (ms)',
            help: 'STOMP heartbeat interval the client sends. 0 disables.',
          },
          {
            kind: 'number',
            key: 'heartbeat.incoming',
            label: 'Incoming (ms)',
            help: 'Expected broker heartbeat interval. 0 disables.',
          },
        ],
      },
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
    return mountFieldGroups(host, [{
      title: 'Endpoint',
      fields: [
        {
          kind: 'text',
          key: 'baseUrl',
          label: 'Base URL',
          required: true,
          mono: true,
          placeholder: 'https://api.example.com',
        },
        {
          kind: 'text',
          key: 'endpoint',
          label: 'Endpoint',
          required: true,
          mono: true,
          placeholder: '/v1/positions',
        },
        {
          kind: 'text',
          key: 'rowsPath',
          label: 'Rows Path',
          mono: true,
          placeholder: 'data.results',
          help: 'Dot path into the JSON response. Empty if response IS the array.',
        },
        {
          kind: 'number',
          key: 'pollInterval',
          label: 'Poll interval (ms)',
          help: '0 = one-shot fetch.',
        },
      ],
    }], api);
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
