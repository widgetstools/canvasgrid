import type { DataProviderConfig } from '../types';

/** Synthetic sidebar id for an unsaved create/clone draft (never persisted). */
export const DRAFT_LIST_ID_PREFIX = '__draft__:';

export function toDraftListId(seq: number): string {
  return `${DRAFT_LIST_ID_PREFIX}${seq}`;
}

export function isDraftListId(id: string | null | undefined): id is string {
  return Boolean(id?.startsWith(DRAFT_LIST_ID_PREFIX));
}

export function providerMatchesSearch(cfg: DataProviderConfig, query: string): boolean {
  const s = query.trim().toLowerCase();
  if (!s) return true;
  return (
    cfg.name.toLowerCase().includes(s)
    || cfg.providerType.toLowerCase().includes(s)
    || (cfg.description ?? '').toLowerCase().includes(s)
  );
}

/** Merge an in-memory draft into the persisted sidebar list for display. */
export function buildProviderSidebarConfigs(
  filtered: readonly DataProviderConfig[],
  creating: DataProviderConfig | null,
  draftSeq: number,
  search: string,
): readonly DataProviderConfig[] {
  if (!creating || !providerMatchesSearch(creating, search)) return filtered;
  const draftRow: DataProviderConfig = {
    ...creating,
    providerId: toDraftListId(draftSeq),
  };
  return [draftRow, ...filtered];
}
