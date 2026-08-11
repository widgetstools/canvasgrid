/**
 * Browser popout for the StompPerspectiveProvider editor (Markets-shaped).
 */
import {
  mountStompPerspectiveProviderEditor,
  type StompPerspectiveProviderEditor,
} from './StompPerspectiveProviderEditor';
import type { StompPerspectiveProviderConfig } from '../provider';
import { ensurePspEditorStyles, PSP_EDITOR_CSS } from './styles';

const POPOUT_NAME = 'vg-perspective-providers';
const POPOUT_WIDTH = 720;
const POPOUT_HEIGHT = 780;

export type OpenPerspectiveProviderEditorPopoutOpts = {
  initial?: Partial<StompPerspectiveProviderConfig>;
  title?: string;
  width?: number;
  height?: number;
  themeSource?: HTMLElement | null;
  onApply?: (cfg: StompPerspectiveProviderConfig) => void | Promise<void>;
  onClose?: () => void;
};

export type PerspectiveProviderEditorPopoutHandle = {
  window: Window;
  editor: StompPerspectiveProviderEditor;
  close(): void;
  focus(): void;
};

let active: PerspectiveProviderEditorPopoutHandle | null = null;

function copyTheme(win: Window, themeSource?: HTMLElement | null): void {
  const src =
    themeSource
    ?? document.querySelector<HTMLElement>('.vgext-root')
    ?? document.querySelector<HTMLElement>('[class*="vg-theme-"]')
    ?? document.documentElement;
  try {
    const mode = src.getAttribute('data-vg-theme-mode')
      ?? (src.className.includes('dark') ? 'dark' : 'light');
    win.document.documentElement.setAttribute('data-vg-theme-mode', mode);
    win.document.documentElement.className = src.className;
    const cs = getComputedStyle(src);
    for (const prop of Array.from(cs)) {
      if (prop.startsWith('--vg-')) {
        win.document.documentElement.style.setProperty(prop, cs.getPropertyValue(prop));
      }
    }
  } catch { /* cross-origin / closed */ }
}

/**
 * Open (or focus) the Perspective provider editor popout.
 * Call from a user gesture to avoid popup blockers.
 */
export function openPerspectiveProviderEditorPopout(
  opts: OpenPerspectiveProviderEditorPopoutOpts = {},
): PerspectiveProviderEditorPopoutHandle | null {
  const width = opts.width ?? POPOUT_WIDTH;
  const height = opts.height ?? POPOUT_HEIGHT;

  if (active?.window && !active.window.closed) {
    active.focus();
    copyTheme(active.window, opts.themeSource);
    return active;
  }

  const features = [
    `width=${width}`,
    `height=${height}`,
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
  const win = window.open('', POPOUT_NAME, features);
  if (!win) return null;

  win.document.title = opts.title ?? 'Perspective data provider';
  win.document.head.innerHTML = '';
  win.document.body.innerHTML = '';
  const style = win.document.createElement('style');
  style.textContent = `
    html, body { height: 100%; margin: 0; }
    body { background: var(--vg-bg-color, #101318); color: var(--vg-fg-color, #e6e8ec); }
    #host { height: 100%; }
    ${PSP_EDITOR_CSS}
  `;
  win.document.head.appendChild(style);
  const host = win.document.createElement('div');
  host.id = 'host';
  win.document.body.appendChild(host);
  copyTheme(win, opts.themeSource);
  ensurePspEditorStyles();

  const editor = mountStompPerspectiveProviderEditor({
    mount: host,
    initial: opts.initial,
    onApply: async (cfg) => {
      await opts.onApply?.(cfg);
      win.close();
    },
    onCancel: () => { win.close(); },
  });

  const handle: PerspectiveProviderEditorPopoutHandle = {
    window: win,
    editor,
    close() { win.close(); },
    focus() { win.focus(); },
  };
  active = handle;

  const onUnload = (): void => {
    editor.destroy();
    if (active === handle) active = null;
    opts.onClose?.();
  };
  win.addEventListener('beforeunload', onUnload);

  return handle;
}
