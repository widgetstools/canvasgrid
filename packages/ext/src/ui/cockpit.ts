/**
 * Cockpit UI kit — shared primitives for the customizer settings modules:
 * section bands, summary chips, checkboxes, pill groups, Lucide icon
 * tiles, settings rows. One injected stylesheet. Tab groups for Phase 4 IA.
 *
 * Two parallel primitive sets live here — "original" (`chip`, `row`, …) and
 * "enhanced" (`actionButtonEnhanced`, `CKP_TOKENS_ENHANCED`, the
 * `vgui*CssEnhanced` generators). They are additive, and adoption across
 * modules is still mixed; that is a documentation note, not a task.
 *
 * Booleans are NOT part of that split any more. `switchToggle` and
 * `switchToggleEnhanced` both return the kernel's canonical
 * `<input class="vg-checkbox">` — one element type, one paint, one set of
 * semantics for a boolean everywhere in the drawer. The pill-switch
 * rendering and its two stylesheet generators are gone; the legacy
 * `.ckp-switch` / `.ckp-switch-enhanced` classes ride along on the input
 * so existing selectors keep resolving.
 *
 * Every metric, type and colour value below derives from
 * `./chromeTokens.ts`. `npm run audit:ext-chrome -- <demo-url>` measures the
 * rendered result against that token set; a value not on the scale is a bug.
 */
import { ColorPickerControl, parseColor, rgbaToString } from '@wellsfargo-starui/velocity-grid';
import type { BandComplexity, TabDefinition, TabGroup } from './tabGroup';
export {
  appendBandsByComplexity,
  createSettingsAdvancedTabs,
  createSimpleTabGroup,
  createTabGroup,
  markBandComplexity,
} from './tabGroup';
export type { BandComplexity, TabDefinition, TabGroup };
export { workflowLink, workflowStrip } from './workflowLink';
export type { WorkflowLinkOpts } from './workflowLink';
import { lucideBundle } from '@wellsfargo-starui/velocity-grid/icons/lucide.generated';
import {
  vguiCapsCss,
  vguiInputInteractionCss,
  vguiRowCss,
  vguiButtonCss,
  vguiChipCss,
  vguiTileCss,
  type VguiTokens,
} from '@wellsfargo-starui/velocity-grid/ui/primitives';
import {
  vguiButtonCssEnhanced,
  vguiRowCssEnhanced,
  vguiInputCssEnhanced,
  vguiBandCssEnhanced,
  vguiTabsCssEnhanced,
  vguiChipCssEnhanced,
  vguiLoadingCss,
  VGUI_SPACING,
  VGUI_TYPOGRAPHY,
  VGUI_TRANSITIONS,
  type VguiTokensEnhanced,
} from '@wellsfargo-starui/velocity-grid/ui/primitives-enhanced';
import { ENGINE_WIRE_HINT, type ExtEngineName } from '../extension/engines';

/** Cockpit's `--ckp-*` aliases → shared primitive generators. Passing the kit's
 *  own tokens reproduces the exact prior rendering (invariance-preserving). */
const CKP_TOKENS: VguiTokens = {
  accent: 'var(--ckp-accent)',
  border: 'var(--ckp-input-border)',
  muted: 'var(--ckp-muted)',
  surface: 'var(--ckp-input-bg)',
  radius: 'var(--vg-radius, 2px)',
};

/** Enhanced tokens for premium design system */
const CKP_TOKENS_ENHANCED: VguiTokensEnhanced = {
  accent: 'var(--ckp-accent, #3b82f6)',
  accentLight: 'rgba(59, 130, 246, 0.2)',
  accentDark: '#1e40af',
  success: 'var(--ckp-success, #10b981)',
  warning: 'var(--ckp-warning, #f59e0b)',
  danger: 'var(--ckp-danger, #ef4444)',
  info: '#06b6d4',
  bgPrimary: 'var(--ckp-bg-primary, #0f1419)',
  bgSecondary: 'var(--ckp-bg-secondary, #1a1f2e)',
  bgTertiary: 'var(--ckp-bg-tertiary, #24293d)',
  borderStrong: 'var(--ckp-border-strong, #32384f)',
  borderSubtle: 'rgba(74, 82, 113, 0.6)',
  borderLight: 'rgba(74, 82, 113, 0.3)',
  textPrimary: 'var(--ckp-text-primary, #e5e9f0)',
  textSecondary: 'var(--ckp-text-secondary, #c5cbd7)',
  textTertiary: 'var(--ckp-text-tertiary, #9aa4b8)',
  textMuted: 'var(--ckp-text-muted, #7a8599)',
  // Aliased to the shared kernel elevation scale (tokens.css :root) — see
  // primitives-enhanced.ts's matching comment.
  shadow: 'var(--vg-shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.12))',
  shadowMd: 'var(--vg-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15))',
  focusRing: '0 0 0 3px rgba(59, 130, 246, 0.2)',
  border: CKP_TOKENS.border,
  muted: CKP_TOKENS.muted,
  surface: CKP_TOKENS.surface,
  radius: CKP_TOKENS.radius,
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Section head + body. Click the head to collapse/expand — the chevron is
 *  the affordance, so it must work. No ordinal numbers. */
export function band(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'ckp-band');
  const head = el('button', 'ckp-band-head') as HTMLButtonElement;
  head.type = 'button';
  head.setAttribute('aria-expanded', 'true');
  const chev = el('span', 'ckp-band-chevron');
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = lucideSvg('chevron-down', 14);
  head.appendChild(chev);
  head.appendChild(el('span', 'ckp-band-title', title));
  head.addEventListener('click', () => {
    const collapsed = root.classList.toggle('is-collapsed');
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  root.appendChild(head);
  const body = el('div', 'ckp-band-body');
  root.appendChild(body);
  return { root, body };
}

export type ChipTone = 'positive' | 'info' | 'warning' | 'negative' | 'neutral';

/** `LABEL value` summary chip. Returns a setter for live updates. */
export function chip(label: string, value: string, tone: ChipTone = 'neutral'): {
  root: HTMLElement;
  set(value: string, tone?: ChipTone): void;
} {
  const root = el('span', `ckp-chip ${tone}`);
  root.appendChild(el('span', 'ckp-chip-label', label));
  const val = el('span', 'ckp-chip-value', value);
  root.appendChild(val);
  return {
    root,
    set(v, t) {
      val.textContent = v;
      if (t) root.className = `ckp-chip ${t}`;
    },
  };
}

/** Canonical boolean — kernel `.vg-checkbox`. */
export function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const box = el('input', 'vg-checkbox') as HTMLInputElement;
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('click', () => onChange(box.checked));
  return box;
}

/**
 * Boolean control for ext cockpit panes.
 *
 * Returns the kernel's canonical `<input class="vg-checkbox">`. A boolean is
 * one control with one element type and one paint across the whole drawer —
 * the pill switch is retired.
 *
 * The legacy `.ckp-switch` class rides along so selectors that target it
 * (`columnSettings.test.ts`, any consumer CSS) still resolve, and the
 * `(checked, onChange)` signature is unchanged, so all 37 call sites and the
 * `switchToggleEnhanced` alias below need no edit. `.click()` behaves as
 * before; the semantics move from `aria-pressed` to the input's own
 * `checked`, which is what a checkbox is supposed to expose.
 */
function canonicalCheckbox(
  extraClass: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const box = el('input', `vg-checkbox ${extraClass}${checked ? ' on' : ''}`) as HTMLInputElement;
  box.type = 'checkbox';
  box.checked = checked;
  box.setAttribute('aria-label', checked ? 'On' : 'Off');
  box.addEventListener('click', () => {
    box.classList.toggle('on', box.checked);
    box.setAttribute('aria-label', box.checked ? 'On' : 'Off');
    onChange(box.checked);
  });
  return box;
}

export function switchToggle(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  return canonicalCheckbox('ckp-switch', checked, onChange);
}

/**
 * Deprecated alias of `switchToggle` — both render the canonical checkbox.
 * Kept so the "enhanced" call sites need no edit; prefer `switchToggle`.
 */
export function switchToggleEnhanced(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  return canonicalCheckbox('ckp-switch-enhanced', checked, onChange);
}

/** Segmented pill group (single select). */
export function pillGroup(
  options: Array<[value: string, label: string]>,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const root = el('div', 'ckp-pills');
  const sync = (active: string): void => {
    root.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === active);
    });
  };
  for (const [v, label] of options) {
    const b = el('button', 'ckp-pill', label);
    b.type = 'button';
    b.dataset.v = v;
    b.addEventListener('click', () => { sync(v); onChange(v); });
    root.appendChild(b);
  }
  sync(value);
  return root;
}

/** 24×24 Lucide SVG markup for `name` ('' when unknown). */
export function lucideSvg(name: string, size = 14): string {
  const d = lucideBundle[name];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

/** Icon tile button for the indicator grid. */
export function iconTile(name: string, selected: boolean, onClick: () => void): HTMLElement {
  const b = el('button', `ckp-tile${selected ? ' on' : ''}`);
  b.type = 'button';
  b.title = name;
  b.innerHTML = lucideSvg(name);
  b.addEventListener('click', onClick);
  return b;
}

/** Enhanced action button — primary (Save, Done) */
export function actionButtonEnhanced(label: string, icon?: string): HTMLButtonElement {
  const btn = el('button', 'ckp-btn-primary-enhanced') as HTMLButtonElement;
  btn.type = 'button';
  if (icon) {
    btn.innerHTML = `${lucideSvg(icon, 12)}<span>${label}</span>`;
  } else {
    btn.textContent = label;
  }
  return btn;
}

/** Enhanced reset button — secondary (Reset, Cancel) */
export function resetButtonEnhanced(label: string, icon?: string): HTMLButtonElement {
  const btn = el('button', 'ckp-btn-secondary-enhanced') as HTMLButtonElement;
  btn.type = 'button';
  if (icon) {
    btn.innerHTML = `${lucideSvg(icon, 12)}<span>${label}</span>`;
  } else {
    btn.textContent = label;
  }
  return btn;
}

/**
 * Animate save button through spinner → checkmark → idle cycle.
 * Shows visual feedback that the operation is in progress and succeeded.
 *
 * Returns a cancel function that clears both pending timeouts without
 * touching the button or calling `onComplete` — callers whose `destroy()`/
 * `refresh()` can run mid-animation (the button/its host may already be
 * gone by then) must call this to avoid a stray `onComplete()` → `render()`
 * on a torn-down module.
 */
export function animateSaveButton(btn: HTMLButtonElement, onComplete?: () => void): () => void {
  const originalHTML = btn.innerHTML;
  btn.classList.add('ckp-btn-saving');
  btn.disabled = true;

  // Show spinner for 300ms
  btn.innerHTML = `<span class="ckp-spinner"></span><span>Saving...</span>`;

  let t2: ReturnType<typeof setTimeout> | undefined;
  const t1 = setTimeout(() => {
    // Show checkmark for 400ms
    btn.innerHTML = `${lucideSvg('check', 12)}<span>Saved</span>`;
    btn.classList.add('ckp-btn-saved');

    t2 = setTimeout(() => {
      // Return to normal state
      btn.innerHTML = originalHTML;
      btn.classList.remove('ckp-btn-saving', 'ckp-btn-saved');
      btn.disabled = false;
      onComplete?.();
    }, 400);
  }, 300);

  return () => {
    clearTimeout(t1);
    if (t2 !== undefined) clearTimeout(t2);
  };
}

/**
 * Apply visual change indicator to a row/band.
 * Shows a left-side accent border and optional badge.
 */
export function applyChangeIndicator(element: HTMLElement, show: boolean = true): void {
  if (show) {
    element.classList.add('ckp-has-changes');
  } else {
    element.classList.remove('ckp-has-changes');
  }
}

/** `LABEL` caps micro-label. */
export function caps(text: string): HTMLElement {
  return el('span', 'ckp-caps', text);
}

/** LABEL + control row. Help stacks under the label so the control column stays flush. */
export function row(label: string, control: HTMLElement, help?: string): HTMLElement {
  const root = el('div', 'ckp-row');
  const left = el('div', 'ckp-row-label');
  left.appendChild(el('span', 'ckp-row-title', label));
  if (help) left.appendChild(el('div', 'ckp-help', help));
  const wrap = el('div', 'ckp-row-control');
  wrap.appendChild(control);
  root.append(left, wrap);
  return root;
}

/** Shared empty state — icon + heading + body + optional action. */
export function emptyState(opts: {
  title: string;
  description?: string;
  icon?: string;
  action?: HTMLElement;
}): HTMLElement {
  const root = el('div', 'ckp-empty');
  const icon = el('div', 'ckp-empty-icon');
  icon.innerHTML = lucideSvg(opts.icon ?? 'inbox', 22);
  root.appendChild(icon);
  root.appendChild(el('h3', 'ckp-empty-title', opts.title));
  if (opts.description) root.appendChild(el('p', 'ckp-empty-body', opts.description));
  if (opts.action) root.appendChild(opts.action);
  return root;
}

/**
 * D-F8 — THE shared "this module's engine isn't wired" surface. Every module
 * that reads `ctx.engines.get(...)` renders this when the answer is `null`,
 * so a missing engine is always VISIBLE and always says the same thing
 * (before this, three modules had three strategies and one of them was to
 * silently succeed).
 *
 * `variant: 'empty'` (default) replaces a pane/section with a full empty
 * state — for a module that can do nothing at all without its engine.
 * `variant: 'banner'` returns a compact inline strip — for a module that
 * still works, but where ONE action just failed because the engine is
 * absent (e.g. Column Settings saving a caption).
 *
 * Returns the node; the caller decides where it goes.
 */
export function engineMissingNotice(
  engine: ExtEngineName,
  opts: { feature: string; icon?: string; variant?: 'empty' | 'banner'; detail?: string },
): HTMLElement {
  const hint = ENGINE_WIRE_HINT[engine];
  const title = `${hint.label} engine not wired`;
  const description = opts.detail ?? `${opts.feature} requires ${hint.wire}.`;
  if (opts.variant === 'banner') {
    const root = el('div', 'ckp-notice');
    root.setAttribute('role', 'status');
    root.dataset.engine = engine;
    const icon = el('span', 'ckp-notice-icon');
    icon.innerHTML = lucideSvg('triangle-alert', 13);
    const text = el('div', 'ckp-notice-text');
    text.appendChild(el('strong', 'ckp-notice-title', title));
    text.appendChild(el('span', 'ckp-notice-body', description));
    root.append(icon, text);
    return root;
  }
  const root = emptyState({ title, description, icon: opts.icon ?? 'unplug' });
  root.dataset.engine = engine;
  return root;
}

/** Capture `.ckp-pane-body` scroll before a full pane rebuild. */
export function takePaneScroll(pane: HTMLElement): number {
  return (pane.querySelector('.ckp-pane-body') as HTMLElement | null)?.scrollTop ?? 0;
}

/** Restore scroll after rebuilding sticky head + body chrome. */
export function restorePaneScroll(pane: HTMLElement, top: number): void {
  const body = pane.querySelector('.ckp-pane-body') as HTMLElement | null;
  if (body) body.scrollTop = top;
}

/**
 * Append sticky pane head + scrollable body. Content goes on the
 * returned body so the action bar stays pinned while bands scroll.
 */
export function appendPaneChrome(pane: HTMLElement, head: HTMLElement): HTMLElement {
  const body = el('div', 'ckp-pane-body');
  pane.append(head, body);
  return body;
}

export function textInput(value: string, onInput: (v: string) => void, opts?: { placeholder?: string; mono?: boolean; className?: string }): HTMLInputElement {
  const i = el('input', `ckp-input${opts?.mono ? ' mono' : ''}${opts?.className ? ` ${opts.className}` : ''}`);
  i.type = 'text';
  i.value = value;
  if (opts?.placeholder) i.placeholder = opts.placeholder;
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

export function numberInput(value: number | undefined, onInput: (v: number | undefined) => void, opts?: { placeholder?: string; suffix?: string }): HTMLElement {
  const wrap = el('span', 'ckp-numwrap');
  const i = el('input', 'ckp-input ckp-num');
  i.type = 'number';
  i.value = value === undefined ? '' : String(value);
  if (opts?.placeholder) i.placeholder = opts.placeholder;
  i.addEventListener('input', () => onInput(i.value === '' ? undefined : Number(i.value)));
  wrap.appendChild(i);
  if (opts?.suffix) wrap.appendChild(el('span', 'ckp-suffix', opts.suffix));
  return wrap;
}

/** Swatch + value label + clear — same ColorPickerControl as Grid Options. */
export function colorField(value: string | undefined, onChange: (v: string | undefined) => void): HTMLElement {
  const root = el('div', 'ckp-colorfield');
  const hex = el('span', 'ckp-hex mono');
  const clear = el('button', 'ckp-mini', '—');
  clear.type = 'button';
  clear.title = 'Clear';

  const toLabel = (v: string | undefined): string => {
    if (!v) return '';
    const c = parseColor(v);
    if (!c) return v;
    if (c.a < 1) return rgbaToString(c);
    const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
  };

  const picker = new ColorPickerControl(value ?? '#888888', (rgba) => {
    hex.textContent = toLabel(rgba);
    root.classList.remove('unset');
    onChange(rgba);
  });

  const sync = (v: string | undefined): void => {
    if (v) {
      picker.setValue(v);
      hex.textContent = toLabel(v);
      root.classList.remove('unset');
    } else {
      hex.textContent = '';
      hex.dataset.placeholder = 'none';
      root.classList.add('unset');
    }
  };
  clear.addEventListener('click', () => {
    sync(undefined);
    onChange(undefined);
  });
  sync(value);
  root.append(picker.el, hex, clear);
  return root;
}

export function select(
  options: Array<[value: string, label: string]>,
  value: string,
  onChange: (v: string) => void,
  className = '',
): HTMLSelectElement {
  const s = el('select', `ckp-input ckp-select${className ? ` ${className}` : ''}`);
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    s.appendChild(o);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// ─── exports for enhanced design system ────────────────────────────────────

export {
  vguiSwitchCssEnhanced,
  vguiButtonCssEnhanced,
  vguiRowCssEnhanced,
  vguiInputCssEnhanced,
  vguiBandCssEnhanced,
  vguiTabsCssEnhanced,
  vguiChipCssEnhanced,
  vguiLoadingCss,
  VGUI_ENHANCED_TOKENS,
  VGUI_SPACING,
  VGUI_TRANSITIONS,
  VGUI_TYPOGRAPHY,
  type VguiTokensEnhanced,
  type VguiSpacing,
  type VguiTypography,
  type VguiTransitions,
} from '@wellsfargo-starui/velocity-grid/ui/primitives-enhanced';

export { CKP_TOKENS_ENHANCED };

// ─── stylesheet ────────────────────────────────────────────────────────────

export function injectCockpitStyles(): void {
  const ID = 'ckp-cockpit-styles';
  let style = document.getElementById(ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = ID;
    document.head.appendChild(style);
  }
  style.textContent = `
/* The drawer body stops scrolling as a whole and hands scrolling to the
   two panes: the list rail and the editor pane scroll INDEPENDENTLY. */
.vgext-sheet-body:has(> .ckp) { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.ckp {
  flex: 1 1 auto; display: grid; grid-template-columns: 228px 1fr; height: 100%; min-height: 0;
  font-size: 12.5px; line-height: 1.4;
  color: var(--vg-fg-color, #e5e9f0);
  --ckp-accent: var(--vg-chrome-accent);
  --ckp-muted: var(--vg-muted-fg-color, #8a93a6);
  /* Pane hairlines — solid theme border, then +10% fg for readable opacity. */
  --ckp-border: color-mix(in srgb, var(--vg-border-color, #2a3140) 90%, var(--vg-fg-color, #e5e9f0) 10%);
  --ckp-surface: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 3.5%, transparent);
  --ckp-surface-2: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 5.5%, transparent);
  /* Control fill/stroke — dedicated input tokens, +10% fg on the stroke. */
  --ckp-input-bg: var(--vg-input-bg, var(--ckp-surface));
  --ckp-input-border: color-mix(in srgb, var(--vg-input-border, var(--vg-border-color, #2a3140)) 90%, var(--vg-fg-color, #e5e9f0) 10%);
}
/* Flat settings panels (no list rail) — single column with real gutters.
   Master-detail modules keep the 2-col grid above; flat modules MUST add
   this class or content lands in the rail column and sticks to edges. */
.ckp.ckp-flat {
  display: flex;
  flex-direction: column;
  grid-template-columns: unset;
  padding: var(--vgext-space-4, 16px) var(--vgext-space-4, 16px) var(--vgext-space-5, 24px);
  overflow: hidden;
  gap: 0;
}
.ckp.ckp-flat > .ckp-pane-head {
  flex: 0 0 auto;
  margin-bottom: 0;
  padding: 0 0 var(--vgext-space-3, 12px);
  background: transparent;
  z-index: 2;
}
.ckp.ckp-flat > .ckp-flat-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}
.ckp.ckp-flat > .ckp-flat-foot {
  flex: 0 0 auto;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ckp-border);
}
.ckp * { box-sizing: border-box; }
${vguiCapsCss('.ckp-caps', CKP_TOKENS)}
${vguiCapsCss('.ckp-band-title', CKP_TOKENS)}
${vguiRowCss({ root: 'ckp-row', label: 'ckp-row-label', title: 'ckp-row-title', help: 'ckp-help', control: 'ckp-row-control', modified: 'is-modified' }, CKP_TOKENS, { labelCol: '210px' })}
${vguiButtonCss({ primary: 'ckp-btn-primary', secondary: 'ckp-btn-secondary', quiet: 'ckp-btn-quiet', danger: 'ckp-btn-danger' }, CKP_TOKENS)}
${vguiChipCss({ root: 'ckp-chip', key: 'ckp-chip-label', value: 'ckp-chip-value', positive: 'positive', warning: 'warning', negative: 'negative', info: 'info' }, CKP_TOKENS)}
${vguiTileCss({ root: 'ckp-tile', on: 'on' }, CKP_TOKENS)}
.ckp-help, .ckp-hint {
  font-size: var(--vgext-help-size, 11px); letter-spacing: 0; color: var(--ckp-muted); margin-top: 2px;
  line-height: 1.45; text-transform: none; font-weight: 400;
}
/* rail */
.ckp-rail {
  border-right: 1px solid var(--ckp-border);
  padding: var(--vgext-space-4, 16px);
  overflow-y: auto; min-height: 0;
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 1.5%, transparent);
}
.ckp-rail-head { display: flex; align-items: center; gap: var(--vgext-space-2, 8px); padding: 0 0 var(--vgext-space-3, 12px); }
.ckp-rail-head .ckp-caps { flex: 1 1 auto; color: var(--vg-fg-color, #e5e9f0); letter-spacing: 0.1em; }
/* One counter grammar. GROUPS rendered "0" flush to its label, RULES a
 * zero-padded "00" pushed away from it, and LAYOUTS right-aligned its count
 * across the popover — three readings of the same idea. */
.ckp-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 var(--vgext-space-2, 8px);
  border-radius: var(--vg-radius, 2px);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 10%, transparent);
  font-family: var(--vg-cell-font-family, ui-monospace, Menlo, Consolas, monospace);
  font-size: 10.5px; font-weight: 600;
  color: var(--ckp-muted); font-variant-numeric: tabular-nums;
}
/* The create affordance is a real 28px control, the same size as every
 * other control in the drawer — it used to be a 22px glyph that the empty
 * state had to point at in prose. */
.ckp-addbtn {
  width: var(--vgext-control-h, 28px); height: var(--vgext-control-h, 28px);
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid var(--ckp-input-border);
  color: var(--vg-fg-color, #e5e9f0); border-radius: var(--vg-radius, 2px);
  font-size: 15px; line-height: 1; cursor: pointer; padding: 0;
  transition: background var(--vgext-t, 120ms ease), border-color var(--vgext-t, 120ms ease);
}
.ckp-addbtn:hover {
  background: var(--vg-row-hover-bg, color-mix(in srgb, var(--ckp-accent) 12%, transparent));
  border-color: var(--ckp-accent);
}
.ckp-addbtn:focus-visible { outline: 2px solid var(--ckp-accent); outline-offset: -2px; }
.ckp-rail-row {
  display: flex; align-items: center; gap: var(--vgext-space-2, 8px); min-height: var(--vgext-row-h, 30px); padding: 0 var(--vgext-space-2, 8px); margin: 1px 0;
  cursor: pointer; border-radius: var(--vg-radius, 2px);
  border: 1px solid transparent;
  transition: background 110ms ease, border-color 110ms ease;
}
.ckp-rail-row:hover { background: var(--ckp-surface); }
.ckp-rail-row.active {
  background: color-mix(in srgb, var(--ckp-accent) 14%, transparent);
  border-color: color-mix(in srgb, var(--ckp-accent) 28%, transparent);
  box-shadow: inset 2px 0 0 var(--ckp-accent);
}
.ckp-rail-row.muted .ckp-rail-name { opacity: 0.45; }
.ckp-rail-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.ckp-mini {
  background: transparent; border: none; color: var(--ckp-muted); cursor: pointer;
  padding: 2px; font: inherit; display: inline-flex; align-items: center;
  border-radius: var(--vg-radius, 2px);
  transition: color 110ms ease, background 110ms ease;
}
.ckp-mini:hover { color: var(--vg-fg-color, #e5e9f0); background: var(--ckp-surface); }
/* pane — sticky action head; bands scroll underneath */
.ckp-pane {
  min-width: 0; min-height: 0;
  display: flex; flex-direction: column;
  overflow: hidden; padding: 0;
}
.ckp-pane-head {
  flex: 0 0 auto;
  display: flex; gap: var(--vgext-space-2, 8px); align-items: center;
  margin: 0; padding: var(--vgext-space-3, 12px) var(--vgext-space-4, 16px);
  border-bottom: 1px solid var(--ckp-border);
  background: color-mix(in srgb, var(--vg-bg-color, #12161e) 88%, var(--vg-fg-color, #e5e9f0) 6%);
  z-index: 2;
}
.ckp-pane-body {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; padding: var(--vgext-space-4, 16px) var(--vgext-space-4, 16px) var(--vgext-space-5, 24px);
}
.ckp-title {
  flex: 1 1 auto; font-size: var(--vgext-title-size, 15px); font-weight: var(--vgext-title-weight, 600); letter-spacing: var(--vgext-title-track, -0.01em);
  color: var(--vg-fg-color, #e5e9f0);
}
/* chips strip */
.ckp-chips-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.ckp-controls-strip { display: flex; flex-wrap: wrap; gap: 8px; row-gap: 8px; align-items: center; margin-bottom: 16px; }
.ckp-controls-strip > * { flex: 0 0 auto; }
.ckp-strip-pair { display: inline-flex; align-items: center; gap: 8px; }
.ckp-controls-strip .ckp-numwrap { width: auto; }
.ckp-controls-strip .ckp-num { width: 64px; }
.ckp-controls-strip > .ckp-caps { white-space: nowrap; }
.ckp-controls-strip > * + .ckp-caps { margin-left: 10px; }
/* bands */
/* bands — chevron means collapse; head is the control */
/* Sections are separated by space, not by a filled bar and a rule each. */
.ckp-band { margin: 0; }
.ckp-band + .ckp-band { margin-top: 10px; }
.ckp-band-head {
  appearance: none;
  display: flex; gap: 8px; align-items: center;
  width: 100%;
  height: 28px; padding: 0 16px; margin: 0;
  background: transparent; border: none;
  color: inherit; font: inherit; text-align: left;
  cursor: pointer;
  overflow: visible;
  transition: color 120ms ease;
}
.ckp-band-head:hover .ckp-band-title { color: var(--vg-fg-color, #e5e9f0); }
.ckp-band-head:hover .ckp-band-chevron { color: var(--vg-fg-color, #e5e9f0); }
.ckp-band-head:focus-visible { outline: 2px solid var(--ckp-accent); outline-offset: -2px; }
.ckp-band-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: none;
  color: var(--ckp-muted);
  line-height: 0;
  overflow: visible;
  transition: transform 140ms ease;
}
.ckp-band-chevron svg {
  display: block;
  width: 14px;
  height: 14px;
  stroke-width: 2.75;
}
.ckp-band.is-collapsed .ckp-band-chevron {
  transform: rotate(-90deg);
}
.ckp-band.is-collapsed .ckp-band-body { display: none; }
.ckp-band-body { padding: 0 0 4px; max-width: 560px; }
/* rows + inputs — control column is a single vertical edge */
.ckp-row-control > .ckp-input:not(.ckp-num),
.ckp-row-control > .ckp-select { width: 100%; max-width: 420px; }
.ckp-input {
  background: var(--ckp-input-bg); color: inherit;
  border: 1px solid var(--ckp-input-border); border-radius: var(--vg-radius, 2px);
  padding: 0 10px; font: inherit; width: 100%; height: 28px; box-sizing: border-box;
}
${vguiInputInteractionCss(['.ckp-input'], CKP_TOKENS)}
.ckp-input.mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; }
.ckp-num { width: 96px; max-width: 100%; }
.ckp-numwrap { display: inline-flex; align-items: center; gap: 6px; width: auto; max-width: 100%; }
.ckp-numwrap .ckp-num { flex: 0 0 auto; width: 96px; }
.ckp-suffix { font-size: 11px; color: var(--ckp-muted); font-weight: 400; }
.ckp-select { width: auto; min-width: 110px; font-size: 12px; font-weight: 500; }
/* pills */
.ckp-pills {
  display: inline-flex; height: 28px; border: 1px solid var(--ckp-input-border); border-radius: var(--vg-radius, 2px);
  overflow: hidden; background: var(--ckp-input-bg); box-sizing: border-box;
}
.ckp-pill {
  background: transparent; border: none; border-right: 1px solid var(--ckp-input-border);
  color: var(--ckp-muted); font-size: 12px; font-weight: 500;
  padding: 0 12px; cursor: pointer; height: 100%;
  transition: color 120ms ease, background 120ms ease;
}
.ckp-pill:last-child { border-right: none; }
.ckp-pill:hover { color: var(--vg-fg-color, #e5e9f0); background: var(--vg-row-hover-bg, var(--ckp-surface)); }
.ckp-pill.on {
  background: color-mix(in srgb, var(--ckp-accent) 14%, transparent);
  color: var(--vg-fg-color, #e5e9f0);
  box-shadow: inset 0 -2px 0 var(--ckp-accent);
}
/* icon tiles */
.ckp-tilegrid { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 10px; }
/* color field */
.ckp-colorfield {
  display: flex; align-items: center; gap: 0; height: 28px; box-sizing: border-box;
  border: 1px solid var(--ckp-input-border); border-radius: var(--vg-radius, 2px);
  overflow: hidden; background: var(--ckp-input-bg);
}
.ckp-colorfield .vg-colorpicker { flex: 0 0 auto; margin: 2px 0 2px 2px; }
.ckp-colorfield .ckp-hex {
  border: none; border-radius: 0; flex: 1 1 auto; min-width: 0;
  padding: 0 8px; font-size: 11px; color: var(--vg-fg-color, #e5e9f0);
  opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ckp-colorfield.unset .ckp-hex::before { content: attr(data-placeholder); opacity: 0.45; }
.ckp-colorfield .ckp-mini { padding: 0 8px; }
.ckp-colorfield.unset .vg-colorpicker-swatch { opacity: 0.35; }
/* type toggles (B/I/U/S) */
.ckp-typebar { display: flex; gap: 8px; align-items: center; }
.ckp-toggle {
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--ckp-input-bg); border: 1px solid var(--ckp-input-border); border-radius: var(--vg-radius, 2px);
  color: var(--ckp-muted); cursor: pointer; font-size: 12px; padding: 0;
  transition: color 110ms ease, border-color 110ms ease, background 110ms ease;
}
.ckp-toggle.on {
  border-color: color-mix(in srgb, var(--ckp-accent) 50%, transparent);
  color: var(--ckp-accent); background: color-mix(in srgb, var(--ckp-accent) 12%, transparent);
}
.ckp-toggle b { font-weight: 800; } .ckp-toggle i { font-style: italic; } .ckp-toggle u { text-decoration: underline; } .ckp-toggle s { text-decoration: line-through; }
/* chips for target columns */
.ckp-colchips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.ckp-colchip {
  display: inline-flex; gap: 4px; align-items: center;
  background: color-mix(in srgb, var(--ckp-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--ckp-accent) 35%, transparent);
  border-radius: var(--vg-radius, 2px); padding: 3px 4px 3px 8px; font-size: 11px;
}
.ckp-warn { color: var(--vg-warning-color, #f0b429); font-size: 11px; font-weight: 400; letter-spacing: 0; text-transform: none; }
/* expression + errors */
.ckp-editor .cm-editor { width: 100%; border-radius: var(--vg-radius, 2px); overflow: hidden; }
.ckp-error {
  margin-top: 8px; padding: 8px 10px;
  border: 1px solid color-mix(in srgb, #e2695f 45%, transparent);
  border-radius: var(--vg-radius, 2px); color: #e2695f;
  background: color-mix(in srgb, #e2695f 8%, transparent);
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; white-space: pre-wrap;
}
.ckp-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 36px 24px; text-align: center; color: var(--ckp-muted); line-height: 1.5;
}
.ckp-empty-icon { opacity: 0.4; line-height: 1; color: var(--ckp-muted); }
.ckp-empty-title {
  margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.015em;
  color: var(--vg-fg-color, #e5e9f0);
}
.ckp-empty-body { margin: 0; max-width: 22rem; font-size: 12.5px; line-height: 1.45; }
/* D-F8 — inline "engine not wired" strip (engineMissingNotice variant
   'banner'): the module still renders, but one action just failed. Same
   warning token as .ckp-warn, same tinted-surface grammar as .ckp-error. */
.ckp-notice {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 0 0 12px; padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--vg-warning-color, #f0b429) 40%, transparent);
  border-radius: var(--vg-radius, 2px);
  background: color-mix(in srgb, var(--vg-warning-color, #f0b429) 9%, transparent);
  line-height: 1.45;
}
.ckp-notice-icon { flex: 0 0 auto; margin-top: 1px; color: var(--vg-warning-color, #f0b429); line-height: 1; }
.ckp-notice-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ckp-notice-title { font-size: 12px; font-weight: 600; color: var(--vg-warning-color, #f0b429); }
.ckp-notice-body { font-size: 11.5px; color: var(--ckp-muted); }
/* style chrome (ribbon Font/Borders cluster) embedded in the rules pane */
.ckp-stylechrome .vgext-rb-stepper { display: none; }
.ckp-stylechrome .vgext-rb-grp:has([data-vg-field='halign']) { display: none; }
.ckp-stylechrome .vgext-rb-cluster { flex-wrap: wrap; }
/* format anchor */
.ckp-fmtbtn {
  display: inline-flex; gap: var(--vgext-space-2, 8px); align-items: center;
  background: var(--ckp-input-bg); border: 1px solid var(--ckp-input-border); border-radius: var(--vg-radius, 2px);
  color: inherit; font-family: inherit; font-size: 12px; font-weight: 500;
  height: var(--vgext-control-h, 28px); box-sizing: border-box;
  padding: 0 var(--vgext-control-px, 13px); cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.ckp-fmtbtn:hover {
  border-color: color-mix(in srgb, var(--ckp-accent) 45%, var(--ckp-input-border));
  background: color-mix(in srgb, var(--ckp-accent) 6%, transparent);
}
/* Placement menu (shared with Formatting toolbar icon picker). Shell from
   .vgext-menu (titleBar styles); this only shapes the list itself. */
.vgext-ip-placemenu {
  font-size: 12px; min-width: 158px;
  display: flex; flex-direction: column;
}
.vgext-ip-placehead {
  font-size: var(--vgext-eyebrow-size, 11px);
  font-weight: var(--vgext-eyebrow-weight, 600);
  letter-spacing: var(--vgext-eyebrow-track, 0.1em);
  text-transform: uppercase;
  color: var(--vg-muted-fg-color, #7f8ba0); padding: var(--vgext-space-2, 8px) var(--vgext-space-2, 8px) var(--vgext-space-1, 4px);
}
.vgext-ip-placehead:first-child { padding-top: 3px; }
.vgext-ip-placeitem {
  appearance: none; -webkit-appearance: none; border: none; background: transparent; border-radius: 2px;
  padding: 6px 10px; text-align: left; font: inherit; font-size: 12px;
  color: var(--vg-fg-color, #d6dce8); cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  transition: background 90ms ease, color 90ms ease;
}
.vgext-ip-placeitem:hover { background: color-mix(in srgb, var(--vg-chrome-accent) 18%, transparent); }
.vgext-ip-placeitem.is-active { color: var(--vg-chrome-accent); background: color-mix(in srgb, var(--vg-chrome-accent) 12%, transparent); }
.vgext-ip-placeitem.is-active::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--vg-chrome-accent); flex: 0 0 auto; }
@media (prefers-reduced-motion: reduce) {
  .ckp-rail-row, .ckp-input, .ckp-actbtn, .ckp-pill, .ckp-tile, .ckp-toggle, .ckp-fmtbtn, .ckp-band-chevron { transition: none; }
}
/* ─── Enhanced Design System (Phase 1) ─────────────────────────────────── */
/* Premium visual design with smooth animations and sophisticated hierarchy */
${vguiButtonCssEnhanced({ primary: 'ckp-btn-primary-enhanced', secondary: 'ckp-btn-secondary-enhanced', tertiary: 'ckp-btn-tertiary-enhanced' }, CKP_TOKENS_ENHANCED)}
${vguiInputCssEnhanced({ root: 'ckp-input-enhanced' }, CKP_TOKENS_ENHANCED)}
${vguiRowCssEnhanced({ root: 'ckp-row-enhanced', label: 'ckp-row-label', title: 'ckp-row-title', help: 'ckp-help', control: 'ckp-row-control', modified: 'is-modified' }, CKP_TOKENS_ENHANCED, { labelCol: '210px' })}
${vguiBandCssEnhanced({ root: 'ckp-band-enhanced', head: 'ckp-band-head-enhanced', body: 'ckp-band-body-enhanced', title: 'ckp-band-title-enhanced', chevron: 'ckp-band-chevron-enhanced', collapsed: 'is-collapsed' }, CKP_TOKENS_ENHANCED)}
${vguiTabsCssEnhanced({ root: 'ckp-tabs-enhanced', tab: 'ckp-tab', active: 'active' }, CKP_TOKENS_ENHANCED)}
${vguiChipCssEnhanced({ root: 'ckp-chip-enhanced', label: 'ckp-chip-label', value: 'ckp-chip-value' }, CKP_TOKENS_ENHANCED)}
${vguiLoadingCss({ spinner: 'ckp-spinner' }, CKP_TOKENS_ENHANCED)}
/* ─── Phase 3: Micro-interactions ──────────────────────────────────────── */
/* Save animation: spinner → checkmark → idle */
.ckp-btn-primary-enhanced.ckp-btn-saving {
  background: linear-gradient(135deg, var(--ckp-accent, #3b82f6), var(--ckp-accent, #3b82f6));
  position: relative;
}
.ckp-btn-primary-enhanced.ckp-btn-saved {
  background: var(--ckp-success, #10b981);
  border-color: var(--ckp-success, #10b981);
}
.ckp-btn-primary-enhanced.ckp-btn-saved svg {
  animation: checkPulse 400ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
/* Change indicator — left border accent + visual prominence */
.ckp-row.ckp-has-changes,
.ckp-band-enhanced.ckp-has-changes {
  border-left: 3px solid var(--ckp-accent, #3b82f6);
  padding-left: 12px;
}
.ckp-has-changes::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--ckp-accent, #3b82f6);
  border-radius: 0;
  animation: changeFlash 400ms ease-out;
}
/* Checkmark pulse animation */
@keyframes checkPulse {
  0% {
    transform: scale(0.8) rotate(-45deg);
    opacity: 0;
  }
  50% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
}
/* Change indicator flash */
@keyframes changeFlash {
  0% {
    opacity: 1;
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
  }
  100% {
    opacity: 0.3;
    box-shadow: 0 0 0 rgba(59, 130, 246, 0);
  }
}
/* ─── Phase 4: Tab Group System ────────────────────────────────────────── */
/* Multi-pane interface with animated underline and progressive disclosure */
.ckp-tab-group {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
}
.ckp-tabs-enhanced {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--ckp-border, #32384f);
  background: var(--ckp-surface-2, transparent);
  padding: 0 12px;
  flex: 0 0 auto;
}
.ckp-tab {
  position: relative;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ckp-muted, #8a93a6);
  cursor: pointer;
  background: transparent;
  border: none;
  transition: color 150ms cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.ckp-tab:hover {
  color: var(--vg-fg-color, #e5e9f0);
  background: rgba(59, 130, 246, 0.08);
}
.ckp-tab.active {
  color: var(--vg-fg-color, #e5e9f0);
}
.ckp-tab::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--ckp-accent, #3b82f6);
  border-radius: 2px 2px 0 0;
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.ckp-tab.active::after {
  transform: scaleX(1);
}
.ckp-tab-panes {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.ckp-tab-pane {
  display: none;
  padding: 16px 20px;
  min-height: 0;
}
.ckp-tab-pane.active {
  display: block;
  animation: tabPaneIn 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes tabPaneIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ckp-tab {
    transition: none;
  }
  .ckp-tab::after {
    transition: none;
  }
  .ckp-tab-pane.active {
    animation: none;
  }
}
/* Phase 4d — cross-module workflow badges */
.ckp-workflow-strip {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 20px 12px;
  flex: 0 0 auto;
}
.ckp-flat > .ckp-workflow-strip,
.ckp-pane-body > .ckp-workflow-strip {
  padding-left: 0;
  padding-right: 0;
}
.ckp-tab-pane > .ckp-workflow-strip {
  padding: 0 0 12px;
}
.ckp-workflow-link {
  display: flex;
  align-items: center;
  gap: var(--vgext-space-3, 12px);
  width: 100%;
  padding: var(--vgext-space-2, 8px) var(--vgext-space-4, 16px);
  margin: 0;
  border: 1px solid var(--ckp-border, #32384f);
  border-radius: var(--vg-radius, 2px);
  background: var(--ckp-surface-2, rgba(59, 130, 246, 0.04));
  color: var(--vg-fg-color, #e5e9f0);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    background 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.ckp-workflow-link:hover {
  border-color: var(--ckp-accent, #3b82f6);
  background: rgba(59, 130, 246, 0.1);
}
.ckp-workflow-icon {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--ckp-accent, #3b82f6);
}
.ckp-workflow-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}
.ckp-workflow-label {
  font-size: 13px;
  font-weight: 500;
}
.ckp-workflow-hint {
  font-size: 11px;
  color: var(--ckp-muted, #8a93a6);
}
.ckp-workflow-chevron {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--ckp-muted, #8a93a6);
}
/* Enhanced token CSS variables */
.ckp-enhanced {
  --ckp-spacing-xs: ${VGUI_SPACING.xs};
  --ckp-spacing-sm: ${VGUI_SPACING.sm};
  --ckp-spacing-md: ${VGUI_SPACING.md};
  --ckp-spacing-lg: ${VGUI_SPACING.lg};
  --ckp-spacing-xl: ${VGUI_SPACING.xl};
  --ckp-spacing-2xl: ${VGUI_SPACING['2xl']};
  --ckp-font-size-xs: ${VGUI_TYPOGRAPHY.xs};
  --ckp-font-size-sm: ${VGUI_TYPOGRAPHY.sm};
  --ckp-font-size-base: ${VGUI_TYPOGRAPHY.base};
  --ckp-font-size-lg: ${VGUI_TYPOGRAPHY.lg};
  --ckp-font-size-xl: ${VGUI_TYPOGRAPHY.xl};
  --ckp-transition-fast: ${VGUI_TRANSITIONS.fast};
  --ckp-transition-base: ${VGUI_TRANSITIONS.base};
  --ckp-transition-slow: ${VGUI_TRANSITIONS.slow};
  --ckp-transition-slower: ${VGUI_TRANSITIONS.slower};
}
/* ── Action buttons ───────────────────────────────────────────────────
 * The glyph and the label had no gap, so a Save button read as one run of
 * characters. Also pins the pane action bar to the one control height.
 *
 * .ckp-actbtn is included deliberately: it had NO rule anywhere in this
 * stylesheet, so a bare .ckp-actbtn rendered as a browser-default button.
 * Its siblings carry a rung modifier (.ckp-btn-secondary / -quiet) and so
 * picked up the generator's 28px, which is why Save and Reset sat at two
 * different heights in Calculated Columns, Column Settings, Styling Rules
 * and Shortcuts. */
.ckp-actbtn,
.ckp-btn-primary-enhanced,
.ckp-btn-secondary-enhanced,
.ckp-btn-tertiary-enhanced,
.ckp-btn-primary,
.ckp-btn-secondary,
.ckp-btn-quiet,
.ckp-btn-danger {
  /* flex: 0 0 auto — .ckp-pane-head is a flex row whose title input takes
   * flex: 1 1 auto, so without this the buttons are the ones that shrink
   * and the label wraps under the glyph, growing the button vertically. */
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--vgext-space-2, 8px);
  height: var(--vgext-control-h, 28px);
  min-height: var(--vgext-control-h, 28px);
  padding: 0 var(--vgext-control-px, 13px);
  box-sizing: border-box;
  border-radius: var(--vg-radius, 2px);
  /* font-family, not the font shorthand: the shorthand also resets
   * font-weight, which would flatten the ladder's 500/600 distinction. */
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.ckp-actbtn svg,
.ckp-btn-primary-enhanced svg,
.ckp-btn-secondary-enhanced svg,
.ckp-btn-tertiary-enhanced svg,
.ckp-btn-primary svg,
.ckp-btn-secondary svg,
.ckp-btn-quiet svg,
.ckp-btn-danger svg { flex: 0 0 auto; }

/* A bare .ckp-actbtn is the pane's commit — the Primary rung. The variants
 * that carry an explicit rung modifier keep theirs. */
.ckp-actbtn:not(.ckp-btn-secondary):not(.ckp-btn-quiet):not(.ckp-btn-danger) {
  background: var(--ckp-accent);
  border: 1px solid var(--ckp-accent);
  color: var(--vg-checkbox-checked-fg, #FCFCFC);
  font-weight: 600;
  transition: filter var(--vgext-t, 120ms ease), opacity var(--vgext-t, 120ms ease);
}
.ckp-actbtn:not(.ckp-btn-secondary):not(.ckp-btn-quiet):not(.ckp-btn-danger):hover:not(:disabled) {
  filter: brightness(1.08);
}
.ckp-actbtn:disabled { opacity: 0.45; cursor: default; filter: none; }
.ckp-actbtn:focus-visible {
  outline: 2px solid var(--ckp-accent);
  outline-offset: -2px;
}

/* ── Remaining generator overrides ────────────────────────────────────
 * The shared kernel generators predate the ext token scale and emit a few
 * off-scale values. Correcting them here rather than in the kernel keeps
 * the generators' other consumers untouched. */

/* vguiChipCss emits 21px; the chip height in this chrome is 20px, which is
 * what .vgext-dp__chip already uses. Two chip heights in one drawer. */
.ckp-chip { height: var(--vgext-chip-h, 20px); }

/* vguiTabsCssEnhanced emits a 41px tab. Tabs are a strip, not a control. */
.ckp-tab {
  height: var(--vgext-strip-h, 36px);
  box-sizing: border-box;
  padding: 0 var(--vgext-space-3, 12px);
}

/* A count is a number, not an eyebrow. It is rendered with .ckp-caps
 * alongside it, so it needs the compound selector to outrank the caps rule
 * and shed the uppercase letterspacing. */
.ckp-count,
.ckp-caps.ckp-count { letter-spacing: 0; text-transform: none; }

/* Two-line navigation row (icon + label + sublabel). Not a control, so it
 * does not take the 28px control height — it takes exactly two of them,
 * which is what a two-line row is worth and keeps it on the same scale. */
.ckp-workflow-link {
  height: calc(var(--vgext-control-h, 28px) * 2);
  box-sizing: border-box;
}

/* ── Dense list rows inside a module pane ─────────────────────────────
 * The history monitor and the plus/minus + shortcut rule lists were styled
 * with inline style.cssText, which no theme can reach and no audit can see:
 * that is how a 4px radius and a 6px gap survived the token pass. Same
 * markup, same classes — the values just live where they can be checked. */
.ckp-monitor-list {
  display: flex;
  flex-direction: column;
  gap: var(--vgext-space-2, 8px);
  max-height: 220px;
  overflow: auto;
}
.ckp-monitor-row {
  display: flex;
  align-items: center;
  gap: var(--vgext-space-2, 8px);
  min-height: var(--vgext-row-h, 30px);
  padding: 0 var(--vgext-space-2, 8px);
  border-radius: var(--vg-radius, 2px);
  background: var(--ckp-surface, transparent);
}
.ckp-monitor-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 1.35;
}
/* Label-over-meta stack in a list row. */
.ckp-stack {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--vgext-space-1, 4px);
}

/* Multi-line text control. A textarea is the one control that legitimately
 * grows past the 28px ladder, so it states its own minimum on the scale. */
.ckp-textarea {
  width: 100%;
  min-height: calc(var(--vgext-control-h, 28px) * 2);
  resize: vertical;
  padding: var(--vgext-space-2, 8px) var(--vgext-field-px, 10px);
  line-height: 1.45;
}

`;
}
