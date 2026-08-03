/**
 * Cockpit UI kit — shared primitives for the customizer settings modules
 * (starui customizer visual language): numbered band headers with a
 * trailing rule, summary chips, toggle switches, pill groups, Lucide icon
 * tiles, caps micro-labels. One injected stylesheet.
 */
import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';

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

/** Swatch + hex + clear color field ('' / undefined = unset). */
export function colorField(value: string | undefined, onChange: (v: string | undefined) => void): HTMLElement {
  const root = el('div', 'ckp-colorfield');
  const swatch = el('input');
  swatch.type = 'color';
  const hex = el('input', 'ckp-input mono ckp-hex');
  hex.type = 'text';
  const clear = el('button', 'ckp-mini', '—');
  clear.type = 'button';
  clear.title = 'Clear';
  const sync = (v: string | undefined): void => {
    swatch.value = v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#888888';
    hex.value = v ?? '';
    hex.placeholder = 'none';
    root.classList.toggle('unset', !v);
  };
  swatch.addEventListener('input', () => { sync(swatch.value); onChange(swatch.value); });
  hex.addEventListener('change', () => {
    const v = hex.value.trim() || undefined;
    sync(v);
    onChange(v);
  });
  clear.addEventListener('click', () => { sync(undefined); onChange(undefined); });
  sync(value);
  root.append(swatch, hex, clear);
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
  if (document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = `
/* The drawer body stops scrolling as a whole and hands scrolling to the
   two panes: the list rail and the editor pane scroll INDEPENDENTLY, and
   nothing can grow the sheet (or the page) vertically. */
.cgext-sheet-body:has(> .ckp) { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.ckp { flex: 1 1 auto; display: grid; grid-template-columns: 218px 1fr; height: 100%; min-height: 0; font-size: 12px; color: var(--cg-fg, #dfe6ee); }
.ckp * { box-sizing: border-box; }
.ckp-caps { font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cg-fg-muted, #7d8896); }
.ckp-hint { font-size: 10px; letter-spacing: 0.04em; color: var(--cg-fg-muted, #5f6a78); margin-top: 4px; text-transform: uppercase; }
.ckp-hint.lc { text-transform: none; letter-spacing: 0; }
/* rail */
.ckp-rail { border-right: 1px solid var(--cg-border-color, #1c2430); padding: 12px 10px; overflow-y: auto; min-height: 0; }
.ckp-rail-head { display: flex; align-items: center; gap: 8px; padding: 0 4px 10px; }
.ckp-rail-head .ckp-caps { flex: 1 1 auto; color: var(--cg-fg, #dfe6ee); }
.ckp-count { color: var(--cg-fg-muted, #7d8896); }
.ckp-addbtn { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--cg-accent-color, #2dd4bf); color: var(--cg-accent-color, #2dd4bf); border-radius: 3px; font-size: 14px; line-height: 1; cursor: pointer; padding: 0; }
.ckp-rail-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; border-left: 2px solid transparent; }
.ckp-rail-row:hover { background: rgba(128,150,180,0.07); }
.ckp-rail-row.active { background: rgba(45,140,220,0.14); border-left-color: var(--cg-accent-color, #2dd4bf); }
.ckp-rail-row.muted .ckp-rail-name { opacity: 0.45; }
.ckp-rail-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ckp-mini { background: transparent; border: none; color: var(--cg-fg-muted, #7d8896); cursor: pointer; padding: 0 2px; font: inherit; display: inline-flex; align-items: center; }
.ckp-mini:hover { color: var(--cg-fg, #dfe6ee); }
/* pane */
.ckp-pane { min-width: 0; min-height: 0; overflow-y: auto; padding: 12px 14px 24px 16px; }
.ckp-pane-head { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.ckp-title { flex: 1 1 auto; font-size: 13px; }
.ckp-actbtn { display: inline-flex; gap: 6px; align-items: center; background: transparent; border: none; color: var(--cg-fg-muted, #8a96a5); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; padding: 4px 6px; }
.ckp-actbtn:hover:not(:disabled) { color: var(--cg-fg, #fff); }
.ckp-actbtn:disabled { opacity: 0.4; cursor: default; }
/* chips strip */
.ckp-chips-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.ckp-chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--cg-border-color, #2a3442); border-radius: 3px; padding: 2px 8px; font-size: 10px; letter-spacing: 0.08em; }
.ckp-chip-label { text-transform: uppercase; color: var(--cg-fg-muted, #7d8896); }
.ckp-chip-value { font-family: Menlo, Consolas, monospace; text-transform: uppercase; }
.ckp-chip.positive { border-color: rgba(74,222,128,0.55); } .ckp-chip.positive .ckp-chip-value { color: #4ade80; }
.ckp-chip.info { border-color: rgba(96,165,250,0.55); } .ckp-chip.info .ckp-chip-value { color: #60a5fa; }
.ckp-chip.warning { border-color: rgba(245,180,50,0.6); } .ckp-chip.warning .ckp-chip-value { color: #f5b432; }
.ckp-controls-strip { display: flex; flex-wrap: wrap; gap: 8px; row-gap: 8px; align-items: center; margin-bottom: 14px; }
.ckp-controls-strip > * { flex: 0 0 auto; }
.ckp-strip-pair { display: inline-flex; align-items: center; gap: 8px; }
.ckp-controls-strip .ckp-numwrap { width: auto; }
.ckp-controls-strip .ckp-num { width: 64px; }
.ckp-controls-strip > .ckp-caps { white-space: nowrap; }
.ckp-controls-strip > * + .ckp-caps { margin-left: 10px; }
/* bands */
.ckp-band { margin: 0 0 16px; }
.ckp-band-head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.ckp-band-num { font-family: Menlo, Consolas, monospace; font-size: 10px; color: var(--cg-fg-muted, #7d8896); }
.ckp-band-title { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; }
.ckp-band-rule { flex: 1 1 auto; height: 1px; background: var(--cg-border-color, #1c2430); }
.ckp-band-body { padding-left: 2px; }
/* rows + inputs */
.ckp-row { display: grid; grid-template-columns: 110px 1fr; gap: 10px; align-items: start; margin-bottom: 10px; }
.ckp-row > .ckp-caps { padding-top: 6px; }
.ckp-row-main { min-width: 0; }
.ckp-input { background: rgba(6,10,16,0.5); color: inherit; border: 1px solid var(--cg-border-color, #2a3442); border-radius: 3px; padding: 5px 8px; font: inherit; width: 100%; }
.ckp-input:focus { outline: none; border-color: var(--cg-accent-color, #2dd4bf); }
.ckp-input.mono { font-family: Menlo, Consolas, monospace; font-size: 11px; }
.ckp-num { width: 84px; }
.ckp-numwrap { display: inline-flex; align-items: center; gap: 6px; width: 100%; }
.ckp-numwrap .ckp-num { flex: 1 1 auto; width: auto; }
.ckp-suffix { font-size: 9.5px; letter-spacing: 0.1em; color: var(--cg-fg-muted, #7d8896); }
.ckp-select { width: auto; min-width: 110px; text-transform: uppercase; font-size: 11px; }
/* switch */
.ckp-switch { position: relative; flex: 0 0 34px; width: 34px; min-width: 34px; height: 18px; border-radius: 9px; border: 1px solid var(--cg-border-color, #2a3442); background: rgba(6,10,16,0.6); cursor: pointer; padding: 0; overflow: hidden; }
.ckp-switch-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--cg-fg-muted, #7d8896); transition: left 0.12s, background 0.12s; }
.ckp-switch.on { border-color: var(--cg-accent-color, #2dd4bf); }
.ckp-switch.on .ckp-switch-knob { left: 18px; background: var(--cg-accent-color, #2dd4bf); }
/* pills */
.ckp-pills { display: inline-flex; border: 1px solid var(--cg-border-color, #2a3442); border-radius: 3px; overflow: hidden; }
.ckp-pill { background: transparent; border: none; border-right: 1px solid var(--cg-border-color, #2a3442); color: var(--cg-fg-muted, #8a96a5); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; padding: 4px 10px; cursor: pointer; }
.ckp-pill:last-child { border-right: none; }
.ckp-pill.on { background: rgba(45,140,220,0.2); color: var(--cg-accent-color, #4dd0e1); }
/* icon tiles */
.ckp-tilegrid { display: flex; flex-wrap: wrap; gap: 5px; margin: 4px 0 10px; }
.ckp-tile { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--cg-border-color, #2a3442); border-radius: 3px; color: var(--cg-fg, #cfd8e3); cursor: pointer; padding: 0; }
.ckp-tile:hover { border-color: var(--cg-fg-muted, #7d8896); }
.ckp-tile.on { border-color: #ef4444; color: #ef4444; background: rgba(239,68,68,0.12); }
/* color field */
.ckp-colorfield { display: flex; align-items: center; gap: 0; border: 1px solid var(--cg-border-color, #2a3442); border-radius: 3px; overflow: hidden; }
.ckp-colorfield input[type=color] { width: 26px; height: 26px; border: none; padding: 2px; background: transparent; flex: 0 0 auto; }
.ckp-colorfield .ckp-hex { border: none; border-radius: 0; flex: 1 1 auto; }
.ckp-colorfield .ckp-mini { padding: 0 8px; }
.ckp-colorfield.unset input[type=color] { opacity: 0.3; }
/* type toggles (B/I/U/S) */
.ckp-typebar { display: flex; gap: 10px; align-items: center; }
.ckp-toggle { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--cg-border-color, #2a3442); border-radius: 3px; color: var(--cg-fg-muted, #8a96a5); cursor: pointer; font-size: 12px; padding: 0; }
.ckp-toggle.on { border-color: var(--cg-accent-color, #2dd4bf); color: var(--cg-accent-color, #2dd4bf); background: rgba(45,212,191,0.1); }
.ckp-toggle b { font-weight: 800; } .ckp-toggle i { font-style: italic; } .ckp-toggle u { text-decoration: underline; } .ckp-toggle s { text-decoration: line-through; }
/* chips for target columns */
.ckp-colchips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.ckp-colchip { display: inline-flex; gap: 4px; align-items: center; background: rgba(45,140,220,0.12); border: 1px solid rgba(96,165,250,0.4); border-radius: 3px; padding: 2px 4px 2px 8px; font-size: 11px; }
.ckp-warn { color: #f5b432; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
/* expression + errors */
.ckp-editor .cm-editor { width: 100%; }
.ckp-error { margin-top: 6px; padding: 6px 8px; border: 1px solid rgba(226,105,95,0.5); border-radius: 3px; color: #e2695f; font-family: Menlo, Consolas, monospace; font-size: 11px; white-space: pre-wrap; }
.ckp-empty { color: var(--cg-fg-muted, #8a96a5); padding: 28px; text-align: center; }
/* style chrome (ribbon Font/Borders cluster) embedded in the rules pane —
   hide only what the rules StyleSlice cannot express: font size and
   alignment. Borders are fully per-side (side buttons + width + style +
   color all live). */
.ckp-stylechrome .cgext-rb-stepper { display: none; }
.ckp-stylechrome .cgext-rb-grp:has([data-cg-field='halign']) { display: none; }
.ckp-stylechrome .cgext-rb-cluster { flex-wrap: wrap; }
/* format anchor */
.ckp-fmtbtn { display: inline-flex; gap: 6px; align-items: center; background: transparent; border: 1px solid var(--cg-border-color, #2a3442); border-radius: 3px; color: inherit; font: inherit; font-size: 11px; padding: 4px 10px; cursor: pointer; }
.ckp-fmtbtn:hover { border-color: var(--cg-fg-muted, #7d8896); }
`;
  document.head.appendChild(style);
}
