/**
 * openProviderEditorPopout — browser popout for the shared DataProvider editor.
 *
 * Markets opens a named route via runtime.openSurface; canvasgrid mounts the
 * vanilla shell into a named `window.open` document so multiple grids share
 * one authoring window. The catalog backend is taken from the opener (so
 * MemoryConfigBackend in labs still works). Named window focuses on reopen.
 *
 * Theme: the popout syncs light/dark from the opener (`.vg-theme-*` /
 * `data-vg-theme-mode`) and copies `--vg-*` tokens so chrome matches the grid.
 */
import type { ConfigBackend } from '../catalog/ConfigBackend';
import { createDefaultConfigBackend } from '../catalog/ConfigBackend';
import { registerDefaultTransports } from '../transports/registerDefaults';
import {
  mountDataProviderEditor,
  type DataProviderEditor,
} from './DataProviderEditor';
import { EDITOR_CSS } from './styles';
import { applyThemeToPopout, watchThemeSync } from './themeSync';

const POPOUT_NAME = 'vg-data-providers';
const POPOUT_WIDTH = 1180;
const POPOUT_HEIGHT = 760;

export type OpenProviderEditorPopoutOpts = {
  backend?: ConfigBackend;
  /** Snap the list selection to this providerId. */
  providerId?: string | null;
  width?: number;
  height?: number;
  /**
   * Element carrying `.vg-theme-*` / `data-vg-theme-mode` (e.g. `.vgext-root`).
   * Defaults to the nearest themed node in the opener document.
   */
  themeSource?: HTMLElement | null;
  /** Hub options so Diagnostics hits the same in-process / worker hub as the grid. */
  hubOpts?: import('../client/ProviderClientAdapter').ProviderClientOptions;
  onSaved?: (cfg: import('../types').DataProviderConfig) => void;
  onClose?: () => void;
};

export type ProviderEditorPopoutHandle = {
  window: Window;
  editor: DataProviderEditor;
  close(): void;
  focus(): void;
};

let active: ProviderEditorPopoutHandle | null = null;
let stopThemeWatch: (() => void) | null = null;

/**
 * Open (or focus) the shared data-provider editor popout.
 * Must be called from a user gesture to avoid popup blockers.
 */
export function openProviderEditorPopout(
  opts: OpenProviderEditorPopoutOpts = {},
): ProviderEditorPopoutHandle | null {
  registerDefaultTransports();
  const backend = opts.backend ?? createDefaultConfigBackend();
  const width = opts.width ?? POPOUT_WIDTH;
  const height = opts.height ?? POPOUT_HEIGHT;

  if (active?.window && !active.window.closed) {
    active.focus();
    applyThemeToPopout(active.window, opts.themeSource);
    if (opts.providerId) {
      active.editor.destroy();
      const editor = mountInto(active.window, backend, opts);
      active = { ...active, editor };
    }
    return active;
  }

  const features = [
    `width=${width}`,
    `height=${height}`,
    'resizable=yes',
    'scrollbars=yes',
    'noopener=no',
  ].join(',');

  const win = window.open('about:blank', POPOUT_NAME, features);
  if (!win) {
    console.warn('[velocity-grid-data] Provider editor popout blocked by the browser');
    return null;
  }

  prepareDocument(win);
  applyThemeToPopout(win, opts.themeSource);
  stopThemeWatch?.();
  stopThemeWatch = watchThemeSync(win, opts.themeSource);

  const editor = mountInto(win, backend, opts);

  const cleanup = () => {
    stopThemeWatch?.();
    stopThemeWatch = null;
    editor.destroy();
    if (active?.window === win) active = null;
  };

  const handle: ProviderEditorPopoutHandle = {
    window: win,
    editor,
    close() {
      cleanup();
      if (!win.closed) win.close();
    },
    focus() {
      try { win.focus(); } catch { /* cross-origin / closed */ }
    },
  };

  win.addEventListener('beforeunload', () => {
    cleanup();
    opts.onClose?.();
  });

  active = handle;
  return handle;
}

function prepareDocument(win: Window): void {
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html>
<html lang="en" data-vg-theme-mode="light">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="light dark" />
  <title>Data Providers</title>
  <style>
    ${POPOUT_DOCUMENT_CSS}
    ${EDITOR_CSS}
  </style>
</head>
<body><div id="root"></div></body>
</html>`);
  doc.close();
}

/** Document chrome + light/dark fallbacks when opener tokens are unavailable. */
const POPOUT_DOCUMENT_CSS = `
html, body { margin: 0; height: 100%; }
html {
  color-scheme: light;
  background: var(--vg-bg-color, #ffffff);
  color: var(--vg-fg-color, #1a1f24);
}
html[data-vg-theme-mode="light"] {
  color-scheme: light;
  --vg-fg-color: #1a1f24;
  --vg-bg-color: #ffffff;
  --vg-popup-bg: #f3f6f8;
  --vg-header-bg: #f4f6f8;
  --vg-border-color: #c0c8d1;
  --vg-input-bg: #ffffff;
  --vg-input-fg: #1a1f24;
  --vg-row-alt-bg: #f7f9fb;
  --vg-chrome-accent: #4f9cf9;
  --vg-accent-color: #4f9cf9;
  --vg-primary-color: #4f9cf9;
  --vg-primary-fg: #ffffff;
  --vg-accent-fg: #ffffff;
  --vg-font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
}
html[data-vg-theme-mode="dark"] {
  color-scheme: dark;
  --vg-fg-color: #E6E8EC;
  --vg-bg-color: #1A232E;
  --vg-popup-bg: #242E3A;
  --vg-header-bg: #161D26;
  --vg-border-color: rgb(255 255 255 / 16%);
  --vg-input-bg: #161D26;
  --vg-input-fg: #E6E8EC;
  --vg-row-alt-bg: #1A232E;
  --vg-chrome-accent: #2196f3;
  --vg-accent-color: #2196f3;
  --vg-primary-color: #2196f3;
  --vg-primary-fg: #ffffff;
  --vg-accent-fg: #ffffff;
  --vg-font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
}
body {
  font-family: var(--vg-font-family, "IBM Plex Sans", "Segoe UI", sans-serif);
  background: var(--vg-popup-bg, var(--vg-bg-color, #f3f6f8));
  color: var(--vg-fg-color, #1a1f24);
  color-scheme: inherit;
}
#root { height: 100%; }
`;

function mountInto(
  win: Window,
  backend: ConfigBackend,
  opts: OpenProviderEditorPopoutOpts,
): DataProviderEditor {
  applyThemeToPopout(win, opts.themeSource);
  const root = win.document.getElementById('root') ?? win.document.body;
  return mountDataProviderEditor({
    mount: root,
    backend,
    initialProviderId: opts.providerId ?? null,
    hubOpts: opts.hubOpts,
    onSaved: opts.onSaved,
    onClose: () => {
      opts.onClose?.();
      if (!win.closed) win.close();
    },
  });
}
