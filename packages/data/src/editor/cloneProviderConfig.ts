import type { DataProviderConfig } from '../types';

const COPY_SUFFIX = / \(copy(?: \d+)?\)$/i;

/** Strip a trailing " (copy)" / " (copy 2)" suffix before re-appending. */
export function copyNameFrom(sourceName: string): string {
  const base = sourceName.trim() || 'untitled';
  return `${base.replace(COPY_SUFFIX, '')} (copy)`;
}

/**
 * Deep-clone a saved provider into an unsaved draft suitable for
 * catalog.save() (new row — no stable providerId until Create).
 */
export function cloneProviderConfig(
  source: DataProviderConfig,
  userId?: string,
): DataProviderConfig {
  const cloned = structuredClone(source);
  cloned.providerId = '';
  cloned.isDefault = false;
  cloned.name = copyNameFrom(source.name);
  if (userId !== undefined) cloned.userId = userId;
  return cloned;
}
