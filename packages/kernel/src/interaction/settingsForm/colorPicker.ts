/**
 * Cycle 21i / Phase 1 — native color picker for the settings form.
 *
 * A compact-but-sophisticated vanilla color picker: a trigger swatch that
 * opens a popover with a saturation/value pad, a hue slider, an alpha
 * slider, a hex/rgba text field, and preset swatches. Emits an `rgba(...)`
 * string on every change. No dependencies — the enterprise customizer's
 * richer picker (recents, eyedropper) is a separate plugin; this is the
 * native control the Grid Options data-colour fields use.
 */

interface RGBA { r: number; g: number; b: number; a: number }
interface HSVA { h: number; s: number; v: number; a: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const to255 = (n: number) => clamp(Math.round(n), 0, 255);

/** Parse `#rgb`/`#rrggbb`/`rgb()`/`rgba()` into RGBA. Returns null on junk. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const h = m[1]!;
    return { r: parseInt(h[0]! + h[0]!, 16), g: parseInt(h[1]! + h[1]!, 16), b: parseInt(h[2]! + h[2]!, 16), a: 1 };
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1]!;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1]!.split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = parsePart(parts[0]!, 255);
      const g = parsePart(parts[1]!, 255);
      const b = parsePart(parts[2]!, 255);
      const a = parts[3] !== undefined ? parsePart(parts[3]!, 1) : 1;
      return { r: to255(r), g: to255(g), b: to255(b), a: clamp(a, 0, 1) };
    }
  }
  return null;
}

function parsePart(p: string, scale: number): number {
  if (p.endsWith('%')) return (parseFloat(p) / 100) * scale;
  return parseFloat(p);
}

export function rgbaToString({ r, g, b, a }: RGBA): string {
  return a >= 1 ? `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`
    : `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${Number(a.toFixed(3))})`;
}

function rgbToHsv({ r, g, b, a }: RGBA): HSVA {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}

function hsvToRgb({ h, s, v, a }: HSVA): RGBA {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + mm) * 255, g: (gp + mm) * 255, b: (bp + mm) * 255, a };
}

const PRESETS = [
  'rgba(59, 130, 246, 0.35)', 'rgba(16, 185, 129, 0.35)', 'rgba(239, 68, 68, 0.35)',
  'rgba(245, 158, 11, 0.35)', 'rgba(139, 92, 246, 0.35)', 'rgba(236, 72, 153, 0.35)',
  'rgba(20, 184, 166, 0.35)', 'rgba(148, 163, 184, 0.35)',
];

export class ColorPickerControl {
  readonly el: HTMLElement;
  private swatch: HTMLButtonElement;
  private popover: HTMLElement | null = null;
  private hsva: HSVA;
  /** Optional external trigger (e.g. ribbon icon button). When set, the
   *  built-in swatch is hidden and open/reposition use the trigger instead. */
  private trigger: HTMLElement | null = null;
  private readonly onTriggerClick = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    this.toggle();
  };
  private closeOnDocClick = (e: MouseEvent) => {
    const t = e.target as Node;
    // Popover is portaled to <body>, so exclude the host, external trigger, and popover.
    if (
      this.popover
      && !this.el.contains(t)
      && !this.popover.contains(t)
      && !(this.trigger?.contains(t))
    ) this.close();
  };

  constructor(initial: string, private readonly onChange: (rgba: string) => void) {
    this.hsva = rgbToHsv(parseColor(initial) ?? { r: 128, g: 128, b: 128, a: 1 });
    this.el = document.createElement('div');
    this.el.className = 'cg-colorpicker';

    this.swatch = document.createElement('button');
    this.swatch.type = 'button';
    this.swatch.className = 'cg-colorpicker-swatch';
    this.swatch.setAttribute('aria-label', 'Choose colour');
    this.el.appendChild(this.swatch);
    this.paintSwatch();

    this.swatch.addEventListener('click', () => this.toggle());
  }

  /**
   * Drive this picker from an external control (Excel-style ribbon swatch,
   * labeled button, etc.). Hides the built-in swatch; clicks on `trigger`
   * open the popover, which anchors to the trigger's box.
   */
  attachTrigger(trigger: HTMLElement): void {
    if (this.trigger) this.trigger.removeEventListener('click', this.onTriggerClick);
    this.trigger = trigger;
    this.swatch.hidden = true;
    this.swatch.tabIndex = -1;
    this.swatch.setAttribute('aria-hidden', 'true');
    trigger.addEventListener('click', this.onTriggerClick);
  }

  /** Update the control from an external value (e.g. form refresh). Skips
   *  when the value already matches our own output — otherwise a form
   *  refresh triggered by our own commit would re-seed HSVA from RGBA and
   *  lose hue at s=0/v=0 mid-drag. */
  setValue(value: string): void {
    const incoming = parseColor(value);
    if (!incoming) return;
    if (rgbaToString(incoming) === this.current()) return;
    this.hsva = rgbToHsv(incoming);
    this.paintSwatch();
    if (this.popover) this.paintPopover();
  }

  destroy(): void {
    this.close();
    if (this.trigger) {
      this.trigger.removeEventListener('click', this.onTriggerClick);
      this.trigger = null;
    }
    this.el.remove();
  }

  /** Open / close the popover (also used by attachTrigger). */
  toggle(): void {
    if (this.popover) this.close(); else this.open();
  }

  private current(): string {
    return rgbaToString(hsvToRgb(this.hsva));
  }

  private emit(): void {
    this.paintSwatch();
    this.onChange(this.current());
  }

  private paintSwatch(): void {
    // Checkerboard shows through the alpha.
    this.swatch.style.setProperty('--cg-cp-color', this.current());
  }

  private reposition = () => {
    if (!this.popover) return;
    // Fixed positioning anchored to the trigger/swatch, flipped/clamped to
    // stay in the viewport — so a swatch near the bottom of a scrolling
    // panel never needs the popover scrolled into view.
    const pop = this.popover;
    const anchor = (this.trigger ?? this.swatch).getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const margin = 8;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow >= h + margin || spaceBelow >= anchor.top
      ? anchor.bottom + 6
      : Math.max(margin, anchor.top - h - 6);
    let left = anchor.right - w;
    left = Math.min(Math.max(margin, left), window.innerWidth - w - margin);
    pop.style.top = `${Math.max(margin, top)}px`;
    pop.style.left = `${left}px`;
  };

  private open(): void {
    this.popover = document.createElement('div');
    this.popover.className = 'cg-colorpicker-popover';
    // Portaled to <body> — carry the grid's theme class so the class-based
    // --cg-* tokens still resolve outside the theme root.
    const themeClass = this.el.closest('[class*="cg-theme-"]')?.className.match(/cg-theme-[\w-]+/)?.[0];
    if (themeClass) this.popover.classList.add(themeClass);
    this.buildPopover(this.popover);
    // Mount at document.body so the panel's `overflow` never clips it.
    document.body.appendChild(this.popover);
    this.paintPopover();
    this.reposition();
    // Defer so this very click doesn't immediately close it.
    setTimeout(() => {
      document.addEventListener('mousedown', this.closeOnDocClick);
      window.addEventListener('resize', this.reposition);
      window.addEventListener('scroll', this.reposition, true);
    }, 0);
  }

  private close(): void {
    document.removeEventListener('mousedown', this.closeOnDocClick);
    window.removeEventListener('resize', this.reposition);
    window.removeEventListener('scroll', this.reposition, true);
    this.popover?.remove();
    this.popover = null;
  }

  private svPad!: HTMLElement;
  private svThumb!: HTMLElement;
  private hueSlider!: HTMLInputElement;
  private alphaSlider!: HTMLInputElement;
  private hexInput!: HTMLInputElement;

  private buildPopover(root: HTMLElement): void {
    this.svPad = document.createElement('div');
    this.svPad.className = 'cg-colorpicker-sv';
    this.svThumb = document.createElement('div');
    this.svThumb.className = 'cg-colorpicker-sv-thumb';
    this.svPad.appendChild(this.svThumb);
    this.bindPad(this.svPad, (x, y) => {
      this.hsva.s = clamp(x, 0, 1);
      this.hsva.v = clamp(1 - y, 0, 1);
      this.emit();
      this.paintPopover();
    });
    root.appendChild(this.svPad);

    this.hueSlider = this.buildSlider('cg-colorpicker-hue', 0, 360, () => {
      this.hsva.h = Number(this.hueSlider.value);
      this.emit();
      this.paintPopover();
    });
    root.appendChild(this.hueSlider);

    this.alphaSlider = this.buildSlider('cg-colorpicker-alpha', 0, 100, () => {
      this.hsva.a = Number(this.alphaSlider.value) / 100;
      this.emit();
      this.paintPopover();
    });
    root.appendChild(this.alphaSlider);

    this.hexInput = document.createElement('input');
    this.hexInput.type = 'text';
    this.hexInput.className = 'cg-colorpicker-hex';
    this.hexInput.spellcheck = false;
    this.hexInput.addEventListener('change', () => {
      const parsed = parseColor(this.hexInput.value);
      if (parsed) {
        this.hsva = rgbToHsv(parsed);
        this.emit();
        this.paintPopover();
      } else {
        this.paintPopover(); // revert to last valid
      }
    });
    root.appendChild(this.hexInput);

    const presets = document.createElement('div');
    presets.className = 'cg-colorpicker-presets';
    for (const p of PRESETS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'cg-colorpicker-preset';
      sw.style.setProperty('--cg-cp-color', p);
      sw.setAttribute('aria-label', p);
      sw.addEventListener('click', () => {
        this.hsva = rgbToHsv(parseColor(p)!);
        this.emit();
        this.paintPopover();
      });
      presets.appendChild(sw);
    }
    root.appendChild(presets);
  }

  private buildSlider(cls: string, min: number, max: number, oninput: () => void): HTMLInputElement {
    const s = document.createElement('input');
    s.type = 'range';
    s.className = cls;
    s.min = String(min);
    s.max = String(max);
    s.addEventListener('input', oninput);
    return s;
  }

  private paintPopover(): void {
    const pure = rgbaToString({ ...hsvToRgb({ h: this.hsva.h, s: 1, v: 1, a: 1 }) });
    this.svPad.style.setProperty('--cg-cp-hue', pure);
    this.svThumb.style.left = `${this.hsva.s * 100}%`;
    this.svThumb.style.top = `${(1 - this.hsva.v) * 100}%`;
    this.hueSlider.value = String(Math.round(this.hsva.h));
    this.alphaSlider.value = String(Math.round(this.hsva.a * 100));
    const solid = rgbaToString({ ...hsvToRgb({ ...this.hsva, a: 1 }) });
    this.alphaSlider.style.setProperty('--cg-cp-solid', solid);
    this.hexInput.value = this.current();
  }

  private bindPad(pad: HTMLElement, onMove: (x: number, y: number) => void): void {
    const move = (e: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      onMove((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    };
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      move(e);
      const up = () => {
        pad.removeEventListener('pointermove', move);
        pad.removeEventListener('pointerup', up);
      };
      pad.addEventListener('pointermove', move);
      pad.addEventListener('pointerup', up);
    });
  }
}
