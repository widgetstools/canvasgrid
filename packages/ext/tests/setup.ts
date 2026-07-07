import { vi } from 'vitest';

/** Install the Worker + canvas 2D stubs a `CGrid` needs under happy-dom.
 *  Idempotent — safe to call from every test file's `beforeAll`. */
export function installGridTestEnv(): void {
  const g = globalThis as any;
  if (g.__cgridExtFakeEnv) return;
  g.__cgridExtFakeEnv = true;

  g.Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage(): void {}
    addEventListener = (_: string, cb: (e: { data: any }) => void) => {
      this.listeners.push(cb);
    };
    removeEventListener = () => {};
    terminate = vi.fn();
  };

  HTMLCanvasElement.prototype.getContext = (() => {
    const ctx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
    };
    return () => ctx;
  })() as any;
}
