export interface ResolvedTheme {
  font: string;
  fg: string;
  bg: string;
  headerBg: string;
  headerFg: string;
  borderColor: string;
  gridLineColor: string;
  rowAltBg: string;
  rowHoverBg: string;
  rowSelectedBg: string;
  focusRingColor: string;
  focusRingWidth: number;
  flashFromColor: string;
  flashToColor: string;
  rowHeight: number;
  headerHeight: number;
  resizerHotZone: number;
}

export class CssReader {
  constructor(private container: HTMLElement) {}

  read(): ResolvedTheme {
    const cs = getComputedStyle(this.container);
    const get = (name: string) => cs.getPropertyValue(name).trim();
    const px = (name: string, fallback: number) => {
      const v = parseFloat(get(name));
      return Number.isFinite(v) ? v : fallback;
    };

    const fontSize = get('--cg-font-size') || '13px';
    const fontFamily = get('--cg-font-family') || 'system-ui';

    return {
      font: `${fontSize} ${fontFamily}`,
      fg: get('--cg-fg-color') || '#1a1f24',
      bg: get('--cg-bg-color') || '#ffffff',
      headerBg: get('--cg-header-bg') || '#e8ecef',
      headerFg: get('--cg-header-fg') || '#1a1f24',
      borderColor: get('--cg-border-color') || '#d5dbe0',
      gridLineColor: get('--cg-grid-line-color') || '#e8ecef',
      rowAltBg: get('--cg-row-alt-bg') || '#f4f6f8',
      rowHoverBg: get('--cg-row-hover-bg') || '#eef1f3',
      rowSelectedBg: get('--cg-row-selected-bg') || 'rgba(13,148,136,0.12)',
      focusRingColor: get('--cg-focus-ring-color') || '#0d9488',
      focusRingWidth: px('--cg-focus-ring-width', 2),
      flashFromColor: get('--cg-flash-from-color') || '#fef3c7',
      flashToColor: get('--cg-flash-to-color') || 'rgba(254,243,199,0)',
      rowHeight: px('--cg-row-height', 30),
      headerHeight: px('--cg-header-height', 32),
      resizerHotZone: px('--cg-resizer-hot-zone', 4),
    };
  }
}
