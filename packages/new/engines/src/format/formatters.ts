/** Value formatters — number / currency / percent / date / excel-ish codes. */

export type FormatterFn = (value: unknown) => string;

const intlCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numFmt(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n:${locale}:${JSON.stringify(opts)}`;
  let f = intlCache.get(key) as Intl.NumberFormat | undefined;
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    intlCache.set(key, f);
  }
  return f;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function createNumberFormatter(opts?: {
  digits?: number;
  useGrouping?: boolean;
  locale?: string;
}): FormatterFn {
  const locale = opts?.locale ?? 'en-US';
  const digits = opts?.digits ?? 2;
  const fmt = numFmt(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: opts?.useGrouping ?? true,
  });
  return (value) => {
    const n = toNumber(value);
    return n == null ? '' : fmt.format(n);
  };
}

export function createCurrencyFormatter(opts?: {
  currency?: string;
  digits?: number;
  locale?: string;
}): FormatterFn {
  const locale = opts?.locale ?? 'en-US';
  const fmt = numFmt(locale, {
    style: 'currency',
    currency: opts?.currency ?? 'USD',
    minimumFractionDigits: opts?.digits ?? 2,
    maximumFractionDigits: opts?.digits ?? 2,
  });
  return (value) => {
    const n = toNumber(value);
    return n == null ? '' : fmt.format(n);
  };
}

export function createPercentFormatter(opts?: { digits?: number; locale?: string }): FormatterFn {
  const locale = opts?.locale ?? 'en-US';
  const digits = opts?.digits ?? 2;
  const fmt = numFmt(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (value) => {
    const n = toNumber(value);
    return n == null ? '' : fmt.format(n);
  };
}

export function createDateFormatter(opts?: { locale?: string; dateStyle?: 'short' | 'medium' | 'long' }): FormatterFn {
  const locale = opts?.locale ?? 'en-US';
  const key = `d:${locale}:${opts?.dateStyle ?? 'medium'}`;
  let fmt = intlCache.get(key) as Intl.DateTimeFormat | undefined;
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { dateStyle: opts?.dateStyle ?? 'medium' });
    intlCache.set(key, fmt);
  }
  return (value) => {
    if (value == null || value === '') return '';
    const d = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(d.getTime()) ? '' : fmt!.format(d);
  };
}

/**
 * Compile a format code into a formatter.
 * Supports: `0.00`, `#,##0.00`, `$0.00`, `0%`, `0.00%`, `date`, `currency`, `number`, `percent`.
 */
export function compileFormat(code: string): FormatterFn {
  const c = code.trim().toLowerCase();
  if (c === 'date' || c === 'short date') return createDateFormatter({ dateStyle: 'short' });
  if (c === 'currency' || c === '$' || c.startsWith('$')) {
    const digits = (code.match(/0\.([0]+)/)?.[1]?.length) ?? 2;
    return createCurrencyFormatter({ digits });
  }
  if (c === 'percent' || c.endsWith('%')) {
    const digits = (code.match(/0\.([0]+)/)?.[1]?.length) ?? 2;
    return createPercentFormatter({ digits });
  }
  if (c === 'number' || /[#0]/.test(c)) {
    const digits = (code.match(/0\.([0]+)/)?.[1]?.length) ?? (c.includes('.') ? 2 : 0);
    const useGrouping = c.includes('#') || c.includes(',');
    return createNumberFormatter({ digits, useGrouping });
  }
  // Fallback: string coerce
  return (value) => (value == null ? '' : String(value));
}
