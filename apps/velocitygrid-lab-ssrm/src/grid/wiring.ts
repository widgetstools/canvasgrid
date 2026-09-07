/**
 * One place that turns kernel capabilities on — and seeds them.
 *
 * Every feature the lab shows is opt-in wiring: the kernel ships the engine,
 * these calls attach the compilers and engines the columns reference. The
 * seeds ride in at the same moment, because rules, calculated columns, nudges
 * and shortcuts are all constructor options on their engines. Installing them
 * here rather than after mount means the first paint already has them, so a
 * tab is never briefly an empty grid that then lights up.
 */
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import { wireRenderersIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/renderers';
import type { LabSeed } from '../lab/seeds';

export interface LabWiring {
  edit: ReturnType<typeof wireEditIntoKernel>;
  renderers: ReturnType<typeof wireRenderersIntoKernel>;
  /** Kept so a profile can swap the calculated-column set at runtime. */
  calc: ReturnType<typeof wireCalc>['calc'];
}

export interface WireLabOptions {
  seed: LabSeed;
  /**
   * SSRM hosts pass a committer that writes through the datasource: on that
   * path the grid does not own the row, so a local `applyTransaction` would be
   * undone by the next refresh.
   */
  commitUpdates?: (
    rows: Record<string, unknown>[],
    meta: { patches: unknown[]; direction: 'forward' | 'undo' },
  ) => void;
}

export function wireLabFeatures(grid: unknown, opts: WireLabOptions): LabWiring {
  const { seed } = opts;

  wireFormat(grid as never);
  const { calc } = wireCalc(grid as never, { calculatedColumns: seed.calculatedColumns ?? [] });
  wireRules(grid as never, {
    rules: seed.rules ?? [],
    alertRules: seed.alertRules ?? [],
    // Alerts stay off unless a tab seeds some, so tabs that are not about
    // alerts do not raise toasts over whatever they ARE about.
    alertsSettings: { enabled: (seed.alertRules?.length ?? 0) > 0 },
  });
  const renderers = wireRenderersIntoKernel(grid);
  const edit = wireEditIntoKernel(grid as never, {
    nudges: seed.nudges ?? [],
    shortcuts: seed.shortcuts ?? [],
    ...(opts.commitUpdates ? { commitUpdates: opts.commitUpdates as never } : {}),
  });

  return { edit, renderers, calc };
}
