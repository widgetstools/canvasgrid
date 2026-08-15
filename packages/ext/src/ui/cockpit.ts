/**
 * Cockpit UI kit — shared primitives for the customizer settings modules:
 * section bands, summary chips, checkboxes, pill groups, Lucide icon
 * tiles, settings rows. One injected stylesheet.
 */
import { ColorPickerControl, parseColor, rgbaToString } from '@wellsfargo-starui/velocity-grid';
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

/** @deprecated Use {@link checkbox}. Kept one cycle so existing call sites compile. */
export function switchToggle(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  return checkbox(checked, onChange);
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
  padding: 16px 20px 24px;
  overflow: hidden;
  gap: 0;
}
.ckp.ckp-flat > .ckp-pane-head {
  flex: 0 0 auto;
  margin-bottom: 0;
  padding: 0 0 14px;
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
  font-size: 11px; letter-spacing: 0; color: var(--ckp-muted); margin-top: 2px;
  line-height: 1.45; text-transform: none; font-weight: 400;
}
/* rail */
.ckp-rail {
  border-right: 1px solid var(--ckp-border);
  padding: 16px 14px 20px;
  overflow-y: auto; min-height: 0;
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 1.5%, transparent);
}
.ckp-rail-head { display: flex; align-items: center; gap: 8px; padding: 0 4px 14px; }
.ckp-rail-head .ckp-caps { flex: 1 1 auto; color: var(--vg-fg-color, #e5e9f0); letter-spacing: 0.1em; }
.ckp-count {
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10.5px;
  color: var(--ckp-muted); font-variant-numeric: tabular-nums;
}
.ckp-addbtn {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--ckp-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--ckp-accent) 45%, transparent);
  color: var(--ckp-accent); border-radius: var(--vg-radius, 2px);
  font-size: 14px; line-height: 1; cursor: pointer; padding: 0;
  transition: background 110ms ease, border-color 110ms ease;
}
.ckp-addbtn:hover { background: color-mix(in srgb, var(--ckp-accent) 20%, transparent); }
.ckp-rail-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin: 1px 0;
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
  display: flex; gap: 10px; align-items: center;
  margin: 0; padding: 14px 20px 12px;
  border-bottom: 1px solid var(--ckp-border);
  background: color-mix(in srgb, var(--vg-bg-color, #12161e) 88%, var(--vg-fg-color, #e5e9f0) 6%);
  z-index: 2;
}
.ckp-pane-body {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; padding: 14px 20px 28px;
}
.ckp-title {
  flex: 1 1 auto; font-size: 14px; font-weight: 600; letter-spacing: -0.015em;
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
.ckp-band { margin: 0; }
.ckp-band-head {
  appearance: none;
  display: flex; gap: 8px; align-items: center;
  width: 100%;
  height: 26px; padding: 0 16px; margin: 0;
  background: var(--ckp-surface); border: none;
  border-bottom: 1px solid var(--ckp-border);
  color: inherit; font: inherit; text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.ckp-band-head:hover { background: var(--ckp-surface-2); }
.ckp-band-head:hover .ckp-band-chevron { color: var(--vg-fg-color, #e5e9f0); }
.ckp-band-head:focus-visible { outline: 2px solid var(--ckp-accent); outline-offset: -2px; }
.ckp-band-chevron {
  width: 0; height: 0; flex: 0 0 auto;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  color: var(--ckp-muted);
  transition: transform 140ms ease;
}
.ckp-band.is-collapsed .ckp-band-chevron {
  transform: rotate(-90deg);
}
.ckp-band.is-collapsed .ckp-band-body { display: none; }
.ckp-band-body { padding: 6px 0 10px; max-width: 560px; }
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
  display: inline-flex; gap: 7px; align-items: center;
  background: var(--ckp-input-bg); border: 1px solid var(--ckp-input-border); border-radius: var(--vg-radius, 2px);
  color: inherit; font: inherit; font-size: 12px; font-weight: 500;
  padding: 7px 12px; cursor: pointer;
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
  font-size: 9.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--vg-muted-fg-color, #7f8ba0); padding: 7px 8px 3px;
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
  .ckp-rail-row, .ckp-input, .ckp-actbtn, .ckp-pill, .ckp-tile, .ckp-toggle, .ckp-fmtbtn { transition: none; }
}
`;
}
