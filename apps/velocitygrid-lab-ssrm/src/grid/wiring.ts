/**
 * One place that turns kernel capabilities on.
 *
 * Every feature the lab shows is opt-in wiring: the kernel ships the engine,
 * these calls attach the compilers and engines the columns reference (Excel
 * format strings, calculated columns, style rules, the editing family, the
 * renderer catalog). A tab that forgets one gets a grid that silently paints
 * raw values, so the lab wires all of them once, here, for every tab.
 */
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import { wireRenderersIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/renderers';

export interface LabWiring {
  edit: ReturnType<typeof wireEditIntoKernel>;
  renderers: ReturnType<typeof wireRenderersIntoKernel>;
}

export function wireLabFeatures(grid: unknown): LabWiring {
  wireFormat(grid as never);
  wireCalc(grid as never);
  wireRules(grid as never);
  const renderers = wireRenderersIntoKernel(grid);
  const edit = wireEditIntoKernel(grid as never);
  return { edit, renderers };
}
