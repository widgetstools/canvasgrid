/**
 * Cross-tab feed Stop/Restart for a catalog providerId.
 *
 * PerspectiveBook + feed latch live per tab; the SharedWorker table is
 * shared. Without this channel, Diagnostics Stop only freezes the tab that
 * clicked it — other tabs keep leading/following the live feed.
 */

const CHANNEL = 'cgrid-psp-feed-control';

type FeedBroadcastMsg =
  | { v: 1; type: 'stop'; providerId: string }
  | { v: 1; type: 'restart'; providerId: string };

type FeedBroadcastHandlers = {
  onStop: () => void;
  onRestart: () => void;
};

const localHandlers = new Map<string, Set<FeedBroadcastHandlers>>();
let channel: BroadcastChannel | null = null;
let listening = false;

function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
  }
  if (!listening) {
    listening = true;
    channel.addEventListener('message', (ev: MessageEvent<FeedBroadcastMsg>) => {
      const msg = ev.data;
      if (!msg || msg.v !== 1 || !msg.providerId) return;
      const set = localHandlers.get(msg.providerId);
      if (!set) return;
      for (const h of set) {
        if (msg.type === 'stop') h.onStop();
        else if (msg.type === 'restart') h.onRestart();
      }
    });
  }
  return channel;
}

/** Subscribe this tab's book to remote Stop/Restart for `providerId`. */
export function subscribeProviderFeedBroadcast(
  providerId: string,
  handlers: FeedBroadcastHandlers,
): () => void {
  if (!providerId) return () => {};
  ensureChannel();
  let set = localHandlers.get(providerId);
  if (!set) {
    set = new Set();
    localHandlers.set(providerId, set);
  }
  set.add(handlers);
  return () => {
    set!.delete(handlers);
    if (set!.size === 0) localHandlers.delete(providerId);
  };
}

/** Tell every other tab (and this channel's listeners are local-only —
 *  caller still stops the local book). */
export function broadcastProviderFeedStop(providerId: string): void {
  const ch = ensureChannel();
  if (!ch || !providerId) return;
  const msg: FeedBroadcastMsg = { v: 1, type: 'stop', providerId };
  ch.postMessage(msg);
}

export function broadcastProviderFeedRestart(providerId: string): void {
  const ch = ensureChannel();
  if (!ch || !providerId) return;
  const msg: FeedBroadcastMsg = { v: 1, type: 'restart', providerId };
  ch.postMessage(msg);
}
