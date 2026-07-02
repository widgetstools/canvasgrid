// Min-heap of activation deadlines with a single coalesced timer. Ships in Task 5.
export interface ExpiryEntry { deadline: number; rowId: string; colId: string | null; ruleId: string; }

export class ExpiryHeap {
  constructor(_opts: { now: () => number; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (h: unknown) => void }) {
    throw new Error('not-yet-implemented: ExpiryHeap ships in Task 5');
  }
  push(_e: ExpiryEntry): void { throw new Error('not-yet-implemented'); }
  /** Currently-active (unexpired) key check: `rowId\0colId\0ruleId`. */
  isActive(_rowId: string, _colId: string | null, _ruleId: string): boolean { throw new Error('not-yet-implemented'); }
  onExpire(_fn: (expired: ExpiryEntry[]) => void): () => void { throw new Error('not-yet-implemented'); }
  clear(): void { throw new Error('not-yet-implemented'); }
}
