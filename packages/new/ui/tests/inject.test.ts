import { describe, expect, it } from 'vitest';
import { injectVgNewStyles, allCss } from '../src/index';

describe('vg-new-ui', () => {
  it('exports css and injects once', () => {
    expect(allCss.includes('--vgn-bg')).toBe(true);
    injectVgNewStyles(document);
    injectVgNewStyles(document);
    expect(document.querySelectorAll('#vg-new-ui-styles')).toHaveLength(1);
  });
});
