type CachedFormatter = Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat;

const cache = new Map<string, CachedFormatter>();
const MAX_ENTRIES = 500;
const insertionOrder: string[] = [];

function hashKey(parts: Array<string | number | boolean | undefined>): string {
  return parts.map((p) => (p === undefined ? '_' : String(p))).join('|');
}

export function getIntlNumberFormat(
  locale: string,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  throw new Error('not-yet-implemented: intlCache.getIntlNumberFormat');
}

export function getIntlDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  throw new Error('not-yet-implemented: intlCache.getIntlDateTimeFormat');
}

export function getIntlRelativeTimeFormat(
  locale: string,
  options: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  throw new Error('not-yet-implemented: intlCache.getIntlRelativeTimeFormat');
}

/** Reset (test-only helper — not exported from index.ts). */
export function _resetCache_forTests(): void {
  cache.clear();
  insertionOrder.length = 0;
}
