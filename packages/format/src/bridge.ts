// Cycle 21c / Task 17 — the kernel bridge.
//
// `wireIntoKernel(grid, opts?)` registers @cgrid/format's capabilities
// on a CGrid instance via kernel's PUBLIC registration APIs:
//
//   1. the format compiler (kernel's compileFormatSlots pass invokes it
//      for string `valueFormatter`s and `type: 'composite'` ColDefs),
//   2. the bundled Lucide icon set (dynamic import — the ~1500-icon
//      bundle only loads when the bridge is wired, keeping kernel-only
//      apps at zero icon-bundle cost),
//   3. any `opts.additionalIconSets` (registered synchronously).
//
// Kernel never runtime-imports @cgrid/format; this module is the single
// place where format reaches into kernel, and it does so only through
// the grid surface passed in (plus a dynamic import for the icon
// bundle). Idempotent per grid instance via a `__formatBridgeWired`
// marker.

import type { WireOptions, FormatSource, CompileFormatOptions } from './types';
import { compileFormat } from './compile';

/** Structural surface of the CGrid instance (or CGridApi) the bridge
 *  registers against. Type-only — no runtime kernel import. */
interface KernelGridSurface {
  registerFormatCompiler(
    fn: (source: never, opts?: unknown) => unknown,
  ): void;
  registerIconSet(name: string, paths: Record<string, string | Path2D>): void;
  __formatBridgeWired?: boolean;
}

/**
 * Wire @cgrid/format into a CGrid instance. Idempotent — re-calling on
 * an already-wired grid is a no-op.
 */
export function wireIntoKernel(grid: unknown, opts?: WireOptions): void {
  const g = grid as KernelGridSurface;
  if (g.__formatBridgeWired) return;

  // 1. Format compiler adapter. Kernel calls `compiler(source, opts?)`;
  //    forward to compileFormat and massage the failure branch into
  //    kernel's structural error shape ({ message, loc }).
  g.registerFormatCompiler(((source: FormatSource, compileOpts?: CompileFormatOptions) => {
    const result = compileFormat(source, compileOpts);
    if (!result.ok) {
      return {
        ok: false as const,
        error: { message: result.error.message, loc: result.error.loc },
      };
    }
    return { ok: true as const, program: result.program };
  }) as never);

  // 2. Bundled Lucide icon set. Loaded via dynamic import from kernel's
  //    ./icons/lucide.generated subpath so the bundle stays out of any
  //    app that never wires the bridge. Non-fatal on failure — icons
  //    simply don't resolve and cells render text-only.
  void loadLucideBundle()
    .then((bundle) => {
      if (bundle) g.registerIconSet('lucide', bundle);
    })
    .catch(() => { /* icon loading failed — non-fatal */ });

  // 3. App-supplied icon sets (registered synchronously so tests and
  //    init-time column resolution can rely on them immediately).
  if (opts?.additionalIconSets) {
    for (const [name, paths] of Object.entries(opts.additionalIconSets)) {
      g.registerIconSet(name, paths);
    }
  }

  g.__formatBridgeWired = true;
}

async function loadLucideBundle(): Promise<Record<string, string> | null> {
  try {
    const mod = await import('@cgrid/kernel/icons/lucide.generated');
    return (mod as { lucideBundle: Record<string, string> }).lucideBundle;
  } catch {
    return null;
  }
}
