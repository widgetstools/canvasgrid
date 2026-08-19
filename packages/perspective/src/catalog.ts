/**
 * Catalog of named StompPerspectiveProvider configs (localStorage).
 * Mirrors hub ConfigBackend list/get/save for the Ext Data-provider panel.
 */
import type { StompPerspectiveProviderConfig } from './provider';

/** Serializable catalog entry (no callbacks). */
export type PerspectiveProviderEntry = {
  providerId: string;
  name: string;
  description?: string;
  /** Provider knobs — `onTelemetry` / `appData` are runtime-only. */
  config: Omit<StompPerspectiveProviderConfig, 'onTelemetry' | 'appData'>;
  updatedAt?: string;
};

export interface PerspectiveProviderCatalog {
  list(): Promise<PerspectiveProviderEntry[]>;
  get(providerId: string): Promise<PerspectiveProviderEntry | null>;
  save(entry: PerspectiveProviderEntry): Promise<PerspectiveProviderEntry>;
  remove(providerId: string): Promise<void>;
}

const STORAGE_KEY = 'vg-perspective:provider-catalog';

function readAll(): PerspectiveProviderEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PerspectiveProviderEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: PerspectiveProviderEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export class LocalStoragePerspectiveProviderCatalog implements PerspectiveProviderCatalog {
  async list(): Promise<PerspectiveProviderEntry[]> {
    return readAll().map((e) => ({ ...e }));
  }

  async get(providerId: string): Promise<PerspectiveProviderEntry | null> {
    return readAll().find((e) => e.providerId === providerId) ?? null;
  }

  async save(entry: PerspectiveProviderEntry): Promise<PerspectiveProviderEntry> {
    const next = {
      ...entry,
      updatedAt: new Date().toISOString(),
    };
    const all = readAll().filter((e) => e.providerId !== entry.providerId);
    all.push(next);
    writeAll(all);
    return { ...next };
  }

  async remove(providerId: string): Promise<void> {
    writeAll(readAll().filter((e) => e.providerId !== providerId));
  }
}

export const DEFAULT_PERSPECTIVE_PROVIDER_ID = 'perspective-ssrm-positions';

export function buildDefaultPerspectiveProviderEntry(
  overrides?: Partial<PerspectiveProviderEntry['config']>,
): PerspectiveProviderEntry {
  return {
    providerId: DEFAULT_PERSPECTIVE_PROVIDER_ID,
    name: 'Perspective SSRM Positions',
    description: 'StompPerspectiveProvider · SSRM blotter (stomp-view-server)',
    config: {
      feed: 'stomp',
      wsUrl: 'ws://localhost:8082',
      clientId: 'TRADER001',
      snapshotRows: 5_000,
      rate: 40,
      batchSize: 200,
      updatesPerTick: 5,
      snapshotEndToken: 'Success',
      keyColumn: 'positionId',
      label: 'Perspective SSRM',
      ...overrides,
    },
  };
}
