/**
 * Shared VelocityGrid UI primitives — the single source of truth for the
 * *values* (geometry, states, focus treatment) of the plain-DOM controls
 * that the chrome kits render. Both the ext cockpit kit (`.ckp-*`) and the
 * data-provider editor kit (`.vg-dp-*`) were hand-rolled independently and
 * drifted (e.g. the toggle switch); these generators let each kit keep its
 * own class names, state classes, and layout CSS while sourcing the primitive
 * look from one place, so they can no longer diverge.
 *
 * Design constraints this shape satisfies:
 *  - **No shared class names.** Tests and layout CSS in each package couple to
 *    the existing class names (`.ckp-switch`, `.vg-dp-field__label`, …) and the
 *    two switches even use different state classes (`.on` vs `.is-on`). So the
 *    generators are parameterised by the caller's class names — nothing in the
 *    DOM changes, no test breaks.
 *  - **Plain CSS string, no imports.** Kept dependency-free so the lean `data`
 *    package can consume it without pulling in kernel internals, and so it works
 *    inside the editor's pop-out window (a separate document) where the kit just
 *    injects a `<style>` string.
 *  - **Token-driven.** Rules reference the caller-supplied `--vg-*`-derived
 *    tokens; passing a kit's own alias names (`--ckp-*` / `--vg-dp-*`) reproduces
 *    that kit's exact rendered output — this extraction is invariance-preserving.
 *
 * Exposed as a source-direct subpath: `@wellsfargo-starui/velocity-grid/ui/primitives`.
 */

/** CSS value expressions for the tokens the primitives consume. Pass a kit's
 *  own alias vars to reproduce its exact look; omit for the neutral `--vg-*`
 *  defaults. */
export interface VguiTokens {
  /** Accent fill / focus colour. */
  accent: string;
  /** Hairline border colour. */
  border: string;
  /** Muted foreground (knob-off, caps text). */
  muted: string;
  /** Quiet control surface (switch track, input background base for focus wash). */
  surface: string;
  /** Corner radius for square controls. */
  radius: string;
}

export const VGUI_DEFAULT_TOKENS: VguiTokens = {
  accent: 'var(--vg-chrome-accent, var(--vg-focus-ring-color))',
  border: 'var(--vg-border-color, #2a3140)',
  muted: 'var(--vg-muted-fg-color, #9aa4b6)',
  surface: 'color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 4%, transparent)',
  radius: 'var(--vg-radius, 2px)',
};

/** Class names for the toggle-switch primitive (a `<button>` + knob `<span>`). */
export interface VguiSwitchClasses {
  /** Track element class (the button). */
  root: string;
  /** Knob element class (the span inside). */
  knob: string;
  /** State class added to the track when on (`on`, `is-on`, …). */
  on: string;
}

/**
 * Toggle switch — a 36×20 pill with a 14px knob that slides on. "On" is a quiet
 * accent tint on the track (not a solid fill) with an accent knob, matching the
 * ext cockpit `.ckp-switch`.
 */
export function vguiSwitchCss(c: VguiSwitchClasses, t: VguiTokens = VGUI_DEFAULT_TOKENS): string {
  return `
.${c.root} {
  appearance: none; -webkit-appearance: none;
  position: relative; display: inline-block; flex: none; box-sizing: border-box;
  width: 36px; min-width: 36px; max-width: 36px;
  height: 20px; min-height: 20px; max-height: 20px;
  border-radius: 999px; border: 1px solid ${t.border};
  background: ${t.surface}; cursor: pointer; padding: 0; margin: 0;
  overflow: hidden; vertical-align: middle;
  transition: border-color 110ms ease, background 110ms ease;
}
.${c.root} .${c.knob} {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: ${t.muted}; transition: left 140ms ease, background 140ms ease;
  pointer-events: none;
}
.${c.root}.${c.on} {
  border-color: color-mix(in srgb, ${t.accent} 55%, transparent);
  background: color-mix(in srgb, ${t.accent} 14%, transparent);
}
.${c.root}.${c.on} .${c.knob} { left: 18px; background: ${t.accent}; }`;
}

/**
 * Eyebrow — 11px / 600 / 0.1em uppercase. Used for section heads and
 * remaining micro-labels. Field labels no longer use this; they go through
 * `vguiRowCss` at 12.5px / 500. `selector` is the full selector to attach
 * it to (e.g. `.ckp-caps`, `.ckp-band-title`).
 */
export function vguiCapsCss(selector: string, t: VguiTokens = VGUI_DEFAULT_TOKENS): string {
  return `
${selector} {
  font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  color: color-mix(in srgb, ${t.muted} 90%, transparent);
}`;
}

/** Settings row — label + help stacked left, control right on a fixed column edge. */
export interface VguiRowClasses {
  root: string;
  label: string;
  title: string;
  help: string;
  control: string;
  modified?: string;
}

/**
 * Settings row — help sits under the LABEL so long help never displaces
 * the control column. `labelCol` is the left-column width (210px cockpit,
 * 260px DataProvider editor).
 */
export function vguiRowCss(
  c: VguiRowClasses,
  t: VguiTokens = VGUI_DEFAULT_TOKENS,
  opts: { labelCol?: string } = {},
): string {
  const labelCol = opts.labelCol ?? '210px';
  const modified = c.modified
    ? `.${c.root}.${c.modified} { box-shadow: inset 2px 0 0 ${t.accent}; }`
    : '';
  return `
.${c.root} {
  display: grid;
  grid-template-columns: ${labelCol} minmax(0, 1fr);
  gap: 8px 14px;
  align-items: center;
  padding: 9px 16px;
  margin: 0;
  border-bottom: 1px solid color-mix(in srgb, ${t.border} 70%, transparent);
  transition: background 120ms ease, border-color 120ms ease;
}
.${c.root}:hover { background: var(--vg-row-hover-bg, ${t.surface}); }
.${c.root} .${c.label} {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding-left: 10px;
}
.${c.root} .${c.title} {
  font-size: 12.5px; font-weight: 500; line-height: 1.4; letter-spacing: 0;
  text-transform: none; color: var(--vg-fg-color, inherit);
}
.${c.root} .${c.help} {
  font-size: 11px; font-weight: 400; line-height: 1.45; letter-spacing: 0;
  text-transform: none; color: ${t.muted};
}
.${c.root} .${c.control} {
  min-height: 28px; min-width: 0;
  display: flex; align-items: center; justify-content: flex-start;
}
${modified}`;
}

export interface VguiButtonClasses {
  primary: string;
  secondary: string;
  quiet: string;
  danger: string;
}

/** Four-rung button ladder. All rungs share 28px / 12px / 2px radius. */
export function vguiButtonCss(c: VguiButtonClasses, t: VguiTokens = VGUI_DEFAULT_TOKENS): string {
  const shared = `height: 28px; padding: 0 13px; border-radius: ${t.radius}; font-size: 12px; line-height: 1; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; transition: background 120ms ease, border-color 120ms ease, color 120ms ease;`;
  return `
.${c.primary}, .${c.secondary}, .${c.quiet}, .${c.danger} { ${shared} }
.${c.primary} {
  background: ${t.accent}; color: var(--vg-checkbox-checked-fg, #FCFCFC);
  border: 1px solid ${t.accent}; font-weight: 600;
}
.${c.secondary} {
  background: transparent; border: 1px solid ${t.border}; color: var(--vg-fg-color, inherit); font-weight: 500;
}
.${c.quiet} {
  background: transparent; border: 1px solid transparent;
  color: color-mix(in srgb, var(--vg-fg-color, inherit) 80%, transparent); font-weight: 500;
}
.${c.danger} {
  background: transparent; border: 1px solid color-mix(in srgb, var(--vg-neg-color) 45%, transparent);
  color: var(--vg-neg-color); font-weight: 500;
}
.${c.primary}:disabled, .${c.secondary}:disabled, .${c.quiet}:disabled, .${c.danger}:disabled {
  opacity: 0.45; cursor: default;
}`;
}

export interface VguiChipClasses {
  root: string;
  key: string;
  value: string;
  positive: string;
  warning: string;
  negative: string;
  info: string;
}

/** Two-part status chip — muted key on a subtle ground, value on a tinted ground. */
export function vguiChipCss(c: VguiChipClasses, t: VguiTokens = VGUI_DEFAULT_TOKENS): string {
  return `
.${c.root} {
  display: inline-flex; align-items: stretch; overflow: hidden;
  height: 21px; border-radius: ${t.radius}; border: 1px solid ${t.border};
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px; line-height: 1; letter-spacing: 0;
}
.${c.key} {
  display: inline-flex; align-items: center; padding: 0 6px;
  background: ${t.surface}; color: ${t.muted}; text-transform: uppercase; font-weight: 500;
}
.${c.value} {
  display: inline-flex; align-items: center; padding: 0 6px;
  font-variant-numeric: tabular-nums; text-transform: uppercase;
  background: color-mix(in srgb, ${t.border} 40%, transparent);
  color: var(--vg-fg-color, inherit);
}
.${c.root}.${c.positive} .${c.value} {
  background: color-mix(in srgb, var(--vg-pos-color) 16%, transparent); color: var(--vg-pos-color);
}
.${c.root}.${c.warning} .${c.value} {
  background: color-mix(in srgb, var(--vg-warning-color) 16%, transparent); color: var(--vg-warning-color);
}
.${c.root}.${c.negative} .${c.value} {
  background: color-mix(in srgb, var(--vg-neg-color) 16%, transparent); color: var(--vg-neg-color);
}
.${c.root}.${c.info} .${c.value} {
  background: color-mix(in srgb, ${t.accent} 14%, transparent); color: ${t.accent};
}`;
}

export interface VguiTileClasses {
  root: string;
  on: string;
}

/** 30×30 icon tile. Selected = accent fill with accent-fg stroke. */
export function vguiTileCss(c: VguiTileClasses, t: VguiTokens = VGUI_DEFAULT_TOKENS): string {
  return `
.${c.root} {
  width: 30px; height: 30px; box-sizing: border-box; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${t.surface}; border: 1px solid ${t.border}; border-radius: ${t.radius};
  color: var(--vg-fg-color, inherit); cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.${c.root}:hover { background: var(--vg-row-hover-bg, ${t.surface}); }
.${c.root}.${c.on} {
  background: ${t.accent}; border-color: ${t.accent};
  color: var(--vg-checkbox-checked-fg, #FCFCFC);
}`;
}

/**
 * Input interaction layer — the shared hover + accent focus-ring treatment for
 * text inputs / selects / textareas. Emits only `:hover` and `:focus` (plus the
 * transition) for the given selectors; each kit keeps its own base box
 * (padding, size, background) so geometry is unchanged. `selectors` are the base
 * element selectors (e.g. `['.ckp-input']`, `['.vg-dp-field input', …]`).
 */
export function vguiInputInteractionCss(selectors: readonly string[], t: VguiTokens = VGUI_DEFAULT_TOKENS): string {
  if (selectors.length === 0) return '';
  const base = selectors.join(',\n');
  const hover = selectors.map((s) => `${s}:hover`).join(',\n');
  const focus = selectors.map((s) => `${s}:focus`).join(',\n');
  return `
${base} {
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
${hover} {
  border-color: color-mix(in srgb, ${t.muted} 45%, ${t.border});
}
${focus} {
  outline: none;
  border-color: color-mix(in srgb, ${t.accent} 70%, ${t.border});
  box-shadow: 0 0 0 3px color-mix(in srgb, ${t.accent} 16%, transparent);
  background: color-mix(in srgb, ${t.accent} 5%, transparent);
}`;
}
