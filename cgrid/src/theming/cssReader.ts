import type { ColCellOverrides } from '../types';

export interface ResolvedTheme {
  font: string;
  fg: string;
  bg: string;
  headerBg: string;
  headerFg: string;
  borderColor: string;
  gridLineColor: string;
  rowAltBg: string;
  rowHoverBg: string;
  rowSelectedBg: string;
  focusRingColor: string;
  focusRingWidth: number;
  flashFromColor: string;
  flashToColor: string;
  /** Cycle 7 / Task 7 — background fill applied behind any cell whose
   *  value contains an active quick-filter term. Resolved from
   *  `--cg-quick-filter-match-bg`. */
  quickFilterMatchBg: string;
  rowHeight: number;
  headerHeight: number;
  resizerHotZone: number;
  scrollbarThickness: number;
  /**
   * Map of class-name → ColCellOverrides patch. Populated from CSS custom
   * properties matching `--cg-cell-class-<name>-(bg|fg|font|halign)`.
   * Cycle 6 / Task 7.
   */
  cellClassVariants: Map<string, ColCellOverrides>;
  /**
   * Same as `cellClassVariants` but for `--cg-header-class-<name>-*` variables.
   * Cycle 6 / Task 7.
   */
  headerClassVariants: Map<string, ColCellOverrides>;
}

/**
 * Scan `document.styleSheets` for CSS custom properties matching
 * `--cg-cell-class-<name>-(bg|fg|font|halign)` and
 * `--cg-header-class-<name>-(bg|fg|font|halign)`.
 *
 * Returns two Maps: one for cell variants, one for header variants.
 * Cross-origin stylesheets that throw on `.cssRules` are silently skipped.
 */
function scanVariantVariables(): {
  cellClassVariants: Map<string, ColCellOverrides>;
  headerClassVariants: Map<string, ColCellOverrides>;
} {
  const cellMap = new Map<string, ColCellOverrides>();
  const headerMap = new Map<string, ColCellOverrides>();

  const CELL_RE = /^--cg-cell-class-([a-zA-Z0-9_-]+)-(bg|fg|font|halign)$/;
  const HEADER_RE = /^--cg-header-class-([a-zA-Z0-9_-]+)-(bg|fg|font|halign)$/;

  // Walk every stylesheet in the document.
  const sheets = Array.from(document.styleSheets);
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheet — skip.
      continue;
    }
    if (!rules) continue;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      // Only examine style rules (not @media, @keyframes, etc.)
      if (!(rule instanceof CSSStyleRule)) continue;
      const style = rule.style;
      for (let j = 0; j < style.length; j++) {
        const prop = style[j]!;
        const cellMatch = CELL_RE.exec(prop);
        if (cellMatch) {
          const name = cellMatch[1]!;
          const slot = cellMatch[2]!;
          const value = style.getPropertyValue(prop).trim();
          if (!value) continue;
          const overrides = cellMap.get(name) ?? {};
          (overrides as Record<string, string>)[slot] = value;
          cellMap.set(name, overrides);
          continue;
        }
        const headerMatch = HEADER_RE.exec(prop);
        if (headerMatch) {
          const name = headerMatch[1]!;
          const slot = headerMatch[2]!;
          const value = style.getPropertyValue(prop).trim();
          if (!value) continue;
          const overrides = headerMap.get(name) ?? {};
          (overrides as Record<string, string>)[slot] = value;
          headerMap.set(name, overrides);
        }
      }
    }
  }

  return { cellClassVariants: cellMap, headerClassVariants: headerMap };
}

export class CssReader {
  constructor(private container: HTMLElement) {}

  read(): ResolvedTheme {
    const cs = getComputedStyle(this.container);
    const get = (name: string) => cs.getPropertyValue(name).trim();
    const px = (name: string, fallback: number) => {
      const v = parseFloat(get(name));
      return Number.isFinite(v) ? v : fallback;
    };

    const fontSize = get('--cg-font-size') || '13px';
    const fontFamily = get('--cg-font-family') || 'system-ui';

    const { cellClassVariants, headerClassVariants } = scanVariantVariables();

    return {
      font: `${fontSize} ${fontFamily}`,
      fg: get('--cg-fg-color') || '#1a1f24',
      bg: get('--cg-bg-color') || '#ffffff',
      headerBg: get('--cg-header-bg') || '#e8ecef',
      headerFg: get('--cg-header-fg') || '#1a1f24',
      borderColor: get('--cg-border-color') || '#d5dbe0',
      gridLineColor: get('--cg-grid-line-color') || '#e8ecef',
      rowAltBg: get('--cg-row-alt-bg') || '#f4f6f8',
      rowHoverBg: get('--cg-row-hover-bg') || '#eef1f3',
      rowSelectedBg: get('--cg-row-selected-bg') || 'rgba(13,148,136,0.12)',
      focusRingColor: get('--cg-focus-ring-color') || '#0d9488',
      focusRingWidth: px('--cg-focus-ring-width', 2),
      flashFromColor: get('--cg-flash-from-color') || '#fef3c7',
      flashToColor: get('--cg-flash-to-color') || 'rgba(254,243,199,0)',
      quickFilterMatchBg: get('--cg-quick-filter-match-bg') || '#fff3b8',
      rowHeight: px('--cg-row-height', 30),
      headerHeight: px('--cg-header-height', 32),
      resizerHotZone: px('--cg-resizer-hot-zone', 4),
      scrollbarThickness: px('--cg-scrollbar-thickness', 10),
      cellClassVariants,
      headerClassVariants,
    };
  }
}
