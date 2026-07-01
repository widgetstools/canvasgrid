import { describe, it, expect } from 'vitest';
import corpus from '../fixtures/excel-corpus.json';
import { tokenize } from '../../src/tokenizer';
import { parseExcel } from '../../src/excel/parser';

describe('Excel Tier 0 golden corpus', () => {
  for (const entry of corpus.entries) {
    it(`parses '${entry.source}'`, () => {
      const tokens = tokenize(entry.source);
      const result = parseExcel(tokens);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.tree.sections.length).toBe(entry.sectionCount);
      for (let i = 0; i < entry.sectionCount; i++) {
        const section = result.tree.sections[i];
        if (section === undefined) throw new Error(`section ${i} is undefined`);
        expect(section.namedColor ?? null).toBe(entry.sectionNamedColors[i]);
        if (entry.sectionConditions[i] === null) {
          expect(section.condition).toBeUndefined();
        } else {
          expect(section.condition).toEqual(entry.sectionConditions[i]);
        }
      }
    });
  }
});

describe('Excel Tier 0 tokenizer — kind sequences', () => {
  const kindEntries = corpus.entries.filter((e) => 'tokenKinds' in e);
  for (const entry of kindEntries) {
    it(`token kinds for '${entry.source}'`, () => {
      const tokens = tokenize(entry.source);
      const kinds = tokens.map((t) => t.kind);
      expect(kinds).toEqual((entry as { tokenKinds: string[] }).tokenKinds);
    });
  }
});

describe('Excel Tier 0 parser — error surfaces', () => {
  it('rejects >4 sections', () => {
    const tokens = tokenize('0;0;0;0;0');
    const result = parseExcel(tokens);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('excel-section-count');
    expect(result.error.loc.start).toBe(0);
  });

  it('handles empty source', () => {
    const tokens = tokenize('');
    const result = parseExcel(tokens);
    expect(result.ok).toBe(true);
  });

  it('handles unclosed bracket by treating as literal', () => {
    const tokens = tokenize('[unclosed');
    // Should not throw; treats `[unclosed` as literal token(s).
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0]?.kind).toBe('literal');
  });
});
