import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataProviderConfig } from '../src/types';
import {
  exportProviderConfig,
  parseProviderConfigImport,
  toPortableProviderConfig,
} from '../src/editor/providerConfigIo';

const base: DataProviderConfig = {
  providerId: 'p-1',
  name: 'STOMP Positions',
  description: 'Live feed',
  providerType: 'stomp',
  rowModel: 'clientSide',
  userId: 'dev1',
  public: true,
  isDefault: true,
  config: {
    websocketUrl: 'ws://localhost:8081',
    listenerTopic: '/snapshot/positions/T1',
    columnDefinitions: [{ field: 'positionId', headerName: 'Position Id', cellDataType: 'text' }],
    keyColumn: 'positionId',
  },
};

function exportEnvelope(provider: DataProviderConfig): string {
  return JSON.stringify({
    kind: 'starui.dataProvider',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    provider: toPortableProviderConfig(provider),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toPortableProviderConfig', () => {
  it('drops identity/ownership fields and deep-clones', () => {
    const portable = toPortableProviderConfig(base);
    expect(portable).not.toHaveProperty('providerId');
    expect(portable).not.toHaveProperty('userId');
    expect(portable).not.toHaveProperty('isDefault');
    expect(portable.name).toBe('STOMP Positions');
    expect(portable.public).toBe(true);
    expect(portable.config).toEqual(base.config);
    expect(portable.config).not.toBe(base.config);
  });
});

describe('parseProviderConfigImport', () => {
  it('round-trips a wrapped export envelope', () => {
    const parsed = parseProviderConfigImport(exportEnvelope(base));
    expect(parsed.name).toBe('STOMP Positions');
    expect(parsed.providerType).toBe('stomp');
    expect(parsed.config).toEqual(base.config);
    expect(parsed).not.toHaveProperty('providerId');
    expect(parsed).not.toHaveProperty('userId');
  });

  it('accepts a bare provider object and strips identity', () => {
    const parsed = parseProviderConfigImport(JSON.stringify(base));
    expect(parsed.providerType).toBe('stomp');
    expect(parsed).not.toHaveProperty('providerId');
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('isDefault');
  });

  it('defaults a missing name', () => {
    const parsed = parseProviderConfigImport(
      JSON.stringify({ providerType: 'mock', config: {} }),
    );
    expect(parsed.name).toBe('imported provider');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseProviderConfigImport('{not json')).toThrow(/valid JSON/);
  });
});

describe('exportProviderConfig', () => {
  it('triggers a JSON download for the portable envelope', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: click });
        Object.defineProperty(el, 'remove', { value: remove });
      }
      return el;
    });

    exportProviderConfig(base);
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });
});
