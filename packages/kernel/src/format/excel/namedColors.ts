// Excel named-color table. Hex values chosen to match Excel 2007+ / LibreOffice
// defaults — EXCEPT Red/Green, which defer to the theme's semantic negative/
// positive tokens (teal / orange-red, mode-tuned per theme — see the pair's
// note in theming/tokens.css). A `[Green]#,##0;[Red]-#,##0` on a P&L column
// is the same up/down reading as the tick flash beside it, so it takes the
// same two colours rather than a literal green and red. The kernel's paint
// chain resolves `var(--vg-…)` refs in the fg channel; the hex fallbacks
// cover headless/unthemed renders.
export const EXCEL_NAMED_COLORS: Readonly<Record<string, string>> = Object.freeze({
  Black:   '#000000',
  White:   '#FFFFFF',
  Red:     'var(--vg-neg-color, #FF7043)',
  Green:   'var(--vg-pos-color, #14B8A6)',
  Blue:    '#1E88E5',
  Yellow:  '#FDD835',
  Cyan:    '#00ACC1',
  Magenta: '#D81B60',
});

/** Case-insensitive lookup that mirrors Excel's `[red]` = `[Red]` behavior. */
export function lookupNamedColor(name: string): string | null {
  const canon = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return EXCEL_NAMED_COLORS[canon] ?? null;
}
