/**
 * Format-picker catalog — pure data + logic (no DOM). Ported from starui's
 * FormatterPicker and recast so EVERY preset is a plain @wellsfargo-starui/velocity-grid-format DSL
 * string: excel sections, TICK* tokens (Task 1), 0.00E+00 (Task 2), and
 * `=expr` value formatters (Tasks 3-4). Sidebar counts are full category
 * sizes (reference behavior), independent of the active data type.
 */
export type FormatDataType = 'number' | 'text' | 'date' | 'boolean';
export type FormatCategory =
  | 'number' | 'currency' | 'percent' | 'negatives' | 'conditional'
  | 'date' | 'tick' | 'text' | 'boolean';

export interface FormatPreset {
  id: string;
  category: FormatCategory;
  label: string;
  hint?: string;
  format: string;
  sample?: unknown;
}

export const CATEGORY_LABELS: Record<FormatCategory, string> = {
  number: 'Number', currency: 'Currency', percent: 'Percent',
  negatives: 'Negatives & P&L', conditional: 'Conditional',
  date: 'Date & time', tick: 'Tick', text: 'Text', boolean: 'Boolean',
};

export function categoriesForDataType(dt: FormatDataType): FormatCategory[] {
  switch (dt) {
    case 'number': return ['number', 'currency', 'negatives', 'conditional', 'tick', 'percent'];
    case 'date': return ['date'];
    case 'text': return ['text'];
    case 'boolean': return ['boolean', 'text'];
    default: return ['number'];
  }
}

const PRESETS: FormatPreset[] = [
  // ── Number (6)
  { id: 'num-integer', category: 'number', label: 'Integer', format: '#,##0' },
  { id: 'num-2dp', category: 'number', label: '2 decimals', format: '#,##0.00' },
  { id: 'num-4dp', category: 'number', label: '4 decimals', format: '#,##0.0000' },
  { id: 'num-plain', category: 'number', label: 'No thousands', format: '0.00' },
  { id: 'num-sci', category: 'number', label: 'Scientific', format: '0.00E+00' },
  { id: 'num-bps', category: 'number', label: 'Basis points', hint: '+12.3 bp',
    format: '=([value] >= 0 ? "+" : "") + FIXED([value] * 10000, 1) + " bp"', sample: 0.001234 },
  // ── Negatives & P&L (5)
  { id: 'neg-parens', category: 'negatives', label: 'Parens negative', format: '#,##0.00;(#,##0.00)' },
  { id: 'neg-red-parens', category: 'negatives', label: 'Red parens neg', format: '#,##0.00;[Red](#,##0.00)' },
  { id: 'neg-red', category: 'negatives', label: 'Red negative', format: '#,##0.00;[Red]#,##0.00' },
  { id: 'neg-green-red', category: 'negatives', label: 'Green / Red (no sign)', format: '[Green]#,##0.00;[Red]#,##0.00' },
  { id: 'neg-green-red-usd', category: 'negatives', label: 'Green / Red $ (no sign)', format: '[Green]$#,##0.00;[Red]$#,##0.00' },
  // ── Conditional (2)
  { id: 'cond-arrows', category: 'conditional', label: 'Green up / red down',
    format: '[>0][Green]▲0.00;[<0][Red]▼0.00;0.00', sample: -12.5 },
  { id: 'cond-thresholds', category: 'conditional', label: 'Thresholds (100)',
    format: '[>100][Red]0;[<=100][Green]0;0', sample: 142 },
  // ── Tick (5)
  { id: 'tick-32', category: 'tick', label: '32nds (bond price)', hint: 'denom 32', format: 'TICK32', sample: 101.5 },
  { id: 'tick-32-plus', category: 'tick', label: '32nds + halves', hint: 'denom 32+', format: 'TICK32+', sample: 101.515625 },
  { id: 'tick-64', category: 'tick', label: '64ths', hint: 'denom 64', format: 'TICK64', sample: 101.515625 },
  { id: 'tick-128', category: 'tick', label: '128ths', hint: 'denom 128', format: 'TICK128', sample: 101.5078125 },
  { id: 'tick-256', category: 'tick', label: '256ths', hint: 'denom 256', format: 'TICK256', sample: 101.50390625 },
  // ── Percent (3)
  { id: 'pct-0', category: 'percent', label: 'Percent (0dp)', format: '0%', sample: 0.12 },
  { id: 'pct-2', category: 'percent', label: 'Percent (2dp)', format: '0.00%', sample: 0.1234 },
  { id: 'pct-bps', category: 'percent', label: 'Basis points', hint: '+12.3 bp',
    format: '=([value] >= 0 ? "+" : "") + FIXED([value] * 10000, 1) + " bp"', sample: 0.001234 },
  // ── Currency (12)
  { id: 'cur-usd', category: 'currency', label: 'USD', format: '$#,##0.00' },
  { id: 'cur-usd-parens', category: 'currency', label: 'USD parens neg', format: '$#,##0.00;($#,##0.00)' },
  { id: 'cur-usd-red', category: 'currency', label: 'USD red negative', format: '$#,##0.00;[Red]-$#,##0.00' },
  { id: 'cur-usd-0dp', category: 'currency', label: 'USD (0dp)', format: '$#,##0' },
  { id: 'cur-eur', category: 'currency', label: 'EUR', format: '€#,##0.00' },
  { id: 'cur-eur-parens', category: 'currency', label: 'EUR parens neg', format: '€#,##0.00;(€#,##0.00)' },
  { id: 'cur-gbp', category: 'currency', label: 'GBP', format: '"£"#,##0.00' },
  { id: 'cur-gbp-parens', category: 'currency', label: 'GBP parens neg', format: '"£"#,##0.00;("£"#,##0.00)' },
  { id: 'cur-jpy', category: 'currency', label: 'JPY (0dp)', format: '"¥"#,##0' },
  { id: 'cur-inr', category: 'currency', label: 'INR', format: '"₹"#,##0.00' },
  { id: 'cur-chf', category: 'currency', label: 'CHF', format: '"CHF "#,##0.00' },
  { id: 'cur-chf-parens', category: 'currency', label: 'CHF parens neg', format: '"CHF "#,##0.00;("CHF "#,##0.00)' },
  // ── Date & time (6)
  { id: 'date-iso', category: 'date', label: 'ISO (yyyy-mm-dd)', format: 'yyyy-mm-dd' },
  { id: 'date-us', category: 'date', label: 'US (mm/dd/yyyy)', format: 'mm/dd/yyyy' },
  { id: 'date-eu', category: 'date', label: 'EU (dd-mmm-yy)', format: 'dd-mmm-yy' },
  { id: 'date-long', category: 'date', label: 'Long', format: 'dd mmmm yyyy' },
  { id: 'date-iso-time', category: 'date', label: 'ISO with time', format: 'yyyy-mm-dd hh:nn:ss' },
  { id: 'date-us-short', category: 'date', label: 'US short', format: 'mm/dd/yy h:nn AM/PM' },
  // ── Text (9)
  { id: 'str-default', category: 'text', label: 'Default (pass-through)', format: '@' },
  { id: 'str-upper', category: 'text', label: 'UPPERCASE', format: '=UPPER([value])' },
  { id: 'str-lower', category: 'text', label: 'lowercase', format: '=LOWER([value])' },
  { id: 'str-title', category: 'text', label: 'Title Case', format: '=TITLE([value])' },
  { id: 'str-camel', category: 'text', label: 'camelCase', format: '=CAMEL([value])' },
  { id: 'str-cap', category: 'text', label: 'Capitalize first', format: '=CAP([value])' },
  { id: 'str-trim', category: 'text', label: 'Trim whitespace', format: '=TRIM([value])', sample: '  sample  ' },
  { id: 'str-prefix-px', category: 'text', label: 'Prefix: PX', format: '"PX "@' },
  { id: 'str-suffix-units', category: 'text', label: 'Suffix: units', format: '@" units"' },
  // ── Boolean (3)
  { id: 'bool-yn', category: 'boolean', label: 'Y / N', format: '=[value] ? "Y" : "N"', sample: true },
  { id: 'bool-truefalse', category: 'boolean', label: 'True / False', format: '=[value] ? "True" : "False"', sample: true },
  { id: 'bool-check', category: 'boolean', label: 'Check / —', format: '=[value] ? "✓" : "—"', sample: true },
];

export function presetsForCategory(cat: FormatCategory): FormatPreset[] {
  return PRESETS.filter((p) => p.category === cat);
}
export function presetsForDataType(dt: FormatDataType): FormatPreset[] {
  return categoriesForDataType(dt).flatMap(presetsForCategory);
}
export function findPresetByFormat(format: string | undefined): FormatPreset | undefined {
  if (format === undefined) return undefined;
  const f = format.trim();
  return PRESETS.find((p) => p.format === f);
}

export function defaultSampleValue(dt: FormatDataType): unknown {
  switch (dt) {
    case 'date': return new Date('2026-04-17T09:30:00Z');
    case 'text': return 'sample';
    case 'boolean': return true;
    default: return 1234.5678;
  }
}

export function filterPresets(presets: FormatPreset[], query: string): FormatPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return presets.filter((p) =>
    `${p.label} ${p.hint ?? ''} ${p.format}`.toLowerCase().includes(q));
}

export function codeText(format: string): string {
  if (format.trimStart().startsWith('=')) return 'ƒ(x)';
  const tick = /^TICK(32\+?|64|128|256)$/.exec(format.trim());
  if (tick) return `denom ${tick[1]}`;
  return format;
}

const MAX_FORMAT_DECIMALS = 12;

/**
 * Increase/decrease forced decimals (`.0+`) while preserving the rest of the
 * Excel format — currency symbols, `%`, multi-section negatives, colours, etc.
 * Raw / unformatted columns start from `#,##0`. Expression and tick formats
 * are left unchanged (they aren't decimal-place editable this way).
 */
export function adjustFormatDecimals(fmt: string | undefined, delta: number): string {
  if (!delta) return (fmt ?? '').trim() || '#,##0';
  const source = (fmt ?? '').trim();
  if (!source) {
    return delta > 0 ? `#,##0.${'0'.repeat(Math.min(MAX_FORMAT_DECIMALS, delta))}` : '#,##0';
  }
  if (source.startsWith('=') || /^TICK\d/i.test(source)) return source;
  return source.split(';').map((section) => adjustSectionDecimals(section, delta)).join(';');
}

function adjustSectionDecimals(section: string, delta: number): string {
  if (!/[0#?]/.test(section)) return section;

  const m = /\.(0+)/.exec(section);
  if (m && m.index !== undefined) {
    const cur = m[1]!.length;
    const next = Math.max(0, Math.min(MAX_FORMAT_DECIMALS, cur + delta));
    if (next === cur) return section;
    if (next === 0) {
      return section.slice(0, m.index) + section.slice(m.index + m[0].length);
    }
    return section.slice(0, m.index) + '.' + '0'.repeat(next) + section.slice(m.index + m[0].length);
  }

  if (delta <= 0) return section;

  // No `.0+` yet — insert after the last digit placeholder, skipping quotes / [] .
  let insertAt = -1;
  for (let i = 0; i < section.length; i++) {
    const c = section[i]!;
    if (c === '"') {
      i++;
      while (i < section.length && section[i] !== '"') i++;
      continue;
    }
    if (c === '[') {
      while (i < section.length && section[i] !== ']') i++;
      continue;
    }
    if (c === '0' || c === '#' || c === '?') insertAt = i + 1;
  }
  if (insertAt < 0) return section;
  const n = Math.min(MAX_FORMAT_DECIMALS, delta);
  return section.slice(0, insertAt) + '.' + '0'.repeat(n) + section.slice(insertAt);
}

export const CURRENCY_QUICK_INSERT: ReadonlyArray<{ label: string; symbol: string }> = [
  { label: '$', symbol: '$' },
  { label: '€', symbol: '€' },
  { label: '£', symbol: '"£"' },
  { label: '¥', symbol: '"¥"' },
  { label: '₹', symbol: '"₹"' },
  { label: 'CHF', symbol: '"CHF "' },
];

const CURRENCY_SYMBOL_RE = /("£"|"¥"|"₹"|"[A-Z]{3} ?"|[$€])/g;

export function applyCurrencySymbol(draft: string, symbol: string): string {
  const d = draft.trim();
  if (!d) return `${symbol}#,##0.00`;
  if (CURRENCY_SYMBOL_RE.test(d)) {
    CURRENCY_SYMBOL_RE.lastIndex = 0;
    return d.replace(CURRENCY_SYMBOL_RE, symbol);
  }
  return `${symbol}${d}`;
}

export interface ExcelExample { label: string; format: string; sample: string }
export interface ExcelExampleSection { title: string; rows: ExcelExample[] }

/** Static reference rows — samples are decorative strings, never evaluated.
 *  Tick rows are sentinels (format starts with `—`): informational only,
 *  pointing at the Tick category presets. */
export const EXCEL_EXAMPLES: ExcelExampleSection[] = [
  { title: 'Numbers & decimals', rows: [
    { label: 'Integer w/ thousands', format: '#,##0', sample: '1,235' },
    { label: '2 decimals', format: '#,##0.00', sample: '1,234.57' },
    { label: '4 decimals', format: '#,##0.0000', sample: '1,234.5678' },
    { label: 'No thousands', format: '0.00', sample: '1234.57' },
  ] },
  { title: 'Currency', rows: [
    { label: 'USD', format: '$#,##0.00', sample: '$1,234.57' },
    { label: 'USD parens neg', format: '$#,##0.00;($#,##0.00)', sample: '($1,234.57)' },
    { label: 'USD red negative', format: '$#,##0.00;[Red]-$#,##0.00', sample: '-$1,234.57 (red)' },
    { label: 'EUR', format: '€#,##0.00', sample: '€1,234.57' },
  ] },
  { title: 'Percent & basis points', rows: [
    { label: 'Percent', format: '0.00%', sample: '12.34%' },
    { label: 'Percent (0dp)', format: '0%', sample: '12%' },
    { label: 'Basis points', format: '0.00 "bps"', sample: '12.34 bps' },
  ] },
  { title: 'Negatives in parens / red', rows: [
    { label: 'Parens negative', format: '#,##0.00;(#,##0.00)', sample: '(1,234.57)' },
    { label: 'Red parens', format: '#,##0.00;[Red](#,##0.00)', sample: '(1,234.57)' },
    { label: 'Red only', format: '#,##0.00;[Red]#,##0.00', sample: '[Red]1,234.57' },
    { label: 'Green / Red (no sign)', format: '[Green]#,##0.00;[Red]#,##0.00', sample: '[Green]1,234.57 · [Red]1,234.57' },
    { label: 'Green / Red $ (no sign)', format: '[Green]$#,##0.00;[Red]$#,##0.00', sample: '[Green]$1,234.57 · [Red]$1,234.57' },
    { label: 'Zero as dash', format: '#,##0.00;(#,##0.00);"—"', sample: '—' },
  ] },
  { title: 'Dates & times', rows: [
    { label: 'ISO date', format: 'yyyy-mm-dd', sample: '2026-04-17' },
    { label: 'US date', format: 'mm/dd/yyyy', sample: '04/17/2026' },
    { label: 'Euro short', format: 'dd-mmm-yy', sample: '17-Apr-26' },
    { label: 'ISO with time', format: 'yyyy-mm-dd hh:nn:ss', sample: '2026-04-17 09:30:00' },
    { label: 'US with AM/PM', format: 'mm/dd/yy h:nn AM/PM', sample: '04/17/26 9:30 AM' },
  ] },
  { title: 'Conditional (directional)', rows: [
    { label: 'Green up / red down', format: '[>0][Green]▲0.00;[<0][Red]▼0.00;0.00', sample: '▲ green, ▼ red, neutral' },
    { label: 'Thresholds', format: '[>100][Red]0;[<=100][Green]0;0', sample: 'red >100, green ≤100' },
  ] },
  { title: 'Fixed-income tick (via preset dropdown)', rows: [
    { label: '32nds', format: '— use "32nds" preset —', sample: '101-16' },
    { label: '32nds + halves', format: '— use "32nds + halves" preset —', sample: '101-16+' },
    { label: '64ths', format: '— use "64ths" preset —', sample: '101-164' },
    { label: '128ths', format: '— use "128ths" preset —', sample: '101-162' },
  ] },
  { title: 'Scientific & custom text', rows: [
    { label: 'Scientific', format: '0.00E+00', sample: '1.23E+03' },
    { label: 'Suffix text', format: '@" units"', sample: 'value units' },
    { label: 'Prefix text', format: '"PX "@', sample: 'PX value' },
  ] },
];
