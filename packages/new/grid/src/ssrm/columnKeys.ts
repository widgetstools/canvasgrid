export type SsrmColumnKeysInput = {
  visibleColIds: readonly string[];
  overscanColIds?: readonly string[];
  rowIdField?: string | null;
  sortColIds?: readonly string[];
  filterColIds?: readonly string[];
  rowGroupColIds?: readonly string[];
  valueAggColIds?: readonly string[];
  expressionOutputIds?: readonly string[];
  clientWatchedColIds?: readonly string[];
};

export function buildSsrmColumnKeys(input: SsrmColumnKeysInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of input.visibleColIds) add(id);
  for (const id of input.overscanColIds ?? []) add(id);
  add(input.rowIdField ?? undefined);
  for (const id of input.sortColIds ?? []) add(id);
  for (const id of input.filterColIds ?? []) add(id);
  for (const id of input.rowGroupColIds ?? []) add(id);
  for (const id of input.valueAggColIds ?? []) add(id);
  for (const id of input.expressionOutputIds ?? []) add(id);
  for (const id of input.clientWatchedColIds ?? []) add(id);
  return out;
}
