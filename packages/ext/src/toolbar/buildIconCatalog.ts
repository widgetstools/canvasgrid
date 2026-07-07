// Build script: categorize the kernel's Lucide bundle into picker sections.
// Emits iconCatalog.generated.ts (committed). Regenerate via
// `npm --workspace @cgrid/ext run prebuild-icon-catalog` after bumping
// lucide-static + regenerating the kernel bundle.
//
// Categorization is name-based (ordered first-match rules). The spec allows
// tags.json-derived categories; name rules give equivalent grouping without
// coupling to lucide-static's tag file layout.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';

const RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['Arrows & Direction', /arrow|chevron|move-|^move$|corner-|undo|redo|refresh|rotate|repeat|iteration|forward|reply|expand|shrink|maximize|minimize|navigation|compass|milestone|signpost/],
  ['Charts & Data', /chart|graph|trending|activity|gauge|database|table|kanban|sigma|binary|variable|function|percent|diff/],
  ['Files & Documents', /file|folder|archive|clipboard|notebook|book|newspaper|scroll|sticky|paperclip|bookmark|tag|stamp|printer|save/],
  ['Communication', /mail|message|phone|send|inbox|megaphone|bell|voicemail|rss|share|at-sign|contact|speech|languages|quote/],
  ['Media & AV', /play|pause|music|video|camera|image|film|mic|volume|headphone|radio|tv|disc|cast|aperture|clapperboard|gallery|youtube|podcast|audio/],
  ['People', /^user|users|person|baby|accessibility|venus|mars|handshake|footprints/],
  ['Finance & Commerce', /dollar|euro|pound|yen|bitcoin|coins?|credit-card|wallet|banknote|receipt|shopping|store|package|gift|piggy|landmark|scale|briefcase|chart-candlestick/],
  ['Time & Calendar', /clock|calendar|timer|alarm|hourglass|watch|history/],
  ['Weather & Nature', /sun|moon|cloud|rain|snow|wind|thermometer|umbrella|zap|flower|leaf|tree|sprout|mountain|wave|droplet|flame|rainbow|tornado|haze|eclipse|earth|globe|bug|fish|bird|cat|dog|rabbit|turtle|squirrel|worm|shell|paw/],
  ['Devices & Tech', /laptop|computer|monitor|smartphone|tablet|keyboard|mouse|server|cpu|hard-drive|usb|battery|wifi|bluetooth|plug|router|satellite|scan|qr-code|terminal|code|git-|github|gitlab|chrome|cable|antenna|memory|microchip|network|cloud-(?:upload|download)/],
  ['Transport & Places', /car|bus|truck|train|plane|ship|bike|rocket|fuel|traffic|sailboat|ambulance|tractor|anchor|map|home|house|building|hotel|hospital|school|factory|warehouse|church|castle|tent|luggage|caravan/],
  ['Security & Alerts', /lock|unlock|key|shield|fingerprint|eye|siren|alert|ban|skull|bomb|radiation|biohazard|badge-(?:check|alert|x)|octagon|life-buoy/],
  ['Editing & Tools', /pen|pencil|edit|eraser|scissor|crop|brush|paint|palette|ruler|wrench|hammer|drill|axe|pipette|highlighter|type|bold|italic|underline|strikethrough|align|^list|indent|text|heading|pilcrow|spell|wand|magnet|slider|toggle|filter|settings|tool/],
  ['Shapes & Symbols', /circle|square|triangle|diamond|hexagon|pentagon|octagon$|star|heart|check|^x$|^plus|^minus|slash|asterisk|hash|infinity|equal|divide|dot|shapes|spade|club|award|crown|gem|sparkle|badge$|flag/],
];

const buckets = new Map<string, string[]>(RULES.map(([c]) => [c, []]));
buckets.set('Other', []);
for (const name of Object.keys(lucideBundle)) {
  const rule = RULES.find(([, re]) => re.test(name));
  buckets.get(rule ? rule[0] : 'Other')!.push(name);
}
const categories = [...buckets.entries()]
  .filter(([, icons]) => icons.length > 0)
  .map(([category, icons]) => ({ category, icons: icons.sort((a, b) => a.localeCompare(b)) }));

const __dirname = dirname(fileURLToPath(import.meta.url));
writeFileSync(
  join(__dirname, 'iconCatalog.generated.ts'),
  `// AUTO-GENERATED — do not edit. Regenerate via \`npm --workspace @cgrid/ext run prebuild-icon-catalog\`.
// Categorizes @cgrid/kernel's Lucide bundle for the ribbon icon picker.
export const lucideCategories: ReadonlyArray<{ readonly category: string; readonly icons: readonly string[] }> = ${JSON.stringify(categories, null, 2)} as const;
`,
);
console.log(`[build-icon-catalog] ${categories.length} categories, ${categories.reduce((n, c) => n + c.icons.length, 0)} icons`);
