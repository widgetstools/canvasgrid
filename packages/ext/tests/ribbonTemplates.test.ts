import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('ribbon Templates group wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/toolbar/ribbon.ts'), 'utf8');

  it('Templates group opens the template manager', () => {
    expect(src.includes("grp('Templates'")).toBe(true);
    expect(src.includes('templateManagerMenu')).toBe(true);
    expect(src.includes("dataset.tpl = 'open'")).toBe(true);
    expect(src.includes("dataset.tpl = 'pill'")).toBe(true);
  });

  it('Clear is its own group with undo/redo + eraser + clear-all', () => {
    expect(src.includes("grp('Clear'")).toBe(true);
    expect(src.includes("grp('Templates', mini(tplOpen, tplPill))")).toBe(true);
    expect(src.includes("grp('Clear', mini(fmtUndo, fmtRedo), mini(eraser, clearAll))")).toBe(true);
    expect(src.includes("pill('Clear'")).toBe(false);
    expect(src.includes('createFormatHistory')).toBe(true);
    expect(src.includes('clearColumnCustomization')).toBe(true);
    expect(src.includes('clearLayoutCustomization')).toBe(true);
  });

  it('toolbar trash clears the active layout, not a single template', () => {
    expect(src.includes("dataset.fmt = 'clearAll'")).toBe(true);
    expect(src.includes("dataset.tpl = 'delete'")).toBe(false);
  });
});
