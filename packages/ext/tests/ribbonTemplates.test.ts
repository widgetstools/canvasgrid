import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('ribbon Templates group wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/toolbar/ribbon.ts'), 'utf8');

  it('Templates segment opens the template manager', () => {
    expect(src.includes("seg('Templates'")).toBe(true);
    expect(src.includes('templateManagerMenu')).toBe(true);
    expect(src.includes("dataset.tpl = 'open'")).toBe(true);
    expect(src.includes("dataset.tpl = 'pill'")).toBe(true);
  });

  it('Clear is its own segment with undo/redo + eraser + clear-all', () => {
    expect(src.includes("seg('Clear'")).toBe(true);
    expect(src.includes("seg('Templates', tplOpen, tplPill)")).toBe(true);
    expect(src.includes("seg('Clear', fmtUndo, fmtRedo, eraser, clearAll)")).toBe(true);
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
