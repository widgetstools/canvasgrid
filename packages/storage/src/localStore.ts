import type { IStorage } from './types';

export type LocalStoreErrorOp = 'getItem' | 'setItem' | 'removeItem';

export interface LocalStoreOptions {
  /** Called when a localStorage op throws (quota exceeded, private-mode
   *  restrictions, etc). Purely observational — the op still degrades
   *  silently (returns null / no-ops) regardless of whether this is
   *  supplied; opt in only if you want persistence failures visible. */
  onError?: (op: LocalStoreErrorOp, error: unknown, key: string) => void;
}

/** Browser `localStorage` implementation of {@link IStorage}. */
export class LocalStore implements IStorage {
  private readonly onError?: LocalStoreOptions['onError'];

  constructor(opts?: LocalStoreOptions) {
    this.onError = opts?.onError;
  }

  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      this.onError?.('getItem', error, key);
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      this.onError?.('setItem', error, key); // quota / private mode
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      this.onError?.('removeItem', error, key);
    }
  }
}
