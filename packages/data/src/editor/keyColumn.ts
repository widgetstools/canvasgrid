/** Normalize MultiSelect key picks into the persisted keyColumn shape. */
export function normalizeKeyColumns(keys: readonly string[]): string | string[] | undefined {
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0];
  return [...keys];
}

export function readKeyColumns(key: string | readonly string[] | undefined): string[] {
  if (typeof key === 'string' && key.trim()) return [key];
  if (Array.isArray(key)) return key.filter((k) => typeof k === 'string' && k.trim());
  return [];
}
