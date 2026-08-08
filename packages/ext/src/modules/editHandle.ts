/** Shared accessor for the `@wellsfargo-starui/velocity-grid-edit` bridge attached by wireEditIntoKernel. */
import type { EditBridgeHandle } from '@wellsfargo-starui/velocity-grid-edit';

export function editHandle(grid: unknown): EditBridgeHandle | null {
  return (grid as { __editBridgeWired?: EditBridgeHandle }).__editBridgeWired ?? null;
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
