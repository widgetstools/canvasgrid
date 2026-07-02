import type { Loc } from '@cgrid/expression';
import type { RuleRefNode } from '../types';

export interface SugarResult {
  /** The canonicalized expression string ready for expression.parse. */
  canonicalized: string;
  /** RuleRefNode reserves discovered during canonicalization. */
  ruleRefs: RuleRefNode[];
}

/**
 * Canonicalize a Tier 1 bracket interior:
 *  1. `if X then Y else Z` → `(X) ? (Y) : (Z)` (recursive)
 *  2. Bare hex `#hhh`/`#hhhh`/`#hhhhhh`/`#hhhhhhhh` → `"#..."` string literal
 *  3. `rule:<id>` → `null` placeholder + RuleRefNode
 *
 * Order of application: (1) first (structural rewrite), then (3) (token
 * rewrite that produces valid expression tokens), then (2) (final token
 * rewrite). Order preserves ability to compose all three.
 */
export function canonicalize(interior: string, interiorLoc: Loc): SugarResult {
  const ruleRefs: RuleRefNode[] = [];
  let source = interior;

  // Step 1 — if/then/else rewrite (recursive).
  source = rewriteIfThenElse(source);

  // Step 2 — rule:<id> rewrite. Emit RuleRefNode with best-effort loc.
  // Loc is approximate: char offset within interior mapped back to source offset.
  const RULE_RE = /rule:([A-Za-z0-9_-]+)/g;
  source = source.replace(RULE_RE, (match, id, offset: number) => {
    ruleRefs.push({
      kind: 'rule-ref',
      ruleId: id,
      loc: {
        start: interiorLoc.start + offset,
        end: interiorLoc.start + offset + match.length,
      },
    });
    return 'null';
  });

  // Step 3 — bare hex rewrite. Only outside existing string literals.
  source = rewriteBareHex(source);

  return { canonicalized: source, ruleRefs };
}

function rewriteIfThenElse(source: string): string {
  // Recursively rewrite `if X then Y else Z` to `(X) ? (Y) : (Z)`.
  // Use a scanner that finds the topmost `if ` and matches its `then`
  // and `else` with correct nesting depth against nested `if`.
  const trimmed = source.replace(/^\s+|\s+$/g, '');
  if (!/^if\s/.test(trimmed)) return source;

  // Find matching `then` and `else` at depth 0.
  const rest = trimmed.slice(3);  // after 'if '
  const thenIdx = findKeywordAtDepth(rest, 'then', 0);
  if (thenIdx === -1) return source;

  const test = rest.slice(0, thenIdx).trim();
  const afterThen = rest.slice(thenIdx + 4);
  const elseIdx = findKeywordAtDepth(afterThen, 'else', 0);
  if (elseIdx === -1) return source;

  const consequent = afterThen.slice(0, elseIdx).trim();
  const alternate = afterThen.slice(elseIdx + 4).trim();

  // Recurse into consequent and alternate for nested if/then/else.
  const recTest = rewriteIfThenElse(test);
  const recConsequent = rewriteIfThenElse(consequent);
  const recAlternate = rewriteIfThenElse(alternate);

  return `(${recTest}) ? (${recConsequent}) : (${recAlternate})`;
}

/**
 * Find the first occurrence of `keyword` at nesting depth 0 (not inside
 * brackets, parens, or string literals). Nested `if/then/else` structures are
 * tracked so that inner `then`/`else` keywords are not mistaken for the
 * outermost one being sought.
 *
 * Strategy: `ifDepth` counts how many inner `if`s we've entered but not yet
 * exited. An inner `if` is closed by its `then` (which reduces ifDepth) AND
 * its `else` (which also reduces ifDepth). The first occurrence of the target
 * keyword with ifDepth===0 is the match.
 */
function findKeywordAtDepth(source: string, keyword: string, startDepth: number): number {
  let depth = startDepth;
  let ifDepth = 0;  // counts open inner `if` blocks at the current bracket depth
  let inStr: '"' | "'" | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; i++; continue; }
    if (c === '[' || c === '(' || c === '{') { depth++; i++; continue; }
    if (c === ']' || c === ')' || c === '}') { depth--; i++; continue; }
    if (depth !== startDepth) { i++; continue; }

    // At target depth: check for structural keywords.
    // `if ` opens a nested block — needs to be matched by a later `else`.
    if (source.slice(i, i + 3) === 'if ' && isTokenBoundary(source, i - 1) && isTokenBoundary(source, i + 2)) {
      ifDepth++;
      i += 3;
      continue;
    }
    // When searching for `then`: the target keyword closes at ifDepth===0.
    // Inner `then` keywords (ifDepth>0) close the inner condition, decrement.
    if (keyword === 'then'
        && source.slice(i, i + 4) === 'then'
        && isTokenBoundary(source, i - 1)
        && isTokenBoundary(source, i + 4)) {
      if (ifDepth === 0) return i;
      ifDepth--;
      i += 4;
      continue;
    }
    // When searching for `else`: `then` is a non-terminal for the inner if
    // (condition close), so skip it without changing ifDepth.
    // `else` at ifDepth>0 closes an inner if block entirely (decrement).
    // `else` at ifDepth===0 is our target.
    if (keyword === 'else') {
      if (source.slice(i, i + 4) === 'then'
          && isTokenBoundary(source, i - 1)
          && isTokenBoundary(source, i + 4)) {
        // skip inner `then` — the `else` of this inner `if` will decrement
        i += 4;
        continue;
      }
      if (source.slice(i, i + 4) === 'else'
          && isTokenBoundary(source, i - 1)
          && isTokenBoundary(source, i + 4)) {
        if (ifDepth === 0) return i;
        ifDepth--;
        i += 4;
        continue;
      }
    }
    i++;
  }
  return -1;
}

function isTokenBoundary(source: string, i: number): boolean {
  if (i < 0 || i >= source.length) return true;
  const c = source[i] ?? '';
  return !/[A-Za-z0-9_]/.test(c);
}

function rewriteBareHex(source: string): string {
  const HEX_RE = /#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g;
  let out = '';
  let inStr: '"' | "'" | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < source.length) { out += source[i + 1]; i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    if (c === '#') {
      HEX_RE.lastIndex = i;
      const match = HEX_RE.exec(source);
      if (match && match.index === i) {
        // Only rewrite valid lengths (3, 4, 6, 8)
        const hexDigits = match[1] ?? '';
        const len = hexDigits.length;
        if (len === 3 || len === 4 || len === 6 || len === 8) {
          out += `"#${hexDigits}"`;
          i += match[0].length;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}
