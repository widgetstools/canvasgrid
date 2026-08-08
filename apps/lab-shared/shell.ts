import { LAB_CATEGORIES } from './categories';
import { getFeature, HINT_BY_ID, LAB_FEATURES, LAB_NAV_ITEMS, type LabFeature } from './features';
import { getLabCatalog } from './profiles';

export type LabMode = 'csrm' | 'ssrm';

export interface LabShellOptions {
  title: string;
  mode: LabMode;
  modeBadge: string;
  /** Called when a feature tab becomes active (not home). */
  onFeature: (feature: LabFeature, host: HTMLElement, consoleEl: HTMLElement) => void | (() => void);
  /** Tear down when leaving a feature tab. */
  onLeaveFeature?: () => void;
}

/**
 * MarketsGrid Feature Lab shell: header · sidebar · main · inspector · demo console.
 */
export function mountLabShell(root: HTMLElement, opts: LabShellOptions): void {
  root.className = 'lab-root';
  root.innerHTML = `
    <header class="lab-header">
      <span class="lab-header-bar" aria-hidden="true"></span>
      <h1>${opts.title}</h1>
      <span class="lab-header-hint" data-lab-hint></span>
      <span class="lab-header-badge">${opts.modeBadge}</span>
    </header>
    <div class="lab-body">
      <aside class="lab-sidebar" data-testid="lab-sidebar">
        <div class="lab-sidebar-filter">
          <input type="search" placeholder="Filter features…" data-lab-filter data-testid="lab-sidebar-filter" />
        </div>
        <div class="lab-sidebar-nav" data-lab-nav></div>
      </aside>
      <main class="lab-main">
        <div class="lab-tab-frame" data-lab-frame></div>
      </main>
    </div>
  `;

  const hintEl = root.querySelector<HTMLElement>('[data-lab-hint]')!;
  const navEl = root.querySelector<HTMLElement>('[data-lab-nav]')!;
  const frameEl = root.querySelector<HTMLElement>('[data-lab-frame]')!;
  const filterEl = root.querySelector<HTMLInputElement>('[data-lab-filter]')!;

  let activeId = 'home';
  let leave: (() => void) | undefined;

  const labelById = new Map(LAB_NAV_ITEMS.map((i) => [i.id, i.label]));

  function renderNav(query = '') {
    const q = query.trim().toLowerCase();
    navEl.innerHTML = '';
    for (const cat of LAB_CATEGORIES) {
      const tabIds = cat.tabIds.filter((id) => labelById.has(id));
      const matches = q
        ? tabIds.filter((id) => (labelById.get(id) ?? id).toLowerCase().includes(q))
        : tabIds;
      if (matches.length === 0) continue;
      const group = document.createElement('div');
      group.className = `lab-nav-group open`;
      group.dataset.groupId = cat.id;
      group.innerHTML = `
        <button type="button" class="lab-nav-group-label">
          <span class="chev">▸</span>${cat.label}
        </button>
        <div class="lab-nav-group-items"></div>
      `;
      const items = group.querySelector('.lab-nav-group-items')!;
      const labelBtn = group.querySelector('.lab-nav-group-label')!;
      labelBtn.addEventListener('click', () => group.classList.toggle('open'));
      for (const id of matches) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `lab-nav-item${id === activeId ? ' active' : ''}`;
        btn.textContent = labelById.get(id) ?? id;
        btn.dataset.id = id;
        btn.addEventListener('click', () => select(id));
        items.appendChild(btn);
      }
      navEl.appendChild(group);
    }
  }

  function renderHome() {
    frameEl.className = 'lab-tab-frame home';
    frameEl.innerHTML = `
      <div class="lab-home">
        <h2>VelocityGrid Feature Lab</h2>
        <p class="lede">
          Port of the MarketsGrid Feature Lab teaching surface onto
          <strong>VelocityGrid</strong> / <strong>VelocityGridExt</strong>.
          Each tab ships <strong>multiple named demo layouts</strong> (title-bar
          Layouts menu) — same ColDefs, different module state. Mode:
          <strong>${opts.mode.toUpperCase()}</strong>
          (${opts.mode === 'csrm' ? 'rowData + applyTransactionAsync ticks' : 'MockSSRMDataProvider SSRM v2'}).
        </p>
        <div class="lab-home-cards"></div>
      </div>
    `;
    const cards = frameEl.querySelector('.lab-home-cards')!;
    for (const f of LAB_FEATURES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'lab-home-card';
      card.innerHTML = `<strong>${f.label}</strong><span>${f.hint}</span>`;
      card.addEventListener('click', () => select(f.id));
      cards.appendChild(card);
    }
  }

  function renderFeature(feature: LabFeature) {
    const inspKey = `lab-inspector-open:${opts.mode}`;
    const preferOpen = (() => {
      try { return localStorage.getItem(inspKey) === '1'; } catch { return false; }
    })();

    frameEl.className = 'lab-tab-frame';
    frameEl.innerHTML = `
      <div class="lab-tab-titlebar">
        <div class="lab-tab-titlebar-text">
          <h2>${feature.title}</h2>
          <p data-lab-subtitle>${feature.subtitle}</p>
        </div>
        <button type="button" class="lab-insp-toggle" data-insp-toggle aria-expanded="${preferOpen ? 'true' : 'false'}">
          ${preferOpen ? 'Hide guide' : 'Show guide'}
        </button>
      </div>
      <div class="lab-grid-host" data-lab-grid></div>
      <div class="lab-inspector${preferOpen ? '' : ' collapsed'}" data-lab-inspector>
        <div class="lab-inspector-tabs">
          <button type="button" class="active" data-insp="what">What / Why</button>
          <button type="button" data-insp="try">Try</button>
          <button type="button" data-insp="config">Config</button>
        </div>
        <div class="lab-inspector-body" data-insp-body></div>
      </div>
      <div class="lab-console" data-lab-console>
        <span>Demo console</span>
        <button type="button" data-console="pause">Pause ticks</button>
        <span data-console-status></span>
      </div>
    `;

    const inspector = frameEl.querySelector<HTMLElement>('[data-lab-inspector]')!;
    const toggleBtn = frameEl.querySelector<HTMLButtonElement>('[data-insp-toggle]')!;
    const setOpen = (open: boolean) => {
      inspector.classList.toggle('collapsed', !open);
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggleBtn.textContent = open ? 'Hide guide' : 'Show guide';
      try { localStorage.setItem(inspKey, open ? '1' : '0'); } catch { /* ignore */ }
    };
    toggleBtn.addEventListener('click', () => setOpen(inspector.classList.contains('collapsed')));

    const body = frameEl.querySelector<HTMLElement>('[data-insp-body]')!;
    const inspButtons = Array.from(frameEl.querySelectorAll<HTMLButtonElement>('[data-insp]'));
    const setInsp = (key: string) => {
      for (const b of inspButtons) {
        b.classList.toggle('active', b.dataset.insp === key);
      }
      if (key === 'what') body.textContent = `${feature.what}\n\nWhy\n${feature.why}`;
      else if (key === 'try') body.textContent = feature.tryIt;
      else {
        const catalog = getLabCatalog(feature.id, opts.mode);
        body.textContent = JSON.stringify(
          {
            gridId: catalog?.gridId ?? feature.gridId,
            mode: opts.mode,
            activeLayoutId: catalog?.activeProfileId,
            layouts: (catalog?.profiles ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              blurb: p.blurb,
              modules: Object.keys(p.seed).filter((k) => (p.seed as Record<string, unknown>)[k] !== undefined),
            })),
            chrome: feature.chrome ?? {},
            columns: feature.getColumnDefs().map((c) => c.field ?? c.colId),
          },
          null,
          2,
        );
      }
    };
    setInsp('try');
    for (const b of inspButtons) {
      b.addEventListener('click', () => {
        setInsp(b.dataset.insp!);
        if (inspector.classList.contains('collapsed')) setOpen(true);
      });
    }

    const gridHost = frameEl.querySelector<HTMLElement>('[data-lab-grid]')!;
    const consoleEl = frameEl.querySelector<HTMLElement>('[data-lab-console]')!;
    const cleanup = opts.onFeature(feature, gridHost, consoleEl);
    leave = typeof cleanup === 'function' ? cleanup : undefined;
  }

  function select(id: string) {
    if (id === activeId && frameEl.childElementCount) {
      // re-render still ok for home; skip duplicate feature mounts
    }
    leave?.();
    leave = undefined;
    opts.onLeaveFeature?.();
    activeId = id;
    hintEl.textContent = `· ${HINT_BY_ID[id] ?? ''}`;
    renderNav(filterEl.value);
    if (id === 'home') renderHome();
    else {
      const feature = getFeature(id);
      if (feature) renderFeature(feature);
    }
  }

  filterEl.addEventListener('input', () => renderNav(filterEl.value));
  select('home');
}
