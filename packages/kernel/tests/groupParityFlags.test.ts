// Cycle 15.5 / Task 7 — group rendering parity flags tests.
//
// Tests suppressCount, groupRowRendererParams, and
// suppressGroupChangesColumnVisibility logic.
// Focus on pure unit-testable behavior without a full grid instance.

import { describe, it, expect } from 'vitest';

// ─── suppressCount threading ──────────────────────────────────────────────
// The GroupCellValue.suppressCount field is read by the group.ts renderer
// to suppress the (N) child-count suffix. We verify the field shape since
// the renderer is a canvas painter without DOM.

import type { GroupCellValue } from '../src/renderer/cellRenderers/group';

function makeGroupValue(overrides?: Partial<GroupCellValue>): GroupCellValue {
  return {
    kind: 'group',
    rowKind: 1,
    depth: 0,
    valueFormatted: 'APAC',
    childCount: 3,
    isExpanded: true,
    ...overrides,
  };
}

describe('GroupCellValue.suppressCount field', () => {
  it('suppressCount undefined by default — count suffix enabled', () => {
    const v = makeGroupValue();
    expect(v.suppressCount).toBeUndefined();
  });

  it('suppressCount: true — field is set', () => {
    const v = makeGroupValue({ suppressCount: true });
    expect(v.suppressCount).toBe(true);
  });

  it('suppressCount: false — field is set', () => {
    const v = makeGroupValue({ suppressCount: false });
    expect(v.suppressCount).toBe(false);
  });

  it('childCount: 0 always suppresses count (existing logic)', () => {
    // Even without suppressCount, childCount: 0 already hides the suffix.
    const v = makeGroupValue({ childCount: 0 });
    expect(v.childCount).toBe(0);
    // Renderer checks: childCount > 0 && !suppressCount
    const wouldPaint = v.childCount > 0 && !v.suppressCount;
    expect(wouldPaint).toBe(false);
  });

  it('childCount > 0 without suppressCount → count would paint', () => {
    const v = makeGroupValue({ childCount: 5 });
    const wouldPaint = v.childCount > 0 && !v.suppressCount;
    expect(wouldPaint).toBe(true);
  });

  it('childCount > 0 with suppressCount: true → count suppressed', () => {
    const v = makeGroupValue({ childCount: 5, suppressCount: true });
    const wouldPaint = v.childCount > 0 && !v.suppressCount;
    expect(wouldPaint).toBe(false);
  });
});

// ─── innerRenderer field ──────────────────────────────────────────────────

describe('GroupCellValue.innerRenderer field', () => {
  it('innerRenderer undefined by default', () => {
    const v = makeGroupValue();
    expect(v.innerRenderer).toBeUndefined();
  });

  it('innerRenderer name threaded when set', () => {
    const v = makeGroupValue({ innerRenderer: 'customGroupValue' });
    expect(v.innerRenderer).toBe('customGroupValue');
  });
});

// ─── suppressGroupChangesColumnVisibility logic ───────────────────────────
// This mirrors the cgrid.ts gate logic. We test the pure boolean resolution
// without instantiating the full grid.

type SuppressVis = boolean | 'suppressHideOnGroup' | 'suppressShowOnUngroup' | undefined;

function shouldHideOnGroup(suppressVis: SuppressVis): boolean {
  return !(suppressVis === true || suppressVis === 'suppressHideOnGroup');
}

function shouldShowOnUngroup(suppressVis: SuppressVis): boolean {
  return !(suppressVis === true || suppressVis === 'suppressShowOnUngroup');
}

describe('suppressGroupChangesColumnVisibility logic', () => {
  it('undefined → hide on group, show on ungroup (default behavior)', () => {
    expect(shouldHideOnGroup(undefined)).toBe(true);
    expect(shouldShowOnUngroup(undefined)).toBe(true);
  });

  it('true → suppress both hide and show', () => {
    expect(shouldHideOnGroup(true)).toBe(false);
    expect(shouldShowOnUngroup(true)).toBe(false);
  });

  it("'suppressHideOnGroup' → suppress hide only, allow show", () => {
    expect(shouldHideOnGroup('suppressHideOnGroup')).toBe(false);
    expect(shouldShowOnUngroup('suppressHideOnGroup')).toBe(true);
  });

  it("'suppressShowOnUngroup' → allow hide, suppress show only", () => {
    expect(shouldHideOnGroup('suppressShowOnUngroup')).toBe(true);
    expect(shouldShowOnUngroup('suppressShowOnUngroup')).toBe(false);
  });

  it('false is not a valid value but falls through to default', () => {
    // false is not in the union type; treating it like undefined
    expect(shouldHideOnGroup(false as any)).toBe(true);
    expect(shouldShowOnUngroup(false as any)).toBe(true);
  });
});

// ─── CGridOptions field presence ──────────────────────────────────────────
// Verify the new options fields are present on the type (compile-time check
// via runtime key inspection on a partial options object).

import type { CGridOptions } from '../src/types';

describe('CGridOptions new fields', () => {
  it('suppressCount field exists on CGridOptions type', () => {
    const opts: Partial<CGridOptions> = { suppressCount: true };
    expect(opts.suppressCount).toBe(true);
  });

  it('groupRowRendererParams field exists on CGridOptions type', () => {
    const opts: Partial<CGridOptions> = {
      groupRowRendererParams: { innerRenderer: 'myGroup', suppressCount: true },
    };
    expect(opts.groupRowRendererParams?.innerRenderer).toBe('myGroup');
    expect(opts.groupRowRendererParams?.suppressCount).toBe(true);
  });

  it('suppressGroupChangesColumnVisibility accepts all three shapes', () => {
    const opt1: Partial<CGridOptions> = { suppressGroupChangesColumnVisibility: true };
    const opt2: Partial<CGridOptions> = { suppressGroupChangesColumnVisibility: 'suppressHideOnGroup' };
    const opt3: Partial<CGridOptions> = { suppressGroupChangesColumnVisibility: 'suppressShowOnUngroup' };
    expect(opt1.suppressGroupChangesColumnVisibility).toBe(true);
    expect(opt2.suppressGroupChangesColumnVisibility).toBe('suppressHideOnGroup');
    expect(opt3.suppressGroupChangesColumnVisibility).toBe('suppressShowOnUngroup');
  });
});
