import { vi } from 'vitest';
import { formatPickerMenu, type FormatPickerHost } from '../src/toolbar/formatPicker';
import type { FormatDataType } from '../src/toolbar/formatPresets';

export class FakeFormatHost implements FormatPickerHost {
  cols: string[] = ['px'];
  format: string | undefined = undefined;
  dt: FormatDataType = 'number';
  targetCols(): string[] { return this.cols; }
  currentFormat(): string | undefined { return this.format; }
  dataType(): FormatDataType { return this.dt; }
  applyFormat = vi.fn((f: string) => { this.format = f; });
  clearFormat = vi.fn(() => { this.format = undefined; });
}

export function mountPicker(host = new FakeFormatHost()) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const m = formatPickerMenu(anchor, host);
  m.toggle();
  const panel = document.querySelector<HTMLElement>('.vgext-menu.vgext-fmt')!;
  return { anchor, host, m, panel };
}
