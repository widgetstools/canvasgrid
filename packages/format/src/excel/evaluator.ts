import type { StyleObj } from '../types';
import type { Token } from '../tokenizer';
import type { ExcelFormatTree, ExcelSection } from './parser';
import { getIntlNumberFormat, getIntlDateTimeFormat } from '../templates/intlCache';

export interface ExcelEvalContext {
  value: unknown;
  locale: string;
  currency: string;
  /** Cycle 21c — Tier 1 `[if <expr>]` section selection. When set (and
   *  in range), overrides the standard sign / `[>N]`-condition routing:
   *  the caller (compileFormat) has already picked the section by
   *  evaluating the if-expressions against the row. */
  forceSectionIndex?: number;
}

export interface ExcelEvalResult {
  text: string;
  style: StyleObj | null;
  iconName: string | null;
  sectionIndex: number;
}

export function evaluateExcel(tree: ExcelFormatTree, ctx: ExcelEvalContext): ExcelEvalResult {
  const forced = ctx.forceSectionIndex;
  const { section, index } =
    forced !== undefined && tree.sections[forced] !== undefined
      ? { section: tree.sections[forced]!, index: forced }
      : selectSection(tree.sections, ctx.value);
  if (!section) return { text: '', style: null, iconName: null, sectionIndex: 0 };

  const style: StyleObj | null = section.namedColor ? { color: section.namedColor } : null;

  if (
    ctx.value === null ||
    ctx.value === undefined ||
    (typeof ctx.value === 'number' && Number.isNaN(ctx.value))
  ) {
    return { text: '', style, iconName: null, sectionIndex: index };
  }

  const text = renderSection(section, ctx);
  return { text, style, iconName: null, sectionIndex: index };
}

function selectSection(
  sections: ExcelSection[],
  value: unknown,
): { section: ExcelSection | null; index: number } {
  if (sections.length === 0) return { section: null, index: 0 };

  // Check whether any section carries an explicit condition.
  const hasAnyCondition = sections.some((s) => s.condition !== undefined);

  if (hasAnyCondition) {
    // Explicit-condition mode: first section whose condition matches wins.
    if (typeof value === 'number') {
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i]!;
        if (s.condition && matchCondition(s.condition, value)) return { section: s, index: i };
      }
    }
    // No condition matched — fall back to the first conditionless section, else sections[0].
    const fallbackIdx = sections.findIndex((s) => s.condition === undefined);
    const idx = fallbackIdx >= 0 ? fallbackIdx : 0;
    return { section: sections[idx] ?? null, index: idx };
  }

  // Standard Excel positive/negative/zero/text routing.
  if (typeof value === 'string') {
    const idx = sections.length > 3 ? 3 : 0;
    return { section: sections[idx] ?? sections[0] ?? null, index: idx };
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return { section: sections[0] ?? null, index: 0 };
  if (n > 0) return { section: sections[0] ?? null, index: 0 };
  if (n < 0) {
    const idx = sections.length > 1 ? 1 : 0;
    return { section: sections[idx] ?? null, index: idx };
  }
  // zero
  const idx = sections.length > 2 ? 2 : 0;
  return { section: sections[idx] ?? null, index: idx };
}

function matchCondition(
  cond: { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number },
  v: number,
): boolean {
  switch (cond.op) {
    case '>':  return v > cond.value;
    case '<':  return v < cond.value;
    case '<=': return v <= cond.value;
    case '>=': return v >= cond.value;
    case '=':  return v === cond.value;
    case '<>': return v !== cond.value;
  }
}

function renderSection(section: ExcelSection, ctx: ExcelEvalContext): string {
  const tokens = section.tokens;
  const kind = classifyTokens(tokens);

  if (kind === 'text') {
    if (typeof ctx.value === 'string') return ctx.value;
    return String(ctx.value ?? '');
  }

  if (kind === 'general') {
    return String(ctx.value ?? '');
  }

  if (kind === 'literal-only') {
    return literalsOnly(tokens);
  }

  if (kind === 'date') {
    const date = coerceDate(ctx.value);
    if (!date) return '';
    return formatDate(tokens, date, ctx.locale);
  }

  if (kind === 'number' || kind === 'currency' || kind === 'percent') {
    const n = coerceNumber(ctx.value);
    if (n === null) return '';
    return formatNumber(tokens, n, kind, ctx);
  }

  // Fallback
  return literalsOnly(tokens);
}

type SectionKind = 'number' | 'currency' | 'percent' | 'date' | 'text' | 'general' | 'literal-only';

function classifyTokens(tokens: Token[]): SectionKind {
  // Single '@' token → text passthrough
  if (tokens.length === 1 && tokens[0]?.kind === 'literal' && tokens[0].text === '@') return 'text';

  // Detect 'General': appears as a mix of literals + a 'n' date-token (from tokenizer).
  // More robustly: reconstruct raw text and check.
  const rawText = tokens
    .map((t) => {
      if (t.kind === 'literal') return t.text;
      if (t.kind === 'date-token') return t.token;
      if (t.kind === 'quoted') return `"${t.text}"`;
      return '';
    })
    .join('');
  if (rawText.toLowerCase() === 'general') return 'general';

  // Any numeric format tokens present?
  const hasNumericTokens = tokens.some(
    (t) =>
      t.kind === 'digit-placeholder' ||
      t.kind === 'group-separator' ||
      t.kind === 'decimal-point' ||
      t.kind === 'percent' ||
      t.kind === 'exponent',
  );

  // Any date-token present?
  const hasDateToken = tokens.some((t) => t.kind === 'date-token');

  if (!hasNumericTokens && !hasDateToken) {
    // Pure literal / quoted / escape section — render as-is.
    return 'literal-only';
  }

  if (hasDateToken && !hasNumericTokens) return 'date';
  if (tokens.some((t) => t.kind === 'percent')) return 'percent';
  if (tokens.some((t) => t.kind === 'literal' && /[$€£¥]/.test(t.text))) return 'currency';
  return 'number';
}

// ─── Date formatting ───────────────────────────────────────────────────────────

function formatDate(tokens: Token[], date: Date, locale: string): string {
  // Build format options from the date tokens and use Intl to get each part,
  // then reconstruct the string in the original token order (preserving literals).

  // Detect which date parts are present to determine ambiguity.
  const hasHour = tokens.some((t) => t.kind === 'date-token' && /^h+$/i.test(t.token));
  const hasYear = tokens.some((t) => t.kind === 'date-token' && /^y+$/i.test(t.token));
  const hasDay = tokens.some((t) => t.kind === 'date-token' && /^d+$/i.test(t.token));

  // Format token by token to preserve separators and token order.
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'literal') {
      parts.push(t.text);
    } else if (t.kind === 'quoted') {
      parts.push(t.text);
    } else if (t.kind === 'escape') {
      parts.push(t.char);
    } else if (t.kind === 'date-token') {
      parts.push(formatDateToken(t.token, date, locale, hasHour, hasYear, hasDay));
    }
    // Other token types ignored in date context
  }
  return parts.join('');
}

function formatDateToken(
  token: string,
  date: Date,
  locale: string,
  hasHour: boolean,
  hasYear: boolean,
  hasDay: boolean,
): string {
  const lc = token.toLowerCase();

  // Year
  if (/^y+$/i.test(token)) {
    const year = date.getUTCFullYear();
    return token.length >= 4 ? String(year) : String(year).slice(-2).padStart(2, '0');
  }

  // Month (m/mm/mmm/mmmm) — ambiguous with minutes; treat as month when year or day present,
  // or when not in a time-only context.
  if (/^m+$/i.test(token)) {
    const isMinutes = hasHour && !hasYear && !hasDay;
    if (isMinutes) {
      const min = date.getUTCMinutes();
      return token.length >= 2 ? String(min).padStart(2, '0') : String(min);
    }
    // Month
    const month = date.getUTCMonth(); // 0-based
    const len = token.length;
    if (len >= 4) {
      return getIntlDateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(date);
    }
    if (len === 3) {
      return getIntlDateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date);
    }
    // mm or m
    return len >= 2 ? String(month + 1).padStart(2, '0') : String(month + 1);
  }

  // Day (d/dd/ddd/dddd)
  if (/^d+$/i.test(token)) {
    const len = token.length;
    if (len >= 4) {
      return getIntlDateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date);
    }
    if (len === 3) {
      return getIntlDateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date);
    }
    const day = date.getUTCDate();
    return len >= 2 ? String(day).padStart(2, '0') : String(day);
  }

  // Hour (h/hh)
  if (/^h+$/i.test(token)) {
    const hour = date.getUTCHours();
    return token.length >= 2 ? String(hour).padStart(2, '0') : String(hour);
  }

  // Minutes — nn/n (unambiguous minutes)
  if (/^n+$/i.test(token)) {
    const min = date.getUTCMinutes();
    return token.length >= 2 ? String(min).padStart(2, '0') : String(min);
  }

  // Seconds (s/ss)
  if (/^s+$/i.test(token)) {
    const sec = date.getUTCSeconds();
    return token.length >= 2 ? String(sec).padStart(2, '0') : String(sec);
  }

  // AM/PM
  if (lc === 'am/pm') {
    return date.getUTCHours() < 12 ? 'AM' : 'PM';
  }

  return token;
}

// ─── Number formatting ─────────────────────────────────────────────────────────

function formatNumber(
  tokens: Token[],
  n: number,
  kind: SectionKind,
  ctx: ExcelEvalContext,
): string {
  if (kind === 'percent') {
    const options = deriveNumberOptions(tokens, kind, ctx.currency);
    const nf = getIntlNumberFormat(ctx.locale, options);
    return nf.format(n); // Intl 'percent' ×100 and appends %
  }

  if (kind === 'currency') {
    // Currency: Intl handles the symbol. Extract frac digits from tokens.
    const options = deriveNumberOptions(tokens, kind, ctx.currency);
    const nf = getIntlNumberFormat(ctx.locale, options);
    return nf.format(n);
  }

  const expTok = tokens.find((t) => t.kind === 'exponent');
  if (expTok && expTok.kind === 'exponent') {
    return formatScientific(tokens, expTok, n);
  }

  // Plain number.
  // Split at the first numeric-format token boundary to get literal prefix/suffix.
  // Use Math.abs so the sign is handled by Intl (which prepends '-' for negatives),
  // except when the literal '-' is BEFORE the number tokens (explicit sign in format).
  // In Excel, the literal '-' in the negative section IS the visual minus; Intl would
  // double-add it when formatting a negative value. So we format abs(n) and let the
  // literal prefix supply the sign character.
  const hasExplicitSign = hasLiteralSignPrefix(tokens);
  const options = deriveNumberOptions(tokens, kind, ctx.currency);
  const nf = getIntlNumberFormat(ctx.locale, options);
  const absVal = hasExplicitSign ? Math.abs(n) : n;
  const literalPrefix = extractLiteralPrefix(tokens);
  const literalSuffix = extractLiteralSuffix(tokens);
  return literalPrefix + nf.format(absVal) + literalSuffix;
}

function formatScientific(
  tokens: Token[],
  expTok: { sign: '+' | '-'; digits: number },
  n: number,
): string {
  // Mantissa fraction digits come from the pattern before the exponent.
  const expIdx = tokens.findIndex((t) => t.kind === 'exponent');
  const mantissaTokens = tokens.slice(0, expIdx);
  let frac = 0;
  let sawDecimal = false;
  for (const t of mantissaTokens) {
    if (t.kind === 'decimal-point') sawDecimal = true;
    else if (sawDecimal && t.kind === 'digit-placeholder') frac++;
  }
  const s = n.toExponential(frac); // e.g. "1.23e+3" / "-1.23e-3"
  const m = /^(-?[0-9.]+)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[3]!.padStart(expTok.digits, '0');
  const signStr = m[2] === '-' ? '-' : expTok.sign === '+' ? '+' : '';
  return `${m[1]}E${signStr}${digits}`;
}

/** Returns true when there's a '-' or '+' literal immediately before the first digit-placeholder. */
function hasLiteralSignPrefix(tokens: Token[]): boolean {
  let foundSign = false;
  for (const t of tokens) {
    if (t.kind === 'literal' && (t.text === '-' || t.text === '+')) {
      foundSign = true;
    } else if (
      t.kind === 'digit-placeholder' ||
      t.kind === 'group-separator' ||
      t.kind === 'decimal-point'
    ) {
      return foundSign;
    } else if (t.kind !== 'literal' && t.kind !== 'quoted' && t.kind !== 'escape') {
      // Something else (like a date-token) — not a sign context.
      return false;
    }
  }
  return false;
}

function deriveNumberOptions(
  tokens: Token[],
  kind: SectionKind,
  currency: string,
): Intl.NumberFormatOptions {
  let minFrac = 0;
  let maxFrac = 0;
  let useGrouping = false;
  let sawDecimal = false;

  for (const t of tokens) {
    if (t.kind === 'group-separator') useGrouping = true;
    else if (t.kind === 'decimal-point') sawDecimal = true;
    else if (sawDecimal && t.kind === 'digit-placeholder') {
      if (t.char === '0') { minFrac++; maxFrac++; }
      else if (t.char === '#' || t.char === '?') maxFrac++;
    }
  }

  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
    useGrouping,
  };

  if (kind === 'currency') {
    options.style = 'currency';
    options.currency = currency;
    if (minFrac === 0 && maxFrac === 0) {
      options.minimumFractionDigits = 2;
      options.maximumFractionDigits = 2;
    }
  } else if (kind === 'percent') {
    options.style = 'percent';
  }

  return options;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function extractLiteralPrefix(tokens: Token[]): string {
  let out = '';
  for (const t of tokens) {
    if (t.kind === 'literal' || t.kind === 'quoted' || t.kind === 'escape') {
      out += t.kind === 'escape' ? t.char : t.text;
    } else if (
      t.kind === 'digit-placeholder' ||
      t.kind === 'group-separator' ||
      t.kind === 'decimal-point' ||
      t.kind === 'percent'
    ) {
      break;
    }
  }
  return out;
}

function extractLiteralSuffix(tokens: Token[]): string {
  let out = '';
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (!t) continue;
    if (t.kind === 'literal' || t.kind === 'quoted' || t.kind === 'escape') {
      out = (t.kind === 'escape' ? t.char : t.text) + out;
    } else if (
      t.kind === 'digit-placeholder' ||
      t.kind === 'group-separator' ||
      t.kind === 'decimal-point' ||
      t.kind === 'percent'
    ) {
      break;
    }
  }
  return out;
}

function literalsOnly(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (t.kind === 'literal' || t.kind === 'quoted') return t.text;
      if (t.kind === 'escape') return t.char;
      return '';
    })
    .join('');
}
