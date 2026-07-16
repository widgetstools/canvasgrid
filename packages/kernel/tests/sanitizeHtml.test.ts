import { describe, it, expect } from 'vitest';
import { sanitizeTooltipHtml, sanitizeIconHtml } from '../src/core/sanitizeHtml';

describe('sanitizeTooltipHtml', () => {
  it('keeps allowlisted markup', () => {
    expect(sanitizeTooltipHtml('<b>bold</b> <em>em</em>')).toBe('<b>bold</b> <em>em</em>');
  });

  it('strips script tags to text', () => {
    const out = sanitizeTooltipHtml('<b>x</b><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('alert(1)');
    expect(out).toContain('<b>x</b>');
  });

  it('strips event-handler attributes', () => {
    const out = sanitizeTooltipHtml('<span onclick="alert(1)">hi</span>');
    expect(out).toBe('<span>hi</span>');
  });

  it('strips img tags', () => {
    const out = sanitizeTooltipHtml('<img src=x onerror=alert(1)>ok');
    expect(out).not.toContain('<img');
    expect(out).toContain('ok');
  });
});

describe('sanitizeIconHtml', () => {
  it('keeps simple SVG paths', () => {
    const svg = '<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>';
    const out = sanitizeIconHtml(svg);
    expect(out).toContain('<svg');
    expect(out).toContain('<path');
    expect(out).toContain('viewBox');
  });

  it('strips script inside SVG', () => {
    const out = sanitizeIconHtml('<svg><script>alert(1)</script><path d="M0 0"/></svg>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<path');
  });

  it('escapes non-SVG markup as text', () => {
    const out = sanitizeIconHtml('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});
