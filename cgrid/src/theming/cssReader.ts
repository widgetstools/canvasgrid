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
  /** Cycle 8 / Task 5 — color for the faint chevron pair that the
   *  header painter draws on sortable columns whose `unSortIcon` is set
   *  but which aren't currently sorted. Resolved from
   *  `--cg-unsort-icon-color`. Falls back to a 40%-alpha headerFg when
   *  the variable isn't declared. */
  unsortIconColor: string;
  /** Cycle 9 / Task 3 — translucent wash painted behind each active
   *  cell-range selection. Resolved from `--cg-range-fill-color`. */
  rangeFillColor: string;
  /** Cycle 9 / Task 3 — opaque border drawn around each active
   *  cell-range selection rect. Resolved from `--cg-range-border-color`. */
  rangeBorderColor: string;
  /** Cycle 14 / Task 1 — totals (grand-total) row background. The 3%
   *  slate tint over body bg that gives the row its "lift". Painted by
   *  the row-bg pass for any `isTotals` row. Resolved from
   *  `--cg-totals-bg`. Design plan: cycle-14-aggregation-design.md. */
  totalsBg: string;
  /** Cycle 14 / Task 1 — totals row foreground. One stop darker than
   *  body fg (light) / one stop brighter (dark) so the +1 weight stop
   *  carries the lift. Resolved from `--cg-totals-fg`. */
  totalsFg: string;
  /** Cycle 14 / Task 1 — totals row top border colour. A hairline
   *  weighted between `gridLineColor` and `borderColor` so it reads as
   *  the row's only visual lift. Painted as a 1px `fillRect` at
   *  `Math.round(row.top) - 1` by `gridLinesPainter`. Resolved from
   *  `--cg-totals-border-top`. */
  totalsBorderTop: string;
  /** Cycle 14 / Task 1 — muted foreground used by the Task 5 polished
   *  `'totals'` renderer for the empty-cell em-dash and the label
   *  column (when present). Resolved from `--cg-totals-fg-muted`. */
  totalsFgMuted: string;
  /** Cycle 14 / Task 1 — font-weight for totals cells. Body is `400`;
   *  totals is `500` (+1 stop only — the row's lift comes from the
   *  rule above + tint, NOT from typography inflation). Substituted
   *  into the cell's `font` string when the row is `isTotals`.
   *  Resolved from `--cg-totals-font-weight`. */
  totalsFontWeight: number;
  /** Cycle 14 / Task 2 — pinned-row background. Warm 3-5% tint over
   *  body bg that gives static pinned rows their "anchored" reading
   *  (vs the cool slate `totalsBg` which reads "computed"). Painted by
   *  the row-bg pass for any `isPinned` row. Resolved from
   *  `--cg-pinned-row-bg`. Design plan:
   *  `docs/superpowers/plans/notes/cycle-14-aggregation-design.md`
   *  § Task 2. */
  pinnedRowBg: string;
  /** Cycle 14 / Task 2 — pinned-row foreground. Inherits body fg (no
   *  +1 stop) — the +1 weight is reserved for synthesis (totals).
   *  Resolved from `--cg-pinned-row-fg`. */
  pinnedRowFg: string;
  /** Cycle 14 / Task 2 — pinned-row structural border at the body-side
   *  edge of the pinned stack. CSS-aliased to `--cg-totals-border-top`
   *  so the boundary between "scrolling body" and "everything else" is
   *  a SINGLE color source — pinned and totals share the same body-edge
   *  hairline. Resolved from `--cg-pinned-row-border`. */
  pinnedRowBorder: string;
  /** Cycle 15 / Task 4 — chevron color for the auto-group column's
   *  group rows. Aliased to `--cg-totals-fg-muted` in the shipped
   *  themes — the muted slate the totals renderer uses for empty
   *  placeholders. The painter additionally honours the column's
   *  resolved `fg` if this token isn't declared (defensive). Resolved
   *  from `--cg-group-chevron-color`. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   *  § Task 4. */
  groupChevronColor: string;
  /** Cycle 15 / Task 4 — `(count)` suffix color for the auto-group
   *  column's group rows. Same muted slate family as `groupChevronColor`
   *  by default; the count is metadata, visually subordinate to the
   *  value. Resolved from `--cg-group-count-color`. */
  groupCountColor: string;
  /** Cycle 15 / Task 4 — indent unit in CSS px. One chevron-width per
   *  depth level so the chevron "stacks" cleanly under nested groups.
   *  Resolved from `--cg-group-indent`. Defaults to `14` (the design
   *  plan's canonical chevron width) when the variable isn't declared. */
  groupIndent: number;
  /** Cycle 15 / Task 4 — row-bg shift applied to group rows ONLY in
   *  `'groupRows'` mode (and the `'custom'` fallback path). Subtle slate
   *  cast — far lighter than the totals "hairline lift" (which is
   *  reserved for synthesis rows in Task 12) so the strip reads as a
   *  navigational marker, not as a computed summary. Resolved from
   *  `--cg-group-row-bg`. Falls back to `--cg-row-alt-bg` when the
   *  variable isn't declared (defensive — the strip still needs SOME
   *  contrast against data rows). Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   *  § Task 5. */
  groupRowBg: string;
  /** Cycle 15 / Task 8 — tri-state checkbox tokens for the auto-group
   *  column's group rows. All four default to `var(--cg-fg-color)` so
   *  the box reads exactly like the existing `checkboxCell` painter
   *  (one checkbox vocabulary across the grid). Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   *  § Task 8. */
  groupCheckboxBorderColor: string;
  groupCheckboxCheckColor: string;
  groupCheckboxIndeterminateColor: string;
  /** `'transparent'` (default) renders the outlined-only box; any
   *  other valid CSS color fills the box before the border + interior
   *  glyph paint. Apps that want a filled brand-accent checkbox
   *  override `--cg-group-checkbox-fill` + `--cg-group-checkbox-check-color`
   *  together. */
  groupCheckboxFill: string;
  /** Cycle 15 / Task 12 — per-group footer row background. Inherits the
   *  totals tint (`--cg-totals-bg`) by default so a grouped grid reads
   *  with one synthesis vocabulary across per-group footers and the
   *  grand-total row. Apps that want to dial the footer down to a
   *  lighter tint override `--cg-group-footer-bg` independently of
   *  `--cg-totals-bg`. Resolved from `--cg-group-footer-bg`. */
  groupFooterBg: string;
  /** Cycle 15 / Task 12 — per-group footer row foreground. Defaults to
   *  `--cg-totals-fg`. Used by `applyCellProps` when `isGroupFooter ===
   *  true`. */
  groupFooterFg: string;
  /** Cycle 15 / Task 12 — per-group footer row top hairline rule color.
   *  Defaults to `--cg-totals-border-top`. Painted by `gridLinesPainter`
   *  above any row whose `chunk.rowKinds[i] === 3`. */
  groupFooterBorderTop: string;
  /** Cycle 15 / Task 12 — per-group footer row font weight. Defaults
   *  to the totals weight (500) so footers and grand totals carry the
   *  same +1 weight stop. Apps that want a lighter footer (e.g. 450)
   *  override independently. */
  groupFooterFontWeight: number;
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
      unsortIconColor: get('--cg-unsort-icon-color') || 'rgba(0, 0, 0, 0.4)',
      rangeFillColor: get('--cg-range-fill-color') || 'rgba(59, 130, 246, 0.22)',
      rangeBorderColor: get('--cg-range-border-color') || '#3b82f6',
      totalsBg: get('--cg-totals-bg') || '#f7f9fb',
      totalsFg: get('--cg-totals-fg') || '#0f172a',
      totalsBorderTop: get('--cg-totals-border-top') || '#cbd5e1',
      totalsFgMuted: get('--cg-totals-fg-muted') || '#475569',
      totalsFontWeight: px('--cg-totals-font-weight', 500),
      pinnedRowBg: get('--cg-pinned-row-bg') || '#fbf8f3',
      pinnedRowFg: get('--cg-pinned-row-fg') || get('--cg-fg-color') || '#1a1f24',
      pinnedRowBorder: get('--cg-pinned-row-border') || get('--cg-totals-border-top') || '#cbd5e1',
      groupChevronColor: get('--cg-group-chevron-color') || get('--cg-totals-fg-muted') || '#475569',
      groupCountColor: get('--cg-group-count-color') || get('--cg-totals-fg-muted') || '#475569',
      groupIndent: px('--cg-group-indent', 14),
      groupRowBg: get('--cg-group-row-bg') || get('--cg-row-alt-bg') || '#f1f5f9',
      groupCheckboxBorderColor: get('--cg-group-checkbox-border-color') || get('--cg-fg-color') || '#1a1f24',
      groupCheckboxCheckColor: get('--cg-group-checkbox-check-color') || get('--cg-fg-color') || '#1a1f24',
      groupCheckboxIndeterminateColor:
        get('--cg-group-checkbox-indeterminate-color') || get('--cg-fg-color') || '#1a1f24',
      groupCheckboxFill: get('--cg-group-checkbox-fill') || 'transparent',
      groupFooterBg: get('--cg-group-footer-bg') || get('--cg-totals-bg') || '#f7f9fb',
      groupFooterFg: get('--cg-group-footer-fg') || get('--cg-totals-fg') || '#0f172a',
      groupFooterBorderTop: get('--cg-group-footer-border-top') || get('--cg-totals-border-top') || '#cbd5e1',
      groupFooterFontWeight: px('--cg-group-footer-font-weight', px('--cg-totals-font-weight', 500)),
      rowHeight: px('--cg-row-height', 30),
      headerHeight: px('--cg-header-height', 32),
      resizerHotZone: px('--cg-resizer-hot-zone', 4),
      scrollbarThickness: px('--cg-scrollbar-thickness', 10),
      cellClassVariants,
      headerClassVariants,
    };
  }
}
