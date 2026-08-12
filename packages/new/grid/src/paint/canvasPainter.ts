import type { ResolvedCol } from '../columns/columnModel';

export type PaintRow = Record<string, unknown>;

const COLORS = {
  light: {
    bg: '#ffffff',
    headerBg: '#eef0f3',
    odd: '#f7f8fa',
    text: '#1f2328',
    muted: '#656d76',
    border: '#d0d7de',
    select: 'rgba(31, 111, 235, 0.12)',
    flash: 'rgba(255, 200, 0, 0.35)',
  },
  dark: {
    bg: '#0d1117',
    headerBg: '#161b22',
    odd: '#12171e',
    text: '#e6edf3',
    muted: '#8b949e',
    border: '#30363d',
    select: 'rgba(47, 129, 247, 0.2)',
    flash: 'rgba(255, 200, 0, 0.25)',
  },
};

export class CanvasPainter {
  private flashUntil = new Map<string, number>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: {
      rowHeight: number;
      headerHeight: number;
      theme: 'light' | 'dark';
      getRowId: (row: PaintRow) => string;
    },
  ) {}

  setTheme(theme: 'light' | 'dark'): void {
    this.opts.theme = theme;
  }

  flashCells(rowIds: string[], ms = 400): void {
    const until = Date.now() + ms;
    for (const id of rowIds) this.flashUntil.set(id, until);
  }

  paint(args: {
    columns: ResolvedCol[];
    rows: PaintRow[];
    scrollTop: number;
    scrollLeft: number;
    selected: Set<string>;
    sortColId?: string;
  }): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    if (
      this.canvas.width !== Math.floor(cssW * dpr)
      || this.canvas.height !== Math.floor(cssH * dpr)
    ) {
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const c = COLORS[this.opts.theme];
    const { rowHeight, headerHeight } = this.opts;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.fillStyle = c.headerBg;
    ctx.fillRect(0, 0, cssW, headerHeight);
    ctx.strokeStyle = c.border;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight + 0.5);
    ctx.lineTo(cssW, headerHeight + 0.5);
    ctx.stroke();

    ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    let x = -args.scrollLeft;
    for (const col of args.columns) {
      if (x + col.width > 0 && x < cssW) {
        ctx.fillStyle = c.muted;
        const mark = args.sortColId === col.colId ? ' *' : '';
        ctx.fillText(col.headerName + mark, x + 8, headerHeight / 2);
        ctx.strokeStyle = c.border;
        ctx.beginPath();
        ctx.moveTo(x + col.width + 0.5, 0);
        ctx.lineTo(x + col.width + 0.5, headerHeight);
        ctx.stroke();
      }
      x += col.width;
    }

    const bodyH = cssH - headerHeight;
    const first = Math.max(0, Math.floor(args.scrollTop / rowHeight));
    const visible = Math.ceil(bodyH / rowHeight) + 1;
    const now = Date.now();

    for (let i = 0; i < visible; i++) {
      const rowIndex = first + i;
      const row = args.rows[rowIndex];
      if (!row) break;
      const y = headerHeight + rowIndex * rowHeight - args.scrollTop;
      const id = this.opts.getRowId(row);
      ctx.fillStyle = rowIndex % 2 === 1 ? c.odd : c.bg;
      ctx.fillRect(0, y, cssW, rowHeight);
      if (args.selected.has(id)) {
        ctx.fillStyle = c.select;
        ctx.fillRect(0, y, cssW, rowHeight);
      }
      const flash = this.flashUntil.get(id);
      if (flash && flash > now) {
        ctx.fillStyle = c.flash;
        ctx.fillRect(0, y, cssW, rowHeight);
      } else if (flash) {
        this.flashUntil.delete(id);
      }

      const isGroup = row.__isGroup === true;
      const isFooter = row.__isFooter === true || row.__isGrandTotal === true;
      if (isGroup || isFooter) {
        ctx.fillStyle = isFooter ? c.headerBg : (this.opts.theme === 'dark' ? '#1a2330' : '#eef3f8');
        ctx.fillRect(0, y, cssW, rowHeight);
      }
      ctx.fillStyle = c.text;
      ctx.font = isGroup || isFooter
        ? '600 12px "IBM Plex Sans", system-ui, sans-serif'
        : '400 12px "IBM Plex Sans", system-ui, sans-serif';
      let cx = -args.scrollLeft;
      for (let ci = 0; ci < args.columns.length; ci++) {
        const col = args.columns[ci]!;
        if (cx + col.width > 0 && cx < cssW) {
          const field = col.field ?? col.colId;
          let text = '';
          if (isGroup && ci === 0) {
            const depth = Number(row.__groupDepth ?? 0);
            const key = String(row.__groupKey ?? '');
            const label = key.includes(':') ? key.split('::').pop()?.split(':').pop() ?? key : key;
            const count = row.__leafCount ?? '';
            text = `${'  '.repeat(depth)}▸ ${label}  (${count})`;
          } else if (isFooter && ci === 0) {
            text = row.__isGrandTotal ? 'Grand Total' : 'Total';
          } else {
            const val = row[field];
            text = val == null ? '' : String(val);
          }
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx, y, col.width, rowHeight);
          ctx.clip();
          ctx.fillText(text, cx + 8, y + rowHeight / 2);
          ctx.restore();
        }
        cx += col.width;
      }
      ctx.strokeStyle = c.border;
      ctx.beginPath();
      ctx.moveTo(0, y + rowHeight + 0.5);
      ctx.lineTo(cssW, y + rowHeight + 0.5);
      ctx.stroke();
    }
  }
}
