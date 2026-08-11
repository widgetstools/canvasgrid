/**
 * Optional feed controls for providers whose live path is NOT the hub
 * transport (e.g. StompPerspectiveProvider → PerspectiveBook).
 *
 * Diagnostics Stop/Restart call these so attached grids actually freeze
 * when the authoring UI says Stop — hub `stopSlot` alone cannot see the
 * Perspective SharedWorker feed.
 */

export type DataProviderFeedControl = {
  stop: () => void | Promise<void>;
  restart?: () => void | Promise<void>;
};

const byProviderId = new Map<string, Set<DataProviderFeedControl>>();

/** Register a feed control for a catalog providerId. Returns unregister. */
export function registerDataProviderFeedControl(
  providerId: string,
  control: DataProviderFeedControl,
): () => void {
  if (!providerId) return () => {};
  let set = byProviderId.get(providerId);
  if (!set) {
    set = new Set();
    byProviderId.set(providerId, set);
  }
  set.add(control);
  return () => {
    set!.delete(control);
    if (set!.size === 0) byProviderId.delete(providerId);
  };
}

export async function stopRegisteredProviderFeeds(providerId: string): Promise<void> {
  const set = byProviderId.get(providerId);
  if (!set || set.size === 0) return;
  await Promise.all([...set].map((c) => Promise.resolve(c.stop())));
}

export async function restartRegisteredProviderFeeds(providerId: string): Promise<void> {
  const set = byProviderId.get(providerId);
  if (!set || set.size === 0) return;
  await Promise.all(
    [...set].map((c) => Promise.resolve(c.restart?.() ?? undefined)),
  );
}

/** Test helper — drop all registrations. */
export function _resetDataProviderFeedControlsForTests(): void {
  byProviderId.clear();
}
