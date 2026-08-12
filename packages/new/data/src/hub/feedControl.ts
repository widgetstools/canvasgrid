/** Diagnostics Stop/Restart registry — multi-listener per catalog providerId. */

export type FeedControl = {
  stop: () => void;
  restart: () => void;
};

const registry = new Map<string, Set<FeedControl>>();

export function registerDataProviderFeedControl(
  providerId: string,
  control: FeedControl,
): () => void {
  if (!providerId) return () => {};
  let set = registry.get(providerId);
  if (!set) {
    set = new Set();
    registry.set(providerId, set);
  }
  set.add(control);
  return () => {
    const cur = registry.get(providerId);
    if (!cur) return;
    cur.delete(control);
    if (cur.size === 0) registry.delete(providerId);
  };
}

export function getDataProviderFeedControl(providerId: string): FeedControl | undefined {
  const set = registry.get(providerId);
  if (!set || set.size === 0) return undefined;
  // Facade that fans out to all registered controls.
  return {
    stop: () => { for (const c of set) c.stop(); },
    restart: () => { for (const c of set) c.restart(); },
  };
}

export function stopRegisteredProviderFeeds(providerId: string): void {
  getDataProviderFeedControl(providerId)?.stop();
}

export function restartRegisteredProviderFeeds(providerId: string): void {
  getDataProviderFeedControl(providerId)?.restart();
}

/** Test helper. */
export function __resetFeedControlRegistryForTests(): void {
  registry.clear();
}
