/**
 * Cycle 21i Phase 2 / T5 — registration proof.
 *
 * A Lit panel built from @cgrid/customizer chrome registers through the
 * EXISTING kernel tool-panel registry (`CGridOptions.components` +
 * `SideBarDef.toolPanels`) with ZERO kernel changes: the litToolPanel
 * adapter satisfies init/getGui/refresh/destroy, the api arrives on the
 * element, and the chrome components render into shadow DOM.
 *
 * Worker/canvas stubs mirror the kernel's runtimeOptions.test.ts so a
 * CGrid constructs under happy-dom.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '@cgrid/kernel';
import { html } from 'lit';
import { litToolPanel, CgcPanelElement } from '../src/litToolPanel';
import { CgcSwitch } from '../src/components';

beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      constructor(public url: URL) {}
      postMessage(): void {}
      addEventListener = (_: string, cb: (e: { data: any }) => void) => {
        this.listeners.push(cb);
      };
      terminate = vi.fn();
    };
    HTMLCanvasElement.prototype.getContext = (() => {
      const fakeCtx: any = {
        fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
        save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
        beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
        measureText: () => ({ width: 50 }),
        fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
        textAlign: '', lineWidth: 1, globalAlpha: 1,
        lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
        shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
        globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
        direction: 'inherit', filter: 'none',
      };
      return () => fakeCtx as any;
    })() as any;
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

/** A minimal flat panel: one band, one switch row bound to the
 *  `animateRows` grid option through the api tier only. */
class ProbePanel extends CgcPanelElement {
  refreshCount = 0;

  override refreshFromGrid(): void {
    this.refreshCount += 1;
    super.refreshFromGrid();
  }

  override render() {
    const animate = this.api.getGridOption('animateRows') === true;
    return html`
      <cgc-band band-title="Probe">
        <cgc-field label="Animate rows" hint="probe row">
          <cgc-switch
            .checked=${animate}
            aria-label="Animate rows"
            @cgc-change=${(e: CustomEvent<{ value: unknown }>) =>
              this.api.setGridOption('animateRows', e.detail.value === true)}
          ></cgc-switch>
        </cgc-field>
      </cgc-band>
    `;
  }
}

async function flushLit(): Promise<void> {
  // Two microtask turns cover LitElement's async render scheduling.
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('Lit panel registration through the kernel tool-panel registry', () => {
  it('mounts, renders chrome into shadow DOM, round-trips a grid option, and refreshes', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'width:800px; height:600px;';
    document.body.appendChild(host);

    const ProbeToolPanel = litToolPanel('cgc-probe-panel', ProbePanel);
    const grid = new CGrid(host, {
      columnDefs: [{ colId: 'a', field: 'a' }],
      rowData: [],
      getRowId: (r: any) => r.id,
      components: { probePanel: ProbeToolPanel },
      sideBar: {
        toolPanels: [
          'columns',
          { id: 'probePanel', labelDefault: 'Probe', toolPanel: 'probePanel' },
        ],
      },
    });
    const api = (grid as any).makeApi();

    api.openToolPanel('probePanel');
    await flushLit();

    const el = host.querySelector('cgc-probe-panel') as ProbePanel;
    expect(el).not.toBeNull();
    expect(el.api).toBeDefined();
    expect(el.shadowRoot).not.toBeNull();

    const band = el.shadowRoot!.querySelector('cgc-band')!;
    expect(band.getAttribute('band-title')).toBe('Probe');
    const field = el.shadowRoot!.querySelector('cgc-field')!;
    expect(field.getAttribute('label')).toBe('Animate rows');
    const sw = el.shadowRoot!.querySelector('cgc-switch') as CgcSwitch;
    expect(sw).not.toBeNull();
    await flushLit();
    expect(sw.shadowRoot!.querySelector('button[role="switch"]')).not.toBeNull();

    // User flips the switch → panel writes through the api tier.
    expect(api.getGridOption('animateRows')).not.toBe(true);
    (sw.shadowRoot!.querySelector('button') as HTMLButtonElement).click();
    await flushLit();
    expect(api.getGridOption('animateRows')).toBe(true);

    // Kernel refresh() reaches the element.
    const before = el.refreshCount;
    api.refreshToolPanel('probePanel');
    expect(el.refreshCount).toBe(before + 1);

    grid.destroy();
    host.remove();
  });

  it('getGui before init throws the documented error', () => {
    const ProbeToolPanel = litToolPanel('cgc-probe-panel', ProbePanel);
    const instance = new ProbeToolPanel();
    expect(() => instance.getGui()).toThrow(/getGui\(\) before init\(\)/);
  });
});
