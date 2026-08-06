/**
 * Excel-style ribbon colour control backed by the shared kernel
 * {@link ColorPickerControl} (HSV pad + hue/alpha + presets) — same picker
 * Grid Options uses. Keeps the icon + underline swatch chrome; opens the
 * popover from the button via `attachTrigger`.
 */
import { ColorPickerControl, parseColor } from '@cgrid/kernel';

export type RibbonColorSwatch = {
  button: HTMLButtonElement;
  /** Hidden value carrier — `.value` is a css colour (`rgb()` / `rgba()` / `#rrggbb`). */
  input: HTMLInputElement;
  /** Host that must stay in the DOM (theme class resolution for the popover). */
  host: HTMLElement;
  /** Update without firing `change` (refresh / sync from column style). */
  setValue: (css: string) => void;
  destroy: () => void;
};

function iconBtn(icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cgext-rb-btn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML =
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${icon}"/></svg>`;
  return b;
}

/** True when `value` is a colour the shared picker can round-trip. */
export function isCssColor(value: unknown): value is string {
  return typeof value === 'string' && parseColor(value) !== null;
}

/**
 * Build a ribbon colour swatch. Append both `button` and `host` into the
 * toolbar (host is visually empty — built-in swatch is hidden).
 */
export function ribbonColorSwatch(
  icon: string,
  title: string,
  defaultColor: string,
): RibbonColorSwatch {
  const initial = isCssColor(defaultColor) ? defaultColor : '#888888';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.className = 'cgext-rb-colorinput';
  input.value = initial;

  const button = iconBtn(icon, title);
  button.classList.add('cgext-rb-swatch');
  const bar = document.createElement('span');
  bar.className = 'cgext-rb-swatchbar';
  const paintBar = (): void => {
    bar.style.setProperty('--cgext-swatch', input.value);
  };
  paintBar();
  button.append(bar);

  let suppressEmit = false;
  const picker = new ColorPickerControl(initial, (rgba) => {
    if (suppressEmit) return;
    if (input.value === rgba) {
      paintBar();
      return;
    }
    input.value = rgba;
    paintBar();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  picker.attachTrigger(button);
  picker.el.classList.add('cgext-rb-colorpicker-host');
  picker.el.appendChild(input);

  const setValue = (css: string): void => {
    const next = isCssColor(css) ? css : initial;
    if (input.value === next) {
      paintBar();
      return;
    }
    input.value = next;
    suppressEmit = true;
    picker.setValue(next);
    suppressEmit = false;
    paintBar();
  };

  return {
    button,
    input,
    host: picker.el,
    setValue,
    destroy: () => picker.destroy(),
  };
}

/** Sync a swatch from column style (or fall back when unset / unparseable). */
export function syncRibbonColor(
  swatch: Pick<RibbonColorSwatch, 'setValue' | 'input'>,
  value: unknown,
  fallback: string,
): void {
  const next = isCssColor(value) ? value : fallback;
  if (swatch.input.value !== next) swatch.setValue(next);
}
