/**
 * Shared Font / Alignment / Borders chrome — same controls as the Formatting
 * ribbon, so Column Groups (and future surfaces) edit styles with the same
 * pattern. Writes `ColCellOverrides`-shaped patches via `applyStyle`.
 */
import { menu } from './ui';
import { injectTitleBarStyles } from './titleBar';
import { injectRibbonStyles, type BorderSideKey } from './ribbon';

export interface StyleChromeAdapter {
  /** Current style object (headerStyle / cellStyle slice). */
  getStyle(): Record<string, unknown>;
  /** Merge patch into the live style (caller owns persistence / dirty). */
  applyStyle(patch: Record<string, unknown>): void;
}

const I = {
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z',
  italic: 'M19 4h-9M14 20H5M15 4L9 20',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 21h16',
  strikethrough: 'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  alignLeft: 'M17 10H3M21 6H3M21 14H3M17 18H3',
  alignCenter: 'M18 10H6M21 6H3M21 14H3M18 18H6',
  alignRight: 'M21 10H7M21 6H3M21 14H3M21 18H7',
  paintText: 'M4 20h16M6 16l4-11 4 11M7.5 13h5',
  fill: 'M19 11l-8-8-8.5 8.5a2 2 0 0 0 0 3L8 20a2 2 0 0 0 3 0l8-8zM2 20h20',
  eraser: 'M7 21h13M5 13l6 6M20 8l-9 9-6-6 9-9a2.8 2.8 0 0 1 4 0l2 2a2.8 2.8 0 0 1 0 4z',
};

const DEFAULT_TEXT = '#4fd1c5';
const DEFAULT_FILL = '#12333a';
const DEFAULT_BORDER = '#2dd4bf';

const BORDER_EDGE_PATHS: Record<BorderSideKey, string> = {
  all: 'M5 5h14v14H5z',
  top: 'M5 5h14',
  bottom: 'M5 19h14',
  left: 'M5 5v14',
  right: 'M19 5v14',
};

function svg(path: string, size = 14): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

function h(cls: string, html?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
}

function iconBtn(icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cgext-rb-btn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = svg(icon);
  return b;
}

function toggleBtn(icon: string, title: string): HTMLButtonElement {
  const b = iconBtn(icon, title);
  b.classList.add('cgext-rb-toggle');
  return b;
}

function pill(text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cgext-rb-pill';
  b.innerHTML = `<span>${text}</span>${svg('M6 9l6 6 6-6', 12)}`;
  return b;
}

function colorSwatch(icon: string, title: string, defaultColor: string): {
  button: HTMLButtonElement; input: HTMLInputElement;
} {
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'cgext-rb-colorinput';
  input.value = defaultColor;
  const button = iconBtn(icon, title);
  button.classList.add('cgext-rb-swatch');
  const bar = document.createElement('span');
  bar.className = 'cgext-rb-swatchbar';
  const sync = () => { bar.style.setProperty('--cgext-swatch', input.value); };
  sync();
  button.append(bar);
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  button.addEventListener('click', () => input.click());
  return { button, input };
}

function borderSideBtn(side: BorderSideKey): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cgext-rb-toggle cgext-rb-bside';
  b.dataset.side = side;
  b.title = side === 'all' ? 'All borders' : `${side.charAt(0).toUpperCase()}${side.slice(1)} border`;
  b.setAttribute('aria-label', b.title);
  b.innerHTML =
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">` +
    `<path d="M5 5h14v14H5z" stroke-width="1" opacity="0.35"/>` +
    `<path d="${BORDER_EDGE_PATHS[side]}" stroke-width="2.6"/></svg>`;
  return b;
}

function mini(...children: HTMLElement[]): HTMLDivElement {
  const r = h('cgext-rb-mini');
  r.append(...children);
  return r;
}

function grp(name: string, ...rows: HTMLElement[]): HTMLDivElement {
  const g = h('cgext-rb-grp');
  const deck = h('cgext-rb-deck');
  deck.append(...rows);
  g.append(deck, h('cgext-rb-grp-name', name));
  return g;
}

function syncColor(input: HTMLInputElement, value: unknown, fallback: string): void {
  const next = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  if (input.value !== next) {
    input.value = next;
    input.dispatchEvent(new Event('input'));
  }
}

/**
 * Mount Font / Alignment / Borders into `host` (typically `[data-cg-style]`).
 * Returns a disposer for menus + listeners.
 */
export function mountFormatterStyleChrome(
  host: HTMLElement,
  adapter: StyleChromeAdapter,
): () => void {
  injectRibbonStyles();
  injectTitleBarStyles();
  injectStyleChromeHostCss();

  const disposers: Array<() => void> = [];
  const bold = toggleBtn(I.bold, 'Bold');
  bold.setAttribute('data-cg-field', 'fontWeight');
  const italic = toggleBtn(I.italic, 'Italic');
  italic.setAttribute('data-cg-field', 'fontStyle');
  const underline = toggleBtn(I.underline, 'Underline');
  underline.setAttribute('data-cg-field', 'textDecoration');
  const strike = toggleBtn(I.strikethrough, 'Strikethrough');

  const sizeVal = document.createElement('span');
  sizeVal.textContent = '12px';
  sizeVal.setAttribute('data-cg-field', 'fontSize');
  const sizeUp = document.createElement('button');
  sizeUp.type = 'button';
  sizeUp.className = 'cgext-rb-step';
  sizeUp.title = 'Larger font';
  sizeUp.innerHTML = svg('M6 15l6-6 6 6', 11);
  const sizeDn = document.createElement('button');
  sizeDn.type = 'button';
  sizeDn.className = 'cgext-rb-step';
  sizeDn.title = 'Smaller font';
  sizeDn.innerHTML = svg('M6 9l6 6 6-6', 11);
  const sizeWrap = h('cgext-rb-stepper');
  const sizeStack = h('cgext-rb-step-stack');
  sizeStack.append(sizeUp, sizeDn);
  sizeWrap.append(sizeVal, sizeStack);

  const { button: textColorBtn, input: textColorInput } =
    colorSwatch(I.paintText, 'Text color', DEFAULT_TEXT);
  textColorBtn.setAttribute('data-cg-field', 'fg');
  const { button: fillColorBtn, input: fillColorInput } =
    colorSwatch(I.fill, 'Fill color', DEFAULT_FILL);
  fillColorBtn.setAttribute('data-cg-field', 'bg');

  const alignL = toggleBtn(I.alignLeft, 'Align left');
  alignL.dataset.align = 'left';
  const alignC = toggleBtn(I.alignCenter, 'Align center');
  alignC.dataset.align = 'center';
  const alignR = toggleBtn(I.alignRight, 'Align right');
  alignR.dataset.align = 'right';
  const alignWrap = mini(alignL, alignC, alignR);
  alignWrap.setAttribute('data-cg-field', 'halign');

  const borderSideBtns: Record<BorderSideKey, HTMLButtonElement> = {
    all: borderSideBtn('all'),
    top: borderSideBtn('top'),
    bottom: borderSideBtn('bottom'),
    left: borderSideBtn('left'),
    right: borderSideBtn('right'),
  };
  const borderPreview = h('cgext-rb-bpreview');
  borderPreview.title = 'Current borders';
  const { button: borderColorBtn, input: borderColorInput } =
    colorSwatch('M4 4h16v16H4zM12 12h.01', 'Border color', DEFAULT_BORDER);
  borderColorBtn.setAttribute('data-cg-field', 'borderColor');
  const borderStylePill = pill('Solid');
  borderStylePill.setAttribute('data-cg-field', 'borderStyle');
  const borderWidthPill = pill('1 px');
  borderWidthPill.setAttribute('data-cg-field', 'borderWidth');
  const borderClear = iconBtn(I.eraser, 'Remove the border at this side');

  const cluster = h('cgext-rb-cluster');
  cluster.classList.add('cgext-style-chrome');
  cluster.dataset.toolbar = 'group-style';
  cluster.append(
    grp('Font', mini(bold, italic, underline, strike, sizeWrap), mini(textColorBtn, textColorInput, fillColorBtn, fillColorInput)),
    grp('Alignment', alignWrap),
    grp('Borders',
      mini(borderSideBtns.all, borderSideBtns.top, borderSideBtns.bottom, borderSideBtns.left, borderSideBtns.right, borderPreview),
      mini(borderColorBtn, borderColorInput, borderStylePill, borderWidthPill, borderClear)),
  );
  host.appendChild(cluster);

  let borderSide: BorderSideKey = 'all';
  let borderStyleVal: 'solid' | 'dashed' | 'dotted' = 'solid';
  let borderWidthVal = 1;

  const style = () => adapter.getStyle();
  const apply = (patch: Record<string, unknown>) => {
    adapter.applyStyle(patch);
    refresh();
  };

  type BorderSideSpec = { width?: number; style?: string; color?: string };
  const currentBorderSpec = (): Partial<Record<BorderSideKey, BorderSideSpec>> =>
    ({ ...((style().border as Partial<Record<BorderSideKey, BorderSideSpec>> | undefined) ?? {}) });

  const applyBorderEdit = (): void => {
    const spec = currentBorderSpec();
    spec[borderSide] = { width: borderWidthVal, style: borderStyleVal, color: borderColorInput.value };
    apply({ border: spec });
  };

  const refresh = (): void => {
    const s = style();
    bold.classList.toggle('is-on', s.fontWeight === 'bold' || s.fontWeight === 700);
    italic.classList.toggle('is-on', s.fontStyle === 'italic');
    underline.classList.toggle('is-on', s.textDecoration === 'underline');
    strike.classList.toggle('is-on', s.textDecoration === 'line-through');
    sizeVal.textContent = `${(typeof s.fontSize === 'number' ? s.fontSize : 12)}px`;
    syncColor(textColorInput, s.fg, DEFAULT_TEXT);
    syncColor(fillColorInput, s.bg, DEFAULT_FILL);
    const ha = s.halign ?? 'left';
    alignL.classList.toggle('is-on', ha === 'left');
    alignC.classList.toggle('is-on', ha === 'center');
    alignR.classList.toggle('is-on', ha === 'right');

    const bSpec = currentBorderSpec();
    for (const side of Object.keys(borderSideBtns) as BorderSideKey[]) {
      const b = borderSideBtns[side];
      b.classList.toggle('is-on', borderSide === side);
      b.classList.toggle('has-border', bSpec[side] !== undefined);
    }
    const active = bSpec[borderSide];
    if (active?.style === 'solid' || active?.style === 'dashed' || active?.style === 'dotted') {
      borderStyleVal = active.style;
    }
    if (typeof active?.width === 'number') borderWidthVal = active.width;
    borderStylePill.querySelector('span')!.textContent =
      borderStyleVal.charAt(0).toUpperCase() + borderStyleVal.slice(1);
    borderWidthPill.querySelector('span')!.textContent = `${borderWidthVal} px`;
    syncColor(borderColorInput, active?.color, DEFAULT_BORDER);

    const p = borderPreview.style;
    p.border = ''; p.borderTop = ''; p.borderRight = ''; p.borderBottom = ''; p.borderLeft = '';
    const css = (sd?: BorderSideSpec) =>
      sd ? `${sd.width ?? 1}px ${sd.style ?? 'solid'} ${sd.color ?? DEFAULT_BORDER}` : '';
    if (bSpec.all) p.border = css(bSpec.all);
    if (bSpec.top) p.borderTop = css(bSpec.top);
    if (bSpec.bottom) p.borderBottom = css(bSpec.bottom);
    if (bSpec.left) p.borderLeft = css(bSpec.left);
    if (bSpec.right) p.borderRight = css(bSpec.right);
  };

  bold.addEventListener('click', () => {
    const on = !(style().fontWeight === 'bold' || style().fontWeight === 700);
    apply({ fontWeight: on ? 'bold' : undefined });
  });
  italic.addEventListener('click', () => {
    apply({ fontStyle: style().fontStyle !== 'italic' ? 'italic' : undefined });
  });
  underline.addEventListener('click', () => {
    apply({ textDecoration: style().textDecoration !== 'underline' ? 'underline' : undefined });
  });
  strike.addEventListener('click', () => {
    apply({ textDecoration: style().textDecoration !== 'line-through' ? 'line-through' : undefined });
  });
  const bumpSize = (delta: number) => {
    const cur = typeof style().fontSize === 'number' ? (style().fontSize as number) : 12;
    apply({ fontSize: Math.min(32, Math.max(8, cur + delta)) });
  };
  sizeUp.addEventListener('click', () => bumpSize(1));
  sizeDn.addEventListener('click', () => bumpSize(-1));
  textColorInput.addEventListener('change', () => apply({ fg: textColorInput.value }));
  fillColorInput.addEventListener('change', () => apply({ bg: fillColorInput.value }));
  alignL.addEventListener('click', () => apply({ halign: 'left' }));
  alignC.addEventListener('click', () => apply({ halign: 'center' }));
  alignR.addEventListener('click', () => apply({ halign: 'right' }));

  for (const side of Object.keys(borderSideBtns) as BorderSideKey[]) {
    borderSideBtns[side].addEventListener('click', () => { borderSide = side; refresh(); });
  }
  borderColorInput.addEventListener('change', () => applyBorderEdit());

  const lineSampleItem = (
    label: string,
    sample: { style?: string; width?: number },
    onPick: () => void,
  ): HTMLButtonElement => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'cgext-menu-item';
    const sampleEl = document.createElement('span');
    sampleEl.className = 'cgext-rb-linesample';
    if (sample.style) sampleEl.dataset.lineStyle = sample.style;
    if (sample.width != null) sampleEl.dataset.lineWidth = String(sample.width);
    const lab = document.createElement('span');
    lab.textContent = label;
    it.append(sampleEl, lab);
    it.addEventListener('click', onPick);
    return it;
  };
  const borderStyleMenu = menu(borderStylePill, (close) => {
    const list = h('cgext-menu-list');
    for (const styleOpt of ['solid', 'dashed', 'dotted'] as const) {
      list.appendChild(lineSampleItem(
        styleOpt.charAt(0).toUpperCase() + styleOpt.slice(1),
        { style: styleOpt },
        () => { borderStyleVal = styleOpt; applyBorderEdit(); close(); },
      ));
    }
    return list;
  });
  borderStylePill.addEventListener('click', () => borderStyleMenu.toggle());
  disposers.push(() => borderStyleMenu.destroy());
  const borderWidthMenu = menu(borderWidthPill, (close) => {
    const list = h('cgext-menu-list');
    for (const w of [1, 2, 3, 4]) {
      list.appendChild(lineSampleItem(`${w} px`, { width: w },
        () => { borderWidthVal = w; applyBorderEdit(); close(); }));
    }
    return list;
  });
  borderWidthPill.addEventListener('click', () => borderWidthMenu.toggle());
  disposers.push(() => borderWidthMenu.destroy());
  borderClear.addEventListener('click', () => {
    if (borderSide === 'all') { apply({ border: undefined }); return; }
    const spec = currentBorderSpec();
    delete spec[borderSide];
    apply({ border: Object.keys(spec).length > 0 ? spec : undefined });
  });

  refresh();
  return () => {
    for (const d of disposers) { try { d(); } catch { /* */ } }
  };
}

function injectStyleChromeHostCss(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-style-chrome-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-style-chrome-styles';
  style.textContent = `
.cgext-style-chrome {
  flex-wrap: wrap;
  gap: 0;
  font-size: 12px;
  margin: 0 0 8px;
  padding: 4px 0 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 70%, transparent);
}
.cgext-rb-cluster[data-toolbar="group-style"] > .cgext-rb-grp:last-child {
  border-right: none;
}
.cg-colgroups-style .cgext-style-chrome {
  width: 100%;
}
`;
  document.head.appendChild(style);
}
