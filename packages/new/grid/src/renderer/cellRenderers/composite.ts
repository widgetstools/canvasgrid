// Composite cell renderer — Cycle 21c / Task 13.
//
// Paints a `type: 'composite'` ColDef cell as an ordered run of styled
// fragments (text + optional inline icon per fragment). The compiled
// program arrives on `CellPaintConfig.compositeProgram` (threaded by
// `applyCellProps` from `ResolvedColDef._compositeProgram`); fragments
// are resolved per cell via `program.resolveFragments`.
//
// Layout: fragments measure left-to-right with per-fragment font
// (weight / italic / size over the cell's base font family). Overflow
// `'ellipsis'` truncates from the LAST fragment backwards — character
// by character when only one fragment remains — and appends `…`.
// Alignment `'left' | 'center' | 'right'` positions the total visible
// width inside the cell's padded box.
//
// Icons draw via the kernel icon registry's Path2D (24×24 Lucide
// viewBox scaled to the icon slot); tint from `IconRef.color`, falling
// back to the fragment's text color.

import type { CellPainter, CellPaintConfig } from './registry';
import { paintBackground } from './registry';
import type { CachedContext2D } from '../gc';
import { resolveIcon } from '../../icons/registry';
import { buildFormatEvalCtx } from '../../core/formatEvalMemo';

/** Structural mirror of format's `FragmentStyle` — kernel never imports
 *  @wellsfargo-starui/velocity-grid-format at runtime, so the shape is re-declared here. */
interface FragStyle {
  color?: string;
  weight?: 'normal' | 'bold' | number;
  style?: 'normal' | 'italic';
  size?: number;
  background?: string;
}

interface FragIcon {
  name: string;
  color?: string;
  position?: 'leading' | 'trailing';
}

interface Frag {
  text: string;
  style: FragStyle;
  icon?: FragIcon;
}

interface MeasuredFrag {
  text: string;
  style: FragStyle;
  textWidth: number;
  iconWidth: number;
  iconPath: Path2D | null;
  iconTint: string | null;
}

const PADDING = 6;
const ICON_GAP = 4;

/** Compose a canvas font shorthand for one fragment, inheriting family
 *  (and default size) from the cell's base font. */
function fragFont(style: FragStyle, baseFont: string): string {
  const m = baseFont.match(/(\d+(?:\.\d+)?)px\s+(.+)$/);
  const baseSize = m ? parseFloat(m[1]!) : 13;
  const family = m ? m[2]! : 'system-ui, sans-serif';
  const size = style.size ?? baseSize;
  const weight = style.weight === undefined ? '400'
    : typeof style.weight === 'number' ? String(style.weight)
    : style.weight === 'bold' ? '700' : '400';
  const italic = style.style === 'italic' ? 'italic ' : '';
  return `${italic}${weight} ${size}px ${family}`;
}

function measureFragments(
  gc: CachedContext2D,
  fragments: Frag[],
  baseFont: string,
  iconSize: number,
): MeasuredFrag[] {
  const out: MeasuredFrag[] = [];
  for (const frag of fragments) {
    let iconPath: Path2D | null = null;
    let iconWidth = 0;
    let iconTint: string | null = null;
    if (frag.icon) {
      iconPath = resolveIcon(frag.icon.name);
      if (iconPath) {
        iconWidth = iconSize + ICON_GAP;
        iconTint = frag.icon.color ?? frag.style.color ?? null;
      }
    }
    gc.cache.font = fragFont(frag.style, baseFont);
    out.push({
      text: frag.text,
      style: frag.style,
      textWidth: gc.measureText(frag.text).width,
      iconWidth,
      iconPath,
      iconTint,
    });
  }
  return out;
}

/** Ellipsis pass — trims text from the last fragment backwards until the
 *  total width (plus the ellipsis glyph) fits `availWidth`. Fragments
 *  emptied of text AND carrying no icon are dropped entirely. */
function applyEllipsis(
  gc: CachedContext2D,
  measured: MeasuredFrag[],
  availWidth: number,
  baseFont: string,
): MeasuredFrag[] {
  const total = measured.reduce((s, m) => s + m.textWidth + m.iconWidth, 0);
  if (total <= availWidth) return measured;

  const visible = measured.slice();
  const widthOf = () => visible.reduce((s, m) => s + m.textWidth + m.iconWidth, 0);

  // Measure the ellipsis in the LAST fragment's font (it lands there).
  const ellipsisIn = (m: MeasuredFrag): number => {
    gc.cache.font = fragFont(m.style, baseFont);
    return gc.measureText('…').width;
  };

  while (visible.length > 0) {
    const last = visible[visible.length - 1]!;
    const ellipsisWidth = ellipsisIn(last);
    if (widthOf() + ellipsisWidth <= availWidth) break;
    if (last.text.length > 0) {
      gc.cache.font = fragFont(last.style, baseFont);
      last.text = last.text.slice(0, -1);
      last.textWidth = gc.measureText(last.text).width;
    } else if (last.iconPath) {
      // Text exhausted but an icon remains — drop the whole fragment.
      visible.pop();
    } else {
      visible.pop();
    }
  }

  if (visible.length > 0) {
    const last = visible[visible.length - 1]!;
    gc.cache.font = fragFont(last.style, baseFont);
    last.text += '…';
    last.textWidth = gc.measureText(last.text).width;
  }
  return visible;
}

export const compositeCell: CellPainter = {
  paint(gc: CachedContext2D, p: CellPaintConfig): void {
    const program = p.compositeProgram;
    if (!program) return;

    paintBackground(gc, p);

    // Cycle 21e / final-review fix — build the ctx through the shared
    // helper so `resolveRuleRef` (rule:<ruleId> fragment colors) reaches
    // resolveFragments when a rule engine is registered. With no engine
    // or no rowId this degrades to the plain 21c ctx shape.
    const fragments = program.resolveFragments(buildFormatEvalCtx({
      value: p.value,
      data: p.rowData ?? {},
      colId: p.colId ?? '',
      rowId: p.rowId,
      themeKind: p.themeKind,
    })) as Frag[] | null;
    if (!fragments || fragments.length === 0) return;

    const { x, y, w, h } = p.bounds;
    const availWidth = w - PADDING * 2;
    if (availWidth <= 0) return;
    const iconSize = Math.floor(h * 0.7);

    let visible = measureFragments(gc, fragments, p.font, iconSize);
    const overflow = p.compositeOverflow ?? 'ellipsis';
    if (overflow === 'ellipsis') {
      visible = applyEllipsis(gc, visible, availWidth, p.font);
    }
    if (visible.length === 0) return;

    const finalWidth = visible.reduce((s, m) => s + m.textWidth + m.iconWidth, 0);
    const align = p.compositeAlign ?? 'left';
    let cursorX = x + PADDING;
    if (align === 'center') cursorX = x + (w - finalWidth) / 2;
    else if (align === 'right') cursorX = x + w - PADDING - finalWidth;

    const cy = y + h / 2;
    gc.cache.textAlign = 'left';
    gc.cache.textBaseline = 'middle';

    for (const m of visible) {
      // Fragment-level background highlight behind its own run.
      if (m.style.background) {
        gc.cache.fillStyle = m.style.background;
        gc.fillRect(cursorX, y, m.textWidth + m.iconWidth, h);
      }
      if (m.iconPath) {
        const iconY = y + (h - iconSize) / 2;
        gc.cache.save();
        gc.translate(cursorX, iconY);
        const scale = iconSize / 24; // Lucide viewBox is 24×24
        gc.scale(scale, scale);
        gc.cache.strokeStyle = m.iconTint ?? m.style.color ?? p.fg;
        gc.cache.lineWidth = 2 / scale;
        gc.cache.lineCap = 'round';
        gc.cache.lineJoin = 'round';
        gc.stroke(m.iconPath);
        gc.cache.restore();
        cursorX += m.iconWidth;
      }
      if (m.text.length > 0) {
        gc.cache.font = fragFont(m.style, p.font);
        gc.cache.fillStyle = m.style.color ?? p.fg;
        gc.fillText(m.text, cursorX, cy);
        cursorX += m.textWidth;
      }
    }
  },
};
