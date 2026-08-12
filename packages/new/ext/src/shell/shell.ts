import {
  confirmDialog,
  el,
  injectVgNewStyles,
  mountButton,
  mountDrawer,
  mountRailNav,
  showToast,
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
  /** Optional as-of label shown in the title bar. */
  asOfLabel?: string;
};

/**
 * Markets-shaped shell: title bar + formatting/editing ribbons + Customize drawer.
 * Phase 1: polished chrome on vg-new-ui (AG density, dirty discard on rail switch).
 */
export class VelocityGridExtShell {
  private readonly dispos: Disposable[] = [];
  private readonly session: ConfigSession;
  private readonly modules: SettingsModule[];
  private activeModuleId = '';
  private panelDirty = false;
  private panelDispos: Disposable | null = null;
  private drawer!: ReturnType<typeof mountDrawer>;
  private railHost!: HTMLElement;
  private scrim!: HTMLElement;
  private ribbonsVisible = true;
  private fmtRibbon!: HTMLElement;
  private editRibbon!: HTMLElement;
  private alertBadge!: HTMLElement;
  private railNav!: ReturnType<typeof mountRailNav>;

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
    this.scrim.dataset.open = 'true';
    this.railNav.setActive(this.activeModuleId);
    this.renderPanel();
  }

  closeCustomize(): void {
    this.drawer.setOpen(false);
    this.scrim.dataset.open = 'false';
  }

  setAlertCount(n: number): void {
    this.alertBadge.textContent = String(Math.max(0, n));
    this.alertBadge.hidden = n <= 0;
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
      'overflow:hidden',
    ].join(';');

    this.mountTitleBar();
    this.mountRibbons();

    const gridSlot = el('div');
    gridSlot.dataset.slot = 'grid';
    gridSlot.style.cssText = 'flex:1;min-height:0;position:relative;';
    this.host.appendChild(gridSlot);

    this.scrim = el('div', 'vgn-shell-scrim');
    this.scrim.addEventListener('click', () => this.closeCustomize());
    this.host.appendChild(this.scrim);

    this.drawer = mountDrawer(this.host, {
      title: 'Customize',
      onClose: () => this.closeCustomize(),
    });
    this.dispos.push(this.drawer);
    this.drawer.root.style.width = 'min(400px, 92vw)';

    this.railHost = el('div');
    this.drawer.body.style.display = 'flex';
    this.drawer.body.style.padding = '0';
    // Replace default panel wrapper: rail + panel
    this.drawer.body.replaceChildren();
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

    this.railNav = mountRailNav(this.railHost, {
      sections,
      activeId: this.activeModuleId,
      onSelect: (id) => { void this.selectModule(id); },
    });
    this.dispos.push(this.railNav);

    this.dispos.push(mountButton(this.drawer.footer, {
      label: 'Close',
      variant: 'ghost',
      onClick: () => this.closeCustomize(),
    }));

    this.renderPanel();
  }

  private mountTitleBar(): void {
    const titleBar = el('div', 'vgn-titlebar');

    const brand = el('div', 'vgn-titlebar__brand');
    brand.appendChild(el('span', 'vgn-titlebar__mark'));
    brand.appendChild(el('span', undefined, this.opts.title ?? 'VelocityGrid'));
    titleBar.appendChild(brand);

    const search = el('input', 'vgn-field__control vgn-titlebar__search');
    search.type = 'search';
    search.placeholder = 'Quick filter…';
    search.setAttribute('aria-label', 'Quick filter');
    search.addEventListener('input', () => {
      try { this.opts.getGridApi().setQuickFilterText(search.value); } catch { /* not ready */ }
    });
    titleBar.appendChild(search);

    const pills = el('div', 'vgn-titlebar__cluster');
    pills.dataset.slot = 'filter-pills';
    for (const label of ['All', 'EQ', 'FX']) {
      const pill = el('button', 'vgn-pill', label);
      pill.type = 'button';
      if (label === 'All') pill.dataset.active = 'true';
      pill.addEventListener('click', () => {
        for (const p of pills.querySelectorAll('.vgn-pill')) {
          (p as HTMLElement).dataset.active = p === pill ? 'true' : 'false';
        }
      });
      pills.appendChild(pill);
    }
    titleBar.appendChild(pills);

    titleBar.appendChild(el('div', 'vgn-titlebar__spacer'));

    const cluster = el('div', 'vgn-titlebar__cluster');
    if (this.opts.asOfLabel) {
      const asOf = el('span', 'vgn-pill', this.opts.asOfLabel);
      asOf.style.cursor = 'default';
      cluster.appendChild(asOf);
    }

    const alertBtn = mountButton(cluster, {
      label: 'Alerts',
      variant: 'ghost',
      title: 'Alerts',
    });
    this.dispos.push(alertBtn);
    this.alertBadge = el('span', 'vgn-badge', '0');
    this.alertBadge.hidden = true;
    this.alertBadge.style.marginLeft = '-6px';
    cluster.appendChild(this.alertBadge);

    this.dispos.push(mountButton(cluster, {
      label: 'Layouts',
      variant: 'ghost',
      onClick: () => this.openCustomize('grid-options'),
    }));
    this.dispos.push(mountButton(cluster, {
      label: 'Customize',
      variant: 'primary',
      onClick: () => this.openCustomize(),
    }));

    const saveBtn = mountButton(cluster, {
      label: 'Save',
      disabled: true,
      onClick: () => {
        void this.session.save().then(() => {
          this.panelDirty = false;
          showToast('Layout saved', { tone: 'ok' });
        });
      },
    });
    this.dispos.push(saveBtn);
    this.dispos.push({
      destroy: this.session.onDirtyChange((dirty) => {
        saveBtn.setLabel(dirty ? 'Save*' : 'Save');
        saveBtn.setDisabled(!dirty);
      }),
    });

    this.dispos.push(mountButton(cluster, {
      label: '⋯',
      variant: 'ghost',
      icon: true,
      title: 'More',
      onClick: () => {
        this.ribbonsVisible = !this.ribbonsVisible;
        this.fmtRibbon.hidden = !this.ribbonsVisible;
        this.editRibbon.hidden = !this.ribbonsVisible;
        showToast(this.ribbonsVisible ? 'Ribbons shown' : 'Ribbons hidden');
      },
    }));

    titleBar.appendChild(cluster);
    this.host.appendChild(titleBar);
  }

  private mountRibbons(): void {
    this.fmtRibbon = el('div', 'vgn-ribbon');
    this.fmtRibbon.setAttribute('aria-label', 'Formatting');
    this.addRibbonGroup(this.fmtRibbon, 'Font', [
      { label: 'B', title: 'Bold' },
      { label: 'I', title: 'Italic' },
      { label: 'U', title: 'Underline' },
    ]);
    this.addRibbonGroup(this.fmtRibbon, 'Align', [
      { label: '⬅', title: 'Left' },
      { label: '▮', title: 'Center' },
      { label: '➡', title: 'Right' },
    ]);
    this.addRibbonGroup(this.fmtRibbon, 'Format', [
      { label: '0.00', title: 'Number format' },
      { label: 'CLR', title: 'Clear formatting' },
    ]);
    this.addRibbonGroup(this.fmtRibbon, 'Templates', [
      { label: 'Tpl', title: 'Column templates' },
    ]);
    this.host.appendChild(this.fmtRibbon);

    this.editRibbon = el('div', 'vgn-ribbon');
    this.editRibbon.setAttribute('aria-label', 'Editing');
    this.addRibbonGroup(this.editRibbon, 'History', [
      { label: '↶', title: 'Undo' },
      { label: '↷', title: 'Redo' },
    ]);
    this.addRibbonGroup(this.editRibbon, 'Edit', [
      { label: 'Smart', title: 'Smart edit' },
      { label: 'Bulk', title: 'Bulk update' },
      { label: '±', title: 'Plus / minus' },
    ]);
    this.host.appendChild(this.editRibbon);
  }

  private addRibbonGroup(
    ribbon: HTMLElement,
    label: string,
    tools: Array<{ label: string; title: string }>,
  ): void {
    const group = el('div', 'vgn-ribbon__group');
    const toolsRow = el('div', 'vgn-ribbon__tools');
    for (const t of tools) {
      this.dispos.push(mountButton(toolsRow, {
        label: t.label,
        variant: 'ghost',
        icon: t.label.length <= 2,
        title: t.title,
        onClick: () => showToast(`${t.title} (Phase 6 wires engines)`),
      }));
    }
    group.appendChild(toolsRow);
    group.appendChild(el('div', 'vgn-ribbon__group-label', label));
    ribbon.appendChild(group);
  }

  private async selectModule(id: string): Promise<void> {
    if (id === this.activeModuleId) return;
    if (this.panelDirty || this.session.isDirty()) {
      const ok = await confirmDialog(this.host, {
        title: 'Discard changes?',
        body: 'You have unsaved customize changes. Switch panels and discard?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!ok) {
        this.railNav.setActive(this.activeModuleId);
        return;
      }
      this.panelDirty = false;
    }
    this.activeModuleId = id;
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
      markDirty: () => {
        this.panelDirty = true;
        this.session.markDirty();
      },
    });
  }

  destroy(): void {
    this.panelDispos?.destroy();
    for (const d of this.dispos.splice(0)) d.destroy();
    this.host.replaceChildren();
  }
}
