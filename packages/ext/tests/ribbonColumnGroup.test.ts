import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('ribbon Column group wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/toolbar/ribbon.ts'), 'utf8');
  it('placeholder Edit/Group groups are gone', () => {
    expect(src.includes("grp('Edit'")).toBe(false);
    expect(src.includes("grp('Group'")).toBe(false);
  });
  it('the Column group + panel are wired', () => {
    expect(src.includes("grp('Column'")).toBe(true);
    expect(src.includes('columnPanelMenu')).toBe(true);
  });
  it('exposes a filter-type pill gated on floating filter', () => {
    expect(src.includes("dataset.col = 'filterType'")).toBe(true);
    expect(src.includes('FILTER_TYPE_OPTIONS')).toBe(true);
    expect(src.includes('filterTypePill.hidden')).toBe(true);
  });
});