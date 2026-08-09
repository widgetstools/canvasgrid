import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('ribbon Column group wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/toolbar/ribbon.ts'), 'utf8');
  it('placeholder Edit/Group groups are gone', () => {
    expect(src.includes("seg('Edit'")).toBe(false);
    expect(src.includes("seg('Group'")).toBe(false);
    expect(src.includes("grp('Edit'")).toBe(false);
    expect(src.includes("grp('Group'")).toBe(false);
  });
  it('the Column dropdown + panel are wired', () => {
    expect(src.includes("dropdownBtn(I.settings, 'Column'")).toBe(true);
    expect(src.includes('columnPanelMenu')).toBe(true);
    expect(src.includes("seg('', colOpen)")).toBe(true);
  });

  it('Borders and Icons use compact flyout triggers', () => {
    expect(src.includes("dropdownBtn('M5 5h14v14H5z', 'Borders'")).toBe(true);
    expect(src.includes("dropdownBtn(I.templates, 'Icons'")).toBe(true);
    expect(src.includes('persistentFlyout(bordersOpen')).toBe(true);
    expect(src.includes('persistentFlyout(iconsOpen')).toBe(true);
  });
  it('exposes a filter-type pill gated on floating filter', () => {
    expect(src.includes("dataset.col = 'filterType'")).toBe(true);
    expect(src.includes('FILTER_TYPE_OPTIONS')).toBe(true);
    expect(src.includes('filterTypePill.hidden')).toBe(true);
  });
  it('formatting uses a single-row strip with overflow maxRows 1', () => {
    expect(src.includes('vgext-format-strip')).toBe(true);
    expect(src.includes('maxRows: 1')).toBe(true);
    expect(src.includes("grp('Font'")).toBe(false);
  });
});
