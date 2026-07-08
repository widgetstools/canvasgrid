import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Static guard: the prompt path is deleted, the picker is wired.
describe('ribbon format pill wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/toolbar/ribbon.ts'), 'utf8');
  it('window.prompt is gone from the ribbon', () => {
    expect(src.includes('window.prompt')).toBe(false);
  });
  it('the picker menu is wired to the pill', () => {
    expect(src.includes('formatPickerMenu')).toBe(true);
  });
});
