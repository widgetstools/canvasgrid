/** Shared accessor for the `@cgrid/edit` bridge attached by wireEditIntoKernel. */
import type { EditBridgeHandle } from '@cgrid/edit';

export function editHandle(grid: unknown): EditBridgeHandle | null {
  return (grid as { __editBridgeWired?: EditBridgeHandle }).__editBridgeWired ?? null;
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
