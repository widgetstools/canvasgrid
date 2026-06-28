import 'cgrid/style.css';
import './showcase.css';
import { FEATURES, FEATURE_MAP } from './features/index';
import type { CGrid } from 'cgrid';
import type { ShowcaseRow } from './seedData';

declare global {
  interface Window {
    __cgrid: CGrid<ShowcaseRow> | null;
    __cgridReady: boolean;
  }
}

window.__cgrid = null;
window.__cgridReady = false;

// ─── Theme state ──────────────────────────────────────────────────────────────

let currentTheme = 'cg-theme-quartz-dark';

// ─── Build shell ──────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">cgrid</div>
      <div class="sidebar-subtitle">Feature Showcase</div>
      <button id="theme-toggle" class="theme-toggle" title="Toggle light/dark theme">☀</button>
    </div>
    <nav id="nav"></nav>
  </div>
  <div id="main">
    <div id="desc-bar"></div>
    <div id="controls"></div>
    <div id="grid-host"></div>
  </div>
`;

const nav = document.getElementById('nav')!;
const descBar = document.getElementById('desc-bar')!;
const controls = document.getElementById('controls')!;
const gridHost = document.getElementById('grid-host')!;
const themeToggle = document.getElementById('theme-toggle')!;

// ─── Build sidebar nav ────────────────────────────────────────────────────────

FEATURES.forEach((f) => {
  const a = document.createElement('a');
  a.className = 'feature-item';
  a.textContent = f.label;
  a.dataset.featureId = f.id;
  a.href = `?feature=${f.id}`;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({}, '', `?feature=${f.id}`);
    mount(f.id);
  });
  nav.appendChild(a);
});

// ─── Feature mounting ─────────────────────────────────────────────────────────

let activeGrid: CGrid<ShowcaseRow> | null = null;

function mount(featureId: string): void {
  const feature = FEATURE_MAP.get(featureId) ?? FEATURES[0]!;

  // Update active nav item
  nav.querySelectorAll('.feature-item').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.featureId === feature.id);
  });

  // Tear down previous grid
  if (activeGrid) {
    activeGrid.destroy();
    activeGrid = null;
  }

  window.__cgrid = null;
  window.__cgridReady = false;

  // Clear hosts
  gridHost.innerHTML = '';
  controls.innerHTML = '';

  // Update description
  descBar.innerHTML = `<strong>${feature.label}</strong>${feature.description}`;

  // Mount new grid with current theme
  const grid = feature.mount(gridHost, controls, currentTheme);
  activeGrid = grid;

  window.__cgrid = grid;

  grid.on('firstDataRendered', () => {
    window.__cgridReady = true;
  });
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────

themeToggle.addEventListener('click', () => {
  const isDark = currentTheme === 'cg-theme-quartz-dark';
  currentTheme = isDark ? 'cg-theme-quartz' : 'cg-theme-quartz-dark';
  themeToggle.textContent = isDark ? '☾' : '☀';

  // Apply to running grid
  if (activeGrid) {
    (activeGrid as unknown as { setTheme: (t: string) => void }).setTheme(currentTheme);
  }

  // Flip app-shell data-theme so CSS can respond
  app.dataset.theme = isDark ? 'light' : 'dark';
});

// Start in dark mode
app.dataset.theme = 'dark';

// ─── Initial route ────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const initial = params.get('feature') ?? FEATURES[0]!.id;
mount(initial);

window.addEventListener('popstate', () => {
  const p = new URLSearchParams(window.location.search);
  mount(p.get('feature') ?? FEATURES[0]!.id);
});
