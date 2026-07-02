type CachedFormatter = Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat;

const cache = new Map<string, CachedFormatter>();
const MAX_ENTRIES = 500;
const insertionOrder: string[] = [];

function hashKey(parts: Array<string | number | boolean | undefined>): string {
  return parts.map((p) => (p === undefined ? '_' : String(p))).join('|');
}

function recordAccess(key: string): void {
  const idx = insertionOrder.indexOf(key);
  if (idx !== -1) insertionOrder.splice(idx, 1);
  insertionOrder.push(key);
  while (insertionOrder.length > MAX_ENTRIES) {
    const evicted = insertionOrder.shift();
    if (evicted !== undefined) cache.delete(evicted);
  }
}

export function getIntlNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = 'nf|' + hashKey([locale, options.style, options.currency, options.minimumFractionDigits, options.maximumFractionDigits, options.useGrouping, options.notation]);
  let cached = cache.get(key) as Intl.NumberFormat | undefined;
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options);
    cache.set(key, cached);
  }
  recordAccess(key);
  return cached;
}

export function getIntlDateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = 'dtf|' + hashKey([locale, options.dateStyle, options.timeStyle, options.year, options.month, options.day, options.hour, options.minute, options.second, options.hour12, options.weekday, options.timeZone]);
  let cached = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    cache.set(key, cached);
  }
  recordAccess(key);
  return cached;
}

export function getIntlRelativeTimeFormat(locale: string, options: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  const key = 'rtf|' + hashKey([locale, options.numeric, options.style]);
  let cached = cache.get(key) as Intl.RelativeTimeFormat | undefined;
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, options);
    cache.set(key, cached);
  }
  recordAccess(key);
  return cached;
}

export function _resetCache_forTests(): void {
  cache.clear();
  insertionOrder.length = 0;
}
