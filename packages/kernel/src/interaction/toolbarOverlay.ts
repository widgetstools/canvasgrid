/** Toolbar overlay — DOM container for toolbar buttons and controls.
 *  Mounts to the editor container and positions above the grid.
 *  Cycle 21i / Customization. */
export interface ToolbarOverlayOptions {
  getToolbarHeight: () => number;
  getIsVisible: () => boolean;
}

export class ToolbarOverlay {
  private container: HTMLDivElement;

  constructor(
    private host: HTMLElement,
    private options: ToolbarOverlayOptions,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'cg-toolbar';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: ${this.options.getToolbarHeight()}px;
      background-color: var(--cg-header-bg, #f4f6f8);
      border-bottom: 1px solid var(--cg-border-color, #d5dbe0);
      display: flex;
      align-items: center;
      padding: 0 8px;
      gap: 8px;
      z-index: 100;
      overflow: hidden;
      font-family: var(--cg-font-family);
      font-size: var(--cg-font-size, 13px);
      color: var(--cg-header-fg, #1a1f24);
    `;

    if (this.options.getIsVisible()) {
      this.host.appendChild(this.container);
    }
  }

  /** Add a button to the toolbar. */
  addButton(label: string, onClick: () => void, options?: { title?: string; className?: string }): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    button.className = `cg-toolbar-button ${options?.className || ''}`;
    button.title = options?.title || '';
    button.style.cssText = `
      padding: 4px 12px;
      border: 1px solid var(--cg-border-color, #d5dbe0);
      border-radius: 2px;
      background-color: var(--cg-bg-color, #ffffff);
      color: var(--cg-fg-color, #1a1f24);
      cursor: pointer;
      font-size: var(--cg-font-size, 13px);
      font-family: inherit;
      transition: background-color 0.2s;
    `;

    button.addEventListener('click', onClick);
    button.addEventListener('mouseover', () => {
      button.style.backgroundColor = 'var(--cg-row-hover-bg, #eef1f3)';
    });
    button.addEventListener('mouseout', () => {
      button.style.backgroundColor = 'var(--cg-bg-color, #ffffff)';
    });

    this.container.appendChild(button);
    return button;
  }

  /** Add a spacer/divider to the toolbar. */
  addSpacer(): void {
    const spacer = document.createElement('div');
    spacer.style.cssText = `
      flex: 1;
    `;
    this.container.appendChild(spacer);
  }

  /** Add a divider line to the toolbar. */
  addDivider(): void {
    const divider = document.createElement('div');
    divider.style.cssText = `
      width: 1px;
      height: 20px;
      background-color: var(--cg-border-color, #d5dbe0);
      margin: 0 4px;
    `;
    this.container.appendChild(divider);
  }

  /** Add custom HTML content to the toolbar. */
  addContent(html: string): HTMLDivElement {
    const content = document.createElement('div');
    content.innerHTML = html;
    content.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
    `;
    this.container.appendChild(content);
    return content;
  }

  /** Update toolbar height and reposition. */
  updateHeight(height: number): void {
    this.container.style.height = `${height}px`;
  }

  /** Show or hide the toolbar. */
  setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'flex' : 'none';
  }

  /** Get the toolbar container element. */
  getContainer(): HTMLDivElement {
    return this.container;
  }

  /** Clear all toolbar content. */
  clear(): void {
    this.container.innerHTML = '';
  }

  destroy(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
