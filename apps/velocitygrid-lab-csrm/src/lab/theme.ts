/**
 * Grid themes the lab can mount. The lab's own chrome is graphite and
 * dark-first, so the dark themes are listed first and one of them is the
 * default — but the light themes are here because "does it work in light?" is
 * a question every evaluator asks, and answering it should not need a rebuild.
 */
export const GRID_THEMES = [
  { id: 'vg-theme-cursor-dark', label: 'Cursor dark' },
  { id: 'vg-theme-quartz-dark', label: 'Quartz dark' },
  { id: 'vg-theme-starui-dark', label: 'StarUI dark' },
  { id: 'vg-theme-high-contrast-dark', label: 'High contrast' },
  { id: 'vg-theme-cursor', label: 'Cursor light' },
  { id: 'vg-theme-quartz', label: 'Quartz light' },
  { id: 'vg-theme-starui', label: 'StarUI light' },
] as const;

export type GridThemeId = (typeof GRID_THEMES)[number]['id'];
export const DEFAULT_THEME: GridThemeId = 'vg-theme-cursor-dark';
