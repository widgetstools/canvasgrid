/**
 * String-form `valueGetter` — AG Grid-style expressions compiled with
 * `@wellsfargo-starui/velocity-grid-expression`.
 *
 * Examples: `[ask] - [bid]`, `IF([qty] > 0, [pnl], 0)`, `[desk] == "NY" ? [spread] : 0`.
 * Shared by ColDef resolve (main) and the worker pipeline.
 */
import { compile, evaluate, parse, type Compiled } from '@wellsfargo-starui/velocity-grid-expression';

const cache = new Map<string, Compiled | null>();

export function compileValueGetterSrc(src: string): Compiled | null {
  const key = src;
  if (cache.has(key)) return cache.get(key) ?? null;
  const parsed = parse(src);
  if (!parsed.ok) {
    cache.set(key, null);
    return null;
  }
  const compiled = compile(parsed.ast);
  if (!compiled.ok) {
    cache.set(key, null);
    return null;
  }
  cache.set(key, compiled.compiled);
  return compiled.compiled;
}

export function evalValueGetterSrc(src: string, row: unknown): unknown {
  const compiled = compileValueGetterSrc(src);
  if (!compiled) return null;
  try {
    return evaluate(compiled, { row: (row ?? {}) as Record<string, unknown> });
  } catch {
    return null;
  }
}

export function valueGetterFnFromSrc<TRow>(
  src: string,
): (params: { data: TRow; colId: string }) => unknown {
  return (params) => evalValueGetterSrc(src, params.data as unknown);
}
