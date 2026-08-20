// Deterministic PRNG for property tests (self-contained copy — renderers has
// no @wellsfargo-starui/velocity-grid/calc dep). Algorithm identical to packages/calc/tests/helpers/lcg.ts.
// Global constraint: seeded LCG only — no Math.random / Date.now anywhere.

export function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
