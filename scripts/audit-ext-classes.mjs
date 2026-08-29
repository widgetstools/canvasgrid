#!/usr/bin/env node
/**
 * Ext chrome unstyled-class audit — static, no browser needed.
 *
 * Cross-references every class name the ext renders against every class
 * selector it styles (including the names handed to the shared `vgui*Css`
 * generators) and lists the ones nothing styles.
 *
 * Written after `.ckp-actbtn` — the Save button in four settings panes —
 * turned out to have no CSS rule anywhere, so it rendered as a browser
 * default button next to a properly styled Reset.
 *
 *   node scripts/audit-ext-classes.mjs
 *
 * A hit is not automatically a bug: many are hooks styled through a
 * co-class (`.vgext-profiles-trigger` also carries `.vgext-pill`) or used
 * only as a JS selector. It is a list to judge, not a list to fix.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files --cached --others --exclude-standard packages/ext/src', { encoding: 'utf8' })
  .split('\n').filter(f => f.endsWith('.ts'));

const rendered = new Map();   // class -> Set(file)
const styled = new Set();

const addRendered = (cls, file) => {
  for (const c of cls.split(/\s+/)) {
    if (!c || c.includes('$') || c.includes('{')) continue;
    if (!rendered.has(c)) rendered.set(c, new Set());
    rendered.get(c).add(file);
  }
};

for (const f of files) {
  const src = readFileSync(f, 'utf8');

  // ── rendered classes ────────────────────────────────────────────────
  for (const m of src.matchAll(/\bel\(\s*'[^']+'\s*,\s*'([^']+)'/g)) addRendered(m[1], f);
  for (const m of src.matchAll(/\bel\(\s*"[^"]+"\s*,\s*"([^"]+)"/g)) addRendered(m[1], f);
  for (const m of src.matchAll(/\.className\s*=\s*'([^']+)'/g)) addRendered(m[1], f);
  for (const m of src.matchAll(/\.className\s*=\s*"([^"]+)"/g)) addRendered(m[1], f);
  for (const m of src.matchAll(/\bclassName:\s*'([^']+)'/g)) addRendered(m[1], f);
  for (const m of src.matchAll(/\.classList\.add\(([^)]*)\)/g))
    for (const s of m[1].matchAll(/'([^']+)'/g)) addRendered(s[1], f);
  for (const m of src.matchAll(/\bclass="([^"$]+)"/g)) addRendered(m[1], f);

  // ── styled classes: selectors inside template literals ──────────────
  for (const t of src.matchAll(/`([\s\S]*?)`/g)) {
    const body = t[1];
    if (!/[{;]/.test(body)) continue;             // not a stylesheet chunk
    for (const s of body.matchAll(/\.([a-zA-Z][\w-]*)/g)) styled.add(s[1]);
  }
  // ── styled classes: names handed to the vgui*Css generators ─────────
  for (const m of src.matchAll(/vgui\w*Css\w*\(\s*\{([^}]*)\}/g))
    for (const s of m[1].matchAll(/'([^']+)'/g)) styled.add(s[1]);
}

const orphans = [...rendered.entries()]
  .filter(([c]) => !styled.has(c))
  .filter(([c]) => c.startsWith('vgext') || c.startsWith('ckp') || c.startsWith('vg-'))
  .sort((a, b) => a[0].localeCompare(b[0]));

console.log(`rendered classes: ${rendered.size}   styled selectors: ${styled.size}`);
console.log(`\nUNSTYLED (rendered but no CSS rule anywhere): ${orphans.length}\n`);
for (const [c, fs] of orphans) console.log(`  .${c.padEnd(34)} ${[...fs].map(f => f.split('/').pop()).join(', ')}`);
