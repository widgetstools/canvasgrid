import type { TransportFactory, TransportType } from '../types';

const factories = new Map<string, TransportFactory>();

export function registerTransport(type: TransportType, factory: TransportFactory): void {
  factories.set(type, factory);
}

export function getTransportFactory(type: TransportType): TransportFactory | undefined {
  return factories.get(type);
}

export function listRegisteredTransports(): TransportType[] {
  return [...factories.keys()] as TransportType[];
}

/** Clear registry — tests only. */
export function _resetTransportRegistryForTests(): void {
  factories.clear();
}
