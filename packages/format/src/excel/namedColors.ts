// Excel named-color table. Hex values chosen to match Excel 2007+ / LibreOffice
// defaults — EXCEPT Red/Green, which defer to the theme's semantic negative/
// positive tokens (teal/rose in the StarUI design language, mode-tuned per
// theme). The kernel's paint chain resolves `var(--cg-…)` refs in the fg
// channel; the hex fallbacks keep headless/unthemed renders Excel-faithful.
export const EXCEL_NAMED_COLORS: Readonly<Record<string, string>> = Object.freeze({
  Black:   '#000000',
  White:   '#FFFFFF',
  Red:     'var(--cg-neg-color, #E53935)',
  Green:   'var(--cg-pos-color, #43A047)',
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
