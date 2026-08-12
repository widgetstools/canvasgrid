import {
  el,
  injectVgNewStyles,
  mountButton,
  mountDrawer,
  mountRailNav,
  mountToolbar,
  type Disposable,
  type RailSection,
} from '@wellsfargo-starui/vg-new-ui';
import type { VelocityGridApi } from '@wellsfargo-starui/vg-new-grid';
import { ConfigSession } from '../profiles/configSession';
import { buildDefaultModules } from '../modules/defaultModules';
import type { SettingsModule } from '../modules/types';

const CATEGORY_ORDER = ['layout', 'data', 'format', 'editing', 'workspace'] as const;
const CATEGORY_LABEL: Record<string, string> = {
  layout: 'Layout',
  data: 'Data',
  format: 'Format',
  editing: 'Editing',
  workspace: 'Workspace',
};

export type ShellOptions = {
  gridId: string;
  /** Lazy — demos mount the grid into the shell slot after construct. */
  getGridApi: () => VelocityGridApi;
  title?: string;
  modules?: SettingsModule[];
};

/**
 * Markets-shaped shell: title bar + formatting/editing ribbons + Customize drawer.
 * All chrome on vg-new-ui.
 */
export class VelocityGridExtShell {
  private readonly dispos: Disposable[] = [];
  private readonly session: ConfigSession;
  private readonly modules: SettingsModule[];
  private activeModuleId = '';
  private panelDispos: Disposable | null = null;
  private drawer!: ReturnType<typeof mountDrawer>;
  private railHost!: HTMLElement;

  constructor(
    private readonly host: HTMLElement,
    private readonly opts: ShellOptions,
  ) {
    injectVgNewStyles(document);
    this.session = new ConfigSession(opts.gridId);
    this.modules = opts.modules ?? buildDefaultModules();
    this.activeModuleId = this.modules[0]?.id ?? '';
    this.mount();
  }

  getSession(): ConfigSession {
    return this.session;
  }

  openCustomize(moduleId?: string): void {
    if (moduleId) this.activeModuleId = moduleId;
    this.drawer.setOpen(true);
    this.renderPanel();
  }

  private mount(): void {
    this.host.classList.add('vg-new-root');
    this.host.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'height:100%',
      'min-height:0',
      'background:var(--vgn-bg)',
      'color:var(--vgn-fg)',
      'font-family:var(--vgn-font-sans)',
      'font-size:var(--vgn-font-size)',
      'position:relative',
    ].join(';');

    // Title bar
    const titleBar = el('div');
    titleBar.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'height:var(--vgn-titlebar-height)',
      'padding:0 12px',
      'border-bottom:1px solid var(--vgn-border)',
      'background:var(--vgn-bg-elevated)',
      'flex-shrink:0',
    ].join(';');
    const brand = el('strong', undefined, this.opts.title ?? 'VelocityGrid');
    brand.style.marginRight = '8px';
    titleBar.appendChild(brand);
    const search = el('input', 'vgn-field__control');
    search.placeholder = 'Search…';
    search.style.width = '180px';
    search.addEventListener('input', () => {
      this.opts.getGridApi().setQuickFilterText(search.value);
    });
    titleBar.appendChild(search);
    const spacer = el('div');
    spacer.style.flex = '1';
    titleBar.appendChild(spacer);
    this.dispos.push(mountButton(titleBar, {
      label: 'Layouts',
      variant: 'ghost',
      onClick: () => this.openCustomize('grid-options'),
    }));
    this.dispos.push(mountButton(titleBar, {
      label: 'Customize',
      variant: 'primary',
      onClick: () => this.openCustomize(),
    }));
    const saveHost = el('span');
    titleBar.appendChild(saveHost);
    const saveBtn = mountButton(saveHost, {
      label: 'Save',
      disabled: true,
      onClick: () => { void this.session.save(); },
    });
    this.dispos.push(saveBtn);
    this.dispos.push({
      destroy: this.session.onDirtyChange((dirty) => {
        saveBtn.button.textContent = dirty ? 'Save*' : 'Save';
        saveBtn.setDisabled(!dirty);
      }),
    });
    this.host.appendChild(titleBar);

    // Formatting ribbon
    const fmt = mountToolbar(this.host);
    this.dispos.push(fmt);
    for (const label of ['Bold', 'Italic', 'Align', 'Format', 'Clear']) {
      this.dispos.push(mountButton(fmt.root, { label, variant: 'ghost' }));
    }
    fmt.addSeparator();
    this.dispos.push(mountButton(fmt.root, { label: 'Templates', variant: 'ghost' }));

    // Editing ribbon
    const edit = mountToolbar(this.host);
    this.dispos.push(edit);
    for (const label of ['Undo', 'Redo', 'Smart', 'Bulk']) {
      this.dispos.push(mountButton(edit.root, { label, variant: 'ghost' }));
    }

    // Grid slot
    const gridSlot = el('div');
    gridSlot.dataset.slot = 'grid';
    gridSlot.style.cssText = 'flex:1;min-height:0;position:relative;';
    this.host.appendChild(gridSlot);

    // Drawer
    this.drawer = mountDrawer(this.host, {
      title: 'Customize',
      onClose: () => this.drawer.setOpen(false),
    });
    this.dispos.push(this.drawer);
    this.railHost = el('div');
    this.drawer.body.style.display = 'flex';
    this.drawer.body.style.padding = '0';
    this.drawer.body.appendChild(this.railHost);
    const panelHost = el('div', 'vgn-drawer__panel');
    panelHost.dataset.slot = 'panel';
    this.drawer.body.appendChild(panelHost);

    const sections: RailSection[] = CATEGORY_ORDER.map((cat) => ({
      id: cat,
      label: CATEGORY_LABEL[cat] ?? cat,
      items: this.modules
        .filter((m) => m.category === cat)
        .map((m) => ({ id: m.id, label: m.label })),
    })).filter((s) => s.items.length > 0);

    this.dispos.push(mountRailNav(this.railHost, {
      sections,
      activeId: this.activeModuleId,
      onSelect: (id) => {
        this.activeModuleId = id;
        this.renderPanel();
      },
    }));

    this.dispos.push(mountButton(this.drawer.footer, {
      label: 'Close',
      variant: 'ghost',
      onClick: () => this.drawer.setOpen(false),
    }));

    this.renderPanel();
  }

  /** Host should append the grid element into `[data-slot=grid]`. */
  getGridHost(): HTMLElement {
    return this.host.querySelector('[data-slot="grid"]') as HTMLElement;
  }

  private renderPanel(): void {
    this.panelDispos?.destroy();
    this.panelDispos = null;
    const panelHost = this.host.querySelector('[data-slot="panel"]') as HTMLElement;
    panelHost.replaceChildren();
    const mod = this.modules.find((m) => m.id === this.activeModuleId);
    if (!mod) return;
    this.drawer.setTitle(mod.label);
    this.panelDispos = mod.mount(panelHost, {
      gridApi: this.opts.getGridApi(),
      session: this.session,
      markDirty: () => this.session.markDirty(),
    });
  }

  destroy(): void {
    this.panelDispos?.destroy();
    for (const d of this.dispos.splice(0)) d.destroy();
    this.host.replaceChildren();
  }
}
