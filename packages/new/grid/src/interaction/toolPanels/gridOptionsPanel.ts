/**
 * Cycle 21i / Phase 1 (T4) — Grid Options tool panel (built-in
 * `agGridOptionsToolPanel`, sidebar shortcut `'gridOptions'`).
 *
 * A schema-driven settings form over the runtime-mutable option whitelist:
 * ~8 collapsible bands + the Default column fan-out, header search, and a
 * "Modified" filter pill showing the live changed-from-baseline count.
 * Everything below the header is rendered by the shared
 * `interaction/settingsForm` renderer — this class only owns the chrome
 * and the option accessor.
 */

import type { ToolPanel, ToolPanelParams } from './types';
import { buildGridOptionsSchema, type GridOptionsAccessor } from '../../core/optionSchema';
import { SettingsForm } from '../settingsForm/form';

export class GridOptionsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private form: SettingsForm | null = null;
  private modifiedBtn: HTMLButtonElement | null = null;
  private modifiedOnly = false;

  init(params: ToolPanelParams): void {
    const rawApi = params.api as GridOptionsAccessor & {
      setThemeParams?(patch: Record<string, string>): void;
      getThemeParams?(): Record<string, string>;
      isSideBarVisible?(): boolean;
      setSideBarVisible?(show: boolean): void;
    };
    this.root = document.createElement('div');
    this.root.className = 'vg-settings-panel';

    // Theme-colour surface for the Colours band: resolve effective values
    // from the panel's own computed style (tokens inherit down the theme
    // root), apply overrides via the grid's setThemeParams. Only wired
    // when the API exposes theme params (else the band is omitted).
    const api: GridOptionsAccessor = rawApi;
    if (rawApi.setThemeParams && rawApi.getThemeParams) {
      const setThemeParams = rawApi.setThemeParams.bind(rawApi);
      const getThemeParams = rawApi.getThemeParams.bind(rawApi);
      api.resolveThemeColor = (token) => {
        const override = getThemeParams()[token];
        if (override) return override;
        return getComputedStyle(this.root).getPropertyValue(token).trim();
      };
      api.setThemeColor = (token, value) => setThemeParams({ [token]: value });
      api.getThemeColorOverride = (token) => getThemeParams()[token];
    }

    // Side-panel visibility surface — enables the Appearance band's
    // "Side panel" switch. Present on the VelocityGrid api whenever a side bar
    // is configured.
    if (typeof rawApi.isSideBarVisible === 'function' && typeof rawApi.setSideBarVisible === 'function') {
      api.isSideBarVisible = rawApi.isSideBarVisible.bind(rawApi);
      api.setSideBarVisible = rawApi.setSideBarVisible.bind(rawApi);
    }

    // After any commit, refresh the WHOLE form (not just the changed row):
    // fields can depend on each other — e.g. a Density change moves the
    // theme-resolved defaults shown by Row height / Header height.
    this.form = new SettingsForm(buildGridOptionsSchema(api), () => {
      this.form?.refresh();
      this.syncModifiedPill();
    });

    this.root.appendChild(this.buildHeader());
    const scroller = document.createElement('div');
    scroller.className = 'vg-settings-panel-scroller vg-scrollbar';
    scroller.appendChild(this.form.root);
    this.root.appendChild(scroller);
    this.syncModifiedPill();
  }

  getGui(): HTMLElement {
    return this.root;
  }

  /** SideBar host contract — re-read every control (e.g. after a
   *  state restore or external setGridOption). */
  refresh(): void {
    this.form?.refresh();
    this.syncModifiedPill();
  }

  destroy(): void {
    this.form?.destroy();
    this.form = null;
    this.root?.remove();
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'vg-settings-panel-header';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'vg-settings-search';
    search.placeholder = 'Search settings…';
    search.setAttribute('aria-label', 'Search settings');
    search.addEventListener('input', () => this.form?.setFilter(search.value));

    const modified = document.createElement('button');
    modified.type = 'button';
    modified.className = 'vg-settings-modified-pill';
    modified.setAttribute('aria-pressed', 'false');
    modified.title = 'Show only settings changed from their defaults';
    modified.addEventListener('click', () => {
      this.modifiedOnly = !this.modifiedOnly;
      modified.setAttribute('aria-pressed', String(this.modifiedOnly));
      this.form?.setModifiedOnly(this.modifiedOnly);
    });
    this.modifiedBtn = modified;

    header.append(search, modified);
    return header;
  }

  private syncModifiedPill(): void {
    if (!this.modifiedBtn || !this.form) return;
    const n = this.form.modifiedCount();
    this.modifiedBtn.textContent = n > 0 ? `Modified · ${n}` : 'Modified';
    this.modifiedBtn.toggleAttribute('data-has-modified', n > 0);
  }
}
