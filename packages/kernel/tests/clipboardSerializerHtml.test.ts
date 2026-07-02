// Cycle 21c / Task 15 — multi-format clipboard serialization helpers.

import { describe, it, expect } from 'vitest';
import { serializeToTsv, serializeToHtml } from '../src/interaction/features/clipboardSerializer';

describe('clipboardSerializer — TSV', () => {
  it('serializes simple rows', () => {
    const tsv = serializeToTsv([
      { cells: [{ text: 'A' }, { text: 'B' }] },
      { cells: [{ text: 'C' }, { text: 'D' }] },
    ]);
    expect(tsv).toBe('A\tB\nC\tD');
  });

  it('escapes tabs and newlines in cell text', () => {
    const tsv = serializeToTsv([{ cells: [{ text: 'a\tb\nc' }] }]);
    expect(tsv).toBe('a b c');
  });

  it('empty rows produce empty string', () => {
    expect(serializeToTsv([])).toBe('');
  });
});

describe('clipboardSerializer — HTML', () => {
  it('emits <table> with plain <td> for non-composite', () => {
    const html = serializeToHtml([{ cells: [{ text: 'A' }, { text: 'B' }] }]);
    expect(html).toBe('<table><tr><td>A</td><td>B</td></tr></table>');
  });

  it('emits styled <span> runs for composite fragments', () => {
    const html = serializeToHtml([{
      cells: [{
        text: 'AAPL 150',
        fragments: [
          { text: 'AAPL', style: { weight: 'bold', color: '#000' } },
          { text: ' ', style: {} },
          { text: '150', style: { color: '#0a7' } },
        ],
      }],
    }]);
    expect(html).toContain('<span style="color:#000;font-weight:bold">AAPL</span>');
    expect(html).toContain('<span style="">');
    expect(html).toContain('<span style="color:#0a7">150</span>');
  });

  it('italic + size + background land as inline CSS', () => {
    const html = serializeToHtml([{
      cells: [{
        text: 'x',
        fragments: [{ text: 'x', style: { style: 'italic', size: 11, background: '#ff0' } }],
      }],
    }]);
    expect(html).toContain('background-color:#ff0');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('font-size:11px');
  });

  it('escapes HTML entities in fragment text', () => {
    const html = serializeToHtml([{
      cells: [{ text: '<b>', fragments: [{ text: '<b>', style: {} }] }],
    }]);
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<td><b>');
  });

  it('escapes HTML entities in plain cell text', () => {
    const html = serializeToHtml([{ cells: [{ text: 'a & <c>' }] }]);
    expect(html).toContain('a &amp; &lt;c&gt;');
  });
});
