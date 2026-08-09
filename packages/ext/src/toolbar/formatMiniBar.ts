/**
 * Selection-driven compact format strip — one row, shown only when cells
 * are selected. Deep config opens the settings drawer (More).
 */
import type { ToolbarItem, VelocityGridExtension } from '../extension/types';
import { svg } from './ui';
import { injectTitleBarStyles } from './titleBar';
import { ColorPickerControl } from '@wellsfargo-starui/velocity-grid';
import {
  applyCellStyle,
  asFormatGrid,
  clearCellFormatting,
  currentCellStyle,
  selectedColIds,
  toggleBold,
} from './formatActions';

const I = {
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z',
  fill: 'M19 11H5l7-7 7 7zM5 19h14v2H5z',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  eraser: 'M7 21h10M4.5 12.5l7-7a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-7 7H7.5z',
  more: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  brush: 'M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.07 1.98-2.07 1.98s1.3.7 3.01.7c3.31 0 5.98-2.7 5.98-6.02',
};

function miniBtn(icon: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'vgext-minibar-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg(icon, 14);
  return b;
}

/** Compact format mini-bar for `ribbon.main` (or compose into extensions). */
export function formatMiniBarItem(): ToolbarItem {
  return {
    id: 'format-minibar',
    kind: 'toolbar-item',
    slot: 'ribbon.main',
    init() {},
    render(host, ctx) {
      injectTitleBarStyles();
      injectMiniBarStyles();
      const grid = asFormatGrid(ctx);
      const bar = document.createElement('div');
      bar.className = 'vgext-minibar';
      bar.hidden = true;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Format selection');

      const label = document.createElement('span');
      label.className = 'vgext-minibar-label';
      label.textContent = 'Format';

      const bold = miniBtn(I.bold, 'Bold');
      const fillBtn = miniBtn(I.fill, 'Fill color');
      const textBtn = miniBtn(I.text, 'Text color');
      const clear = miniBtn(I.eraser, 'Clear formatting');
      const more = miniBtn(I.more, 'More formatting…');
      const classic = miniBtn(I.brush, 'Show formatting toolbar');

      let suppressColor = false;
      const fillPicker = new ColorPickerControl('#ffff00', (css) => {
        if (suppressColor) return;
        applyCellStyle(ctx, { bg: css });
        sync();
      });
      const textPicker = new ColorPickerControl('#000000', (css) => {
        if (suppressColor) return;
        applyCellStyle(ctx, { fg: css });
        sync();
      });
      fillPicker.attachTrigger(fillBtn);
      textPicker.attachTrigger(textBtn);

      const sync = (): void => {
        const cols = selectedColIds(grid);
        bar.hidden = cols.length === 0;
        if (!cols.length) return;
        label.textContent = cols.length === 1 ? cols[0]! : `${cols.length} cols`;
        const s = currentCellStyle(grid, cols[0]!);
        bold.classList.toggle('is-on', s.fontWeight === 'bold');
        suppressColor = true;
        if (typeof s.bg === 'string') fillPicker.setValue(s.bg);
        if (typeof s.fg === 'string') textPicker.setValue(s.fg);
        suppressColor = false;
      };

      bold.addEventListener('click', () => { toggleBold(ctx); sync(); });
      clear.addEventListener('click', () => { clearCellFormatting(ctx); sync(); });
      more.addEventListener('click', () => {
        ctx.events.emit({ type: 'open-settings', id: 'column-settings' });
      });
      classic.addEventListener('click', () => {
        ctx.events.emit({ type: 'toggle-ribbon', section: 'format' });
        // If formatting toolbar isn't mounted, open drawer instead.
        const strip = document.querySelector('.vgext-ribbon [data-toolbar="formatting"]');
        if (!strip) ctx.events.emit({ type: 'open-settings', id: 'column-settings' });
      });

      bar.append(label, bold, fillBtn, fillPicker.el, textBtn, textPicker.el, clear, more, classic);
      host.appendChild(bar);

      const offSel = grid.addEventListener('cellSelectionChanged', sync);
      const offFocus = grid.addEventListener('cellFocused', sync);
      sync();

      return {
        destroy() {
          offSel();
          offFocus();
          fillPicker.destroy();
          textPicker.destroy();
          host.replaceChildren();
        },
      };
    },
  };
}

/** Extension set: compact mini-bar only (no classic ribbon). */
export function formatMiniBarExtensions(): VelocityGridExtension[] {
  return [formatMiniBarItem()];
}

function injectMiniBarStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('vgext-minibar-styles')) return;
  const style = document.createElement('style');
  style.id = 'vgext-minibar-styles';
  style.textContent = `
.vgext-minibar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--vg-border-color, #2a3140);
  background: color-mix(in srgb, var(--vg-chrome-background-color, #1a1f2a) 92%, transparent);
}
.vgext-minibar[hidden] { display: none !important; }
.vgext-minibar-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vg-muted-fg-color, #8b93a7);
  margin-right: 6px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vgext-minibar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--vg-fg-color, #e8eaed);
  cursor: pointer;
}
.vgext-minibar-btn:hover {
  background: var(--vg-control-bg, rgba(255,255,255,0.06));
  border-color: var(--vg-border-color, #2a3140);
}
.vgext-minibar-btn.is-on {
  background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 22%, transparent);
  border-color: var(--vg-accent-color, #4f9cf9);
}
.vgext-minibar .vg-colorpicker {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}
`;
  document.head.appendChild(style);
}
