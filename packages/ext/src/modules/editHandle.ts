/**
 * Shared accessor for the `edit` engine bridge.
 *
 * D-F8 — this used to cast the grid and read the `__editBridgeWired`
 * expando. It now goes through the context's engine slots, so ALL marker
 * knowledge lives in `extension/engines.ts` and a host that injected the
 * handle explicitly (`ctx.engines.register('edit', handle)`) is honoured.
 *
 * Still a per-call lookup on purpose: `wireEditIntoKernel(ext.grid)` runs
 * AFTER the ext constructor returns, and modules mount when the drawer
 * opens — either order must work. Never hoist the result.
 */
import type { EditBridgeHandle } from '../edit/index';
import type { VelocityGridExtContext } from '../extension/types';

export function editHandle(ctx: VelocityGridExtContext): EditBridgeHandle | null {
  return ctx.engines.get('edit');
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
