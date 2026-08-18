import type { DataProviderConfig } from '../types';

const EXPORT_KIND = 'starui.dataProvider';
const EXPORT_VERSION = 1;

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
  if (!isRecord(candidate.config)) {
    throw new Error('Missing or invalid "config".');
  }
  return toPortableProviderConfig({
    ...(candidate as unknown as DataProviderConfig),
    name: typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name
      : 'imported provider',
    providerId: '',
    userId: '',
  });
}
