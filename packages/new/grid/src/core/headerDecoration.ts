// Shared header-decoration resolution for BOTH header-bearing def kinds.
//
// `CColDef.headerClass` / `CColDef.headerStyle` and
// `CColGroupDef.headerClass` / `CColGroupDef.headerStyle` carry the same
// static-or-function union and are resolved with identical semantics: the
// static branch is pre-compiled into an array once at resolve time (the
// paint path then reads it at zero allocation cost), the function branch is
// stored as-is and invoked per header cell.
//
// The legacy kernel resolved this twice — once in `resolveColDef` (leaf
// path) and once inline in `resolveColumnTree` (group path, carrying the
// comment "inlined here to avoid import cycles with propertyChain.ts").
// This module is the shared bottom of that dependency: both
// `propertyChain.ts` and `columnTree.ts` import it, neither imports the
// other for this purpose, and the duplication is gone.

import type { ColCellOverrides, HeaderClass, HeaderStyleFunc } from '../types';

/** Function-form `headerClass` after resolution. */
export type HeaderClassFn = (params: { colId: string }) => string | string[] | undefined;

/**
 * Resolved header-decoration slots. At most ONE of
 * `headerClassStatic` / `headerClassFn` is populated, and at most one of
 * `headerStyle` / `headerStyleFn`. Keys with no value are OMITTED (not set
 * to `undefined`) so the result spreads cleanly into a resolved def.
 */
export interface ResolvedHeaderDecoration {
  headerClassStatic?: string[];
  headerClassFn?: HeaderClassFn;
  headerStyle?: ColCellOverrides;
  headerStyleFn?: HeaderStyleFunc;
}

/**
 * Normalize a `HeaderClass` value into either a static string array or a
 * function. A string becomes a one-element array; an array is copied (so
 * the caller never shares a mutable array with the authored def); a
 * function passes through.
 */
export function compileHeaderClass(
  headerClass: HeaderClass | undefined,
): Pick<ResolvedHeaderDecoration, 'headerClassStatic' | 'headerClassFn'> {
  if (headerClass === undefined) return {};
  if (typeof headerClass === 'string') return { headerClassStatic: [headerClass] };
  if (Array.isArray(headerClass)) return { headerClassStatic: (headerClass as string[]).slice() };
  return { headerClassFn: headerClass as HeaderClassFn };
}

/**
 * Split a `headerStyle` value into its static-object slot and its
 * function-form slot. `null` is treated as "unset" on the object branch
 * (`typeof null === 'object'`).
 */
export function compileHeaderStyle(
  headerStyle: ColCellOverrides | HeaderStyleFunc | undefined,
): Pick<ResolvedHeaderDecoration, 'headerStyle' | 'headerStyleFn'> {
  if (typeof headerStyle === 'function') return { headerStyleFn: headerStyle };
  if (typeof headerStyle === 'object' && headerStyle !== null) return { headerStyle };
  return {};
}

/** Both halves at once — the shape leaf + group resolution both want. */
export function resolveHeaderDecoration(
  headerClass: HeaderClass | undefined,
  headerStyle: ColCellOverrides | HeaderStyleFunc | undefined,
): ResolvedHeaderDecoration {
  return {
    ...compileHeaderClass(headerClass),
    ...compileHeaderStyle(headerStyle),
  };
}
