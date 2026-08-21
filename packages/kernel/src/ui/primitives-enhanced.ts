/**
 * Enhanced VelocityGrid UI primitives — extended design system
 * Expands from 5 tokens → 20+ for sophisticated, premium design
 *
 * Backward compatible: existing code continues to work; new components use enhanced tokens
 * Token-driven: pass kit's own alias names to reproduce exact rendering (invariance-preserving)
 *
 * Exposed as: @wellsfargo-starui/velocity-grid/ui/primitives-enhanced
 */

/** Extended token system for premium design */
export interface VguiTokensEnhanced {
  // Colors
  accent: string;
  accentLight: string;        // Accent @ 20% opacity
  accentDark: string;         // Accent @ 200% brightness
  success: string;
  warning: string;
  danger: string;
  info: string;

  // Backgrounds
  bgPrimary: string;
  bgSecondary: string;        // Elevated, cards
  bgTertiary: string;         // Subtle, hover states

  // Borders
  borderStrong: string;
  borderSubtle: string;       // 70% opacity variant
  borderLight: string;        // For minimal dividers

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;       // Disabled, placeholders
  textMuted: string;

  // Semantic
  shadow?: string;
  shadowMd?: string;
  focusRing?: string;         // Focus visual feedback

  // Legacy (for backward compatibility)
  border: string;
  muted: string;
  surface: string;
  radius: string;
}

/** Enhanced default tokens (dark theme optimized) */
export const VGUI_ENHANCED_TOKENS: VguiTokensEnhanced = {
  // Colors
  accent: 'var(--vg-chrome-accent, #3b82f6)',
  accentLight: 'rgba(59, 130, 246, 0.2)',
  accentDark: '#1e40af',
  success: 'var(--vg-success-color, #10b981)',
  warning: 'var(--vg-warning-color, #f59e0b)',
  danger: 'var(--vg-danger-color, #ef4444)',
  info: '#06b6d4',

  // Backgrounds
  bgPrimary: 'var(--vg-bg-color, #0f1419)',
  bgSecondary: 'var(--vg-bg-secondary, #1a1f2e)',
  bgTertiary: 'var(--vg-bg-tertiary, #24293d)',

  // Borders
  borderStrong: 'var(--vg-border-color, #2a3140)',
  borderSubtle: 'rgba(74, 82, 113, 0.6)',
  borderLight: 'rgba(74, 82, 113, 0.3)',

  // Text
  textPrimary: 'var(--vg-fg-color, #e5e9f0)',
  textSecondary: 'var(--vg-fg-secondary, #c5cbd7)',
  textTertiary: 'var(--vg-fg-tertiary, #9aa4b8)',
  textMuted: 'var(--vg-muted-fg-color, #7a8599)',

  // Semantic — aliased to the shared kernel elevation scale (tokens.css
  // :root) so ext's cockpit chrome and the core grid's floating surfaces
  // read as one consistent shadow language; literal is a defensive
  // fallback matching the sibling color/border/text tokens' idiom.
  shadow: 'var(--vg-shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.12))',
  shadowMd: 'var(--vg-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15))',
  focusRing: '0 0 0 3px rgba(59, 130, 246, 0.2)',

  // Legacy
  border: 'var(--vg-border-color, #2a3140)',
  muted: 'var(--vg-muted-fg-color, #9aa4b6)',
  surface: 'color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 4%, transparent)',
  radius: 'var(--vg-radius, 2px)',
};

/** Spacing scale tokens */
export interface VguiSpacing {
  xs: string;       // 4px
  sm: string;       // 8px
  md: string;       // 12px
  lg: string;       // 16px
  xl: string;       // 20px
  '2xl': string;    // 24px
}

export const VGUI_SPACING: VguiSpacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
};

/** Typography scale tokens */
export interface VguiTypography {
  // Font sizes
  xs: string;       // 11px
  sm: string;       // 12px
  base: string;     // 13px
  lg: string;       // 14px
  xl: string;       // 16px
  '2xl': string;    // 20px

  // Font weights
  weight400: string;   // 400
  weight500: string;   // 500
  weight600: string;   // 600
  weight700: string;   // 700

  // Line heights
  tight: string;    // 1.2
  normal: string;   // 1.5
  relaxed: string;  // 1.6
}

export const VGUI_TYPOGRAPHY: VguiTypography = {
  xs: '11px',
  sm: '12px',
  base: '13px',
  lg: '14px',
  xl: '16px',
  '2xl': '20px',
  weight400: '400',
  weight500: '500',
  weight600: '600',
  weight700: '700',
  tight: '1.2',
  normal: '1.5',
  relaxed: '1.6',
};

/** Transition tokens */
export interface VguiTransitions {
  fast: string;     // 100ms
  base: string;     // 150ms
  slow: string;     // 200ms
  slower: string;   // 300ms
}

export const VGUI_TRANSITIONS: VguiTransitions = {
  fast: '100ms cubic-bezier(0.4, 0, 0.2, 1)',
  base: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  slower: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
};

/**
 * Enhanced toggle switch — 44×24 pill with stronger states
 * Better touch target, more pronounced visual feedback
 */
export function vguiSwitchCssEnhanced(
  c: { root: string; knob: string; on: string },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
): string {
  return `
.${c.root} {
  appearance: none; -webkit-appearance: none;
  position: relative; display: inline-block; flex: none; box-sizing: border-box;
  width: 44px; min-width: 44px; max-width: 44px;
  height: 24px; min-height: 24px; max-height: 24px;
  border-radius: 999px;
  border: 1px solid ${t.borderSubtle};
  background: ${t.bgTertiary};
  cursor: pointer;
  padding: 0;
  margin: 0;
  overflow: hidden;
  vertical-align: middle;
  transition: border-color ${VGUI_TRANSITIONS.base}, background ${VGUI_TRANSITIONS.base};
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
}

.${c.root}:hover {
  border-color: ${t.borderStrong};
  background: ${t.bgTertiary};
}

.${c.root}:focus {
  outline: none;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2), ${t.focusRing ?? ''};
}

.${c.root}:active {
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
}

.${c.root}.${c.on} {
  border-color: ${t.accent};
  background: ${t.accent};
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
}

.${c.root}.${c.on}:hover {
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.${c.root} .${c.knob} {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: left ${VGUI_TRANSITIONS.base}, box-shadow ${VGUI_TRANSITIONS.base};
  pointer-events: none;
}

.${c.root}.${c.on} .${c.knob} {
  left: 24px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.${c.root}:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}`;
}

/**
 * Enhanced button — three-tier system (Primary/Secondary/Tertiary)
 */
export function vguiButtonCssEnhanced(
  c: { primary: string; secondary: string; tertiary: string },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
): string {
  return `
/* Primary Button */
.${c.primary} {
  appearance: none; -webkit-appearance: none;
  background: ${t.accent};
  color: white;
  border: 1px solid ${t.accent};
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all ${VGUI_TRANSITIONS.base};
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
}

.${c.primary}:hover {
  background: ${t.accentDark};
  border-color: ${t.accentDark};
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  transform: translateY(-1px);
}

.${c.primary}:active {
  transform: scale(0.98);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
}

.${c.primary}:focus {
  outline: none;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3), ${t.focusRing ?? ''};
}

.${c.primary}:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

/* Secondary Button */
.${c.secondary} {
  appearance: none; -webkit-appearance: none;
  background: transparent;
  color: ${t.accent};
  border: 1px solid ${t.accent};
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all ${VGUI_TRANSITIONS.base};
}

.${c.secondary}:hover {
  background: ${t.accentLight};
  border-color: ${t.accent};
}

.${c.secondary}:active {
  background: ${t.accent};
  color: white;
  transform: scale(0.98);
}

.${c.secondary}:focus {
  outline: none;
  box-shadow: ${t.focusRing ?? ''};
}

.${c.secondary}:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Tertiary Button */
.${c.tertiary} {
  appearance: none; -webkit-appearance: none;
  background: transparent;
  color: ${t.textSecondary};
  border: none;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  transition: all ${VGUI_TRANSITIONS.base};
}

.${c.tertiary}:hover {
  background: ${t.bgTertiary};
  color: ${t.textPrimary};
}

.${c.tertiary}:active {
  background: ${t.bgSecondary};
  transform: scale(0.98);
}

.${c.tertiary}:focus {
  outline: none;
  box-shadow: ${t.focusRing ?? ''};
}

.${c.tertiary}:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}`;
}

/**
 * Enhanced form row — card-based with hover elevation
 */
export function vguiRowCssEnhanced(
  c: {
    root: string;
    label: string;
    title: string;
    help: string;
    control: string;
    modified?: string;
  },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
  opts: { labelCol?: string } = {},
): string {
  const labelCol = opts.labelCol ?? '210px';
  const modified = c.modified
    ? `.${c.root}.${c.modified} { border-left: 3px solid ${t.accent}; padding-left: 13px; }`
    : '';

  return `
.${c.root} {
  display: grid;
  grid-template-columns: ${labelCol} minmax(0, 1fr);
  gap: 8px 14px;
  align-items: center;
  padding: 12px 16px;
  margin: 0 0 8px 0;
  background: ${t.bgSecondary};
  border: 1px solid ${t.borderSubtle};
  border-radius: 8px;
  transition: all ${VGUI_TRANSITIONS.base};
  box-shadow: ${t.shadow ?? ''};
}

.${c.root}:hover {
  background: ${t.bgTertiary};
  border-color: ${t.borderStrong};
  box-shadow: ${t.shadowMd ?? ''};
  transform: translateY(-1px);
}

.${c.root}:focus-within {
  border-color: ${t.accent};
  box-shadow: ${t.shadowMd ?? ''}, ${t.focusRing ?? ''};
}

.${c.root} .${c.label} {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-left: 10px;
}

.${c.root} .${c.title} {
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
  color: ${t.textPrimary};
}

.${c.root} .${c.help} {
  font-size: 11px;
  font-weight: 400;
  line-height: 1.45;
  color: ${t.textMuted};
}

.${c.root} .${c.control} {
  min-width: 0;
}

${modified}`;
}

/**
 * Enhanced input field — background + focus ring
 */
export function vguiInputCssEnhanced(
  c: { root: string; focus?: string },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
): string {
  return `
.${c.root} {
  appearance: none; -webkit-appearance: none;
  background: ${t.bgTertiary};
  color: ${t.textPrimary};
  border: 1px solid ${t.borderSubtle};
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  transition: all ${VGUI_TRANSITIONS.base};
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
}

.${c.root}:hover {
  background: ${t.bgSecondary};
  border-color: ${t.borderStrong};
}

.${c.root}:focus {
  outline: none;
  background: ${t.bgPrimary};
  border-color: ${t.accent};
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08), ${t.focusRing ?? ''};
}

.${c.root}::placeholder {
  color: ${t.textTertiary};
  font-style: italic;
}

.${c.root}:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: ${t.bgTertiary};
}`;
}

/**
 * Enhanced band (accordion) — smooth expand/collapse with visual distinction
 */
export function vguiBandCssEnhanced(
  c: { root: string; head: string; body: string; title: string; chevron: string; collapsed?: string },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
): string {
  return `
.${c.root} {
  border: 1px solid ${t.borderSubtle};
  border-radius: 10px;
  margin-bottom: 12px;
  overflow: hidden;
  transition: all ${VGUI_TRANSITIONS.base};
}

.${c.root}:hover {
  border-color: ${t.borderStrong};
  box-shadow: ${t.shadow ?? ''};
}

.${c.head} {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, ${t.bgSecondary}, transparent);
  cursor: pointer;
  transition: all ${VGUI_TRANSITIONS.base};
  user-select: none;
  border-bottom: 1px solid transparent;
}

.${c.head}:hover {
  background: linear-gradient(135deg, ${t.bgTertiary}, transparent);
  border-bottom-color: ${t.borderSubtle};
}

.${c.head}:active {
  transform: scale(0.99);
}

.${c.title} {
  font-size: 13px;
  font-weight: 600;
  color: ${t.textPrimary};
  flex: 1;
}

.${c.chevron} {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${t.textSecondary};
  transition: transform ${VGUI_TRANSITIONS.base};
  flex-shrink: 0;
}

.${c.root}.${c.collapsed} .${c.chevron} {
  transform: rotate(-90deg);
}

.${c.body} {
  max-height: 1000px;
  overflow: hidden;
  animation: vgui-expandDown ${VGUI_TRANSITIONS.slow};
}

.${c.root}.${c.collapsed} .${c.body} {
  max-height: 0;
  animation: vgui-collapseUp ${VGUI_TRANSITIONS.slow};
}

@keyframes vgui-expandDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes vgui-collapseUp {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-8px);
  }
}`;
}

/**
 * Enhanced tab system — prominent underline indicator with animation
 */
export function vguiTabsCssEnhanced(
  c: { root: string; tab: string; active: string },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
): string {
  return `
.${c.root} {
  display: flex;
  gap: 0;
  border-bottom: 1px solid ${t.borderSubtle};
  background: ${t.bgSecondary};
  padding: 0 16px;
}

.${c.tab} {
  position: relative;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 500;
  color: ${t.textSecondary};
  cursor: pointer;
  background: transparent;
  border: none;
  transition: color ${VGUI_TRANSITIONS.base};
  white-space: nowrap;
}

.${c.tab}:hover {
  color: ${t.textPrimary};
  background: ${t.bgTertiary};
}

.${c.tab}.${c.active} {
  color: ${t.textPrimary};
}

.${c.tab}::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 3px;
  background: ${t.accent};
  border-radius: 2px 2px 0 0;
  transform: scaleX(0);
  transform-origin: center;
  transition: transform ${VGUI_TRANSITIONS.base};
}

.${c.tab}.${c.active}::after {
  transform: scaleX(1);
}`;
}

/**
 * Enhanced chip — better spacing and visual prominence
 */
export function vguiChipCssEnhanced(
  c: { root: string; label: string; value: string },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
): string {
  return `
.${c.root} {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  color: ${t.accent};
  transition: all ${VGUI_TRANSITIONS.base};
}

.${c.root}:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
}

.${c.root}.positive {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.2);
  color: ${t.success};
}

.${c.root}.warning {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.2);
  color: ${t.warning};
}

.${c.root}.danger {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
  color: ${t.danger};
}

.${c.label} {
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.${c.value} {
  font-weight: 600;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}`;
}

/**
 * Loading spinner animation
 */
export function vguiLoadingCss(
  c: { spinner: string },
  t: VguiTokensEnhanced = VGUI_ENHANCED_TOKENS,
): string {
  return `
.${c.spinner} {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid ${t.accentLight};
  border-top-color: ${t.accent};
  border-radius: 50%;
  animation: vgui-spin 800ms linear infinite;
}

@keyframes vgui-spin {
  to { transform: rotate(360deg); }
}`;
}
