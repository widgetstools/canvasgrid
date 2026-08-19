/**
 * Tab Group System — Multi-pane interface with animated underline.
 * Part of Phase 4: Information Architecture (tabs + progressive disclosure).
 *
 * Usage:
 *   const tabs = createTabGroup([
 *     { id: 'basic', label: 'Settings', content: basicPaneEl },
 *     { id: 'advanced', label: 'Advanced', content: advancedPaneEl },
 *   ]);
 *   root.appendChild(tabs.root);
 *   tabs.switchTo('advanced');
 */

/**
 * Tab definition passed to createTabGroup.
 * Each tab has an ID, label, optional icon, and content element.
 */
export interface TabDefinition {
  /** Unique tab ID (used for switching, CSS selectors) */
  id: string;
  /** Display label (shown on tab button) */
  label: string;
  /** Optional Lucide icon name (e.g., 'settings') */
  icon?: string;
  /** Content element to show when tab is active */
  content: HTMLElement;
}

/**
 * Tab group container with methods to switch between tabs.
 */
export interface TabGroup {
  /** Root element to append to DOM */
  root: HTMLElement;
  /** Switch to a tab by ID */
  switchTo: (id: string) => void;
  /** Get current active tab ID */
  getActive: () => string;
}

/** Progressive disclosure — bands tagged `basic` land on Settings; `advanced` on Advanced. */
export type BandComplexity = 'basic' | 'advanced';

/**
 * Tag a band root for progressive disclosure. Unmarked bands default to `basic`.
 */
export function markBandComplexity(
  band: { root: HTMLElement } | HTMLElement,
  complexity: BandComplexity,
): void {
  const root = 'root' in band ? band.root : band;
  root.dataset.complexity = complexity;
}

/**
 * Route marked band roots into Settings / Advanced panes.
 * Bands without `data-complexity` go to Settings.
 */
export function appendBandsByComplexity(
  settingsPane: HTMLElement,
  advancedPane: HTMLElement,
  bands: Array<{ root: HTMLElement } | HTMLElement>,
): void {
  for (const b of bands) {
    const root = 'root' in b ? b.root : b;
    const complexity = root.dataset.complexity === 'advanced' ? 'advanced' : 'basic';
    (complexity === 'advanced' ? advancedPane : settingsPane).appendChild(root);
  }
}

/**
 * Standard Settings / Advanced (/ optional History) tab shell used by customize modules.
 */
export function createSettingsAdvancedTabs(opts: {
  settings: HTMLElement;
  advanced: HTMLElement;
  history?: HTMLElement;
  defaultTab?: string;
  lucideSvg?: (name: string, size?: number) => string;
  /** Fired with the newly active tab id — lets a caller remember it across
   *  a full re-render so the sheet doesn't snap back to the first tab. */
  onTabChange?: (id: string) => void;
}): TabGroup {
  const tabs: TabDefinition[] = [
    { id: 'settings', label: 'Settings', icon: 'sliders-horizontal', content: opts.settings },
    { id: 'advanced', label: 'Advanced', icon: 'cog', content: opts.advanced },
  ];
  if (opts.history) {
    tabs.push({ id: 'history', label: 'History', icon: 'history', content: opts.history });
  }
  return createTabGroup(tabs, opts.defaultTab ?? 'settings', opts.lucideSvg, opts.onTabChange);
}

/**
 * Create a tabbed interface with animated underline indicators.
 * Uses vguiTabsCssEnhanced styling with smooth transitions.
 *
 * @param tabs — Array of tab definitions
 * @param defaultTabId — Tab ID to show by default (first tab if not specified)
 * @param lucideSvg — Optional function to render Lucide icons (pass from cockpit)
 * @param onTabChange — Optional callback fired with the new tab id on every switchTo
 * @returns TabGroup with root element and switch function
 */
export function createTabGroup(
  tabs: TabDefinition[],
  defaultTabId?: string,
  lucideSvg?: (name: string, size?: number) => string,
  onTabChange?: (id: string) => void,
): TabGroup {
  const el = (tag: string, className?: string, text?: string): HTMLElement => {
    const elem = document.createElement(tag);
    if (className) elem.className = className;
    if (text) elem.textContent = text;
    return elem;
  };

  if (tabs.length === 0) {
    throw new Error('createTabGroup: tabs array must not be empty');
  }

  const activeId = defaultTabId ?? tabs[0]!.id;
  let currentActive = activeId;

  // Create tab buttons container
  const tabsBar = el('div', 'ckp-tabs-enhanced') as HTMLElement;

  // Create tab buttons
  const tabButtons: Record<string, HTMLElement> = {};
  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.className = `ckp-tab${tab.id === activeId ? ' active' : ''}`;
    btn.type = 'button';
    btn.setAttribute('data-tab-id', tab.id);
    btn.setAttribute('aria-selected', tab.id === activeId ? 'true' : 'false');

    if (tab.icon && lucideSvg) {
      btn.innerHTML = lucideSvg(tab.icon, 12);
      const labelEl = document.createElement('span');
      labelEl.textContent = tab.label;
      btn.appendChild(labelEl);
    } else {
      btn.textContent = tab.label;
    }

    btn.addEventListener('click', () => switchTo(tab.id));
    tabsBar.appendChild(btn);
    tabButtons[tab.id] = btn;
  }

  // Create pane container
  const panesContainer = el('div', 'ckp-tab-panes') as HTMLElement;

  // Create panes
  const panes: Record<string, HTMLElement> = {};
  for (const tab of tabs) {
    const pane = el('div', `ckp-tab-pane${tab.id === activeId ? ' active' : ''}`);
    pane.setAttribute('data-tab-pane', tab.id);
    pane.appendChild(tab.content);
    panesContainer.appendChild(pane);
    panes[tab.id] = pane;
  }

  // Switch to a tab by ID
  const switchTo = (id: string): void => {
    if (!tabButtons[id] || !panes[id]) {
      console.warn(`[TabGroup] Unknown tab ID: ${id}`);
      return;
    }

    // Update button states
    for (const [tid, btn] of Object.entries(tabButtons)) {
      const on = tid === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }

    // Update pane visibility
    for (const [tid, pane] of Object.entries(panes)) {
      pane.classList.toggle('active', tid === id);
    }

    currentActive = id;
    onTabChange?.(id);
  };

  // Root container
  const root = el('div', 'ckp-tab-group') as HTMLElement;
  root.appendChild(tabsBar);
  root.appendChild(panesContainer);

  return {
    root,
    switchTo,
    getActive: () => currentActive,
  };
}

/**
 * Simple tab group variant for flat, single-level organization.
 * No content nesting — just tab labels + bodies.
 */
export function createSimpleTabGroup(
  tabs: Array<{ id: string; label: string }>,
  renderContent: (id: string) => HTMLElement,
  defaultTabId?: string,
): TabGroup {
  const tabDefs: TabDefinition[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    content: renderContent(t.id),
  }));
  return createTabGroup(tabDefs, defaultTabId);
}
