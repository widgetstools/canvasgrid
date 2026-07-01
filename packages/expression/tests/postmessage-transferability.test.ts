import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { Ast } from '../src/types';
import corpus from './fixtures/ast-corpus.json' with { type: 'json' };

interface CorpusEntry { src: string; ast: Ast }

describe('AST is structuredClone-safe (postMessage transport)', () => {
  for (const entry of corpus as CorpusEntry[]) {
    it(`round-trips: ${entry.src}`, () => {
      const result = parse(entry.src);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const cloned = structuredClone(result.ast);
      expect(cloned).toEqual(result.ast);
      // JSON-parity: no functions, no classes, no undefined
      const jsonRoundtrip = JSON.parse(JSON.stringify(result.ast));
      expect(jsonRoundtrip).toEqual(result.ast);
    });
  }
});
