// Deterministic PRNG for property tests (Global Constraints: seeded LCG
// only — no Math.random / Date.now anywhere in this package).

export function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
