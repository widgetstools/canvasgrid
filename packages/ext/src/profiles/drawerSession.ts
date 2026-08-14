import type { DrawerSession as DrawerSessionApi, Unsub } from '../extension/types';

/**
 * One dirty buffer for a Customize-drawer session. Modules `stage` instead of
 * owning their own commit; the footer reads `isDirty` / `pendingCount`.
 */
export class DrawerSession implements DrawerSessionApi {
  private readonly pending = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();

  stage(moduleId: string, patch: unknown = true): void {
    this.pending.set(moduleId, patch);
    this.emit();
  }

  unstage(moduleId: string): void {
    if (!this.pending.delete(moduleId)) return;
    this.emit();
  }

  isDirty(): boolean {
    return this.pending.size > 0;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  clear(): void {
    if (this.pending.size === 0) return;
    this.pending.clear();
    this.emit();
  }

  onChange(fn: () => void): Unsub {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
