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

/**
 * Create a tabbed interface with animated underline indicators.
 * Uses vguiTabsCssEnhanced styling with smooth transitions.
 *
 * @param tabs — Array of tab definitions
 * @param defaultTabId — Tab ID to show by default (first tab if not specified)
 * @param lucideSvg — Optional function to render Lucide icons (pass from cockpit)
 * @returns TabGroup with root element and switch function
 */
export function createTabGroup(
  tabs: TabDefinition[],
  defaultTabId?: string,
  lucideSvg?: (name: string, size?: number) => string,
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

    if (tab.icon && lucideSvg) {
      btn.innerHTML = `${lucideSvg(tab.icon, 12)}<span>${tab.label}</span>`;
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
    for (const btn of Object.values(tabButtons)) {
      btn.classList.remove('active');
    }
    tabButtons[id]!.classList.add('active');

    // Update pane visibility
    for (const pane of Object.values(panes)) {
      pane.classList.remove('active');
    }
    panes[id]!.classList.add('active');

    currentActive = id;
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
