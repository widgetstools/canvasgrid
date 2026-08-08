/**
 * Cockpit UI kit — shared primitives for the customizer settings modules
 * (starui customizer visual language): numbered band headers with a
 * trailing rule, summary chips, toggle switches, pill groups, Lucide icon
 * tiles, caps micro-labels. One injected stylesheet.
 */
import { ColorPickerControl, parseColor, rgbaToString } from '@wellsfargo-starui/velocity-grid';
import { lucideBundle } from '@wellsfargo-starui/velocity-grid/icons/lucide.generated';

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

/** `01 EXPRESSION ────────` numbered band header + body. */
export function band(num: string, title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'ckp-band');
  const head = el('div', 'ckp-band-head');
  head.appendChild(el('span', 'ckp-band-num', num));
  head.appendChild(el('span', 'ckp-band-title', title));
  head.appendChild(el('span', 'ckp-band-rule'));
  root.appendChild(head);
  const body = el('div', 'ckp-band-body');
  root.appendChild(body);
  return { root, body };
}

export type ChipTone = 'positive' | 'info' | 'warning' | 'neutral';

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

/** iOS-style toggle switch. */
export function switchToggle(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const root = el('button', `ckp-switch${checked ? ' on' : ''}`);
  root.type = 'button';
  root.setAttribute('role', 'switch');
  root.setAttribute('aria-checked', String(checked));
  root.appendChild(el('span', 'ckp-switch-knob'));
  root.addEventListener('click', () => {
    const next = !root.classList.contains('on');
    root.classList.toggle('on', next);
    root.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return root;
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

/** LABEL + control row (label column left, control right). */
export function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const root = el('div', 'ckp-row');
  root.appendChild(caps(label));
  const main = el('div', 'ckp-row-main');
  main.appendChild(control);
  if (hint) main.appendChild(el('div', 'ckp-hint', hint));
  root.appendChild(main);
  return root;
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
  --ckp-accent: var(--vg-accent-color, #4f9cf9);
  --ckp-muted: var(--vg-muted-fg-color, #8a93a6);
  --ckp-border: color-mix(in srgb, var(--vg-border-color, #2a3140) 92%, transparent);
  --ckp-surface: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 3.5%, transparent);
  --ckp-surface-2: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 5.5%, transparent);
}
/* Flat settings panels (no list rail) — single column with real gutters.
   Master-detail modules keep the 2-col grid above; flat modules MUST add
   this class or content lands in the rail column and sticks to edges. */
.ckp.ckp-flat {
  display: flex;
  flex-direction: column;
  grid-template-columns: unset;
  padding: 18px 22px 28px;
  overflow: hidden;
  gap: 0;
}
.ckp.ckp-flat > .ckp-pane-head {
  flex: 0 0 auto;
  margin-bottom: 16px;
  padding-bottom: 14px;
}
.ckp.ckp-flat > .ckp-flat-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
}
.ckp.ckp-flat > .ckp-flat-foot {
  flex: 0 0 auto;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ckp-border);
}
.ckp * { box-sizing: border-box; }
.ckp-caps {
  font-size: 10px; font-weight: 650; letter-spacing: 0.12em; text-transform: uppercase;
  color: color-mix(in srgb, var(--ckp-muted) 90%, transparent);
}
.ckp-hint {
  font-size: 11px; letter-spacing: 0.01em; color: var(--ckp-muted); margin-top: 6px;
  line-height: 1.45; text-transform: none;
}
.ckp-hint:not(.lc) { letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; }
/* rail */
.ckp-rail {
  border-right: 1px solid var(--ckp-border);
  padding: 16px 14px 20px;
  overflow-y: auto; min-height: 0;
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 1.5%, transparent);
  scrollbar-width: thin;
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
  transition: background 120ms ease, border-color 120ms ease;
}
.ckp-addbtn:hover { background: color-mix(in srgb, var(--ckp-accent) 20%, transparent); }
.ckp-rail-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin: 1px 0;
  cursor: pointer; border-radius: var(--vg-radius, 2px);
  border: 1px solid transparent;
  transition: background 120ms ease, border-color 120ms ease;
}
.ckp-rail-row:hover { background: var(--ckp-surface); }
.ckp-rail-row.active {
  background: color-mix(in srgb, var(--ckp-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--ckp-accent) 28%, transparent);
  box-shadow: inset 2px 0 0 var(--ckp-accent);
}
.ckp-rail-row.muted .ckp-rail-name { opacity: 0.45; }
.ckp-rail-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.ckp-mini {
  background: transparent; border: none; color: var(--ckp-muted); cursor: pointer;
  padding: 2px; font: inherit; display: inline-flex; align-items: center;
  border-radius: var(--vg-radius, 2px);
}
.ckp-mini:hover { color: var(--vg-fg-color, #e5e9f0); background: var(--ckp-surface); }
/* pane */
.ckp-pane { min-width: 0; min-height: 0; overflow-y: auto; padding: 18px 22px 32px; scrollbar-width: thin; }
.ckp-pane-head {
  display: flex; gap: 10px; align-items: center; margin-bottom: 16px; padding-bottom: 14px;
  border-bottom: 1px solid var(--ckp-border);
}
.ckp-title {
  flex: 1 1 auto; font-size: 14px; font-weight: 600; letter-spacing: -0.015em;
  color: var(--vg-fg-color, #e5e9f0);
}
.ckp-actbtn {
  display: inline-flex; gap: 6px; align-items: center;
  background: transparent; border: 1px solid transparent;
  color: var(--ckp-muted); font-size: 10.5px; font-weight: 650;
  letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer;
  padding: 6px 10px; border-radius: var(--vg-radius, 2px);
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.ckp-actbtn:hover:not(:disabled) {
  color: var(--vg-fg-color, #e5e9f0);
  background: var(--ckp-surface);
  border-color: var(--ckp-border);
}
.ckp-actbtn:disabled { opacity: 0.4; cursor: default; }
.ckp-actbtn[data-primary],
.ckp-pane-head .ckp-actbtn:last-of-type:not(:disabled) {
  color: var(--vg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--ckp-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--ckp-accent) 40%, transparent);
}
.ckp-actbtn[data-primary]:hover:not(:disabled),
.ckp-pane-head .ckp-actbtn:last-of-type:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ckp-accent) 24%, transparent);
}
/* chips strip */
.ckp-chips-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.ckp-chip {
  display: inline-flex; gap: 6px; align-items: center;
  border: 1px solid var(--ckp-border); border-radius: var(--vg-radius, 2px);
  padding: 3px 9px; font-size: 10px; letter-spacing: 0.06em;
  background: var(--ckp-surface);
}
.ckp-chip-label { text-transform: uppercase; color: var(--ckp-muted); font-weight: 650; }
.ckp-chip-value { font-family: ui-monospace, Menlo, Consolas, monospace; text-transform: uppercase; font-variant-numeric: tabular-nums; }
.ckp-chip.positive { border-color: color-mix(in srgb, #4ade80 50%, transparent); }
.ckp-chip.positive .ckp-chip-value { color: #4ade80; }
.ckp-chip.info { border-color: color-mix(in srgb, var(--ckp-accent) 50%, transparent); }
.ckp-chip.info .ckp-chip-value { color: var(--ckp-accent); }
.ckp-chip.warning { border-color: color-mix(in srgb, #f5b432 55%, transparent); }
.ckp-chip.warning .ckp-chip-value { color: #f5b432; }
.ckp-controls-strip { display: flex; flex-wrap: wrap; gap: 8px; row-gap: 8px; align-items: center; margin-bottom: 16px; }
.ckp-controls-strip > * { flex: 0 0 auto; }
.ckp-strip-pair { display: inline-flex; align-items: center; gap: 8px; }
.ckp-controls-strip .ckp-numwrap { width: auto; }
.ckp-controls-strip .ckp-num { width: 64px; }
.ckp-controls-strip > .ckp-caps { white-space: nowrap; }
.ckp-controls-strip > * + .ckp-caps { margin-left: 10px; }
/* bands */
.ckp-band { margin: 0 0 22px; }
.ckp-band:last-child { margin-bottom: 8px; }
.ckp-band-head { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
.ckp-band-num {
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10.5px; font-weight: 600;
  color: color-mix(in srgb, var(--ckp-accent) 75%, var(--ckp-muted));
  font-variant-numeric: tabular-nums;
}
.ckp-band-title { font-size: 10.5px; font-weight: 650; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vg-fg-color, #e5e9f0); }
.ckp-band-rule { flex: 1 1 auto; height: 1px; background: var(--ckp-border); }
.ckp-band-body { padding-left: 0; max-width: 560px; }
/* rows + inputs — fixed label column so toggles/inputs share one vertical axis */
.ckp-row {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  gap: 14px 16px;
  align-items: start;
  margin-bottom: 14px;
}
.ckp-row > .ckp-caps { padding-top: 8px; }
.ckp-row-main { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 0; }
.ckp-input {
  background: var(--ckp-surface); color: inherit;
  border: 1px solid var(--ckp-border); border-radius: var(--vg-radius, 2px);
  padding: 7px 10px; font: inherit; width: 100%;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
.ckp-input:hover { border-color: color-mix(in srgb, var(--ckp-muted) 45%, var(--ckp-border)); }
.ckp-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--ckp-accent) 70%, var(--ckp-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ckp-accent) 16%, transparent);
  background: color-mix(in srgb, var(--ckp-accent) 5%, transparent);
}
.ckp-input.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; }
.ckp-num { width: 96px; max-width: 100%; }
.ckp-numwrap { display: inline-flex; align-items: center; gap: 6px; width: auto; max-width: 100%; }
.ckp-numwrap .ckp-num { flex: 0 0 auto; width: 96px; }
.ckp-suffix { font-size: 9.5px; letter-spacing: 0.1em; color: var(--ckp-muted); font-weight: 650; }
.ckp-select { width: auto; min-width: 110px; text-transform: uppercase; font-size: 11px; font-weight: 550; }
/* Text / long inputs stay full band width */
.ckp-row-main > .ckp-input:not(.ckp-num),
.ckp-row-main > .ckp-select { width: 100%; max-width: 420px; }
/* switch — fixed pill; never use flex-basis (row-main is a column flex) */
.ckp-switch {
  position: relative;
  display: inline-block;
  flex: none;
  box-sizing: border-box;
  width: 36px; min-width: 36px; max-width: 36px;
  height: 20px; min-height: 20px; max-height: 20px;
  border-radius: 999px; border: 1px solid var(--ckp-border);
  background: var(--ckp-surface); cursor: pointer; padding: 0; margin: 0;
  overflow: hidden; vertical-align: middle;
  transition: border-color 120ms ease, background 120ms ease;
}
.ckp-switch-knob {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--ckp-muted); transition: left 0.14s ease, background 0.14s ease;
  pointer-events: none;
}
.ckp-switch.on { border-color: color-mix(in srgb, var(--ckp-accent) 55%, transparent); background: color-mix(in srgb, var(--ckp-accent) 14%, transparent); }
.ckp-switch.on .ckp-switch-knob { left: 18px; background: var(--ckp-accent); }
/* pills */
.ckp-pills {
  display: inline-flex; border: 1px solid var(--ckp-border); border-radius: var(--vg-radius, 2px);
  overflow: hidden; background: var(--ckp-surface);
}
.ckp-pill {
  background: transparent; border: none; border-right: 1px solid var(--ckp-border);
  color: var(--ckp-muted); font-size: 10px; font-weight: 650;
  letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 12px; cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.ckp-pill:last-child { border-right: none; }
.ckp-pill:hover { color: var(--vg-fg-color, #e5e9f0); }
.ckp-pill.on {
  background: color-mix(in srgb, var(--ckp-accent) 18%, transparent);
  color: var(--vg-fg-color, #e5e9f0);
}
/* icon tiles */
.ckp-tilegrid { display: flex; flex-wrap: wrap; gap: 5px; margin: 4px 0 10px; }
.ckp-tile {
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--ckp-surface); border: 1px solid var(--ckp-border); border-radius: var(--vg-radius, 2px);
  color: var(--vg-fg-color, #cfd8e3); cursor: pointer; padding: 0;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}
.ckp-tile:hover { border-color: color-mix(in srgb, var(--ckp-muted) 55%, transparent); }
.ckp-tile.on {
  border-color: color-mix(in srgb, #ef4444 55%, transparent); color: #ef4444;
  background: color-mix(in srgb, #ef4444 12%, transparent);
}
/* color field */
.ckp-colorfield {
  display: flex; align-items: center; gap: 0;
  border: 1px solid var(--ckp-border); border-radius: var(--vg-radius, 2px);
  overflow: hidden; background: var(--ckp-surface);
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
  background: var(--ckp-surface); border: 1px solid var(--ckp-border); border-radius: var(--vg-radius, 2px);
  color: var(--ckp-muted); cursor: pointer; font-size: 12px; padding: 0;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
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
.ckp-warn { color: #f5b432; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 650; }
/* expression + errors */
.ckp-editor .cm-editor { width: 100%; border-radius: var(--vg-radius, 2px); overflow: hidden; }
.ckp-error {
  margin-top: 8px; padding: 8px 10px;
  border: 1px solid color-mix(in srgb, #e2695f 45%, transparent);
  border-radius: var(--vg-radius, 2px); color: #e2695f;
  background: color-mix(in srgb, #e2695f 8%, transparent);
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; white-space: pre-wrap;
}
.ckp-empty { color: var(--ckp-muted); padding: 36px 24px; text-align: center; line-height: 1.5; }
/* style chrome (ribbon Font/Borders cluster) embedded in the rules pane */
.ckp-stylechrome .vgext-rb-stepper { display: none; }
.ckp-stylechrome .vgext-rb-grp:has([data-vg-field='halign']) { display: none; }
.ckp-stylechrome .vgext-rb-cluster { flex-wrap: wrap; }
/* format anchor */
.ckp-fmtbtn {
  display: inline-flex; gap: 7px; align-items: center;
  background: var(--ckp-surface); border: 1px solid var(--ckp-border); border-radius: var(--vg-radius, 2px);
  color: inherit; font: inherit; font-size: 12px; font-weight: 500;
  padding: 7px 12px; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.ckp-fmtbtn:hover {
  border-color: color-mix(in srgb, var(--ckp-accent) 45%, var(--ckp-border));
  background: color-mix(in srgb, var(--ckp-accent) 6%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .ckp-rail-row, .ckp-input, .ckp-actbtn, .ckp-switch-knob, .ckp-pill, .ckp-tile, .ckp-toggle, .ckp-fmtbtn { transition: none; }
}
`;
}
