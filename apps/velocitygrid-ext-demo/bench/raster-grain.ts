// raster-grain.ts — Cycle 22 Task 0 grain benchmark (standalone; NO kernel import).
//
// Renders a synthetic 40-col × visible-rows financial window and repaints it
// every frame under two workloads (one-row-per-frame scroll; 10%-of-visible-
// cells-per-frame ticks), using one of three text-rasterization strategies
// selected by `?mode=`:
//
//   fillText    — one ctx.fillText per cell (current-kernel shape: font/fill
//                 set per style CHANGE, not per cell).
//   glyphAtlas  — pre-rasterized per-character atlas (digits + `.,-+$%` + A–Z,
//                 one atlas row per style), one drawImage per glyph.
//   cellBlit    — per-cell content bitmaps in an LRU keyed by style+string,
//                 rasterized on miss via fillText into a scratch canvas; one
//                 drawImage per cell. `&strips=1` additionally composes rows
//                 into cached strip canvases and presents ONE drawImage per ROW.
//
// All data is deterministic: mulberry32 PRNG with constant seeds; no `Date`
// or `Math.random` anywhere in the paint loop (timing uses performance.now()
// / rAF timestamps only). Geometry, styles, data, and the tick stream are
// identical across modes — only the raster strategy differs.
//
// window.__bench = { runScroll(frames), runTicks(frames) }; each resolves
// { mode, frames, paintMsP50, paintMsP95, paintMsWorst, frameMsWorst, longFrames }
// where longFrames counts rAF-to-rAF deltas > 50ms.

// ---------------------------------------------------------------- constants

const DATA_SEED = 0x5eed2200; // constant — deterministic dataset
const TICK_SEED = 0x9e3779b9; // constant — deterministic tick stream
const COLS = 40;
const ROW_H = 24; // css px (ext pixel discipline)
const PAD_X = 4; // css px cell text inset
const TOTAL_ROWS = 2000; // virtual rows; scroll wraps
const TICK_FRACTION = 0.1; // of visible cells, per frame
const CELL_LRU_CAPACITY = 4096; // identical for cellBlit and cellBlit+strips
const STRIP_LRU_CAPACITY = 128; // rows
const BG = '#181818';
const BAND = '#1f1f1f';
const LONG_FRAME_MS = 50;

const FONT = '12px Menlo, Consolas, "Courier New", monospace';
const FONT_BOLD = 'bold 12px Menlo, Consolas, "Courier New", monospace';

interface CellStyle {
  font: string;
  fill: string;
}

// 0 symbol, 1 price, 2 size, 3 up (delta/pct >= 0), 4 down (delta/pct < 0)
const STYLES: CellStyle[] = [
  { font: FONT_BOLD, fill: '#e8e8e8' },
  { font: FONT, fill: '#d4d4d4' },
  { font: FONT, fill: '#9a9a9a' },
  { font: FONT, fill: '#4ec97a' },
  { font: FONT, fill: '#e05c5c' },
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CHARSET = '0123456789.,-+$%' + LETTERS;

// ------------------------------------------------------------ deterministic

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withCommas(n: number): string {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

interface CellValue {
  text: string;
  style: number;
}

/** Column kind cycles 0..4 across the 40 columns. */
function genCell(kind: number, rng: () => number): CellValue {
  switch (kind) {
    case 0: {
      const n = 3 + Math.floor(rng() * 2);
      let s = '';
      for (let i = 0; i < n; i++) s += LETTERS[Math.floor(rng() * 26)];
      return { text: s, style: 0 };
    }
    case 1: {
      // all price strings are 5 chars so every cell fits its 1/40 column
      const text =
        rng() < 0.5 ? '$' + (1 + rng() * 8.99).toFixed(2) : (10 + rng() * 89.9).toFixed(2);
      return { text, style: 1 };
    }
    case 2:
      return { text: withCommas(100 + Math.floor(rng() * 9900)), style: 2 };
    case 3: {
      const v = rng() * 8 - 4;
      return { text: (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(2), style: v >= 0 ? 3 : 4 };
    }
    default: {
      const v = rng() * 19.8 - 9.9;
      return { text: (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(1) + '%', style: v >= 0 ? 3 : 4 };
    }
  }
}

// ------------------------------------------------------------------- data

const cellText: string[] = new Array(TOTAL_ROWS * COLS);
const cellStyle = new Uint8Array(TOTAL_ROWS * COLS);

function buildData(): void {
  const rng = mulberry32(DATA_SEED);
  for (let r = 0; r < TOTAL_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const g = genCell(c % 5, rng);
      cellText[r * COLS + c] = g.text;
      cellStyle[r * COLS + c] = g.style;
    }
  }
}

// --------------------------------------------------------------- geometry

const canvas = document.getElementById('bench') as HTMLCanvasElement;
const dpr = window.devicePixelRatio || 1;
const cssW = window.innerWidth;
const cssH = window.innerHeight;
canvas.width = Math.round(cssW * dpr);
canvas.height = Math.round(cssH * dpr);
canvas.style.width = cssW + 'px';
canvas.style.height = cssH + 'px';
const ctx = canvas.getContext('2d')!;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.textBaseline = 'middle';

const colW = Math.floor(cssW / COLS);
const visRows = Math.ceil(cssH / ROW_H);
const tickCount = Math.ceil(visRows * COLS * TICK_FRACTION);

// ------------------------------------------------------------------ modes

const params = new URLSearchParams(location.search);
const modeParam = params.get('mode') ?? 'fillText';
const strips = params.get('strips') === '1';
const modeName = modeParam === 'cellBlit' && strips ? 'cellBlit+strips' : modeParam;

/** Shared per-frame chrome: clear + row banding (strips bakes banding into the strip). */
function paintChrome(topRow: number, banding: boolean): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cssW, cssH);
  if (!banding) return;
  ctx.fillStyle = BAND;
  for (let i = 0; i < visRows; i++) {
    if ((topRow + i) & 1) ctx.fillRect(0, i * ROW_H, cssW, ROW_H);
  }
}

// --- mode: fillText --------------------------------------------------------

function paintFillText(topRow: number): void {
  paintChrome(topRow, true);
  let curFont = '';
  let curFill = '';
  for (let i = 0; i < visRows; i++) {
    const r = (topRow + i) % TOTAL_ROWS;
    const y = i * ROW_H + ROW_H / 2;
    const base = r * COLS;
    for (let c = 0; c < COLS; c++) {
      const s = STYLES[cellStyle[base + c]!]!;
      if (s.font !== curFont) {
        ctx.font = s.font;
        curFont = s.font;
      }
      if (s.fill !== curFill) {
        ctx.fillStyle = s.fill;
        curFill = s.fill;
      }
      ctx.fillText(cellText[base + c]!, c * colW + PAD_X, y);
    }
  }
}

// --- mode: glyphAtlas ------------------------------------------------------

interface Glyph {
  sx: number; // device px in atlas
  sy: number;
  sw: number;
  sh: number;
  wCss: number; // slot width, css px
  adv: number; // layout advance, css px
}

let atlasCanvas: HTMLCanvasElement | null = null;
let glyphMaps: Map<string, Glyph>[] = [];

function buildAtlas(): void {
  const slotH = ROW_H;
  const meas = document.createElement('canvas').getContext('2d')!;
  // pass 1: measure slot widths per style
  const advs: number[][] = [];
  const slots: number[][] = [];
  let maxRowW = 0;
  for (const st of STYLES) {
    meas.font = st.font;
    const a: number[] = [];
    const s: number[] = [];
    let rowW = 0;
    for (const ch of CHARSET) {
      const adv = meas.measureText(ch).width;
      const slot = Math.ceil(adv) + 2; // 1px AA bleed padding each side
      a.push(adv);
      s.push(slot);
      rowW += slot;
    }
    advs.push(a);
    slots.push(s);
    if (rowW > maxRowW) maxRowW = rowW;
  }
  atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = Math.round(maxRowW * dpr);
  atlasCanvas.height = Math.round(slotH * STYLES.length * dpr);
  const actx = atlasCanvas.getContext('2d')!;
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
  actx.textBaseline = 'middle';
  glyphMaps = [];
  for (let si = 0; si < STYLES.length; si++) {
    const st = STYLES[si]!;
    actx.font = st.font;
    actx.fillStyle = st.fill;
    const map = new Map<string, Glyph>();
    let x = 0;
    const y = si * slotH;
    for (let ci = 0; ci < CHARSET.length; ci++) {
      const ch = CHARSET[ci]!;
      const slot = slots[si]![ci]!;
      actx.fillText(ch, x + 1, y + slotH / 2);
      map.set(ch, {
        sx: Math.round(x * dpr),
        sy: Math.round(y * dpr),
        sw: Math.round(slot * dpr),
        sh: Math.round(slotH * dpr),
        wCss: slot,
        adv: advs[si]![ci]!,
      });
      x += slot;
    }
    glyphMaps.push(map);
  }
}

function paintGlyphAtlas(topRow: number): void {
  paintChrome(topRow, true);
  const atlas = atlasCanvas!;
  for (let i = 0; i < visRows; i++) {
    const r = (topRow + i) % TOTAL_ROWS;
    const rowY = i * ROW_H;
    const base = r * COLS;
    for (let c = 0; c < COLS; c++) {
      const map = glyphMaps[cellStyle[base + c]!]!;
      const text = cellText[base + c]!;
      let pen = c * colW + PAD_X;
      for (let k = 0; k < text.length; k++) {
        const g = map.get(text[k]!);
        if (!g) {
          pen += 6;
          continue;
        }
        // snap pen to the device-pixel grid (kernel discipline)
        const dx = Math.round(pen * dpr) / dpr;
        ctx.drawImage(atlas, g.sx, g.sy, g.sw, g.sh, dx - 1, rowY, g.wCss, ROW_H);
        pen += g.adv;
      }
    }
  }
}

// --- mode: cellBlit (+strips) ----------------------------------------------

class Lru<V> {
  private map = new Map<string, V>();
  constructor(
    private readonly cap: number,
    private readonly onEvict?: (v: V) => void
  ) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.map.set(k, v);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string;
      const evicted = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.onEvict?.(evicted);
    }
  }
}

// Evicted bitmaps are recycled through a pool: a kernel implementation would
// pool backing stores, and without this the benchmark measures GC/allocation
// churn (measured 100–250ms hitches in Chrome) instead of raster grain.
const cellPool: HTMLCanvasElement[] = [];
const cellLru = new Lru<HTMLCanvasElement>(CELL_LRU_CAPACITY, (cv) => {
  cellPool.push(cv);
});

function rasterizeCell(text: string, styleIdx: number): HTMLCanvasElement {
  let cv = cellPool.pop();
  let c2: CanvasRenderingContext2D;
  if (cv) {
    c2 = cv.getContext('2d')!;
    c2.clearRect(0, 0, colW, ROW_H);
  } else {
    cv = document.createElement('canvas');
    cv.width = Math.round(colW * dpr);
    cv.height = Math.round(ROW_H * dpr);
    c2 = cv.getContext('2d')!;
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2.textBaseline = 'middle';
  }
  const st = STYLES[styleIdx]!;
  c2.font = st.font;
  c2.fillStyle = st.fill;
  c2.fillText(text, PAD_X, ROW_H / 2); // transparent bg — banding shows through
  return cv;
}

function getCellBitmap(idx: number): HTMLCanvasElement {
  const key = cellStyle[idx]! + '|' + cellText[idx]!;
  let bmp = cellLru.get(key);
  if (!bmp) {
    bmp = rasterizeCell(cellText[idx]!, cellStyle[idx]!);
    cellLru.set(key, bmp);
  }
  return bmp;
}

function paintCellBlit(topRow: number): void {
  paintChrome(topRow, true);
  for (let i = 0; i < visRows; i++) {
    const r = (topRow + i) % TOTAL_ROWS;
    const rowY = i * ROW_H;
    const base = r * COLS;
    for (let c = 0; c < COLS; c++) {
      ctx.drawImage(getCellBitmap(base + c), c * colW, rowY, colW, ROW_H);
    }
  }
}

interface Strip {
  canvas: HTMLCanvasElement;
  sctx: CanvasRenderingContext2D;
  keys: string[]; // composed cell key per column
}

const stripPool: Strip[] = [];
const stripLru = new Lru<Strip>(STRIP_LRU_CAPACITY, (s) => {
  stripPool.push(s);
});

function getStrip(r: number): HTMLCanvasElement {
  let strip = stripLru.get(String(r));
  if (!strip) {
    strip = stripPool.pop();
    if (strip) {
      strip.keys.fill('');
    } else {
      const cv = document.createElement('canvas');
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(ROW_H * dpr);
      const sc = cv.getContext('2d')!;
      sc.setTransform(dpr, 0, 0, dpr, 0, 0);
      strip = { canvas: cv, sctx: sc, keys: new Array<string>(COLS).fill('') };
    }
    strip.sctx.fillStyle = r & 1 ? BAND : BG; // banding baked into the strip
    strip.sctx.fillRect(0, 0, cssW, ROW_H);
    stripLru.set(String(r), strip);
  }
  const base = r * COLS;
  for (let c = 0; c < COLS; c++) {
    const key = cellStyle[base + c]! + '|' + cellText[base + c]!;
    if (strip.keys[c] === key) continue;
    strip.sctx.fillStyle = r & 1 ? BAND : BG;
    strip.sctx.fillRect(c * colW, 0, colW, ROW_H);
    strip.sctx.drawImage(getCellBitmap(base + c), c * colW, 0, colW, ROW_H);
    strip.keys[c] = key;
  }
  return strip.canvas;
}

function paintStrips(topRow: number): void {
  paintChrome(topRow, false);
  for (let i = 0; i < visRows; i++) {
    const r = (topRow + i) % TOTAL_ROWS;
    ctx.drawImage(getStrip(r), 0, i * ROW_H, cssW, ROW_H);
  }
}

// ------------------------------------------------------------------ ticks

const tickRng = mulberry32(TICK_SEED);

let topRow = 0;

function applyTicks(): void {
  for (let i = 0; i < tickCount; i++) {
    const r = (topRow + Math.floor(tickRng() * visRows)) % TOTAL_ROWS;
    const c = Math.floor(tickRng() * COLS);
    const g = genCell(c % 5, tickRng);
    cellText[r * COLS + c] = g.text;
    cellStyle[r * COLS + c] = g.style;
  }
}

// ------------------------------------------------------------ measurement

interface BenchResult {
  mode: string;
  frames: number;
  paintMsP50: number;
  paintMsP95: number;
  paintMsWorst: number;
  frameMsWorst: number;
  longFrames: number;
}

let paintFrame: (topRow: number) => void;
let running = false;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function summarize(paints: number[], deltas: number[], frames: number): BenchResult {
  const sorted = [...paints].sort((a, b) => a - b);
  // Closeout M-5 — nearest-rank percentile: index ceil(n*p) - 1, not
  // floor(n*p) (which returned the UPPER median for p=0.5 on even n and
  // P95.17 for p=0.95 at n=600). Bench-only; the Task 0 decision margins
  // (2–16×) were far beyond the off-by-one.
  const pct = (p: number): number =>
    sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))] ?? 0;
  let frameWorst = 0;
  let long = 0;
  for (const d of deltas) {
    if (d > frameWorst) frameWorst = d;
    if (d > LONG_FRAME_MS) long++;
  }
  return {
    mode: modeName,
    frames,
    paintMsP50: round2(pct(0.5)),
    paintMsP95: round2(pct(0.95)),
    paintMsWorst: round2(sorted[sorted.length - 1] ?? 0),
    frameMsWorst: round2(frameWorst),
    longFrames: long,
  };
}

function makeRun(phase: 'scroll' | 'ticks'): (frames: number) => Promise<BenchResult> {
  return (frames: number) =>
    new Promise<BenchResult>((resolve, reject) => {
      if (running) {
        reject(new Error('a run is already in progress'));
        return;
      }
      running = true;
      topRow = 0;
      const paints: number[] = [];
      const deltas: number[] = [];
      let prev = 0;
      let n = 0;
      const step = (ts: number): void => {
        if (prev) deltas.push(ts - prev);
        prev = ts;
        if (phase === 'scroll') topRow = (topRow + 1) % (TOTAL_ROWS - visRows);
        else applyTicks();
        const t0 = performance.now();
        paintFrame(topRow);
        paints.push(performance.now() - t0);
        if (++n < frames) {
          requestAnimationFrame(step);
        } else {
          running = false;
          resolve(summarize(paints, deltas, frames));
        }
      };
      requestAnimationFrame(step);
    });
}

// ------------------------------------------------------------------- init

declare global {
  interface Window {
    __bench?: {
      mode: string;
      runScroll: (frames: number) => Promise<BenchResult>;
      runTicks: (frames: number) => Promise<BenchResult>;
    };
  }
}

async function init(): Promise<void> {
  await document.fonts.ready;
  buildData();
  switch (modeParam) {
    case 'glyphAtlas':
      buildAtlas();
      paintFrame = paintGlyphAtlas;
      break;
    case 'cellBlit':
      paintFrame = strips ? paintStrips : paintCellBlit;
      break;
    default:
      paintFrame = paintFillText;
      break;
  }
  paintFrame(0);
  window.__bench = {
    mode: modeName,
    runScroll: makeRun('scroll'),
    runTicks: makeRun('ticks'),
  };
}

void init();

export {};
