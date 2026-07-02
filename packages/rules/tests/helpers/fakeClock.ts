// Deterministic clock + manual timer harness for expiry tests.
// Tests may use fake clocks; src stays Date-free (Global Constraints).

export interface FakeClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  /** Move time to `to`, then fire due timers in due-time order (timers
   *  re-armed during a flush that are still due also fire). */
  advance: (to: number) => void;
  pendingTimerCount: () => number;
}

export function makeClock(): FakeClock {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    advance: (to) => {
      now = to;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Number.POSITIVE_INFINITY;
        for (const [id, t] of timers) {
          if (t.at <= now && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const due = timers.get(dueId)!;
        timers.delete(dueId);
        due.fn();
      }
    },
    pendingTimerCount: () => timers.size,
  };
}
