import type { IStorage } from './types';

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { then?: unknown }).then === 'function';
}

/** Await-friendly get — works for sync and async IStorage. */
export async function storageGet(storage: IStorage, key: string): Promise<string | null> {
  return await storage.getItem(key);
}

export async function storageSet(storage: IStorage, key: string, value: string): Promise<void> {
  await storage.setItem(key, value);
}

export async function storageRemove(storage: IStorage, key: string): Promise<void> {
  await storage.removeItem(key);
}

/**
 * Sync unwrap for adapters that must stay sync today (ConfigSession, AppData hydrate).
 * Throws if the underlying store returns a Promise (use RestStore only with async paths).
 */
export function storageGetSync(storage: IStorage, key: string): string | null {
  const result = storage.getItem(key);
  if (isThenable(result)) {
    throw new Error(
      'IStorage.getItem returned a Promise; this sync path requires LocalStore or MemoryStore',
    );
  }
  return result;
}

export function storageSetSync(storage: IStorage, key: string, value: string): void {
  const result = storage.setItem(key, value);
  if (isThenable(result)) {
    throw new Error(
      'IStorage.setItem returned a Promise; this sync path requires LocalStore or MemoryStore',
    );
  }
}

export function storageRemoveSync(storage: IStorage, key: string): void {
  const result = storage.removeItem(key);
  if (isThenable(result)) {
    throw new Error(
      'IStorage.removeItem returned a Promise; this sync path requires LocalStore or MemoryStore',
    );
  }
}

export async function getJson<T>(storage: IStorage, key: string): Promise<T | null> {
  const raw = await storageGet(storage, key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson(storage: IStorage, key: string, value: unknown): Promise<void> {
  await storageSet(storage, key, JSON.stringify(value));
}

export function getJsonSync<T>(storage: IStorage, key: string): T | null {
  const raw = storageGetSync(storage, key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJsonSync(storage: IStorage, key: string, value: unknown): void {
  storageSetSync(storage, key, JSON.stringify(value));
}
