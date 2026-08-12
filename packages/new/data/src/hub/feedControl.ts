/** Diagnostics Stop/Restart registry (per catalog providerId). */

export type FeedControl = {
  stop: () => void;
  restart: () => void;
};

const registry = new Map<string, FeedControl>();

export function registerDataProviderFeedControl(
  providerId: string,
  control: FeedControl,
): () => void {
  registry.set(providerId, control);
  return () => {
    if (registry.get(providerId) === control) registry.delete(providerId);
  };
}

export function getDataProviderFeedControl(providerId: string): FeedControl | undefined {
  return registry.get(providerId);
}
