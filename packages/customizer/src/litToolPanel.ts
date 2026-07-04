/**
 * Cycle 21i Phase 2 / T5 — LitElement → kernel ToolPanel adapter.
 *
 * The kernel's tool-panel registry accepts third-party panels through
 * `CGridOptions.components` + `SideBarDef.toolPanels` with the
 * `init/getGui/refresh/destroy` contract (zero kernel changes needed —
 * the recon confirmed attachment is NOT a gap). This adapter bridges
 * that imperative contract to a Lit element:
 *
 *   class SmartEditPanel extends CgcPanelElement { render() {...} }
 *   const SmartEditToolPanel = litToolPanel('cgc-smart-edit', SmartEditPanel);
 *   new CGrid(el, {
 *     components: { smartEdit: SmartEditToolPanel },
 *     sideBar: { toolPanels: [..., { id: 'smartEdit', ... }] },
 *   });
 *
 * The grid api arrives via `@lit/context` (`gridApiContext`) — panel
 * elements consume it instead of threading it through every component.
 * Per the two-tier contract, panels code against `CGridApi` only.
 */
import { LitElement } from 'lit';
import { createContext, ContextProvider } from '@lit/context';
import type { CGridApi, ToolPanel, ToolPanelParams } from '@cgrid/kernel';
import { defineChromeComponents } from './components';

/** Context handing the grid's `CGridApi` down the panel's Lit tree. */
export const gridApiContext = createContext<CGridApi>(Symbol.for('cgrid.api'));

/** Base class for customizer panel elements. Subclasses read
 *  `this.api` (set before first render) and override `refreshFromGrid`
 *  to re-read grid state when the kernel calls `refresh()`. */
export class CgcPanelElement extends LitElement {
  /** The grid api — assigned by the adapter before mount. */
  api!: CGridApi;

  /** Kernel `refresh()` hook — re-read grid state + re-render. */
  refreshFromGrid(): void {
    this.requestUpdate();
  }
}

/** Wrap a `CgcPanelElement` subclass as a kernel `ToolPanelComponent`.
 *  Defines the custom element (idempotent) and returns a zero-arg
 *  constructor satisfying `init/getGui/refresh/destroy`. */
export function litToolPanel(
  tagName: string,
  elementCtor: new () => CgcPanelElement,
  /** Per-instance configuration (e.g. assigning a grid-specific handle
   *  getter). Runs after construction, before mount. Keeping per-grid
   *  state on the INSTANCE — never in the element class — lets one
   *  stable tag serve every grid: customElements.define is permanent,
   *  so per-grid classes would grow the registry forever and pin each
   *  grid's closures past destroy(). */
  setup?: (element: CgcPanelElement) => void,
): new () => ToolPanel {
  return class LitToolPanelAdapter implements ToolPanel {
    private element: CgcPanelElement | null = null;
    private gui: HTMLElement | null = null;

    init(params: ToolPanelParams): void {
      defineChromeComponents();
      if (!customElements.get(tagName)) customElements.define(tagName, elementCtor);
      // A plain wrapper div is the stable gui root; the Lit element
      // mounts inside so destroy/re-init cycles never hand the host a
      // disconnected custom element.
      this.gui = document.createElement('div');
      this.gui.style.cssText = 'display:flex; flex-direction:column; width:100%; height:100%; overflow-y:auto;';
      this.element = document.createElement(tagName) as CgcPanelElement;
      this.element.api = params.api as CGridApi;
      setup?.(this.element);
      // Provide the api via context for nested components.
      new ContextProvider(this.element, { context: gridApiContext, initialValue: params.api as CGridApi });
      this.gui.appendChild(this.element);
    }

    getGui(): HTMLElement {
      if (!this.gui) throw new Error('[cgrid/customizer] getGui() before init()');
      return this.gui;
    }

    refresh(): void {
      this.element?.refreshFromGrid();
    }

    destroy(): void {
      this.element?.remove();
      this.element = null;
      this.gui = null;
    }
  };
}
