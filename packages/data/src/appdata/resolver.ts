/**
 * Template resolver — `{{providerName.key}}` substitution.
 * Markets-compatible port of starui host-data `runtime/template/resolver.ts`.
 *
 * Token grammar:
 *   `{{name.key}}`    — resolves to `lookup(name, key)`.
 *   `{{name.a.b.c}}`  — name is the FIRST segment; the rest joins by `.`
 *                       and indexes into a JSON-shaped value.
 * Unresolved tokens are left verbatim (debug affordance).
 */

export type AppDataLookup = (providerName: string, key: string) => unknown;

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function resolveTemplate(input: string, lookup: AppDataLookup): string {
  return input.replace(TOKEN_RE, (whole, expr: string) => {
    const dot = expr.indexOf('.');
    if (dot < 0) return whole;
    const providerName = expr.slice(0, dot).trim();
    const path = expr.slice(dot + 1).trim();
    if (!providerName || !path) return whole;

    const direct = lookup(providerName, path);
    if (direct !== undefined && direct !== null) return stringify(direct);

    const dot2 = path.indexOf('.');
    if (dot2 < 0) return whole;
    const head = path.slice(0, dot2);
    const rest = path.slice(dot2 + 1);
    const headValue = lookup(providerName, head);
    if (!headValue || typeof headValue !== 'object') return whole;
    const nested = walk(headValue, rest);
    return nested === undefined ? whole : stringify(nested);
  });
}

/** Deep-walk cfg; replace every string leaf via resolveTemplate. Never mutates input. */
export function resolveCfg<T>(cfg: T, lookup: AppDataLookup): T {
  return walkCfg(cfg, lookup) as T;
}

function walkCfg(value: unknown, lookup: AppDataLookup): unknown {
  if (typeof value === 'string') return resolveTemplate(value, lookup);
  if (Array.isArray(value)) return value.map((v) => walkCfg(v, lookup));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walkCfg(v, lookup);
    return out;
  }
  return value;
}

function walk(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const seg of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Collect every templated path referenced in a cfg (for subscribe/re-resolve). */
export function collectTemplateRefs(cfg: unknown): Array<{ providerName: string; key: string }> {
  const seen = new Set<string>();
  const out: Array<{ providerName: string; key: string }> = [];
  walkRefs(cfg, (providerName, key) => {
    const id = `${providerName}\0${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ providerName, key });
  });
  return out;
}

function walkRefs(value: unknown, visit: (name: string, key: string) => void): void {
  if (typeof value === 'string') {
    let m: RegExpExecArray | null;
    const re = new RegExp(TOKEN_RE.source, 'g');
    while ((m = re.exec(value)) !== null) {
      const expr = m[1]!.trim();
      const dot = expr.indexOf('.');
      if (dot < 0) continue;
      const providerName = expr.slice(0, dot).trim();
      const key = expr.slice(dot + 1).trim();
      if (providerName && key) visit(providerName, key);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walkRefs(v, visit);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walkRefs(v, visit);
  }
}

/** Collect every `{{name.key}}` token still present after resolution. */
export function findUnresolvedAppDataTokens(value: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  walkUnresolved(value, seen, out);
  return out;
}

function walkUnresolved(value: unknown, seen: Set<string>, out: string[]): void {
  if (typeof value === 'string') {
    let m: RegExpExecArray | null;
    const re = new RegExp(TOKEN_RE.source, 'g');
    while ((m = re.exec(value)) !== null) {
      const expr = m[1]!.trim();
      if (expr.indexOf('.') < 0) continue;
      const token = m[0]!;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walkUnresolved(v, seen, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walkUnresolved(v, seen, out);
  }
}

/** Fail-closed gate: any remaining AppData template is an error string. */
export function assertAppDataResolved(value: unknown, context: string): string | null {
  const tokens = findUnresolvedAppDataTokens(value);
  if (tokens.length === 0) return null;
  return `${context}: unresolved AppData template(s) ${tokens.join(', ')}`;
}
