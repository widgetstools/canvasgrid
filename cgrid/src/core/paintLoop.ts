export interface DirtyRect { x: number; y: number; w: number; h: number }

const FULL: DirtyRect = { x: -Infinity, y: -Infinity, w: Infinity, h: Infinity };

export class PaintLoop {
  private rects: DirtyRect[] = [];
  private fullPending = false;
  private rafId = 0;
  private running = false;

  constructor(private paint: (rects: DirtyRect[]) => void) {}

  markDirty(r: DirtyRect): void {
    if (this.fullPending) return;
    this.rects.push(r);
  }

  markFullDirty(): void {
    this.fullPending = true;
    this.rects.length = 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (this.fullPending) {
      this.paint([FULL]);
      this.fullPending = false;
    } else if (this.rects.length > 0) {
      this.paint(this.rects.slice());
      this.rects.length = 0;
    }
    this.scheduleNext();
  }
}
