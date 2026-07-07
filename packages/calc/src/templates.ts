// Template chain fold — StarUI 07 semantics (docs/starui-customizer/07-column-templates.md):
//   typeDefault (only when assignment.templateIds === undefined)
//     → templateIds left-to-right → assignment (highest priority).
// cellStyle merges PER-KEY; every other field is last-writer-wins wholesale.
// Pure: no engine state, no clock, inputs never mutated. The CALLER
// (CalcEngine.resolvedPatchFor) resolves typeDefault buckets and drops
// missing template ids before calling in.

import type { ColumnOverride, ColumnTemplate } from './types';

type TemplateOverrides = Omit<ColumnOverride, 'colId' | 'templateIds'>;

const SCALAR_KEYS = [
  'headerName', 'format', 'cellRenderer', 'editable', 'hide', 'width',
] as const satisfies ReadonlyArray<keyof TemplateOverrides>;

function mergeLayer(into: ColumnOverride, layer: TemplateOverrides): void {
  const target = into as unknown as Record<string, unknown>;
  for (const key of SCALAR_KEYS) {
    const value = layer[key];
    // `!== undefined`, never truthiness — a DEFINED falsy (editable: false,
    // hide: false) must win over an earlier layer's true.
    if (value !== undefined) target[key] = value;
  }
  if (layer.cellStyle !== undefined) {
    into.cellStyle = { ...(into.cellStyle ?? {}), ...layer.cellStyle };
  }
  if (layer.headerStyle !== undefined) {
    into.headerStyle = { ...(into.headerStyle ?? {}), ...layer.headerStyle };
  }
  // cellIcon/headerIcon: last-writer-wins WHOLESALE (an icon is one value,
  // not a style bag — later layers replace, never merge per-key).
  if (layer.cellIcon !== undefined) into.cellIcon = { ...layer.cellIcon };
  if (layer.headerIcon !== undefined) into.headerIcon = { ...layer.headerIcon };
}

export function foldTemplateChain(
  typeDefaultTemplate: ColumnTemplate | null,
  chainTemplates: ColumnTemplate[],
  assignment: ColumnOverride,
): ColumnOverride {
  const merged: ColumnOverride = { colId: assignment.colId };
  if (typeDefaultTemplate !== null) mergeLayer(merged, typeDefaultTemplate.overrides);
  for (const template of chainTemplates) mergeLayer(merged, template.overrides);
  // The assignment layer: ColumnOverride is a structural superset of
  // TemplateOverrides; mergeLayer only reads the shared fields, so colId /
  // templateIds never leak into the merged output.
  mergeLayer(merged, assignment);
  return merged;
}
