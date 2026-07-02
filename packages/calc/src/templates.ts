// Template chain folding. Ships in Task 8.
import type { ColumnOverride, ColumnTemplate } from './types';

/** Fold a chain of templates (in order) plus a trailing override into one patch. */
export function foldTemplateChain(
  _templateIds: string[],
  _templates: ReadonlyMap<string, ColumnTemplate>,
  _override?: ColumnOverride,
): Record<string, unknown> {
  throw new Error('not-yet-implemented: foldTemplateChain ships in Task 8');
}
