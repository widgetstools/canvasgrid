/**
 * Embedded DataProvider editor drawer + popout button.
 *
 * The real editor (`mountDataProviderEditor`) is mounted inline so the whole
 * demo lives in one window and you can watch the grid re-bind the moment a
 * provider is saved. The popout button opens the SAME catalog through
 * `openProviderEditorPopout` — the path VelocityGridExt uses in production —
 * so both integration styles are visible side by side.
 */
import {
  mountDataProviderEditor,
  openProviderEditorPopout,
  type ConfigBackend,
  type DataProviderConfig,
} from '@wellsfargo-starui/velocity-grid-data';

export type EditorDrawerOptions = {
  catalog: ConfigBackend;
  /** Focus this provider when the editor opens. */
  providerId: string;
  /** Fired whenever a provider is saved in EITHER the drawer or the popout. */
  onSaved: (cfg: DataProviderConfig) => void;
};

export type EditorDrawer = {
  toggle(): void;
  destroy(): void;
};

export function mountEditorDrawer(
  host: HTMLElement,
  opts: EditorDrawerOptions,
): EditorDrawer {
  const drawer = document.createElement('aside');
  drawer.className = 'pd-drawer';
  drawer.hidden = true;

  const head = document.createElement('div');
  head.className = 'pd-drawer__head';
  const title = document.createElement('h2');
  title.textContent = 'Data provider';
  const popBtn = document.createElement('button');
  popBtn.type = 'button';
  popBtn.className = 'pd-btn';
  popBtn.textContent = 'Open in popout';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pd-btn';
  closeBtn.textContent = 'Close';
  head.append(title, popBtn, closeBtn);

  const mount = document.createElement('div');
  mount.className = 'pd-drawer__body';
  drawer.append(head, mount);
  host.appendChild(drawer);

  const editor = mountDataProviderEditor({
    mount,
    backend: opts.catalog,
    initialProviderId: opts.providerId,
    onSaved: (cfg) => opts.onSaved(cfg),
  });

  popBtn.addEventListener('click', () => {
    // Same catalog, separate window. Saves there fire the same callback via
    // the popout's own onSaved bridge.
    openProviderEditorPopout({
      backend: opts.catalog,
      providerId: opts.providerId,
      onSaved: (cfg) => opts.onSaved(cfg),
    });
  });
  const hide = (): void => { drawer.hidden = true; };
  closeBtn.addEventListener('click', hide);

  return {
    toggle() { drawer.hidden = !drawer.hidden; },
    destroy() {
      try { editor.destroy?.(); } catch { /* editor already torn down */ }
      drawer.remove();
    },
  };
}
