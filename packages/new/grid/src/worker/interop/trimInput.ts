/**
 * `trimInput` — the main-side half of the text-filter parameter surface.
 *
 * PORT-NOTE: ported verbatim from `applyTrimInputToModel` /
 * `trimNonMultiCondition` in
 * `packages/kernel/src/interaction/filters/textFilter.ts`. That module is a
 * 372-line DOM popup (`TextFilterPopup`) belonging to the interaction layer,
 * which has not been ported; these two functions are the only part of it
 * with no DOM dependency, and they are the main-side complement to the
 * worker's text matcher — `trimInput` is applied to the model BEFORE it is
 * shipped, which is why the worker's matcher does not trim.
 *
 * Kept here so `tests/filterPass.text.params.test.ts` — which covers the
 * worker's `caseSensitive` + `textFormatter` handling alongside this helper —
 * can run against the ported FilterPass instead of being blocked on the
 * popup. When `src/interaction/filters/textFilter.ts` lands it must
 * re-export THIS function rather than reimplementing it, and
 * `setColumnFilterModel` must keep calling it: drop the call and every
 * `trimInput: true` column silently starts filtering on padded input.
 */

import type {
  CDateFilterModel,
  CFilterModelEntry,
  CNumberFilterModel,
  CTextFilterModel,
} from '../../types';

/** Cycle 7 / Task 5 — main-side `trimInput` honored at
 *  `setColumnFilterModel` time. When `trim` is true AND `model` is a
 *  text filter with a string `filter`, returns a copy with the filter
 *  trimmed; everything else passes through unchanged.
 *
 *  Cycle 7 / Task 6 — also walks `CMultiConditionFilterModel`
 *  conditions, trimming any text-shape children so multi-condition
 *  popups respect `trimInput` per condition. */
export function applyTrimInputToModel(
  model: CFilterModelEntry | null,
  trim: boolean,
): CFilterModelEntry | null {
  if (!model || !trim) return model;
  if (model.filterType === 'multi') {
    return {
      filterType: 'multi',
      operator: model.operator,
      conditions: model.conditions.map((c) => trimNonMultiCondition(c, trim)),
    };
  }
  if (model.filterType !== 'text') return model;
  if (typeof model.filter !== 'string') return model;
  return { ...model, filter: model.filter.trim() };
}

/** Multi-condition `conditions` is strictly text | number | date — no
 *  nested multi. Trims string filters on text entries; passes
 *  number/date entries through unchanged. */
function trimNonMultiCondition(
  c: CTextFilterModel | CNumberFilterModel | CDateFilterModel,
  trim: boolean,
): CTextFilterModel | CNumberFilterModel | CDateFilterModel {
  if (!trim) return c;
  if (c.filterType !== 'text') return c;
  if (typeof c.filter !== 'string') return c;
  return { ...c, filter: c.filter.trim() };
}
