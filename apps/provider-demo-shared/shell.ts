/**
 * Minimal page chrome shared by both provider demos.
 *
 * Deliberately thin: VelocityGridExt supplies the real UI (title bar, ribbon,
 * Customize drawer, and the DataProvider editor under Customize → Data). All
 * this adds is a header strip for the app name and a live status line, plus
 * the host element Ext mounts into.
 */

/**
 * Dark by default, for both demos.
 *
 * `vg-theme-cursor-dark` is the kernel's dark theme that the Ext chrome is
 * styled against — the Ext panels read the same `--vg-*` tokens, so picking a
 * theme the chrome was designed for keeps the drawer and ribbon legible.
 */
export const DEMO_THEME = 'vg-theme-cursor-dark';

export type ShellOptions = {
  title: string;
  mode: 'clientSide' | 'serverSide';
};

export type Shell = {
  /** Element to construct VelocityGridExt into. */
  host: HTMLElement;
  setStatus(html: string, cls?: string): void;
};

export function mountShell(opts: ShellOptions): Shell {
  document.documentElement.classList.add(DEMO_THEME);
  document.body.classList.add(DEMO_THEME);

  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  app.className = 'pd-app';
  app.innerHTML = `
    <div class="pd-bar">
      <h1>${opts.title}</h1>
      <span class="pd-mode">${opts.mode}</span>
      <span class="pd-tip">Customize → Data → Apply · Edit… opens the provider editor</span>
      <span class="pd-status" id="status"></span>
    </div>
    <div class="pd-hint">Needs the STOMP fixture: <code>npm run dev:stomp</code> (ws://localhost:8082).</div>
    <div class="pd-main"><div class="pd-grid" id="grid-host"></div></div>
  `;
  const host = document.getElementById('grid-host')!;
  const statusEl = document.getElementById('status')!;
  return {
    host,
    setStatus(html, cls = '') {
      statusEl.innerHTML = `<span class="${cls}">${html}</span>`;
    },
  };
}
