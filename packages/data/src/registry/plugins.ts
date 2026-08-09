import type { TransportFactory, TransportType } from '../types';
import { registerTransport } from './transports';

export type ConnectionFieldsApi = {
  value: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
};

export type ConnectionFieldsHandle = { destroy(): void };

/**
 * Host-facing transport plugin. Implement `create` (+ optional connection UI);
 * the hub/provider/grid contracts stay stable.
 *
 * Runtime shape is factory + ProviderEmit (SharedWorker-safe). Conceptual
 * ITransport lifecycle maps to:
 * - create() auto-starts (or activate inside create)
 * - handle.stop / handle.restart
 * - emit({ rows, replace }) snapshot / emit({ rows }) live
 * - emit({ status: 'ready' }) snapshot ready
 * - emit({ rowsReceived }) progress
 * - keyFields via config.keyColumn or defaultKeyFields
 */
export interface TransportPlugin {
  id: string;
  label: string;
  create: TransportFactory;
  defaultConfig(): Record<string, unknown>;
  mountConnectionFields?(host: HTMLElement, api: ConnectionFieldsApi): ConnectionFieldsHandle;
  defaultKeyFields?: string | readonly string[];
}

const plugins = new Map<string, TransportPlugin>();

/** Identity helper for typed plugin objects. */
export function defineTransportPlugin(p: TransportPlugin): TransportPlugin {
  return p;
}

/** Register plugin (factory + metadata/UI). Safe to call from app and worker. */
export function registerTransportPlugin(p: TransportPlugin): void {
  plugins.set(p.id, p);
  registerTransport(p.id as TransportType, p.create);
}

export function getTransportPlugin(id: string): TransportPlugin | undefined {
  return plugins.get(id);
}

export function listTransportPlugins(): TransportPlugin[] {
  return [...plugins.values()];
}

/** Tests only. */
export function _resetTransportPluginsForTests(): void {
  plugins.clear();
}
