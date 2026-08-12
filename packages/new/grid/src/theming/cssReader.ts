import type {
  ColCellOverrides, Padding, BorderSpec, BorderSide, BorderStyle,
  CellContent, CellDecorator, DecoratorPosition, FontWeight, TextTransform,
} from '../types';

/**
 * Workstream A (2026-07-06 CSS styling model) — compact renderer-palette
 * bundle resolved once per theme swap and threaded onto every
 * `CellPaintConfig` (`applyCellProps` sets `target.palette =
 * theme.rendererPalette`). `@wellsfargo-starui/velocity-grid-renderers` painters resolve colors as
 * `overrides ?? p.palette?.<field> ?? SEMANTIC_COLORS.<field>` — the same
 * shape as the pre-existing per-column `overrides` pattern, just with a
 * theme-driven middle tier — and geometry as `p.palette?.<field> ?? <literal>`.
 *
 * Every field's literal fallback below (used when a theme declares none of
 * the backing tokens) matches `@wellsfargo-starui/velocity-grid-renderers/palette.ts`'s
 * `SEMANTIC_COLORS` map and the bars/badges painter constants (`BAR_H`,
 * `CHIP_H`, chip corner radius) exactly, so a theme that doesn't opt into
 * any of these tokens renders byte-identical to before this bundle existed.
 *
 * Workstream A, part 2 widens this interface with the three specialized
 * maps foreshadowed above: `status` (StatusPill bg/fg/border per order
 * state), `rating` (RatingBadge/RatingClusterCell color per credit-rating
 * grade), and `venue` (VenueChip/NBBOCell color per execution-venue MIC).
 * Same resolve-once-per-theme-swap, byte-identical-fallback pattern as
 * every other field on this interface — see the token-name docs on each
 * field and the `STATUS_STATES`/`RATING_GRADES`/`VENUE_MICS` resolution
 * tables below `read()`.
 */
export interface RendererPalette {
  /** `--vg-pos-color`. */
  positive: string;
  /** `--vg-neg-color`. */
  negative: string;
  /** `--vg-warning-color`. */
  warning: string;
  /** `--vg-info-color`. */
  info: string;
  /** `--vg-muted-color`. */
  muted: string;
  /** `--vg-bar-height` (px). Bars category painters' fixed bar thickness. */
  barHeight: number;
  /** `--vg-chip-height` (px). Badges category painters' pill/chip height. */
  chipHeight: number;
  /** `--vg-chip-radius` (px). Badges category painters' pill/chip corner radius. */
  chipRadius: number;
  /**
   * Workstream A, part 2 — StatusPill's 6 order/fill states. Colors resolve
   * from `--vg-status-<state>-bg` / `-fg` / `-border` (state kebab-cased:
   * `PART_FILL` → `part-fill`). `dashed` is a structural style flag (only
   * `PENDING` is dashed) — it is never sourced from a token, always the
   * exact `@wellsfargo-starui/velocity-grid-renderers/palette.ts` `STATUS_PILL_MAP` literal.
   */
  status: Record<StatusPillState, StatusPillPaletteEntry>;
  /**
   * Workstream A, part 2 — RatingBadge's 24-grade S&P-style ladder
   * (AAA green → D red, NR/WD muted). Resolves from
   * `--vg-rating-<grade>-color` (grade lowercased; `+`/`-` suffixes
   * transliterate to `-plus`/`-minus` so every name is a valid CSS custom
   * property, e.g. `AA+` → `aa-plus`, `BBB-` → `bbb-minus`, `AAA` → `aaa`).
   */
  rating: Record<RatingGrade, string>;
  /**
   * Workstream A, part 2 — VenueChip/NBBOCell's default MIC → color map.
   * Resolves from `--vg-venue-<mic>-color` (mic lowercased, e.g. `XNAS` →
   * `xnas`). Open-ended key set (unlike `status`/`rating`) — mirrors
   * `@wellsfargo-starui/velocity-grid-renderers/palette.ts`'s `DEFAULT_VENUE_PALETTE`'s
   * `Record<string, string>` shape; only the 4 shipped MICs are resolved
   * here (apps that want more venues declare their own `venueColors`
   * param override, which still wins over this palette tier).
   */
  venue: Record<string, string>;
}

/** StatusPill's 6 canonical order/fill states — mirrors
 *  `@wellsfargo-starui/velocity-grid-renderers/palette.ts`'s `STATUS_PILL_MAP` key set exactly. */
export type StatusPillState = 'WORKING' | 'PART_FILL' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'PENDING';

/** A single resolved StatusPill visual. Structurally identical to
 *  `@wellsfargo-starui/velocity-grid-renderers/palette.ts`'s `StatusPillStyle` (duplicated here, not
 *  imported, so `@wellsfargo-starui/velocity-grid` never depends on `@wellsfargo-starui/velocity-grid-renderers`). */
export interface StatusPillPaletteEntry {
  bg: string;
  fg: string;
  border?: string;
  dashed?: boolean;
}

/** RatingBadge's 24-grade S&P-style ladder — mirrors
 *  `@wellsfargo-starui/velocity-grid-renderers/palette.ts`'s `RATING_SCALE_BANDS` key set exactly. */
export type RatingGrade =
  | 'AAA' | 'AA+' | 'AA' | 'AA-' | 'A+' | 'A' | 'A-'
  | 'BBB+' | 'BBB' | 'BBB-' | 'BB+' | 'BB' | 'BB-'
  | 'B+' | 'B' | 'B-' | 'CCC+' | 'CCC' | 'CCC-'
  | 'CC' | 'C' | 'D' | 'NR' | 'WD';

export interface ResolvedTheme {
  /** Chrome font (canvas-painted headers, group cells, totals labels,
   *  side panel / strip / menu chrome via CSS). Resolved from
   *  `--vg-font-family` + `--vg-font-size`. */
  font: string;
  /** Cell font (data cells in the body). Resolved from
   *  `--vg-cell-font-family` + `--vg-font-size`. Defaults to the
   *  chrome font when `--vg-cell-font-family` isn't declared so
   *  themes that haven't migrated keep their current look. */
  cellFont: string;
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
   *  `--vg-quick-filter-match-bg`. */
  quickFilterMatchBg: string;
  /** Cycle 8 / Task 5 — color for the faint chevron pair that the
   *  header painter draws on sortable columns whose `unSortIcon` is set
   *  but which aren't currently sorted. Resolved from
   *  `--vg-unsort-icon-color`. Falls back to a 40%-alpha headerFg when
   *  the variable isn't declared. */
  unsortIconColor: string;
  /** Cycle 9 / Task 3 — translucent wash painted behind each active
   *  cell-range selection. Resolved from `--vg-range-fill-color`. */
  rangeFillColor: string;
  /** Cycle 9 / Task 3 — opaque border drawn around each active
   *  cell-range selection rect. Resolved from `--vg-range-border-color`. */
  rangeBorderColor: string;
  /** Cycle 14 / Task 1 — totals (grand-total) row background. The 3%
   *  slate tint over body bg that gives the row its "lift". Painted by
   *  the row-bg pass for any `isTotals` row. Resolved from
   *  `--vg-totals-bg`. Design plan: cycle-14-aggregation-design.md. */
  totalsBg: string;
  /** Cycle 14 / Task 1 — totals row foreground. One stop darker than
   *  body fg (light) / one stop brighter (dark) so the +1 weight stop
   *  carries the lift. Resolved from `--vg-totals-fg`. */
  totalsFg: string;
  /** Cycle 14 / Task 1 — totals row top border colour. A hairline
   *  weighted between `gridLineColor` and `borderColor` so it reads as
   *  the row's only visual lift. Painted as a 1px `fillRect` at
   *  `Math.round(row.top) - 1` by `gridLinesPainter`. Resolved from
   *  `--vg-totals-border-top`. */
  totalsBorderTop: string;
  /** Cycle 14 / Task 1 — muted foreground used by the Task 5 polished
   *  `'totals'` renderer for the empty-cell em-dash and the label
   *  column (when present). Resolved from `--vg-totals-fg-muted`. */
  totalsFgMuted: string;
  /** Cycle 14 / Task 1 — font-weight for totals cells. Body is `400`;
   *  totals is `500` (+1 stop only — the row's lift comes from the
   *  rule above + tint, NOT from typography inflation). Substituted
   *  into the cell's `font` string when the row is `isTotals`.
   *  Resolved from `--vg-totals-font-weight`. */
  totalsFontWeight: number;
  /** Cycle 14 / Task 2 — pinned-row background. Warm 3-5% tint over
   *  body bg that gives static pinned rows their "anchored" reading
   *  (vs the cool slate `totalsBg` which reads "computed"). Painted by
   *  the row-bg pass for any `isPinned` row. Resolved from
   *  `--vg-pinned-row-bg`. Design plan:
   *  `docs/superpowers/plans/notes/cycle-14-aggregation-design.md`
   *  § Task 2. */
  pinnedRowBg: string;
  /** Cycle 14 / Task 2 — pinned-row foreground. Inherits body fg (no
   *  +1 stop) — the +1 weight is reserved for synthesis (totals).
   *  Resolved from `--vg-pinned-row-fg`. */
  pinnedRowFg: string;
  /** Cycle 14 / Task 2 — pinned-row structural border at the body-side
   *  edge of the pinned stack. CSS-aliased to `--vg-totals-border-top`
   *  so the boundary between "scrolling body" and "everything else" is
   *  a SINGLE color source — pinned and totals share the same body-edge
   *  hairline. Resolved from `--vg-pinned-row-border`. */
  pinnedRowBorder: string;
  /** Cycle 15 / Task 4 — chevron color for the auto-group column's
   *  group rows. Aliased to `--vg-totals-fg-muted` in the shipped
   *  themes — the muted slate the totals renderer uses for empty
   *  placeholders. The painter additionally honours the column's
   *  resolved `fg` if this token isn't declared (defensive). Resolved
   *  from `--vg-group-chevron-color`. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   *  § Task 4. */
  groupChevronColor: string;
  /** Cycle 15 / Task 4 — `(count)` suffix color for the auto-group
   *  column's group rows. Same muted slate family as `groupChevronColor`
   *  by default; the count is metadata, visually subordinate to the
   *  value. Resolved from `--vg-group-count-color`. */
  groupCountColor: string;
  /** Cycle 15 / Task 4 — indent unit in CSS px. One chevron-width per
   *  depth level so the chevron "stacks" cleanly under nested groups.
   *  Resolved from `--vg-group-indent`. Defaults to `14` (the design
   *  plan's canonical chevron width) when the variable isn't declared. */
  groupIndent: number;
  /** Cycle 15 / Task 4 — row-bg shift applied to group rows ONLY in
   *  `'groupRows'` mode (and the `'custom'` fallback path). Subtle slate
   *  cast — far lighter than the totals "hairline lift" (which is
   *  reserved for synthesis rows in Task 12) so the strip reads as a
   *  navigational marker, not as a computed summary. Resolved from
   *  `--vg-group-row-bg`. Falls back to `--vg-row-alt-bg` when the
   *  variable isn't declared (defensive — the strip still needs SOME
   *  contrast against data rows). Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   *  § Task 5. */
  groupRowBg: string;
  /** Cycle 15 / Task 8 — tri-state checkbox tokens for the auto-group
   *  column's group rows. All four default to `var(--vg-fg-color)` so
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
   *  override `--vg-group-checkbox-fill` + `--vg-group-checkbox-check-color`
   *  together. */
  groupCheckboxFill: string;
  /** Cycle 15 / Task 12 — per-group footer row background. Inherits the
   *  totals tint (`--vg-totals-bg`) by default so a grouped grid reads
   *  with one synthesis vocabulary across per-group footers and the
   *  grand-total row. Apps that want to dial the footer down to a
   *  lighter tint override `--vg-group-footer-bg` independently of
   *  `--vg-totals-bg`. Resolved from `--vg-group-footer-bg`. */
  groupFooterBg: string;
  /** Cycle 15 / Task 12 — per-group footer row foreground. Defaults to
   *  `--vg-totals-fg`. Used by `applyCellProps` when `isGroupFooter ===
   *  true`. */
  groupFooterFg: string;
  /** Cycle 15 / Task 12 — per-group footer row top hairline rule color.
   *  Defaults to `--vg-totals-border-top`. Painted by `gridLinesPainter`
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
  /** Cycle 22 / Task 1 — input chrome for floating filters + cell
   *  editors + tool-panel search boxes. The five-token bundle lets
   *  apps theme every text-input surface from one place; defaults
   *  alias to body fg/bg + border so an undeclared theme still reads
   *  inputs as "matches the grid". */
  inputBg: string;
  inputFg: string;
  inputBorder: string;
  inputFocusBorder: string;
  inputDisabledBg: string;
  /** Cycle 22 / Task 1 — tooltip overlay chrome. Consumed by the
   *  shared sparkline tooltip (and any future hover popovers). The
   *  default is a near-opaque dark slate so the tooltip reads as a
   *  popover, not a chip, against either light or dark grids. */
  tooltipBg: string;
  tooltipFg: string;
  tooltipBorder: string;
  /** Cycle 22 / Task 1 — accent fill for the body `'checkbox'` cell
   *  renderer + group tri-state checkbox when the box is checked.
   *  Default `'transparent'` preserves the existing outlined-only
   *  look; apps that want a filled brand-accent checkbox set both
   *  `--vg-checkbox-checked-bg` AND `--vg-checkbox-checked-fg` so
   *  the interior glyph stays legible against the fill. */
  checkboxCheckedBg: string;
  checkboxCheckedFg: string;
  /** Cycle 22 / Task 1 — optional vertical rule between adjacent
   *  columns. Default `'transparent'` keeps the grid lineless on the
   *  X axis (the painter only consults this when the value is a
   *  non-transparent color). */
  cellHorizontalBorderColor: string;
  /** Cycle 22 / Task 1 — popup / context-menu chrome. Three tokens
   *  shared across the filter popup, the context menu, and the
   *  sidebar panel surfaces — apps set them once and the entire
   *  popup family responds. */
  popupBg: string;
  popupBorder: string;
  menuHoverBg: string;
  /**
   * Workstream A (2026-07-06 CSS styling model) — the resolved
   * renderer-palette bundle (semantic colors + bar/chip geometry). See
   * `RendererPalette` above. `applyCellProps` threads this straight onto
   * every `CellPaintConfig.palette`.
   */
  rendererPalette: RendererPalette;
  /**
   * Map of class-name → ColCellOverrides patch. Populated from CSS custom
   * properties matching `--vg-cell-class-<name>-(bg|fg|font|halign)`.
   * Cycle 6 / Task 7.
   */
  cellClassVariants: Map<string, ColCellOverrides>;
  /**
   * Same as `cellClassVariants` but for `--vg-header-class-<name>-*` variables.
   * Cycle 6 / Task 7.
   */
  headerClassVariants: Map<string, ColCellOverrides>;
  /**
   * Workstream C (2026-07-06 CSS styling model) — resolves a `var(--vg-…)`
   * / `var(--vg-…, fallback)` / bare `--vg-…` reference embedded in a typed
   * `cellStyle` / `headerStyle` object VALUE through this theme's resolved
   * custom properties, so a consumer can write
   * `cellStyle: { fg: 'var(--vg-pos-color)' }` and get the theme's token
   * value. Any string that doesn't match the token-reference shape
   * (literal colors, plain keywords) is returned unchanged.
   *
   * Memoized per unique custom-property NAME for the lifetime of this
   * `ResolvedTheme` — `getComputedStyle` is already read once per
   * `CssReader.read()` call (the single-scan mechanism this type
   * documents throughout); the memo just avoids repeat
   * `getPropertyValue` lookups for the same token across many
   * `cellStyle` patches in one paint pass. A new `read()` (theme swap)
   * produces a fresh `ResolvedTheme` with its own resolver closing over
   * a fresh memo, so token changes are picked up on the next swap —
   * never retroactively on an already-produced `ResolvedTheme`.
   *
   * Optional so hand-built `ResolvedTheme` test fixtures that predate
   * Workstream C (object literals that don't populate this field)
   * keep compiling and running unchanged; callers (`applyCellProps`)
   * treat a missing resolver as a no-op passthrough.
   */
  resolveVarRef?: (value: string) => string;
}

// ─────────────────────────────────────────────────────────────────────────
// Workstream C (2026-07-06 CSS styling model) — token-referenceable
// cellStyle/headerStyle values.
// ─────────────────────────────────────────────────────────────────────────

const CG_VAR_REF_RE = /^var\(\s*(--vg-[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]*))?\)$/;
const CG_BARE_TOKEN_RE = /^--vg-[a-zA-Z0-9-]+$/;

/** Parse a `var(--vg-x)` / `var(--vg-x, fallback)` / bare `--vg-x` token
 *  reference out of a `cellStyle`/`headerStyle` string value. Returns
 *  `null` for anything else (literal colors, plain keywords) — the
 *  resolver then passes the value through unchanged. Pure + exported for
 *  direct unit testing independent of any DOM access. */
export function parseCgVarRef(value: string): { name: string; fallback?: string } | null {
  const t = value.trim();
  const m = CG_VAR_REF_RE.exec(t);
  if (m) {
    const name = m[1]!;
    const rawFallback = m[2];
    return rawFallback !== undefined ? { name, fallback: rawFallback.trim() } : { name };
  }
  if (CG_BARE_TOKEN_RE.test(t)) return { name: t };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Workstream B (2026-07-06 CSS styling model) — full-vocabulary parser.
//
// `--vg-cell-class-<name>-<suffix>` / `--vg-header-class-<name>-<suffix>`
// variables are collected into a raw `name -> { suffix: rawValue }` slot
// table during the single stylesheet walk (below), then each name's slots
// are assembled into a full `ColCellOverrides` object by
// `buildOverridesFromSlots`. This keeps the DOM walk itself unchanged
// (still one pass, still per-theme-swap, never per-cell) while the
// vocabulary grows from 4 fields to the whole type.
//
// Suffixes are matched by longest-suffix-first `endsWith` (not a single
// regex alternation) so that compound tokens like `border-top-width`
// aren't mis-split against a shorter sibling like `border-width` — see
// the design note in the Workstream B report for why this is safer than
// growing the old regex alternation.
// ─────────────────────────────────────────────────────────────────────────

type RawSlots = Record<string, string>;

const DECORATOR_POSITIONS: readonly DecoratorPosition[] = ['tl', 'tr', 'bl', 'br', 'ml', 'mr'];

/** Suffixes with a direct 1:1 field mapping (no cross-slot assembly). */
const SIMPLE_SUFFIXES: readonly string[] = [
  'bg', 'fg', 'font', 'halign', 'valign',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'text-transform', 'text-decoration', 'letter-spacing', 'line-height',
];

/** Suffixes consumed by `applyPadding` — uniform + per-side, merged. */
const PADDING_SUFFIXES: readonly string[] = [
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
];

/** Suffixes consumed by `applyBorder` — shorthand + discrete per side, plus `all`. */
const BORDER_SUFFIXES: readonly string[] = [
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-width', 'border-top-style', 'border-top-color',
  'border-right-width', 'border-right-style', 'border-right-color',
  'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
  'border-left-width', 'border-left-style', 'border-left-color',
];

/** Suffixes consumed by `applyContent` — icon / emoji / plain text slot. */
const CONTENT_SUFFIXES: readonly string[] = [
  'icon', 'icon-color', 'icon-size', 'emoji', 'emoji-size', 'content',
];

/** Suffixes consumed by `applyDecorators` — one bundle of 6 per position. */
const DECORATOR_SUFFIXES: readonly string[] = DECORATOR_POSITIONS.flatMap(pos => [
  `decorator-${pos}`, `decorator-${pos}-color`, `decorator-${pos}-size`,
  `decorator-${pos}-inset`, `decorator-${pos}-bg`, `decorator-${pos}-dot`,
]);

/** Every known suffix, longest-first so `endsWith` matching never picks a
 *  shorter sibling (e.g. `border-color`) over the correct longer one
 *  (e.g. `border-top-color`) for the same declaration. */
const KNOWN_SUFFIXES: readonly string[] = [
  ...SIMPLE_SUFFIXES, ...PADDING_SUFFIXES, ...BORDER_SUFFIXES,
  ...CONTENT_SUFFIXES, ...DECORATOR_SUFFIXES,
].sort((a, b) => b.length - a.length);

const CELL_PREFIX = '--vg-cell-class-';
const HEADER_PREFIX = '--vg-header-class-';

/** Split a `--vg-{cell,header}-class-<name>-<suffix>` property name into its
 *  variant kind, class name, and matched suffix. Returns `null` for
 *  properties outside the two prefixes, or whose tail doesn't end in any
 *  known suffix (forward-compatible: unknown suffixes are ignored). */
function matchVariantProp(
  prop: string,
): { kind: 'cell' | 'header'; name: string; suffix: string } | null {
  let rest: string;
  let kind: 'cell' | 'header';
  if (prop.startsWith(CELL_PREFIX)) {
    rest = prop.slice(CELL_PREFIX.length);
    kind = 'cell';
  } else if (prop.startsWith(HEADER_PREFIX)) {
    rest = prop.slice(HEADER_PREFIX.length);
    kind = 'header';
  } else {
    return null;
  }
  for (const suffix of KNOWN_SUFFIXES) {
    const marker = `-${suffix}`;
    if (rest.length > marker.length && rest.endsWith(marker)) {
      return { kind, name: rest.slice(0, rest.length - marker.length), suffix };
    }
  }
  return null;
}

function parsePx(raw: string): number | undefined {
  const n = Number(raw.replace(/px\s*$/i, '').trim());
  return Number.isFinite(n) ? n : undefined;
}

function parseUnitless(raw: string): number | undefined {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

function parseFontWeight(raw: string): FontWeight | undefined {
  const t = raw.trim();
  if (t === 'normal' || t === 'bold' || t === 'lighter' || t === 'bolder') return t;
  const n = Number(t);
  if (Number.isFinite(n) && n >= 100 && n <= 900) return n as FontWeight;
  return undefined;
}

function stripQuotes(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, -1);
    }
  }
  return t;
}

function isQuoted(raw: string): boolean {
  const t = raw.trim();
  return t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"));
}

/** Any codepoint outside the ASCII range is treated as an emoji/glyph
 *  rather than plain text — good enough to route `-decorator-<pos>: "▼"` /
 *  `"🔥"` to `kind: 'emoji'` while `-decorator-<pos>: "NEW"` stays `'text'`. */
function looksLikeEmoji(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
}

/** Whitespace tokenizer that keeps `rgba(230, 57, 70, 1)` as one token
 *  (doesn't split inside parens) — needed for order-independent border
 *  shorthand parsing (`<width> <style> <color>` in any order). */
function splitRespectingParens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

const BORDER_STYLE_KEYWORDS = new Set<BorderStyle>(['solid', 'dashed', 'dotted', 'double']);

/** Parse a border shorthand value (`"2px solid #e63946"`, any token order)
 *  into a `BorderSide`. Unrecognized tokens (width/style already matched)
 *  are treated as the color — handles `red`, `#hex`, `rgb(...)`, `var(...)`. */
function parseBorderShorthand(value: string): BorderSide {
  const side: BorderSide = {};
  for (const t of splitRespectingParens(value)) {
    if (BORDER_STYLE_KEYWORDS.has(t as BorderStyle)) {
      side.style = t as BorderStyle;
      continue;
    }
    const n = parsePx(t);
    if (n !== undefined) {
      side.width = n;
      continue;
    }
    if (side.color === undefined) side.color = t;
  }
  return side;
}

/** Assemble one `BorderSide` (or `undefined` if nothing was declared) from
 *  the shorthand + discrete width/style/color slots for a given bucket.
 *  `bucket === ''` reads the `border` / `border-width` / … slots (the
 *  `all` fallback); `bucket === 'top'` reads `border-top` / `border-top-
 *  width` / …. Discrete slots win over the shorthand field-by-field. */
function buildBorderSide(bucket: string, slots: RawSlots): BorderSide | undefined {
  const prefix = bucket ? `border-${bucket}` : 'border';
  const shorthand = slots[prefix];
  const width = slots[`${prefix}-width`];
  const style = slots[`${prefix}-style`];
  const color = slots[`${prefix}-color`];
  if (shorthand === undefined && width === undefined && style === undefined && color === undefined) {
    return undefined;
  }
  let side: BorderSide = shorthand !== undefined ? parseBorderShorthand(shorthand) : {};
  if (width !== undefined) {
    const n = parsePx(width);
    if (n !== undefined) side = { ...side, width: n };
  }
  if (style !== undefined && BORDER_STYLE_KEYWORDS.has(style as BorderStyle)) {
    side = { ...side, style: style as BorderStyle };
  }
  if (color !== undefined) side = { ...side, color };
  return side;
}

function applyPadding(o: ColCellOverrides, slots: RawSlots): void {
  const uniformRaw = slots['padding'];
  const uniform = uniformRaw !== undefined ? parsePx(uniformRaw) : undefined;
  const sides: Record<'top' | 'right' | 'bottom' | 'left', number | undefined> = {
    top: slots['padding-top'] !== undefined ? parsePx(slots['padding-top']!) : undefined,
    right: slots['padding-right'] !== undefined ? parsePx(slots['padding-right']!) : undefined,
    bottom: slots['padding-bottom'] !== undefined ? parsePx(slots['padding-bottom']!) : undefined,
    left: slots['padding-left'] !== undefined ? parsePx(slots['padding-left']!) : undefined,
  };
  const hasPerSide = sides.top !== undefined || sides.right !== undefined
    || sides.bottom !== undefined || sides.left !== undefined;

  if (!hasPerSide) {
    if (uniform !== undefined) o.padding = uniform;
    return;
  }
  const pad: Padding = {};
  if (sides.top !== undefined || uniform !== undefined) pad.top = sides.top ?? uniform;
  if (sides.right !== undefined || uniform !== undefined) pad.right = sides.right ?? uniform;
  if (sides.bottom !== undefined || uniform !== undefined) pad.bottom = sides.bottom ?? uniform;
  if (sides.left !== undefined || uniform !== undefined) pad.left = sides.left ?? uniform;
  o.padding = pad;
}

function applyBorder(o: ColCellOverrides, slots: RawSlots): void {
  const all = buildBorderSide('', slots);
  const top = buildBorderSide('top', slots);
  const right = buildBorderSide('right', slots);
  const bottom = buildBorderSide('bottom', slots);
  const left = buildBorderSide('left', slots);
  if (!all && !top && !right && !bottom && !left) return;
  const spec: BorderSpec = {};
  if (all !== undefined) spec.all = all;
  if (top !== undefined) spec.top = top;
  if (right !== undefined) spec.right = right;
  if (bottom !== undefined) spec.bottom = bottom;
  if (left !== undefined) spec.left = left;
  o.border = spec;
}

function applyContent(o: ColCellOverrides, slots: RawSlots): void {
  const icon = slots['icon'];
  if (icon !== undefined) {
    const color = slots['icon-color'];
    const sizeRaw = slots['icon-size'];
    const size = sizeRaw !== undefined ? parsePx(sizeRaw) : undefined;
    const content: CellContent = { kind: 'icon', icon: stripQuotes(icon) };
    if (color !== undefined) content.color = color;
    if (size !== undefined) content.size = size;
    o.content = content;
    return;
  }
  const emoji = slots['emoji'];
  if (emoji !== undefined) {
    const sizeRaw = slots['emoji-size'] ?? slots['icon-size'];
    const size = sizeRaw !== undefined ? parsePx(sizeRaw) : undefined;
    const content: CellContent = { kind: 'emoji', value: stripQuotes(emoji) };
    if (size !== undefined) content.size = size;
    o.content = content;
    return;
  }
  const text = slots['content'];
  if (text !== undefined) {
    o.content = { kind: 'text', value: stripQuotes(text) };
  }
}

function applyDecorators(o: ColCellOverrides, slots: RawSlots): void {
  const decorators: CellDecorator[] = [];
  for (const pos of DECORATOR_POSITIONS) {
    const mainKey = `decorator-${pos}`;
    const dotRaw = slots[`${mainKey}-dot`];
    const colorRaw = slots[`${mainKey}-color`];
    const sizeRaw = slots[`${mainKey}-size`];
    const insetRaw = slots[`${mainKey}-inset`];
    const bgRaw = slots[`${mainKey}-bg`];
    const size = sizeRaw !== undefined ? parsePx(sizeRaw) : undefined;
    const inset = insetRaw !== undefined ? parsePx(insetRaw) : undefined;

    if (dotRaw !== undefined) {
      const dot: CellDecorator = { position: pos, kind: 'dot', color: dotRaw };
      if (size !== undefined) dot.size = size;
      if (insetRaw !== undefined && inset !== undefined) dot.inset = inset;
      if (bgRaw !== undefined) dot.bg = bgRaw;
      decorators.push(dot);
      continue;
    }

    const mainRaw = slots[mainKey];
    if (mainRaw === undefined) continue;

    if (isQuoted(mainRaw)) {
      const value = stripQuotes(mainRaw);
      const dec: CellDecorator = {
        position: pos, kind: looksLikeEmoji(value) ? 'emoji' : 'text', value,
      };
      if (colorRaw !== undefined) dec.color = colorRaw;
      if (size !== undefined) dec.size = size;
      if (inset !== undefined) dec.inset = inset;
      if (bgRaw !== undefined) dec.bg = bgRaw;
      decorators.push(dec);
    } else {
      const dec: CellDecorator = { position: pos, kind: 'icon', icon: mainRaw.trim() };
      if (colorRaw !== undefined) dec.color = colorRaw;
      if (size !== undefined) dec.size = size;
      if (inset !== undefined) dec.inset = inset;
      if (bgRaw !== undefined) dec.bg = bgRaw;
      decorators.push(dec);
    }
  }
  if (decorators.length > 0) o.decorators = decorators;
}

/** Assemble a name's raw slot table into the full `ColCellOverrides`
 *  vocabulary. Pure function — no DOM access — so it's trivially unit
 *  testable independent of the stylesheet walk. */
function buildOverridesFromSlots(slots: RawSlots): ColCellOverrides {
  const o: ColCellOverrides = {};
  for (const [suffix, raw] of Object.entries(slots)) {
    switch (suffix) {
      case 'bg': o.bg = raw; break;
      case 'fg': o.fg = raw; break;
      case 'font': o.font = raw; break;
      case 'halign':
        if (raw === 'left' || raw === 'right' || raw === 'center') o.halign = raw;
        break;
      case 'valign':
        if (raw === 'top' || raw === 'middle' || raw === 'bottom') o.valign = raw;
        break;
      case 'font-family': o.fontFamily = raw; break;
      case 'font-size': {
        const n = parsePx(raw);
        if (n !== undefined) o.fontSize = n;
        break;
      }
      case 'font-weight': {
        const w = parseFontWeight(raw);
        if (w !== undefined) o.fontWeight = w;
        break;
      }
      case 'font-style':
        if (raw === 'normal' || raw === 'italic') o.fontStyle = raw;
        break;
      case 'text-transform':
        if (raw === 'none' || raw === 'uppercase' || raw === 'lowercase' || raw === 'capitalize') {
          o.textTransform = raw as TextTransform;
        }
        break;
      case 'text-decoration':
        if (raw === 'none' || raw === 'underline' || raw === 'line-through') o.textDecoration = raw;
        break;
      case 'letter-spacing': {
        const n = parsePx(raw);
        if (n !== undefined) o.letterSpacing = n;
        break;
      }
      case 'line-height': {
        const n = parseUnitless(raw);
        if (n !== undefined) o.lineHeight = n;
        break;
      }
      default:
        // Padding / border / content / decorator slots are assembled below
        // (cross-slot), not here.
        break;
    }
  }
  applyPadding(o, slots);
  applyBorder(o, slots);
  applyContent(o, slots);
  applyDecorators(o, slots);
  return o;
}

/**
 * Scan `document.styleSheets` for CSS custom properties matching
 * `--vg-cell-class-<name>-<suffix>` and `--vg-header-class-<name>-<suffix>`
 * across the full `ColCellOverrides` vocabulary (colors, alignment, font
 * breakouts, text-*, padding, borders, content, decorators).
 *
 * Returns two Maps: one for cell variants, one for header variants.
 * Cross-origin stylesheets that throw on `.cssRules` are silently skipped.
 */
function scanVariantVariables(): {
  cellClassVariants: Map<string, ColCellOverrides>;
  headerClassVariants: Map<string, ColCellOverrides>;
} {
  const cellSlots = new Map<string, RawSlots>();
  const headerSlots = new Map<string, RawSlots>();

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
        const match = matchVariantProp(prop);
        if (!match) continue;
        const value = style.getPropertyValue(prop).trim();
        if (!value) continue;
        const target = match.kind === 'cell' ? cellSlots : headerSlots;
        const slots = target.get(match.name) ?? {};
        slots[match.suffix] = value;
        target.set(match.name, slots);
      }
    }
  }

  const cellMap = new Map<string, ColCellOverrides>();
  for (const [name, slots] of cellSlots) cellMap.set(name, buildOverridesFromSlots(slots));
  const headerMap = new Map<string, ColCellOverrides>();
  for (const [name, slots] of headerSlots) headerMap.set(name, buildOverridesFromSlots(slots));

  return { cellClassVariants: cellMap, headerClassVariants: headerMap };
}

// ─────────────────────────────────────────────────────────────────────────
// Workstream A, part 2 (2026-07-06 CSS styling model) — status-pill /
// rating-scale / venue resolution tables. Each literal fallback below is
// byte-identical to its `@wellsfargo-starui/velocity-grid-renderers/palette.ts` counterpart
// (`STATUS_PILL_MAP`, `RATING_SCALE_BANDS`, `DEFAULT_VENUE_PALETTE`), kept
// as a local duplicate (not imported) so `@wellsfargo-starui/velocity-grid` never depends on
// `@wellsfargo-starui/velocity-grid-renderers`.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_STATES: readonly StatusPillState[] = [
  'WORKING', 'PART_FILL', 'FILLED', 'CANCELLED', 'REJECTED', 'PENDING',
];

/** `<state>` → CSS-token slug: underscores become hyphens, lowercased
 *  (`PART_FILL` → `part-fill`), per `--vg-status-<state>-bg/-fg/-border`. */
function statusSlug(state: StatusPillState): string {
  return state.toLowerCase().replace(/_/g, '-');
}

const STATUS_DEFAULTS: Readonly<Record<StatusPillState, StatusPillPaletteEntry>> = {
  WORKING: { bg: '#3b82f61f', fg: '#3b82f6' },
  PART_FILL: { bg: '#f0b4291f', fg: '#f0b429' },
  FILLED: { bg: '#0aa0631f', fg: '#0aa063' },
  CANCELLED: { bg: '#8a8f981f', fg: '#8a8f98' },
  REJECTED: { bg: '#ffffff', fg: '#e63946', border: '#e63946' },
  PENDING: { bg: 'transparent', fg: '#8a8f98', border: '#8a8f98', dashed: true },
};

const RATING_GRADES: readonly RatingGrade[] = [
  'AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-',
  'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-',
  'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-',
  'CC', 'C', 'D', 'NR', 'WD',
];

/** `<grade>` → CSS-token slug: lowercased, trailing `+`/`-` transliterated
 *  to `-plus`/`-minus` (a bare `+` isn't a valid CSS ident code point;
 *  `-minus` keeps the naming symmetric even though a trailing `-` is
 *  itself already ident-valid), per `--vg-rating-<grade>-color`. */
function ratingSlug(grade: RatingGrade): string {
  return grade.toLowerCase().replace(/\+$/, '-plus').replace(/-$/, '-minus');
}

const RATING_DEFAULTS: Readonly<Record<RatingGrade, string>> = {
  AAA: '#0aa063', 'AA+': '#22a866', AA: '#3aae65', 'AA-': '#52b563',
  'A+': '#6bbb60', A: '#83c25d', 'A-': '#9bc859',
  'BBB+': '#b3cf54', BBB: '#c8d24a', 'BBB-': '#dcd53e',
  'BB+': '#f0b429', BB: '#ef9f2a', 'BB-': '#ee8a2c',
  'B+': '#ec762d', B: '#ea612f', 'B-': '#e94d31',
  'CCC+': '#e2434f', CCC: '#dc3b47', 'CCC-': '#d6353f',
  CC: '#c62f38', C: '#b62931', D: '#a6222a',
  NR: '#8a8f98', WD: '#8a8f98',
};

const VENUE_MICS: readonly string[] = ['XNAS', 'ARCX', 'BATS', 'EDGX'];

const VENUE_DEFAULTS: Readonly<Record<string, string>> = {
  XNAS: '#3b82f6', ARCX: '#8b5cf6', BATS: '#14b8a6', EDGX: '#f0b429',
};

/** Resolve the 6-state StatusPill map from `--vg-status-<state>-bg/-fg/
 *  -border`, falling back per-field to the byte-identical literal. `get`
 *  is the same `getComputedStyle`-backed reader `read()` builds per call —
 *  passed in so this stays a pure, directly testable helper. */
function resolveStatusPalette(get: (name: string) => string): Record<StatusPillState, StatusPillPaletteEntry> {
  const result = {} as Record<StatusPillState, StatusPillPaletteEntry>;
  for (const state of STATUS_STATES) {
    const slug = statusSlug(state);
    const def = STATUS_DEFAULTS[state];
    const entry: StatusPillPaletteEntry = {
      bg: get(`--vg-status-${slug}-bg`) || def.bg,
      fg: get(`--vg-status-${slug}-fg`) || def.fg,
    };
    const border = get(`--vg-status-${slug}-border`) || def.border;
    if (border !== undefined) entry.border = border;
    // Structural, never token-sourced — see the `RendererPalette.status` doc.
    if (def.dashed !== undefined) entry.dashed = def.dashed;
    result[state] = entry;
  }
  return result;
}

/** Resolve the 24-grade RatingBadge ladder from `--vg-rating-<grade>-color`. */
function resolveRatingPalette(get: (name: string) => string): Record<RatingGrade, string> {
  const result = {} as Record<RatingGrade, string>;
  for (const grade of RATING_GRADES) {
    result[grade] = get(`--vg-rating-${ratingSlug(grade)}-color`) || RATING_DEFAULTS[grade];
  }
  return result;
}

/** Resolve the default VenueChip/NBBOCell MIC palette from
 *  `--vg-venue-<mic>-color` (mic lowercased). */
function resolveVenuePalette(get: (name: string) => string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const mic of VENUE_MICS) {
    result[mic] = get(`--vg-venue-${mic.toLowerCase()}-color`) || VENUE_DEFAULTS[mic]!;
  }
  return result;
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

    const fontSize = get('--vg-font-size') || '13px';
    const fontFamily = get('--vg-font-family') || 'system-ui';
    // Fall back to the chrome font when --vg-cell-font-family is
    // absent so legacy themes that haven't migrated still paint cells
    // with the same family they always did.
    const cellFontFamily = get('--vg-cell-font-family') || fontFamily;

    const { cellClassVariants, headerClassVariants } = scanVariantVariables();

    // Workstream C — token resolver for typed cellStyle/headerStyle object
    // values. `varMemo` is local to this `read()` call, so every theme
    // swap (new `read()`) starts with a fresh, empty memo — no explicit
    // "clear" step needed. Within one theme's lifetime, `getPropertyValue`
    // is called at most once per unique `--vg-*` token name, regardless of
    // how many cellStyle patches reference it across the paint pass.
    const varMemo = new Map<string, string>();
    const resolveVarRef = (value: string): string => {
      const ref = parseCgVarRef(value);
      if (!ref) return value;
      let resolved = varMemo.get(ref.name);
      if (resolved === undefined) {
        resolved = cs.getPropertyValue(ref.name).trim();
        varMemo.set(ref.name, resolved);
      }
      if (resolved) return resolved;
      return ref.fallback !== undefined ? ref.fallback : value;
    };

    return {
      font: `${fontSize} ${fontFamily}`,
      cellFont: `${fontSize} ${cellFontFamily}`,
      fg: get('--vg-fg-color') || '#1a1f24',
      bg: get('--vg-bg-color') || '#ffffff',
      headerBg: get('--vg-header-bg') || '#e8ecef',
      headerFg: get('--vg-header-fg') || '#1a1f24',
      borderColor: get('--vg-border-color') || '#d5dbe0',
      gridLineColor: get('--vg-grid-line-color') || '#e8ecef',
      rowAltBg: get('--vg-row-alt-bg') || '#f4f6f8',
      rowHoverBg: get('--vg-row-hover-bg') || '#eef1f3',
      rowSelectedBg: get('--vg-row-selected-bg') || 'rgba(13,148,136,0.12)',
      focusRingColor: get('--vg-focus-ring-color') || '#0d9488',
      focusRingWidth: px('--vg-focus-ring-width', 2),
      flashFromColor: get('--vg-flash-from-color') || '#fef3c7',
      flashToColor: get('--vg-flash-to-color') || 'rgba(254,243,199,0)',
      quickFilterMatchBg: get('--vg-quick-filter-match-bg') || '#fff3b8',
      unsortIconColor: get('--vg-unsort-icon-color') || 'rgba(0, 0, 0, 0.4)',
      rangeFillColor: get('--vg-range-fill-color') || 'rgba(59, 130, 246, 0.22)',
      rangeBorderColor: get('--vg-range-border-color') || '#3b82f6',
      totalsBg: get('--vg-totals-bg') || '#f7f9fb',
      totalsFg: get('--vg-totals-fg') || '#0f172a',
      totalsBorderTop: get('--vg-totals-border-top') || '#cbd5e1',
      totalsFgMuted: get('--vg-totals-fg-muted') || '#475569',
      totalsFontWeight: px('--vg-totals-font-weight', 500),
      pinnedRowBg: get('--vg-pinned-row-bg') || '#fbf8f3',
      pinnedRowFg: get('--vg-pinned-row-fg') || get('--vg-fg-color') || '#1a1f24',
      pinnedRowBorder: get('--vg-pinned-row-border') || get('--vg-totals-border-top') || '#cbd5e1',
      groupChevronColor: get('--vg-group-chevron-color') || get('--vg-totals-fg-muted') || '#475569',
      groupCountColor: get('--vg-group-count-color') || get('--vg-totals-fg-muted') || '#475569',
      groupIndent: px('--vg-group-indent', 14),
      groupRowBg: get('--vg-group-row-bg') || get('--vg-row-alt-bg') || '#f1f5f9',
      groupCheckboxBorderColor: get('--vg-group-checkbox-border-color') || get('--vg-fg-color') || '#1a1f24',
      groupCheckboxCheckColor: get('--vg-group-checkbox-check-color') || get('--vg-fg-color') || '#1a1f24',
      groupCheckboxIndeterminateColor:
        get('--vg-group-checkbox-indeterminate-color') || get('--vg-fg-color') || '#1a1f24',
      groupCheckboxFill: get('--vg-group-checkbox-fill') || 'transparent',
      groupFooterBg: get('--vg-group-footer-bg') || get('--vg-totals-bg') || '#f7f9fb',
      groupFooterFg: get('--vg-group-footer-fg') || get('--vg-totals-fg') || '#0f172a',
      groupFooterBorderTop: get('--vg-group-footer-border-top') || get('--vg-totals-border-top') || '#cbd5e1',
      groupFooterFontWeight: px('--vg-group-footer-font-weight', px('--vg-totals-font-weight', 500)),
      rowHeight: px('--vg-row-height', 30),
      headerHeight: px('--vg-header-height', 32),
      resizerHotZone: px('--vg-resizer-hot-zone', 4),
      scrollbarThickness: px('--vg-scrollbar-thickness', 10),
      // Cycle 22 / Task 1 — input chrome. Defaults alias body bg/fg
      // and the focus ring color so an undeclared theme still reads.
      inputBg: get('--vg-input-bg') || get('--vg-bg-color') || '#ffffff',
      inputFg: get('--vg-input-fg') || get('--vg-fg-color') || '#1a1f24',
      inputBorder: get('--vg-input-border') || get('--vg-border-color') || '#d5dbe0',
      inputFocusBorder: get('--vg-input-focus-border') || get('--vg-focus-ring-color') || '#3b82f6',
      inputDisabledBg: get('--vg-input-disabled-bg') || get('--vg-row-alt-bg') || '#f3f4f6',
      // Cycle 22 / Task 1 — tooltip overlay chrome. Slate fallback
      // matches the existing inline default in `sparklineTooltip.ts`.
      tooltipBg: get('--vg-tooltip-bg') || 'rgba(17,24,39,0.92)',
      tooltipFg: get('--vg-tooltip-fg') || '#ffffff',
      tooltipBorder: get('--vg-tooltip-border') || 'transparent',
      // Cycle 22 / Task 1 — filled-checkbox accent. `'transparent'`
      // default keeps the outlined-only look the existing renderer
      // ships with.
      checkboxCheckedBg: get('--vg-checkbox-checked-bg') || 'transparent',
      checkboxCheckedFg: get('--vg-checkbox-checked-fg') || get('--vg-fg-color') || '#1a1f24',
      // Cycle 22 / Task 1 — optional inter-column rule. Painter only
      // strokes when the value is a non-transparent color.
      cellHorizontalBorderColor: get('--vg-cell-horizontal-border-color') || 'transparent',
      // Cycle 22 / Task 1 — popup / menu surfaces. Default to body bg
      // + border so the popup looks like "a piece of the grid"
      // floating above when the token isn't declared.
      popupBg: get('--vg-popup-bg') || get('--vg-bg-color') || '#ffffff',
      popupBorder: get('--vg-popup-border') || get('--vg-border-color') || '#d5dbe0',
      menuHoverBg: get('--vg-menu-hover-bg') || get('--vg-row-hover-bg') || '#eef1f3',
      // Workstream A (2026-07-06 CSS styling model) — renderer-palette
      // bundle. Literal fallbacks mirror @wellsfargo-starui/velocity-grid-renderers/palette.ts's
      // SEMANTIC_COLORS + the bars/badges painter geometry constants
      // exactly (defensive `get(...) || <literal>` / `px(...)` pattern,
      // same as every other token above).
      rendererPalette: {
        positive: get('--vg-pos-color') || '#2dd4bf',
        negative: get('--vg-neg-color') || '#fb7185',
        warning: get('--vg-warning-color') || '#f0b429',
        info: get('--vg-info-color') || '#3b82f6',
        muted: get('--vg-muted-color') || '#8a8f98',
        barHeight: px('--vg-bar-height', 8),
        chipHeight: px('--vg-chip-height', 16),
        chipRadius: px('--vg-chip-radius', 3),
        // Workstream A, part 2 — status-pill / rating-scale / venue
        // structured maps, same defensive `get(...) || <literal>` pattern.
        status: resolveStatusPalette(get),
        rating: resolveRatingPalette(get),
        venue: resolveVenuePalette(get),
      },
      cellClassVariants,
      headerClassVariants,
      resolveVarRef,
    };
  }
}
