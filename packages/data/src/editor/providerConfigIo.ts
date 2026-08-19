import type { DataProviderConfig, RowModelType, TransportConfig } from '../types';
import { getTransportPlugin } from '../registry/plugins';
import { registerDefaultTransports } from '../transports/registerDefaults';

const EXPORT_KIND = 'starui.dataProvider';
const EXPORT_VERSION = 1;

/** Non-optional transport-config fields per builtin `providerType`, read off
 *  `types/transport.ts`'s `*TransportConfig` interfaces (`websocketUrl` /
 *  `listenerTopic` for `stomp`, etc). Host-registered plugins beyond the
 *  builtins are accepted as long as they're registered — no required-field
 *  list is known for them, so only the known-registered check applies. */
const REQUIRED_TRANSPORT_FIELDS: Record<string, readonly string[]> = {
  stomp: ['websocketUrl', 'listenerTopic'],
  rest: ['baseUrl', 'endpoint'],
  mock: [],
  solace: ['url', 'topic'],
  amps: ['url', 'topic'],
  socketio: ['url'],
  websocket: ['url'],
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidWebSocketUrl(v: unknown): boolean {
  if (!isNonEmptyString(v)) return false;
  try {
    const parsed = new URL(v);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

export type PortableProviderConfig = Omit<
  DataProviderConfig,
  'providerId' | 'userId' | 'isDefault'
>;

interface ProviderConfigExport {
  kind: typeof EXPORT_KIND;
  version: number;
  exportedAt: string;
  provider: PortableProviderConfig;
}

function toFileStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'data-provider'
  );
}

export function toPortableProviderConfig(
  provider: DataProviderConfig,
): PortableProviderConfig {
  const { providerId: _id, userId: _userId, isDefault: _isDefault, ...portable } =
    structuredClone(provider);
  return portable;
}

/** Fold an imported portable config onto an existing provider (keeps id/owner). */
export function applyPortableProviderConfig(
  current: DataProviderConfig,
  portable: PortableProviderConfig,
): DataProviderConfig {
  return {
    ...current,
    ...structuredClone(portable),
    providerId: current.providerId,
    userId: current.userId,
    isDefault: current.isDefault,
  };
}

export function serializeProviderConfig(provider: DataProviderConfig): string {
  const payload: ProviderConfigExport = {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    provider: toPortableProviderConfig(provider),
  };
  return JSON.stringify(payload, null, 2);
}

/** Trigger a JSON download. `ownerDoc` must be the popout document when the
 *  editor lives in a `window.open` surface — opener `document.body` would
 *  attach the `<a>` to the parent page. */
export function downloadJson(
  filename: string,
  contents: string,
  ownerDoc: Document = document,
): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = ownerDoc.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  ownerDoc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportProviderConfig(
  provider: DataProviderConfig,
  ownerDoc: Document = document,
): void {
  downloadJson(
    `starui-data-provider-${toFileStem(provider.name)}.json`,
    serializeProviderConfig(provider),
    ownerDoc,
  );
}

export function bindJsonFileInput(
  ownerDoc: Document,
  onFile: (file: File) => void,
  testId?: string,
): HTMLInputElement {
  const input = ownerDoc.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  if (testId) input.setAttribute('data-testid', testId);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
  return input;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function parseProviderConfigImport(text: string): PortableProviderConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!isRecord(parsed)) {
    throw new Error('File does not contain a data provider config.');
  }
  const candidate =
    parsed.kind === EXPORT_KIND && isRecord(parsed.provider)
      ? parsed.provider
      : parsed;
  if (!isRecord(candidate)) {
    throw new Error('File does not contain a data provider config.');
  }
  if (typeof candidate.providerType !== 'string') {
    throw new Error('Missing or invalid "providerType".');
  }
  registerDefaultTransports();
  const providerType = candidate.providerType;
  if (!getTransportPlugin(providerType)) {
    throw new Error(`Unknown provider type "${providerType}".`);
  }
  if (!isRecord(candidate.config)) {
    throw new Error('Missing or invalid "config".');
  }
  const config = candidate.config;

  let rowModel: RowModelType = 'clientSide';
  if (candidate.rowModel !== undefined) {
    if (candidate.rowModel !== 'clientSide' && candidate.rowModel !== 'serverSide') {
      throw new Error('Invalid "rowModel" — must be "clientSide" or "serverSide".');
    }
    rowModel = candidate.rowModel;
  }

  const requiredFields = REQUIRED_TRANSPORT_FIELDS[providerType] ?? [];
  for (const field of requiredFields) {
    if (!isNonEmptyString(config[field])) {
      throw new Error(`Missing required field "${field}" for provider type "${providerType}".`);
    }
  }
  if (providerType === 'stomp' && !isValidWebSocketUrl(config.websocketUrl)) {
    throw new Error('"websocketUrl" must be a valid ws:// or wss:// URL.');
  }

  const name = isNonEmptyString(candidate.name) ? candidate.name : 'imported provider';
  const description = typeof candidate.description === 'string' ? candidate.description : undefined;
  const blockSize = typeof candidate.blockSize === 'number' ? candidate.blockSize : undefined;
  const tags = Array.isArray(candidate.tags) && candidate.tags.every((t) => typeof t === 'string')
    ? (candidate.tags as string[])
    : undefined;
  const isPublic = typeof candidate.public === 'boolean' ? candidate.public : undefined;
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined;

  return {
    name,
    description,
    providerType,
    rowModel,
    config: structuredClone(config) as TransportConfig,
    blockSize,
    tags,
    public: isPublic,
    updatedAt,
  };
}
