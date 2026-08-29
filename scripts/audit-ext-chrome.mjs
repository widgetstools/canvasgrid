#!/usr/bin/env node
/**
 * Ext chrome design-system audit.
 *
 * Drives a running demo, walks every chrome surface — title bar, both ribbon
 * strips, each popover and flyout, and every Customize tab x sub-tab — and
 * measures every control and every uppercase micro-label against the closed
 * token set in `packages/ext/src/ui/chromeTokens.ts`. Prints one line per
 * distinct class+defect pair with the surfaces it was seen on.
 *
 * This exists because the chrome drifted to 13 control heights, 5 eyebrow
 * specs and 84 padding values without anyone noticing: values that nothing
 * measures do not stay on a scale. Exit is informational — read the list.
 *
 *   npm run dev:ext-demo                    # or dev:perspective-ssrm-sample
 *   node scripts/audit-ext-chrome.mjs http://localhost:5188/
 *
 * A clean run reports `violations: 0`. Anything else is a real deviation or
 * a deliberate exception that belongs in OK / SUBPART below, with a reason.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
if (!URL) {
  console.error('usage: node scripts/audit-ext-chrome.mjs <demo-url>');
  process.exit(2);
}

// ── the closed token set ────────────────────────────────────────────────
const OK = {
  height: new Set([28, 56, 20, 16, 18, 26, 36, 30]), // control (and 2x for a two-line row), chip, checkbox, count, band, strip, dense row
  size:   new Set(['10.5px', '11px', '11.5px', '12px', '12.5px', '13px', '15px']),
  weight: new Set(['400', '500', '600', '700']), // 700 only for the brand
  // --vgext-title-track (-0.01em) as it computes at each type-role size
  track:  new Set(['normal', '0px', '1.1px', '-0.11px', '-0.115px', '-0.12px', '-0.125px', '-0.13px', '-0.15px']),
  radius: new Set(['2px', '0px', '50%', '1.5px']),
  padX:   new Set([0, 4, 6, 8, 10, 12, 13, 16, 24]),
  gap:    new Set(['normal', '0px', '4px', '6px', '8px', '12px', '16px', '24px']),
};
// sub-parts of a compound control — measured as part of their parent, not alone
const MULTILINE = (r) => r.cls.includes('mono') && r.h > 40;  // textarea
const SUBPART = /ckp-chip-label|ckp-chip-value|ckp-knob|rb-step|sf-act\b|swatchbar|cal-day|cal-nav|menu-check|rb-linesample/;

const probe = (surface) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
  const scope = [...document.querySelectorAll('.vgext-root, .vgext-menu, .vgext-sf-pop, .ckp, .vgext-sheet')];
  const seen = new Set();
  const out = [];
  for (const root of scope) {
    const sel = 'button, input, select, textarea, [role="button"], .ckp-chip, .vgext-dp__chip, .vgext-count, .ckp-count';
    for (const e of root.querySelectorAll(sel)) {
      if (seen.has(e) || !vis(e)) continue;
      seen.add(e);
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const cls = e.className.toString().trim();
      if (!/^(vgext|ckp)/.test(cls)) continue;
      out.push({
        role: 'control', surface, cls: cls.slice(0, 52),
        h: Math.round(r.height), size: cs.fontSize, weight: cs.fontWeight,
        track: cs.letterSpacing, radius: cs.borderRadius.split(' ')[0],
        padL: Math.round(parseFloat(cs.paddingLeft)),
        gap: cs.gap.split(' ')[0],
      });
    }
    // TEXT ROLES — uppercase micro-labels are a role, not decoration, and
    // they drifted into five specs last time precisely because nothing
    // measured them.
    for (const e of root.querySelectorAll('*')) {
      if (seen.has(e) || !vis(e) || e.children.length) continue;
      const cs = getComputedStyle(e);
      if (cs.textTransform !== 'uppercase') continue;
      if (!(e.textContent || '').trim()) continue;
      seen.add(e);
      out.push({ role: 'eyebrow', surface,
        cls: (e.className.toString().trim() || e.tagName.toLowerCase()).slice(0, 52),
        size: cs.fontSize, weight: cs.fontWeight, track: cs.letterSpacing });
    }
  }
  return out;
};

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 120)));
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(15000);

const rows = [];
const sample = async (name) => {
  const r = await p.evaluate(probe, name);
  if (Array.isArray(r)) rows.push(...r);
};

await sample('titlebar+ribbon');

for (const [sel, name] of [
  ['.vgext-layouts-trigger', 'menu:layouts'],
  ['.vgext-settings-launcher', 'menu:more'],
  ['button:has-text("Borders")', 'flyout:borders'],
  ['button:has-text("Icons")', 'flyout:icons'],
  ['button:has-text("Column")', 'panel:column'],
]) {
  const l = p.locator(sel).first();
  if (!(await l.count())) continue;
  await l.click().catch(() => {});
  await p.waitForTimeout(1100);
  await sample(name);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
}

await p.locator('.vgext-settings-launcher').first().click();
await p.waitForTimeout(700);
await p.locator('.vgext-menu-item', { hasText: 'Grid options' }).first().click();
await p.waitForTimeout(2200);
const tabs = p.locator('.vgext-sheet-nav-tab');
for (let i = 0; i < (await tabs.count()); i++) {
  const tabName = ((await tabs.nth(i).textContent()) || '').trim();
  await tabs.nth(i).click();
  await p.waitForTimeout(1500);
  const sub = p.locator('.vgext-sheet-subnav-tab');
  const n = await sub.count();
  if (!n) { await sample(`drawer:${tabName}`); continue; }
  for (let j = 0; j < n; j++) {
    const subName = ((await sub.nth(j).textContent()) || '').trim();
    await sub.nth(j).click();
    await p.waitForTimeout(1400);
    const add = p.locator('.ckp-addbtn').first();
    if (await add.count()) { await add.click().catch(() => {}); await p.waitForTimeout(1200); }
    await sample(`drawer:${tabName}/${subName}`);
  }
}
await b.close();

const viol = [];
for (const r of rows) {
  if (SUBPART.test(r.cls) || MULTILINE(r)) continue;
  const bad = [];
  if (r.role === 'eyebrow') {
    if (r.size !== '11px') bad.push(`size=${r.size}`);
    if (r.weight !== '600') bad.push(`w=${r.weight}`);
    if (r.track !== '1.1px') bad.push(`ls=${r.track}`);
    if (bad.length) viol.push({ ...r, bad: 'EYEBROW ' + bad.join(' ') });
    continue;
  }
  if (!OK.height.has(r.h)) bad.push(`h=${r.h}`);
  if (!OK.size.has(r.size)) bad.push(`size=${r.size}`);
  if (!OK.weight.has(r.weight)) bad.push(`w=${r.weight}`);
  if (!OK.track.has(r.track)) bad.push(`ls=${r.track}`);
  if (!OK.radius.has(r.radius)) bad.push(`r=${r.radius}`);
  if (!OK.padX.has(r.padL)) bad.push(`padL=${r.padL}`);
  if (!OK.gap.has(r.gap)) bad.push(`gap=${r.gap}`);
  if (bad.length) viol.push({ ...r, bad: bad.join(' ') });
}
const byClass = new Map();
for (const v of viol) {
  const k = v.cls + ' :: ' + v.bad;
  if (!byClass.has(k)) byClass.set(k, { ...v, n: 0, surfaces: new Set() });
  byClass.get(k).n++;
  byClass.get(k).surfaces.add(v.surface);
}
console.log(`\nsampled ${rows.length} controls across ${new Set(rows.map((r) => r.surface)).size} surfaces`);
console.log(`violations: ${viol.length} across ${byClass.size} distinct class+defect pairs\n`);
for (const [, v] of [...byClass.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(3)}x  ${v.cls.padEnd(44)} ${v.bad.padEnd(26)} ${[...v.surfaces].slice(0, 2).join(', ')}`);
}
