import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataProviderConfig } from '../src/types';
import {
  applyPortableProviderConfig,
  exportProviderConfig,
  parseProviderConfigImport,
  serializeProviderConfig,
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

  it('rejects an unknown/unregistered providerType', () => {
    expect(() =>
      parseProviderConfigImport(JSON.stringify({ providerType: 'not-a-real-transport', config: {} })),
    ).toThrow(/Unknown provider type/);
  });

  it('rejects a stomp import missing websocketUrl', () => {
    expect(() =>
      parseProviderConfigImport(
        JSON.stringify({ providerType: 'stomp', config: { listenerTopic: '/topic/x' } }),
      ),
    ).toThrow(/websocketUrl/);
  });

  it('rejects a stomp import missing listenerTopic', () => {
    expect(() =>
      parseProviderConfigImport(
        JSON.stringify({ providerType: 'stomp', config: { websocketUrl: 'ws://localhost:8080' } }),
      ),
    ).toThrow(/listenerTopic/);
  });

  it('rejects a stomp import with a non ws/wss websocketUrl', () => {
    expect(() =>
      parseProviderConfigImport(
        JSON.stringify({
          providerType: 'stomp',
          config: { websocketUrl: 'http://localhost:8080', listenerTopic: '/topic/x' },
        }),
      ),
    ).toThrow(/ws:\/\/ or wss:\/\//);
  });

  it('accepts a valid stomp import (websocketUrl + listenerTopic present)', () => {
    const parsed = parseProviderConfigImport(
      JSON.stringify({
        providerType: 'stomp',
        config: { websocketUrl: 'wss://example.com/hub', listenerTopic: '/topic/x' },
      }),
    );
    expect(parsed.providerType).toBe('stomp');
    expect(parsed.config.websocketUrl).toBe('wss://example.com/hub');
  });

  it('rejects an invalid rowModel', () => {
    expect(() =>
      parseProviderConfigImport(
        JSON.stringify({ providerType: 'mock', rowModel: 'notARowModel', config: {} }),
      ),
    ).toThrow(/rowModel/);
  });

  it('accepts a minimal mock import with no required fields', () => {
    const parsed = parseProviderConfigImport(
      JSON.stringify({ providerType: 'mock', config: {} }),
    );
    expect(parsed.providerType).toBe('mock');
    expect(parsed.rowModel).toBe('clientSide');
  });

  it('defaults rowModel to clientSide when absent, accepts explicit serverSide', () => {
    const withoutRowModel = parseProviderConfigImport(JSON.stringify({ providerType: 'mock', config: {} }));
    expect(withoutRowModel.rowModel).toBe('clientSide');
    const withServerSide = parseProviderConfigImport(
      JSON.stringify({ providerType: 'mock', rowModel: 'serverSide', config: {} }),
    );
    expect(withServerSide.rowModel).toBe('serverSide');
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

describe('applyPortableProviderConfig', () => {
  it('overlays imported fields but keeps identity', () => {
    const portable = toPortableProviderConfig({
      ...base,
      name: 'Imported name',
      config: { ...base.config, websocketUrl: 'ws://other' },
    });
    const next = applyPortableProviderConfig(base, portable);
    expect(next.providerId).toBe('p-1');
    expect(next.userId).toBe('dev1');
    expect(next.isDefault).toBe(true);
    expect(next.name).toBe('Imported name');
    expect(next.config.websocketUrl).toBe('ws://other');
  });
});

describe('serializeProviderConfig', () => {
  it('wraps a portable envelope', () => {
    const parsed = JSON.parse(serializeProviderConfig(base));
    expect(parsed.kind).toBe('starui.dataProvider');
    expect(parsed.version).toBe(1);
    expect(parsed.provider.name).toBe('STOMP Positions');
    expect(parsed.provider).not.toHaveProperty('providerId');
  });
});
