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
  accent: 'var(--vg-accent-color, #4f9cf9)',
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
 * Caps micro-label — the 10px, 650-weight, wide-tracked uppercase label used
 * for field labels and section captions. `selector` is the full selector to
 * attach it to (e.g. `.ckp-caps`, `.vg-dp-field__label`).
 */
export function vguiCapsCss(selector: string, t: VguiTokens = VGUI_DEFAULT_TOKENS): string {
  return `
${selector} {
  font-size: 10px; font-weight: 650; letter-spacing: 0.12em; text-transform: uppercase;
  color: color-mix(in srgb, ${t.muted} 90%, transparent);
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
