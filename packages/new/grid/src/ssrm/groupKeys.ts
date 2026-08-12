/** Composite group keys — `colId:value::colId:value` (kernel vocabulary). */

export function buildCompositeGroupKey(
  rowGroupCols: readonly string[],
  path: readonly string[],
): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length && i < rowGroupCols.length; i++) {
    parts.push(`${rowGroupCols[i]!}:${path[i] ?? ''}`);
  }
  return parts.join('::');
}

export function parseCompositeGroupKey(key: string): Array<{ colId: string; value: string }> {
  if (!key) return [];
  return key.split('::').map((seg) => {
    const i = seg.indexOf(':');
    if (i < 0) return { colId: seg, value: '' };
    return { colId: seg.slice(0, i), value: seg.slice(i + 1) };
  });
}

export const SSRM_GROUP_ROW_ID_PREFIX = '__grp__';
export const SSRM_FOOTER_ROW_ID_PREFIX = '__footer__';
export const SSRM_GRAND_TOTAL_ROW_ID = '__grand_total__';
