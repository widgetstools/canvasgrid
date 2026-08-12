/**
 * Web Lock feed leadership — one feeder per shared table.
 * Stop epoch is the caller's responsibility BEFORE releaseLeadership.
 */

export type FeedRole = 'none' | 'leader' | 'follower';

export type FeedLeadershipOptions = {
  lockName: string;
  /** When false, this tab always acts as leader (dedicated / memory engines). */
  sharedTable: boolean;
  isDestroyed: () => boolean;
  isFeedStopped: () => boolean;
  /** Called when this tab acquires the lock after a prior leader released it. */
  onTakeover: () => void;
  hasWebLocks?: () => boolean;
};

export class FeedLeadership {
  private role: FeedRole = 'none';
  private releaseFeedLock: (() => void) | null = null;
  private leadershipQueued = false;

  constructor(private readonly opts: FeedLeadershipOptions) {}

  getRole(): FeedRole {
    return this.role;
  }

  private hasWebLocks(): boolean {
    if (this.opts.hasWebLocks) return this.opts.hasWebLocks();
    return typeof navigator !== 'undefined' && 'locks' in navigator;
  }

  /** Race for immediate leadership (`ifAvailable`); winner HOLDS until release. */
  tryLead(): Promise<boolean> {
    if (!this.opts.sharedTable || !this.hasWebLocks()) {
      this.role = 'leader';
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolveWon) => {
      void navigator.locks.request(
        this.opts.lockName,
        { ifAvailable: true },
        async (lock) => {
          if (lock === null || this.opts.isDestroyed()) {
            resolveWon(false);
            return;
          }
          this.role = 'leader';
          resolveWon(true);
          await new Promise<void>((release) => { this.releaseFeedLock = release; });
        },
      );
    });
  }

  /** Queue for takeover — resume live only (caller must not resnapshot). */
  queueTakeover(): void {
    if (!this.opts.sharedTable || !this.hasWebLocks() || this.leadershipQueued) return;
    if (this.opts.isFeedStopped()) return;
    this.leadershipQueued = true;
    this.role = 'follower';
    void navigator.locks.request(this.opts.lockName, async () => {
      if (this.opts.isDestroyed() || this.opts.isFeedStopped()) return;
      this.role = 'leader';
      this.opts.onTakeover();
      await new Promise<void>((release) => { this.releaseFeedLock = release; });
    });
  }

  release(): void {
    this.leadershipQueued = false;
    if (this.releaseFeedLock) {
      this.releaseFeedLock();
      this.releaseFeedLock = null;
    }
    if (this.role === 'leader') this.role = 'none';
  }
}
